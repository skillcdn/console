import { createHash } from "node:crypto";
import {
  MAX_FILE_BYTES,
  projectPath,
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
// origin, as its person, in a project.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let aliceToken: string;
/** The project the tests work in, open to the workspace, under its key. */
const IN = projectPath("web");

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
  await h.project(alice, { key: "web", name: "The web app", visibility: "workspace" });
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

async function writeTask(cookie: string, body: unknown, at = IN) {
  const written = await asPerson(cookie, "POST", `${at}/tasks`, body);
  expect(written.status).toBe(201);
  return restTaskSchema.parse(await written.json());
}

const readTask = async (ref: string) =>
  restTaskSchema.parse(await (await asAgent(aliceToken, "GET", `${IN}/tasks/${ref}`)).json());
const readRun = async (id: string) =>
  restRunSchema.parse(await (await asAgent(aliceToken, "GET", `${IN}/runs/${id}`)).json());
const startRun = async (token: string, taskId: string, at = IN) => {
  const taken = await asAgent(token, "POST", `${at}/runs`, { taskId });
  expect(taken.status).toBe(201);
  return restRunSchema.parse(await taken.json());
};

describe("runs", () => {
  it("begin when an agent takes a task, carry what it reports and hands in, wait for a decision, and end", async () => {
    const nothing = await asAgent(aliceToken, "GET", `${IN}/tasks`);
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
    expect((await asAgent(aliceToken, "GET", `${IN}/tasks/999999`)).status).toBe(404);

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
    const again = await asAgent(aliceToken, "POST", `${IN}/runs`, {
      taskId: task.id,
      agent: "another",
    });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("run.task_taken");

    // It reports and hands in; a report says something, and only https is handed in.
    const reported = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/reports`, {
      body: "# Found it\n\nThe parser trusts its input.",
    });
    expect(reported.status).toBe(201);
    expect(restRunSchema.parse(await reported.json()).reports).toHaveLength(1);
    const silent = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/reports`, {
      body: "  \n",
    });
    expect(silent.status).toBe(400);
    const handed = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/artifacts`, {
      url: "https://github.com/acme/app/pull/3",
      label: "the fix",
    });
    expect(handed.status).toBe(201);
    expect(restRunSchema.parse(await handed.json()).artifacts[0]).toMatchObject({
      url: "https://github.com/acme/app/pull/3",
      label: "the fix",
    });
    const insecure = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/artifacts`, {
      url: "http://insecure.test/x",
    });
    expect(insecure.status).toBe(400);
    expect(await errorOf(insecure)).toBe("request.invalid");

    // It asks: the decision is about the run's task, and the run waits.
    const asked = await asAgent(aliceToken, "POST", `${IN}/decisions`, {
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
    const stillWaiting = await asAgent(aliceToken, "GET", `${IN}/decisions/${decision.id}?wait=30`);
    expect(stillWaiting.status).toBe(200);
    expect(restDecisionSchema.parse(await stillWaiting.json()).answer).toBeNull();
    expect(Date.now() - began).toBeGreaterThanOrEqual(300);
    const pending = asAgent(aliceToken, "GET", `${IN}/decisions/${decision.id}?wait=30`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const answered = await asPerson(bob, "POST", `${IN}/decisions/${decision.id}/answer`, {
      option: "2",
      note: "Change it, carefully.",
    });
    expect(answered.status).toBe(200);
    const outcome = restDecisionSchema.parse(await (await pending).json());
    expect(outcome.answer).toMatchObject({ option: "2", note: "Change it, carefully." });
    expect(outcome.answer?.by.login).toBe("bob");
    expect(await readRun(run.id)).toMatchObject({ status: "running", waitingFor: null });
    expect((await asAgent(aliceToken, "GET", `${IN}/decisions/${decision.id}?wait=x`)).status).toBe(
      400,
    );

    // It finishes: the task goes up for review, and the run takes nothing more.
    const finished = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/end`, {
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
    const late = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/reports`, {
      body: "late",
    });
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe("run.over");
    const onTask = restRunsSchema.parse(
      await (await asAgent(aliceToken, "GET", `${IN}/runs?task=${task.id}`)).json(),
    );
    expect(onTask.items.map((item) => item.id)).toEqual([run.id]);

    // The board was told of all of it: as Alice, through the agent; and the task's history
    // says so for what the run did to the task itself.
    const events = restEventsSchema.parse(
      await (await asPerson(bob, "GET", `${IN}/events?run=${run.id}`)).json(),
    );
    expect(events.items.map((event) => event.kind)).toEqual([
      "run.started",
      "run.reported",
      "run.handed_in",
      "decision.raised",
      "decision.answered",
      "run.ended",
    ]);
    expect(events.items.find((event) => event.kind === "run.reported")?.data).toMatchObject({
      agent: "Claude Code on the laptop",
      excerpt: "Found it",
    });
    expect(
      events.items
        .filter((event) => event.kind !== "decision.answered")
        .every(
          (event) => event.actor?.login === "Alice" && event.agent === "Claude Code on the laptop",
        ),
    ).toBe(true);
    expect(events.items.find((event) => event.kind === "decision.answered")).toMatchObject({
      agent: null,
    });
    const history = restEventsSchema.parse(
      await (await asPerson(bob, "GET", `${IN}/events?task=${task.id}`)).json(),
    );
    expect(history.items.map((event) => [event.kind, event.agent])).toEqual([
      ["task.created", null],
      ["run.started", "Claude Code on the laptop"],
      ["task.moved", "Claude Code on the laptop"],
      ["task.updated", "Claude Code on the laptop"],
      ["run.reported", "Claude Code on the laptop"],
      ["run.handed_in", "Claude Code on the laptop"],
      ["decision.raised", "Claude Code on the laptop"],
      ["decision.answered", null],
      ["run.ended", "Claude Code on the laptop"],
      ["task.moved", "Claude Code on the laptop"],
    ]);
  });

  it("are listed by task, open or over, and as one's own: a person's, or those begun with one token", async () => {
    const task = await writeTask(alice, { title: "Write the docs" });
    const other = await writeTask(alice, { title: "Write the tests" });
    const codex = await tokenFor(h, alice, "Codex");
    const mine = await startRun(aliceToken, task.id);
    const theirs = await startRun(codex, other.id);
    const list = async (token: string, query: string) =>
      restRunsSchema
        .parse(await (await asAgent(token, "GET", `${IN}/runs${query}`)).json())
        .items.map((item) => item.id);
    expect(await list(aliceToken, "?open=true&mine=true")).toEqual([mine.id]);
    expect(await list(codex, "?open=true&mine=true")).toEqual([theirs.id]);
    // On a session, one's own runs are all those for the person.
    const ofAlice = restRunsSchema.parse(
      await (await asPerson(alice, "GET", `${IN}/runs?mine=true&open=true`)).json(),
    );
    expect(ofAlice.items.map((item) => item.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(
      restRunsSchema.parse(await (await asPerson(bob, "GET", `${IN}/runs?mine=true`)).json()).items,
    ).toEqual([]);
    const failed = await asAgent(codex, "POST", `${IN}/runs/${theirs.id}/end`, {
      status: "failed",
      summary: "Could not.",
    });
    expect(failed.status).toBe(200);
    expect(await list(codex, "?open=true&mine=true")).toEqual([]);
    expect(await list(codex, "?open=false&mine=true")).toEqual([theirs.id]);
    expect((await asAgent(codex, "GET", `${IN}/runs?open=maybe`)).status).toBe(400);
    expect(
      (await asAgent(aliceToken, "POST", `${IN}/runs/${mine.id}/end`, { status: "abandoned" }))
        .status,
    ).toBe(200);
  });

  it("keep a run to its agent and its project, refuse a closed task and a decision from another's run, and let a person give up on one", async () => {
    const bobToken = await tokenFor(h, bob, "Bob's agent");
    const task = await writeTask(alice, { title: "Write the changelog" });
    const run = await startRun(aliceToken, task.id);
    const notYours = await asAgent(bobToken, "POST", `${IN}/runs/${run.id}/reports`, {
      body: "mine?",
    });
    expect(notYours.status).toBe(403);
    expect(await errorOf(notYours)).toBe("run.not_yours");
    const notYourAsk = await asAgent(bobToken, "POST", `${IN}/decisions`, {
      question: "May I?",
      options: [{ label: "a" }, { label: "b" }],
      runId: run.id,
    });
    expect(notYourAsk.status).toBe(400);
    expect(await errorOf(notYourAsk)).toBe("decision.invalid_run");
    // Reading is everyone's in the project; another project does not find the run at all.
    expect((await asAgent(bobToken, "GET", `${IN}/runs/${run.id}`)).status).toBe(200);
    await h.project(alice, { key: "docs", name: "The docs", visibility: "workspace" });
    expect((await asAgent(bobToken, "GET", `${projectPath("docs")}/runs/${run.id}`)).status).toBe(
      404,
    );
    const elsewhere = await asAgent(
      aliceToken,
      "POST",
      `${projectPath("docs")}/runs/${run.id}/reports`,
      {
        body: "from the wrong project",
      },
    );
    expect(elsewhere.status).toBe(404);
    expect(await errorOf(elsewhere)).toBe("run.not_found");
    // A task of one project cannot be taken from another.
    const crossed = await asAgent(aliceToken, "POST", `${projectPath("docs")}/runs`, {
      taskId: task.id,
    });
    expect(crossed.status).toBe(404);
    expect(await errorOf(crossed)).toBe("run.task_not_found");

    const closed = await writeTask(alice, { title: "Old news", state: "done" });
    const refused = await asAgent(aliceToken, "POST", `${IN}/runs`, { taskId: closed.id });
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("run.task_closed");
    const nowhere = await asAgent(aliceToken, "POST", `${IN}/runs`, {
      taskId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(nowhere.status).toBe(404);
    expect(await errorOf(nowhere)).toBe("run.task_not_found");
    const tooLong = await asAgent(aliceToken, "POST", `${IN}/runs`, {
      taskId: task.id,
      agent: "x".repeat(500),
    });
    expect(tooLong.status).toBe(400);
    expect(
      (await asAgent(aliceToken, "POST", `${IN}/runs/not-a-run/reports`, { body: "x" })).status,
    ).toBe(404);

    // A person gives up on a run that will not come back: the one it is for, or an owner of the
    // project on the console's own pages; an agent, with a token, never on another's.
    const giveUp = (cookie: string, id: string) =>
      asPerson(cookie, "POST", `${IN}/runs/${id}/end`, { status: "abandoned" });
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
    // Giving up is the person's own doing, not an agent's: the event names no agent.
    const ended = restEventsSchema
      .parse(await (await asPerson(bob, "GET", `${IN}/events?run=${run.id}`)).json())
      .items.find((event) => event.kind === "run.ended");
    expect(ended).toMatchObject({ agent: null, data: { status: "abandoned" } });
    expect(ended?.actor?.login).toBe("Alice");

    // An administrator owns every project, and so may give up on anyone's run there, signed in.
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["carol"],
    });
    const carol = await named.signIn("carol");
    const carolToken = await tokenFor(named, carol, "Carol's agent");
    const second = await startRun(aliceToken, task.id);
    const byAdminToken = await asAgent(carolToken, "POST", `${IN}/runs/${second.id}/end`, {
      status: "abandoned",
    });
    expect(byAdminToken.status).toBe(403);
    const byAdmin = await named.request(`${IN}/runs/${second.id}/end`, {
      method: "POST",
      headers: { cookie: carol, origin: SIGN_IN_URL, ...JSON_HEADERS },
      body: JSON.stringify({ status: "abandoned" }),
    });
    expect(byAdmin.status).toBe(200);
    await named.close();
  });

  it("carry files handed in, which the console keeps and whoever may see the project reads back", async () => {
    const task = await writeTask(alice, { title: "Write the report" });
    const run = await startRun(aliceToken, task.id);
    const content = '# The report\n\nAll of it, <with> "quotes".\n';
    const bytes = new TextEncoder().encode(content);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const upload = (
      token: string,
      runId: string,
      file: { name: string; type?: string; bytes?: Uint8Array } | undefined,
      label?: string,
      at = IN,
    ) => {
      const form = new FormData();
      if (file !== undefined) {
        form.set(
          "file",
          new File([new Uint8Array(file.bytes ?? bytes)], file.name, { type: file.type ?? "" }),
          file.name,
        );
      }
      if (label !== undefined) {
        form.set("label", label);
      }
      return h.request(`${at}/runs/${runId}/files`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
    };

    // A file is handed in as the parts of a form: the bytes under their hash, the rest on the run.
    const handed = await upload(
      aliceToken,
      run.id,
      { name: "report <final>.md", type: "text/markdown; charset=utf-8" },
      "the report",
    );
    expect(handed.status).toBe(201);
    const [artifact] = restRunSchema.parse(await handed.json()).artifacts;
    expect(artifact).toMatchObject({
      kind: "file",
      url: null,
      label: "the report",
      file: {
        name: "report <final>.md",
        size: bytes.byteLength,
        contentType: "text/markdown",
        sha256,
      },
    });
    const id = artifact?.id ?? "";

    // Read back by the agent and by any person of the project, as it was, shown in place for a
    // kind a browser may show, and never sniffed; and not through another project.
    const byAgent = await asAgent(aliceToken, "GET", `${IN}/files/${id}`);
    expect(byAgent.status).toBe(200);
    expect(await byAgent.text()).toBe(content);
    expect(byAgent.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(byAgent.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(byAgent.headers.get("content-disposition")).toBe(
      "inline; filename=\"report <final>.md\"; filename*=UTF-8''report%20%3Cfinal%3E.md",
    );
    expect(byAgent.headers.get("x-content-type-options")).toBe("nosniff");
    expect(byAgent.headers.get("content-security-policy")).toContain("sandbox");
    expect(byAgent.headers.get("cache-control")).toBe("no-store");
    const byPerson = await h.request(`${IN}/files/${id}`, { headers: { cookie: bob } });
    expect(byPerson.status).toBe(200);
    expect(await byPerson.text()).toBe(content);
    expect((await h.request(`${IN}/files/${id}`)).status).toBe(401);
    expect((await asAgent(aliceToken, "GET", `${projectPath("docs")}/files/${id}`)).status).toBe(
      404,
    );

    // A kind a browser might run is handed over as bytes, to be saved; the same bytes handed in
    // again are kept once; a file without a label is called by its name on the board.
    const page = await upload(aliceToken, run.id, { name: "page.html", type: "text/html" });
    expect(page.status).toBe(201);
    const [, html] = restRunSchema.parse(await page.json()).artifacts;
    expect(html?.file).toMatchObject({ contentType: "text/html", sha256 });
    const asBytes = await asAgent(aliceToken, "GET", `${IN}/files/${html?.id ?? ""}`);
    expect(asBytes.headers.get("content-type")).toBe("application/octet-stream");
    expect(asBytes.headers.get("content-disposition")).toMatch(
      /^attachment; filename="page\.html"/,
    );
    expect(await asBytes.text()).toBe(content);
    const untyped = await upload(aliceToken, run.id, {
      name: "data.bin",
      bytes: new Uint8Array([0, 1, 2, 255]),
    });
    expect(restRunSchema.parse(await untyped.json()).artifacts[2]?.file).toMatchObject({
      contentType: "application/octet-stream",
      size: 4,
    });
    const events = restEventsSchema.parse(
      await (await asPerson(bob, "GET", `${IN}/events?run=${run.id}`)).json(),
    );
    expect(
      events.items
        .filter((event) => event.kind === "run.handed_in")
        .map((event) => event.data.label),
    ).toEqual(["the report", "page.html", "data.bin"]);

    // What is refused: no file, an empty one, a name that is a path, one over the limit, a file
    // on another's run, a file on a run of another project, and a read of what is not a file.
    const noFile = await upload(aliceToken, run.id, undefined, "nothing");
    expect(noFile.status).toBe(400);
    expect(await errorOf(noFile)).toBe("request.invalid");
    const empty = await upload(aliceToken, run.id, { name: "empty.txt", bytes: new Uint8Array() });
    expect(empty.status).toBe(400);
    const path = await upload(aliceToken, run.id, { name: "../etc/passwd" });
    expect(path.status).toBe(400);
    expect(restErrorSchema.parse(await path.json()).error.message).toContain("name");
    const huge = await upload(aliceToken, run.id, {
      name: "huge.bin",
      bytes: new Uint8Array(MAX_FILE_BYTES + 1),
    });
    expect(huge.status).toBe(413);
    expect(await errorOf(huge)).toBe("request.too_large");
    const bobToken = await tokenFor(h, bob, "Bob's agent");
    const notYours = await upload(bobToken, run.id, { name: "mine.md" });
    expect(notYours.status).toBe(403);
    expect(await errorOf(notYours)).toBe("run.not_yours");
    const crossed = await upload(
      aliceToken,
      run.id,
      { name: "mine.md" },
      undefined,
      projectPath("docs"),
    );
    expect(crossed.status).toBe(404);
    const link = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/artifacts`, {
      url: "https://github.com/acme/app/pull/4",
    });
    const linkId = restRunSchema.parse(await link.json()).artifacts.at(-1)?.id ?? "";
    expect((await asAgent(aliceToken, "GET", `${IN}/files/${linkId}`)).status).toBe(404);
    expect(
      (await asAgent(aliceToken, "GET", `${IN}/files/0199c4d8-0000-7000-8000-0000000000ff`)).status,
    ).toBe(404);
    expect((await asAgent(aliceToken, "GET", `${IN}/files/not-an-id`)).status).toBe(404);
    const ended = await asAgent(aliceToken, "POST", `${IN}/runs/${run.id}/end`, {
      status: "finished",
    });
    expect(ended.status).toBe(200);
    const late = await upload(aliceToken, run.id, { name: "late.md" });
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe("run.over");
    expect(JSON.stringify(h.logs)).not.toContain("All of it");
  });
});
