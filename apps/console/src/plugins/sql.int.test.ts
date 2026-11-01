import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { PluginSqlService, sqlNameOf } from "./sql.js";

// A plugin's schema and role against a real database (docs/specs/plugins.md, "SQL"): made with
// rights on its own schema alone, its migrations applied as the role, its statements bounded, its
// transactions its own, and nothing left after purge. The development database's user is a
// superuser, which may make roles. The role is the cluster's, not the database's: this file's plugin
// is named apart from the fixtures', so that the test files that run beside it do not meet it.

let testDatabase: TestDatabase;
let service: PluginSqlService;
let migrations: string;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  service = new PluginSqlService({
    database: testDatabase.database,
    connectionString: testDatabase.connectionString,
    ca: undefined,
    logger: pino({ level: "warn" }, { write: () => {} }),
  });
  migrations = await mkdtemp(join(tmpdir(), "console-plugin-migrations-"));
  await writeFile(
    join(migrations, "0001-init.sql"),
    "create table things (id serial primary key, name text not null);\n",
  );
  await writeFile(join(migrations, "0002-more.sql"), "alter table things add column note text;\n");
  await writeFile(join(migrations, "notes.txt"), "not a migration\n");
});

afterAll(async () => {
  await service?.stop();
  await testDatabase?.drop();
  if (migrations !== undefined) {
    await rm(migrations, { recursive: true, force: true });
  }
});

describe("a plugin's schema", () => {
  it("is available where the console's user may make roles", async () => {
    expect(await service.available()).toBe(true);
    expect(sqlNameOf("leave-days")).toBe("plugin_leave_days");
  });

  it("is made with a role that reaches its own schema and nothing of the console's", async () => {
    await service.provision("tallytest");
    expect(await service.applyMigrations("tallytest", migrations)).toBe(2);
    expect(await service.applyMigrations("tallytest", migrations)).toBe(0);
    const inserted = await service.query(
      "tallytest",
      "insert into things (name) values ($1) returning id, name",
      ["one"],
    );
    expect(inserted.rows).toEqual([{ id: 1, name: "one" }]);
    expect(inserted.rowCount).toBe(1);
    await expect(
      service.query("tallytest", "select id from public.workspaces limit 1", []),
    ).rejects.toMatchObject({
      code: "plugin.invalid_args",
      message: expect.stringContaining("permission denied"),
    });
    await expect(
      service.query("tallytest", "create table public.mine (id int)", []),
    ).rejects.toMatchObject({ code: "plugin.invalid_args" });
    const setting = await service.query("tallytest", "show statement_timeout", []);
    expect(setting.rows[0]).toEqual({ statement_timeout: "10s" });
    const path = await service.query("tallytest", "show search_path", []);
    expect(path.rows[0]).toEqual({ search_path: "plugin_tallytest" });
  });

  it("bounds a result, and refuses a statement that is not one", async () => {
    await expect(
      service.query("tallytest", "select generate_series(1, 20000) as n", []),
    ).rejects.toMatchObject({ code: "plugin.too_many" });
    await expect(service.query("tallytest", "select from nowhere", [])).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
    await expect(service.query("tallytest", "", [])).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
    await expect(service.query("tallytest", "select pg_sleep(11)", [])).rejects.toMatchObject({
      code: "plugin.timeout",
    });
  }, 20_000);

  it("runs a transaction as a unit, committed or rolled back", async () => {
    const tx = await service.begin("tallytest");
    await service.query("tallytest", "insert into things (name) values ($1)", ["two"], tx);
    await service.query("tallytest", "insert into things (name) values ($1)", ["three"], tx);
    await service.commit(tx);
    const undone = await service.begin("tallytest");
    await service.query("tallytest", "insert into things (name) values ($1)", ["four"], undone);
    await service.rollback(undone);
    await expect(service.query("tallytest", "select 1", [], undone)).rejects.toMatchObject({
      code: "plugin.not_found",
    });
    const counted = await service.query("tallytest", "select count(*)::int as n from things", []);
    expect(counted.rows).toEqual([{ n: 3 }]);
  });

  it("draws a new password when provisioned again, and the old connections give way", async () => {
    await service.provision("tallytest");
    const counted = await service.query("tallytest", "select count(*)::int as n from things", []);
    expect(counted.rows).toEqual([{ n: 3 }]);
    expect(await service.applyMigrations("tallytest", migrations)).toBe(0);
  });

  it("refuses a plugin that was not provisioned in this process", async () => {
    await expect(service.query("ghost", "select 1", [])).rejects.toMatchObject({
      code: "plugin.unavailable",
    });
  });

  it("purges the schema and the role, leaving nothing", async () => {
    await service.purge("tallytest");
    const { drizzleOf } = await import("../db/client.js");
    const { sql } = await import("drizzle-orm");
    const db = drizzleOf(testDatabase.database);
    const schemas = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_namespace where nspname = 'plugin_tallytest'`,
    );
    expect(schemas.rows[0]?.n).toBe(0);
    const roles = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_roles where rolname = 'plugin_tallytest'`,
    );
    expect(roles.rows[0]?.n).toBe(0);
    await expect(service.query("tallytest", "select 1", [])).rejects.toMatchObject({
      code: "plugin.unavailable",
    });
  });
});
