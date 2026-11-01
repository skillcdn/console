import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pluginPath, REST_ROUTES, restErrorSchema, restPluginsSchema } from "@skillcdn/console/api";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { createSecrets } from "../auth/secrets.js";
import { drizzleOf } from "../db/client.js";
import { findPerson, type PersonRecord } from "../db/queries/people.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { RecordStore } from "../plugins/records.js";
import { type Invoker, Plugins } from "../plugins/registry.js";
import { PluginSqlService } from "../plugins/sql.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  HOST_ENTRY,
  hostEnvironment,
  SQL_PLUGIN_DIR,
  writePluginsDir,
} from "../testing/plugins.js";

// A plugin with a schema of its own, end to end: enabled with consent to storage:sql, its schema
// and role made and its migrations applied, its commands running statements as the role through
// ctx.sql, held to the role's rights and the bounds, and nothing left of the schema after purge.

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let h: Harness;
let admin: string;
let alice: PersonRecord;

const json = (body: unknown, cookie: string): RequestInit => ({
  method: "POST",
  headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function schemaExists(): Promise<boolean> {
  const result = await drizzleOf(testDatabase.database).execute<{ n: number }>(
    sql`select count(*)::int as n from pg_namespace where nspname = 'plugin_tally'`,
  );
  return result.rows[0]?.n === 1;
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugin-sql-")), [
    { name: "console-plugin-tally", dir: SQL_PLUGIN_DIR },
  ]);
  const logger = pino({ level: "warn" }, { write: () => {} });
  const holder: { current: Plugins | undefined } = { current: undefined };
  const host = new PluginHost({
    entry: HOST_ENTRY,
    allowRead: await allowedReadRoots(root),
    env: hostEnvironment(process.env),
    logger,
    onContext: (call) =>
      holder.current === undefined
        ? Promise.reject(new Error("not started"))
        : holder.current.contextHandler(call),
  });
  const provider = createFixtureProvider("gh");
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"] });
  admin = await h.signIn("alice");
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  const me = (await (await h.request(REST_ROUTES.me, { headers: { cookie: admin } })).json()) as {
    person: { id: string };
  };
  const found = await findPerson(testDatabase.database, workspace.id, me.person.id);
  if (found === undefined) {
    throw new Error("alice is not a person");
  }
  alice = found;
  plugins = new Plugins({
    database: testDatabase.database,
    workspace: async () => workspace,
    host,
    discovery: await discoverPlugins(root),
    memoryMb: 64,
    secrets: createSecrets("a secret for tests, long enough to be one"),
    records: new RecordStore({
      database: testDatabase.database,
      blobs: createPgBlobStore(testDatabase.database),
      clock: { now: () => new Date() },
      fileBytesAtMost: undefined,
    }),
    sql: new PluginSqlService({
      database: testDatabase.database,
      connectionString: testDatabase.connectionString,
      ca: undefined,
      logger,
    }),
    clock: { now: () => new Date() },
    logger,
    timeouts: { command: 15_000, query: 5_000, lifecycle: 5_000 },
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"], plugins });
}, 120_000);

afterAll(async () => {
  await plugins?.stop();
  await h?.close();
  await testDatabase?.drop();
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

const invoker = (): Invoker => ({
  person: alice,
  actor: { id: alice.id },
  agent: undefined,
  run: undefined,
  project: undefined,
  language: "en",
});

describe("a plugin with a schema of its own", () => {
  it("says the deployment may give one, and is enabled only with consent to storage:sql", async () => {
    const listed = restPluginsSchema.parse(
      await (await h.request(REST_ROUTES.plugins, { headers: { cookie: admin } })).json(),
    );
    expect(listed.sql).toBe(true);
    expect(listed.items.map((plugin) => [plugin.key, plugin.capabilities])).toEqual([
      ["tally", ["storage:sql"]],
    ]);
    const refused = await h.request(
      pluginPath("tally", "enable"),
      json({ consent: [], board: null, projects: "all" }, admin),
    );
    expect(refused.status).toBe(409);
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.needs_consent");
    expect(await schemaExists()).toBe(false);
    const enabled = await h.request(
      pluginPath("tally", "enable"),
      json({ consent: ["storage:sql"], board: null, projects: "all" }, admin),
    );
    expect(enabled.status).toBe(200);
    expect(await schemaExists()).toBe(true);
  });

  it("runs the plugin's statements as its role, within its schema and the bounds", async () => {
    expect((await plugins.invoke("tally", "command", "tally", {}, invoker())).text).toBe(
      "tallied 1",
    );
    expect((await plugins.invoke("tally", "command", "count", {}, invoker())).text).toBe("1");
    expect((await plugins.invoke("tally", "command", "both", {}, invoker())).text).toBe("3");
    await expect(plugins.invoke("tally", "command", "peek", {}, invoker())).rejects.toMatchObject({
      code: "plugin.invalid_args",
      message: expect.stringContaining("permission denied"),
    });
    await expect(plugins.invoke("tally", "command", "flood", {}, invoker())).rejects.toMatchObject({
      code: "plugin.too_many",
    });
    const events = (await (
      await h.request(pluginPath("tally", "events"), { headers: { cookie: admin } })
    ).json()) as {
      items: { kind: string; data: { command?: string; outcome?: string } }[];
    };
    const outcomes = events.items
      .filter((event) => event.kind === "plugin.command")
      .map((event) => [event.data.command, event.data.outcome]);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        ["tally", "ok"],
        ["peek", "refused"],
        ["flood", "refused"],
      ]),
    );
  });

  it("drops the schema and the role on purge", async () => {
    expect((await h.request(pluginPath("tally", "disable"), json({}, admin))).status).toBe(200);
    expect(await schemaExists()).toBe(true);
    expect(
      (await h.request(pluginPath("tally", "purge"), json({ confirm: "tally" }, admin))).status,
    ).toBe(204);
    expect(await schemaExists()).toBe(false);
    const roles = await drizzleOf(testDatabase.database).execute<{ n: number }>(
      sql`select count(*)::int as n from pg_roles where rolname = 'plugin_tally'`,
    );
    expect(roles.rows[0]?.n).toBe(0);
  });
});
