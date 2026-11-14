import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  pluginPath,
  restErrorSchema,
  restEventsSchema,
  restPluginDetailSchema,
  restPluginInvocationSchema,
} from "@skillcdn/console/api";
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecrets } from "../auth/secrets.js";
import { drizzleOf } from "../db/client.js";
import { setSecret } from "../db/queries/plugins.js";
import { ensureWorkspace, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { pluginKeyedSecrets } from "../db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { Outbound, type OutboundSend } from "../plugins/outbound.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { Plugins } from "../plugins/registry.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  CHAT_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  writePluginsDir,
} from "../testing/plugins.js";

// A secret kept per key (ADR-0111), against a real database and a real host, the chat service
// answered from here: a token sealed under the workspace the service's answer names, put into a
// request by its key, listed, held to its bound, forgotten, set and removed by an administrator
// one key at a time, and moved from before the setting was keyed; never a value handed to the
// plugin, shown on a page or written in the feed. Needs PostgreSQL and the compiled host.

const SECRET = "a secret for tests, long enough to be one";
const NOW = new Date("2026-11-15T10:00:00.000Z");

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let h: Harness;
let admin: string;
let workspace: WorkspaceRecord;
const sent: Parameters<OutboundSend>[0][] = [];
const logged: string[] = [];

const json = (body: unknown, cookie: string, method = "POST"): RequestInit => ({
  method,
  headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
  body: JSON.stringify(body),
});

const answered = (status: number, body: unknown) => ({
  status,
  headers: { "content-type": "application/json" },
  bytes: new TextEncoder().encode(JSON.stringify(body)),
});

/**
 * The chat service: an installation's code answered with its token and the workspace it was
 * installed in, `bad` with a workspace that is no key; and a request sent back as it came.
 */
const service: OutboundSend = async (input) => {
  sent.push(input);
  if (input.url.pathname === "/oauth.access") {
    const code = String(
      (JSON.parse(new TextDecoder().decode(input.body ?? new Uint8Array())) as { code?: unknown })
        .code,
    );
    return answered(200, {
      ok: true,
      access_token: `xoxb-${code}-s3cret`,
      team: { id: code === "bad" ? 42 : `T-${code}` },
      expires_in: 3600,
    });
  }
  return answered(200, { authorization: input.headers.authorization ?? null });
};

async function run(argv: readonly string[]): Promise<{ text: string; data: unknown }> {
  const response = await h.request(pluginPath("chat", "invoke"), json({ argv }, admin));
  expect(response.status, await response.clone().text()).toBe(200);
  return restPluginInvocationSchema.parse(await response.json());
}

async function settingOf(name: string) {
  const detail = restPluginDetailSchema.parse(
    await (await h.request(pluginPath("chat"), { headers: { cookie: admin } })).json(),
  );
  return detail.settings.find((setting) => setting.key === name);
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugin-keyed-")), [
    { name: "console-plugin-chat", dir: CHAT_PLUGIN_DIR },
  ]);
  const logger = pino({ level: "info" }, { write: (line: string) => logged.push(line) });
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
  workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: NOW });
  const clock = { now: () => NOW };
  plugins = new Plugins({
    database: testDatabase.database,
    workspace: async () => workspace,
    host,
    discovery: await discoverPlugins(root),
    memoryMb: 64,
    secrets: createSecrets(SECRET),
    clock,
    logger,
    timeouts: { command: 5_000, query: 5_000, lifecycle: 5_000 },
    outbound: new Outbound({
      clock,
      logger,
      resolve: async () => ["93.184.216.34"],
      send: service,
    }),
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"], plugins });
  const enabled = await h.request(
    pluginPath("chat", "enable"),
    json({ consent: ["outbound:chat.example.test"], board: null, projects: "all" }, admin),
  );
  expect(enabled.status, await enabled.clone().text()).toBe(200);
}, 120_000);

