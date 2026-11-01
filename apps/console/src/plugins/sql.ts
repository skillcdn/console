// A schema and a login role of a plugin's own (ADR-0051, docs/specs/plugins.md, "SQL"): what the
// capability `storage:sql` opens. Enabling creates `plugin_<key>` and the role of the same name,
// with rights on that schema and nothing else, a search path of its own, a statement timeout and
// a connection limit; the console draws the role's password at every boot and keeps it in memory
// alone. The plugin's migrations are applied as the role, and `ctx.sql` runs on a pool of the
// role in the parent, its results bounded. Purge drops the schema and the role.
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_PLUGIN_SQL_ROWS,
  PLUGIN_SQL_CONNECTIONS,
  PLUGIN_SQL_STATEMENT_MS,
  PluginRefusal,
} from "@skillcdn/console/plugin";
import { sql } from "drizzle-orm";
import { Client, Pool, type PoolClient } from "pg";
import { type Database, drizzleOf, sslOf } from "../db/client.js";
import type { Logger } from "../logger.js";

/** The bytes a result may hold as JSON: `MAX_PLUGIN_MESSAGE_BYTES`, measured before it crosses to the host. */
const RESULT_BYTES_AT_MOST = 4 * 1024 * 1024;
/** How long an open transaction waits for its plugin before it is rolled back. */
const TRANSACTION_TTL_MS = 60_000;
/** The console's own migration lock, which the plugins' migrations run under too. */
const MIGRATION_LOCK_KEY = 5_434_002;
const MIGRATION_NAME = /^\d{4}-[a-z0-9-]+\.sql$/;

export interface PluginSqlOptions {
  readonly database: Database;
  /** The console's own connection string and authority, from which the role's connections are made. */
  readonly connectionString: string;
  readonly ca: string | undefined;
  readonly logger: Logger;
}

export interface SqlResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
}

/** The schema and the role of a plugin: its key, with `-` as `_`, after `plugin_`. */
export function sqlNameOf(key: string): string {
  return `plugin_${key.replaceAll("-", "_")}`;
}

