import {
  connectPath,
  projectPath,
  REST_ROUTES,
  restErrorSchema,
  restEventsSchema,
  restRunSchema,
  restTaskSchema,
  restTokenCreatedSchema,
  restTokensSchema,
} from "@skillcdn/console/api";
import { type CliIo, EXIT, runCli } from "@skillcdn/console/cli";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The command line against the app, through its `fetch` and no socket: an agent working a task
// as its person, in the project the environment or the directory names, from taking it to
// finishing it, with a person answering on the board meanwhile.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let aliceToken: string;
/** The project the tests work in, under its key. */
const IN = projectPath("web");
/** The first bytes of a PNG, which is all the console reads of an image's kind. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

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
  await h.project(alice, { key: "web", name: "The web app", visibility: "workspace" });
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
  const written = await h.request(`${IN}/tasks`, {
    method: "POST",
    headers: { cookie, ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
  expect(written.status).toBe(201);
  return restTaskSchema.parse(await written.json());
}

const readTask = async (cookie: string, id: string) =>
  restTaskSchema.parse(
    await (await h.request(`${IN}/tasks/${id}`, { headers: { cookie } })).json(),
  );
const readRun = async (cookie: string, id: string) =>
  restRunSchema.parse(await (await h.request(`${IN}/runs/${id}`, { headers: { cookie } })).json());

/** What the working directory says of the project, kept in memory. */
function memoryDirectory(initial?: { project: string }) {
  let kept = initial;
  return {
    store: {
      load: async () => kept,
      save: async (settings: { project: string }) => {
        kept = settings;
        return "/work/app/.skillcdn-console.json";
      },
    },
    kept: () => kept,
  };
}