afterAll(async () => {
  await plugins?.stop();
  await h?.close();
  await testDatabase?.drop();
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("a secret kept per key", () => {
  it("is sealed under the workspace the answer names, and put into a request by that key alone", async () => {
    const installed = await run(["install", "one"]);
    expect(installed.text).toBe("sealed");
    expect(installed.data).toEqual({
      ok: true,
      access_token: "[sealed]",
      team: { id: "T-one" },
      expires_in: 3600,
    });
    const posted = await run(["post", "T-one"]);
    expect(sent.at(-1)?.headers.authorization).toBe("Bearer xoxb-one-s3cret");
    // The service sent the token back; the plugin reads it withheld.
    expect(posted.data).toEqual({ authorization: "Bearer [withheld]" });
    const standing = await run(["standing", "T-one"]);
    expect(standing.data).toEqual({
      has: true,
      status: {
        set: true,
        setAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
        source: "chat.example.test",
      },
      unkeyed: false,
    });
    expect((await run(["standing", "T-nobody"])).data).toMatchObject({ has: false });
    const nobody = await h.request(
      pluginPath("chat", "invoke"),
      json({ argv: ["post", "T-nobody"] }, admin),
    );
    expect(restErrorSchema.parse(await nobody.json()).error.code).toBe("plugin.forbidden");
  });

  it("keeps as many keys as its bound, and seals none where the answer names no key", async () => {
    expect((await run(["install", "two"])).text).toBe("sealed");
    const past = await run(["install", "three"]);
    expect(past.text).toBe("too_many");
    expect(past.data).toMatchObject({ access_token: "[withheld]" });
    // A key it keeps already takes a value again.
    expect((await run(["install", "one"])).text).toBe("sealed");
    const bad = await run(["install", "bad"]);
    expect(bad.text).toBe("no_key");
    expect(bad.data).toMatchObject({ access_token: "[withheld]" });
    const keys = await run(["keys"]);
    expect(keys.data).toEqual([
      expect.objectContaining({ key: "T-one", set: true, source: "chat.example.test" }),
      expect.objectContaining({ key: "T-two", set: true, source: "chat.example.test" }),
    ]);
  });

  it("refuses a key where it keeps one value, no key where it keeps one per key, and signing", async () => {
    const tried = await run(["misuse"]);
    expect(tried.data).toEqual({
      fetchWithoutKey: "plugin.invalid_args",
      fetchWithKeyOfOne: "plugin.invalid_args",
      fetchWithBadKey: "plugin.invalid_args",
      sealWithoutKey: "plugin.invalid_args",
      sealOneUnderKey: "plugin.invalid_args",
      keysOfOne: "plugin.invalid_args",
      forgetWithoutKey: "plugin.invalid_args",
      sign: "plugin.forbidden",
    });
  });

  it("shows an administrator its keys and never a value, and is set and removed one key at a time", async () => {
    const shown = await settingOf("tokens");
    expect(shown).toMatchObject({
      set: true,
      keyed: { max: 2 },
      keys: [
        { key: "T-one", source: "chat.example.test" },
        { key: "T-two", source: "chat.example.test" },
      ],
    });
    expect(JSON.stringify(shown)).not.toContain("s3cret");
    expect((await settingOf("apiKey"))?.keys).toBeNull();
    const put = (path: readonly string[], value = "by-hand-s3cret") =>
      h.request(pluginPath("chat", "secrets", ...path), json({ value }, admin, "PUT"));
    const full = await put(["tokens", "keys", "T-three"]);
    expect(restErrorSchema.parse(await full.json()).error.code).toBe("plugin.too_many");
    const unkeyed = await put(["tokens"]);
    expect(restErrorSchema.parse(await unkeyed.json()).error.code).toBe("plugin.invalid_args");
    const badKey = await put(["tokens", "keys", "a b"]);
    expect(restErrorSchema.parse(await badKey.json()).error.code).toBe("plugin.invalid_args");
    const ofOne = await put(["apiKey", "keys", "T-one"]);
    expect(restErrorSchema.parse(await ofOne.json()).error.code).toBe("plugin.invalid_args");
    const removed = await h.request(pluginPath("chat", "secrets", "tokens", "keys", "T-two"), {
      ...json({}, admin, "DELETE"),
    });
    expect(removed.status).toBe(204);
    const again = await h.request(pluginPath("chat", "secrets", "tokens", "keys", "T-two"), {
      ...json({}, admin, "DELETE"),
    });
    expect(restErrorSchema.parse(await again.json()).error.code).toBe("plugin.not_found");
    expect((await put(["tokens", "keys", "T-three"])).status).toBe(204);
    expect((await settingOf("tokens"))?.keys).toEqual([
      expect.objectContaining({ key: "T-one", source: "chat.example.test" }),
      expect.objectContaining({ key: "T-three", source: "administrator", expiresAt: null }),
    ]);
    await run(["post", "T-three"]);
    expect(sent.at(-1)?.headers.authorization).toBe("Bearer by-hand-s3cret");
  });

  it("forgets a key where what it stood for is gone", async () => {
    expect((await run(["forget", "T-three"])).data).toBe(true);
    expect((await run(["forget", "T-three"])).data).toBe(false);
    expect((await run(["standing", "T-three"])).data).toMatchObject({ has: false });
  });

  it("moves the value kept from before the setting was keyed under a key, as it was sealed", async () => {
    // What a release before this one sealed as the setting's one value.
    const before = async (value: string) =>
      setSecret(testDatabase.database, {
        workspaceId: workspace.id,
        key: "chat",
        name: "tokens",
        sealed: createSecrets(SECRET).seal("plugin-secret", value),
        actor: { id: await meId() },
        now: new Date("2026-11-01T09:00:00.000Z"),
        boardProjectId: undefined,
        source: "chat.example.test",
      });
    await before("xoxb-before-s3cret");
    expect((await run(["standing", "T-old"])).data).toMatchObject({ has: false, unkeyed: true });
    expect((await run(["move", "T-old"])).data).toBe(true);
    expect((await run(["move", "T-old"])).data).toBe(false);
    expect((await run(["standing", "T-old"])).data).toEqual({
      has: true,
      status: {
        set: true,
        setAt: "2026-11-01T09:00:00.000Z",
        expiresAt: null,
        source: "chat.example.test",
      },
      unkeyed: false,
    });
    await run(["post", "T-old"]);
    expect(sent.at(-1)?.headers.authorization).toBe("Bearer xoxb-before-s3cret");
    // The bound holds: a key it does not keep, where it keeps two, takes nothing, and the value
    // stays where it was; a key it keeps takes it in place of its own.
    await before("xoxb-again-s3cret");
    const past = await h.request(
      pluginPath("chat", "invoke"),
      json({ argv: ["move", "T-new"] }, admin),
    );
    expect(restErrorSchema.parse(await past.json()).error.code).toBe("plugin.too_many");
    expect((await run(["standing", "T-new"])).data).toMatchObject({ has: false, unkeyed: true });
    expect((await run(["move", "T-one"])).data).toBe(true);
    await run(["post", "T-one"]);
    expect(sent.at(-1)?.headers.authorization).toBe("Bearer xoxb-again-s3cret");
  });

  it("is said in the feed with its key, and its value is in no event, no answer and no log line", async () => {
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("chat", "events"), { headers: { cookie: admin } })).json(),
    );
    const configured = events.items
      .filter((event) => event.kind === "plugin.configured" && event.data.fields !== undefined)
      .map((event) => [event.data.under, event.data.source ?? null]);
    expect(configured).toEqual(
      expect.arrayContaining([
        ["T-one", "chat.example.test"],
        ["T-three", "administrator"],
        ["T-two", null],
        ["T-old", null],
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("s3cret");
    expect(logged.join("\n")).not.toContain("s3cret");
  });

  it("goes with the plugin's purge", async () => {
    expect((await h.request(pluginPath("chat", "disable"), json({}, admin))).status).toBe(200);
    const purged = await h.request(pluginPath("chat", "purge"), json({ confirm: "chat" }, admin));
    expect(purged.status, await purged.clone().text()).toBe(204);
    const left = await drizzleOf(testDatabase.database)
      .select({ key: pluginKeyedSecrets.key })
      .from(pluginKeyedSecrets)
      .where(
        and(
          eq(pluginKeyedSecrets.workspaceId, workspace.id),
          eq(pluginKeyedSecrets.pluginKey, "chat"),
        ),
      );
    expect(left).toEqual([]);
  });
});

/** The administrator's id, by whom the value of before is said to be set. */
async function meId(): Promise<string> {
  const me = (await (await h.request("/api/v1/me", { headers: { cookie: admin } })).json()) as {
    person: { id: string };
  };
  return me.person.id;
}
