import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Drizzle = NodePgDatabase<typeof schema>;
/** What a function that must compose with others runs in. For this directory only. */
export type Transaction = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];

export interface DatabaseOptions {
  /** Passed in by the caller: the config module, or a test. Nothing here reads the environment. */
  readonly connectionString: string;
  /** The authority the server's certificate is checked against, as PEM. See {@link sslOf}. */
  readonly ca?: string | undefined;
  readonly maxConnections?: number;
  /** Shows up in `pg_stat_activity`. */
  readonly applicationName?: string;
  readonly statementTimeoutMs?: number;
}

/**
 * An open connection pool. Deliberately opaque: the rest of the app holds it and passes it to
 * the functions under `db/queries/`; nothing outside this directory sees the ORM or SQL.
 */
export interface Database {
  /** True when a query reaches the server. Never throws. */
  ping(): Promise<boolean>;
  /** Waits for checked-out connections to come back, then closes the pool. */
  close(): Promise<void>;
}

const handles = new WeakMap<Database, Drizzle>();

/**
 * How a connection checks the server's certificate when the operator hands in the authority that
 * signed it (`DATABASE_CA`): the chain against that authority, and the name against the host, which
 * is what `sslmode=verify-full` means. Without one, nothing is said here and the URL's own
 * parameters decide, as the driver reads them.
 */
export function sslOf(
  ca: string | undefined,
): { readonly ca: string; readonly rejectUnauthorized: true } | undefined {
  return ca === undefined ? undefined : { ca, rejectUnauthorized: true };
}

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new Pool({
    connectionString: options.connectionString,
    ssl: sslOf(options.ca),
    max: options.maxConnections ?? 10,
    application_name: options.applicationName ?? "console",
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // An idle client that loses its connection emits "error"; without a listener that is fatal.
  // The pool replaces the client on its own, so there is nothing to do here.
  pool.on("error", () => {});

  const database: Database = Object.freeze({
    ping: async () => {
      try {
        await pool.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  });
  handles.set(database, drizzle({ client: pool, schema, casing: "snake_case" }));
  return database;
}

/** For this directory only: the ORM behind a {@link Database}. */
export function drizzleOf(database: Database): Drizzle {
  const handle = handles.get(database);
  if (handle === undefined) {
    throw new TypeError("not a Database created by createDatabase");
  }
  return handle;
}