/** An identifier quoted for a statement that cannot take it as a parameter. */
function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** A literal quoted for a statement that cannot take it as a parameter: a password. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export class PluginSqlService {
  private readonly options: PluginSqlOptions;
  private readonly passwords = new Map<string, string>();
  private readonly pools = new Map<string, Pool>();
  private readonly transactions = new Map<string, { client: PoolClient; timer: NodeJS.Timeout }>();
  private counter = 0;

  constructor(options: PluginSqlOptions) {
    this.options = options;
  }

  /** Whether the console's database user may make roles: without `CREATEROLE`, no plugin gets a schema. */
  async available(): Promise<boolean> {
    try {
      const result = await drizzleOf(this.options.database).execute<{ able: boolean }>(
        sql`select (rolcreaterole or rolsuper) as able from pg_roles where rolname = current_user`,
      );
      return result.rows[0]?.able === true;
    } catch (error) {
      this.options.logger.warn(
        { err: error },
        "whether plugins may have schemas could not be read",
      );
      return false;
    }
  }

  /**
   * Makes the plugin's schema and role, or brings them to what they must be, and draws the role's
   * password anew. The role may use and create in its schema and nothing in `public`; its
   * statements time out and its connections are few.
   */
  async provision(key: string): Promise<void> {
    const name = sqlNameOf(key);
    const password = randomBytes(32).toString("base64url");
    const db = drizzleOf(this.options.database);
    await db.execute(sql.raw(`create schema if not exists ${quoted(name)}`));
    const roles = await db.execute<{ exists: boolean }>(
      sql`select exists (select 1 from pg_roles where rolname = ${name}) as exists`,
    );
    if (roles.rows[0]?.exists === true) {
      await db.execute(
        sql.raw(
          `alter role ${quoted(name)} with login noinherit nocreatedb nocreaterole nosuperuser connection limit ${PLUGIN_SQL_CONNECTIONS} password ${literal(password)}`,
        ),
      );
    } else {
      await db.execute(
        sql.raw(
          `create role ${quoted(name)} with login noinherit nocreatedb nocreaterole nosuperuser connection limit ${PLUGIN_SQL_CONNECTIONS} password ${literal(password)}`,
        ),
      );
    }
    await db.execute(sql.raw(`alter role ${quoted(name)} set search_path = ${quoted(name)}`));
    await db.execute(
      sql.raw(
        `alter role ${quoted(name)} set statement_timeout = ${literal(`${PLUGIN_SQL_STATEMENT_MS}ms`)}`,
      ),
    );
    await db.execute(sql.raw(`grant usage, create on schema ${quoted(name)} to ${quoted(name)}`));
    await db.execute(sql.raw(`revoke all on schema public from ${quoted(name)}`));
    this.passwords.set(key, password);
    const pool = this.pools.get(key);
    if (pool !== undefined) {
      this.pools.delete(key);
      await pool.end().catch(() => undefined);
    }
  }

  /** The pool of the plugin's role, made with the password drawn at this boot. */
  private pool(key: string): Pool {
    let pool = this.pools.get(key);
    if (pool !== undefined) {
      return pool;
    }
    const password = this.passwords.get(key);
    if (password === undefined) {
      throw new PluginRefusal(
        "plugin.unavailable",
        "the plugin's schema is not provisioned in this process",
      );
    }
    const url = new URL(this.options.connectionString);
    url.username = sqlNameOf(key);
    url.password = password;
    pool = new Pool({
      connectionString: url.href,
      ssl: sslOf(this.options.ca),
      max: PLUGIN_SQL_CONNECTIONS,
      application_name: `console-${sqlNameOf(key)}`,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: PLUGIN_SQL_STATEMENT_MS,
    });
    pool.on("error", () => {});
    this.pools.set(key, pool);
    return pool;
  }

  private bounded(result: { rows: unknown[]; rowCount: number | null }): SqlResult {
    if (result.rows.length > MAX_PLUGIN_SQL_ROWS) {
      throw new PluginRefusal(
        "plugin.too_many",
        `a result holds ${MAX_PLUGIN_SQL_ROWS} rows at most`,
      );
    }
    if (Buffer.byteLength(JSON.stringify(result.rows), "utf8") > RESULT_BYTES_AT_MOST) {
      throw new PluginRefusal(
        "plugin.too_many",
        `a result holds ${RESULT_BYTES_AT_MOST} bytes at most`,
      );
    }
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  /** What the database said of a statement, as the plugin may read it; its own schema is its own business. */
  private refusal(error: unknown): PluginRefusal {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === "57014") {
      return new PluginRefusal("plugin.timeout", "the statement ran past its time");
    }
    return new PluginRefusal(
      "plugin.invalid_args",
      `the database refused the statement: ${message}`,
    );
  }

  /** Runs a statement as the plugin's role, in a transaction of the plugin's where `tx` names one. */
  async query(
    key: string,
    text: string,
    params: readonly unknown[],
    tx?: string,
  ): Promise<SqlResult> {
    if (typeof text !== "string" || text.length === 0 || text.length > 100_000) {
      throw new PluginRefusal(
        "plugin.invalid_args",
        "a statement is text, up to 100,000 characters",
      );
    }
    try {
      if (tx !== undefined) {
        const open = this.transactions.get(tx);
        if (open === undefined) {
          throw new PluginRefusal("plugin.not_found", "the transaction is not open");
        }
        return this.bounded(await open.client.query(text, [...params]));
      }
      return this.bounded(await this.pool(key).query(text, [...params]));
    } catch (error) {
      if (error instanceof PluginRefusal) {
        throw error;
      }
      throw this.refusal(error);
    }
  }

  /** Opens a transaction on a connection of the plugin's role; rolled back on its own after a minute. */
  async begin(key: string): Promise<string> {
    const client = await this.pool(key).connect();
    try {
      await client.query("begin");
    } catch (error) {
      client.release();
      throw this.refusal(error);
    }
    this.counter += 1;
    const id = `${key}:${this.counter}`;
    const timer = setTimeout(() => {
      void this.rollback(id).catch(() => undefined);
    }, TRANSACTION_TTL_MS);
    timer.unref();
    this.transactions.set(id, { client, timer });
    return id;
  }

  private async end(id: string, statement: "commit" | "rollback"): Promise<void> {
    const open = this.transactions.get(id);
    if (open === undefined) {
      throw new PluginRefusal("plugin.not_found", "the transaction is not open");
    }
    this.transactions.delete(id);
    clearTimeout(open.timer);
    try {
      await open.client.query(statement);
    } catch (error) {
      open.client.release(error instanceof Error ? error : new Error(String(error)));
      throw this.refusal(error);
    }
    open.client.release();
  }

  commit(id: string): Promise<void> {
    return this.end(id, "commit");
  }

  rollback(id: string): Promise<void> {
    return this.end(id, "rollback");
  }

  /**
   * Applies the plugin's migrations, in the order of their names, as the plugin's role, under the
   * console's migration lock; those applied are recorded in the schema's own `_migrations`.
   * Answers how many were applied now.
   */
  async applyMigrations(key: string, dir: string): Promise<number> {
    const names = (await readdir(dir)).filter((name) => MIGRATION_NAME.test(name)).sort();
    const lock = new Client({
      connectionString: this.options.connectionString,
      ssl: sslOf(this.options.ca),
      application_name: "console-plugin-migrate",
    });
    await lock.connect();
    const pool = this.pool(key);
    let applied = 0;
    try {
      await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      await pool.query(
        "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
      );
      const done = new Set(
        (await pool.query<{ name: string }>("select name from _migrations")).rows.map(
          (row) => row.name,
        ),
      );
      for (const name of names) {
        if (done.has(name)) {
          continue;
        }
        const text = await readFile(join(dir, name), "utf8");
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query(text);
          await client.query("insert into _migrations (name) values ($1)", [name]);
          await client.query("commit");
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw new PluginRefusal(
            "plugin.failed",
            `the migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          client.release();
        }
        applied += 1;
      }
    } finally {
      await lock.end();
    }
    return applied;
  }

  /** Drops the plugin's schema with everything in it, ends the role's connections, and drops the role. */
  async purge(key: string): Promise<void> {
    const name = sqlNameOf(key);
    const pool = this.pools.get(key);
    this.pools.delete(key);
    this.passwords.delete(key);
    await pool?.end().catch(() => undefined);
    const db = drizzleOf(this.options.database);
    await db.execute(sql.raw(`drop schema if exists ${quoted(name)} cascade`));
    await db.execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity where usename = ${name} and pid <> pg_backend_pid()`,
    );
    await db.execute(sql.raw(`drop role if exists ${quoted(name)}`));
  }

  /** Ends every pool and rolls back what is open. */
  async stop(): Promise<void> {
    for (const id of [...this.transactions.keys()]) {
      await this.rollback(id).catch(() => undefined);
    }
    for (const [key, pool] of this.pools) {
      this.pools.delete(key);
      await pool.end().catch(() => undefined);
    }
  }
}
