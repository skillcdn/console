import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pluginPath, REST_ROUTES, restPluginsSchema } from "@skillcdn/console/api";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { loadConfig } from "../config/config.js";
import { drizzleOf } from "../db/client.js";
import { findPerson, type PersonRecord } from "../db/queries/people.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { events, pluginInstalls } from "../db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { RecordStore } from "../plugins/records.js";
import { type Invoker, Plugins } from "../plugins/registry.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  HOST_ENTRY,
  hostEnvironment,
  LEDGER_PLUGIN_DIR,
  writePluginsDir,
} from "../testing/plugins.js";
import { runMigrate } from "./migrate.js";

// The migrate role with a plugin in the image (docs/specs/plugins.md, "Lifecycle"): the role
// itself, run against a database whose install is behind the plugin's code, as a deployment is
// after an image with a new version of a plugin. Its upgrades read and write the plugin's
// records through ctx, in a host of the role's own.

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let h: Harness;
let admin: string;
let alice: PersonRecord;

interface Entry {
  readonly id: string;
  readonly data: { readonly note: string; readonly kind?: string; readonly length?: number };
}

const invoker = (): Invoker => ({
  person: alice,
  actor: { id: alice.id },
  agent: undefined,
  run: undefined,
  project: undefined,
  language: "en",
});
const entries = async (): Promise<Entry[]> =>
  ((await plugins.invoke("ledger", "command", "all", {}, invoker())).data as { items: Entry[] })
    .items;
const install = async () => {
  const [row] = await drizzleOf(testDatabase.database)
    .select({ version: pluginInstalls.version, dataVersion: pluginInstalls.dataVersion })
    .from(pluginInstalls)
    .where(eq(pluginInstalls.key, "ledger"));
  return row;
};
/** The install as an image with the plugin's first version left it. */
const behind = () =>
  drizzleOf(testDatabase.database)
    .update(pluginInstalls)
    .set({ version: "0.1.0", dataVersion: 1 })
    .where(eq(pluginInstalls.key, "ledger"));
const listed = async () =>
  restPluginsSchema
    .parse(await (await h.request(REST_ROUTES.plugins, { headers: { cookie: admin } })).json())
    .items.find((plugin) => plugin.key === "ledger");
const kinds = async (): Promise<string[]> =>
  (
    await drizzleOf(testDatabase.database)
      .select({ kind: events.kind })
      .from(events)
      .orderBy(events.id)
  )
    .map((event) => event.kind)
    .filter((kind) => kind === "plugin.upgraded" || kind === "plugin.failed");
/** The role, as a deployment runs it: configured by the environment, with what it logs kept. */
const migrate = async (): Promise<Record<string, unknown>[]> => {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "info" },
    { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  await runMigrate(
    loadConfig(
      {
        ...hostEnvironment(process.env),
        DATABASE_URL: testDatabase.connectionString,
        WORKSPACE_NAME: "Acme",
        PLUGINS_DIR: root,
      },
      () => {
        throw new Error("no file is read");
      },
    ),
    logger,
    HOST_ENTRY,
  );
  return lines;
};

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-migrate-")), [
    { name: "console-plugin-ledger", dir: LEDGER_PLUGIN_DIR },
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
    secrets: undefined,
    records: new RecordStore({
      database: testDatabase.database,
      blobs: createPgBlobStore(testDatabase.database),
      clock: { now: () => new Date() },
      fileBytesAtMost: undefined,
    }),
    clock: { now: () => new Date() },
    logger,
    timeouts: { command: 5_000, query: 5_000, lifecycle: 5_000 },
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"], plugins });
  const enabled = await h.request(pluginPath("ledger", "enable"), {
    method: "POST",
    headers: { cookie: admin, origin: SIGN_IN_URL, "content-type": "application/json" },
    body: JSON.stringify({ consent: [], board: null, projects: "all" }),
  });
  expect(enabled.status).toBe(200);
}, 120_000);

afterAll(async () => {
  await plugins?.stop();
  await h?.close();
  await testDatabase?.drop();
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("the migrate role, with a plugin in the image", () => {
  it("runs a plugin's upgrades over its records through ctx, a version at a time", async () => {
    await plugins.invoke("ledger", "command", "note", { words: "first" }, invoker());
    await plugins.invoke("ledger", "command", "note", { words: "the second" }, invoker());
    // Enabled by the code as it is, the install is at the code's version: nothing to run.
    expect(await install()).toEqual({ version: "0.3.0", dataVersion: 3 });
    expect((await listed())?.problems).toEqual([]);
    const idle = await migrate();
    expect(idle.find((line) => line.msg === "plugin upgrades applied")).toMatchObject({
      steps: 0,
      failed: 0,
      plugins: ["ledger"],
    });

    // An install left by the plugin's first version, with records of its shape: whoever lists
    // the plugins is told that the records are behind the code.
    await behind();
    expect((await listed())?.state).toBe("enabled");
    expect((await listed())?.problems).toEqual([
      "its records are at data version 1 and its code at 3: the upgrades did not run, or one failed; the migrate role runs them, and plugin.failed in the feed says why one failed",
    ]);

    const lines = await migrate();
    expect(lines.find((line) => line.msg === "plugin upgrades applied")).toMatchObject({
      level: 30,
      steps: 2,
      failed: 0,
    });
    expect(await install()).toEqual({ version: "0.3.0", dataVersion: 3 });
    expect((await entries()).map((entry) => entry.data)).toEqual([
      { note: "first", kind: "note", length: 5 },
      { note: "the second", kind: "note", length: 10 },
    ]);
    expect(await kinds()).toEqual(["plugin.upgraded", "plugin.upgraded"]);
    expect((await listed())?.problems).toEqual([]);
  }, 120_000);

  it("stops a plugin at the upgrade that failed, says so in its last line, and leaves the plugin said to be behind", async () => {
    await plugins.invoke("ledger", "command", "note", { words: "refuse the third" }, invoker());
    await behind();
    const lines = await migrate();
    // The first step went through and is kept; the second failed, and the install stays there.
    expect(await install()).toEqual({ version: "0.3.0", dataVersion: 2 });
    expect(lines.find((line) => line.msg === "plugin upgrades applied")).toMatchObject({
      level: 50,
      steps: 1,
      failed: 1,
      behind: ["ledger"],
    });
    expect((await kinds()).slice(2)).toEqual(["plugin.upgraded", "plugin.failed"]);
    expect((await entries()).at(-1)?.data).toEqual({ note: "refuse the third", kind: "note" });
    // Loaded all the same, with what is behind said to whoever lists the plugins.
    const plugin = await listed();
    expect(plugin?.state).toBe("enabled");
    expect(plugin?.problems[0]).toContain("its records are at data version 2 and its code at 3");
    expect((await plugins.invoke("ledger", "command", "all", {}, invoker())).text).toBe("3");
  }, 120_000);
});
