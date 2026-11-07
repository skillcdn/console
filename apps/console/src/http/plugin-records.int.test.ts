import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pluginPath, REST_ROUTES, restErrorSchema, restPluginsSchema } from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { createSecrets } from "../auth/secrets.js";
import { findPerson, type PersonRecord } from "../db/queries/people.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { RecordStore } from "../plugins/records.js";
import { type Invoker, Plugins } from "../plugins/registry.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  EVIL_PLUGIN_DIR,
  HELLO_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  writePluginsDir,
} from "../testing/plugins.js";

// The plugin's records end to end: a command run in the host writes through ctx into the store,
// a person reads through the console's routes by their roles, an administrator exports and purges.

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let h: Harness;
let admin: string;
let member: string;
let bob: PersonRecord;

const json = (body: unknown, cookie: string, method = "POST"): RequestInit => ({
  method,
  headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugin-records-")), [
    { name: "console-plugin-hello", dir: HELLO_PLUGIN_DIR },
    { name: "console-plugin-evil", dir: EVIL_PLUGIN_DIR },
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
  member = await h.signIn("bob");
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  const me = (await (await h.request(REST_ROUTES.me, { headers: { cookie: member } })).json()) as {
    person: { id: string };
  };
  const found = await findPerson(testDatabase.database, workspace.id, me.person.id);
  if (found === undefined) {
    throw new Error("bob is not a person");
  }
  bob = found;
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
    clock: { now: () => new Date() },
    logger,
    timeouts: { command: 5_000, query: 5_000, lifecycle: 5_000 },
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"], plugins });
  const enabled = await h.request(
    pluginPath("hello", "enable"),
    json({ consent: [], board: null, projects: "all" }, admin),
  );
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

const invoker = (): Invoker => ({
  person: bob,
  actor: { id: bob.id },
  agent: "Claude Code",
  run: undefined,
  project: undefined,
  language: "en",
});

describe("a plugin's records", () => {
  it("are written by a command through ctx, with the writer and the search words kept", async () => {
    const result = await plugins.invoke("hello", "command", "greet", { to: "world" }, invoker());
    expect(result.kind).toBe("command");
    expect(result.text).toContain("Hello, world!");
    const record = result.data as {
      id: string;
      data: { to: string; by: string };
      createdBy: string | null;
    };
    expect(record.data).toEqual({ to: "world", text: "Hello, world!", by: "bob" });
    expect(record.createdBy).toBe(bob.id);
    await plugins.invoke(
      "hello",
      "command",
      "greet",
      { to: "moon", text: "Good night, moon" },
      invoker(),
    );
    const latest = await plugins.invoke("hello", "query", "latest", { limit: 1 }, invoker());
    expect((latest.data as { data: { to: string } }[]).map((item) => item.data.to)).toEqual([
      "moon",
    ]);
  });

  it("are read through the console's routes by a person in a reading role", async () => {
    const listed = await h.request(pluginPath("hello", "records", "greetings"), {
      headers: { cookie: member },
    });
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as {
      items: { id: string; data: { to: string } }[];
      after: string | null;
    };
    expect(page.items.map((item) => item.data.to).sort()).toEqual(["moon", "world"]);
    const first = page.items[0];
    if (first === undefined) {
      throw new Error("no record");
    }
    const one = await h.request(pluginPath("hello", "records", "greetings", first.id), {
      headers: { cookie: member },
    });
    expect(one.status).toBe(200);
    expect(((await one.json()) as { id: string }).id).toBe(first.id);
    const versions = await h.request(
      pluginPath("hello", "records", "greetings", first.id, "versions"),
      { headers: { cookie: member } },
    );
    expect(await versions.json()).toEqual({ items: [] });
    const filtered = await h.request(
      `${pluginPath("hello", "records", "greetings")}?where=${encodeURIComponent(JSON.stringify({ to: "moon" }))}&order=-id`,
      { headers: { cookie: admin } },
    );
    expect(((await filtered.json()) as { items: unknown[] }).items).toHaveLength(1);
    const searched = await h.request(`${pluginPath("hello", "records", "greetings")}?q=night`, {
      headers: { cookie: admin },
    });
    expect(
      ((await searched.json()) as { items: { data: { to: string } }[] }).items.map(
        (item) => item.data.to,
      ),
    ).toEqual(["moon"]);
    const badField = await h.request(
      `${pluginPath("hello", "records", "greetings")}?where=${encodeURIComponent(JSON.stringify({ text: "x" }))}`,
      { headers: { cookie: admin } },
    );
    expect(badField.status).toBe(400);
    expect(restErrorSchema.parse(await badField.json()).error.code).toBe("plugin.invalid_args");
    expect(
      (await h.request(pluginPath("hello", "records", "nothing"), { headers: { cookie: admin } }))
        .status,
    ).toBe(404);
    expect(
      (
        await h.request(
          pluginPath("hello", "records", "greetings", "00000000-0000-7000-8000-000000000000"),
          { headers: { cookie: admin } },
        )
      ).status,
    ).toBe(404);
    expect((await h.request(pluginPath("hello", "records", "greetings"))).status).toBe(401);
  });

  it("refuse an upload for a plugin without the files capability", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "a.bin", { type: "application/octet-stream" }),
    );
    const uploaded = await h.request(pluginPath("hello", "files"), {
      method: "POST",
      headers: { cookie: member, origin: SIGN_IN_URL },
      body: form,
    });
    expect(uploaded.status).toBe(403);
    expect(restErrorSchema.parse(await uploaded.json()).error.code).toBe("plugin.forbidden");
    const read = await h.request(
      pluginPath("hello", "files", "00000000-0000-7000-8000-000000000000"),
      { headers: { cookie: member } },
    );
    expect(read.status).toBe(403);
    expect(restErrorSchema.parse(await read.json()).error.code).toBe("plugin.forbidden");
  });

  it("are exported and purged by an administrator, after the plugin is disabled", async () => {
    const exported = await h.request(pluginPath("hello", "export"), { headers: { cookie: admin } });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await exported.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(lines.map((line) => line.type)).toEqual(["install", "record", "record"]);
    expect(
      (await h.request(pluginPath("hello", "export"), { headers: { cookie: member } })).status,
    ).toBe(403);

    const tooSoon = await h.request(
      pluginPath("hello", "purge"),
      json({ confirm: "hello" }, admin),
    );
    expect(tooSoon.status).toBe(409);
    expect((await h.request(pluginPath("hello", "disable"), json({}, admin))).status).toBe(200);
    const wrongKey = await h.request(
      pluginPath("hello", "purge"),
      json({ confirm: "evil" }, admin),
    );
    expect(wrongKey.status).toBe(400);
    const purged = await h.request(pluginPath("hello", "purge"), json({ confirm: "hello" }, admin));
    expect(purged.status).toBe(204);
    const listed = restPluginsSchema.parse(
      await (await h.request(REST_ROUTES.plugins, { headers: { cookie: admin } })).json(),
    );
    expect(listed.items.find((plugin) => plugin.key === "hello")?.state).toBe("installed");
    const events = (await (
      await h.request(pluginPath("hello", "events"), { headers: { cookie: admin } })
    ).json()) as { items: { kind: string }[] };
    expect(events.items[0]?.kind).toBe("plugin.purged");
    const again = await h.request(
      pluginPath("hello", "enable"),
      json({ consent: [], board: null, projects: "all" }, admin),
    );
    expect(again.status).toBe(200);
    const empty = (await (
      await h.request(pluginPath("hello", "records", "greetings"), { headers: { cookie: admin } })
    ).json()) as { items: unknown[] };
    expect(empty.items).toEqual([]);
  });
});
