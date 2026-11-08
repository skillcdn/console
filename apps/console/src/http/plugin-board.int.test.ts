import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  decisionPath,
  pluginPath,
  projectPath,
  REST_ROUTES,
  restDecisionSchema,
  restDocumentSchema,
  restErrorSchema,
  restEventsSchema,
  restMyDecisionsSchema,
  restPeopleSchema,
  restPluginDetailSchema,
  restPluginEventsSchema,
  restPluginGrantSchema,
  restPluginInvocationSchema,
  restPluginRecordSchema,
  restReachedDecisionSchema,
  restTasksSchema,
  restWorkSchema,
} from "@skillcdn/console/api";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { createSecrets } from "../auth/secrets.js";
import { drizzleOf } from "../db/client.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { pluginInstalls } from "../db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginDispatcher } from "../plugins/dispatcher.js";
import { PluginHost } from "../plugins/host.js";
import { Outbound, type OutboundAnswer, type OutboundSend } from "../plugins/outbound.js";
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
/** The number of the task the audit plugin's hook left, read again by a later test. */
let auditedNumber: number | undefined;
const sent: Parameters<OutboundSend>[0][] = [];
/** What the fake host answers, by path; a pong otherwise. */
const answers = new Map<string, unknown>();
/** What the fake host answers that is no JSON, by path: its type and its body. */
const bodies = new Map<string, { readonly type: string; readonly body: string }>();

/**
 * The fake host: `/echo` answers with the request it received, as a server answering TRACE
 * does, its authorization in a header too; `/redirect` sends the client to the URL it was asked
 * for; a path in `bodies` answers that body, and any other the JSON in `answers`.
 */
function answerOf(input: Parameters<OutboundSend>[0]): OutboundAnswer {
  const encode = (text: string) => new TextEncoder().encode(text);
  if (input.url.pathname === "/echo") {
    return {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-echo-authorization": input.headers.authorization ?? "",
      },
      bytes: encode(
        JSON.stringify({
          url: input.url.href,
          headers: input.headers,
          body: input.body === undefined ? null : new TextDecoder().decode(input.body),
        }),
      ),
    };
  }
  if (input.url.pathname === "/redirect") {
    return { status: 302, headers: { location: input.url.href }, bytes: new Uint8Array(0) };
  }
  const raw = bodies.get(input.url.pathname);
  return {
    status: 200,
    headers: { "content-type": raw?.type ?? "application/json" },
    bytes: encode(raw?.body ?? JSON.stringify(answers.get(input.url.pathname) ?? { pong: true })),
  };
}
/** How far ahead of the machine the console's clock stands, to see a secret expire. */
let skewMs = 0;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pictured: string[] = [];
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
  const clock = { now: () => new Date(Date.now() + skewMs) };
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
        return answerOf(input);
      },
    }),
    clock,
    logger,
    timeouts: { command: 10_000, query: 5_000, hook: 10_000, job: 10_000, lifecycle: 5_000 },
    publicUrl: SIGN_IN_URL,
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
  h = createHarness(testDatabase, {
    providers: [provider],
    admins: ["alice"],
    plugins,
    pictures: {
      async fetch(request) {
        pictured.push(request.url);
        return {
          kind: "picture",
          bytes: PNG,
          contentType: "image/png",
          etag: '"v1"',
          lastModified: undefined,
        };
      },
    },
  });
  // A second project the plugin is placed on, beside its board (ADR-0080): a call on it asks there.
  const elsewhere = await h.request(
    REST_ROUTES.projects,
    json({ key: "leave-elsewhere", name: "Elsewhere", visibility: "workspace" }, admin),
  );
  expect(elsewhere.status, await elsewhere.clone().text()).toBe(201);
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
        projects: [BOARD, "leave-elsewhere"],
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
        consent: ["board:read", "board:tasks", "events:plugins", "plugins:leave", "people:act"],
        board: { project: BOARD },
        projects: [BOARD],
      },
      admin,
    ),
  );
  expect(audit.status, await audit.clone().text()).toBe(200);
  // Audit holds Leave's approver role as a plugin (ADR-0072), to read every request as itself.
  const held = await h.request(
    pluginPath("leave", "grants"),
    json({ role: "approver", plugin: "audit" }, admin),
  );
  expect(held.status, await held.clone().text()).toBe(201);
  expect(restPluginGrantSchema.parse(await held.json())).toMatchObject({
    role: "approver",
    plugin: "audit",
    person: null,
    everyone: false,
  });
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

