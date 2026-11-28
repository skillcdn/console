import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Pack as CommandPack,
  PackError as CommandPackError,
  type PackRead,
  readPack,
} from "@skillcdn/cli";
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
import { parseAddress, type ToolWords } from "@skillcdn/core";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDirectorySource } from "./adapters/directory-packs.js";
import { createSkillCdnSource } from "./adapters/skillcdn.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { PackError } from "./ports/skill-source.js";
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
function memoryDirectory(initial?: { project: string; url?: string | undefined }) {
  let kept = initial;
  return {
    store: {
      load: async () => kept,
      save: async (settings: { project: string; url?: string | undefined }) => {
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
    // From a directory that names no project, a desk, what followed is written in the decision's
    // own project, found as the read finds the decision; one that is nowhere is said as that.
    const fromDesk = await console_(
      ["decision", decisionId, "--outcome", "Changed, as answered."],
      aliceToken,
      { project: undefined },
    );
    expect(fromDesk.code, fromDesk.err).toBe(EXIT.ok);
    expect(fromDesk.out).toContain("what followed:\n    Changed, as answered.");
    const outOfReach = await console_(
      ["decision", "0199c4d8-0000-7000-8000-00000000dead", "--outcome", "Nothing."],
      aliceToken,
      { project: undefined },
    );
    expect(outOfReach.code).toBe(EXIT.failed);
    expect(outOfReach.err).toContain("decision.not_found");
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
    expect(finished.out).toBe(`Run ${runId} finished; task #${task.number} is in_review now.\n`);
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
    // The file names the console too, whichever console is the default here (ADR-0112).
    expect(directory.kept()).toEqual({ project: "web", url: SIGN_IN_URL });
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
    // whoami asks the console for the project (ADR-0112): one that is not Alice's to see is not
    // found, with who she is and where still said, and the place the key came from.
    const elsewhere = await console_(["whoami"], aliceToken, { project: "secret" });
    expect(elsewhere.code).toBe(EXIT.failed);
    expect(elsewhere.out).toContain(
      `Alice (member) at Acme, ${SIGN_IN_URL}; project secret, named by CONSOLE_PROJECT, which this console does not have or does not show you\n`,
    );
    expect(elsewhere.err).toBe(
      `project.not_found: ${SIGN_IN_URL} has no project secret, or it is not yours to see. The key is named by CONSOLE_PROJECT.\nWhere the project is there and you are not in it, one of its owners lists you: console member add Alice --project secret. Where the key is wrong, CONSOLE_PROJECT is set to the right one, the key the repository's agreement names or the one the person says, or unset; console projects lists the projects you may work in at this console.\n`,
    );
    // The same of any command that works in that project, where the console's own line names nothing.
    for (const args of [["rules"], ["tasks"], ["take", "1"]]) {
      const refused = await console_(args, aliceToken, { project: "secret" });
      expect(refused.code, args.join(" ")).toBe(EXIT.failed);
      expect(refused.err, args.join(" ")).toBe(
        `project.not_found: ${SIGN_IN_URL} has no project secret, or it is not yours to see. The key is named by CONSOLE_PROJECT.\nWhere the project is there and you are not in it, one of its owners lists you: console member add <your login> --project secret. Where the key is wrong, CONSOLE_PROJECT is set to the right one, the key the repository's agreement names or the one the person says, or unset; console projects lists the projects you may work in at this console.\n`,
      );
    }
    // The directory's file is named as what decided, and no project named ends well.
    const bound = await console_(["whoami"], aliceToken, { project: undefined, directory });
    expect(bound.code, bound.err).toBe(EXIT.ok);
    expect(bound.out).toContain("; project web (The web app), named by .skillcdn-console.json\n");
    const unbound = await console_(["whoami"], aliceToken, { project: undefined });
    expect(unbound.code, unbound.err).toBe(EXIT.ok);
    expect(unbound.out).toContain("; no project named here\n");
    const who = await console_(["whoami"]);
    expect(who.out).toBe(
      `Alice (member) at Acme, ${SIGN_IN_URL}; project web (The web app), named by CONSOLE_PROJECT\nBefore the first task, read console rules and the skill working-the-board (console skills says where it is); for one command's flags, console help <command>.\nThis command is of a version it does not know; the console is 0.1.18 and takes >=0.1.0 <0.2.0; this command works with a console from 0.6.0 on.\n`,
    );
  });

  it("writes, reads, attaches to, archives and restores the project's pages as its person", async () => {
    const written = await console_([
      "doc",
      "write",
      "guides/onboarding",
      "--title",
      "Onboarding",
      "--body",
      "# Welcome\n\nSee [the plan](plan).",
    ]);
    expect(written.code, written.err).toBe(EXIT.ok);
    expect(written.out).toBe(
      "Wrote guides/onboarding (Onboarding), version 1; refers to plan\npage: https://console.test/projects/web/docs/guides/onboarding\n",
    );
    const again = await console_(["doc", "write", "guides/onboarding", "--body", "# Welcome back"]);
    expect(again.code, again.err).toBe(EXIT.ok);
    expect(again.out).toBe(
      "Wrote guides/onboarding (Onboarding), version 2\npage: https://console.test/projects/web/docs/guides/onboarding\n",
    );
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
      "doc",
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
    expect((await console_(["doc", "archive", "guides/onboarding"])).out).toContain(
      "Archived guides/onboarding",
    );
    expect((await console_(["docs", "guides"])).out).toBe("No pages here.\n");
    const archived = await console_(["write", "guides/onboarding", "--body", "while archived"]);
    expect(archived.code).toBe(EXIT.failed);
    expect(archived.err).toContain("console doc restore");
    expect((await console_(["restore", "guides/onboarding"])).out).toBe(
      "Restored guides/onboarding (Onboarding).\n",
    );
    const missing = await console_(["doc", "nowhere"]);
    expect(missing.code).toBe(EXIT.failed);
    expect(missing.err).toContain("document.not_found");
    expect(missing.err).toContain("console doc write");
    const untitled = await console_(["write", "nowhere", "--body", "x"]);
    expect(untitled.code).toBe(EXIT.usage);
    expect(untitled.err).toContain("Say its title");
  });

  it("reads the rules that hold, prints them with a task taken, and writes the project's as its person", async () => {
    const start = await console_(["rules"]);
    expect(start.code, start.err).toBe(EXIT.ok);
    expect(start.out).toContain("The console's rules, which always hold:");
    expect(start.out).toContain("# Rules for agents on this board");
    // The first line says what follows, before any text (ADR-0119, ADR-0120): here, that the
    // project and the organization add nothing, with the mark of the rules as they stand.
    expect(start.out).toMatch(
      /^Rules [0-9a-f]{8}: this project and the organization add nothing; the console's follow \(\d+ characters\)\. A later take in this session leaves them out: console take <number> --rules [0-9a-f]{8}\n/,
    );
    const bare = /^Rules ([0-9a-f]{8}): /.exec(start.out)?.[1] ?? "";
    const written = await console_([
      "rules",
      "write",
      "--body",
      "# Rules of web\n\nAsk before pushing.",
    ]);
    expect(written.code, written.err).toBe(EXIT.ok);
    expect(written.out).toBe("Wrote what this project adds to the rules, version 1.\n");
    const task = await writeTask(alice, { title: "Read the rules", body: "Then work." });
    const taken = await console_(["take", String(task.number)]);
    expect(taken.code, taken.err).toBe(EXIT.ok);
    // What the project adds stands first now, under a line that says so, then the console's.
    expect(taken.out).toMatch(
      /\nRules [0-9a-f]{8}: this project's additions first \(\d+ characters\), then the console's \(\d+ characters\), the earlier holding where they differ; the organization adds nothing\. A later take in this session leaves them out: console take <number> --rules [0-9a-f]{8}\n/,
    );
    expect(taken.out).toMatch(
      /Ask before pushing\.[\s\S]*# Rules for agents on this board[\s\S]*Say how it goes/,
    );
    // Given up, the task is back as the take found it, an idea, and the command says where it
    // is from what the console answers once the run is over.
    const left = await console_(["abandon"]);
    expect(left.code, left.err).toBe(EXIT.ok);
    expect(left.out).toMatch(
      new RegExp(`^Run [0-9a-f-]{36} abandoned; task #${task.number} is idea now\\.\\n$`),
    );
    // The mark changed with the project's rules: a take that names the mark of before gets the
    // rules whole and is told so; one that names the mark they have now gets a line in their place.
    const mark = /\nRules ([0-9a-f]{8}): /.exec(taken.out)?.[1] ?? "";
    expect(mark).not.toBe(bare);
    const stale = await console_(["take", String(task.number), "--rules", bare]);
    expect(stale.code, stale.err).toBe(EXIT.ok);
    expect(stale.out).toContain(
      "The rules are not the ones marked " +
        bare +
        ": they changed since, or that mark is of another project's. They follow whole after the task, under the mark they have now.\n\n#",
    );
    // Before the task, and the rules whole after it.
    expect(stale.out.indexOf("The rules are not the ones marked")).toBeLessThan(
      stale.out.indexOf("Then work."),
    );
    expect(stale.out).toContain(`\nRules ${mark}: `);
    expect(stale.out).toContain("Ask before pushing.");
    expect((await console_(["abandon"])).code).toBe(EXIT.ok);
    const held = await console_(["take", String(task.number), "--rules", mark]);
    expect(held.code, held.err).toBe(EXIT.ok);
    expect(held.out).toContain(
      "\nRules " +
        mark +
        ": left out, since they stand as this session read them. console rules prints them.\n\n#",
    );
    expect(held.out).not.toContain("Ask before pushing.");
    expect(held.out).not.toContain("# Rules for agents on this board");
    // Failed, the task is up for review, and the command says so as the console answers it.
    const failed = await console_(["fail", "--summary", "Could not be done."]);
    expect(failed.code, failed.err).toBe(EXIT.ok);
    expect(failed.out).toMatch(
      new RegExp(`^Run [0-9a-f-]{36} failed; task #${task.number} is in_review now\\.\\n$`),
    );
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
    expect(away.out).toBe(
      "What this project adds to the rules is put away: it adds nothing now.\n",
    );
    // Put away, the rules are the ones of before, and so is their mark.
    const after = await console_(["rules"]);
    expect(after.out).toContain("this project and the organization add nothing");
    expect(after.out.startsWith(`Rules ${bare}: `)).toBe(true);
  });

  it("writes a task and takes it in one command, the number first, under the mark a session holds", async () => {
    const rules = await console_(["rules"]);
    const mark = /^Rules ([0-9a-f]{8}): /.exec(rules.out)?.[1] ?? "";
    expect(mark).not.toBe("");
    const both = await console_([
      "task",
      "new",
      "Do what the chat asked for",
      "--body",
      "As the person said.",
      "--take",
      "--rules",
      mark,
    ]);
    expect(both.code, both.err).toBe(EXIT.ok);
    // What task new prints, the number first, then what a take prints.
    const number =
      /^Task #(\d+) written: Do what the chat asked for\ntask id: \S+\nRun \S+ began on #(\d+) Do what the chat asked for, /.exec(
        both.out,
      )?.[1] ?? "";
    expect(number).not.toBe("");
    expect(both.out).toContain(
      `\nRules ${mark}: left out, since they stand as this session read them. console rules prints them.\n\n#${number} Do what the chat asked for`,
    );
    expect(both.out).toContain("As the person said.");
    expect(both.out).toContain("Say how it goes");
    // Written ready and taken: in progress now, with the one run open on it.
    const read = JSON.parse((await console_(["task", number, "--json"])).out) as {
      task: { state: string; openRuns: number };
    };
    expect(read.task).toMatchObject({ state: "in_progress", openRuns: 1 });
    expect((await console_(["finish", "--summary", "Done as asked."])).code).toBe(EXIT.ok);
    // --json carries both: the task as it was written, and what a take answers.
    const asJson = await console_(["task", "new", "Do the next thing", "--take", "--json"]);
    expect(asJson.code, asJson.err).toBe(EXIT.ok);
    const carried = JSON.parse(asJson.out) as {
      written: { id: string; state: string };
      run: { taskId: string };
      task: { id: string; state: string };
      rules: { mark: string };
    };
    expect(carried.written.state).toBe("ready");
    expect(carried.task).toMatchObject({ id: carried.written.id, state: "in_progress" });
    expect(carried.run.taskId).toBe(carried.written.id);
    expect(carried.rules.mark).toBe(mark);
    expect((await console_(["abandon"])).code).toBe(EXIT.ok);
    // A task that cannot be taken is refused before it is written: the board holds none of it.
    const closed = await console_(["task", "new", "Never written", "--state", "done", "--take"]);
    expect(closed.code).toBe(EXIT.usage);
    expect(closed.err).toContain("A task written as done is not taken");
    expect((await console_(["tasks", "--search", "Never written", "--state", "done"])).out).toBe(
      `No tasks: no title holds every word of "Never written". Fewer words find more: one word of the thing's name, in the language the board is written in.\n`,
    );
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
    expect(theirs.out).toBe(
      "No runs begun through this agent (Bob's agent). A run of yours begun through another agent, or before a new sign-in, is listed without --mine, where each line says whom it is for and through which agent.\n",
    );
    // Alice signs a second agent in, or the first one in again: the run begun through the
    // first is hers still. The command finds it, names it, and goes on with it by its id.
    const again = await tokenFor(alice, "Codex on the desk");
    const lost = await console_(["report", "Still at it."], again);
    expect(lost.code).toBe(EXIT.failed);
    expect(lost.err).toContain(
      "run.none: no run begun through this agent is open in this project; 1 of yours begun through another agent, or before a new sign-in, is open:",
    );
    expect(lost.err).toContain(`  ${runId}  running  Codex for Alice  task #${task.number}`);
    expect(lost.err).toContain("Go on with it: add --run <id> to the command.");
    expect(lost.err).not.toContain("console take");
    const found = await console_(["report", "Still at it.", "--run", runId], again);
    expect(found.code, found.err).toBe(EXIT.ok);
    expect(found.out).toContain(`Reported on run ${runId}`);
    const whoami = await console_(["whoami"], bobToken);
    expect(whoami.out).toBe(
      `bob (member) at Acme, ${SIGN_IN_URL}; project web (The web app), named by CONSOLE_PROJECT\nBefore the first task, read console rules and the skill working-the-board (console skills says where it is); for one command's flags, console help <command>.\nThis command is of a version it does not know; the console is 0.1.18 and takes >=0.1.0 <0.2.0; this command works with a console from 0.6.0 on.\n`,
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
      "--worker",
      "me",
    ]);
    expect(written.code, written.err).toBe(EXIT.ok);
    const number = /Task #(\d+) written/.exec(written.out)?.[1] ?? "";
    const shown = await console_(["task", number]);
    expect(shown.out).toContain(
      `category: engineering  goal: ${goalId}  starts: 2026-10-20  due: 2026-10-24`,
    );
    expect(shown.out).toContain("workers: Alice");
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
    expect(shown.out).toContain("color: teal  symbol: OP  glyph: none  image: none");
    expect(shown.out).toContain("Runs the place.");
    const edited = await as(["project", "edit", "ops", "--name", "Ops", "--symbol", "none"]);
    expect(edited.code, edited.err).toBe(EXIT.ok);
    expect(edited.out).toContain("project ops: Ops");
    expect(edited.out).toContain("symbol: none");
    // An icon of the console's pack for the mark, by its name; a name that is none of the
    // pack's is answered with the pack's names, before anything is sent.
    const iconed = await as(["project", "edit", "ops", "--glyph", "flag"]);
    expect(iconed.code, iconed.err).toBe(EXIT.ok);
    expect(iconed.out).toContain("glyph: flag");
    const unknown = await as(["project", "edit", "ops", "--glyph", "no-such-icon"]);
    expect(unknown.code).toBe(EXIT.usage);
    expect(unknown.err).toContain("No icon of the pack is called no-such-icon");
    expect(unknown.err).toContain("calendar");
    expect((await as(["project", "ops"])).out).toContain("glyph: flag");
    expect((await as(["project", "edit", "ops", "--glyph", "none"])).out).toContain("glyph: none");
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

  it("takes the tables and the code of a private pack as data, read by the console with the pack token the project holds (ADR-0100)", async () => {
    const COMMIT = "0123456789abcdef0123456789abcdef01234567";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const table = (file: string, heading: string, rows: string[][]) => ({
      path: `docs/annex/${file}`,
      heading: ["Codes", heading],
      columns: ["Code", "Meaning"],
      rows,
    });
    // A deployment that serves one private pack: to the token of the pack and to nobody else,
    // to whom the pack and nothing are one answer.
    const asked: string[] = [];
    const source = createSkillCdnSource({
      baseUrl: "https://skillcdn.test",
      userAgent: "console-test",
      logger: pino({ level: "silent" }),
      fetch: async (url, init) => {
        const at = new URL(url);
        const bearer = new Headers(init.headers).get("authorization");
        asked.push(`${bearer === null ? "nobody" : "the pack's token"} ${at.pathname}${at.search}`);
        if (bearer !== "Bearer scdn_repo_manual" || !at.pathname.endsWith("/gh/acme/manual")) {
          return json(
            { error: { code: "mount.repo_not_found", message: "No repository at this address." } },
            404,
          );
        }
        const read = at.pathname.split("/")[3];
        if (read === "mounts") {
          return json({
            address: "/gh/acme/manual",
            repository: {
              host: "gh",
              owner: "acme",
              name: "manual",
              defaultBranch: "main",
              description: null,
              avatar: "https://avatars.example/acme.png",
              visibility: "private",
            },
            ref: null,
            pinned: false,
            commit: COMMIT,
            path: "",
            verified: false,
            image: null,
            index: {
              status: "ready",
              truncated: false,
              manifest: null,
              skillCount: 0,
              documentCount: 2,
              skills: [],
              documents: [],
              diagnostics: [],
            },
          });
        }
        if (read === "rows") {
          // One table written in two files, a page each.
          return at.searchParams.get("cursor") === null
            ? json({
                status: "ready",
                commit: COMMIT,
                path: "docs/annex",
                tables: [
                  table("codes-1.md", "A to B", [
                    ["A1", "Starts"],
                    ["B1", "Stops, at once"],
                  ]),
                ],
                rowCount: 2,
                nextCursor: "codes-2",
              })
            : json({
                status: "ready",
                commit: COMMIT,
                path: "docs/annex",
                tables: [
                  table("codes-2.md", "C to D", [
                    ["C1", "Waits"],
                    ["D1", "Ends"],
                  ]),
                ],
                rowCount: 2,
                nextCursor: null,
              });
        }
        if (read === "code") {
          return json({
            status: "ready",
            commit: COMMIT,
            path: "docs/annex",
            blocks: [
              {
                path: "docs/annex/codes-1.md",
                heading: ["Codes", "A to B"],
                language: "sh",
                text: "machine --start",
              },
            ],
            nextCursor: null,
          });
        }
        if (read === "browse") {
          // The outline of a document, naming the deployment's own address for its data.
          return json({
            status: "ready",
            commit: COMMIT,
            path: "docs/annex/codes-1.md",
            entries: [],
            nextCursor: null,
            outline: {
              path: "docs/annex/codes-1.md",
              size: 300,
              totalLength: 300,
              headings: [{ level: 1, text: "Codes", offset: 0, length: 300, rows: 2 }],
              truncated: false,
              tables: { count: 1, rows: 2 },
              codeBlocks: 1,
              data: {
                rows: "https://skillcdn.test/api/v1/rows/gh/acme/manual?path=docs/annex/codes-1.md",
                code: "https://skillcdn.test/api/v1/code/gh/acme/manual?path=docs/annex/codes-1.md",
              },
            },
          });
        }
        return json({ error: { code: "request.invalid", message: "Not a read." } }, 400);
      },
    });
    const served = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      skills: { address: "/gh/Acme/manual", source },
    });
    const owner = await served.signIn("alice");
    await served.project(owner, { key: "manual", name: "The manual", visibility: "workspace" });
    const agent = await tokenFor(bob, "Codex reading the manual");
    const as = (args: readonly string[]) =>
      console_(args, agent, { harness: served, project: "manual" });
    // Without a token of the pack, the console is nobody at the deployment: the read fails, on
    // standard error, and nothing is printed for a program to take.
    const before = await as(["skills", "--rows", "docs/annex"]);
    expect(before.code).toBe(EXIT.failed);
    expect(before.out).toBe("");
    expect(before.err).toContain(
      "tables at /gh/acme/manual, served by https://skillcdn.test: not_found",
    );
    expect(before.err).toContain("the project holds no pack token for it");
    // In a directory that names no project the command reads the organization's pack (ADR-0113),
    // which is this address, as private: the words name the workspace's token, an
    // administrator's to set, and the listing says whose pack it is before anything else.
    const unbound = (args: readonly string[]) =>
      console_(args, agent, { harness: served, project: undefined });
    const without = await unbound(["skills", "--rows", "docs/annex"]);
    expect(without.code).toBe(EXIT.failed);
    expect(without.out).toBe("");
    expect(without.err).toContain(
      "tables at /gh/acme/manual, served by https://skillcdn.test: not_found",
    );
    expect(without.err).toContain("the workspace holds no SkillCDN token for it");
    // The listing of a pack that is not served ends as refused too, as the skillcdn command
    // ends on one (ADR-0118), with whose pack it is first.
    const whose = await unbound(["skills"]);
    expect(whose.code).toBe(EXIT.failed);
    expect(whose.out).toBe("");
    expect(
      whose.err.startsWith(
        "The organization's pack, since no project is named here: --project <key>, or a directory bound with console use <key>, reads a project's own.\nskills at /gh/acme/manual, served by https://skillcdn.test: not_found\n",
      ),
    ).toBe(true);
    // An owner sets the pack token; a member's agent then takes the table whole, both pages of
    // it as one CSV, holding no token of the pack itself.
    const set = await served.request(`${projectPath("manual")}/pack-token`, {
      method: "PUT",
      headers: { cookie: owner, ...JSON_HEADERS },
      body: JSON.stringify({ token: "scdn_repo_manual" }),
    });
    expect(set.status).toBe(200);
    asked.length = 0;
    const rows = await as(["skills", "--rows", "docs/annex"]);
    expect(rows.err).toBe("");
    expect(rows.code).toBe(EXIT.ok);
    expect(rows.out).toBe(
      [
        "path,heading,Code,Meaning",
        "docs/annex/codes-1.md,Codes > A to B,A1,Starts",
        'docs/annex/codes-1.md,Codes > A to B,B1,"Stops, at once"',
        "docs/annex/codes-2.md,Codes > C to D,C1,Waits",
        "docs/annex/codes-2.md,Codes > C to D,D1,Ends",
        "",
      ].join("\r\n"),
    );
    // Every read begins with what the address serves, as the skillcdn command's reads do
    // (ADR-0124), and then the two pages of the tables.
    expect(asked).toEqual([
      "the pack's token /api/v1/mounts/gh/acme/manual",
      "the pack's token /api/v1/rows/gh/acme/manual?path=docs%2Fannex&limit=5000",
      "the pack's token /api/v1/rows/gh/acme/manual?path=docs%2Fannex&cursor=codes-2&limit=5000",
    ]);
    const code = await as(["skills", "--code", "docs/annex"]);
    expect(code.code).toBe(EXIT.ok);
    expect(code.out).toBe("--- docs/annex/codes-1.md > Codes > A to B (sh) ---\nmachine --start\n");
    // The outline of the document names the commands that read them, and never the
    // deployment's own address, which the console's token reads nothing at.
    const outlined = await as(["skills", "docs/annex/codes-1.md"]);
    expect(outlined.code).toBe(EXIT.ok);
    expect(outlined.out).toContain(
      "Tables: 1 with 2 rows; as data: console skills --rows docs/annex/codes-1.md",
    );
    expect(outlined.out).toContain(
      "Code blocks: 1; as data: console skills --code docs/annex/codes-1.md",
    );
    expect(outlined.out).not.toContain("skillcdn.test/api/v1");
    // The pack's token is in nothing the command printed and nothing the console logged.
    expect(JSON.stringify([before, rows, code, outlined, served.logs]).includes("scdn_repo")).toBe(
      false,
    );
  });

  it("prints a pack as the skillcdn command prints it: one directory read by that command's reads and through the console (ADR-0124)", async () => {
    // An invented pack on this machine: a skill that includes two files and is longer than a
    // host shows whole, a document longer than a page, and a table and a code block; its
    // manifest names the page an agent reads first, and its skill links a file of another pack,
    // as a pack of SkillCDN 0.6 may.
    const root = await mkdtemp(join(tmpdir(), "console-pack-"));
    const directory = join(root, "acme", "manual");
    const lines = (count: number, word: string): string =>
      Array.from(
        { length: count },
        (_, at) =>
          `${word} ${String(at + 1).padStart(4, "0")}: what is done at this step, in a sentence of its own.`,
      ).join("\n");
    await mkdir(join(directory, "review"), { recursive: true });
    await mkdir(join(directory, "docs"), { recursive: true });
    await writeFile(
      join(directory, "SKILLCDN.md"),
      "---\nname: Manual\ndescription: The manual of an invented machine.\ndocuments:\n  - docs\nstart: docs/README.md\n---\nBe kind.\n",
    );
    await writeFile(
      join(directory, "review", "SKILL.md"),
      `---\nname: review\ndescription: Reviews a change.\nskillcdn:\n  include:\n    - steps.md\n    - checks.md\n---\n# Reviewing\n\n${lines(110, "Rule")}\n\nSee [the guide](guide.md), and [the base skill](skill://gh/acme/base/review/SKILL.md).\n`,
    );
    await writeFile(join(directory, "review", "steps.md"), `# Steps\n\n${lines(190, "Step")}\n`);
    await writeFile(join(directory, "review", "checks.md"), `# Checks\n\n${lines(190, "Check")}\n`);
    await writeFile(join(directory, "review", "guide.md"), "# Guide\n\nHow to review.\n");
    await writeFile(
      join(directory, "docs", "README.md"),
      "# Documentation\n\nWhat the manual holds.\n",
    );
    await writeFile(
      join(directory, "docs", "guide.md"),
      `# Guide\n\n## Starting\n\n${lines(220, "Start")}\n\n## Stopping\n\n${lines(220, "Stop")}\n`,
    );
    await writeFile(
      join(directory, "docs", "codes.md"),
      "# Codes\n\n| Code | Meaning |\n| --- | --- |\n| A1 | Starts |\n| B1 | Stops, at once |\n\n```sh\nmachine --start\n```\n",
    );
    // A second skill, long in the ways a page can cut (SkillCDN 0.6): a table of more rows than
    // a page holds, fenced code blocks, and Korean prose, three bytes a character.
    const row = (at: number): string =>
      `| R${String(at).padStart(3, "0")} | 검토 항목 ${at}: 변경이 약속을 지키는지 본다 | a step of the review, said in one line |`;
    const fenced = (name: string, count: number): string =>
      [
        "```sh",
        ...Array.from({ length: count }, (_, at) => `${name} --step ${at + 1} --check`),
        "```",
      ].join("\n");
    const korean = (word: string, count: number): string =>
      Array.from(
        { length: count },
        (_, at) =>
          `${word} ${at + 1}: 한 줄은 한 쪽에 들어가는 한 쪼개지지 않고, 표와 코드 블록 밖에서 끝납니다.`,
      ).join("\n\n");
    const TABLE_HEAD = "| Code | 무엇을 보는가 | Note |\n| --- | --- | --- |";
    const ROWS = 260;
    await mkdir(join(directory, "cuts"), { recursive: true });
    await writeFile(
      join(directory, "cuts", "SKILL.md"),
      [
        "---\nname: cuts\ndescription: Checks a change by a long table.\n---\n# Checking",
        korean("머리말", 40),
        "## The checks",
        `${TABLE_HEAD}\n${Array.from({ length: ROWS }, (_, at) => row(at + 1)).join("\n")}`,
        "## Commands",
        korean("준비", 30),
        fenced("review", 120),
        korean("마무리", 60),
        fenced("verify", 90),
        "Done.\n",
      ].join("\n\n"),
    );
    const parsed = parseAddress("/local/acme/manual");
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    // One source for both, so that both read one index of the directory.
    const source = createDirectorySource({
      root,
      clock: { now: () => new Date("2026-11-15T00:00:00Z") },
      logger: pino({ level: "silent" }),
    });
    const opened = source.open(parsed.value);
    if (opened === undefined) {
      throw new Error("the directory is not served");
    }
    // The pack as the skillcdn command reads one: the same reads, with its refusals as its own.
    const asCommand = async <T>(read: Promise<T>): Promise<T> =>
      read.catch((error: unknown) => {
        if (error instanceof PackError) {
          throw new CommandPackError(error.status, error.code, error.message);
        }
        throw error;
      });
    const ready = <T extends { readonly status: string }>(answer: T) => {
      if (answer.status !== "ready") {
        throw new Error("the index of a directory is always ready");
      }
      return answer as Extract<T, { readonly status: "ready" }>;
    };
    const direct: CommandPack = {
      address: parsed.value,
      source: { kind: "directory", root: directory },
      mount: () => asCommand(opened.mount()),
      browse: (query) => asCommand(opened.browse(query)),
      find: (query) => asCommand(opened.find(query)),
      skill: (path, cursor) => asCommand(opened.skill(path, cursor)),
      file: (query) => asCommand(opened.file(query)),
      rows: async (query) => ready(await asCommand(opened.rows(query))),
      code: async (query) => ready(await asCommand(opened.code(query))),
    };
    // In the console's words for the reads, which is all that differs between the two commands.
    const words: ToolWords = {
      browse: "console skills <folder>",
      search: "console skills --search",
      load: "console skill",
      read: "console skill --file",
    };
    const command = async (read: PackRead): Promise<string> =>
      (await readPack(direct, read, { words })).text;
    const served = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      skills: {
        address: "/local/acme/manual",
        source: { open: () => undefined },
        directory: source,
      },
    });
    try {
      const owner = await served.signIn("alice");
      await served.project(owner, {
        key: "handbook",
        name: "The handbook",
        visibility: "workspace",
      });
      const agent = await tokenFor(bob, "Codex reading the manual on this machine");
      const through = async (args: readonly string[]) => {
        const ran = await console_(args, agent, { harness: served, project: "handbook" });
        expect(ran.err, args.join(" ")).toBe("");
        expect(ran.code, args.join(" ")).toBe(EXIT.ok);
        return ran.out;
      };
      const LOADING =
        "A skill is loaded, its rules first, with console skill <the path of its SKILL.md>, a long one in parts; --file reads a file of the pack as it is, without the rules.";
      // The listing: the pack's own words between the console's lines.
      expect(await through(["skills"])).toBe(
        [
          "skills at /local/acme/manual, read from the console's machine: ready",
          "",
          await command({ read: "skills" }),
          LOADING,
          "The plugins of this console have skills of their own: console plugins lists the plugins, console plugin <key> skills the skills of one.",
          "",
        ].join("\n"),
      );
      // The page the manifest names as the first to read is said, in the console's word for
      // the read.
      expect(await through(["skills"])).toContain(
        "Start here, before a task: console skill --file docs/README.md.",
      );
      // A folder, and what words find.
      expect(await through(["skills", "docs"])).toBe(
        `${await command({ read: "browse", path: "docs" })}\n`,
      );
      expect(await through(["skills", "--search", "review"])).toBe(
        `${await command({ read: "find", words: "review" })}\n${LOADING}\n`,
      );
      // A skill, in parts: each within what a host shows whole, ending with the command that
      // reads the next, until the last. Each is what the skillcdn command prints and nothing
      // more (SkillCDN 0.6.2): how many pages follow a part, that it is read on from now, and
      // that the last part is the last are that command's own words.
      const partsOf = async (path: string): Promise<string[]> => {
        const printedParts: string[] = [];
        const named = new RegExp(
          `console skill ${path.replace(/[/.]/g, "\\$&")} --cursor (\\S+)\\n`,
        );
        for (let cursor: string | undefined, part = 0; part < 8; part += 1) {
          const printed = await through([
            "skill",
            path,
            ...(cursor === undefined ? [] : ["--cursor", cursor]),
          ]);
          const theirs = await command({ read: "skill", path, cursor });
          const next = named.exec(printed)?.[1];
          expect(next !== undefined, `part ${part + 1} of ${path}`).toBe(
            theirs.includes("This part ends before the skill does"),
          );
          expect(printed).toBe(`${theirs}\n`);
          // What is printed stays within what a host shows whole, counted in bytes as a host counts.
          expect(Buffer.byteLength(printed), `part ${part + 1} of ${path}`).toBeLessThanOrEqual(
            28_000 + 1,
          );
          printedParts.push(printed);
          if (next === undefined) {
            break;
          }
          cursor = next;
        }
        return printedParts;
      };
      const parts = await partsOf("review/SKILL.md");
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]).toContain("Skill context is incomplete");
      expect(parts[0]).toContain("Rule 0001:");
      // The file of another pack the skill links to is named, and not read here.
      expect(parts[0]).toContain("In other packs, not readable here:");
      expect(parts[0]).toContain("skill://gh/acme/base/review/SKILL.md");
      expect(parts.join("")).toContain("Step 0190:");
      expect(parts.at(-1)).toContain("Check 0190:");
      expect(parts.at(-1)).not.toContain("This part ends before the skill does");
      // A part that is not the last says how far the skill goes on, and its last line is the
      // command that reads the next; the last part says that it is the last.
      expect(parts[0]).toMatch(/\d+ more pages? follows? this part/);
      expect(parts[0]).toMatch(/\nconsole skill review\/SKILL\.md --cursor \S+\n$/);
      expect(parts.at(-1)?.endsWith("Skill context is complete: this was its last part.\n")).toBe(
        true,
      );
      // The skill a page cuts: where a part ends is the pack's to say (SkillCDN 0.6), and
      // through the console each part is what the skillcdn command prints, so that nothing of
      // it is lost on the way.
      const cut = await partsOf("cuts/SKILL.md");
      expect(cut.length).toBeGreaterThan(1);
      expect(cut.at(-1)).toContain("Done.");
      const seen: number[] = [];
      let headsAgain = 0;
      for (const [at, printed] of cut.entries()) {
        const lines = printed.split("\n");
        // No part ends inside a fenced code block: every fence it opens, it closes.
        expect(lines.filter((line) => line === "```sh").length, `part ${at + 1}`).toBe(
          lines.filter((line) => line === "```").length,
        );
        // No line is cut: a row of the table is whole, and so is a line of the prose.
        const rows = lines.filter((line) => line.startsWith("| R"));
        for (const line of rows) {
          const number = /^\| R(\d{3}) \| 검토 항목 \d+: .+ \| .+ \|$/.exec(line)?.[1];
          expect(number, line).toBeDefined();
          seen.push(Number(number));
        }
        for (const line of lines.filter((one) => /^(머리말|준비|마무리) \d+:/.test(one))) {
          expect(line.endsWith("끝납니다."), line).toBe(true);
        }
        // A part that goes on with the table says the table's first two lines again above its
        // rows, where the pack answered them beside the text (`tableHead`).
        const first = rows[0];
        if (first !== undefined && first !== row(1)) {
          expect(printed, `part ${at + 1}`).toContain(`${TABLE_HEAD}\n${first}`);
          headsAgain += 1;
        }
      }
      // The table is longer than a part, so one part at least went on with it; and every row is
      // there once, in its order.
      expect(headsAgain).toBeGreaterThan(0);
      expect(seen).toEqual(Array.from({ length: ROWS }, (_, at) => at + 1));
      // A file, a page a host shows whole, ended at a line, and the page after it.
      const page = await through(["skill", "--file", "docs/guide.md"]);
      expect(page).toBe(`${await command({ read: "file", path: "docs/guide.md" })}\n`);
      const next = /with offset (\d+)\./.exec(page)?.[1];
      expect(next).toBeDefined();
      expect(await through(["skill", "--file", "docs/guide.md", "--offset", next ?? "0"])).toBe(
        `${await command({ read: "file", path: "docs/guide.md", offset: next })}\n`,
      );
      // The tables and the code blocks, as data.
      expect(await through(["skills", "--rows", "docs"])).toBe(
        await command({ read: "rows", path: "docs" }),
      );
      expect(await through(["skills", "--rows", "docs", "--format", "json"])).toBe(
        `${await command({ read: "rows", path: "docs", format: "json" })}\n`,
      );
      expect(await through(["skills", "--code", "docs"])).toBe(
        await command({ read: "code", path: "docs" }),
      );
      // A skill that is not there: that command's refusal, in its words.
      const missing = await console_(["skill", "nothing"], agent, {
        harness: served,
        project: "handbook",
      });
      expect(missing.code).toBe(EXIT.failed);
      expect(missing.out).toBe("");
      const refusal = await command({ read: "skill", path: "nothing/SKILL.md" }).catch(
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(CommandPackError);
      expect(missing.err).toBe(
        `skill.not_found: ${refusal instanceof Error ? refusal.message : ""}\n`,
      );
    } finally {
      await served.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
