import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  pluginPath,
  projectPath,
  REST_ROUTES,
  restErrorSchema,
  restEventsSchema,
  restPluginDetailSchema,
  restPluginFileHandleSchema,
  restPluginInvocationSchema,
  restProjectRulesSchema,
  restRulesSchema,
  restSkillFindSchema,
  restSkillLoadSchema,
  restSkillsSchema,
} from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { createSecrets } from "../auth/secrets.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { RecordStore } from "../plugins/records.js";
import { Plugins } from "../plugins/registry.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  GATE_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  writePluginsDir,
} from "../testing/plugins.js";

// The way an agent works a plugin (docs/specs/plugins.md, "REST" and "The command"), against a
// real database and a real host: a command by the words as typed, parsed by the console against
// the definition; a command and a query by name; the endpoints, a person's and a webhook's with
// its signature; the plugins named after the rules; a plugin's skills as a pack of its own; and
// the run a command is written on. Needs PostgreSQL and the compiled host.

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let h: Harness;
let admin: string;
let member: string;
let bobId: string;
const AT = pluginPath("gate");

const json = (body: unknown, cookie: string, method = "POST"): RequestInit => ({
  method,
  headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Runs a command or a query by its words, as the command does. */
async function invoke(
  cookie: string,
  argv: readonly string[],
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return h.request(pluginPath("gate", "invoke"), json({ argv, ...extra }, cookie));
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugin-invoke-")), [
    { name: "console-plugin-gate", dir: GATE_PLUGIN_DIR },
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
  const me = (await (await h.request(REST_ROUTES.me, { headers: { cookie: member } })).json()) as {
    person: { id: string };
  };
  bobId = me.person.id;
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
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
    // A clock that stands still, so that the minute of the webhook bound never rolls over mid-test.
    clock: { now: () => new Date("2026-11-02T10:00:00.000Z") },
    logger,
    timeouts: { command: 5_000, query: 5_000, endpoint: 5_000, lifecycle: 5_000 },
    webhooksPerMinute: 2,
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"], plugins });
  // A project the plugin is not on, beside the board project the enabling makes.
  const elsewhere = await h.request(
    REST_ROUTES.projects,
    json({ key: "ops", name: "Operations", visibility: "workspace" }, admin),
  );
  expect(elsewhere.status).toBe(201);
  const enabled = await h.request(
    pluginPath("gate", "enable"),
    json(
      {
        consent: ["endpoints", "files"],
        board: {
          create: { key: "gate-board", name: "Gate board", description: "Where the gate decides." },
        },
        projects: ["gate-board"],
      },
      admin,
    ),
  );
  expect(enabled.status).toBe(200);
  const detail = restPluginDetailSchema.parse(await enabled.json());
  expect(detail.board?.key).toBe("gate-board");
  // The board project is private: bob is listed in it, so that he works there.
  const listed = await h.request(
    projectPath("gate-board", "members"),
    json({ personId: bobId, role: "member" }, admin),
  );
  expect(listed.status).toBe(201);
}, 120_000);

afterAll(async () => {
  await plugins?.stop();
  await h?.close();
  await testDatabase?.drop();
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("a command by the words as typed", () => {
  it("is parsed by the console against the definition: positionals, flags, lists, booleans, a person, a project", async () => {
    const response = await invoke(member, [
      "plan",
      "Fix the gate",
      "--when",
      "2026-11-02",
      "--count=3",
      "--tags",
      "a,b",
      "--tags",
      "c",
      "--urgent",
      "--kind",
      "small",
      "--who",
      "me",
      "--where",
      "gate-board",
      "--token",
      "hush",
    ]);
    expect(response.status).toBe(200);
    const result = restPluginInvocationSchema.parse(await response.json());
    expect(result.kind).toBe("command");
    expect(result.text).toBe("planned Fix the gate (urgent)");
    expect(result.waiting).toBeNull();
    const data = result.data as {
      args: Record<string, unknown>;
      caller: { kind: string; person: { login: string }; roles: string[] };
    };
    expect(data.args).toEqual({
      title: "Fix the gate",
      when: "2026-11-02",
      count: 3,
      tags: ["a", "b", "c"],
      urgent: true,
      kind: "small",
      who: { id: bobId, login: "bob", name: null },
      where: { id: expect.any(String), key: "gate-board", name: "Gate board" },
      token: "hush",
    });
    expect(data.caller).toMatchObject({
      kind: "person",
      person: { login: "bob" },
      roles: ["clerk"],
    });
    // The event: the command, its outcome, the arguments with the secret one hidden.
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("gate", "events"), { headers: { cookie: admin } })).json(),
    );
    const command = events.items.find((event) => event.kind === "plugin.command");
    expect(command?.data).toMatchObject({
      command: "plan",
      outcome: "ok",
      args: { title: "Fix the gate", token: "[hidden]", who: "me" },
    });
    expect(command?.runId).toBeNull();
  });

  it("refuses the first word that does not fit, naming it", async () => {
    const cases: [string[], string][] = [
      [["plan"], "title is required"],
      [["plan", "x", "y"], '"y" is one word too many: the command takes 1 positional argument'],
      [["plan", "x", "--nope", "1"], "--nope is not an argument of this command"],
      [["plan", "x", "--count", "three"], "count is not a number"],
      [["plan", "x", "--count", "11"], "count is above 10"],
      [["plan", "x", "--kind", "huge"], "kind is one of small, large"],
      [["plan", "x", "--when", "tomorrow"], "when is not a day as YYYY-MM-DD"],
      [["plan", "x", "--who", "nobody"], "who: no person nobody you may see"],
      [["plan", "x", "--where", "secret-ops"], "where: no project secret-ops you may see"],
      [["plan", "x", "--attachment", "not-a-handle"], "attachment: not a file you uploaded"],
      [["--plan"], "the first word names the command or the query"],
    ];
    for (const [argv, message] of cases) {
      const response = await invoke(member, argv);
      expect(response.status, argv.join(" ")).toBe(400);
      const refusal = restErrorSchema.parse(await response.json());
      expect(refusal.error.code).toBe("plugin.invalid_args");
      expect(refusal.error.message, argv.join(" ")).toContain(message);
    }
    const unknown = await invoke(member, ["nothing"]);
    expect(unknown.status).toBe(404);
    expect(restErrorSchema.parse(await unknown.json()).error.code).toBe("plugin.not_found");
    // A role the person does not hold; the administrator holds every role.
    const forbidden = await invoke(member, ["decide"]);
    expect(forbidden.status).toBe(403);
    expect(restErrorSchema.parse(await forbidden.json()).error.code).toBe("plugin.forbidden");
    const decided = await invoke(admin, ["decide"]);
    expect(decided.status).toBe(200);
    expect(restPluginInvocationSchema.parse(await decided.json()).text).toBe("decided");
    // A change needs the console's own pages, or a token.
    const elsewhere = await h.request(pluginPath("gate", "invoke"), {
      method: "POST",
      headers: { cookie: member, "content-type": "application/json" },
      body: JSON.stringify({ argv: ["plan", "x"] }),
    });
    expect(elsewhere.status).toBe(403);
  });

  it("says when the command waits for a decision, and writes the caller's open run on the event", async () => {
    // Bob takes a task in the board project: his one open run there is the command's.
    const task = await h.request(
      projectPath("gate-board", "tasks"),
      json({ title: "Open the gate" }, member),
    );
    expect(task.status).toBe(201);
    const { id: taskId } = (await task.json()) as { id: string };
    const run = await h.request(projectPath("gate-board", "runs"), json({ taskId }, member));
    expect(run.status).toBe(201);
    const { id: runId } = (await run.json()) as { id: string };
    const response = await invoke(member, ["wait"]);
    expect(response.status).toBe(200);
    const result = restPluginInvocationSchema.parse(await response.json());
    expect(result.waiting).toBe("0199c4d8-0000-7000-8000-0000000000d1");
    // What it names is no decision the caller reaches, so it waits in no project the console names.
    expect(result.project).toBeNull();
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("gate", "events"), { headers: { cookie: admin } })).json(),
    );
    const waited = events.items.find(
      (event) => event.kind === "plugin.command" && event.data.command === "wait",
    );
    expect(waited?.data.outcome).toBe("waiting");
    expect(waited?.runId).toBe(runId);
    // The run named must be the caller's; the caller sees their run through ctx.
    const wrong = await invoke(member, ["wait"], { run: "0199c4d8-0000-7000-8000-0000000000ee" });
    expect(wrong.status).toBe(400);
    const echoed = restPluginInvocationSchema.parse(
      await (await invoke(member, ["echo", "--n", "2"], { run: runId })).json(),
    );
    expect(echoed.kind).toBe("query");
    expect(echoed.data).toMatchObject({
      args: { n: 2 },
      caller: { run: { id: runId }, project: null },
      project: { key: "gate-board" },
    });
  });

  it("takes a file uploaded first, by its handle, for the caller who uploaded it", async () => {
    const form = new FormData();
    form.set("file", new File(["hello"], "notes.txt", { type: "text/plain" }), "notes.txt");
    const uploaded = await h.request(pluginPath("gate", "files"), {
      method: "POST",
      headers: { cookie: member, origin: SIGN_IN_URL },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const handle = restPluginFileHandleSchema.parse(await uploaded.json());
    expect(handle).toMatchObject({ name: "notes.txt", type: "text/plain", bytes: 5 });
    // Another person's handle is nobody else's.
    const notMine = await invoke(admin, ["plan", "x"], { files: [handle.handle] });
    expect(notMine.status).toBe(400);
    const planned = restPluginInvocationSchema.parse(
      await (await invoke(member, ["plan", "x"], { files: [handle.handle] })).json(),
    );
    expect((planned.data as { args: { attachment: unknown } }).args.attachment).toEqual(handle);
    const twice = await invoke(member, ["plan", "x"], { files: [handle.handle, handle.handle] });
    expect(restErrorSchema.parse(await twice.json()).error.message).toBe(
      "the command takes 1 file, not 2",
    );
  });

  it("runs a command by name with its arguments as JSON, and a query that answers JSON or a file", async () => {
    const byName = await h.request(
      pluginPath("gate", "commands", "plan"),
      json({ args: { title: "By name", urgent: true } }, member),
    );
    expect(byName.status).toBe(200);
    expect(restPluginInvocationSchema.parse(await byName.json()).text).toBe(
      "planned By name (urgent)",
    );
    const query = await h.request(
      `${pluginPath("gate", "queries", "echo")}?args=${encodeURIComponent(JSON.stringify({ n: 7 }))}`,
      { headers: { cookie: member } },
    );
    expect(query.status).toBe(200);
    expect(await query.json()).toMatchObject({ args: { n: 7 }, caller: { kind: "person" } });
    const file = await h.request(pluginPath("gate", "queries", "report"), {
      headers: { cookie: member },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(file.headers.get("content-disposition")).toBe('attachment; filename="report.csv"');
    expect(await file.text()).toBe("a,b\n1,2\n");
    // Through invoke, the same file travels as base64, for the command to save.
    const invoked = restPluginInvocationSchema.parse(
      await (await invoke(member, ["report"])).json(),
    );
    expect(invoked.data).toEqual({
      file: {
        name: "report.csv",
        type: "text/csv",
        bytes: 8,
        base64: Buffer.from("a,b\n1,2\n").toString("base64"),
      },
    });
    const badArgs = await h.request(`${pluginPath("gate", "queries", "echo")}?args=nope`, {
      headers: { cookie: member },
    });
    expect(badArgs.status).toBe(400);
  });
});

describe("an endpoint of the plugin", () => {
  it("takes a person's request with the headers the definition names, and refuses nobody", async () => {
    const response = await h.request(`${AT}/x/ping/deeper/path?a=1&b=2`, {
      method: "POST",
      headers: {
        cookie: member,
        origin: SIGN_IN_URL,
        "content-type": "text/plain",
        "x-note": "hello",
        "x-other": "dropped",
      },
      body: "the body",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      method: "POST",
      path: "/deeper/path",
      query: { a: "1", b: "2" },
      headers: { "content-type": "text/plain", "x-note": "hello" },
      body: "the body",
      caller: expect.objectContaining({ kind: "person", roles: ["clerk"] }),
    });
    const nobody = await h.request(`${AT}/x/ping`, { method: "GET" });
    expect(nobody.status).toBe(403);
    expect(restErrorSchema.parse(await nobody.json()).error.code).toBe("plugin.forbidden");
    const notAllowed = await h.request(`${AT}/x/ping`, {
      method: "DELETE",
      headers: { cookie: member, origin: SIGN_IN_URL },
    });
    expect(notAllowed.status).toBe(400);
    const unknown = await h.request(`${AT}/x/nothing`, { headers: { cookie: member } });
    expect(unknown.status).toBe(404);
    // Headers the contract does not allow are dropped, and the console's own hold.
    const leaky = await h.request(`${AT}/x/leaky`, { headers: { cookie: member } });
    expect(leaky.status).toBe(200);
    expect(leaky.headers.get("set-cookie")).toBeNull();
    expect(leaky.headers.get("content-type")).toBe("text/html");
    expect(leaky.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(await leaky.text()).toBe("<b>hi</b>");
  });

  it("takes a webhook as nobody, which the plugin verifies with a secret it never sees, within the bound", async () => {
    const sealed = await h.request(
      pluginPath("gate", "secrets", "signing"),
      json({ value: "shh" }, admin, "PUT"),
    );
    expect(sealed.status).toBe(204);
    const body = JSON.stringify({ event: "opened" });
    const signature = createHmac("sha256", "shh").update(body).digest("hex");
    const accepted = await h.request(`${AT}/x/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
    });
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("location")).toBe("/nowhere");
    expect(await accepted.json()).toEqual({
      ok: true,
      caller: "console",
      roles: ["clerk", "boss"],
    });
    const forged = await h.request(`${AT}/x/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "0".repeat(64) },
      body,
    });
    expect(forged.status).toBe(401);
    expect(await forged.text()).toBe("bad signature");
    // Two requests this minute were all the bound allows.
    const limited = await h.request(`${AT}/x/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
    });
    expect(limited.status).toBe(429);
    expect(restErrorSchema.parse(await limited.json()).error.code).toBe("plugin.rate_limited");
    const tooBig = await h.request(`${AT}/x/inbound`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(tooBig.status).toBe(413);
  });
});

describe("the plugins named after the rules", () => {
  it("are those bound to the project that the person holds a role in, and every one at the workspace", async () => {
    const board = restProjectRulesSchema.parse(
      await (
        await h.request(projectPath("gate-board", "rules"), { headers: { cookie: member } })
      ).json(),
    );
    expect(board.plugins).toEqual([
      {
        key: "gate",
        name: { en: "Gate" },
        agentNote: expect.objectContaining({ en: expect.stringContaining("plan") }),
        description: expect.any(Object),
        roles: ["clerk"],
      },
    ]);
    const ops = restProjectRulesSchema.parse(
      await (await h.request(projectPath("ops", "rules"), { headers: { cookie: member } })).json(),
    );
    expect(ops.plugins).toEqual([]);
    const workspace = restRulesSchema.parse(
      await (await h.request(REST_ROUTES.rules, { headers: { cookie: member } })).json(),
    );
    expect(workspace.plugins?.map((plugin) => plugin.key)).toEqual(["gate"]);
    expect(
      restRulesSchema.parse(
        await (await h.request(REST_ROUTES.rules, { headers: { cookie: admin } })).json(),
      ).plugins?.[0]?.roles,
    ).toEqual(["clerk", "boss"]);
  });
});

describe("a plugin's skills", () => {
  it("are a pack of their own, read from the package through the five reads", async () => {
    const listed = restSkillsSchema.parse(
      await (await h.request(pluginPath("gate", "skills"), { headers: { cookie: member } })).json(),
    );
    expect(listed.status).toBe("ready");
    expect(listed.address).toBe("/local/plugins/gate");
    expect(listed.source).toBeNull();
    expect(listed.items.map((skill) => [skill.name, skill.path, skill.uri])).toEqual([
      ["gate", "skills/gate/SKILL.md", "skill://local/plugins/gate/skills/gate/SKILL.md"],
    ]);
    const loaded = restSkillLoadSchema.parse(
      await (
        await h.request(`${pluginPath("gate", "skills", "one")}?path=skills%2Fgate%2FSKILL.md`, {
          headers: { cookie: member },
        })
      ).json(),
    );
    expect(loaded.status).toBe("ready");
    expect(loaded.read?.status === "ready" && loaded.read.skill.body).toContain(
      "console plugin gate plan",
    );
    const found = restSkillFindSchema.parse(
      await (
        await h.request(`${pluginPath("gate", "skills", "find")}?query=plan`, {
          headers: { cookie: member },
        })
      ).json(),
    );
    expect(found.status).toBe("ready");
    const missing = await h.request(
      `${pluginPath("gate", "skills", "one")}?path=nothing%2FSKILL.md`,
      {
        headers: { cookie: member },
      },
    );
    expect(restSkillLoadSchema.parse(await missing.json()).status).toBe("not_found");
    const unknown = await h.request(pluginPath("nothing", "skills"), {
      headers: { cookie: member },
    });
    expect(unknown.status).toBe(404);
  });
});
