import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  pluginPath,
  projectPath,
  REST_ROUTES,
  restDecisionSchema,
  restDocumentSchema,
  restErrorSchema,
  restEventsSchema,
  restPluginDetailSchema,
  restPluginEventsSchema,
  restPluginInvocationSchema,
  restPluginRecordSchema,
  restTasksSchema,
} from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { createSecrets } from "../auth/secrets.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginDispatcher } from "../plugins/dispatcher.js";
import { PluginHost } from "../plugins/host.js";
import { Outbound, type OutboundSend } from "../plugins/outbound.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { RecordStore } from "../plugins/records.js";
import { Plugins } from "../plugins/registry.js";
import { PluginScheduler } from "../plugins/scheduler.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  AUDIT_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  LEAVE_PLUGIN_DIR,
  writePluginsDir,
} from "../testing/plugins.js";

// A plugin on the board, end to end (ADR-0052, docs/specs/plugins.md, "The board", "Events,
// hooks and jobs", "Between plugins"): a leave request kept as a record, its approval a decision
// raised in the board project, a person's answer reaching the plugin through a hook, the record
// updated and an event of the plugin's own emitted, which a second plugin on the same board hears
// and leaves a task for; what each plugin may read and change of the other's; the pages under its
// folder; the people and the workspace as the caller sees them; an outbound request with the
// secret put in by the console; a call from one plugin to another's api; the jobs on their
// schedule, with a failure told once an hour. Needs PostgreSQL and the compiled host.

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let dispatcher: PluginDispatcher;
let scheduler: PluginScheduler;
let h: Harness;
let admin: string;
let member: string;
let bobId: string;
let aliceId: string;
let aliceLogin: string;
const sent: Parameters<OutboundSend>[0][] = [];
let schedulerNow = new Date("2026-11-02T09:00:00.000Z");
const BOARD = "leave-board";

const json = (body: unknown, cookie: string, method = "POST"): RequestInit => ({
  method,
  headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function invoke(key: string, cookie: string, argv: readonly string[]): Promise<Response> {
  return h.request(pluginPath(key, "invoke"), json({ argv }, cookie));
}

async function invoked(key: string, cookie: string, argv: readonly string[]) {
  const response = await invoke(key, cookie, argv);
  expect(response.status, await response.clone().text()).toBe(200);
  return restPluginInvocationSchema.parse(await response.json());
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugin-board-")), [
    { name: "console-plugin-leave", dir: LEAVE_PLUGIN_DIR },
    { name: "console-plugin-audit", dir: AUDIT_PLUGIN_DIR },
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
  const me = async (cookie: string) =>
    (
      (await (await h.request(REST_ROUTES.me, { headers: { cookie } })).json()) as {
        person: { id: string; login: string };
      }
    ).person;
  bobId = (await me(member)).id;
  const alice = await me(admin);
  aliceId = alice.id;
  aliceLogin = alice.login;
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  const clock = { now: () => new Date() };
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
      clock,
      fileBytesAtMost: undefined,
    }),
    outbound: new Outbound({
      clock,
      logger,
      resolve: async () => ["93.184.216.34"],
      send: async (input) => {
        sent.push(input);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          bytes: new TextEncoder().encode(JSON.stringify({ pong: true })),
        };
      },
    }),
    clock,
    logger,
    timeouts: { command: 10_000, query: 5_000, hook: 10_000, job: 10_000, lifecycle: 5_000 },
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  dispatcher = new PluginDispatcher({
    database: testDatabase.database,
    workspace: async () => workspace,
    plugins,
    clock,
    logger,
    retries: 2,
    backoffMs: () => 0,
  });
  scheduler = new PluginScheduler({
    database: testDatabase.database,
    workspace: async () => workspace,
    plugins,
    clock: { now: () => schedulerNow },
    logger,
  });
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"], plugins });
  const leave = await h.request(
    pluginPath("leave", "enable"),
    json(
      {
        consent: [
          "board:read",
          "board:tasks",
          "board:decisions",
          "board:documents",
          "events:console",
          "jobs",
          "people:read",
          "people:read:all",
          "outbound:api.example.test",
        ],
        board: { create: { key: BOARD, name: "Leave", description: "Leave and its approval." } },
        projects: [BOARD],
      },
      admin,
    ),
  );
  expect(leave.status, await leave.clone().text()).toBe(200);
  expect(restPluginDetailSchema.parse(await leave.json()).board?.key).toBe(BOARD);
  const sealed = await h.request(
    pluginPath("leave", "secrets", "apiToken"),
    json({ value: "t0k3n" }, admin, "PUT"),
  );
  expect(sealed.status).toBe(204);
  // The board project is private: bob is listed in it, so that he requests there.
  const listed = await h.request(
    projectPath(BOARD, "members"),
    json({ personId: bobId, role: "member" }, admin),
  );
  expect(listed.status).toBe(201);
  const audit = await h.request(
    pluginPath("audit", "enable"),
    json(
      {
        consent: ["board:read", "board:tasks", "events:plugins", "plugins:leave"],
        board: { project: BOARD },
        projects: [BOARD],
      },
      admin,
    ),
  );
  expect(audit.status, await audit.clone().text()).toBe(200);
}, 120_000);

