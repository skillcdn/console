import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  pluginPath,
  REST_ROUTES,
  restErrorSchema,
  restEventsSchema,
  restPluginDetailSchema,
  restPluginGrantSchema,
  restPluginGrantsSchema,
  restPluginsSchema,
} from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecrets } from "../auth/secrets.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { Plugins } from "../plugins/registry.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  EVIL_PLUGIN_DIR,
  HELLO_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  writePluginsDir,
} from "../testing/plugins.js";

// The plugins' routes against a real database and a real host, with the example plugin and the
// fixture that tries everything: what a member sees, what an administrator does, and what is
// recorded. Needs PostgreSQL, the compiled host and the example plugin built.

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let h: Harness;
let admin: string;
let member: string;
const logs: Record<string, unknown>[] = [];

const json = (body: unknown, cookie: string): RequestInit => ({
  method: "POST",
  headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugins-rest-")), [
    { name: "console-plugin-hello", dir: HELLO_PLUGIN_DIR },
    { name: "console-plugin-evil", dir: EVIL_PLUGIN_DIR },
  ]);
  const logger = pino(
    { level: "info" },
    { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
  );
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
  // The harness makes the workspace on the first request; the registry reads it from the same row.
  admin = await h.signIn("alice");
  member = await h.signIn("bob");
  const { ensureWorkspace } = await import("../db/queries/workspaces.js");
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  plugins = new Plugins({
    database: testDatabase.database,
    workspace: async () => workspace,
    host,
    discovery: await discoverPlugins(root),
    memoryMb: 64,
    secrets: createSecrets("a secret for tests, long enough to be one"),
    clock: { now: () => new Date() },
    logger,
    timeouts: { command: 5_000, query: 5_000, lifecycle: 5_000 },
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  // The harness was made before the registry: a second one serves the same database with it.
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

describe("the plugins' routes", () => {
  it("list every plugin to an administrator, with its state, and nothing not enabled to a member", async () => {
    const asAdmin = restPluginsSchema.parse(
      await (await h.request(REST_ROUTES.plugins, { headers: { cookie: admin } })).json(),
    );
    expect(asAdmin.items.map((plugin) => [plugin.key, plugin.state])).toEqual([
      ["evil", "installed"],
      ["hello", "installed"],
    ]);
    expect(asAdmin.items[1]).toMatchObject({
      name: { en: "Hello" },
      roles: ["greeter"],
      declaredRoles: [{ key: "greeter" }],
      defaultRole: "greeter",
      menu: { group: "operations", order: 100, name: null },
      pages: [{ key: "greetings", level: "workspace", wide: false }],
      widgets: [{ key: "latest", place: "home:top", size: "third" }],
      consent: [],
      projects: [],
    });
    expect(asAdmin.sql).toBe(false);
    const asMember = restPluginsSchema.parse(
      await (await h.request(REST_ROUTES.plugins, { headers: { cookie: member } })).json(),
    );
    expect(asMember.items).toEqual([]);
    expect((await h.request(pluginPath("hello"), { headers: { cookie: member } })).status).toBe(
      404,
    );
    expect((await h.request(REST_ROUTES.plugins)).status).toBe(401);
  });

  it("refuses enabling to a member, from elsewhere, and without consent to every capability", async () => {
    const body = { consent: [], board: null, projects: "all" };
    expect((await h.request(pluginPath("hello", "enable"), json(body, member))).status).toBe(403);
    const elsewhere = await h.request(pluginPath("hello", "enable"), {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(elsewhere.status).toBe(403);
    expect(restErrorSchema.parse(await elsewhere.json()).error.code).toBe("auth.forbidden_origin");
    expect((await h.request(pluginPath("nobody", "enable"), json(body, admin))).status).toBe(404);
    // The example asks no capability; a manifest that did would refuse until named.
    const consentless = await h.request(
      pluginPath("hello", "enable"),
      json({ ...body, consent: ["files"] }, admin),
    );
    expect(consentless.status).toBe(400);
    expect(restErrorSchema.parse(await consentless.json()).error.code).toBe("plugin.invalid_args");
  });

  it("enables a plugin, which a member then sees with their default role, and records it", async () => {
    const enabled = await h.request(
      pluginPath("hello", "enable"),
      json({ consent: [], board: null, projects: "all", settings: { greeting: "Hi" } }, admin),
    );
    expect(enabled.status).toBe(200);
    const detail = restPluginDetailSchema.parse(await enabled.json());
    expect(detail.state).toBe("enabled");
    expect(detail.operations.map((operation) => `${operation.kind} ${operation.name}`)).toEqual([
      "command greet",
      "query latest",
    ]);
    expect(detail.settings).toEqual([
      expect.objectContaining({
        key: "greeting",
        type: "text",
        set: true,
        value: "Hi",
        default: "Hello",
      }),
    ]);
    expect(detail.grants).toEqual([]);
    expect(detail.events).toBe("/api/v1/plugins/hello/events");

    const asMember = restPluginDetailSchema.parse(
      await (await h.request(pluginPath("hello"), { headers: { cookie: member } })).json(),
    );
    expect(asMember.roles).toEqual(["greeter"]);
    expect(asMember.consent).toBeNull();
    expect(asMember.grants).toBeNull();
    expect(asMember.settings[0]).toMatchObject({ key: "greeting", set: true, value: null });

    const events = restEventsSchema.parse(
      await (
        await h.request(`${pluginPath("hello", "events")}`, { headers: { cookie: admin } })
      ).json(),
    );
    expect(events.items.map((event) => [event.kind, event.plugin])).toEqual([
      ["plugin.enabled", "hello"],
    ]);
    expect(events.items[0]?.data).toMatchObject({ key: "hello", name: "Hello", capabilities: [] });
  });

  it("refuses a setting that does not fit, and changes one that does", async () => {
    const bad = await h.request(pluginPath("hello", "settings"), {
      ...json({ values: { greeting: 3 } }, admin),
      method: "PATCH",
    });
    expect(bad.status).toBe(400);
    expect(restErrorSchema.parse(await bad.json()).error.code).toBe("plugin.invalid_args");
    const unknown = await h.request(pluginPath("hello", "settings"), {
      ...json({ values: { colour: "red" } }, admin),
      method: "PATCH",
    });
    expect(unknown.status).toBe(400);
    const good = await h.request(pluginPath("hello", "settings"), {
      ...json({ values: { greeting: "Hey" } }, admin),
      method: "PATCH",
    });
    expect(good.status).toBe(200);
    expect(restPluginDetailSchema.parse(await good.json()).settings[0]?.value).toBe("Hey");
  });

  it("runs a command as a person through the registry, with the settings and the roles, and leaves its event", async () => {
    const { findPerson } = await import("../db/queries/people.js");
    const { ensureWorkspace } = await import("../db/queries/workspaces.js");
    const workspace = await ensureWorkspace(testDatabase.database, {
      name: "Acme",
      now: new Date(),
    });
    const me = await (await h.request(REST_ROUTES.me, { headers: { cookie: member } })).json();
    const personId = (me as { person: { id: string } }).person.id;
    const person = await findPerson(testDatabase.database, workspace.id, personId);
    if (person === undefined) {
      throw new Error("bob is not a person");
    }
    const invoker = {
      person,
      actor: { id: person.id },
      agent: undefined,
      run: undefined,
      project: undefined,
      language: "ko",
    };
    // The record store is not built: the command reaches for it and is told so, and the event says it failed.
    await expect(
      plugins.invoke("hello", "command", "greet", { to: "world" }, invoker),
    ).rejects.toMatchObject({ code: "plugin.unavailable" });
    await expect(
      plugins.invoke("hello", "command", "greet", { to: 3 }, invoker),
    ).rejects.toMatchObject({ code: "plugin.invalid_args" });
    await expect(plugins.invoke("hello", "command", "nothing", {}, invoker)).rejects.toMatchObject({
      code: "plugin.not_found",
    });
    await expect(plugins.invoke("evil", "command", "ok", {}, invoker)).rejects.toMatchObject({
      code: "plugin.disabled",
    });
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("hello", "events"), { headers: { cookie: admin } })).json(),
    );
    const command = events.items.find((event) => event.kind === "plugin.command");
    expect(command?.data).toMatchObject({
      command: "greet",
      outcome: "failed",
      code: "plugin.unavailable",
      args: { to: "world" },
    });
    expect(command?.actor?.login).toBe("bob");
  });

  it("grants a role, which a person then holds, and takes it back", async () => {
    const enabled = await h.request(
      pluginPath("evil", "enable"),
      json({ consent: [], board: null, projects: "all" }, admin),
    );
    expect(enabled.status).toBe(200);
    expect(
      restPluginDetailSchema.parse(
        await (await h.request(pluginPath("evil"), { headers: { cookie: member } })).json(),
      ).roles,
    ).toEqual([]);
    const bad = await h.request(
      pluginPath("hello", "grants"),
      json({ role: "boss", everyone: true }, admin),
    );
    expect(bad.status).toBe(400);
    // To a plugin, by key (ADR-0072): one that is installed, and never the plugin itself.
    const toPlugin = await h.request(
      pluginPath("hello", "grants"),
      json({ role: "greeter", plugin: "evil" }, admin),
    );
    expect(toPlugin.status).toBe(201);
    expect(restPluginGrantSchema.parse(await toPlugin.json())).toMatchObject({
      role: "greeter",
      plugin: "evil",
      person: null,
      everyone: false,
    });
    for (const plugin of ["hello", "nobody"]) {
      const refused = await h.request(
        pluginPath("hello", "grants"),
        json({ role: "greeter", plugin }, admin),
      );
      expect(refused.status, plugin).toBe(400);
    }
    const me = (await (
      await h.request(REST_ROUTES.me, { headers: { cookie: member } })
    ).json()) as { person: { id: string } };
    // To a team (ADR-0073), by its key (ADR-0074): whoever is in it holds the role, as the
    // membership stands.
    const teamMade = await h.request(
      REST_ROUTES.teams,
      json({ key: "greeters", name: "Greeters" }, admin),
    );
    expect(teamMade.status, await teamMade.clone().text()).toBe(201);
    const toTeam = await h.request(
      pluginPath("hello", "grants"),
      json({ role: "greeter", team: "greeters" }, admin),
    );
    expect(toTeam.status).toBe(201);
    expect(restPluginGrantSchema.parse(await toTeam.json())).toMatchObject({
      role: "greeter",
      team: { key: "greeters", name: "Greeters" },
    });
    // Whoever is in the team holds the role as the membership stands: plugin-board.int.test.ts
    // shows it on a role that is not everyone's; greeter is hello's default role.
    const granted = await h.request(
      pluginPath("hello", "grants"),
      json({ role: "greeter", person: me.person.id }, admin),
    );
    expect(granted.status).toBe(201);
    const grant = restPluginGrantSchema.parse(await granted.json());
    expect(grant).toMatchObject({
      role: "greeter",
      person: { login: "bob" },
      project: null,
      everyone: false,
    });
    const again = await h.request(
      pluginPath("hello", "grants"),
      json({ role: "greeter", person: me.person.id }, admin),
    );
    expect(again.status).toBe(409);
    const listed = await h.request(pluginPath("hello", "grants"), { headers: { cookie: admin } });
    expect(restPluginGrantsSchema.parse(await listed.json()).items).toHaveLength(3);
    const revoked = await h.request(pluginPath("hello", "grants", grant.id), {
      method: "DELETE",
      headers: { cookie: admin, origin: SIGN_IN_URL },
    });
    expect(revoked.status).toBe(200);
    expect(
      (
        await h.request(pluginPath("hello", "grants", grant.id), {
          method: "DELETE",
          headers: { cookie: admin, origin: SIGN_IN_URL },
        })
      ).status,
    ).toBe(404);
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("hello", "events"), { headers: { cookie: admin } })).json(),
    );
    expect(
      events.items
        .filter((event) => event.kind === "plugin.granted" || event.kind === "plugin.revoked")
        .map((event) => event.data),
    ).toEqual([
      expect.objectContaining({ role: "greeter", login: "bob", everyone: false }),
      expect.objectContaining({ role: "greeter", login: "bob", everyone: false }),
      expect.objectContaining({ role: "greeter", team: "Greeters", everyone: false }),
      expect.objectContaining({ role: "greeter", grantee: "evil", everyone: false }),
    ]);
  });

  it("keeps a secret sealed, never shown, and signs with it for the plugin", async () => {
    const notASecret = await h.request(pluginPath("hello", "secrets", "greeting"), {
      ...json({ value: "x" }, admin),
      method: "PUT",
    });
    expect(notASecret.status).toBe(400);
    // The evil fixture declares no secret setting either; the registry refuses what the manifest does not name.
    const unknown = await h.request(pluginPath("evil", "secrets", "token"), {
      ...json({ value: "x" }, admin),
      method: "PUT",
    });
    expect(unknown.status).toBe(400);
    expect(restErrorSchema.parse(await unknown.json()).error.code).toBe("plugin.invalid_args");
  });

  it("disables a plugin, after which a member sees it no more and its commands are refused", async () => {
    const disabled = await h.request(pluginPath("hello", "disable"), json({}, admin));
    expect(disabled.status).toBe(200);
    expect(restPluginDetailSchema.parse(await disabled.json()).state).toBe("disabled");
    expect((await h.request(pluginPath("hello"), { headers: { cookie: member } })).status).toBe(
      404,
    );
    const again = await h.request(pluginPath("hello", "disable"), json({}, admin));
    expect(again.status).toBe(409);
    expect(restErrorSchema.parse(await again.json()).error.code).toBe("plugin.disabled");
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("hello", "events"), { headers: { cookie: admin } })).json(),
    );
    expect(events.items.map((event) => event.kind)).toContain("plugin.disabled");
    expect(logs.some((line) => line.plugin === "hello" && line.msg === "plugin disabled")).toBe(
      true,
    );
  });

  it("takes away with a purged plugin the roles it held in other plugins, and says so where they were (ADR-0072)", async () => {
    // evil holds hello's greeter from the grants above; purged, it holds nothing, so that a package
    // installed later under its key would hold nothing it was not granted.
    const before = restPluginGrantsSchema.parse(
      await (await h.request(pluginPath("hello", "grants"), { headers: { cookie: admin } })).json(),
    );
    expect(before.items.some((grant) => grant.plugin === "evil")).toBe(true);
    expect((await h.request(pluginPath("evil", "disable"), json({}, admin))).status).toBe(200);
    const purged = await h.request(pluginPath("evil", "purge"), json({ confirm: "evil" }, admin));
    expect(purged.status, await purged.clone().text()).toBe(204);
    const after = restPluginGrantsSchema.parse(
      await (await h.request(pluginPath("hello", "grants"), { headers: { cookie: admin } })).json(),
    );
    expect(after.items.some((grant) => grant.plugin === "evil")).toBe(false);
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("hello", "events"), { headers: { cookie: admin } })).json(),
    );
    expect(events.items[0]).toMatchObject({
      kind: "plugin.revoked",
      data: expect.objectContaining({ role: "greeter", grantee: "evil" }),
    });
  });
});
