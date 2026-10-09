import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  MCP_ROUTE,
  REST_ROUTES,
  restDecisionsSchema,
  restErrorSchema,
  restEventsSchema,
  restRunSchema,
  restRunsSchema,
  restTaskSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let aliceToken: string;

const JSON_HEADERS = { origin: SIGN_IN_URL, "content-type": "application/json" };

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider()],
    live: true,
    feed: { heartbeatMs: 200, pollMs: 60_000 },
    agents: { waitMs: 400 },
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  aliceToken = await tokenFor(alice);
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

async function tokenFor(cookie: string): Promise<string> {
  const made = await h.request(REST_ROUTES.tokens, {
    method: "POST",
    headers: { cookie, ...JSON_HEADERS },
    body: JSON.stringify({ name: "an agent" }),
  });
  expect(made.status).toBe(201);
  return restTokenCreatedSchema.parse(await made.json()).secret;
}

/** An MCP client connected to the harness as the holder of `token`, through the app and no socket. */
async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${SIGN_IN_URL}${MCP_ROUTE}`), {
    fetch: async (url, init) => h.app.fetch(new Request(url, init)),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

type Called = Awaited<ReturnType<Client["callTool"]>>;
const textOf = (result: Called): string => {
  const [first] = result.content as { readonly type: string; readonly text?: string }[];
  return first?.text ?? "";
};
const jsonOf = (result: Called): Record<string, unknown> => {
  expect(result.isError, textOf(result)).not.toBe(true);
  return JSON.parse(textOf(result));
};

async function writeTask(cookie: string, body: unknown) {
  const written = await h.request(REST_ROUTES.tasks, {
    method: "POST",
    headers: { cookie, ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
  expect(written.status).toBe(201);
  return restTaskSchema.parse(await written.json());
}

const readTask = async (cookie: string, id: string) =>
  restTaskSchema.parse(
    await (await h.request(`${REST_ROUTES.tasks}/${id}`, { headers: { cookie } })).json(),
  );
const readRun = async (cookie: string, id: string) =>
  restRunSchema.parse(
    await (await h.request(`${REST_ROUTES.runs}/${id}`, { headers: { cookie } })).json(),
  );

describe("the MCP endpoint", () => {
  it("takes a token and nothing else, and POST only", async () => {
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "x", version: "0" },
      },
    });
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const nobody = await h.request(MCP_ROUTE, { method: "POST", headers, body: initialize });
    expect(nobody.status).toBe(401);
    expect(nobody.headers.get("www-authenticate")).toContain("Bearer");
    expect(restErrorSchema.parse(await nobody.json()).error.code).toBe("auth.required");
    // A browser's cookie is not an agent's credential.
    const cookieOnly = await h.request(MCP_ROUTE, {
      method: "POST",
      headers: { ...headers, cookie: alice },
      body: initialize,
    });
    expect(cookieOnly.status).toBe(401);
    const nonsense = await h.request(MCP_ROUTE, {
      method: "POST",
      headers: { ...headers, authorization: "Bearer cns_t_nonsense" },
      body: initialize,
    });
    expect(nonsense.status).toBe(401);
    const get = await h.request(MCP_ROUTE, { headers: { authorization: `Bearer ${aliceToken}` } });
    expect(get.status).toBe(405);
    await expect(connect("cns_t_nonsense")).rejects.toThrow();
  });

  it("offers the tools, and an agent works a task through them as its person", async () => {
    const client = await connect(aliceToken);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "ask",
      "await_decision",
      "finish",
      "get_task",
      "hand_in",
      "list_tasks",
      "report",
      "take_task",
    ]);
    expect(jsonOf(await client.callTool({ name: "list_tasks", arguments: {} }))).toEqual({
      tasks: [],
    });

    // A person writes a task; the agent reads it by number.
    const task = await writeTask(bob, {
      title: "Fix the parser",
      body: "It fails on empty input.",
      state: "ready",
    });
    const listed = jsonOf(
      await client.callTool({ name: "list_tasks", arguments: { state: "ready" } }),
    );
    expect(listed.tasks).toMatchObject([
      { number: task.number, title: "Fix the parser", assignee: null },
    ]);
    const read = jsonOf(
      await client.callTool({ name: "get_task", arguments: { task: `#${task.number}` } }),
    );
    expect(read).toMatchObject({ body: "It fails on empty input.", decisions: [], runs: [] });

    // The agent takes it: the task is Alice's and at work, and nobody else's meanwhile.
    const taken = jsonOf(
      await client.callTool({
        name: "take_task",
        arguments: { task: String(task.number), agent: "Claude Code on the laptop" },
      }),
    );
    expect(taken.run).toMatchObject({
      status: "running",
      for: "Alice",
      agent: "Claude Code on the laptop",
    });
    const runId = (taken.run as { id: string }).id;
    const atWork = await readTask(bob, task.id);
    expect(atWork).toMatchObject({ state: "in_progress", openRuns: 1 });
    expect(atWork.assignee?.login).toBe("Alice");
    const again = await client.callTool({
      name: "take_task",
      arguments: { task: task.id, agent: "another" },
    });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain("run.task_taken");

    // It reports and hands in; only https is handed in.
    const reported = jsonOf(
      await client.callTool({
        name: "report",
        arguments: { run: runId, body: "# Found it\n\nThe parser trusts its input." },
      }),
    );
    expect(reported.run).toMatchObject({ reports: 1 });
    const handed = jsonOf(
      await client.callTool({
        name: "hand_in",
        arguments: { run: runId, url: "https://github.com/acme/app/pull/3", label: "the fix" },
      }),
    );
    expect(handed.run).toMatchObject({ artifacts: 1 });
    const insecure = await client
      .callTool({ name: "hand_in", arguments: { run: runId, url: "http://insecure.test/x" } })
      .then(
        (result) => (result.isError === true ? "refused" : "accepted"),
        () => "refused",
      );
    expect(insecure).toBe("refused");

    // It asks; nobody answers in time; the run waits, and the board shows what it waits for.
    const asked = jsonOf(
      await client.callTool({
        name: "ask",
        arguments: {
          run: runId,
          question: "Keep the old behaviour?",
          body: "Both are defensible.",
          options: ["Keep it", "Change it"],
        },
      }),
    );
    expect(asked.decision).toMatchObject({ status: "waiting", answer: null });
    const decisionId = (asked.decision as { id: string }).id;
    const waiting = await readRun(bob, runId);
    expect(waiting).toMatchObject({ status: "waiting", waitingFor: decisionId });
    expect(waiting.reports[0]?.body).toContain("Found it");
    expect(waiting.artifacts[0]).toMatchObject({
      url: "https://github.com/acme/app/pull/3",
      label: "the fix",
    });

    // A person answers on the board, and the agent, waiting, learns it at once.
    const pending = client.callTool({
      name: "await_decision",
      arguments: { decision: decisionId },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const answered = await h.request(`${REST_ROUTES.decisions}/${decisionId}/answer`, {
      method: "POST",
      headers: { cookie: bob, ...JSON_HEADERS },
      body: JSON.stringify({ option: "2", note: "Change it, carefully." }),
    });
    expect(answered.status).toBe(200);
    const outcome = jsonOf(await pending);
    expect(outcome.decision).toMatchObject({
      status: "answered",
      answer: { option: "2", label: "Change it", note: "Change it, carefully.", by: "bob" },
    });
    expect(await readRun(bob, runId)).toMatchObject({ status: "running", waitingFor: null });
    const decisions = restDecisionsSchema.parse(
      await (
        await h.request(`${REST_ROUTES.decisions}?task=${task.id}`, { headers: { cookie: bob } })
      ).json(),
    );
    expect(decisions.items[0]?.run).toEqual({ id: runId, agent: "Claude Code on the laptop" });

    // It finishes: the task goes up for review, and the run takes nothing more.
    const finished = jsonOf(
      await client.callTool({
        name: "finish",
        arguments: {
          run: runId,
          status: "finished",
          summary: "Done: the parser refuses empty input.",
        },
      }),
    );
    expect(finished.run).toMatchObject({ status: "finished" });
    expect(await readTask(bob, task.id)).toMatchObject({ state: "in_review", openRuns: 0 });
    const late = await client.callTool({ name: "report", arguments: { run: runId, body: "late" } });
    expect(late.isError).toBe(true);
    expect(textOf(late)).toContain("run.over");
    const runs = restRunsSchema.parse(
      await (
        await h.request(`${REST_ROUTES.runs}?task=${task.id}`, { headers: { cookie: bob } })
      ).json(),
    );
    expect(runs.items.map((run) => run.id)).toEqual([runId]);
    expect(runs.items[0]?.summary).toBe("Done: the parser refuses empty input.");

    // The board was told of all of it: as Alice, as the agent.
    const events = restEventsSchema.parse(
      await (await h.request(`${REST_ROUTES.events}?after=0`, { headers: { cookie: bob } })).json(),
    );
    const ofRun = events.items.filter((event) => event.runId === runId);
    expect(ofRun.map((event) => event.kind)).toEqual([
      "run.started",
      "run.reported",
      "run.handed_in",
      "decision.raised",
      "decision.answered",
      "run.ended",
    ]);
    expect(ofRun.find((event) => event.kind === "run.reported")?.data).toMatchObject({
      agent: "Claude Code on the laptop",
      excerpt: "Found it",
    });
    expect(
      ofRun
        .filter((event) => event.kind.startsWith("run."))
        .every((event) => event.actor?.login === "Alice"),
    ).toBe(true);
    expect(ofRun.find((event) => event.kind === "run.ended")?.data.status).toBe("finished");
    await client.close();
  });

  it("keeps an agent to its own runs, refuses a closed task, and lets a person give up on a run", async () => {
    const mine = await connect(aliceToken);
    const theirs = await connect(await tokenFor(bob));
    const task = await writeTask(alice, { title: "Write the docs" });
    const taken = jsonOf(
      await mine.callTool({ name: "take_task", arguments: { task: task.id, agent: "Codex" } }),
    );
    const runId = (taken.run as { id: string }).id;
    const notYours = await theirs.callTool({
      name: "report",
      arguments: { run: runId, body: "mine?" },
    });
    expect(notYours.isError).toBe(true);
    expect(textOf(notYours)).toContain("run.not_yours");
    // Reading is everyone's.
    expect(
      jsonOf(await theirs.callTool({ name: "get_task", arguments: { task: task.id } })).runs,
    ).toHaveLength(1);

    const closed = await writeTask(alice, { title: "Old news", state: "done" });
    const refused = await mine.callTool({
      name: "take_task",
      arguments: { task: closed.id, agent: "Codex" },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("run.task_closed");
    const nowhere = await mine.callTool({
      name: "take_task",
      arguments: { task: "#999999", agent: "Codex" },
    });
    expect(textOf(nowhere)).toContain("task.not_found");
    const tooLong = await mine
      .callTool({ name: "take_task", arguments: { task: task.id, agent: "x".repeat(500) } })
      .then(
        (result) => (result.isError === true ? "refused" : "accepted"),
        () => "refused",
      );
    expect(tooLong).toBe("refused");

    // A person gives up on a run that will not come back: the one it is for, or an administrator.
    const abandon = (cookie: string, id: string) =>
      h.request(`${REST_ROUTES.runs}/${id}/abandon`, {
        method: "POST",
        headers: { cookie, origin: SIGN_IN_URL },
      });
    const byBob = await abandon(bob, runId);
    expect(byBob.status).toBe(403);
    expect(restErrorSchema.parse(await byBob.json()).error.code).toBe("run.not_yours");
    const byAlice = await abandon(alice, runId);
    expect(byAlice.status).toBe(200);
    expect(restRunSchema.parse(await byAlice.json())).toMatchObject({
      status: "abandoned",
      endedAt: expect.any(String),
    });
    expect((await abandon(alice, runId)).status).toBe(409);
    expect((await readTask(alice, task.id)).state).toBe("in_progress");
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["carol"],
    });
    const carol = await named.signIn("carol");
    const second = jsonOf(
      await mine.callTool({ name: "take_task", arguments: { task: task.id, agent: "Codex" } }),
    );
    const byAdmin = await named.request(
      `${REST_ROUTES.runs}/${(second.run as { id: string }).id}/abandon`,
      {
        method: "POST",
        headers: { cookie: carol, origin: SIGN_IN_URL },
      },
    );
    expect(byAdmin.status).toBe(200);
    await mine.close();
    await theirs.close();
  });
});