afterAll(async () => {
  await dispatcher?.close();
  await scheduler?.close();
  await plugins?.stop();
  await h?.close();
  await testDatabase?.drop();
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("a plugin on the board", () => {
  it("raises a decision for a request, hears the answer through a hook, updates its record and tells the other plugin", async () => {
    const requested = await invoked("leave", member, [
      "request",
      "--from",
      "2026-11-03",
      "--to",
      "2026-11-04",
      "--approver",
      "alice",
    ]);
    expect(requested.text).toContain("requested");
    const decisionId = requested.waiting;
    expect(decisionId).not.toBeNull();
    const { record } = requested.data as { record: { id: string; data: { state: string } } };
    expect(record.data.state).toBe("requested");
    // The decision is one of the board project's, for alice, raised through the plugin.
    const raised = restDecisionSchema.parse(
      await (
        await h.request(projectPath(BOARD, "decisions", decisionId ?? ""), {
          headers: { cookie: admin },
        })
      ).json(),
    );
    expect(raised.decider.id).toBe(aliceId);
    expect(raised.raisedBy.id).toBe(bobId);
    expect(raised.plugin).toBe("leave");
    // The options carry the keys the plugin gave them, by which it reads the answer.
    expect(raised.options.map((option) => [option.label, option.key])).toEqual([
      ["Approve", "approve"],
      ["Reject", "reject"],
    ]);
    // Alice approves, on the board as any decision is answered.
    const answered = await h.request(
      `${projectPath(BOARD, "decisions", decisionId ?? "")}/answer`,
      json({ option: "1" }, admin),
    );
    expect(answered.status, await answered.clone().text()).toBe(200);
    // The dispatcher delivers the console's event to leave's hook, and leave's event to audit's.
    await dispatcher.dispatch();
    await dispatcher.dispatch();
    const approved = restPluginRecordSchema.parse(
      await (
        await h.request(pluginPath("leave", "records", "requests", record.id), {
          headers: { cookie: member },
        })
      ).json(),
    );
    expect(approved.data.state).toBe("approved");
    expect(approved.data.decisionId).toBe(decisionId);
    const emitted = restPluginEventsSchema.parse(
      await (
        await h.request(pluginPath("leave", "plugin-events"), { headers: { cookie: member } })
      ).json(),
    );
    expect(emitted.items.map((event) => event.kind)).toEqual(["decided"]);
    expect(emitted.items[0]?.data).toMatchObject({
      requestId: record.id,
      state: "approved",
      by: { login: aliceLogin },
    });
    const tasks = restTasksSchema.parse(
      await (await h.request(projectPath(BOARD, "tasks"), { headers: { cookie: admin } })).json(),
    );
    const audited = tasks.items.find((task) => task.title.startsWith("Audit "));
    expect(audited).toMatchObject({ title: `Audit ${record.id}: approved`, plugin: "audit" });
    // The feed names the plugins beside the people.
    const feed = restEventsSchema.parse(
      await (
        await h.request(`${projectPath(BOARD, "events")}?after=0`, { headers: { cookie: admin } })
      ).json(),
    );
    expect(feed.items.map((event) => [event.kind, event.plugin])).toEqual(
      expect.arrayContaining([
        ["decision.raised", "leave"],
        ["decision.answered", null],
        ["task.created", "audit"],
      ]),
    );
    // The answered event names the option by its label and by the key the plugin gave it.
    expect(feed.items.find((event) => event.kind === "decision.answered")?.data).toMatchObject({
      option: "Approve",
      optionKey: "approve",
    });
    // A second pass delivers nothing twice: the cursor moved on.
    await dispatcher.dispatch();
    const again = restTasksSchema.parse(
      await (await h.request(projectPath(BOARD, "tasks"), { headers: { cookie: admin } })).json(),
    );
    expect(again.items.filter((task) => task.title.startsWith("Audit ")).length).toBe(1);
  });

  it("changes, comments on and reads its own items; another plugin reads them and may not change them", async () => {
    const made = await invoked("leave", member, ["task", "Fix the leave form"]);
    const { task } = made.data as { task: { number: number; plugin: string; priority: string } };
    expect(task.plugin).toBe("leave");
    expect(task.priority).toBe("high");
    const read = await invoked("audit", member, ["read", "--number", String(task.number)]);
    expect(read.text).toBe("Fix the leave form");
    const meddled = await invoke("audit", member, ["meddle", "--number", String(task.number)]);
    expect(meddled.status).toBe(403);
    expect(restErrorSchema.parse(await meddled.json()).error).toMatchObject({
      code: "plugin.forbidden",
      message: expect.stringContaining("not the plugin's own"),
    });
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("leave", "events"), { headers: { cookie: admin } })).json(),
    );
    expect(events.items.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["task.created", "task.commented", "task.updated"]),
    );
    expect(events.items.find((event) => event.kind === "task.created")?.actor?.login).toBe("bob");
  });

  it("writes pages under its folder alone, and reads the people, the workspace and not the projects", async () => {
    const paged = await invoked("leave", member, ["page"]);
    const { own, elsewhere } = paged.data as {
      own: { path: string; plugin: string };
      elsewhere: string;
    };
    expect(own.path).toBe("plugins/leave/notes");
    expect(own.plugin).toBe("leave");
    expect(elsewhere).toBe("plugin.forbidden");
    const page = restDocumentSchema.parse(
      await (
        await h.request(projectPath(BOARD, "docs", "plugins/leave/notes"), {
          headers: { cookie: admin },
        })
      ).json(),
    );
    expect(page.plugin).toBe("leave");
    expect(page.updatedBy.login).toBe("bob");
    const seen = await invoked("leave", member, ["people"]);
    const data = seen.data as {
      people: string[];
      projects: string;
      workspace: { name: string; timeZone: string; languages: string[] };
    };
    expect(data.people).toEqual(expect.arrayContaining([aliceLogin, "bob"]));
    expect(data.projects).toBe("plugin.forbidden");
    expect(data.workspace).toMatchObject({
      name: "Acme",
      timeZone: "UTC",
      languages: ["en", "ko"],
    });
  });

  it("makes outbound requests to the host declared, the secret put in by the console, and to no other", async () => {
    const probed = await invoked("leave", member, ["probe"]);
    expect(probed.data).toMatchObject({
      status: 200,
      body: { pong: true },
      headers: { "content-type": "application/json" },
      elsewhere: "plugin.forbidden",
    });
    expect(sent).toHaveLength(1);
    const request = sent[0];
    expect(request?.url.href).toBe("https://api.example.test/ping?x=1");
    expect(request?.address).toBe("93.184.216.34");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ "content-type": "application/json", "x-token": "t0k3n" });
    expect(new TextDecoder().decode(request?.body)).toBe('{"hello":"there"}');
  });

  it("calls another plugin's api as the caller, with the callee's roles, and only with the capability", async () => {
    const peeked = await invoked("audit", member, ["peek", "--person", bobId]);
    expect(peeked.text).toBe("12");
    expect(peeked.data).toMatchObject({
      version: "0.0.1",
      balance: { personId: bobId, days: 12, caller: "person", roles: ["employee"] },
    });
    const refused = await invoke("audit", member, ["nothing"]);
    expect(refused.status).toBe(403);
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.forbidden");
    // Leave is required by audit: it is not disabled while audit is enabled.
    const held = await h.request(pluginPath("leave", "disable"), json({}, admin));
    expect(held.status).toBe(409);
    expect(restErrorSchema.parse(await held.json()).error.code).toBe("plugin.required_by");
  });

  it("hears of the workspace's people with people:read:all: who was deactivated, by login", async () => {
    const carol = await h.signIn("carol");
    const carolId = (
      (await (await h.request(REST_ROUTES.me, { headers: { cookie: carol } })).json()) as {
        person: { id: string };
      }
    ).person.id;
    const gone = await h.request(
      `${REST_ROUTES.people}/${carolId}`,
      json({ status: "deactivated" }, admin, "PATCH"),
    );
    expect(gone.status, await gone.clone().text()).toBe(200);
    // The event is the workspace's, in no project; the plugin reads the directory, so it is told.
    await dispatcher.dispatch();
    const emitted = restPluginEventsSchema.parse(
      await (
        await h.request(pluginPath("leave", "plugin-events"), { headers: { cookie: member } })
      ).json(),
    );
    expect(emitted.items.find((event) => event.kind === "left")?.data).toEqual({ login: "carol" });
  });

  it("runs the jobs on their schedule, and tells a failure once an hour", async () => {
    // Seen for the first time: the first run is one period from now.
    await scheduler.tick();
    schedulerNow = new Date(schedulerNow.getTime() + 6 * 60_000);
    await scheduler.tick();
    const accrual = await h.request(projectPath(BOARD, "docs", "plugins/leave/accrual"), {
      headers: { cookie: admin },
    });
    expect(accrual.status).toBe(200);
    const page = restDocumentSchema.parse(await accrual.json());
    expect(page.body).toContain("as console");
    expect(page.plugin).toBe("leave");
    expect(page.updatedBy.login).toBe(aliceLogin);
    const failed = () =>
      h
        .request(pluginPath("leave", "events"), { headers: { cookie: admin } })
        .then(async (response) =>
          restEventsSchema
            .parse(await response.json())
            .items.filter((event) => event.kind === "plugin.failed"),
        );
    const once = await failed();
    expect(once).toHaveLength(1);
    expect(once[0]?.data.problem).toContain("the job broken failed");
    // Due again, and failing again: a line in the log, and no second event within the hour.
    schedulerNow = new Date(schedulerNow.getTime() + 6 * 60_000);
    await scheduler.tick();
    expect(await failed()).toHaveLength(1);
    schedulerNow = new Date(schedulerNow.getTime() + 61 * 60_000);
    await scheduler.tick();
    expect(await failed()).toHaveLength(2);
  });
});
