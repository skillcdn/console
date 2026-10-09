import {
  REST_ROUTES,
  restDecisionSchema,
  restErrorSchema,
  restEventsSchema,
  restRunSchema,
  restRunsSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// An agent at work through the REST API, as the command line drives it: with a token and no
// origin, as its person.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let aliceToken: string;

const JSON_HEADERS = { "content-type": "application/json" };

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
  aliceToken = await tokenFor(h, alice, "Claude Code on the laptop");
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

async function tokenFor(on: Harness, cookie: string, name: string): Promise<string> {
  const made = await on.request(REST_ROUTES.tokens, {
    method: "POST",
    headers: { cookie, origin: SIGN_IN_URL, ...JSON_HEADERS },
    body: JSON.stringify({ name }),
  });
  expect(made.status).toBe(201);
  return restTokenCreatedSchema.parse(await made.json()).secret;
}

/** A request from a person's browser, on the console's own pages. */
const asPerson = (cookie: string, method: "GET" | "POST", path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: { cookie, origin: SIGN_IN_URL, ...(body === undefined ? {} : JSON_HEADERS) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A request from an agent: its token, no origin, as the command line sends one. */
const asAgent = (token: string, method: "GET" | "POST", path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_HEADERS) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;

async function writeTask(cookie: string, body: unknown) {
  const written = await asPerson(cookie, "POST", REST_ROUTES.tasks, body);
  expect(written.status).toBe(201);
  return restTaskSchema.parse(await written.json());
}

const readTask = async (ref: string) =>
  restTaskSchema.parse(
    await (await asAgent(aliceToken, "GET", `${REST_ROUTES.tasks}/${ref}`)).json(),
  );
const readRun = async (id: string) =>
  restRunSchema.parse(await (await asAgent(aliceToken, "GET", `${REST_ROUTES.runs}/${id}`)).json());
const startRun = async (token: string, taskId: string) => {
  const taken = await asAgent(token, "POST", REST_ROUTES.runs, { taskId });
  expect(taken.status).toBe(201);
  return restRunSchema.parse(await taken.json());
};

describe("runs", () => {
  it("begin when an agent takes a task, carry what it reports and hands in, wait for a decision, and end", async () => {
    const nothing = await asAgent(aliceToken, "GET", REST_ROUTES.tasks);
    expect(restTasksSchema.parse(await nothing.json()).items).toEqual([]);

    // A person writes a task; the agent reads it by its number, as people say it.
    const task = await writeTask(bob, {
      title: "Fix the parser",
      body: "It fails on empty input.",
      state: "ready",
    });
    expect(await readTask(String(task.number))).toMatchObject({
      id: task.id,
      body: "It fails on empty input.",
    });
    expect((await asAgent(aliceToken, "GET", `${REST_ROUTES.tasks}/999999`)).status).toBe(404);

    // The agent takes it, called what Alice called its token: the task is hers and at work.
    const run = await startRun(aliceToken, task.id);
    expect(run).toMatchObject({
      status: "running",
      agent: "Claude Code on the laptop",
      taskId: task.id,
      taskNumber: task.number,
      reports: [],
      artifacts: [],
      waitingFor: null,
    });
    expect(run.person.login).toBe("Alice");
    const atWork = await readTask(task.id);
    expect(atWork).toMatchObject({ state: "in_progress", openRuns: 1 });
    expect(atWork.assignee?.login).toBe("Alice");
    const again = await asAgent(aliceToken, "POST", REST_ROUTES.runs, {
      taskId: task.id,
      agent: "another",
    });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("run.task_taken");

    // It reports and hands in; a report says something, and only https is handed in.
    const reported = await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/${run.id}/reports`, {
      body: "# Found it\n\nThe parser trusts its input.",
    });
    expect(reported.status).toBe(201);
    expect(restRunSchema.parse(await reported.json()).reports).toHaveLength(1);
    const silent = await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/${run.id}/reports`, {
      body: "  \n",
    });
    expect(silent.status).toBe(400);
    const handed = await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/${run.id}/artifacts`, {
      url: "https://github.com/acme/app/pull/3",
      label: "the fix",
    });
    expect(handed.status).toBe(201);
    expect(restRunSchema.parse(await handed.json()).artifacts[0]).toMatchObject({
      url: "https://github.com/acme/app/pull/3",
      label: "the fix",
    });
    const insecure = await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/${run.id}/artifacts`, {
      url: "http://insecure.test/x",
    });
    expect(insecure.status).toBe(400);
    expect(await errorOf(insecure)).toBe("request.invalid");

    // It asks: the decision is about the run's task, and the run waits.
    const asked = await asAgent(aliceToken, "POST", REST_ROUTES.decisions, {
      question: "Keep the old behaviour?",
      body: "Both are defensible.",
      options: [{ label: "Keep it" }, { label: "Change it" }],
      runId: run.id,
    });
    expect(asked.status).toBe(201);
    const decision = restDecisionSchema.parse(await asked.json());
    expect(decision).toMatchObject({
      taskId: task.id,
      taskNumber: task.number,
      run: { id: run.id, agent: "Claude Code on the laptop" },
      answer: null,
    });
    expect(await readRun(run.id)).toMatchObject({ status: "waiting", waitingFor: decision.id });

    // A read that waits comes back when the server's while is over, the decision still waiting,
    // and at once when a person answers on the board meanwhile.
    const began = Date.now();
    const stillWaiting = await asAgent(
      aliceToken,
      "GET",
      `${REST_ROUTES.decisions}/${decision.id}?wait=30`,
    );
    expect(stillWaiting.status).toBe(200);
    expect(restDecisionSchema.parse(await stillWaiting.json()).answer).toBeNull();
    expect(Date.now() - began).toBeGreaterThanOrEqual(300);
    const pending = asAgent(aliceToken, "GET", `${REST_ROUTES.decisions}/${decision.id}?wait=30`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const answered = await asPerson(bob, "POST", `${REST_ROUTES.decisions}/${decision.id}/answer`, {
      option: "2",
      note: "Change it, carefully.",
    });
    expect(answered.status).toBe(200);
    const outcome = restDecisionSchema.parse(await (await pending).json());
    expect(outcome.answer).toMatchObject({ option: "2", note: "Change it, carefully." });
    expect(outcome.answer?.by.login).toBe("bob");
    expect(await readRun(run.id)).toMatchObject({ status: "running", waitingFor: null });
    expect(
      (await asAgent(aliceToken, "GET", `${REST_ROUTES.decisions}/${decision.id}?wait=x`)).status,
    ).toBe(400);

    // It finishes: the task goes up for review, and the run takes nothing more.
    const finished = await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/${run.id}/end`, {
      status: "finished",
      summary: "Done: the parser refuses empty input.",
    });
    expect(finished.status).toBe(200);
    expect(restRunSchema.parse(await finished.json())).toMatchObject({
      status: "finished",
      summary: "Done: the parser refuses empty input.",
      endedAt: expect.any(String),
    });
    expect(await readTask(task.id)).toMatchObject({ state: "in_review", openRuns: 0 });
    const late = await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/${run.id}/reports`, {
      body: "late",
    });
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe("run.over");
    const onTask = restRunsSchema.parse(
      await (await asAgent(aliceToken, "GET", `${REST_ROUTES.runs}?task=${task.id}`)).json(),
    );
    expect(onTask.items.map((item) => item.id)).toEqual([run.id]);

    // The board was told of all of it: as Alice, as the agent.
    const events = restEventsSchema.parse(
      await (await asPerson(bob, "GET", `${REST_ROUTES.events}?after=0`)).json(),
    );
    const ofRun = events.items.filter((event) => event.runId === run.id);
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
  });

  it("are listed by task, open or over, and as one's own: a person's, or those begun with one token", async () => {
    const task = await writeTask(alice, { title: "Write the docs" });
    const other = await writeTask(alice, { title: "Write the tests" });
    const codex = await tokenFor(h, alice, "Codex");
    const mine = await startRun(aliceToken, task.id);
    const theirs = await startRun(codex, other.id);
    const list = async (token: string, query: string) =>
      restRunsSchema
        .parse(await (await asAgent(token, "GET", `${REST_ROUTES.runs}${query}`)).json())
        .items.map((item) => item.id);
    expect(await list(aliceToken, "?open=true&mine=true")).toEqual([mine.id]);
    expect(await list(codex, "?open=true&mine=true")).toEqual([theirs.id]);
    // On a session, one's own runs are all those for the person.
    const ofAlice = restRunsSchema.parse(
      await (await asPerson(alice, "GET", `${REST_ROUTES.runs}?mine=true&open=true`)).json(),
    );
    expect(ofAlice.items.map((item) => item.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(
      restRunsSchema.parse(
        await (await asPerson(bob, "GET", `${REST_ROUTES.runs}?mine=true`)).json(),
      ).items,
    ).toEqual([]);
    const failed = await asAgent(codex, "POST", `${REST_ROUTES.runs}/${theirs.id}/end`, {
      status: "failed",
      summary: "Could not.",
    });
    expect(failed.status).toBe(200);
    expect(await list(codex, "?open=true&mine=true")).toEqual([]);
    expect(await list(codex, "?open=false&mine=true")).toEqual([theirs.id]);
    expect((await asAgent(codex, "GET", `${REST_ROUTES.runs}?open=maybe`)).status).toBe(400);
    expect(
      (
        await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/${mine.id}/end`, {
          status: "abandoned",
        })
      ).status,
    ).toBe(200);
  });

  it("keep a run to its agent, refuse a closed task and a decision from another's run, and let a person give up on one", async () => {
    const bobToken = await tokenFor(h, bob, "Bob's agent");
    const task = await writeTask(alice, { title: "Write the changelog" });
    const run = await startRun(aliceToken, task.id);
    const notYours = await asAgent(bobToken, "POST", `${REST_ROUTES.runs}/${run.id}/reports`, {
      body: "mine?",
    });
    expect(notYours.status).toBe(403);
    expect(await errorOf(notYours)).toBe("run.not_yours");
    const notYourAsk = await asAgent(bobToken, "POST", REST_ROUTES.decisions, {
      question: "May I?",
      options: [{ label: "a" }, { label: "b" }],
      runId: run.id,
    });
    expect(notYourAsk.status).toBe(400);
    expect(await errorOf(notYourAsk)).toBe("decision.invalid_run");
    // Reading is everyone's.
    expect((await asAgent(bobToken, "GET", `${REST_ROUTES.runs}/${run.id}`)).status).toBe(200);

    const closed = await writeTask(alice, { title: "Old news", state: "done" });
    const refused = await asAgent(aliceToken, "POST", REST_ROUTES.runs, { taskId: closed.id });
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("run.task_closed");
    const nowhere = await asAgent(aliceToken, "POST", REST_ROUTES.runs, {
      taskId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(nowhere.status).toBe(404);
    expect(await errorOf(nowhere)).toBe("run.task_not_found");
    const tooLong = await asAgent(aliceToken, "POST", REST_ROUTES.runs, {
      taskId: task.id,
      agent: "x".repeat(500),
    });
    expect(tooLong.status).toBe(400);
    expect(
      (await asAgent(aliceToken, "POST", `${REST_ROUTES.runs}/not-a-run/reports`, { body: "x" }))
        .status,
    ).toBe(404);

    // A person gives up on a run that will not come back: the one it is for, or an administrator
    // on the console's own pages; an agent, with a token, never on another's.
    const giveUp = (cookie: string, id: string) =>
      asPerson(cookie, "POST", `${REST_ROUTES.runs}/${id}/end`, { status: "abandoned" });
    const byBob = await giveUp(bob, run.id);
    expect(byBob.status).toBe(403);
    expect(await errorOf(byBob)).toBe("run.not_yours");
    const byAlice = await giveUp(alice, run.id);
    expect(byAlice.status).toBe(200);
    expect(restRunSchema.parse(await byAlice.json())).toMatchObject({
      status: "abandoned",
      endedAt: expect.any(String),
    });
    expect((await giveUp(alice, run.id)).status).toBe(409);
    expect((await readTask(task.id)).state).toBe("in_progress");

    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["carol"],
    });
    const carol = await named.signIn("carol");
    const carolToken = await tokenFor(named, carol, "Carol's agent");
    const second = await startRun(aliceToken, task.id);
    const byAdminToken = await asAgent(carolToken, "POST", `${REST_ROUTES.runs}/${second.id}/end`, {
      status: "abandoned",
    });
    expect(byAdminToken.status).toBe(403);
    const byAdmin = await named.request(`${REST_ROUTES.runs}/${second.id}/end`, {
      method: "POST",
      headers: { cookie: carol, origin: SIGN_IN_URL, ...JSON_HEADERS },
      body: JSON.stringify({ status: "abandoned" }),
    });
    expect(byAdmin.status).toBe(200);
    await named.close();
  });
});
