import {
  REST_ROUTES,
  restRunSchema,
  restTaskSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { type CliIo, EXIT, runCli } from "@skillcdn/console/cli";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The command line against the app, through its `fetch` and no socket: an agent working a task
// as its person, from taking it to finishing it, with a person answering on the board meanwhile.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let aliceToken: string;

const JSON_HEADERS = { origin: SIGN_IN_URL, "content-type": "application/json" };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  aliceToken = await tokenFor(alice, "Claude Code on the laptop");
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

async function tokenFor(cookie: string, name: string): Promise<string> {
  const made = await h.request(REST_ROUTES.tokens, {
    method: "POST",
    headers: { cookie, ...JSON_HEADERS },
    body: JSON.stringify({ name }),
  });
  expect(made.status).toBe(201);
  return restTokenCreatedSchema.parse(await made.json()).secret;
}

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

/** Runs the command as the holder of `token`, against the app. */
async function console_(args: readonly string[], token = aliceToken) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    env: { CONSOLE_URL: SIGN_IN_URL, CONSOLE_TOKEN: token },
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    fetch: async (url, init) => h.app.fetch(new Request(url, init)),
    readStdin: async () => "",
    readSecret: async () => "",
    readFile: async () => {
      throw new Error("no files here");
    },
    store: {
      load: async () => undefined,
      save: async () => "nowhere",
      clear: async () => undefined,
    },
    sleep,
    now: () => Date.now(),
  };
  const code = await runCli(args, io);
  return { code, out: out.join(""), err: err.join("") };
}

describe("the command line", () => {
  it("works a task from taking it to finishing it, as its person, with a person deciding meanwhile", async () => {
    expect((await console_(["tasks"])).out).toBe("No tasks.\n");
    const task = await writeTask(bob, {
      title: "Fix the parser",
      body: "It fails on empty input.",
      state: "ready",
    });
    const listed = await console_(["tasks", "--state", "ready"]);
    expect(listed.out).toContain(`#${task.number}  ready  normal  Fix the parser`);

    // Taking it: the task is Alice's and at work, and the agent is told what it is about.
    const taken = await console_(["take", String(task.number)]);
    expect(taken.code, taken.err).toBe(EXIT.ok);
    expect(taken.out).toContain('as "Claude Code on the laptop" for Alice');
    expect(taken.out).toContain("It fails on empty input.");
    const runId = /Run ([0-9a-f-]{36}) began/.exec(taken.out)?.[1] ?? "";
    expect(runId).not.toBe("");
    expect(await readTask(bob, task.id)).toMatchObject({ state: "in_progress", openRuns: 1 });

    // Reporting and handing in find the one open run on their own.
    const reported = await console_(["report", "# Found it\n\nThe parser trusts its input."]);
    expect(reported.code, reported.err).toBe(EXIT.ok);
    expect(reported.out).toBe(`Reported on run ${runId}: 1 report so far.\n`);
    const handed = await console_([
      "hand-in",
      "https://github.com/acme/app/pull/3",
      "--label",
      "the fix",
    ]);
    expect(handed.code, handed.err).toBe(EXIT.ok);
    const insecure = await console_(["hand-in", "http://insecure.test/x"]);
    expect(insecure.code).toBe(EXIT.failed);
    expect(insecure.err).toContain("request.invalid");

    // Asking, and nobody answering in time: the run waits, and the command says so and exits 3.
    const asked = await console_([
      "ask",
      "Keep the old behaviour?",
      "--option",
      "Keep it",
      "--option",
      "Change it",
      "--wait",
      "1",
    ]);
    expect(asked.code, asked.err).toBe(EXIT.waiting);
    expect(asked.out).toContain("still waits for a person");
    const decisionId = /Decision ([0-9a-f-]{36}) raised/.exec(asked.out)?.[1] ?? "";
    expect(decisionId).not.toBe("");
    expect(await readRun(bob, runId)).toMatchObject({ status: "waiting", waitingFor: decisionId });

    // A person answers on the board while the command waits: it learns the answer at once.
    const waiting = console_(["decision", decisionId, "--wait", "10"]);
    await sleep(150);
    const answered = await h.request(`${REST_ROUTES.decisions}/${decisionId}/answer`, {
      method: "POST",
      headers: { cookie: bob, ...JSON_HEADERS },
      body: JSON.stringify({ option: "2", note: "Change it, carefully." }),
    });
    expect(answered.status).toBe(200);
    const outcome = await waiting;
    expect(outcome.code, outcome.err).toBe(EXIT.ok);
    expect(outcome.out).toContain("Answered: 2) Change it, by bob");
    expect(outcome.out).toContain("Note: Change it, carefully.");
    const shown = await console_(["task", String(task.number)]);
    expect(shown.out).toContain("answered 2");
    expect(shown.out).toContain(`${runId}  running  Claude Code on the laptop for Alice`);

    // Finishing: the task goes up for review, and there is no open run to report on any more.
    const finished = await console_([
      "finish",
      "--summary",
      "Done: the parser refuses empty input.",
    ]);
    expect(finished.code, finished.err).toBe(EXIT.ok);
    expect(finished.out).toContain("up for review");
    expect(await readTask(bob, task.id)).toMatchObject({ state: "in_review", openRuns: 0 });
    const late = await console_(["report", "late"]);
    expect(late.code).toBe(EXIT.failed);
    expect(late.err).toContain("No run of yours is open");
    const asJson = await console_(["run", runId, "--json"]);
    expect(restRunSchema.parse(JSON.parse(asJson.out))).toMatchObject({
      status: "finished",
      summary: "Done: the parser refuses empty input.",
      reports: [expect.objectContaining({ body: "# Found it\n\nThe parser trusts its input." })],
    });
    const mine = await console_(["runs", "--mine", "--task", String(task.number)]);
    expect(mine.out).toContain(`${runId}  finished`);
    expect(mine.out).toContain(`task #${task.number}`);
  });

  it("keeps an agent to its person's runs, and says when a token is nothing", async () => {
    const nobody = await console_(["tasks"], "cns_t_nonsense");
    expect(nobody.code).toBe(EXIT.failed);
    expect(nobody.err).toContain("auth.required");
    expect(nobody.err).toContain("console login");
    const bobToken = await tokenFor(bob, "Bob's agent");
    const task = await writeTask(alice, { title: "Write the docs" });
    const taken = await console_(["take", task.id, "--agent", "Codex"]);
    expect(taken.code, taken.err).toBe(EXIT.ok);
    const runId = /Run ([0-9a-f-]{36}) began/.exec(taken.out)?.[1] ?? "";
    const notYours = await console_(["report", "mine?", "--run", runId], bobToken);
    expect(notYours.code).toBe(EXIT.failed);
    expect(notYours.err).toContain("run.not_yours");
    const theirs = await console_(["runs", "--open", "--mine"], bobToken);
    expect(theirs.out).toBe("No runs.\n");
    const whoami = await console_(["whoami"], bobToken);
    expect(whoami.out).toBe(`bob (member) at Acme, ${SIGN_IN_URL}\n`);
  });
});