describe("what a plugin reads of the people (ADR-0063)", () => {
  it("tells it who was granted a role, an administrator only where they were", async () => {
    const asked = (role: string) => invoked("leave", member, ["granted", "--role", role]);
    // The default role is everyone's; no one has been given the other yet, and holding every role
    // does not make an administrator someone to address.
    expect((await asked("employee")).data).toEqual(expect.arrayContaining([aliceLogin, "bob"]));
    expect((await asked("approver")).data).toEqual([]);
    const granted = await h.request(
      pluginPath("leave", "grants"),
      json({ role: "approver", person: bobId }, admin),
    );
    expect(granted.status, await granted.clone().text()).toBe(201);
    expect((await asked("approver")).data).toEqual(["bob"]);
    const revoke = async (response: Response) => {
      const { id } = restPluginGrantSchema.parse(await response.json());
      const away = await h.request(pluginPath("leave", "grants", id), {
        method: "DELETE",
        headers: { cookie: admin, origin: SIGN_IN_URL },
      });
      expect(away.status).toBe(200);
    };
    await revoke(granted);
    expect((await asked("approver")).data).toEqual([]);
    // A role granted to a team (ADR-0073), named by its key (ADR-0074), is held by whoever is in
    // it, as the membership stands; a key no team has is refused.
    const crew = await h.request(
      REST_ROUTES.teams,
      json({ key: "approvers", name: "Approvers" }, admin),
    );
    expect(crew.status, await crew.clone().text()).toBe(201);
    const crewId = "approvers";
    expect(
      (
        await h.request(
          pluginPath("leave", "grants"),
          json({ role: "approver", team: "nobody-here" }, admin),
        )
      ).status,
    ).toBe(400);
    const toCrew = await h.request(
      pluginPath("leave", "grants"),
      json({ role: "approver", team: crewId }, admin),
    );
    expect(toCrew.status, await toCrew.clone().text()).toBe(201);
    expect(await toCrew.clone().json()).toMatchObject({
      team: { key: "approvers", name: "Approvers" },
    });
    expect((await asked("approver")).data).toEqual([]);
    expect(
      (await h.request(`${REST_ROUTES.teams}/${crewId}/members`, json({ personId: bobId }, admin)))
        .status,
    ).toBe(200);
    expect((await asked("approver")).data).toEqual(["bob"]);
    expect(
      (
        await h.request(`${REST_ROUTES.teams}/${crewId}/members/${bobId}`, {
          method: "DELETE",
          headers: { cookie: admin, origin: SIGN_IN_URL },
        })
      ).status,
    ).toBe(200);
    expect((await asked("approver")).data).toEqual([]);
    // Removing the team takes the role granted to it, said on the plugin's board as a revoke is.
    expect(
      (
        await h.request(`${REST_ROUTES.teams}/${crewId}`, {
          method: "DELETE",
          headers: { cookie: admin, origin: SIGN_IN_URL },
        })
      ).status,
    ).toBe(204);
    const leftGrants = (await (
      await h.request(pluginPath("leave", "grants"), { headers: { cookie: admin } })
    ).json()) as { items: { team?: { key: string } | null }[] };
    expect(leftGrants.items.some((grant) => grant.team?.key === crewId)).toBe(false);
    const leaveEvents = (await (
      await h.request(pluginPath("leave", "events"), { headers: { cookie: admin } })
    ).json()) as { items: { kind: string; data: Record<string, unknown> }[] };
    expect(leaveEvents.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plugin.revoked",
          data: expect.objectContaining({ role: "approver", team: "Approvers" }),
        }),
      ]),
    );
    // Through a project, it is everyone in the project, an open one having all of the workspace.
    const open = await h.request(
      REST_ROUTES.projects,
      json({ key: "granted", name: "Granted", visibility: "workspace" }, admin),
    );
    expect(open.status, await open.clone().text()).toBe(201);
    const throughProject = await h.request(
      pluginPath("leave", "grants"),
      json({ role: "approver", project: "granted" }, admin),
    );
    expect(throughProject.status, await throughProject.clone().text()).toBe(201);
    expect((await asked("approver")).data).toEqual(expect.arrayContaining([aliceLogin, "bob"]));
    await revoke(throughProject);
    // A role the plugin does not declare is its mistake, and said so.
    const refused = await invoke("leave", member, ["granted", "--role", "boss"]);
    expect(refused.status).toBe(400);
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.invalid_args");
  });

  it("tells it who holds a role that follows the reporting line: whoever manages someone, and whoever was granted it (ADR-0068)", async () => {
    const asked = async () =>
      ((await invoked("leave", member, ["granted", "--role", "manager"])).data as string[]).sort();
    expect(await asked()).toEqual([]);
    let grantId: string | undefined;
    try {
      // Alice manages bob: she holds the role by the directory, granted it by nobody.
      const managed = await h.request(
        `${REST_ROUTES.people}/${bobId}`,
        json({ managerId: aliceId }, admin, "PATCH"),
      );
      expect(managed.status, await managed.clone().text()).toBe(200);
      expect(await asked()).toEqual([aliceLogin]);
      // A grant of it is held as any other, and listed beside whoever manages someone.
      const granted = await h.request(
        pluginPath("leave", "grants"),
        json({ role: "manager", person: bobId }, admin),
      );
      expect(granted.status, await granted.clone().text()).toBe(201);
      grantId = restPluginGrantSchema.parse(await granted.json()).id;
      expect(await asked()).toEqual([aliceLogin, "bob"].sort());
    } finally {
      if (grantId !== undefined) {
        const revoked = await h.request(pluginPath("leave", "grants", grantId), {
          method: "DELETE",
          headers: { cookie: admin, origin: SIGN_IN_URL },
        });
        expect(revoked.status).toBe(200);
      }
      await h.request(`${REST_ROUTES.people}/${bobId}`, json({ managerId: null }, admin, "PATCH"));
    }
    expect(await asked()).toEqual([]);
  });

  it("serves a frame a person's picture, by the person and never by an address", async () => {
    const at = (id: string, plugin = "leave") => pluginPath(plugin, "people", id, "picture");
    const seen = await h.request(at(aliceId), { headers: { cookie: member } });
    expect(seen.status, await seen.clone().text()).toBe(200);
    expect(seen.headers.get("content-type")).toBe("image/png");
    expect(seen.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await seen.arrayBuffer())).toEqual(PNG);
    // The console read it from where the person's provider says it is, and from nowhere else.
    expect(pictured).toEqual(["https://avatars.example/alice.png"]);

    // A person with none is answered so, as a page takes it, and so is an id that is no one's.
    const none = await h.request(at(bobId), { headers: { cookie: member } });
    expect(none.status).toBe(404);
    expect(restErrorSchema.parse(await none.json()).error.code).toBe("plugin.not_found");
    const nobody = "0199c4d8-0000-7000-8000-00000000ffff";
    expect((await h.request(at(nobody), { headers: { cookie: member } })).status).toBe(404);

    // An address is not a person: nothing the frame writes reaches the console's fetching.
    const address = at("https%3A%2F%2Felsewhere.example%2Fdata.png");
    expect((await h.request(address, { headers: { cookie: member } })).status).toBe(404);
    expect(pictured).toHaveLength(1);

    // Signed out it is nobody's; a plugin that was not given the people has none to show.
    expect((await h.request(at(aliceId))).status).toBe(401);
    const lacking = await h.request(at(aliceId, "audit"), { headers: { cookie: member } });
    expect(lacking.status).toBe(403);
    expect(restErrorSchema.parse(await lacking.json()).error.code).toBe("plugin.forbidden");
  });
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
    // The hook was told the event's id and that this was its first delivery, by which a plugin
    // keeps from acting twice on a delivery repeated.
    expect(emitted.items[0]?.data).toMatchObject({
      requestId: record.id,
      state: "approved",
      by: { login: aliceLogin },
      eventId: expect.stringMatching(/^console:\d+$/),
      attempt: 1,
    });
    const tasks = restTasksSchema.parse(
      await (await h.request(projectPath(BOARD, "tasks"), { headers: { cookie: admin } })).json(),
    );
    const audited = tasks.items.find((task) => task.title.startsWith("Audit "));
    expect(audited).toMatchObject({ title: `Audit ${record.id}: approved`, plugin: "audit" });
    auditedNumber = audited?.number;
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

  it("addresses a decision to someone outside its project, who reaches and answers it there, and whoever manages them too (ADR-0068)", async () => {
    // Carol is of the workspace and not in the board project; the plugin may still name her.
    const carol = await h.signIn("carol");
    const people = restPeopleSchema.parse(
      await (await h.request(REST_ROUTES.people, { headers: { cookie: admin } })).json(),
    );
    const carolId = people.items.find((person) => person.login === "carol")?.id ?? "";
    expect(carolId).not.toBe("");
    const outside = await h.request(projectPath(BOARD), { headers: { cookie: carol } });
    expect(outside.status).toBe(404);
    const requested = await invoked("leave", member, [
      "request",
      "--from",
      "2026-12-01",
      "--to",
      "2026-12-02",
      "--approver",
      "carol",
    ]);
    const decisionId = requested.waiting ?? "";
    expect(decisionId).not.toBe("");
    // The command is told where the decision waits, so that an agent names the project.
    expect(requested.project).toBe(BOARD);
    // Carol finds it among her decisions and on her plate, with the project named, though she
    // may not see the project; and reads it at its own address, which says she may answer.
    const mine = restMyDecisionsSchema.parse(
      await (
        await h.request(`${REST_ROUTES.decisions}?open=true`, { headers: { cookie: carol } })
      ).json(),
    );
    expect(mine.items.find((item) => item.decision.id === decisionId)?.project.key).toBe(BOARD);
    const plate = restWorkSchema.parse(
      await (await h.request(REST_ROUTES.work, { headers: { cookie: carol } })).json(),
    );
    expect(plate.decisions.some((item) => item.decision.id === decisionId)).toBe(true);
    const reached = restReachedDecisionSchema.parse(
      await (await h.request(decisionPath(decisionId), { headers: { cookie: carol } })).json(),
    );
    expect(reached.project.key).toBe(BOARD);
    expect(reached.decision.plugin).toBe("leave");
    expect(reached.mayAnswer).toBe(true);
    // Bob, who requested, reads it too and may not answer it from outside; he is in the project, so he may.
    const bobs = restReachedDecisionSchema.parse(
      await (await h.request(decisionPath(decisionId), { headers: { cookie: member } })).json(),
    );
    expect(bobs.mayAnswer).toBe(true);
    // Carol answers at the decision's own address; the project's route is still closed to her.
    const closed = await h.request(
      `${projectPath(BOARD, "decisions", decisionId)}/answer`,
      json({ option: "1" }, carol),
    );
    expect(closed.status).toBe(404);
    const answered = await h.request(
      `${decisionPath(decisionId)}/answer`,
      json({ option: "1" }, carol),
    );
    expect(answered.status, await answered.clone().text()).toBe(200);
    expect(restDecisionSchema.parse(await answered.json()).answer?.by.id).toBe(carolId);

    // Whoever manages a decider of a plugin's decision reaches it and answers it too: Carol
    // manages Bob, and a decision addressed to Bob is hers to answer from outside the project.
    const managed = await h.request(
      `${REST_ROUTES.people}/${bobId}`,
      json({ managerId: carolId }, admin, "PATCH"),
    );
    expect(managed.status, await managed.clone().text()).toBe(200);
    const forBob = await invoked("leave", member, [
      "request",
      "--from",
      "2026-12-03",
      "--to",
      "2026-12-03",
      "--approver",
      "bob",
    ]);
    const above = restReachedDecisionSchema.parse(
      await (
        await h.request(decisionPath(forBob.waiting ?? ""), { headers: { cookie: carol } })
      ).json(),
    );
    expect(above.mayAnswer).toBe(true);
    const byManager = await h.request(
      `${decisionPath(forBob.waiting ?? "")}/answer`,
      json({ option: "2" }, carol),
    );
    expect(byManager.status, await byManager.clone().text()).toBe(200);
    // A person's own decision in the project, addressed to Bob, reaches Carol through no line:
    // the climb is a plugin's decision's alone.
    const plain = restDecisionSchema.parse(
      await (
        await h.request(
          projectPath(BOARD, "decisions"),
          json(
            { question: "Plain?", options: [{ label: "Yes" }, { label: "No" }], deciderId: bobId },
            admin,
          ),
        )
      ).json(),
    );
    const unreached = await h.request(decisionPath(plain.id), { headers: { cookie: carol } });
    expect(unreached.status).toBe(404);
    // And a person raising a decision names only who may work in the project, as before.
    const refused = await h.request(
      projectPath(BOARD, "decisions"),
      json(
        { question: "Carol?", options: [{ label: "Yes" }, { label: "No" }], deciderId: carolId },
        admin,
      ),
    );
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("decision.invalid_decider");
    await h.request(`${REST_ROUTES.people}/${bobId}`, json({ managerId: null }, admin, "PATCH"));
  });

  it("raises a decision for a person who may not see its board project, who reads it as its raiser and nothing else of the project (ADR-0080)", async () => {
    // Carol is of the workspace and not in the board project: a requester there, through the
    // plugin's command, which she may use as everyone may.
    const carol = await h.signIn("carol");
    expect((await h.request(projectPath(BOARD), { headers: { cookie: carol } })).status).toBe(404);
    const requested = await invoked("leave", carol, [
      "request",
      "--from",
      "2026-12-10",
      "--to",
      "2026-12-11",
      "--approver",
      aliceLogin,
    ]);
    const decisionId = requested.waiting ?? "";
    expect(decisionId).not.toBe("");
    expect(requested.project).toBe(BOARD);
    // She reads it at its own address, as its raiser, and may not answer it; it is among the
    // decisions she raised.
    const reached = restReachedDecisionSchema.parse(
      await (await h.request(decisionPath(decisionId), { headers: { cookie: carol } })).json(),
    );
    expect(reached.decision.plugin).toBe("leave");
    expect(reached.decision.raisedBy.login).toBe("carol");
    expect(reached.mayAnswer).toBe(false);
    const raised = restMyDecisionsSchema.parse(
      await (
        await h.request(`${REST_ROUTES.decisions}?raised=true`, { headers: { cookie: carol } })
      ).json(),
    );
    expect(raised.items.some((item) => item.decision.id === decisionId)).toBe(true);
    // Nothing else of the project opens to her: not the project, not the decision through it.
    expect((await h.request(projectPath(BOARD), { headers: { cookie: carol } })).status).toBe(404);
    expect(
      (await h.request(projectPath(BOARD, "decisions", decisionId), { headers: { cookie: carol } }))
        .status,
    ).toBe(404);
    // A task there is refused as before: nothing of it would reach her.
    const task = await invoke("leave", carol, ["task", "A task by a requester"]);
    expect(task.status, await task.clone().text()).toBe(404);
    expect(restErrorSchema.parse(await task.json()).error.code).toBe("plugin.not_found");
    // Alice, the approver, answers it at its address as before.
    const answered = await h.request(
      `${decisionPath(decisionId)}/answer`,
      json({ option: "1" }, admin),
    );
    expect(answered.status, await answered.clone().text()).toBe(200);
  });

  it("says the project a decision its command raised waits in, which may not be its board, and acts in no project it is not placed on (ADR-0080)", async () => {
    // The call is on another project the plugin is placed on, and the command asks there: the
    // decision waits there.
    const response = await h.request(
      pluginPath("leave", "invoke"),
      json({ argv: ["ask-here", "--approver", aliceLogin], project: "leave-elsewhere" }, member),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const elsewhere = restPluginInvocationSchema.parse(await response.json());
    expect(elsewhere.text).toBe("asked in leave-elsewhere");
    expect(elsewhere.project).toBe("leave-elsewhere");
    const raised = restDecisionSchema.parse(
      await (
        await h.request(projectPath("leave-elsewhere", "decisions", elsewhere.waiting ?? ""), {
          headers: { cookie: member },
        })
      ).json(),
    );
    expect(raised.plugin).toBe("leave");
    // A call on no project asks in the board, and says the board.
    const atBoard = await invoked("leave", member, ["ask-here", "--approver", aliceLogin]);
    expect(atBoard.text).toBe(`asked in ${BOARD}`);
    expect(atBoard.project).toBe(BOARD);
    // On a project the plugin is not placed on, a call takes the plugin nowhere: the ask there is
    // refused, though the person may work in the project.
    const made = await h.request(
      REST_ROUTES.projects,
      json({ key: "leave-nowhere", name: "Nowhere", visibility: "workspace" }, admin),
    );
    expect(made.status, await made.clone().text()).toBe(201);
    const refused = await h.request(
      pluginPath("leave", "invoke"),
      json({ argv: ["ask-here", "--approver", aliceLogin], project: "leave-nowhere" }, member),
    );
    expect(refused.status, await refused.clone().text()).toBe(403);
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.forbidden");
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
    // A team of the workspace (ADR-0073), with bob in it, read by the plugin with the people, who
    // name their teams by key (ADR-0074).
    const crew = await h.request(REST_ROUTES.teams, json({ key: "crew", name: "Crew" }, admin));
    expect(crew.status, await crew.clone().text()).toBe(201);
    const crewId = "crew";
    expect(
      (await h.request(`${REST_ROUTES.teams}/${crewId}/members`, json({ personId: bobId }, admin)))
        .status,
    ).toBe(200);
    const seen = await invoked("leave", member, ["people"]);
    const data = seen.data as {
      people: string[];
      teams: string[];
      teamsOf: Record<string, string[]>;
      projects: string;
      workspace: { name: string; timeZone: string; languages: string[] };
      endpoint: string;
    };
    expect(data.people).toEqual(expect.arrayContaining([aliceLogin, "bob"]));
    expect(data.teams).toEqual(["Crew"]);
    expect(data.teamsOf.bob).toEqual(["crew"]);
    expect(data.projects).toBe("plugin.forbidden");
    // UTC because nobody set a zone, and said so; the console's public address, for a link elsewhere.
    expect(data.workspace).toMatchObject({
      name: "Acme",
      timeZone: "UTC",
      timeZoneSet: false,
      weekStart: "auto",
      languages: ["en", "ko"],
      url: SIGN_IN_URL,
    });
    // An endpoint's address is of one the plugin defines; this plugin defines none.
    expect(data.endpoint).toBe("plugin.not_found");
  });

  it("reads a person's work email with people:read:email alone (ADR-0069)", async () => {
    const written = await h.request(
      `${REST_ROUTES.people}/${bobId}`,
      json({ email: "bob@example.test" }, admin, "PATCH"),
    );
    expect(written.status, await written.clone().text()).toBe(200);
    const detail = restPluginDetailSchema.parse(
      await (await h.request(pluginPath("leave"), { headers: { cookie: admin } })).json(),
    );
    const before = detail.consent ?? [];
    expect(before).not.toContain("people:read:email");
    const read = async () =>
      ((await invoked("leave", member, ["people"])).data as { emails: Record<string, unknown> })
        .emails;
    expect((await read()).bob).toBeNull();
    const consented = await h.request(
      pluginPath("leave", "consent"),
      json({ consent: [...before, "people:read:email"] }, admin, "PATCH"),
    );
    expect(consented.status, await consented.clone().text()).toBe(200);
    expect((await read()).bob).toBe("bob@example.test");
    expect((await read()).carol).toBeNull();
    // Withdrawn, and the address with it.
    expect(
      (await h.request(pluginPath("leave", "consent"), json({ consent: before }, admin, "PATCH")))
        .status,
    ).toBe(200);
    expect((await read()).bob).toBeNull();
    await h.request(`${REST_ROUTES.people}/${bobId}`, json({ email: null }, admin, "PATCH"));
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

  it("seals what a plugin names of an answer, puts a secret where named and to its hosts alone, and keeps a verifying secret from signing (ADR-0070)", async () => {
    sent.length = 0;
    answers.set("/oauth/token", {
      ok: true,
      access_token: "xoxb-1",
      expires_in: 3600,
      credentials: { signing_secret: "s1gn", client_id: "id" },
    });
    for (const [name, value] of [
      ["clientSecret", "cs"],
      ["pinned", "p1n"],
    ] as const) {
      const put = await h.request(
        pluginPath("leave", "secrets", name),
        json({ value }, admin, "PUT"),
      );
      expect(put.status).toBe(204);
    }
    const exchanged = await invoked("leave", member, ["exchange"]);
    expect(exchanged.data).toMatchObject({
      token: {
        ok: true,
        access_token: "[sealed]",
        expires_in: 3600,
        credentials: { signing_secret: "[sealed]", client_id: "id" },
      },
      me: 200,
      has: true,
      status: { set: true, source: "api.example.test" },
    });
    expect(JSON.stringify(exchanged)).not.toContain("xoxb-1");
    expect(sent).toHaveLength(2);
    expect(new TextDecoder().decode(sent[0]?.body)).toBe(
      "grant_type=authorization_code&code=c0de&client_secret=cs",
    );
    expect(sent[1]?.headers).toEqual({ authorization: "Bearer xoxb-1" });
    // The settings say from where and until when, never the value; the feed says the setting changed and from where.
    const detail = restPluginDetailSchema.parse(
      await (await h.request(pluginPath("leave"), { headers: { cookie: admin } })).json(),
    );
    const settingOf = (key: string) => detail.settings.find((setting) => setting.key === key);
    expect(settingOf("botToken")).toMatchObject({
      set: true,
      value: null,
      source: "api.example.test",
      hosts: ["api.example.test"],
      use: null,
    });
    expect(settingOf("botToken")?.expiresAt).toMatch(/Z$/);
    expect(settingOf("signingSecret")).toMatchObject({
      set: true,
      source: "api.example.test",
      expiresAt: null,
      use: "verify",
    });
    expect(settingOf("clientSecret")).toMatchObject({ set: true, source: "administrator" });
    expect(JSON.stringify(detail)).not.toContain("xoxb-1");
    const events = restEventsSchema.parse(
      await (await h.request(pluginPath("leave", "events"), { headers: { cookie: admin } })).json(),
    );
    expect(
      events.items
        .filter(
          (event) => event.kind === "plugin.configured" && event.data.source === "api.example.test",
        )
        .map((event) => event.data.fields)
        .sort(),
    ).toEqual([["botToken"], ["signingSecret"]]);
    expect(JSON.stringify(events)).not.toContain("xoxb-1");
    // What a secret refuses: a pinned one to another host, signing with one that verifies.
    expect((await invoked("leave", member, ["misuse"])).data).toMatchObject({
      pinned: "plugin.forbidden",
      sign: "plugin.forbidden",
      botToken: "sent",
      verified: false,
    });
    // Past its expiry, the bot token stands unset and goes into no request, until sealed again.
    skewMs = 2 * 3_600_000;
    try {
      expect(
        (await invoked("leave", member, ["standing", "--name", "botToken"])).data,
      ).toMatchObject({ set: false, source: "api.example.test" });
      expect((await invoked("leave", member, ["misuse"])).data).toMatchObject({
        botToken: "plugin.forbidden",
      });
    } finally {
      skewMs = 0;
    }
  });

  it("withholds from a plugin what it cannot seal, and says so: a form where JSON was meant, a value too long or no string, a path to nothing (ADR-0070)", async () => {
    // A token endpoint that answers a form unless asked for JSON: what it holds reaches no plugin.
    bodies.set("/oauth/form", {
      type: "application/x-www-form-urlencoded",
      body: "access_token=xoxb-form&signing_secret=s1gn-form",
    });
    answers.set("/oauth/odd", {
      access_token: "x".repeat(5000),
      credentials: { signing_secret: "s1gn-odd" },
    });
    answers.set("/oauth/refused", { ok: false, error: "invalid_code" });
    const standing = async () =>
      (await invoked("leave", member, ["standing", "--name", "botToken"])).data;
    const before = await standing();
    const tried = await invoked("leave", member, ["unsealable"]);
    expect(tried.data).toEqual({
      form: {
        status: 200,
        body: "",
        sealed: { botToken: "not_json", signingSecret: "not_json" },
      },
      odd: {
        status: 200,
        body: JSON.stringify({ access_token: "[withheld]", credentials: "[withheld]" }),
        sealed: { botToken: "too_long", signingSecret: "not_a_string" },
      },
      refused: {
        status: 200,
        body: JSON.stringify({ ok: false, error: "invalid_code" }),
        sealed: { botToken: "absent", signingSecret: "absent" },
      },
    });
    const said = JSON.stringify(tried);
    for (const secret of ["xoxb-form", "s1gn-form", "s1gn-odd", "x".repeat(4097)]) {
      expect(said).not.toContain(secret);
    }
    // Nothing was sealed: the bot token stands as the exchange sealed it.
    expect(await standing()).toEqual(before);
  });

  it("hands a plugin no secret the console put in, sent back or carried by a redirect, and sends no TRACE (ADR-0070)", async () => {
    sent.length = 0;
    const standing = async () =>
      (await invoked("leave", member, ["standing", "--name", "botToken"])).data;
    const before = await standing();
    const basic = Buffer.from("t0k3n").toString("base64");
    const echoed = await invoked("leave", member, ["echo"]);
    expect(echoed.data).toMatchObject({
      trace: "plugin.invalid_args",
      // What the plugin named to seal is withheld wherever else the answer holds it too.
      echo: {
        headers: { "x-echo-authorization": "[withheld]" },
        body: { headers: { authorization: "[withheld]" }, body: '{"hello":"there"}' },
        sealed: { botToken: "echoed" },
      },
      basic: { "x-echo-authorization": "Basic [withheld]" },
      redirect: { status: 302, location: "https://api.example.test/redirect?key=[withheld]" },
    });
    const said = JSON.stringify(echoed);
    for (const secret of ["t0k3n", basic]) {
      expect(said).not.toContain(secret);
    }
    // The secret went out where it was put; TRACE never did, and the redirect was not followed.
    expect(sent.map((request) => request.method)).toEqual(["POST", "GET", "GET"]);
    expect(sent[0]?.headers.authorization).toBe("Bearer t0k3n");
    expect(sent[1]?.headers.authorization).toBe(`Basic ${basic}`);
    expect(sent[2]?.url.searchParams.get("key")).toBe("t0k3n");
    // The echo of the API token was not sealed as the bot token.
    expect(await standing()).toEqual(before);
  });

  it("seals a secret pinned to hosts from their answers alone, refused before the request goes out (ADR-0070)", async () => {
    sent.length = 0;
    expect((await invoked("leave", member, ["stray"])).data).toEqual({
      pinned: "plugin.forbidden",
    });
    expect(sent).toEqual([]);
    expect((await invoked("leave", member, ["standing", "--name", "pinned"])).data).toMatchObject({
      set: true,
      source: "administrator",
    });
  });

  it("leaves what a plugin can go without to the administrator, and keeps what it requires (ADR-0060)", async () => {
    const consentNow = async () =>
      restPluginDetailSchema.parse(
        await (await h.request(pluginPath("leave"), { headers: { cookie: admin } })).json(),
      );
    const before = await consentNow();
    expect(before.optionalCapabilities).toEqual([
      "outbound:api.example.test",
      "people:read:email",
      "projects:read",
      "projects:read:all",
    ]);
    expect(before.capabilities).not.toContain("outbound:api.example.test");
    expect(before.consent).toContain("outbound:api.example.test");
    const consent = (body: readonly string[], cookie = admin) =>
      h.request(pluginPath("leave", "consent"), json({ consent: body }, cookie, "PATCH"));
    const off = before.capabilities;
    // Those it requires are not the administrator's to take away, and it asks nothing else.
    const lacking = await consent(off.slice(1));
    expect(lacking.status).toBe(409);
    expect(restErrorSchema.parse(await lacking.json()).error.code).toBe("plugin.needs_consent");
    const unasked = await consent([...off, "files"]);
    expect(unasked.status).toBe(400);
    expect(restErrorSchema.parse(await unasked.json()).error.code).toBe("plugin.invalid_args");
    expect((await consent(off, member)).status).toBe(403);
    // Turned off, the call is refused from the next one on, and the plugin can tell.
    const turned = await consent(off);
    expect(turned.status, await turned.clone().text()).toBe(200);
    expect(restPluginDetailSchema.parse(await turned.json()).consent).toEqual(off);
    const held = await invoked("leave", member, ["holds"]);
    expect(held.data).not.toContain("outbound:api.example.test");
    expect(held.data).toContain("people:read");
    const refused = await invoke("leave", member, ["probe"]);
    expect(refused.status).toBe(403);
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.forbidden");
    // Turned on again, it holds it.
    expect((await consent([...off, "outbound:api.example.test"])).status).toBe(200);
    expect((await invoked("leave", member, ["holds"])).data).toContain("outbound:api.example.test");
    expect((await invoke("leave", member, ["probe"])).status).toBe(200);
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

  it("calls another plugin as itself from a hook, for a person with the roles both hold, and answers a decision for a person (ADR-0072)", async () => {
    // From the hook: the plugin as itself, with the role granted to it and the callee's default role.
    const seen = await invoked("audit", member, ["read", "--number", String(auditedNumber)]);
    expect((seen.data as { body: string }).body).toContain(
      "seen as plugin audit with employee, approver.",
    );
    expect((await invoked("audit", member, ["held"])).data).toEqual([
      { plugin: "leave", role: "approver" },
    ]);
    // For bob, an employee: the roles both hold, in bob's name.
    expect((await invoked("audit", member, ["peekFor", "--person", bobId])).data).toMatchObject({
      caller: "plugin",
      by: "audit",
      for: "bob",
      roles: ["employee"],
    });
    const approver = await h.request(
      pluginPath("leave", "grants"),
      json({ role: "approver", person: bobId }, admin),
    );
    expect(approver.status).toBe(201);
    expect((await invoked("audit", member, ["peekFor", "--person", bobId])).data).toMatchObject({
      roles: ["employee", "approver"],
    });
    // Nobody to act for, or an id that is nobody's: refused before the callee hears of it, and
    // before the database is asked.
    for (const person of ["0199c4d8-0000-7000-8000-0000000000dd", "not-a-person"]) {
      const nobody = await invoke("audit", member, ["peekFor", "--person", person]);
      expect(nobody.status, await nobody.clone().text()).toBe(404);
      expect(restErrorSchema.parse(await nobody.json()).error.code).toBe("plugin.not_found");
    }
    // A decision is answered for a person where it is on their own plate (ADR-0068), whatever
    // else they administer or work in: addressed to carol, who is outside the board project, it
    // is answered for neither alice, who administers the workspace, nor bob, who works in the
    // project and asked for it.
    const carol = await h.signIn("carol");
    const carolId = (
      (await (await h.request(REST_ROUTES.me, { headers: { cookie: carol } })).json()) as {
        person: { id: string };
      }
    ).person.id;
    const requested = await invoked("leave", member, [
      "request",
      "--from",
      "2026-12-01",
      "--to",
      "2026-12-02",
      "--approver",
      "carol",
    ]);
    const decisionId = requested.waiting ?? "";
    expect(decisionId).not.toBe("");
    const answerFor = (person: string, decision = decisionId, option = "approve") =>
      invoke("audit", member, [
        "answerFor",
        "--decision",
        decision,
        "--option",
        option,
        "--person",
        person,
      ]);
    for (const person of [aliceId, bobId]) {
      const refused = await answerFor(person);
      expect(refused.status, await refused.clone().text()).toBe(403);
      expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.forbidden");
    }
    // An id that is none is the plugin's mistake: the decision's said so, the person's nobody.
    const malformed = await answerFor(carolId, "not-a-decision");
    expect(malformed.status, await malformed.clone().text()).toBe(400);
    expect(restErrorSchema.parse(await malformed.json()).error.code).toBe("plugin.invalid_args");
    const noOne = await answerFor("not-a-person");
    expect(noOne.status, await noOne.clone().text()).toBe(404);
    expect(restErrorSchema.parse(await noOne.json()).error.code).toBe("plugin.not_found");
    // Carol's to answer, and the feed names her, through audit.
    const answered = await answerFor(carolId);
    expect(answered.status, await answered.clone().text()).toBe(200);
    const answeredEvent = async (id: string) =>
      restEventsSchema
        .parse(
          await (
            await h.request(`${projectPath(BOARD, "events")}?decision=${id}`, {
              headers: { cookie: admin },
            })
          ).json(),
        )
        .items.find((candidate) => candidate.kind === "decision.answered");
    expect(await answeredEvent(decisionId)).toMatchObject({
      actor: { login: "carol" },
      agent: null,
      plugin: "audit",
      via: "audit",
    });
    // Whoever manages the person it is addressed to answers it too, up the reporting line:
    // carol manages bob.
    const managed = await h.request(
      `${REST_ROUTES.people}/${bobId}`,
      json({ managerId: carolId }, admin, "PATCH"),
    );
    expect(managed.status, await managed.clone().text()).toBe(200);
    try {
      const forBob = await invoked("leave", member, [
        "request",
        "--from",
        "2026-12-03",
        "--to",
        "2026-12-03",
        "--approver",
        "bob",
      ]);
      const byManager = await answerFor(carolId, forBob.waiting ?? "", "reject");
      expect(byManager.status, await byManager.clone().text()).toBe(200);
      expect(await answeredEvent(forBob.waiting ?? "")).toMatchObject({
        actor: { login: "carol" },
        via: "audit",
      });
    } finally {
      await h.request(`${REST_ROUTES.people}/${bobId}`, json({ managerId: null }, admin, "PATCH"));
    }
    // A person's own decision is on their plate only while they are in its project (ADR-0077):
    // addressed to bob in the board project, it is answered for him by nobody once he is taken
    // out of it, and again once he is listed again.
    const plain = restDecisionSchema.parse(
      await (
        await h.request(
          projectPath(BOARD, "decisions"),
          json(
            {
              question: "Still Bob's?",
              options: [
                { label: "Yes", key: "approve" },
                { label: "No", key: "reject" },
              ],
              deciderId: bobId,
            },
            admin,
          ),
        )
      ).json(),
    );
    const unlisted = await h.request(projectPath(BOARD, "members", bobId), {
      method: "DELETE",
      headers: { cookie: admin, origin: SIGN_IN_URL },
    });
    expect(unlisted.status, await unlisted.clone().text()).toBe(204);
    try {
      const gone = await answerFor(bobId, plain.id);
      expect(gone.status, await gone.clone().text()).toBe(403);
      expect(restErrorSchema.parse(await gone.json()).error.code).toBe("plugin.forbidden");
    } finally {
      const relisted = await h.request(
        projectPath(BOARD, "members"),
        json({ personId: bobId, role: "member" }, admin),
      );
      expect(relisted.status, await relisted.clone().text()).toBe(201);
    }
    const back = await answerFor(bobId, plain.id);
    expect(back.status, await back.clone().text()).toBe(200);
  });

  it("reads for a person what they may as a member, whatever they administer, and never as the administrator who enabled it (ADR-0072)", async () => {
    // A private project alice is not listed in: hers to see as an administrator alone.
    const vault = await h.request(
      REST_ROUTES.projects,
      json({ key: "vault", name: "Vault", visibility: "private" }, admin),
    );
    expect(vault.status, await vault.clone().text()).toBe(201);
    const unlisted = await h.request(projectPath("vault", "members", aliceId), {
      method: "DELETE",
      headers: { cookie: admin, origin: SIGN_IN_URL },
    });
    expect(unlisted.status, await unlisted.clone().text()).toBe(204);
    const before =
      restPluginDetailSchema.parse(
        await (await h.request(pluginPath("leave"), { headers: { cookie: admin } })).json(),
      ).consent ?? [];
    const consent = async (body: readonly string[]) => {
      const changed = await h.request(
        pluginPath("leave", "consent"),
        json({ consent: body }, admin, "PATCH"),
      );
      expect(changed.status, await changed.clone().text()).toBe(200);
    };
    const looked = async (person: string) =>
      (
        (await invoked("audit", member, ["lookFor", "--person", person])).data as {
          projects: string[];
        }
      ).projects;
    try {
      await consent([...before, "projects:read"]);
      expect(await looked(aliceId)).toContain(BOARD);
      expect(await looked(aliceId)).not.toContain("vault");
      expect(await looked(bobId)).not.toContain("vault");
      // Every project, with projects:read:all, is a person's own call's and the plugin's own,
      // never a call's for a person.
      await consent([...before, "projects:read", "projects:read:all"]);
      expect(await looked(aliceId)).not.toContain("vault");
      const own = (await invoked("leave", member, ["people"])).data as { projects: string[] };
      expect(own.projects).toContain("vault");
    } finally {
      await consent(before);
    }
  });

  it("names the plugin that acted for a person beside them, and none where a plugin called as itself (ADR-0072)", async () => {
    const noted = await invoked("audit", member, [
      "noteFor",
      "--person",
      bobId,
      "--title",
      "Noted for bob",
    ]);
    expect(noted.text).toBe("noted");
    const tasks = restTasksSchema.parse(
      await (
        await h.request(`${projectPath(BOARD, "tasks")}?q=Noted`, { headers: { cookie: admin } })
      ).json(),
    );
    const createdOf = async (titled: (title: string) => boolean) => {
      const task = tasks.items.find((candidate) => titled(candidate.title));
      expect(task).toBeDefined();
      return restEventsSchema
        .parse(
          await (
            await h.request(`${projectPath(BOARD, "events")}?task=${task?.id ?? ""}`, {
              headers: { cookie: admin },
            })
          ).json(),
        )
        .items.find((event) => event.kind === "task.created");
    };
    // For bob: his, through audit, by leave's code.
    expect(await createdOf((title) => title === "Noted for bob")).toMatchObject({
      actor: { login: "bob" },
      plugin: "leave",
      via: "audit",
    });
    // From audit's hook, which called leave as itself: the console's own act, through no one.
    expect(
      await createdOf((title) => title.startsWith("Noted ") && title !== "Noted for bob"),
    ).toMatchObject({ actor: { login: aliceLogin }, plugin: "leave", via: null });
  });

  it("tells an administrator alone how the roles a plugin asks of others stand, a callee's default role held (ADR-0072)", async () => {
    const asks = async (cookie: string) =>
      restPluginDetailSchema.parse(
        await (await h.request(pluginPath("audit"), { headers: { cookie } })).json(),
      ).asks;
    expect((await asks(admin))?.map((ask) => [ask.plugin, ask.role, ask.state])).toEqual([
      ["leave", "approver", "granted"],
      ["leave", "employee", "granted"],
    ]);
    expect(await asks(member)).toBeUndefined();
  });

  it("refuses a plugin calling its own api, whatever its install was given (ADR-0072)", async () => {
    const installs = drizzleOf(testDatabase.database);
    const [install] = await installs
      .select({ consent: pluginInstalls.consent })
      .from(pluginInstalls)
      .where(eq(pluginInstalls.key, "audit"));
    const held = install?.consent ?? [];
    const consented = (consent: readonly string[]) =>
      installs
        .update(pluginInstalls)
        .set({ consent: [...consent] })
        .where(eq(pluginInstalls.key, "audit"));
    // No manifest may ask it any more; an install that holds it from before is refused at the call.
    await consented([...held, "plugins:audit"]);
    try {
      const refused = await invoke("audit", member, ["itself"]);
      expect(refused.status, await refused.clone().text()).toBe(403);
      expect(restErrorSchema.parse(await refused.json()).error).toMatchObject({
        code: "plugin.forbidden",
        message: expect.stringContaining("no api of its own"),
      });
    } finally {
      await consented(held);
    }
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
  it("tells a plugin a person's language, and keeps the one text it writes in it (ADR-0065)", async () => {
    const set = async (language: string | null) => {
      const answer = await h.request(REST_ROUTES.me, json({ language }, admin, "PATCH"));
      expect(answer.status, await answer.clone().text()).toBe(200);
    };
    const written = async () => {
      const made = await invoked("leave", member, ["theirs", "--approver", aliceLogin]);
      return made.data as { language: string | null; decision: { id: string; question: string } };
    };

    // Before the pages have seen them, a plugin reads no language, and chooses for itself.
    await set(null);
    expect((await written()).language).toBeNull();

    await set("ko");
    const { language, decision } = await written();
    expect(language).toBe("ko");
    expect(decision.question).toBe("연말 휴가를 승인할까요?");

    // One text, whoever reads it, in their language or not, and nothing beside it.
    const kept = await h.request(projectPath(BOARD, "decisions", decision.id), {
      headers: { cookie: member },
    });
    const body = (await kept.json()) as Record<string, unknown>;
    expect(body.question).toBe("연말 휴가를 승인할까요?");
    expect(body).not.toHaveProperty("translations");
    await set(null);

    // A text per language is not a text.
    const refused = await invoke("leave", member, ["several"]);
    expect(refused.status, await refused.clone().text()).toBe(400);
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.invalid_args");
  });

  it("tells a plugin nothing of what happened while it did not hold the stream", async () => {
    const consentOf = async () =>
      restPluginDetailSchema.parse(
        await (await h.request(pluginPath("leave"), { headers: { cookie: admin } })).json(),
      ).consent ?? [];
    const consented = (consent: readonly string[]) =>
      drizzleOf(testDatabase.database)
        .update(pluginInstalls)
        .set({ consent: [...consent] })
        .where(eq(pluginInstalls.key, "leave"));
    const requested = await invoked("leave", member, [
      "request",
      "--from",
      "2026-12-07",
      "--to",
      "2026-12-08",
      "--approver",
      "alice",
    ]);
    const { record } = requested.data as { record: { id: string } };
    const held = await consentOf();
    expect(held).toContain("events:console");
    await dispatcher.dispatch();

    // The answer comes while the plugin does not hold the console's events.
    await consented(held.filter((capability) => capability !== "events:console"));
    const answered = await h.request(
      `${projectPath(BOARD, "decisions", requested.waiting ?? "")}/answer`,
      json({ option: "1" }, admin),
    );
    expect(answered.status, await answered.clone().text()).toBe(200);
    await dispatcher.dispatch();

    // Given them again, the plugin hears from here on, and not of what it missed.
    await consented(held);
    await dispatcher.dispatch();
    await dispatcher.dispatch();
    const unheard = restPluginRecordSchema.parse(
      await (
        await h.request(pluginPath("leave", "records", "requests", record.id), {
          headers: { cookie: member },
        })
      ).json(),
    );
    expect(unheard.data.state).toBe("requested");
  });

  it("takes no control character in what a plugin writes, and line breaks in a body", async () => {
    for (const command of ["control-title", "control-question"]) {
      const refused = await invoke("leave", member, [command]);
      expect(refused.status, await refused.clone().text()).toBe(400);
      expect(restErrorSchema.parse(await refused.json()).error.code).toBe("plugin.invalid_args");
    }
    expect((await invoked("leave", member, ["lines"])).text).toBe("written");
  });
});