/** Runs the command as the holder of `token`, against the app, in the project the environment names. */
async function console_(
  args: readonly string[],
  token = aliceToken,
  options: {
    readonly project?: string | undefined;
    readonly directory?: ReturnType<typeof memoryDirectory>;
    /** The console to run against; the shared one when left out. */
    readonly harness?: Harness | undefined;
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const project = "project" in options ? options.project : "web";
  const io: CliIo = {
    env: {
      CONSOLE_URL: SIGN_IN_URL,
      CONSOLE_TOKEN: token,
      ...(project === undefined ? {} : { CONSOLE_PROJECT: project }),
    },
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    fetch: async (url, init) => (options.harness ?? h).app.fetch(new Request(url, init)),
    readStdin: async () => "",
    readFile: async () => {
      throw new Error("no files here");
    },
    readBytes: async (path) =>
      path === "report.md"
        ? new TextEncoder().encode("# The report\n\nAll of it.\n")
        : path === "mark.png"
          ? PNG
          : Promise.reject(new Error("no such file")),
    writeBytes: async () => {
      throw new Error("nowhere to write");
    },
    store: {
      load: async () => undefined,
      save: async () => "nowhere",
      clear: async () => undefined,
    },
    directory: (options.directory ?? memoryDirectory()).store,
    sleep,
    now: () => Date.now(),
  };
  const code = await runCli(args, io);
  return { code, out: out.join(""), err: err.join("") };
}

describe("the command line", () => {
  it("connects with a code a person approves, and holds the token from then on", async () => {
    const out: string[] = [];
    let kept: Parameters<CliIo["store"]["save"]>[0] | undefined;
    const io: CliIo = {
      env: {},
      stdout: (text) => {
        out.push(text);
      },
      stderr: () => undefined,
      fetch: async (url, init) => h.app.fetch(new Request(url, init)),
      readStdin: async () => "",
      hostname: "laptop",
      readFile: async () => {
        throw new Error("no files here");
      },
      readBytes: async () => {
        throw new Error("no files here");
      },
      writeBytes: async () => {
        throw new Error("nowhere to write");
      },
      store: {
        load: async () => kept,
        save: async (credentials) => {
          kept = credentials;
          return "nowhere";
        },
        clear: async () => undefined,
      },
      directory: memoryDirectory().store,
      sleep,
      now: () => Date.now(),
    };
    // The command waits for the approval; the person gives it meanwhile, from the pages.
    const login = runCli(["login", "--url", SIGN_IN_URL, "--agent", "Claude Code"], io);
    let code: string | undefined;
    for (let tries = 0; code === undefined && tries < 50; tries += 1) {
      await sleep(20);
      code = out.join("").match(/code ([A-Z2-9]{4}-[A-Z2-9]{4})/)?.[1];
    }
    if (code === undefined) {
      throw new Error("the command showed no code");
    }
    expect(out.join("")).toContain(`${SIGN_IN_URL}/connect/${code}`);
    const approved = await h.request(connectPath(code, "approve"), {
      method: "POST",
      headers: { cookie: bob, ...JSON_HEADERS },
      body: JSON.stringify({ name: "Claude Code for Bob", expiresInDays: 30 }),
    });
    expect(approved.status).toBe(200);
    expect(await login).toBe(EXIT.ok);
    expect(out.join("")).toContain('Connected as "Claude Code for Bob" to');
    expect(out.join("")).toContain("as bob (");
    expect(out.join("")).not.toContain("cns_");
    expect(kept?.logins[0]?.token).toMatch(/^cns_t_/);
    // The token works as Bob's: his agents list it, and he takes it away again.
    const listed = await h.request(REST_ROUTES.tokens, { headers: { cookie: bob } });
    const mine = restTokensSchema.parse(await listed.json()).items;
    const held = mine.find((token) => token.name === "Claude Code for Bob");
    expect(held).toBeDefined();
    const removed = await h.request(`${REST_ROUTES.tokens}/${held?.id}`, {
      method: "DELETE",
      headers: { cookie: bob, origin: SIGN_IN_URL },
    });
    expect(removed.status).toBe(204);
  });

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
    // A file is handed in as its bytes, and the console keeps it.
    const file = await console_(["hand-in", "report.md", "--label", "the report"]);
    expect(file.code, file.err).toBe(EXIT.ok);
    expect(file.out).toMatch(/^Handed in the file report\.md \(\d+ bytes\) on run /);
    expect(file.out).toContain("2 artifacts so far.");
    const nowhere = await console_(["hand-in", "missing.bin"]);
    expect(nowhere.code).toBe(EXIT.failed);
    expect(nowhere.err).toContain("No file could be read at missing.bin");
    const kept = (await readRun(bob, runId)).artifacts.find((artifact) => artifact.kind === "file");
    expect(kept).toMatchObject({
      url: null,
      label: "the report",
      file: { name: "report.md", contentType: "text/markdown" },
    });
    const bytes = await h.request(`${IN}/files/${kept?.id ?? ""}`, { headers: { cookie: bob } });
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("# The report\n\nAll of it.\n");
    const shown = await console_(["run", runId]);
    expect(shown.out).toContain(`read at ${SIGN_IN_URL}${IN}/files/${kept?.id ?? ""}`);

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
    const answered = await h.request(`${IN}/decisions/${decisionId}/answer`, {
      method: "POST",
      headers: { cookie: bob, ...JSON_HEADERS },
      body: JSON.stringify({ option: "2", note: "Change it, carefully." }),
    });
    expect(answered.status).toBe(200);
    const outcome = await waiting;
    expect(outcome.code, outcome.err).toBe(EXIT.ok);
    expect(outcome.out).toContain("Answered: 2) Change it, by bob");
    expect(outcome.out).toContain("Note: Change it, carefully.");
    const taskShown = await console_(["task", String(task.number)]);
    expect(taskShown.out).toContain("answered 2");
    expect(taskShown.out).toContain(`${runId}  running  Claude Code on the laptop for Alice`);

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
    expect(late.err).toContain("run.none: no run of yours is open");
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

  it("works in the project the directory names, lists the projects, and refuses one it may not see", async () => {
    const none = await console_(["tasks"], aliceToken, { project: undefined });
    expect(none.code).toBe(EXIT.failed);
    expect(none.err).toContain("console use <key>");
    const directory = memoryDirectory();
    const used = await console_(["use", "web"], aliceToken, { project: undefined, directory });
    expect(used.code, used.err).toBe(EXIT.ok);
    expect(used.out).toContain("Working in The web app (web)");
    expect(directory.kept()).toEqual({ project: "web" });
    const fromDirectory = await console_(["tasks", "--state", "idea"], aliceToken, {
      project: undefined,
      directory,
    });
    expect(fromDirectory.code, fromDirectory.err).toBe(EXIT.ok);
    const listed = await console_(["projects"]);
    expect(listed.out).toContain("web  The web app  (owner");
    // A private project Bob made is not Alice's to see: not found, as if it were not there.
    await h.project(bob, { key: "secret", name: "Bob's own" });
    const hidden = await console_(["tasks", "--project", "secret"]);
    expect(hidden.code).toBe(EXIT.failed);
    expect(hidden.err).toContain("project.not_found");
    expect(hidden.err).toContain("console projects");
    expect((await console_(["projects"])).out).not.toContain("secret");
    const who = await console_(["whoami"]);
    expect(who.out).toBe(
      `Alice (member) at Acme, ${SIGN_IN_URL}; project web\nWhat this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command (console skills says where it is).\nThis command is of a version it does not know; the console is 0.1.18, built on SkillCDN 0.3, and takes >=0.1.0 <0.2.0.\n`,
    );
  });

  it("writes, reads, attaches to, archives and restores the project's pages as its person", async () => {
    const written = await console_([
      "write",
      "guides/onboarding",
      "--title",
      "Onboarding",
      "--body",
      "# Welcome\n\nSee [the plan](plan).",
    ]);
    expect(written.code, written.err).toBe(EXIT.ok);
    expect(written.out).toBe("Wrote guides/onboarding (Onboarding), version 1; refers to plan\n");
    const again = await console_(["write", "guides/onboarding", "--body", "# Welcome back"]);
    expect(again.code, again.err).toBe(EXIT.ok);
    expect(again.out).toBe("Wrote guides/onboarding (Onboarding), version 2\n");
    const stale = await console_(["write", "guides/onboarding", "--body", "older", "--base", "1"]);
    expect(stale.code).toBe(EXIT.failed);
    expect(stale.err).toContain("document.conflict");
    expect(stale.err).toContain("Read it again");
    const root = await console_(["docs"]);
    expect(root.out).toBe("guides/\n");
    const guides = await console_(["docs", "guides"]);
    expect(guides.out).toContain(
      "guides/onboarding  Onboarding  (v2, by Claude Code on the laptop for Alice;",
    );
    const found = await console_(["docs", "--search", "welcome"]);
    expect(found.out).toContain("guides/onboarding");
    const page = await console_(["doc", "guides/onboarding"]);
    expect(page.out).toContain(
      "guides/onboarding: Onboarding\nversion 2, by Claude Code on the laptop for Alice at",
    );
    expect(page.out).toContain("# Welcome back");
    const versions = await console_(["doc", "guides/onboarding", "--versions"]);
    expect(versions.out).toMatch(/^v2 {2}Onboarding .*\nv1 {2}Onboarding /);
    const attached = await console_([
      "attach",
      "guides/onboarding",
      "report.md",
      "--label",
      "the report",
    ]);
    expect(attached.code, attached.err).toBe(EXIT.ok);
    expect(attached.out).toContain("Attached report.md (");
    const withFile = await console_(["doc", "guides/onboarding"]);
    expect(withFile.out).toContain("files:\n  the report: report.md (");
    expect(withFile.out).toContain(`read at ${SIGN_IN_URL}${IN}/docs/guides%2Fonboarding/files/`);
    expect((await console_(["archive", "guides/onboarding"])).out).toContain(
      "Archived guides/onboarding",
    );
    expect((await console_(["docs", "guides"])).out).toBe("No pages here.\n");
    const archived = await console_(["write", "guides/onboarding", "--body", "while archived"]);
    expect(archived.code).toBe(EXIT.failed);
    expect(archived.err).toContain("console restore");
    expect((await console_(["restore", "guides/onboarding"])).out).toBe(
      "Restored guides/onboarding (Onboarding).\n",
    );
    const missing = await console_(["doc", "nowhere"]);
    expect(missing.code).toBe(EXIT.failed);
    expect(missing.err).toContain("document.not_found");
    expect(missing.err).toContain("console write");
    const untitled = await console_(["write", "nowhere", "--body", "x"]);
    expect(untitled.code).toBe(EXIT.usage);
    expect(untitled.err).toContain("Say its title");
  });

  it("reads the rules that hold, prints them with a task taken, and writes the project's as its person", async () => {
    const start = await console_(["rules"]);
    expect(start.code, start.err).toBe(EXIT.ok);
    expect(start.out).toContain(
      "Rules of the workspace: the console's own, until an administrator writes the organization's",
    );
    expect(start.out).toContain("# Rules for agents on this board");
    expect(start.out).toContain("Rules of this project: none of its own; the workspace's hold.");
    const written = await console_([
      "rules",
      "write",
      "--body",
      "# Rules of web\n\nAsk before pushing.",
    ]);
    expect(written.code, written.err).toBe(EXIT.ok);
    expect(written.out).toBe("Wrote this project's rules, version 1.\n");
    const task = await writeTask(alice, { title: "Read the rules", body: "Then work." });
    const taken = await console_(["take", String(task.number)]);
    expect(taken.code, taken.err).toBe(EXIT.ok);
    expect(taken.out).toMatch(
      /# Rules for agents on this board[\s\S]*Ask before pushing\.[\s\S]*Say how it goes/,
    );
    expect((await console_(["abandon"])).code).toBe(EXIT.ok);
    // A member's agent may not write them; the workspace's take an administrator, which nobody here is.
    const bobToken = await tokenFor(bob, "Codex for Bob");
    const refused = await console_(["rules", "write", "--body", "# Mine"], bobToken);
    expect(refused.code).toBe(EXIT.failed);
    expect(refused.err).toContain("auth.forbidden");
    const workspace = await console_(["rules", "write", "--workspace", "--body", "# Ours"]);
    expect(workspace.code).toBe(EXIT.failed);
    expect(workspace.err).toContain("auth.forbidden");
    const away = await console_(["rules", "write", "none"]);
    expect(away.code, away.err).toBe(EXIT.ok);
    expect(away.out).toBe("This project's rules are put away: it adds none now.\n");
    expect((await console_(["rules"])).out).toContain("none of its own");
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
    expect(whoami.out).toBe(
      `bob (member) at Acme, ${SIGN_IN_URL}; project web\nWhat this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command (console skills says where it is).\nThis command is of a version it does not know; the console is 0.1.18, built on SkillCDN 0.3, and takes >=0.1.0 <0.2.0.\n`,
    );
  });

  it("plans the work: a goal the owner sets, tasks written towards it with days and a category, and the board narrowed", async () => {
    const set = await console_([
      "goal",
      "new",
      "Ship v1",
      "--due",
      "2026-11-15",
      "--state",
      "active",
    ]);
    expect(set.code, set.err).toBe(EXIT.ok);
    const goalId = /id: ([0-9a-f-]{36})/.exec(set.out)?.[1] ?? "";
    expect(goalId).not.toBe("");
    const written = await console_([
      "task",
      "new",
      "Plan the launch",
      "--goal",
      goalId,
      "--category",
      "engineering",
      "--starts",
      "2026-10-20",
      "--due",
      "2026-10-24",
      "--assignee",
      "me",
    ]);
    expect(written.code, written.err).toBe(EXIT.ok);
    const number = /Task #(\d+) written/.exec(written.out)?.[1] ?? "";
    const shown = await console_(["task", number]);
    expect(shown.out).toContain(
      `category: engineering  goal: ${goalId}  starts: 2026-10-20  due: 2026-10-24`,
    );
    expect(shown.out).toContain("assignee: Alice");
    const narrowed = await console_(["tasks", "--category", "engineering", "--mine"]);
    expect(narrowed.out).toContain(`#${number}`);
    expect(narrowed.out).toContain("engineering; due 2026-10-24");
    expect((await console_(["tasks", "--category", "design"])).out).toBe("No tasks.\n");
    const goal = await console_(["goal", goalId]);
    expect(goal.out).toContain("progress: 0/1 done");
    expect(goal.out).toContain(`#${number}`);
    // Done: the board keeps the moment, and the goal counts it.
    const edited = await console_(["task", "edit", number, "--state", "done", "--due", "none"]);
    expect(edited.code, edited.err).toBe(EXIT.ok);
    expect(edited.out).toContain("done: ");
    expect(edited.out).not.toContain("due:");
    const reached = await console_(["goal", "edit", goalId, "--state", "done"]);
    expect(reached.code, reached.err).toBe(EXIT.ok);
    expect(reached.out).toContain("state: done");
    expect(reached.out).toContain("progress: 1/1 done");
    expect((await console_(["goals"])).out).toContain(`${goalId}  done  Ship v1`);
    expect((await console_(["categories"])).out).toContain("engineering  Engineering  (blue)");
    // The plate spans the projects and needs none named.
    const plate = await console_(["work"], aliceToken, { project: undefined });
    expect(plate.code, plate.err).toBe(EXIT.ok);
    expect(plate.out).toContain("decisions waiting");
    // Bob works in the project and may not set its roadmap; and what is not a plan is refused.
    const bobToken = await tokenFor(bob, "Codex on the desk");
    const refused = await console_(["goal", "new", "Bob's own"], bobToken);
    expect(refused.code).toBe(EXIT.failed);
    expect(refused.err).toContain("auth.forbidden");
    const wrongDay = await console_(["task", "new", "x", "--due", "soon"]);
    expect(wrongDay.code).toBe(EXIT.usage);
    const backwards = await console_([
      "task",
      "new",
      "x",
      "--starts",
      "2026-10-24",
      "--due",
      "2026-10-20",
    ]);
    expect(backwards.code).toBe(EXIT.failed);
    expect(backwards.err).toContain("task.invalid_dates");
    const noSuchCategory = await console_(["task", "new", "x", "--category", "nothing"]);
    expect(noSuchCategory.err).toContain("task.invalid_category");
    expect(noSuchCategory.err).toContain("console categories");
  });

  it("configures as its person: a project set up, its members, the categories and a role, with a token; refused as a member; never the tokens", async () => {
    // An administrator's agent, on a console that names her one (ADR-0021).
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["alice"],
    });
    const admin = await named.signIn("alice");
    const agent = restTokenCreatedSchema.parse(
      await (
        await named.request(REST_ROUTES.tokens, {
          method: "POST",
          headers: { cookie: admin, ...JSON_HEADERS },
          body: JSON.stringify({ name: "Claude Code setting up" }),
        })
      ).json(),
    ).secret;
    const as = (args: readonly string[], token = agent, project: string | undefined = "ops") =>
      console_(args, token, { harness: named, project });
    const made = await as([
      "project",
      "new",
      "ops",
      "Operations",
      "--description",
      "Runs the place.",
      "--visibility",
      "private",
      "--color",
      "teal",
      "--symbol",
      "OP",
    ]);
    expect(made.code, made.err).toBe(EXIT.ok);
    expect(made.out).toContain("Project made: Operations (ops)");
    const shown = await as(["project", "ops"]);
    expect(shown.out).toContain("visibility: private  role: owner  skills: the organization's");
    expect(shown.out).toContain("color: teal  symbol: OP  image: none");
    expect(shown.out).toContain("Runs the place.");
    const edited = await as(["project", "edit", "ops", "--name", "Ops", "--symbol", "none"]);
    expect(edited.code, edited.err).toBe(EXIT.ok);
    expect(edited.out).toContain("project ops: Ops");
    expect(edited.out).toContain("symbol: none");
    const pictured = await as(["project", "icon", "ops", "mark.png"]);
    expect(pictured.code, pictured.err).toBe(EXIT.ok);
    expect(pictured.out).toContain("image: image/png");
    expect((await as(["project", "icon", "ops", "--remove"])).out).toContain("image: none");
    // The members: Bob listed, made an owner, taken off the list.
    expect((await as(["members"])).out).toMatch(
      /^Alice {2}owner {2}\(since \d{4}-\d{2}-\d{2}\)\n$/,
    );
    const added = await as(["member", "add", "bob"]);
    expect(added.code, added.err).toBe(EXIT.ok);
    expect(added.out).toContain("bob  member  (since ");
    expect((await as(["member", "role", "bob", "owner"])).out).toContain("bob  owner  (since ");
    expect((await as(["members"])).out).toContain("bob  owner");
    expect((await as(["member", "remove", "bob"])).out).toBe(
      "bob is no longer listed in the project.\n",
    );
    // The people, and what one is; the categories.
    const people = await as(["people"], agent, undefined);
    expect(people.code, people.err).toBe(EXIT.ok);
    expect(people.out).toMatch(/^Alice .*\(admin\)$/m);
    expect(people.out).toMatch(/^bob .*\(member\)$/m);
    const promoted = await as(["person", "role", "bob", "admin"], agent, undefined);
    expect(promoted.code, promoted.err).toBe(EXIT.ok);
    expect(promoted.out).toMatch(/^bob .*\(admin\)\n$/);
    expect((await as(["person", "role", "bob", "member"], agent, undefined)).out).toMatch(
      /\(member\)\n$/,
    );
    const category = await as(
      ["category", "new", "research", "Research", "--color", "yellow"],
      agent,
      undefined,
    );
    expect(category.code, category.err).toBe(EXIT.ok);
    expect(category.out).toBe("research  Research  (yellow)\n");
    expect(
      (await as(["category", "edit", "research", "--name", "R and D"], agent, undefined)).out,
    ).toBe("research  R and D  (yellow)\n");
    expect((await as(["categories"], agent, undefined)).out).toContain(
      "research  R and D  (yellow)",
    );
    expect((await as(["category", "remove", "research"], agent, undefined)).out).toBe(
      "Category research removed.\n",
    );
    // Every one of these names the agent beside the person.
    const inProject = restEventsSchema.parse(
      await (
        await named.request(`${projectPath("ops")}/events?after=0`, {
          headers: { cookie: admin },
        })
      ).json(),
    ).items;
    expect(inProject.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "project.created",
        "project.updated",
        "project.member_added",
        "project.member_changed",
        "project.member_removed",
      ]),
    );
    for (const event of inProject) {
      expect(event.agent, event.kind).toBe("Claude Code setting up");
      expect(event.actor?.login, event.kind).toBe("Alice");
    }
    const inWorkspace = restEventsSchema
      .parse(
        await (
          await named.request(`${REST_ROUTES.events}?after=0`, { headers: { cookie: admin } })
        ).json(),
      )
      .items.filter((event) => event.agent === "Claude Code setting up")
      .map((event) => event.kind);
    expect(inWorkspace).toEqual([
      "person.role_changed",
      "person.role_changed",
      "category.created",
      "category.updated",
      "category.removed",
    ]);
    // A member's agent is refused what a member is; and the tokens are refused to any token.
    const bobToken = await tokenFor(bob, "Codex for Bob");
    for (const args of [
      ["project", "edit", "web", "--name", "Mine"],
      ["member", "add", "bob"],
      ["category", "new", "ops", "Ops"],
      ["person", "role", "Alice", "member"],
    ]) {
      const refused = await as(args, bobToken, "web");
      expect(refused.code, args.join(" ")).toBe(EXIT.failed);
      expect(refused.err, args.join(" ")).toContain("auth.forbidden");
    }
    const tokens = await named.request(REST_ROUTES.tokens, {
      headers: { authorization: `Bearer ${agent}` },
    });
    expect(tokens.status).toBe(403);
    expect(restErrorSchema.parse(await tokens.json()).error.code).toBe("auth.session_required");
  });
});
