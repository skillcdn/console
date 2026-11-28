import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_LENGTH } from "../limits.js";
import { type CliIo, EXIT, keepRunning, ownWakeMoment, runCli } from "./cli.js";
import { NO_LINE_TO_RUN } from "./command-words.js";
import { type CredentialStore, type Credentials, CredentialsError } from "./credentials.js";
import type { DirectorySettings, DirectoryStore } from "./directory.js";
import { COMMAND_HELP } from "./help.js";
import type { Install } from "./install.js";
import type { NoticeStore, VersionNotice } from "./notices.js";
import type { RunnerHost } from "./runner-host.js";
import type { Listen, ServeHandler } from "./serve.js";
import type { Ran, SetupMachine } from "./setup-machine.js";

const WHEN = "2026-10-09T10:00:00.000Z";
const PERSON = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: null,
  avatar: null,
  role: "member",
  status: "active",
  source: "listed",
  deactivatedAt: null,
};
const TASK = {
  id: "0199c4d8-0000-7000-8000-000000000010",
  number: 7,
  title: "Fix the parser",
  body: "It fails on empty input.",
  state: "ready",
  priority: "high",
  owner: PERSON,
  workers: [],
  parentId: null,
  category: null,
  goalId: null,
  startsOn: null,
  dueOn: null,
  startedAt: null,
  doneAt: null,
  archivedAt: null,
  links: [],
  openDecisions: 0,
  openRuns: 0,
  createdAt: WHEN,
  updatedAt: WHEN,
};
const GOAL = {
  id: "0199c4d8-0000-7000-8000-000000000060",
  title: "Ship v1",
  body: "What it means.",
  state: "active",
  category: null,
  startsOn: null,
  dueOn: "2026-11-15",
  createdBy: PERSON,
  taskCounts: { idea: 1, ready: 0, in_progress: 1, in_review: 0, done: 2, dropped: 0 },
  createdAt: WHEN,
  updatedAt: WHEN,
};
const CATEGORY = {
  key: "engineering",
  name: "Engineering",
  color: "blue",
  createdAt: WHEN,
  updatedAt: WHEN,
};
const RUN = {
  id: "0199c4d8-0000-7000-8000-000000000020",
  taskId: TASK.id,
  taskNumber: TASK.number,
  person: PERSON,
  agent: "Claude Code",
  status: "running",
  startedAt: WHEN,
  endedAt: null,
  lastHeardAt: WHEN,
  summary: null,
  reports: [],
  artifacts: [],
  waitingFor: null,
};
const DECISION = {
  id: "0199c4d8-0000-7000-8000-000000000030",
  question: "Keep the old behaviour?",
  body: "",
  options: [
    { id: "1", label: "Keep it" },
    { id: "2", label: "Change it" },
  ],
  taskId: TASK.id,
  taskNumber: TASK.number,
  raisedBy: PERSON,
  decider: PERSON,
  run: { id: RUN.id, agent: "Claude Code" },
  answer: null,
  outcome: null,
  createdAt: WHEN,
  updatedAt: WHEN,
};
const ANSWERED = {
  ...DECISION,
  answer: { option: "2", note: "Carefully.", by: { ...PERSON, login: "bob" }, at: WHEN },
};
const COMMENT = {
  id: "0199c4d8-0000-7000-8000-000000000070",
  taskId: TASK.id,
  author: { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" },
  agent: "Codex on the laptop",
  body: "Which screen did you mean? See the picture.",
  files: [
    {
      id: "0199c4d8-0000-7000-8000-000000000071",
      file: { name: "screen.png", size: 2048, contentType: "image/png", sha256: "cd".repeat(32) },
    },
  ],
  createdAt: WHEN,
};
const ME = {
  workspace: {
    name: "Acme",
    tokenDaysAtMost: null,
    skills: { source: "https://skillcdn.test", address: "/gh/acme/skills" },
  },
  person: PERSON,
  agent: "Claude Code on laptop",
  language: null,
  signIn: [],
  console: { version: "0.1.18", clientRange: ">=0.1.18 <0.2.0" },
};
const TOKEN = {
  id: "0199c4d8-0000-7000-8000-000000000030",
  name: "Claude Code on laptop",
  createdAt: WHEN,
  expiresAt: null,
  lastUsedAt: null,
  client: null,
};
const CONNECTION = {
  code: "ABCD-EFGH",
  url: `${"https://console.test"}/connect/ABCD-EFGH`,
  secret: "cns_c_secret",
  expiresAt: WHEN,
  interval: 1,
};
const PROJECT = {
  packToken: null,
  id: "0199c4d8-0000-7000-8000-000000000050",
  key: "web",
  name: "The web app",
  description: "",
  visibility: "private",
  skillsAddress: null,
  color: null,
  symbol: null,
  icon: null,
  role: "member",
  openDecisions: 1,
  openRuns: 0,
  createdAt: WHEN,
  updatedAt: WHEN,
};
const RULES_PAGE = {
  id: "0199c4d8-0000-7000-8000-000000000080",
  path: "rules",
  title: "Rules",
  version: 2,
  updatedBy: PERSON,
  agent: null,
  archivedAt: null,
  createdAt: WHEN,
  updatedAt: WHEN,
};
const RULES_DOC = {
  ...RULES_PAGE,
  body: "# Rules of this project\n\nAsk before pushing.",
  createdBy: PERSON,
  links: [],
  backlinks: [],
  files: [],
};
/** The rules as a project answers them: the console's alone at the workspace, and what the project adds. */
const RULES = {
  workspace: {
    source: "reference",
    body: "# Rules for agents on this board\n\nRead these.",
    page: null,
    own: "# Rules for agents on this board\n\nRead these.",
    added: null,
  },
  project: { source: "written", body: RULES_DOC.body, page: RULES_PAGE },
};
const ORIGIN = "https://console.test";
const SIGNED_IN = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret", CONSOLE_PROJECT: "web" };
const IN = "/api/v1/projects/web";

// The pack of the project, as the console answers it: what the address serves, as the
// deployment answered (ADR-0031), and the listing the pages show.
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MOUNT = {
  address: "/gh/acme/skills",
  repository: {
    host: "gh",
    owner: "acme",
    name: "skills",
    defaultBranch: "main",
    description: null,
    avatar: "https://avatars.example/acme.png",
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
    manifest: {
      path: "SKILLCDN.md",
      name: "Acme",
      description: "What Acme does, as skills.",
      language: "en",
      translations: {},
    },
    skillCount: 1,
    documentCount: 12,
    skills: [
      {
        path: "review/SKILL.md",
        name: "review",
        directory: "review",
        description: "Reviews a change.",
        warnings: [],
        translations: {},
      },
    ],
    documents: [{ path: "docs/guide.md", title: "Guide", summary: null }],
    diagnostics: [],
  },
};
const LISTING = {
  address: "/gh/acme/skills",
  source: "https://skillcdn.test",
  page: "https://skillcdn.test/gh/acme/skills",
  status: "ready",
  refusal: null,
  pack: { name: "Acme", description: "What Acme does, as skills.", language: "en" },
  counts: { skills: 1, documents: 12 },
  items: [
    {
      name: "review",
      description: "Reviews a change.",
      directory: "review",
      path: "review/SKILL.md",
      page: "https://skillcdn.test/gh/acme/skills?skill=review%2FSKILL.md",
      uri: "skill://gh/acme/skills/review/SKILL.md",
      translations: {},
    },
  ],
  mount: MOUNT,
};
const OPEN_RUNS = `GET ${IN}/runs?open=true&mine=true&brief=true`;

interface Answer {
  readonly status?: number;
  readonly body?: unknown;
}

/** What a console says of itself on every answer (ADR-0025); the fake says nothing unless told. */
interface Says {
  readonly version?: string;
  readonly clientRange?: string;
}

/** A console that answers from a table: one answer per route, or several in turn. */
function fakeConsole(table: Record<string, Answer | Answer[]>, says: Says = {}) {
  const calls: { key: string; init: RequestInit | undefined; body: unknown }[] = [];
  const headers = {
    "content-type": "application/json",
    ...(says.version === undefined ? {} : { "console-version": says.version }),
    ...(says.clientRange === undefined ? {} : { "console-client-range": says.clientRange }),
  };
  const fetch: CliIo["fetch"] = async (url, init) => {
    const key = `${init?.method ?? "GET"} ${url.replace(ORIGIN, "")}`;
    const raw = init?.body;
    calls.push({ key, init, body: typeof raw === "string" ? JSON.parse(raw) : undefined });
    const entry = table[key];
    const answer = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (answer === undefined) {
      return new Response(
        JSON.stringify({ error: { code: "not_found", message: "Nothing here." } }),
        { status: 404, headers },
      );
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers,
    });
  };
  return { fetch, calls };
}

function memoryStore(initial?: Credentials) {
  let kept = initial;
  const store: CredentialStore = {
    async load() {
      return kept;
    },
    async save(credentials) {
      kept = credentials;
      return "/home/alice/.config/skillcdn-console/credentials.json";
    },
    async clear() {
      kept = undefined;
    },
  };
  return { store, kept: () => kept };
}

/** One login kept, at a console, as its default. */
function one(url: string, token: string, account = "alice"): Credentials {
  return {
    default: url,
    logins: [{ url, account, token, agent: undefined, since: undefined }],
  };
}

function memoryNotices(initial?: VersionNotice) {
  let kept = initial;
  const store: NoticeStore = {
    async load() {
      return kept;
    },
    async save(notice) {
      kept = notice;
    },
  };
  return { store, kept: () => kept };
}

function memoryDirectory(initial?: DirectorySettings) {
  let kept = initial;
  const store: DirectoryStore = {
    async load() {
      return kept;
    },
    async save(settings) {
      kept = settings;
      return "/work/app/.skillcdn-console.json";
    },
  };
  return { store, kept: () => kept };
}

function harness(overrides: Partial<CliIo> & { readonly fetch: CliIo["fetch"] }) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    env: {},
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    readStdin: async () => "",
    readFile: async () => {
      throw new Error("no files here");
    },
    readBytes: async () => {
      throw new Error("no files here");
    },
    writeBytes: async () => {
      throw new Error("nowhere to write");
    },
    store: memoryStore().store,
    directory: memoryDirectory().store,
    sleep: async () => undefined,
    now: () => 0,
    // The fakes here say what version they like: the command's floor stands aside unless a test sets it.
    consoleAtLeast: "0.0.0",
    ...overrides,
  };
  return { io, out: () => out.join(""), err: () => err.join("") };
}

describe("the console command", () => {
  it("says how it is used, and refuses what it does not understand", async () => {
    const { fetch } = fakeConsole({});
    const whole = harness({ fetch });
    expect(await runCli([], whole.io)).toBe(EXIT.ok);
    expect(whole.out()).toContain("console take <number|id>");
    expect(whole.out()).toContain("Exit codes");
    // The overview is a map: every command in a line with what it does in a sentence, and the
    // forms of a many-formed command without their flags; the command in full is its own help.
    expect(whole.out()).toContain(
      "  console take <number|id> [--agent <name>]\n      Takes a task: a run begins",
    );
    expect(whole.out()).toContain("task new <title> [flags]");
    // Every command is on the map, but those a person or a machine runs for itself: the desk a
    // person writes once, the console of their own they serve, and an agent account's runner.
    for (const [name, help] of Object.entries(COMMAND_HELP)) {
      if (name !== "desk" && name !== "serve" && name !== "runner") {
        expect(whole.out()).toContain(`  console ${help.overview ?? help.usage}\n`);
      }
    }
    expect(whole.out()).not.toContain(
      "--token-stdin takes a token made by hand instead, typed unseen",
    );
    expect(whole.out()).not.toContain("--parent <number|id>");
    // A map stays one: what the agent accounts added (ADR-0084, ADR-0087) is five commands, a
    // line each, and what the notifications added (ADR-0157) four.
    expect(whole.out().length).toBeLessThan(11_900);
    // What holds everywhere: every exit code, the fourth included.
    expect(whole.out()).toContain("4 the\ncommand and the console do not go together");
    // Where the skill is, when the command knows; else where to ask.
    expect(whole.out()).toContain("first command of a run (console whoami says where it is)");
    const located = harness({
      fetch,
      skillsDir: "/usr/lib/node_modules/@skillcdn/console/skills/",
    });
    expect(await runCli([], located.io)).toBe(EXIT.ok);
    expect(located.out()).toContain(
      "first command of a run:\n/usr/lib/node_modules/@skillcdn/console/skills/working-the-board/SKILL.md",
    );
    // A command on a run says in its own help how the run is named, and what it refuses when it cannot tell.
    const report = harness({ fetch });
    expect(await runCli(["help", "report"], report.io)).toBe(EXIT.ok);
    expect(report.out()).toContain("report - [--run <id>]");
    expect(report.out()).toContain("run.ambiguous: several runs of yours are open");
    expect(whole.out()).toContain(
      "  console report <markdown>  |  report --file <path>  |  report -\n",
    );
    const login = harness({ fetch });
    expect(await runCli(["help", "login"], login.io)).toBe(EXIT.ok);
    expect(login.out()).toContain("--token-stdin takes a token made by hand instead, typed unseen");
    const task = harness({ fetch });
    expect(await runCli(["help", "task"], task.io)).toBe(EXIT.ok);
    expect(task.out()).toContain("--parent <number|id>");
    const one = harness({ fetch });
    expect(await runCli(["help", "ask"], one.io)).toBe(EXIT.ok);
    expect(one.out()).toContain("--option");
    expect(one.out()).toContain("Limits:");
    expect(one.out()).toContain("decision.invalid_run");
    const limits = harness({ fetch });
    expect(await runCli(["help", "finish"], limits.io)).toBe(EXIT.ok);
    expect(limits.out()).toContain(String(MAX_SUMMARY_LENGTH));
    const version = harness({ fetch, version: "0.1.1" });
    expect(await runCli(["--version"], version.io)).toBe(EXIT.ok);
    expect(version.out()).toBe("console 0.1.1 (@skillcdn/console)\n");
    expect(await runCli(["help"], version.io)).toBe(EXIT.ok);
    expect(version.out()).toContain("console 0.1.1: the board");
    const nameless = harness({ fetch });
    expect(await runCli(["version"], nameless.io)).toBe(EXIT.ok);
    expect(nameless.out()).toContain("version unknown");
    const flagged = harness({ fetch });
    expect(await runCli(["report", "--help"], flagged.io)).toBe(EXIT.ok);
    expect(flagged.out()).toContain("console report");
    const unknown = harness({ fetch });
    expect(await runCli(["nonsense"], unknown.io)).toBe(EXIT.usage);
    expect(unknown.err()).toContain("Not a command: nonsense");
    const bogus = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks", "--bogus"], bogus.io)).toBe(EXIT.usage);
    expect(bogus.err()).toContain("--bogus");
    const missing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take"], missing.io)).toBe(EXIT.usage);
    expect(missing.err()).toContain("console take <number|id>");
  });

  it("needs a console and a token, and says how to sign in without them", async () => {
    const { fetch, calls } = fakeConsole({});
    const h = harness({ fetch });
    expect(await runCli(["tasks"], h.io)).toBe(EXIT.failed);
    expect(h.err()).toContain("console login --url");
    expect(calls).toHaveLength(0);
  });

  it("signs in: keeps the console and the token once the console knows the token", async () => {
    const { fetch, calls } = fakeConsole({ "GET /api/v1/me": { body: ME } });
    const memory = memoryStore();
    const h = harness({
      fetch,
      store: memory.store,
      readStdin: async () => "cns_t_new\n",
    });
    expect(await runCli(["login", "--url", "https://console.test/", "--token-stdin"], h.io)).toBe(
      EXIT.ok,
    );
    expect(h.out()).toContain("Signed in to Acme at https://console.test as alice (member)");
    expect(h.out()).toContain("the default console here");
    expect(memory.kept()).toEqual({
      default: ORIGIN,
      logins: [
        {
          url: ORIGIN,
          account: "alice",
          token: "cns_t_new",
          agent: undefined,
          since: "1970-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_new");
    expect(calls[0]?.init?.credentials).toBe("omit");

    const refused = fakeConsole({ "GET /api/v1/me": { body: { ...ME, person: null } } });
    const empty = memoryStore();
    const r = harness({
      fetch: refused.fetch,
      store: empty.store,
      readStdin: async () => "cns_t_nothing\n",
    });
    expect(await runCli(["login", "--url", "https://console.test", "--token-stdin"], r.io)).toBe(
      EXIT.failed,
    );
    expect(r.err()).toContain("does not know this token");
    expect(empty.kept()).toBeUndefined();

    const path = harness({ fetch, store: memoryStore().store });
    expect(await runCli(["login", "--url", "https://console.test/board"], path.io)).toBe(
      EXIT.usage,
    );
    expect(path.err()).toContain("Not an origin");
  });

  it("connects with a code a person approves, and keeps the token it is then handed, never shown", async () => {
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/connect": { status: 201, body: CONNECTION },
      "POST /api/v1/connect/claim": [
        { status: 202, body: { status: "pending", expiresAt: WHEN } },
        { body: { status: "connected", token: TOKEN, secret: "cns_t_handed" } },
      ],
      "GET /api/v1/me": { body: ME },
    });
    const memory = memoryStore();
    const h = harness({ fetch, store: memory.store, hostname: "laptop" });
    expect(await runCli(["login", "--url", ORIGIN, "--agent", "Claude Code"], h.io)).toBe(EXIT.ok);
    expect(calls[0]?.body).toEqual({ agent: "Claude Code on laptop" });
    expect(h.out()).toContain("https://console.test/connect/ABCD-EFGH");
    expect(h.out()).toContain("code ABCD-EFGH");
    expect(h.out()).toContain('Connected as "Claude Code on laptop" to Acme');
    // The end of the wait is printed as every moment is: as the API gave it while no login at
    // this console has kept the workspace's time zone.
    expect(h.out()).toContain(`\nWaiting for that, until ${WHEN}.\n`);
    // Where the machine says its own time zone, a first sign-in's wait is printed in it: the
    // agent relays that moment to a person, who was handed a raw instant in UTC.
    const local = harness({
      fetch: fakeConsole({
        "POST /api/v1/connect": { status: 201, body: CONNECTION },
        "POST /api/v1/connect/claim": {
          body: { status: "connected", token: TOKEN, secret: "cns_t_handed" },
        },
        "GET /api/v1/me": { body: ME },
      }).fetch,
      store: memoryStore().store,
      hostname: "laptop",
      timeZone: "Asia/Seoul",
    });
    expect(await runCli(["login", "--url", ORIGIN], local.io)).toBe(EXIT.ok);
    expect(local.out()).toContain("\nWaiting for that, until 2026-10-09T19:00:00+09:00.\n");
    // Last, what holds where, and no next step: a folder that is no checkout of a project's
    // repository, a desk say, was bound to a project because the line said to do so next.
    expect(
      h
        .out()
        .endsWith(
          "The token is kept in /home/alice/.config/skillcdn-console/credentials.json.\nOnly a project's checkout is bound to it: console use <key> (console projects lists them).\n",
        ),
    ).toBe(true);
    expect(h.out()).not.toContain("Next,");
    expect(
      "Only a project's checkout is bound to it: console use <key> (console projects lists them)."
        .length,
    ).toBeLessThanOrEqual(
      "Next, say which project this directory works in: console use <key> (console projects lists them)."
        .length,
    );
    // Signed in again where a login kept the workspace's time zone: the wait ends in it.
    const zoned = memoryStore({
      default: ORIGIN,
      logins: [
        {
          url: ORIGIN,
          account: "alice",
          token: "cns_t_before",
          agent: undefined,
          since: undefined,
          timeZone: "Asia/Seoul",
        },
      ],
    });
    const second = harness({
      fetch: fakeConsole({
        "POST /api/v1/connect": { status: 201, body: CONNECTION },
        "POST /api/v1/connect/claim": {
          body: { status: "connected", token: TOKEN, secret: "cns_t_handed" },
        },
        "GET /api/v1/me": { body: ME },
      }).fetch,
      store: zoned.store,
      hostname: "laptop",
    });
    expect(await runCli(["login", "--url", ORIGIN], second.io)).toBe(EXIT.ok);
    expect(second.out()).toContain("\nWaiting for that, until 2026-10-09T19:00:00+09:00.\n");
    expect(memory.kept()?.logins).toEqual([
      {
        url: ORIGIN,
        account: "alice",
        token: "cns_t_handed",
        agent: "Claude Code on laptop",
        since: "1970-01-01T00:00:00.000Z",
      },
    ]);
    expect(
      calls.filter((call) => call.key === "POST /api/v1/connect/claim").map((call) => call.body),
    ).toEqual([{ secret: "cns_c_secret" }, { secret: "cns_c_secret" }]);
    expect(h.out()).not.toContain("cns_");
    expect(h.err()).not.toContain("cns_");

    const late = fakeConsole({
      "POST /api/v1/connect": { status: 201, body: CONNECTION },
      "POST /api/v1/connect/claim": {
        status: 404,
        body: { error: { code: "connect.not_found", message: "Gone." } },
      },
    });
    const l = harness({ fetch: late.fetch });
    expect(await runCli(["login", "--url", ORIGIN], l.io)).toBe(EXIT.failed);
    expect(l.err()).toContain("not approved in time");
    // Named by default after the agent the command runs under, where the environment says so.
    expect(late.calls[0]?.body).toEqual({ agent: "An agent" });
    for (const [env, agent] of [
      [{ CLAUDECODE: "1" }, "Claude Code on laptop"],
      [{ CODEX_SANDBOX: "seatbelt" }, "Codex on laptop"],
    ] as const) {
      const u = harness({ fetch: late.fetch, env, hostname: "laptop" });
      expect(await runCli(["login", "--url", ORIGIN], u.io)).toBe(EXIT.failed);
      expect(late.calls.at(-2)?.body).toEqual({ agent });
    }
  });

  describe("login where no terminal shows its words (ADR-0129)", () => {
    // A machine whose clock moves as the command sleeps: the code lasts ten minutes from now.
    const START = Date.parse("2026-10-09T09:50:00.000Z");
    const WHEN_MS = Date.parse(WHEN);
    function clock() {
      let now = START;
      return {
        now: () => now,
        sleep: async (ms: number) => {
          now += ms;
        },
        pass: (ms: number) => {
          now += ms;
        },
      };
    }
    const PENDING = {
      url: ORIGIN,
      secret: "cns_c_secret",
      code: "ABCD-EFGH",
      page: "https://console.test/connect/ABCD-EFGH",
      expiresAt: WHEN,
      interval: 1,
    };
    const CONNECTED = { body: { status: "connected", token: TOKEN, secret: "cns_t_handed" } };
    const WAITS = { status: 202, body: { status: "pending", expiresAt: WHEN } };
    const GONE = { status: 404, body: { error: { code: "connect.not_found", message: "Gone." } } };
    const claims = (calls: readonly { key: string }[]): number =>
      calls.filter((call) => call.key === "POST /api/v1/connect/claim").length;
    const begun = (calls: readonly { key: string }[]): number =>
      calls.filter((call) => call.key === "POST /api/v1/connect").length;

    it("the first call says the address and the code and ends at once; the next waits for the approval and keeps the token", async () => {
      const { fetch, calls } = fakeConsole({
        "POST /api/v1/connect": { status: 201, body: CONNECTION },
        "POST /api/v1/connect/claim": CONNECTED,
        "GET /api/v1/me": { body: ME },
      });
      const memory = memoryStore();
      const time = clock();
      const first = harness({
        fetch,
        store: memory.store,
        hostname: "laptop",
        terminal: false,
        ...time,
      });
      expect(await runCli(["login", "--url", ORIGIN, "--agent", "Claude Code"], first.io)).toBe(
        EXIT.ok,
      );
      // Everything a person needs, in what the host shows when the command ends: now. The
      // telling is a sentence of its own and comes before the command, since an agent that read
      // the two in one sentence ran the command first and told its person after; and the wait
      // of the next call is said apart from the code's end, which an agent took for the wait.
      expect(first.out()).toBe(
        "To connect this agent, a person opens https://console.test/connect/ABCD-EFGH signed in, checks that the page shows the code ABCD-EFGH, names the agent and approves.\n" +
          "Tell the person that address and that code now, in a message of its own, before you run the command again.\n" +
          `Then run console login --url https://console.test again: it waits for the approval up to 90 seconds a call, and the code lasts until ${WHEN}.\n`,
      );
      // Nothing was waited for, and nothing claimed.
      expect(claims(calls)).toBe(0);
      expect(time.now()).toBe(START);
      // The connection rests with the credentials, its secret never printed.
      expect(memory.kept()).toEqual({ default: undefined, logins: [], pending: [PENDING] });
      expect(first.out() + first.err()).not.toContain("cns_");

      // The next call begins no connection: it claims the one kept, at once.
      const second = harness({
        fetch,
        store: memory.store,
        hostname: "laptop",
        terminal: false,
        ...time,
      });
      expect(await runCli(["login", "--url", ORIGIN], second.io)).toBe(EXIT.ok);
      expect(begun(calls)).toBe(1);
      expect(claims(calls)).toBe(1);
      expect(time.now()).toBe(START);
      // Where the token is kept is said without the file's path: under an agent the path would
      // be handed to the one reader that must never open that file.
      expect(second.out()).toBe(
        'Connected as "Claude Code on laptop" to Acme at https://console.test as alice (member), the default console here. The token is kept on this machine by the command, and never shown.\n' +
          "Only a project's checkout is bound to it: console use <key> (console projects lists them).\n",
      );
      expect(memory.kept()).toEqual({
        default: ORIGIN,
        logins: [
          {
            url: ORIGIN,
            account: "alice",
            token: "cns_t_handed",
            agent: "Claude Code on laptop",
            since: new Date(START).toISOString(),
          },
        ],
      });
      expect(memory.kept()?.pending).toBeUndefined();
      expect(second.out() + second.err()).not.toContain("cns_");
    });

    it("a call that goes on waits ninety seconds at most, says the code again and how to wait on, and ends with the code of a wait", async () => {
      const { fetch, calls } = fakeConsole({ "POST /api/v1/connect/claim": WAITS });
      const memory = memoryStore({ default: undefined, logins: [], pending: [PENDING] });
      const time = clock();
      const h = harness({ fetch, store: memory.store, terminal: false, ...time });
      expect(await runCli(["login", "--url", ORIGIN], h.io)).toBe(EXIT.waiting);
      // Claimed at once, then after each breath the console asked for, within ninety seconds.
      expect(time.now() - START).toBe(90_000);
      expect(claims(calls)).toBe(91);
      expect(begun(calls)).toBe(0);
      expect(h.out()).toBe(
        "Not approved yet. To connect this agent, a person opens https://console.test/connect/ABCD-EFGH signed in, checks that the page shows the code ABCD-EFGH, names the agent and approves.\n" +
          `Keep waiting with: console login --url https://console.test, as often as needed until ${WHEN}.\n`,
      );
      // The connection is kept for the call after this one, and --wait says another wait.
      expect(memory.kept()?.pending).toEqual([PENDING]);
      const short = harness({ fetch, store: memory.store, terminal: false, ...time });
      const before = time.now();
      expect(await runCli(["login", "--url", ORIGIN, "--wait", "5"], short.io)).toBe(EXIT.waiting);
      expect(time.now() - before).toBe(5_000);
      // No wait at all: the connection is claimed once.
      const none = harness({ fetch, store: memory.store, terminal: false, ...time });
      const then = claims(calls);
      expect(await runCli(["login", "--url", ORIGIN, "--wait", "0"], none.io)).toBe(EXIT.waiting);
      expect(claims(calls)).toBe(then + 1);
      // A wait that is no number of seconds is refused before anything is asked of the console.
      const bad = harness({ fetch, store: memory.store, terminal: false, ...time });
      expect(await runCli(["login", "--url", ORIGIN, "--wait", "soon"], bad.io)).toBe(EXIT.usage);
      expect(claims(calls)).toBe(then + 1);
      // A wait never outlasts the code: the last claim is made while it lasts.
      time.pass(WHEN_MS - time.now() - 3_000);
      const late = harness({ fetch, store: memory.store, terminal: false, ...time });
      expect(await runCli(["login", "--url", ORIGIN], late.io)).toBe(EXIT.waiting);
      expect(time.now()).toBeLessThanOrEqual(WHEN_MS);
    });

    it("forgets a connection whose code ran out, or that the console no longer knows, says so and begins a new one", async () => {
      const next = { ...CONNECTION, code: "WXYZ-1234", url: `${ORIGIN}/connect/WXYZ-1234` };
      const ranOut = fakeConsole({ "POST /api/v1/connect": { status: 201, body: next } });
      const memory = memoryStore({ default: undefined, logins: [], pending: [PENDING] });
      const time = clock();
      time.pass(11 * 60_000);
      const h = harness({ fetch: ranOut.fetch, store: memory.store, terminal: false, ...time });
      expect(await runCli(["login", "--url", ORIGIN], h.io)).toBe(EXIT.ok);
      // The code that ran out is never claimed with: the console is asked for a new one.
      expect(claims(ranOut.calls)).toBe(0);
      expect(h.out()).toContain(
        "The code ABCD-EFGH ran out before a person approved it. A new one:\nTo connect this agent, a person opens https://console.test/connect/WXYZ-1234 signed in",
      );
      expect(memory.kept()?.pending).toEqual([
        { ...PENDING, code: "WXYZ-1234", page: `${ORIGIN}/connect/WXYZ-1234` },
      ]);

      // One the console no longer knows: a person said it was not theirs, or it ran out there.
      const refused = fakeConsole({
        "POST /api/v1/connect": { status: 201, body: next },
        "POST /api/v1/connect/claim": GONE,
      });
      const kept = memoryStore({ ...one(ORIGIN, "cns_t_before"), pending: [PENDING] });
      const r = harness({ fetch: refused.fetch, store: kept.store, terminal: false, ...clock() });
      expect(await runCli(["login", "--url", ORIGIN], r.io)).toBe(EXIT.ok);
      expect(r.out()).toContain(
        "The code ABCD-EFGH is good no longer: it ran out, or a person said the connection was not theirs. A new one:\nTo connect this agent, a person opens https://console.test/connect/WXYZ-1234 signed in",
      );
      expect(kept.kept()?.pending).toEqual([
        { ...PENDING, code: "WXYZ-1234", page: `${ORIGIN}/connect/WXYZ-1234` },
      ]);
      // The login that was there is as it was.
      expect(kept.kept()?.logins).toEqual(one(ORIGIN, "cns_t_before").logins);
      expect(r.out() + r.err()).not.toContain("cns_");

      // A call that asks to be the account itself does not go on with an agent's connection.
      const other = fakeConsole({ "POST /api/v1/connect": { status: 201, body: next } });
      const mixed = memoryStore({ default: undefined, logins: [], pending: [PENDING] });
      const m = harness({ fetch: other.fetch, store: mixed.store, terminal: false, ...clock() });
      expect(await runCli(["login", "--url", ORIGIN, "--self"], m.io)).toBe(EXIT.ok);
      expect(other.calls[0]?.body).toEqual({ agent: "An agent", as: "self" });
      expect(m.out()).toContain(
        "Have that done now, before you run the command again.\nThen run console login --url https://console.test --self again: it waits for the approval up to 90 seconds a call, and the code lasts until ",
      );
      expect(mixed.kept()?.pending).toEqual([
        { ...PENDING, code: "WXYZ-1234", page: `${ORIGIN}/connect/WXYZ-1234`, self: true },
      ]);
    });

    it("at a terminal it waits in the one call as before and keeps nothing; a wait said there is kept to go on with", async () => {
      const { fetch, calls } = fakeConsole({
        "POST /api/v1/connect": { status: 201, body: CONNECTION },
        "POST /api/v1/connect/claim": WAITS,
      });
      const memory = memoryStore();
      const time = clock();
      const h = harness({ fetch, store: memory.store, terminal: true, ...time });
      expect(await runCli(["login", "--url", ORIGIN, "--wait", "3"], h.io)).toBe(EXIT.waiting);
      expect(h.out()).toContain(`\nWaiting for that, until ${WHEN}.\n`);
      expect(h.out()).toContain("Keep waiting with: console login --url https://console.test,");
      expect(claims(calls)).toBe(3);
      expect(memory.kept()?.pending).toEqual([PENDING]);
      // A person who then runs it at the terminal is shown the same code, and waits for it.
      const again = fakeConsole({
        "POST /api/v1/connect/claim": [WAITS, CONNECTED],
        "GET /api/v1/me": { body: ME },
      });
      const a = harness({ fetch: again.fetch, store: memory.store, terminal: true, ...time });
      expect(await runCli(["login", "--url", ORIGIN, "--default"], a.io)).toBe(EXIT.ok);
      expect(begun(again.calls)).toBe(0);
      expect(a.out()).toContain("checks that the page shows the code ABCD-EFGH");
      expect(a.out()).toContain(`\nWaiting for that, until ${WHEN}.\n`);
      expect(memory.kept()?.pending).toBeUndefined();
      expect(memory.kept()?.default).toBe(ORIGIN);

      // With no wait said, the secret never leaves the process, whatever becomes of the call.
      const plain = fakeConsole({
        "POST /api/v1/connect": { status: 201, body: CONNECTION },
        "POST /api/v1/connect/claim": GONE,
      });
      const untouched = memoryStore();
      const p = harness({ fetch: plain.fetch, store: untouched.store, terminal: true, ...clock() });
      expect(await runCli(["login", "--url", ORIGIN], p.io)).toBe(EXIT.failed);
      expect(p.err()).toContain("not approved in time");
      expect(untouched.kept()).toBeUndefined();
    });

    it("at a terminal told not to wait, says that the next call waits while the code lasts, as it does there", async () => {
      // Ninety seconds a call is what a call waits where no terminal shows its words; at a
      // terminal the next call waits until the console says how the connection ended.
      const { fetch, calls } = fakeConsole({
        "POST /api/v1/connect": { status: 201, body: CONNECTION },
        "POST /api/v1/connect/claim": [...Array.from({ length: 120 }, () => WAITS), CONNECTED],
        "GET /api/v1/me": { body: ME },
      });
      const memory = memoryStore();
      const time = clock();
      const first = harness({ fetch, store: memory.store, terminal: true, ...time });
      expect(await runCli(["login", "--url", ORIGIN, "--wait", "0"], first.io)).toBe(EXIT.ok);
      expect(first.out()).toContain(
        `\nThen run console login --url https://console.test again: it waits for the approval while the code lasts, until ${WHEN}.\n`,
      );
      expect(first.out()).not.toContain("90 seconds");
      expect(claims(calls)).toBe(0);
      const second = harness({ fetch, store: memory.store, terminal: true, ...time });
      expect(await runCli(["login", "--url", ORIGIN], second.io)).toBe(EXIT.ok);
      expect(claims(calls)).toBe(121);
      expect(time.now() - START).toBe(120_000);
      expect(memory.kept()?.pending).toBeUndefined();
    });

    it("logins says a connection that waits by its code, never its secret, and logout forgets it", async () => {
      const { fetch } = fakeConsole({});
      const time = clock();
      const memory = memoryStore({
        ...one(ORIGIN, "cns_t_secret"),
        pending: [
          { ...PENDING, url: "https://other.test", page: "https://other.test/connect/ABCD-EFGH" },
          { ...PENDING, url: "https://old.test", expiresAt: "2026-10-09T09:00:00.000Z" },
        ],
      });
      const listed = harness({ fetch, store: memory.store, ...time });
      expect(await runCli(["logins"], listed.io)).toBe(EXIT.ok);
      expect(listed.out()).toBe(
        "https://console.test  alice  (default)\n" +
          `https://other.test  waits for a person to approve the code ABCD-EFGH, until ${WHEN}: console login --url https://other.test\n`,
      );
      const json = harness({ fetch, store: memory.store, ...time });
      expect(await runCli(["logins", "--json"], json.io)).toBe(EXIT.ok);
      expect(JSON.parse(json.out()).waiting).toEqual([
        { url: "https://other.test", code: "ABCD-EFGH", expiresAt: WHEN, self: false },
      ]);
      expect(listed.out() + json.out()).not.toContain("cns_");

      // Signing out of a console forgets the connection that waited there, and any that ran out.
      const waiting = memoryStore({
        ...one(ORIGIN, "cns_t_secret"),
        pending: [
          PENDING,
          { ...PENDING, url: "https://old.test", expiresAt: "2026-10-09T09:00:00.000Z" },
        ],
      });
      const out = harness({ fetch, store: waiting.store, ...time });
      expect(await runCli(["logout", "--url", ORIGIN], out.io)).toBe(EXIT.ok);
      expect(waiting.kept()).toBeUndefined();
      // With nobody signed in, a connection that waited is forgotten all the same.
      const only = memoryStore({ default: undefined, logins: [], pending: [PENDING] });
      const o = harness({ fetch, store: only.store, ...time });
      expect(await runCli(["logout"], o.io)).toBe(EXIT.ok);
      expect(o.out()).toContain("the connection that waited for a person is forgotten");
      expect(only.kept()).toBeUndefined();
      // A token given by hand at a console ends the connection that waited there.
      const byHand = memoryStore({ default: undefined, logins: [], pending: [PENDING] });
      const t = harness({
        fetch: fakeConsole({ "GET /api/v1/me": { body: ME } }).fetch,
        store: byHand.store,
        readStdin: async () => "cns_t_new\n",
        ...time,
      });
      expect(await runCli(["login", "--url", ORIGIN, "--token-stdin"], t.io)).toBe(EXIT.ok);
      expect(byHand.kept()?.pending).toBeUndefined();
    });

    it("logout forgets the connection that waits at a console nobody is signed in to, and what is kept anew carries none whose code ran out", async () => {
      const OTHER = "https://other.test";
      const there = { ...PENDING, url: OTHER, page: `${OTHER}/connect/ABCD-EFGH` };
      const { fetch, calls } = fakeConsole({
        "GET /api/v1/me": {
          body: { ...ME, workspace: { ...ME.workspace, timeZone: "Asia/Seoul" } },
        },
      });
      const time = clock();
      // Signed in at one console, with a connection that waits at another: signing out of the
      // other leaves no secret of it here, though nobody is signed in there.
      const memory = memoryStore({ ...one(ORIGIN, "cns_t_secret"), pending: [there] });
      const h = harness({ fetch, store: memory.store, ...time });
      expect(await runCli(["logout", "--url", OTHER], h.io)).toBe(EXIT.ok);
      expect(h.out()).toBe(
        "Nobody is signed in here at https://other.test; the connection that waited for a person there is forgotten.\n",
      );
      expect(memory.kept()).toEqual(one(ORIGIN, "cns_t_secret"));
      // Nothing was asked of either console: no token was given up.
      expect(calls).toHaveLength(0);
      // With nothing waiting there, it is the refusal it was, and nothing is written.
      const again = harness({ fetch, store: memory.store, ...time });
      expect(await runCli(["logout", "--url", OTHER], again.io)).toBe(EXIT.failed);
      expect(again.err()).toContain(
        "Nobody is signed in here at https://other.test: nothing to forget.",
      );
      expect(memory.kept()).toEqual(one(ORIGIN, "cns_t_secret"));
      // The same where an account is named that is not signed in there.
      const named = memoryStore({
        ...one(OTHER, "cns_t_other", "alice"),
        pending: [there],
      });
      const n = harness({ fetch, store: named.store, ...time });
      expect(await runCli(["logout", "--url", OTHER, "--account", "bob"], n.io)).toBe(EXIT.ok);
      expect(n.out()).toBe(
        "Nobody is signed in here at https://other.test as bob; the connection that waited for a person there is forgotten.\n",
      );
      expect(named.kept()).toEqual(one(OTHER, "cns_t_other", "alice"));

      // Whatever the command keeps anew carries none whose code ran out: whoami keeps the
      // workspace's time zone on its login, and a secret past its code's end goes with that.
      const stale = memoryStore({
        ...one(ORIGIN, "cns_t_secret"),
        pending: [{ ...there, expiresAt: "2026-10-09T09:00:00.000Z" }, PENDING],
      });
      const w = harness({ fetch, store: stale.store, ...time });
      expect(await runCli(["whoami"], w.io)).toBe(EXIT.ok);
      expect(stale.kept()?.logins[0]?.timeZone).toBe("Asia/Seoul");
      expect(stale.kept()?.pending).toEqual([PENDING]);
    });

    it("keeps nothing a console answered that the credentials file would not read back, and says so", async () => {
      // What anything at the address may answer to nobody, and the file's own shape refuses:
      // kept, it would have every later command stop on a file it cannot read, at every console.
      const elsewhere = one("https://other.test", "cns_t_other");
      for (const hostile of [
        { interval: 601 },
        { code: "" },
        { url: `${ORIGIN}/connect/${"A".repeat(2049)}` },
        { secret: "s".repeat(1025) },
        { expiresAt: `2026-10-09T10:00:00.${"0".repeat(30)}Z` },
      ]) {
        const { fetch } = fakeConsole({
          "POST /api/v1/connect": { status: 201, body: { ...CONNECTION, ...hostile } },
        });
        const memory = memoryStore(elsewhere);
        const h = harness({ fetch, store: memory.store, terminal: false, ...clock() });
        expect(await runCli(["login", "--url", ORIGIN], h.io)).toBe(EXIT.failed);
        // The login that was there is as it was, and no code is said of a connection the next
        // call could not go on with.
        expect(memory.kept()).toEqual(elsewhere);
        expect(h.out()).toBe("");
        expect(h.err()).not.toBe("");
      }

      // The same of what the console hands over once a person approved: a token longer than the
      // file reads is not kept, in words, and the connection that waited is as it was.
      const long = fakeConsole({
        "POST /api/v1/connect/claim": {
          body: { status: "connected", token: TOKEN, secret: "t".repeat(1025) },
        },
        "GET /api/v1/me": { body: ME },
        "DELETE /api/v1/me/token": { status: 204 },
      });
      const before = { ...one(ORIGIN, "cns_t_before"), pending: [PENDING] };
      const waiting = memoryStore(before);
      const l = harness({ fetch: long.fetch, store: waiting.store, terminal: false, ...clock() });
      expect(await runCli(["login", "--url", ORIGIN], l.io)).toBe(EXIT.failed);
      expect(l.err()).toBe(
        "https://console.test answered what the command cannot keep: a code, a token or a name beyond the bounds a console's have. Nothing was kept. Check that the address is the console's, and sign in again.\n",
      );
      expect(waiting.kept()).toEqual(before);
      // The token the login would have replaced is not given up for one that was never kept.
      expect(long.calls.map((call) => call.key)).not.toContain("DELETE /api/v1/me/token");
      // And of who the console says the token is: a login longer than an account's is.
      const named = fakeConsole({
        "GET /api/v1/me": { body: { ...ME, person: { ...PERSON, login: "a".repeat(255) } } },
      });
      const byHand = memoryStore(elsewhere);
      const n = harness({
        fetch: named.fetch,
        store: byHand.store,
        readStdin: async () => "cns_t_new\n",
        ...clock(),
      });
      expect(await runCli(["login", "--url", ORIGIN, "--token-stdin"], n.io)).toBe(EXIT.failed);
      expect(n.err()).toContain("answered what the command cannot keep");
      expect(byHand.kept()).toEqual(elsewhere);
    });
  });

  it("signs in as the account itself with --self: a session of the command's, kept as a token is, and said to be one (ADR-0084)", async () => {
    const session = {
      id: "0199c4d8-0000-7000-8000-0000000000a1",
      current: false,
      createdAt: WHEN,
      lastSeenAt: WHEN,
      expiresAt: WHEN,
      browser: null,
      platform: null,
      address: null,
      kind: "command",
      name: "console on mac-mini",
    };
    const itself = {
      ...ME,
      person: { ...PERSON, login: "mira@acme.example", kind: "agent", handle: "mira" },
      agent: null,
      session: { kind: "command", name: "console on mac-mini" },
    };
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/connect": { status: 201, body: CONNECTION },
      "POST /api/v1/connect/claim": [
        { status: 202, body: { status: "pending", expiresAt: WHEN } },
        { body: { status: "signed_in", session, secret: "cns_a_handed" } },
      ],
      "GET /api/v1/me": { body: itself },
    });
    const memory = memoryStore();
    const h = harness({ fetch, store: memory.store, hostname: "mac-mini" });
    expect(await runCli(["login", "--url", ORIGIN, "--self", "--agent", "console"], h.io)).toBe(
      EXIT.ok,
    );
    // The command says what it asks to be; the account says "this is me" on the page.
    expect(calls[0]?.body).toEqual({ agent: "console on mac-mini", as: "self" });
    expect(h.out()).toContain("signed in as that account");
    expect(h.out()).toContain("code ABCD-EFGH");
    expect(h.out()).toContain(
      "Signed in to Acme at https://console.test as @mira (mira@acme.example, member), the account itself",
    );
    // At a terminal, a person is told the file its secret is kept in.
    expect(h.out()).toContain(
      "The session is kept while it is used; its secret is kept in /home/alice/.config/skillcdn-console/credentials.json.\n",
    );
    expect(memory.kept()?.logins).toEqual([
      {
        url: ORIGIN,
        account: "mira@acme.example",
        token: "cns_a_handed",
        agent: undefined,
        since: "1970-01-01T00:00:00.000Z",
        self: true,
      },
    ]);
    expect(h.out()).not.toContain("cns_");
    // Where no terminal shows the words, an agent reads them: the file is not named to it,
    // for the account itself as for an agent's token, and for a token given by hand.
    const unattended = fakeConsole({
      "POST /api/v1/connect": { status: 201, body: CONNECTION },
      "POST /api/v1/connect/claim": {
        body: { status: "signed_in", session, secret: "cns_a_handed" },
      },
      "GET /api/v1/me": { body: itself },
    });
    const under = memoryStore();
    const begun = harness({ fetch: unattended.fetch, store: under.store, terminal: false });
    expect(await runCli(["login", "--url", ORIGIN, "--self"], begun.io)).toBe(EXIT.ok);
    const agentRead = harness({ fetch: unattended.fetch, store: under.store, terminal: false });
    expect(await runCli(["login", "--url", ORIGIN, "--self"], agentRead.io)).toBe(EXIT.ok);
    expect(agentRead.out()).toBe(
      "Signed in to Acme at https://console.test as @mira (mira@acme.example, member), the account itself, the default console here: what this command does, mira@acme.example does, and no agent is named beside it. The session is kept while it is used; its secret is kept on this machine by the command, and never shown.\n" +
        "Only a project's checkout is bound to it: console use <key> (console projects lists them).\n",
    );
    const byHand = harness({
      fetch: fakeConsole({ "GET /api/v1/me": { body: ME } }).fetch,
      store: memoryStore().store,
      readStdin: async () => "cns_t_new\n",
      terminal: false,
    });
    expect(await runCli(["login", "--url", ORIGIN, "--token-stdin"], byHand.io)).toBe(EXIT.ok);
    expect(byHand.out()).toContain(
      "The token is kept on this machine by the command, and never shown.\n",
    );
    const read = harness({ fetch, store: under.store, terminal: false });
    expect(await runCli(["logins"], read.io)).toBe(EXIT.ok);
    for (const said of [begun, agentRead, byHand, read]) {
      expect(said.out() + said.err()).not.toContain("credentials.json");
      expect(said.out() + said.err()).not.toContain("/home/alice");
    }
    // What is kept is presented as a token is, and the listings say what it is.
    const listed = harness({ fetch, store: memory.store });
    expect(await runCli(["logins"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toBe(
      "https://console.test  mira@acme.example  as the account itself  since 1970-01-01  (default)\n",
    );
    const who = harness({ fetch, store: memory.store });
    expect(await runCli(["whoami"], who.io)).toBe(EXIT.ok);
    expect(new Headers(calls.at(-1)?.init?.headers).get("authorization")).toBe(
      "Bearer cns_a_handed",
    );
    expect(who.out()).toContain(
      "@mira (mira@acme.example, member) at Acme, https://console.test; no project named here; signed in as the account itself",
    );
    // Its desk names no project, and the help sends an agent here for where the skill is.
    expect(who.out()).toContain(
      "Before the first task, read console rules and the skill working-the-board (console skills says where it is); for one command's flags, console help <command>.",
    );
    // A login without --self asks for nothing in particular: an agent's token, as it always was.
    const plain = harness({ fetch, store: memoryStore().store, hostname: "laptop" });
    await runCli(["login", "--url", ORIGIN], plain.io);
    expect(calls.filter((call) => call.key === "POST /api/v1/connect").at(-1)?.body).toEqual({
      agent: "An agent on laptop",
    });
  });

  it("says whom one reports to, and the administrators where there is nobody (ADR-0084)", async () => {
    const boss = { ...PERSON, id: "0199c4d8-0000-7000-8000-0000000000b1", login: "jane" };
    const admin = {
      ...PERSON,
      id: "0199c4d8-0000-7000-8000-0000000000b2",
      login: "tom",
      name: "Tom",
      role: "admin",
      title: "Founder",
    };
    const { fetch } = fakeConsole({
      "GET /api/v1/me/manager": [
        { body: { manager: boss, administrators: [admin] } },
        { body: { manager: null, administrators: [admin] } },
        { body: { manager: { ...boss, status: "deactivated" }, administrators: [admin] } },
      ],
    });
    const reporting = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["manager"], reporting.io)).toBe(EXIT.ok);
    expect(reporting.out()).toBe("You report to: jane  (member)\n");
    const nobody = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["manager"], nobody.io)).toBe(EXIT.ok);
    expect(nobody.out()).toBe(
      "You report to nobody.\nThe administrators, who stand in:\n  tom  Tom, Founder  (admin)\n",
    );
    // A manager who is out is named still, with whoever stands in.
    const out = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["manager"], out.io)).toBe(EXIT.ok);
    expect(out.out()).toBe(
      "You report to: jane  (member, deactivated)\nThe administrators, who stand in:\n  tom  Tom, Founder  (admin)\n",
    );
  });

  it("signs out: gives the token up at the console and forgets it here, and forgets it when the console is out of reach", async () => {
    const { fetch, calls } = fakeConsole({ "DELETE /api/v1/me/token": { status: 204 } });
    const memory = memoryStore(one(ORIGIN, "cns_t_kept"));
    const h = harness({ fetch, store: memory.store });
    expect(await runCli(["logout"], h.io)).toBe(EXIT.ok);
    expect(calls.map((call) => call.key)).toEqual(["DELETE /api/v1/me/token"]);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_kept");
    expect(memory.kept()).toBeUndefined();
    expect(h.out()).toContain("given up at the console and forgotten here");
    const away = memoryStore(one(ORIGIN, "cns_t_kept"));
    const down = harness({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      store: away.store,
    });
    expect(await runCli(["logout"], down.io)).toBe(EXIT.ok);
    expect(away.kept()).toBeUndefined();
    expect(down.out()).toContain("could not be reached");
    expect(down.out()).toContain("Agents page");
    const nobody = harness({ fetch });
    expect(await runCli(["logout"], nobody.io)).toBe(EXIT.ok);
    expect(nobody.out()).toContain("nothing to forget");
    // The console keeps the token of a person who is out, for when they are back (ADR-0044).
    const refusing = fakeConsole({
      "DELETE /api/v1/me/token": {
        status: 403,
        body: { error: { code: "auth.deactivated", message: "The person is deactivated." } },
      },
    });
    const kept = memoryStore(one(ORIGIN, "cns_t_kept"));
    const outside = harness({ fetch: refusing.fetch, store: kept.store });
    expect(await runCli(["logout"], outside.io)).toBe(EXIT.ok);
    expect(kept.kept()).toBeUndefined();
    expect(outside.out()).toContain("keeps the token while the person is out");
    expect(h.out() + down.out() + outside.out()).not.toContain("cns_");
  });

  it("works in the project the flag, the environment or the directory names, and says so when none does", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks?limit=50&offset=0&brief=true`]: { body: { more: false, items: [TASK] } },
      "GET /api/v1/projects/ops/tasks?limit=50&offset=0&brief=true": {
        body: { more: false, items: [] },
      },
      "GET /api/v1/projects/dir/tasks?limit=50&offset=0&brief=true": {
        body: { more: false, items: [] },
      },
    });
    const flagged = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks", "--project", "ops"], flagged.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("GET /api/v1/projects/ops/tasks?limit=50&offset=0&brief=true");
    const fromDirectory = harness({
      fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
      directory: memoryDirectory({ project: "dir" }).store,
    });
    expect(await runCli(["tasks"], fromDirectory.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("GET /api/v1/projects/dir/tasks?limit=50&offset=0&brief=true");
    const none = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["tasks"], none.io)).toBe(EXIT.failed);
    expect(none.err()).toContain("console use <key>");
    expect(none.err()).toContain("--project <key>");
  });

  it("lists the projects, and keeps the one to work in with the directory", async () => {
    const { fetch } = fakeConsole({
      "GET /api/v1/projects": {
        body: {
          items: [
            PROJECT,
            { ...PROJECT, key: "ops", name: "Ops", role: "owner", openDecisions: 0, openRuns: 2 },
          ],
        },
      },
      [`GET ${IN}`]: { body: PROJECT },
    });
    const listed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["projects"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toBe(
      "web  The web app  (member; 1 decision waiting)\nops  Ops  (owner)\n",
    );
    const directory = memoryDirectory();
    const used = harness({
      fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
      directory: directory.store,
    });
    expect(await runCli(["use", "web"], used.io)).toBe(EXIT.ok);
    // The file names the console every time, the default one too: a clone on a machine whose
    // default login is another console works at this one all the same (ADR-0112).
    expect(used.out()).toContain(
      `Working in The web app (web) at ${ORIGIN} from this directory on`,
    );
    expect(used.out()).toContain("names the project and the console, never a token");
    expect(used.out()).toContain("left out of a public one");
    expect(used.out()).toContain("/work/app/.skillcdn-console.json");
    // The sentence says to check, where it stated a condition: a condition nobody tested is
    // passed over, and an agent that never ran whoami began work with no task.
    expect(
      used
        .out()
        .endsWith(
          "\n\n**Bound to a console?** Before the first step, run `console whoami`: when it names a project, or `.skillcdn-console.json` is in this checkout, work the task through that SkillCDN console (its answer says how).\n",
        ),
    ).toBe(true);
    expect(directory.kept()).toEqual({ project: "web", url: ORIGIN });
    const unknown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["use", "nothing"], unknown.io)).toBe(EXIT.failed);
    expect(unknown.err()).toContain("not_found");
    const who = harness({
      fetch: fakeConsole({ "GET /api/v1/me": { body: ME }, [`GET ${IN}`]: { body: PROJECT } })
        .fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["whoami"], who.io)).toBe(EXIT.ok);
    expect(who.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project web (The web app), named by CONSOLE_PROJECT\nBefore the first task, read console rules and the skill working-the-board (console skills says where it is); for one command's flags, console help <command>.\nThis command is of a version it does not know; the console is 0.1.18 and takes >=0.1.18 <0.2.0; this command works with a console from 0.0.0 on.\n`,
    );
  });

  it("serves a console of one's own: the API carried with the token, from the page's origin only", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks`]: { body: { more: false, items: [TASK] } },
    });
    let close: () => void = () => undefined;
    let ready: (handler: ServeHandler) => void = () => undefined;
    const handler = new Promise<ServeHandler>((resolve) => {
      ready = resolve;
    });
    const listen: Listen = async (handlerFor, port) => {
      ready(handlerFor(port));
      return {
        url: `http://127.0.0.1:${port}/`,
        closed: new Promise<void>((done) => {
          close = done;
        }),
        close: async () => close(),
      };
    };
    const h = harness({ fetch, env: SIGNED_IN, listen });
    const running = runCli(["serve", "--port", "4100"], h.io);
    const serve = await handler;
    const at = `http://127.0.0.1:4100${IN}/tasks`;
    const tasks = await serve(
      new Request(at, {
        headers: { "sec-fetch-site": "same-origin", cookie: "console_session=x" },
      }),
    );
    expect(tasks.status).toBe(200);
    expect(await tasks.json()).toEqual({ more: false, items: [TASK] });
    const carried = new Headers(
      calls.find((call) => call.key === `GET ${IN}/tasks`)?.init?.headers,
    );
    expect(carried.get("authorization")).toBe("Bearer cns_t_secret");
    expect(carried.get("cookie")).toBeNull();
    // Another site's page, with the person's standing: refused. Nothing but the API without a build.
    expect(
      (await serve(new Request(at, { headers: { "sec-fetch-site": "cross-site" } }))).status,
    ).toBe(403);
    expect((await serve(new Request("http://127.0.0.1:4100/"))).status).toBe(404);
    close();
    expect(await running).toBe(EXIT.ok);
    expect(h.out()).toContain("http://127.0.0.1:4100/api/");
    expect(h.out()).toContain("as alice");
    expect(h.out()).not.toContain("cns_t_");
    // Where the command cannot listen, it says so instead of serving.
    const nowhere = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["serve"], nowhere.io)).toBe(EXIT.failed);
    expect(nowhere.err()).toContain("not possible here");
    expect(await runCli(["serve", "--port", "x"], nowhere.io)).toBe(EXIT.usage);
  });

  it("serves the records of a desk beside the API with --records, a directory that is not there yet as one that holds nothing, and none from what is no directory (ADR-0117, ADR-0122)", async () => {
    const { fetch } = fakeConsole({ "GET /api/v1/me": { body: ME } });
    const desk = mkdtempSync(join(tmpdir(), "console-cli-records-"));
    /** A serve that is run and held: its handler once it listens, and the way to stop it. */
    const held = () => {
      let close: () => void = () => undefined;
      let ready: (handler: ServeHandler) => void = () => undefined;
      const handler = new Promise<ServeHandler>((resolve) => {
        ready = resolve;
      });
      const listen: Listen = async (handlerFor, port) => {
        ready(handlerFor(port));
        return {
          url: `http://127.0.0.1:${port}/`,
          closed: new Promise<void>((done) => {
            close = done;
          }),
          close: async () => close(),
        };
      };
      return { handler, listen, stop: () => close() };
    };
    const ask = (serve: ServeHandler): Promise<Response> =>
      serve(
        new Request("http://127.0.0.1:4100/records/index.json", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
      );
    try {
      writeFileSync(join(desk, "index.json"), '{"collections":[]}');
      const there = held();
      const h = harness({ fetch, env: SIGNED_IN, listen: there.listen });
      const running = runCli(["serve", "--port", "4100", "--records", desk], h.io);
      const index = await ask(await there.handler);
      expect(index.status).toBe(200);
      expect(await index.json()).toEqual({ collections: [] });
      there.stop();
      expect(await running).toBe(EXIT.ok);
      expect(h.out()).toContain(
        `The records in ${desk} are at http://127.0.0.1:4100/records/, read as they are when they are asked for. Stop with Ctrl+C.`,
      );

      // A directory that is not there yet is no error: a desk keeps nothing until its member
      // asks, and its pages are served all the same (ADR-0122). Nothing is under /records/
      // until the directory is there, the line says so, and what comes to be kept is served
      // with no restart.
      const later = join(desk, "records");
      const yet = held();
      const waiting = harness({ fetch, env: SIGNED_IN, listen: yet.listen });
      const served = runCli(["serve", "--port", "4100", "--records", later], waiting.io);
      const serve = await yet.handler;
      const none = await ask(serve);
      expect(none.status).toBe(404);
      expect(await none.json()).toMatchObject({ error: { code: "records.not_found" } });
      mkdirSync(later);
      writeFileSync(join(later, "index.json"), '{"collections":[{"key":"first"}]}');
      const first = await ask(serve);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ collections: [{ key: "first" }] });
      yet.stop();
      expect(await served).toBe(EXIT.ok);
      expect(waiting.out()).toContain(
        `Nothing is kept in ${later} yet: what comes to be kept there is at http://127.0.0.1:4100/records/ from then on, with no restart. Stop with Ctrl+C.`,
      );
      expect(waiting.err()).toBe("");

      // What is there and is no directory is said before anything listens.
      let listened = false;
      const file = harness({
        fetch,
        env: SIGNED_IN,
        listen: async (...args) => {
          listened = true;
          return held().listen(...args);
        },
      });
      expect(await runCli(["serve", "--records", join(desk, "index.json")], file.io)).toBe(
        EXIT.failed,
      );
      expect(file.err()).toContain("No records to serve:");
      expect(file.err()).toContain("is there and is not a directory");
      expect(file.err()).toContain("console serve <dir> --records <desk>/records");
      expect(listened).toBe(false);
    } finally {
      rmSync(desk, { recursive: true, force: true });
    }
  });

  it("takes the token from the environment over what was kept, and answers JSON on demand", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks?limit=50&offset=0`]: { body: { more: false, items: [TASK] } },
      [`GET ${IN}/tasks?limit=50&offset=0&brief=true`]: { body: { more: false, items: [TASK] } },
    });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      store: memoryStore(one("https://other.test", "cns_t_kept")).store,
    });
    expect(await runCli(["tasks", "--json"], h.io)).toBe(EXIT.ok);
    expect(JSON.parse(h.out())).toEqual({ more: false, items: [TASK] });
    // --json is the console's own answer, whole; the words ask for the listing in the brief form.
    expect(calls[0]?.key).toBe(`GET ${IN}/tasks?limit=50&offset=0`);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_secret");
    const words = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks"], words.io)).toBe(EXIT.ok);
    expect(words.out()).toBe("#7  ready  high  Fix the parser  (owner alice)\n");
  });

  it("lists the pack as a client is told of it on connect, every skill with the documents counted, and where the console's own skills are", async () => {
    const { fetch } = fakeConsole({ [`GET ${IN}/skills`]: { body: LISTING } });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      skillsDir: "/usr/lib/node_modules/@skillcdn/console/skills/",
    });
    expect(await runCli(["skills"], h.io)).toBe(EXIT.ok);
    const out = h.out();
    expect(out).toContain("skills at /gh/acme/skills, served by https://skillcdn.test: ready");
    // What a client is told on connect, with the reads named as the console's commands.
    expect(out).toContain("Skills and documents from acme/skills (commit 0123456)");
    expect(out).toContain("Acme: What Acme does, as skills.");
    expect(out).toContain("review/SKILL.md: Reviews a change.");
    expect(out).toContain(
      "console skills <folder> explores folders and outlines a file by its headings; console skills --search matches original words (usually English) and names the sections that matched. console skill loads an exact SKILL.md path",
    );
    expect(out).toContain(
      "console skill --file reads optional references, or one section by its offset and limit.",
    );
    expect(out).toContain("skill://gh/acme/skills/");
    // Every skill; the documents outside them are counted, with the commands that read them,
    // and not listed (SkillCDN 0.6.3): a pack of documents holds hundreds.
    expect(out).toContain("1 skill and 1 document in acme/skills (commit 0123456):");
    expect(out).toContain("1. skill: review (review/SKILL.md)\n   Reviews a change.");
    expect(out).not.toContain("document: docs/guide.md");
    expect(out).toContain(
      "The 1 document outside the skills is not listed here: console skills <folder> lists a folder with what it holds, and console skills --search finds them by what they say.",
    );
    // A reader of a command is told of parts and of the command that prints the next, no cursor.
    expect(out).toContain("a long skill comes in parts, each ending with the command that prints");
    expect(out).not.toContain("nextCursor");
    // Where a person connects an agent of its own, and where the console's own skills are.
    expect(out).toContain("a person makes at https://skillcdn.test/gh/acme/skills");
    expect(out).toContain(
      "The console's own skills, for working the board and keeping a desk: /usr/lib/node_modules/@skillcdn/console/skills/",
    );
    const none = fakeConsole({
      [`GET ${IN}/skills`]: {
        body: {
          address: null,
          source: "https://skillcdn.ai",
          page: null,
          status: "none",
          refusal: null,
          items: [],
          mount: null,
        },
      },
    });
    // A pack that is not there to read ends the command as refused, as the skillcdn command
    // ends on one (ADR-0118): the words on standard error, and nothing printed as if it were the pack.
    const n = harness({ fetch: none.fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], n.io)).toBe(EXIT.failed);
    expect(n.out()).toBe("");
    expect(n.err()).toBe(
      "No skills address: neither this project nor the console names one.\nThe plugins of this console have skills of their own: console plugins lists the plugins, console plugin <key> skills the skills of one.\n",
    );
    const down = fakeConsole({
      [`GET ${IN}/skills`]: {
        body: {
          ...LISTING,
          status: "unavailable",
          refusal: { code: "network", message: "No answer.", sourceUrl: null, directories: [] },
          items: [],
          mount: null,
        },
      },
    });
    const d = harness({ fetch: down.fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], d.io)).toBe(EXIT.failed);
    expect(d.out()).toBe("");
    expect(d.err()).toContain(
      "skills at /gh/acme/skills, served by https://skillcdn.test: unavailable",
    );
    expect(d.err()).toContain("could not be reached");
    expect(d.err()).toContain("No answer.");
    // --json still prints what the console answered, which says the status, and ends the same.
    const dj = harness({ fetch: down.fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "--json"], dj.io)).toBe(EXIT.failed);
    expect(JSON.parse(dj.out())).toMatchObject({ status: "unavailable" });
    // A pack read from the console's machine has no deployment and no page.
    const local = fakeConsole({
      [`GET ${IN}/skills`]: {
        body: {
          ...LISTING,
          address: "/local/acme/skills",
          source: null,
          page: null,
          items: [
            { ...LISTING.items[0], page: null, uri: "skill://local/acme/skills/review/SKILL.md" },
          ],
          mount: {
            ...MOUNT,
            address: "/local/acme/skills",
            repository: { ...MOUNT.repository, host: "local", defaultBranch: "", avatar: "" },
            verified: true,
          },
        },
      },
    });
    const l = harness({ fetch: local.fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], l.io)).toBe(EXIT.ok);
    expect(l.out()).toContain(
      "skills at /local/acme/skills, read from the console's machine: ready",
    );
    expect(l.out()).toContain("skill://local/acme/skills/");
    expect(l.out()).not.toContain("a person makes at");
  });

  it("says the address of a task's page and of a decision's, made from the console's origin and asked of no console", async () => {
    const TASK_PAGE = "page: https://console.test/projects/web/tasks/7";
    const IN_PROJECT = `page: https://console.test/projects/web/decisions/${DECISION.id}`;
    const ITS_OWN = `page: https://console.test/decisions/${DECISION.id}`;
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`PATCH ${IN}/tasks/${TASK.id}`]: { body: TASK },
      [`GET ${IN}/decisions?task=${TASK.id}`]: { body: { more: false, items: [] } },
      [`GET ${IN}/runs?task=${TASK.id}&brief=true`]: { body: { more: false, items: [] } },
      [`GET ${IN}/tasks/${TASK.id}/comments`]: { body: { items: [] } },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/me": { body: ME },
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: DECISION },
      [`GET ${IN}/decisions/${DECISION.id}`]: { body: DECISION },
      [`POST ${IN}/decisions/${DECISION.id}/answer`]: { body: ANSWERED },
      [`GET /api/v1/decisions/${DECISION.id}`]: {
        body: {
          decision: DECISION,
          project: { key: "leave", name: "Leave", color: null, symbol: null, icon: null },
        },
      },
    });
    // A task read, and a task changed: the address after its id, on a line of its own.
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["task", "7"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain(`\nid: ${TASK.id}\n${TASK_PAGE}\n`);
    const edited = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["task", "edit", "7", "--priority", "high"], edited.io)).toBe(EXIT.ok);
    expect(edited.out()).toContain(`\n${TASK_PAGE}\n`);
    // A task taken says it once, in the task's own lines.
    const taken = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], taken.io)).toBe(EXIT.ok);
    expect(taken.out().split(TASK_PAGE)).toHaveLength(2);
    // A decision raised, read and answered in the project the command works in: the project's page.
    const asked = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--wait", "0"], asked.io),
    ).toBe(EXIT.waiting);
    expect(asked.out()).toContain(`\ndecision id: ${DECISION.id}\n${IN_PROJECT}\n`);
    const one = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id], one.io)).toBe(EXIT.ok);
    expect(one.out()).toContain(`\n${IN_PROJECT}\n`);
    const answered = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["answer", DECISION.id, "--option", "2"], answered.io)).toBe(EXIT.ok);
    expect(answered.out()).toContain(`\n${IN_PROJECT}\n`);
    // A decision reached wherever it is (ADR-0068), with no project named: its own address,
    // which whoever it reaches may open, in that project or not.
    const anywhere = harness({
      fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
    });
    expect(await runCli(["decision", DECISION.id], anywhere.io)).toBe(EXIT.ok);
    expect(anywhere.out()).toContain(`\n${ITS_OWN}\n`);
    expect(anywhere.out()).not.toContain("/projects/");
    // --json is the console's own answer, as it was: no address is added to it.
    const json = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id, "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toEqual(DECISION);
    // Nothing was asked of the console for an address: no request names a page.
    expect(calls.some((call) => call.key.includes("/connect") || call.key.endsWith("/pages"))).toBe(
      false,
    );
  });

  it("reads the runs of a listing in the brief form: counted, and without their reports", async () => {
    const { reports: _reports, ...withoutReports } = RUN;
    const brief = { ...withoutReports, reportCount: 5 };
    const { fetch } = fakeConsole({
      [`GET ${IN}/runs?limit=50&offset=0&brief=true`]: { body: { more: false, items: [brief] } },
    });
    const counted = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["runs"], counted.io)).toBe(EXIT.ok);
    expect(counted.out()).toContain("(5 reports, 0 artifacts, last heard ");
  });

  it("takes a task by its number, says which run began, and prints the rules that hold", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks/${TASK.id}/comments`]: { body: { items: [COMMENT] } },
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(
      `Run ${RUN.id} began on #7 Fix the parser, as "Claude Code" for alice`,
    );
    expect(h.out()).toContain("It fails on empty input.");
    // Nothing was open on the task, so nothing is said of a take-over; no other run of the
    // token is open in the project, so nothing of saying which run.
    expect(h.out()).not.toContain("taking it was deciding");
    expect(h.out()).not.toContain("Other runs of yours");
    // The rules come with the run, under a line that says what follows: what the project adds
    // first, then the console's, before what to do next (ADR-0119, ADR-0120).
    expect(h.out()).toMatch(
      /\nRules [0-9a-f]{8}: this project's additions first \(\d+ characters\), then the console's \(\d+ characters\), the earlier holding where they differ; the organization adds nothing\. A later take in this session leaves them out: console take <number> --rules [0-9a-f]{8}\n/,
    );
    expect(h.out()).toMatch(/Ask before pushing\.[\s\S]*Read these\.[\s\S]*Say how it goes/);
    // The discussion comes with the task, whole, each file with the command that reads it.
    expect(h.out()).toContain(
      `comments:\n  bob as Codex on the laptop, ${WHEN}, comment ${COMMENT.id}:`,
    );
    expect(h.out()).toContain("    Which screen did you mean? See the picture.");
    expect(h.out()).toContain(
      `    file: screen.png (2048 bytes, image/png): console file ${COMMENT.files[0]?.id}`,
    );
    expect(calls[1]?.body).toEqual({ taskId: TASK.id });
    const named = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--agent", "Codex on the laptop"], named.io)).toBe(EXIT.ok);
    expect(calls[8]?.body).toEqual({ taskId: TASK.id, agent: "Codex on the laptop" });
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--json"], asJson.io)).toBe(EXIT.ok);
    // --json carries the rules whole, and their mark.
    const taken = JSON.parse(asJson.out()) as { rules: { mark: string } };
    expect(taken).toEqual({
      run: RUN,
      task: TASK,
      comments: [COMMENT],
      rules: { ...RULES, mark: expect.stringMatching(/^[0-9a-f]{8}$/) },
    });
    const mark = taken.rules.mark;
    expect(h.out()).toContain(`\nRules ${mark}: `);
    // A later take of the session says the mark it holds: the rules are left out, and a line
    // stands in their place. Everything else of the take is as it was.
    const again = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--rules", mark], again.io)).toBe(EXIT.ok);
    expect(again.out()).toContain(`Run ${RUN.id} began on #7 Fix the parser`);
    expect(again.out()).toContain("It fails on empty input.");
    // The line that answers the mark stands directly after the run's ids, before the task: a
    // take cut at its head still shows it.
    expect(again.out()).toContain(
      `\nrun id: ${RUN.id}  task id: ${TASK.id}  (task #7)\nRules ${mark}: left out, since they stand as this session read them. console rules prints them.\n\n#7 Fix the parser\n`,
    );
    expect(again.out().split("\n").slice(0, 3).join("\n")).toContain("left out");
    expect(again.out()).not.toContain("Ask before pushing.");
    expect(again.out()).not.toContain("Read these.");
    expect(again.out()).toContain("Say how it goes");
    // A mark that is not the rules' own, since they changed or it is of another project's:
    // the rules whole, under the mark they have now, and a line that says so first.
    const stale = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--rules", "0a1b2c3d"], stale.io)).toBe(EXIT.ok);
    // Said before the task, where a cut at the head leaves it; the rules themselves follow the
    // task, whole, as they do without a mark.
    expect(stale.out()).toContain(
      `\nrun id: ${RUN.id}  task id: ${TASK.id}  (task #7)\nThe rules are not the ones marked 0a1b2c3d: they changed since, or that mark is of another project's. They follow whole after the task, under the mark they have now.\n\n#7 Fix the parser\n`,
    );
    expect(stale.out().indexOf("It fails on empty input.")).toBeLessThan(
      stale.out().indexOf(`\nRules ${mark}: `),
    );
    // Without a mark nothing moves: the rules' own first line stands after the task.
    expect(h.out().indexOf("It fails on empty input.")).toBeLessThan(
      h.out().indexOf(`\nRules ${mark}: `),
    );
    expect(h.out().split("\n").slice(0, 3).join("\n")).not.toContain("Rules ");
    expect(stale.out()).toContain("Ask before pushing.");
    expect(stale.out()).toContain("Read these.");
    // --json carries the rules either way: a program reads what it is given.
    const heldJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--rules", mark, "--json"], heldJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(heldJson.out())).toMatchObject({ rules: { ...RULES, mark } });
    // A run open on the task is taken over, and that is said.
    const busy = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: { ...TASK, openRuns: 1 } },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks/${TASK.id}/comments`]: { body: { items: [] } },
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
    });
    const over = harness({ fetch: busy.fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], over.io)).toBe(EXIT.ok);
    expect(over.out()).toContain("A run that was open on it is over now");
    // Another run of the token open in the project: said, with the id to say from here on,
    // before the first report meets the refusal.
    const beside = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks/${TASK.id}/comments`]: { body: { items: [] } },
      [OPEN_RUNS]: {
        body: {
          more: false,
          items: [RUN, { ...RUN, id: "0199c4d8-0000-7000-8000-000000000021", taskNumber: 9 }],
        },
      },
    });
    const two = harness({ fetch: beside.fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], two.io)).toBe(EXIT.ok);
    expect(two.out()).toContain(
      `Other runs of yours are open in this project (#9): say which run on report, hand-in, ask, finish and fail, --run ${RUN.id} for this one.`,
    );
  });

  it("writes a task and takes it in one command, the number first, with --take", async () => {
    // Work given in chat is written and taken at once: a session that sends its commands
    // together cannot read a number between them, and another agent writes on the same board.
    const READY = { ...TASK, state: "ready" };
    const table = {
      [`POST ${IN}/tasks`]: { status: 201, body: READY },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks/${TASK.id}`]: { body: TASK },
      [`GET ${IN}/tasks/${TASK.id}/comments`]: { body: { items: [] } },
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
    };
    const { fetch, calls } = fakeConsole(table);
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "task",
          "new",
          "Fix the parser",
          "--body",
          "It fails.",
          "--category",
          "engineering",
          "--take",
        ],
        h.io,
      ),
    ).toBe(EXIT.ok);
    // The task first, as task new prints it, then the take, as take prints it.
    expect(
      h
        .out()
        .startsWith(
          `Task #7 written: Fix the parser\ntask id: ${TASK.id}\nRun ${RUN.id} began on #7 Fix the parser, as "Claude Code" for alice. The task is in progress and theirs.\nrun id: ${RUN.id}  task id: ${TASK.id}  (task #7)\n`,
        ),
    ).toBe(true);
    expect(h.out()).toContain("Ask before pushing.");
    expect(h.out()).toContain("Say how it goes");
    // Written before it is taken, and ready where no state is said: an idea is not taken.
    const keys = calls.map((call) => call.key);
    expect(keys.indexOf(`POST ${IN}/tasks`)).toBe(0);
    expect(keys.indexOf(`POST ${IN}/runs`)).toBe(1);
    expect(calls[0]?.body).toEqual({
      title: "Fix the parser",
      body: "It fails.",
      state: "ready",
      category: "engineering",
    });
    expect(calls[1]?.body).toEqual({ taskId: TASK.id });
    // The mark and the agent's name go to the take, as console take has them.
    const ruled = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "--json"], ruled.io)).toBe(EXIT.ok);
    const mark = (JSON.parse(ruled.out()) as { mark: string }).mark;
    const held = fakeConsole(table);
    const again = harness({ fetch: held.fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["task", "new", "Fix the parser", "--take", "--rules", mark, "--agent", "Codex"],
        again.io,
      ),
    ).toBe(EXIT.ok);
    expect(again.out()).toContain(
      `\nrun id: ${RUN.id}  task id: ${TASK.id}  (task #7)\nRules ${mark}: left out, since they stand as this session read them. console rules prints them.\n`,
    );
    expect(again.out()).not.toContain("Ask before pushing.");
    expect(held.calls[1]?.body).toEqual({ taskId: TASK.id, agent: "Codex" });
    // A state said is the state written, where a run may begin on it.
    const idea = fakeConsole(table);
    expect(
      await runCli(
        ["task", "new", "Fix the parser", "--state", "idea", "--take"],
        harness({ fetch: idea.fetch, env: SIGNED_IN }).io,
      ),
    ).toBe(EXIT.ok);
    expect(idea.calls[0]?.body).toEqual({ title: "Fix the parser", state: "idea" });
    // --json carries both: the task as it was written, and what a take answers.
    const asJson = harness({ fetch: fakeConsole(table).fetch, env: SIGNED_IN });
    expect(await runCli(["task", "new", "Fix the parser", "--take", "--json"], asJson.io)).toBe(
      EXIT.ok,
    );
    expect(JSON.parse(asJson.out())).toEqual({
      written: READY,
      run: RUN,
      task: TASK,
      comments: [],
      rules: { ...RULES, mark },
    });
    // A task that cannot be taken is not written to be: refused before anything is sent.
    for (const state of ["done", "dropped"]) {
      const closed = fakeConsole(table);
      const refused = harness({ fetch: closed.fetch, env: SIGNED_IN });
      expect(
        await runCli(["task", "new", "Fix the parser", "--state", state, "--take"], refused.io),
        state,
      ).toBe(EXIT.usage);
      expect(refused.err()).toContain(`A task written as ${state} is not taken`);
      expect(closed.calls).toHaveLength(0);
    }
    // The mark and the agent's name are a take's: without --take they are not understood.
    for (const args of [
      ["--rules", mark],
      ["--agent", "Codex"],
    ]) {
      const alone = fakeConsole(table);
      const lone = harness({ fetch: alone.fetch, env: SIGNED_IN });
      expect(await runCli(["task", "new", "Fix the parser", ...args], lone.io)).toBe(EXIT.usage);
      expect(lone.err()).toContain("--rules and --agent go with --take");
      expect(alone.calls).toHaveLength(0);
    }
    // The take refused after the task was written: said with the number, so that the task is
    // taken by it and not written a second time.
    const failing = fakeConsole({
      ...table,
      [`POST ${IN}/runs`]: {
        status: 500,
        body: { error: { code: "internal", message: "Something failed." } },
      },
    });
    const half = harness({ fetch: failing.fetch, env: SIGNED_IN });
    expect(await runCli(["task", "new", "Fix the parser", "--take"], half.io)).toBe(EXIT.failed);
    expect(half.out()).toBe(`Task #7 written: Fix the parser\ntask id: ${TASK.id}\n`);
    expect(half.err()).toBe(
      "Task #7 is written and was not taken: it stands on the board as written. Take it with console take 7, and do not write it again. What the take ended on:\ninternal: Something failed.\n",
    );
    expect(failing.calls.filter((call) => call.key === `POST ${IN}/tasks`)).toHaveLength(1);
    const halfJson = harness({ fetch: failing.fetch, env: SIGNED_IN });
    expect(await runCli(["task", "new", "Fix the parser", "--take", "--json"], halfJson.io)).toBe(
      EXIT.failed,
    );
    expect(JSON.parse(halfJson.out())).toEqual({ written: READY });
    expect(halfJson.err()).toContain("Task #7 is written and was not taken");
    // The run begun and the reading of what a take prints refused: the task is taken, and is
    // not to be taken again, which would end the run that has just begun.
    const unread = fakeConsole({
      ...table,
      [`GET ${IN}/rules`]: {
        status: 500,
        body: { error: { code: "internal", message: "Something failed." } },
      },
    });
    const begun = harness({ fetch: unread.fetch, env: SIGNED_IN });
    expect(await runCli(["task", "new", "Fix the parser", "--take"], begun.io)).toBe(EXIT.failed);
    expect(begun.out()).toBe(`Task #7 written: Fix the parser\ntask id: ${TASK.id}\n`);
    expect(begun.err()).toBe(
      `Task #7 is written and taken, run ${RUN.id}, and what a take prints of it was not read. Do not write it or take it again: console task 7 shows the task, console rules the rules. What the reading ended on:\ninternal: Something failed.\n`,
    );
    const begunJson = harness({ fetch: unread.fetch, env: SIGNED_IN });
    expect(await runCli(["task", "new", "Fix the parser", "--take", "--json"], begunJson.io)).toBe(
      EXIT.failed,
    );
    expect(JSON.parse(begunJson.out())).toEqual({ written: READY, run: RUN });
    // Without --take, a task is written as before, and nothing is taken.
    const plain = fakeConsole(table);
    const written = harness({ fetch: plain.fetch, env: SIGNED_IN });
    expect(await runCli(["task", "new", "Fix the parser"], written.io)).toBe(EXIT.ok);
    // With the address of its page, for the person told of it.
    expect(written.out()).toBe(
      `Task #7 written: Fix the parser\ntask id: ${TASK.id}\npage: https://console.test/projects/web/tasks/7\n`,
    );
    expect(plain.calls.map((call) => call.key)).toEqual([`POST ${IN}/tasks`]);
    expect(plain.calls[0]?.body).toEqual({ title: "Fix the parser" });
  });

  it("reads the rules as they are for the person: {language} filled with the language they read in", async () => {
    const ruled = {
      ...RULES,
      // The whole and the console's own say it alike: both are read in the person's language.
      workspace: {
        ...RULES.workspace,
        body: "# Rules. Write what people read in {language}.",
        own: "# Rules. Write what people read in {language}.",
      },
    };
    const { fetch } = fakeConsole({
      [`GET ${IN}/rules`]: { body: ruled },
      "GET /api/v1/me": { body: { ...ME, language: "ko" } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("Write what people read in Korean.");
    expect(h.out()).not.toContain("{language}");
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "--json"], asJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out()).workspace.body).toContain("in Korean.");
    // No language yet: the task's, as the people of the board wrote it.
    const unchosen = harness({
      fetch: fakeConsole({ [`GET ${IN}/rules`]: { body: ruled }, "GET /api/v1/me": { body: ME } })
        .fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["rules"], unchosen.io)).toBe(EXIT.ok);
    expect(unchosen.out()).toContain("in the language the task is written in.");
  });

  it("reads the rules that hold, writes what a project or the organization adds, and puts it away", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/rules": { body: RULES.workspace },
      "GET /api/v1/me": { body: ME },
      [`PUT ${IN}/docs/rules`]: { body: { ...RULES_DOC, version: 3 } },
      "PUT /api/v1/rules": {
        body: {
          source: "written",
          body: `${RULES.workspace.body}\n\n# What this organization adds\n\n# Ours`,
          page: { ...RULES_PAGE, version: 1 },
          own: RULES.workspace.own,
          added: { body: "# Ours", page: { ...RULES_PAGE, version: 1 } },
        },
      },
      "POST /api/v1/rules/archive": { body: RULES.workspace },
      [`POST ${IN}/docs/rules/archive`]: { body: { ...RULES_DOC, archivedAt: WHEN } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("The console's rules, which always hold:");
    expect(h.out()).toContain("Read these.");
    expect(h.out()).toContain("What this project adds (v2, by alice; ");
    expect(h.out()).toContain("Ask before pushing.");
    // The first line says which parts follow, and carries the mark a later take names.
    expect(h.out()).toMatch(
      /^Rules [0-9a-f]{8}: this project's additions first \(\d+ characters\), then the console's \(\d+ characters\), the earlier holding where they differ; the organization adds nothing\. A later take in this session leaves them out: console take <number> --rules [0-9a-f]{8}\n/,
    );
    const ruled = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "--json"], ruled.io)).toBe(EXIT.ok);
    expect(JSON.parse(ruled.out())).toMatchObject({
      ...RULES,
      mark: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    // Without a project named, the console's and what the organization adds, alone.
    const alone = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["rules"], alone.io)).toBe(EXIT.ok);
    expect(alone.out()).toContain("Read these.");
    expect(alone.out()).not.toContain("this project");
    const written = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write", "--body", "# Ours"], written.io)).toBe(EXIT.ok);
    expect(written.out()).toBe("Wrote what this project adds to the rules, version 3.\n");
    expect(calls.at(-1)?.body).toEqual({ title: "Rules", body: "# Ours" });
    const workspace = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["rules", "write", "--workspace", "--body", "# Ours", "--base", "2"],
        workspace.io,
      ),
    ).toBe(EXIT.ok);
    expect(workspace.out()).toBe("Wrote what this organization adds to the rules, version 1.\n");
    expect(calls.at(-1)?.body).toEqual({ body: "# Ours", baseVersion: 2 });
    const away = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write", "none", "--workspace"], away.io)).toBe(EXIT.ok);
    expect(away.out()).toBe(
      "What this organization adds to the rules is put away: the console's stand alone.\n",
    );
    const projectAway = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write", "none"], projectAway.io)).toBe(EXIT.ok);
    expect(projectAway.out()).toBe(
      "What this project adds to the rules is put away: it adds nothing now.\n",
    );
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write"], nothing.io)).toBe(EXIT.usage);
    expect(nothing.err()).toContain("none to put what was added away");
    const odd = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write", "--body", "x", "--base", "zero"], odd.io)).toBe(
      EXIT.usage,
    );
  });

  it("reports on the one open run, and asks which when there are several or none", async () => {
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/runs/${RUN.id}/reports`]: {
        status: 201,
        body: { ...RUN, reports: [{ id: RUN.id, body: "# Found it", createdAt: WHEN }] },
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["report", "# Found it"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toBe(`Reported on run ${RUN.id}: 1 report so far.\n`);
    expect(calls[1]?.body).toEqual({ body: "# Found it" });

    const several = fakeConsole({
      [OPEN_RUNS]: {
        body: { more: false, items: [RUN, { ...RUN, id: "0199c4d8-0000-7000-8000-000000000021" }] },
      },
    });
    const s = harness({ fetch: several.fetch, env: SIGNED_IN });
    expect(await runCli(["report", "which?"], s.io)).toBe(EXIT.failed);
    expect(s.err()).toContain("--run <id>");
    const none = fakeConsole({ [OPEN_RUNS]: { body: { more: false, items: [] } } });
    const n = harness({ fetch: none.fetch, env: SIGNED_IN });
    expect(await runCli(["report", "to nobody"], n.io)).toBe(EXIT.failed);
    expect(n.err()).toContain("console take <number>");
    const named = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["report", "named", "--run", RUN.id], named.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`POST ${IN}/runs/${RUN.id}/reports`);
  });

  it("names the person's open runs begun through another of their agents, before any word of taking", async () => {
    const OTHERS = `GET ${IN}/runs?open=true&limit=500&brief=true`;
    const waiting = {
      ...RUN,
      id: "0199c4d8-0000-7000-8000-000000000023",
      agent: "Codex on the desk",
      status: "waiting",
      waitingFor: DECISION.id,
    };
    const second = { ...waiting, id: "0199c4d8-0000-7000-8000-000000000025", waitingFor: null };
    const bobs = {
      ...RUN,
      id: "0199c4d8-0000-7000-8000-000000000024",
      person: { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" },
      agent: "Bob's agent",
    };
    const one = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [] } },
      "GET /api/v1/me": { body: ME },
      [OTHERS]: { body: { more: false, items: [waiting, bobs] } },
    });
    // Every command on a run says the same: the run is there, and --run goes on with it.
    for (const args of [
      ["report", "x"],
      ["hand-in", "https://example.test/x"],
      ["ask", "Which?", "--option", "a", "--option", "b"],
      ["finish"],
      ["fail"],
    ]) {
      const h = harness({ fetch: one.fetch, env: SIGNED_IN });
      expect(await runCli(args, h.io), args.join(" ")).toBe(EXIT.failed);
      expect(h.out()).toBe("");
      const err = h.err();
      expect(
        err.startsWith(
          `run.none: no run begun through this agent is open in this project; 1 of yours begun through another agent, or before a new sign-in, is open:\n  ${waiting.id}  waiting  Codex on the desk for alice  task #${TASK.number}  (0 reports, 0 artifacts, waiting for decision ${DECISION.id}, last heard `,
        ),
        args.join(" "),
      ).toBe(true);
      expect(
        err.endsWith(
          ")\nGo on with it: add --run <id> to the command. A run is its person's, whichever of their agents began it; taking its task again would end it and begin another.\n",
        ),
        args.join(" "),
      ).toBe(true);
      // Another person's run is not theirs to go on with, and taking is not what to do first.
      expect(err).not.toContain(bobs.id);
      expect(err).not.toContain("console take");
    }
    // Several: each is named, and one of them is chosen.
    const two = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [] } },
      "GET /api/v1/me": { body: ME },
      [OTHERS]: { body: { more: false, items: [waiting, second] } },
    });
    const several = harness({ fetch: two.fetch, env: SIGNED_IN });
    expect(await runCli(["report", "x"], several.io)).toBe(EXIT.failed);
    expect(several.err()).toContain(
      "2 of yours begun through another agent, or before a new sign-in, are open:",
    );
    expect(several.err()).toContain(`  ${waiting.id}  waiting`);
    expect(several.err()).toContain(`  ${second.id}  waiting`);
    expect(several.err()).toContain("Go on with one of them: add --run <id> to the command.");
    // None of the person's is open: the words of before, which do say to take a task.
    const nobodys = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [] } },
      "GET /api/v1/me": { body: ME },
      [OTHERS]: { body: { more: false, items: [bobs] } },
    });
    const none = harness({ fetch: nobodys.fetch, env: SIGNED_IN });
    expect(await runCli(["report", "x"], none.io)).toBe(EXIT.failed);
    expect(none.err()).toBe(
      "run.none: no run of yours is open in this project. Take a task first: console take <number>; or name a run: --run <id>\n",
    );
    // A console that does not answer the looking is no other refusal: the words of before.
    const mute = fakeConsole({ [OPEN_RUNS]: { body: { more: false, items: [] } } });
    const m = harness({ fetch: mute.fetch, env: SIGNED_IN });
    expect(await runCli(["report", "x"], m.io)).toBe(EXIT.failed);
    expect(m.err()).toContain("run.none: no run of yours is open in this project.");
  });

  it("says whose the runs of --mine are: this agent's, with how the person's others are listed", async () => {
    const MINE = `GET ${IN}/runs?mine=true&limit=50&offset=0&brief=true`;
    const OTHERS =
      " A run of yours begun through another agent, or before a new sign-in, is listed without --mine, where each line says whom it is for and through which agent.\n";
    const empty = fakeConsole({
      [MINE]: { body: { more: false, items: [] } },
      [`GET ${IN}/runs?mine=true&limit=50&offset=0`]: { body: { more: false, items: [] } },
      "GET /api/v1/me": { body: ME },
    });
    const none = harness({ fetch: empty.fetch, env: SIGNED_IN });
    expect(await runCli(["runs", "--mine"], none.io)).toBe(EXIT.ok);
    expect(none.out()).toBe(`No runs begun through this agent (Claude Code on laptop).${OTHERS}`);
    const some = fakeConsole({
      [MINE]: { body: { more: false, items: [RUN] } },
      "GET /api/v1/me": { body: ME },
    });
    const listed = harness({ fetch: some.fetch, env: SIGNED_IN });
    expect(await runCli(["runs", "--mine"], listed.io)).toBe(EXIT.ok);
    expect(listed.out().startsWith(`${RUN.id}  running  Claude Code for alice`)).toBe(true);
    expect(
      listed
        .out()
        .endsWith(
          `\nThese are the runs begun through this agent (Claude Code on laptop).${OTHERS}`,
        ),
    ).toBe(true);
    // Signed in as the account itself there is one sign-in and no token: the runs are the
    // account's, and nothing more is to be said. Nor in --json, nor without --mine.
    const itself = fakeConsole({
      [MINE]: { body: { more: false, items: [] } },
      "GET /api/v1/me": { body: { ...ME, agent: null } },
      [`GET ${IN}/runs?limit=50&offset=0&brief=true`]: { body: { more: false, items: [] } },
    });
    const account = harness({ fetch: itself.fetch, env: SIGNED_IN });
    expect(await runCli(["runs", "--mine"], account.io)).toBe(EXIT.ok);
    expect(account.out()).toBe("No runs.\n");
    const all = harness({ fetch: itself.fetch, env: SIGNED_IN });
    expect(await runCli(["runs"], all.io)).toBe(EXIT.ok);
    expect(all.out()).toBe("No runs.\n");
    const json = harness({ fetch: empty.fetch, env: SIGNED_IN });
    expect(await runCli(["runs", "--mine", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toEqual({ more: false, items: [] });
  });

  it("hands in a link as it is, and a file as its bytes, and says where the file is read", async () => {
    const handedIn = {
      ...RUN,
      artifacts: [
        {
          id: "0199c4d8-0000-7000-8000-000000000022",
          kind: "file",
          url: null,
          label: "the report",
          file: {
            name: "notes.md",
            size: 10,
            contentType: "text/markdown",
            sha256: "ab".repeat(32),
          },
          createdAt: WHEN,
        },
      ],
    };
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/runs/${RUN.id}/artifacts`]: { status: 201, body: RUN },
      [`POST ${IN}/runs/${RUN.id}/files`]: { status: 201, body: handedIn },
      [`GET ${IN}/runs/${RUN.id}`]: { body: handedIn },
    });
    const bytes = new TextEncoder().encode("# Notes\n\n");
    const io = () =>
      harness({
        fetch,
        env: SIGNED_IN,
        readBytes: async (path) => {
          if (path !== "out/notes.md") {
            throw new Error("no such file");
          }
          return bytes;
        },
      });
    const link = io();
    expect(await runCli(["hand-in", "https://github.com/acme/app/pull/3"], link.io)).toBe(EXIT.ok);
    expect(calls[1]?.body).toEqual({ url: "https://github.com/acme/app/pull/3" });
    const file = io();
    expect(await runCli(["hand-in", "out/notes.md", "--label", "the report"], file.io)).toBe(
      EXIT.ok,
    );
    expect(file.out()).toBe(
      `Handed in the file notes.md (${bytes.byteLength} bytes) on run ${RUN.id}: 1 artifact so far.\n`,
    );
    const form = calls[3]?.init?.body;
    expect(form).toBeInstanceOf(FormData);
    const part = (form as FormData).get("file");
    expect(part).toBeInstanceOf(File);
    expect((part as File).name).toBe("notes.md");
    expect((part as File).type).toBe("text/markdown");
    expect((form as FormData).get("label")).toBe("the report");
    const missing = io();
    expect(await runCli(["hand-in", "out/missing.bin"], missing.io)).toBe(EXIT.failed);
    expect(missing.err()).toContain("No file could be read at out/missing.bin");
    const shown = io();
    expect(await runCli(["run", RUN.id], shown.io)).toBe(EXIT.ok);
    expect(shown.out()).toContain(
      `the report: notes.md (10 bytes, text/markdown; read at ${ORIGIN}${IN}/files/0199c4d8-0000-7000-8000-000000000022; console file 0199c4d8-0000-7000-8000-000000000022)`,
    );
  });

  it("says something in the discussion on a task, with files put in as the parts of one form", async () => {
    const written = { ...COMMENT, author: PERSON, agent: null, body: "Done; see the two shots." };
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`POST ${IN}/tasks/${TASK.id}/comments`]: { status: 201, body: written },
    });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const io = () =>
      harness({
        fetch,
        env: SIGNED_IN,
        readBytes: async (path) => {
          if (!path.startsWith("shots/")) {
            throw new Error("no such file");
          }
          return bytes;
        },
        readFile: async () => "From the file.\n",
      });
    const plain = io();
    expect(await runCli(["comment", "7", "The parser is fine."], plain.io)).toBe(EXIT.ok);
    // Without files, the comment goes as JSON.
    expect(calls[1]?.key).toBe(`POST ${IN}/tasks/${TASK.id}/comments`);
    expect(calls[1]?.body).toEqual({ body: "The parser is fine." });
    expect(plain.out()).toContain(
      `Commented on #7 Fix the parser, with 1 file.\n  alice, ${WHEN}, comment ${COMMENT.id}:`,
    );
    const pictured = io();
    expect(
      await runCli(
        [
          "comment",
          "7",
          "Done; see the two shots.",
          "--attach",
          "shots/a.png",
          "--attach",
          "shots/b.webp",
        ],
        pictured.io,
      ),
    ).toBe(EXIT.ok);
    const form = calls[3]?.init?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("body")).toBe("Done; see the two shots.");
    const parts = (form as FormData).getAll("file");
    expect(parts.map((part) => (part as File).name)).toEqual(["a.png", "b.webp"]);
    expect(parts.map((part) => (part as File).type)).toEqual(["image/png", "image/webp"]);
    const fromFile = io();
    expect(await runCli(["comment", "7", "--file", "notes.md"], fromFile.io)).toBe(EXIT.ok);
    expect(calls[5]?.body).toEqual({ body: "From the file.\n" });
    const nothing = io();
    expect(await runCli(["comment", "7"], nothing.io)).toBe(EXIT.usage);
    expect(nothing.err()).toContain("Say something, or attach a file.");
    const missing = io();
    expect(await runCli(["comment", "7", "--attach", "elsewhere/x.png"], missing.io)).toBe(
      EXIT.failed,
    );
    expect(missing.err()).toContain("No file could be read at elsewhere/x.png");
  });

  it("reads a file of the project by its id and writes it on this machine, where it says", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    const fileId = COMMENT.files[0]?.id ?? "";
    const fetch: CliIo["fetch"] = async (url) => {
      if (url !== `${ORIGIN}${IN}/files/${fileId}`) {
        return new Response(JSON.stringify({ error: { code: "file.not_found", message: "no" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-disposition": `inline; filename="screen.png"; filename*=UTF-8''screen.png`,
        },
      });
    };
    const written: { path: string; name: string; size: number }[] = [];
    const io = () =>
      harness({
        fetch,
        env: SIGNED_IN,
        writeBytes: async (path, data, name) => {
          written.push({ path, name, size: data.byteLength });
          return `/work/app/${path === "." ? name : path}`;
        },
      });
    const here = io();
    expect(await runCli(["file", fileId], here.io)).toBe(EXIT.ok);
    expect(written).toEqual([{ path: "screen.png", name: "screen.png", size: 6 }]);
    expect(here.out()).toBe("Saved screen.png (6 bytes, image/png) at /work/app/screen.png\n");
    const there = io();
    expect(await runCli(["file", fileId, "--out", "shots/seen.png"], there.io)).toBe(EXIT.ok);
    expect(written[1]).toEqual({ path: "shots/seen.png", name: "screen.png", size: 6 });
    const nowhere = io();
    expect(await runCli(["file", "0199c4d8-0000-7000-8000-000000000099"], nowhere.io)).toBe(
      EXIT.failed,
    );
    expect(nowhere.err()).toContain("file.not_found");
  });

  it("reads a body from a file or from standard input", async () => {
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/runs/${RUN.id}/reports`]: { status: 201, body: RUN },
    });
    const file = harness({ fetch, env: SIGNED_IN, readFile: async (path) => `from ${path}` });
    expect(await runCli(["report", "--file", "notes.md"], file.io)).toBe(EXIT.ok);
    expect(calls[1]?.body).toEqual({ body: "from notes.md" });
    const piped = harness({ fetch, env: SIGNED_IN, readStdin: async () => "from stdin\n" });
    expect(await runCli(["report", "-"], piped.io)).toBe(EXIT.ok);
    expect(calls[3]?.body).toEqual({ body: "from stdin\n" });
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["report"], nothing.io)).toBe(EXIT.usage);
  });

  it("does not wait at the terminal as an agent account, which the answer wakes, unless it is asked to", async () => {
    // The decision as the console answers it to an account that raised it: raised by the account.
    const mira = { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" };
    const raised = { ...DECISION, raisedBy: mira };
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: raised },
      [`GET ${IN}/decisions/${DECISION.id}?wait=50`]: { body: raised },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["ask", "Which?", "--option", "a", "--option", "b"], h.io)).toBe(
      EXIT.waiting,
    );
    // Raised, and nothing asked of the console after: nobody waits sixty seconds where nobody sits.
    expect(calls.map((call) => call.key)).toEqual([OPEN_RUNS, `POST ${IN}/decisions`]);
    expect(h.out()).toContain(`Decision ${DECISION.id} raised on run ${RUN.id}`);
    expect(h.out()).toContain(`decision id: ${DECISION.id}`);
    expect(h.out()).toContain(
      `The answer wakes you: go on with other work meanwhile, and with this run when it comes (--run ${RUN.id}). The run stays open while the decision waits.`,
    );
    expect(h.out()).not.toContain("Keep waiting with");
    expect(h.out()).not.toContain("--wait 100");
    // With --json the decision alone, as raised.
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--json"], asJson.io),
    ).toBe(EXIT.waiting);
    expect(JSON.parse(asJson.out()).id).toBe(DECISION.id);
    // Asked to wait, it waits as anyone does, and says how to wait on.
    const waited = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: raised },
      [`GET ${IN}/decisions/${DECISION.id}?wait=50`]: [
        { body: raised },
        { body: { ...ANSWERED, raisedBy: mira } },
      ],
    });
    const patient = harness({ fetch: waited.fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["ask", "Which?", "--option", "a", "--option", "b", "--wait", "100"],
        patient.io,
      ),
    ).toBe(EXIT.ok);
    expect(patient.out()).toContain("Answered: 2) Change it, by bob");
    expect(waited.calls.some((call) => call.key.includes("?wait="))).toBe(true);
    // A person's agent waits as before: somebody attends it.
    const person = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: DECISION },
      [`GET ${IN}/decisions/${DECISION.id}?wait=50`]: [{ body: DECISION }, { body: ANSWERED }],
    });
    const attended = harness({ fetch: person.fetch, env: SIGNED_IN });
    expect(await runCli(["ask", "Which?", "--option", "a", "--option", "b"], attended.io)).toBe(
      EXIT.ok,
    );
    expect(person.calls.some((call) => call.key.includes("?wait="))).toBe(true);
  });

  it("says the account's words, not an attended agent's, when an agent account's wait runs out", async () => {
    const mira = { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" };
    const raised = { ...DECISION, raisedBy: mira };
    const table = {
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: raised },
      // However many seconds of the wait are left when the console is asked, it has no answer.
      ...Object.fromEntries(
        [1, 2, 3, 4, 5].map((seconds) => [
          `GET ${IN}/decisions/${DECISION.id}?wait=${seconds}`,
          { body: raised },
        ]),
      ),
    };
    const words = `The answer wakes you: go on with other work meanwhile, and with this run when it comes (--run ${RUN.id}). The run stays open while the decision waits.`;
    // A wait of five seconds, on a clock that passes them: the console is asked once and has no answer.
    let clock = 0;
    const waited = fakeConsole(table);
    const h = harness({
      fetch: waited.fetch,
      env: SIGNED_IN,
      now: () => {
        clock += 1000;
        return clock;
      },
    });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--wait", "5"], h.io),
    ).toBe(EXIT.waiting);
    expect(waited.calls.some((call) => call.key.includes("?wait="))).toBe(true);
    expect(h.out()).toContain(words);
    expect(h.out()).not.toContain("Keep waiting with");
    expect(h.out()).not.toContain("--wait 100");
    // Asked not to wait at all, it says the same.
    const none = harness({ fetch: fakeConsole(table).fetch, env: SIGNED_IN });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--wait", "0"], none.io),
    ).toBe(EXIT.waiting);
    expect(none.out()).toContain(words);
    expect(none.out()).not.toContain("Keep waiting with");
    // A person's agent whose wait runs out is told how to wait on, as before.
    const person = harness({
      fetch: fakeConsole({ ...table, [`POST ${IN}/decisions`]: { status: 201, body: DECISION } })
        .fetch,
      env: SIGNED_IN,
    });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--wait", "0"], person.io),
    ).toBe(EXIT.waiting);
    expect(person.out()).toContain(`console decision ${DECISION.id} --wait 100`);
    expect(person.out()).not.toContain("The answer wakes you");
  });

  it("ends a wait on a decision in the account's words where the command is signed in as the account that raised it", async () => {
    const mira = { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" };
    const raised = { ...DECISION, raisedBy: mira };
    const waits = {
      [`GET ${IN}/decisions/${DECISION.id}`]: { body: raised },
      [`GET ${IN}/decisions/${DECISION.id}?wait=5`]: { body: raised },
    };
    const passing = () => {
      let clock = 0;
      return () => {
        clock += 5000;
        return clock;
      };
    };
    // The login kept says what the command is: the account itself (`login --self`).
    const itself: Credentials = {
      default: ORIGIN,
      logins: [
        {
          url: ORIGIN,
          account: "acme-mira",
          token: "cns_a_session",
          agent: undefined,
          since: undefined,
          self: true,
        },
      ],
    };
    const account = harness({
      fetch: fakeConsole(waits).fetch,
      store: memoryStore(itself).store,
      env: { CONSOLE_PROJECT: "web" },
      now: passing(),
    });
    expect(await runCli(["decision", DECISION.id, "--wait", "5"], account.io)).toBe(EXIT.waiting);
    expect(account.out()).toBe(
      `Decision ${DECISION.id} still waits for a person. The answer wakes you: go on with other work meanwhile, and with its run when it comes (--run ${RUN.id}). The run stays open while the decision waits.\n`,
    );
    // A person's agent that waits for the same decision is told how to wait on: the decision
    // says an account raised it, and not who asks.
    const agent = harness({
      fetch: fakeConsole(waits).fetch,
      store: memoryStore(one(ORIGIN, "cns_t_secret")).store,
      env: { CONSOLE_PROJECT: "web" },
      now: passing(),
    });
    expect(await runCli(["decision", DECISION.id, "--wait", "5"], agent.io)).toBe(EXIT.waiting);
    expect(agent.out()).toContain(`Keep waiting with: console decision ${DECISION.id} --wait 100`);
    expect(agent.out()).not.toContain("The answer wakes you");
    // An account that waits for a decision another raised is not woken by its answer, and is
    // not told it will be.
    const other = harness({
      fetch: fakeConsole({
        [`GET ${IN}/decisions/${DECISION.id}`]: { body: DECISION },
        [`GET ${IN}/decisions/${DECISION.id}?wait=5`]: { body: DECISION },
      }).fetch,
      store: memoryStore(itself).store,
      env: { CONSOLE_PROJECT: "web" },
      now: passing(),
    });
    expect(await runCli(["decision", DECISION.id, "--wait", "5"], other.io)).toBe(EXIT.waiting);
    expect(other.out()).toContain("Keep waiting with");
  });

  it("asks, waits for the answer, and says when the decision still waits", async () => {
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: DECISION },
      [`GET ${IN}/decisions/${DECISION.id}?wait=50`]: [{ body: DECISION }, { body: ANSWERED }],
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["ask", "Keep the old behaviour?", "--option", "Keep it", "--option", "Change it"],
        h.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls[1]?.body).toEqual({
      question: "Keep the old behaviour?",
      options: [{ label: "Keep it" }, { label: "Change it" }],
      runId: RUN.id,
    });
    expect(h.out()).toContain(`Decision ${DECISION.id} raised on run ${RUN.id}`);
    expect(h.out()).toContain("  2) Change it");
    expect(h.out()).toContain("Answered: 2) Change it, by bob");
    expect(h.out()).toContain("Note: Carefully.");

    const unanswered = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: DECISION },
    });
    const u = harness({ fetch: unanswered.fetch, env: SIGNED_IN });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--wait", "0"], u.io),
    ).toBe(EXIT.waiting);
    expect(u.out()).toContain(`console decision ${DECISION.id} --wait 100`);
    expect(unanswered.calls.map((call) => call.key)).toEqual([OPEN_RUNS, `POST ${IN}/decisions`]);

    // On --json the decision is printed as soon as it is raised, so a wait cut short loses no id.
    const asJson = harness({ fetch: unanswered.fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["ask", "Which?", "--option", "a", "--option", "b", "--wait", "0", "--json"],
        asJson.io,
      ),
    ).toBe(EXIT.waiting);
    expect(JSON.parse(asJson.out()).id).toBe(DECISION.id);

    const few = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["ask", "Alone?", "--option", "a"], few.io)).toBe(EXIT.usage);

    // Addressed to another person of the project (ADR-0042): the login is looked up, the id sent.
    const BOB = {
      ...PERSON,
      id: "0199c4d8-0000-7000-8000-000000000002",
      login: "bob",
      name: "Bob",
    };
    const addressed = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      [`POST ${IN}/decisions`]: { status: 201, body: { ...DECISION, decider: BOB } },
      [`GET ${IN}/decisions/${DECISION.id}?wait=50`]: { body: { ...ANSWERED, decider: BOB } },
    });
    const a = harness({ fetch: addressed.fetch, env: SIGNED_IN });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--to", "bob"], a.io),
    ).toBe(EXIT.ok);
    expect(addressed.calls.find((call) => call.key === `POST ${IN}/decisions`)?.body).toEqual({
      question: "Which?",
      options: [{ label: "a" }, { label: "b" }],
      runId: RUN.id,
      deciderId: BOB.id,
    });
    expect(a.out()).toContain(`the run waits for ${BOB.login}.`);
    // Several people (ADR-0057): --to given again, the ids sent together, the first of them as before.
    const CAROL = {
      ...BOB,
      id: "0199c4d8-0000-7000-8000-000000000003",
      login: "carol",
      name: "Carol",
    };
    const several = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=carol": {
        body: { items: [CAROL], listed: [], organization: null },
      },
      [`POST ${IN}/decisions`]: {
        status: 201,
        body: { ...DECISION, decider: BOB, deciders: [BOB, CAROL] },
      },
      [`GET ${IN}/decisions/${DECISION.id}?wait=50`]: {
        body: { ...ANSWERED, decider: BOB, deciders: [BOB, CAROL] },
      },
    });
    const both = harness({ fetch: several.fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "ask",
          "Which?",
          "--option",
          "a",
          "--option",
          "b",
          "--to",
          "bob",
          "--to",
          "carol",
          "--to",
          "bob",
        ],
        both.io,
      ),
    ).toBe(EXIT.ok);
    expect(several.calls.find((call) => call.key === `POST ${IN}/decisions`)?.body).toEqual({
      question: "Which?",
      options: [{ label: "a" }, { label: "b" }],
      runId: RUN.id,
      deciderId: BOB.id,
      deciderIds: [BOB.id, CAROL.id],
    });
    expect(both.out()).toContain("the run waits for bob, carol.");
    const nobody = harness({ fetch: addressed.fetch, env: SIGNED_IN });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--to", "none"], nobody.io),
    ).toBe(EXIT.usage);
  });

  it("puts files on a decision with --attach, the decision and its files as one form (ADR-0055)", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const file = {
      id: "0199c4d8-0000-7000-8000-000000000031",
      file: { name: "a.png", size: 4, contentType: "image/png", sha256: "x" },
    };
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/decisions`]: { status: 201, body: { ...DECISION, files: [file] } },
      [`GET ${IN}/decisions/${DECISION.id}`]: { body: { ...DECISION, files: [file] } },
    });
    const io = () =>
      harness({
        fetch,
        env: SIGNED_IN,
        readBytes: async (path) => {
          if (!path.startsWith("shots/")) {
            throw new Error("no such file");
          }
          return bytes;
        },
      });
    const h = io();
    expect(
      await runCli(
        [
          "ask",
          "Which look?",
          "--option",
          "a",
          "--option",
          "b",
          "--attach",
          "shots/a.png",
          "--wait",
          "0",
        ],
        h.io,
      ),
    ).toBe(EXIT.waiting);
    const form = calls[1]?.init?.body;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse((form as FormData).get("decision") as string)).toEqual({
      question: "Which look?",
      options: [{ label: "a" }, { label: "b" }],
      runId: RUN.id,
    });
    const parts = (form as FormData).getAll("file");
    expect(parts.map((part) => (part as File).name)).toEqual(["a.png"]);
    expect(parts.map((part) => (part as File).type)).toEqual(["image/png"]);
    expect(h.out()).toContain(`Decision ${DECISION.id} raised on run ${RUN.id}, with 1 file;`);
    // The decision read back names each file with the command that reads it.
    const read = io();
    expect(await runCli(["decision", DECISION.id], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain(`file: a.png (4 bytes, image/png): console file ${file.id}`);
    const missing = io();
    expect(
      await runCli(
        ["ask", "Which?", "--option", "a", "--option", "b", "--attach", "elsewhere/x.png"],
        missing.io,
      ),
    ).toBe(EXIT.failed);
    expect(missing.err()).toContain("No file could be read at elsewhere/x.png");
  });

  it("lists one's own decisions across the projects with --mine, the waiting first (ADR-0042)", async () => {
    const web = { key: "web", name: "The web app", color: null, symbol: null, icon: null };
    const BOB = {
      ...PERSON,
      id: "0199c4d8-0000-7000-8000-000000000002",
      login: "bob",
      name: "Bob",
    };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/decisions?limit=50&offset=0": {
        body: { items: [{ project: web, decision: { ...DECISION, decider: BOB } }], more: false },
      },
      "GET /api/v1/decisions?open=true&limit=50&offset=0": { body: { items: [], more: false } },
      "GET /api/v1/decisions?raised=true&limit=50&offset=0": { body: { items: [], more: false } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decisions", "--mine"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(`web  ${DECISION.id}  waiting  ${DECISION.question}`);
    // Whom it is for, and when it was asked: since when it waits.
    expect(h.out()).toContain(`for ${BOB.login}, at ${WHEN})`);
    const open = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decisions", "--mine", "--open"], open.io)).toBe(EXIT.ok);
    expect(open.out()).toContain("No decisions of yours.");
    const raised = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decisions", "--raised"], raised.io)).toBe(EXIT.ok);
    expect(raised.out()).toContain("No decisions you asked of others.");
    expect(
      calls.some((call) => call.key === "GET /api/v1/decisions?raised=true&limit=50&offset=0"),
    ).toBe(true);
    // Needs no project: nothing of the project's was asked for.
    expect(calls.every((call) => !call.key.includes("/projects/"))).toBe(true);
  });

  it("writes a person's answer on a decision in their name, an option or their own words (ADR-0042)", async () => {
    const { fetch, calls } = fakeConsole({
      [`POST ${IN}/decisions/${DECISION.id}/answer`]: { status: 200, body: ANSWERED },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["answer", DECISION.id, "--option", "2", "--note", "Said in chat on the 26th."],
        h.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls[0]?.body).toEqual({ option: "2", note: "Said in chat on the 26th." });
    expect(h.out()).toContain("Answered: 2) Change it, by bob");
    const own = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["answer", DECISION.id, "--own", "Neither: wait a week"], own.io)).toBe(
      EXIT.ok,
    );
    expect(calls[1]?.body).toEqual({ own: "Neither: wait a week" });
    // One of the two, not both and not neither.
    const neither = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["answer", DECISION.id], neither.io)).toBe(EXIT.usage);
    const both = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["answer", DECISION.id, "--option", "1", "--own", "x"], both.io)).toBe(
      EXIT.usage,
    );
  });

  it("waits for a decision for as long as it is told, a request at a time", async () => {
    let clock = 0;
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/decisions/${DECISION.id}`]: { body: DECISION },
      [`GET ${IN}/decisions/${DECISION.id}?wait=50`]: { body: DECISION },
      [`GET ${IN}/decisions/${DECISION.id}?wait=40`]: { body: DECISION },
    });
    // Every look at the clock is forty seconds later than the last.
    const h = harness({ fetch, env: SIGNED_IN, now: () => (clock += 40_000) });
    expect(await runCli(["decision", DECISION.id, "--wait", "120"], h.io)).toBe(EXIT.waiting);
    expect(calls.map((call) => call.key)).toEqual([
      `GET ${IN}/decisions/${DECISION.id}`,
      `GET ${IN}/decisions/${DECISION.id}?wait=50`,
      `GET ${IN}/decisions/${DECISION.id}?wait=40`,
    ]);
    const shown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id], shown.io)).toBe(EXIT.ok);
    expect(shown.out()).toContain(`waits for ${PERSON.login}.`);
  });

  it("reaches a decision outside the project it works in, wherever it is (ADR-0068), and answers it there", async () => {
    const elsewhere = { key: "hr", name: "HR", color: null, symbol: null, icon: null };
    const reached = { project: elsewhere, decision: DECISION, mayAnswer: true };
    const answered = {
      ...DECISION,
      answer: { option: "1", note: null, by: PERSON, at: "2026-11-08T09:00:00.000Z", agent: null },
    };
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/decisions/${DECISION.id}`]: {
        status: 404,
        body: { error: { code: "decision.not_found", message: "The decision was not found." } },
      },
      [`GET /api/v1/decisions/${DECISION.id}`]: { body: reached },
      [`GET /api/v1/decisions/${DECISION.id}?wait=50`]: {
        body: { ...reached, decision: answered },
      },
      [`POST ${IN}/decisions/${DECISION.id}/answer`]: {
        status: 404,
        body: { error: { code: "decision.not_found", message: "The decision was not found." } },
      },
      [`POST /api/v1/decisions/${DECISION.id}/answer`]: { body: answered },
    });
    // Not in this project: the console is asked for the decision wherever it is.
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain(DECISION.question);
    expect(calls.map((call) => call.key)).toEqual([
      `GET ${IN}/decisions/${DECISION.id}`,
      `GET /api/v1/decisions/${DECISION.id}`,
    ]);
    // Waiting goes the same way, and an answer is written where the decision is.
    const waited = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id, "--wait", "60"], waited.io)).toBe(EXIT.ok);
    expect(waited.out()).toContain("Answered: 1)");
    const written = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["answer", DECISION.id, "--option", "1"], written.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`POST /api/v1/decisions/${DECISION.id}/answer`);
    // With no project bound at all, the decision is reached wherever it is, straight away.
    const unbound = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    const before = calls.length;
    expect(await runCli(["decision", DECISION.id], unbound.io)).toBe(EXIT.ok);
    expect(calls.slice(before).map((call) => call.key)).toEqual([
      `GET /api/v1/decisions/${DECISION.id}`,
    ]);
    // A console from before that route, or a decision that is nobody's: not found, as before.
    const older = fakeConsole({
      [`GET ${IN}/decisions/${DECISION.id}`]: {
        status: 404,
        body: { error: { code: "decision.not_found", message: "The decision was not found." } },
      },
    });
    const gone = harness({ fetch: older.fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id], gone.io)).toBe(EXIT.failed);
    expect(gone.err()).toContain("decision.not_found");
  });

  it("names the files of a decision reached outside the project by the decision, and reads them at its address (ADR-0068)", async () => {
    const elsewhere = { key: "hr", name: "HR", color: null, symbol: null, icon: null };
    const attached = {
      id: "0199c4d8-0000-7000-8000-000000000032",
      file: { name: "plan.pdf", size: 3, contentType: "application/pdf", sha256: "x" },
    };
    const decision = { ...DECISION, files: [attached] };
    const bytes = new Uint8Array([37, 80, 68]);
    const asked: string[] = [];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const fetch: CliIo["fetch"] = async (url) => {
      asked.push(url.replace(ORIGIN, ""));
      if (url === `${ORIGIN}${IN}/decisions/${DECISION.id}`) {
        return json(404, {
          error: { code: "decision.not_found", message: "The decision was not found." },
        });
      }
      if (url === `${ORIGIN}/api/v1/decisions/${DECISION.id}`) {
        return json(200, { project: elsewhere, decision, mayAnswer: true });
      }
      if (url === `${ORIGIN}/api/v1/decisions/${DECISION.id}/files/${attached.id}`) {
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="plan.pdf"`,
          },
        });
      }
      return json(404, { error: { code: "file.not_found", message: "The file was not found." } });
    };
    const written: { path: string; name: string; size: number }[] = [];
    const io = () =>
      harness({
        fetch,
        env: SIGNED_IN,
        writeBytes: async (path, data, name) => {
          written.push({ path, name, size: data.byteLength });
          return `/work/app/${path === "." ? name : path}`;
        },
      });
    // Reached at its own address, it names each file with the command that reads it there.
    const read = io();
    expect(await runCli(["decision", DECISION.id], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain(
      `file: plan.pdf (3 bytes, application/pdf): console file ${attached.id} --decision ${DECISION.id}`,
    );
    // Which reads it by the decision, and nothing of the project.
    const saved = io();
    asked.length = 0;
    expect(await runCli(["file", attached.id, "--decision", DECISION.id], saved.io)).toBe(EXIT.ok);
    expect(asked).toEqual([`/api/v1/decisions/${DECISION.id}/files/${attached.id}`]);
    expect(written).toEqual([{ path: "plan.pdf", name: "plan.pdf", size: 3 }]);
    expect(saved.out()).toBe("Saved plan.pdf (3 bytes, application/pdf) at /work/app/plan.pdf\n");
    // A file that is not the decision's is not found, as one out of reach is.
    const other = io();
    expect(
      await runCli(
        ["file", "0199c4d8-0000-7000-8000-000000000099", "--decision", DECISION.id],
        other.io,
      ),
    ).toBe(EXIT.failed);
    expect(other.err()).toContain("file.not_found");
  });

  it("ends a run as finished, failed or abandoned", async () => {
    const END = `POST ${IN}/runs/${RUN.id}/end`;
    const READ = `GET ${IN}/tasks/${TASK.id}`;
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [END]: { body: { ...RUN, status: "finished", summary: "Done." } },
      [READ]: { body: { ...TASK, state: "in_review" } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["finish", "--summary", "Done."], h.io)).toBe(EXIT.ok);
    // The task as read once the run is over, not what the command supposed of it.
    expect(h.out()).toBe(`Run ${RUN.id} finished; task #${TASK.number} is in_review now.\n`);
    expect(calls[1]?.body).toEqual({ status: "finished", summary: "Done." });
    expect(await runCli(["fail"], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.ok);
    expect(calls[4]?.body).toEqual({ status: "failed" });
    expect(await runCli(["abandon", RUN.id], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.ok);
    // The run named is not looked for; the task is read once the run is over, however it ended.
    expect(calls.map((call) => call.key)).toEqual([
      OPEN_RUNS,
      END,
      READ,
      OPEN_RUNS,
      END,
      READ,
      END,
      READ,
    ]);
    expect(calls[6]?.body).toEqual({ status: "abandoned" });
  });

  it("says where the end of a run left its task as the console answers it, once the run is over (ADR-0114)", async () => {
    const END = `POST ${IN}/runs/${RUN.id}/end`;
    const READ = `GET ${IN}/tasks/${TASK.id}`;
    /** A console that ends the run, and leaves its task in a state of its own choosing. */
    const leaving = (status: "failed" | "abandoned", state: string) =>
      fakeConsole({
        [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
        [END]: { body: { ...RUN, status, endedAt: WHEN } },
        [READ]: { body: { ...TASK, state } },
      });
    const said = async (args: string[], console_: ReturnType<typeof fakeConsole>) => {
      const h = harness({ fetch: console_.fetch, env: SIGNED_IN });
      expect(await runCli(args, h.io), h.err()).toBe(EXIT.ok);
      return h.out();
    };
    // A console leaves the task at work where a person moved it meanwhile or another run is
    // open on it: said as it is.
    expect(await said(["fail", "--summary", "No."], leaving("failed", "in_progress"))).toBe(
      `Run ${RUN.id} failed; task #7 is in_progress now.\n`,
    );
    expect(await said(["abandon"], leaving("abandoned", "in_progress"))).toBe(
      `Run ${RUN.id} abandoned; task #7 is in_progress now.\n`,
    );
    // A console of now sends the task of a failed run to review.
    const reviewed = leaving("failed", "in_review");
    expect(await said(["fail"], reviewed)).toBe(
      `Run ${RUN.id} failed; task #7 is in_review now.\n`,
    );
    // Read after the run is ended, not before: what the end made of the task is what is said.
    expect(reviewed.calls.map((call) => call.key)).toEqual([OPEN_RUNS, END, READ]);
    // And puts the task of a run given up back as the take found it: ready, or an idea.
    expect(await said(["abandon"], leaving("abandoned", "ready"))).toBe(
      `Run ${RUN.id} abandoned; task #7 is ready now.\n`,
    );
    expect(await said(["abandon", RUN.id], leaving("abandoned", "idea"))).toBe(
      `Run ${RUN.id} abandoned; task #7 is idea now.\n`,
    );
    // A person moved it meanwhile: where they put it.
    expect(await said(["fail"], leaving("failed", "done"))).toBe(
      `Run ${RUN.id} failed; task #7 is done now.\n`,
    );
    // --json stays the run as the console answered it, and asks nothing more.
    for (const [args, status] of [
      [["fail", "--json"], "failed"],
      [["abandon", "--json"], "abandoned"],
    ] as const) {
      const program = leaving(status, "in_review");
      expect(JSON.parse(await said([...args], program))).toEqual({
        ...RUN,
        status,
        endedAt: WHEN,
      });
      expect(program.calls.map((call) => call.key)).toEqual([OPEN_RUNS, END]);
    }
    // The run ended and the task not read: said first, so that the run is not ended twice,
    // and then what the reading ended on, as on any command.
    for (const [args, status] of [
      [["fail"], "failed"],
      [["abandon"], "abandoned"],
    ] as const) {
      const unread = fakeConsole({
        [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
        [END]: { body: { ...RUN, status, endedAt: WHEN } },
        [READ]: {
          status: 500,
          body: { error: { code: "internal", message: "Something failed." } },
        },
      });
      const h = harness({ fetch: unread.fetch, env: SIGNED_IN });
      expect(await runCli([...args], h.io)).toBe(EXIT.failed);
      expect(h.out()).toBe("");
      expect(h.err()).toBe(
        `Run ${RUN.id} ${status}, and where that left task #7 was not read. The run is over: do not end it again. console task 7 shows the task. What the reading ended on:\ninternal: Something failed.\n`,
      );
    }
  });

  it("lists, reads, writes, attaches to, archives and restores the project's pages", async () => {
    const page = {
      id: "0199c4d8-0000-7000-8000-000000000060",
      path: "guides/onboarding",
      title: "Onboarding",
      version: 1,
      updatedBy: PERSON,
      agent: "Claude Code",
      archivedAt: null,
      createdAt: WHEN,
      updatedAt: WHEN,
      body: "# Welcome\n\nSee [the plan](plan).",
      createdBy: PERSON,
      links: [{ path: "plan", title: null }],
      backlinks: [{ kind: "task", id: TASK.id, path: null, number: 7, title: "Fix the parser" }],
      files: [],
    };
    const attached = {
      ...page,
      files: [
        {
          id: "0199c4d8-0000-7000-8000-000000000070",
          label: "the report",
          file: { name: "report.md", size: 12, contentType: "text/markdown", sha256: "ab" },
          addedBy: PERSON,
          agent: "Claude Code",
          createdAt: WHEN,
        },
      ],
    };
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/docs`]: { body: { folder: "", folders: ["guides"], items: [] } },
      [`GET ${IN}/docs?folder=guides`]: { body: { folder: "guides", folders: [], items: [page] } },
      [`GET ${IN}/docs?q=welcome&archived=true`]: {
        body: { folder: "", folders: [], items: [page] },
      },
      [`GET ${IN}/docs/guides%2Fonboarding`]: { body: page },
      [`GET ${IN}/docs/guides%2Fnew-page`]: {
        status: 404,
        body: { error: { code: "document.not_found", message: "The page was not found." } },
      },
      [`GET ${IN}/docs/guides%2Fonboarding/versions`]: {
        body: {
          items: [
            {
              number: 1,
              title: "Onboarding",
              author: PERSON,
              agent: "Claude Code",
              createdAt: WHEN,
            },
          ],
        },
      },
      [`GET ${IN}/docs/guides%2Fonboarding/versions/1`]: {
        body: {
          number: 1,
          title: "Onboarding",
          author: PERSON,
          agent: null,
          createdAt: WHEN,
          body: "# Old",
        },
      },
      [`PUT ${IN}/docs/guides%2Fonboarding`]: { status: 201, body: page },
      [`POST ${IN}/docs/guides%2Fonboarding/files`]: { status: 201, body: attached },
      [`POST ${IN}/docs/guides%2Fonboarding/archive`]: { body: { ...page, archivedAt: WHEN } },
      [`POST ${IN}/docs/guides%2Fonboarding/restore`]: { body: page },
    });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      readBytes: async () => new TextEncoder().encode("# The report"),
    });
    expect(await runCli(["docs"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toBe("guides/\n");
    expect(await runCli(["docs", "guides"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("guides/onboarding  Onboarding  (v1, by Claude Code for alice;");
    // A folder as the listing prints it, with its slash, is the same folder.
    expect(await runCli(["docs", "guides/"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("guides/onboarding  Onboarding  (v1, by Claude Code for alice;");
    expect(await runCli(["docs", "--search", "welcome", "--archived"], h.io)).toBe(EXIT.ok);
    expect(await runCli(["doc", "guides/onboarding"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(
      "guides/onboarding: Onboarding\nversion 1, by Claude Code for alice at",
    );
    expect(h.out()).toContain("# Welcome");
    expect(h.out()).toContain("refers to:\n  plan  (no page there yet)");
    expect(h.out()).toContain("referred to by:\n  task #7  Fix the parser");
    expect(await runCli(["doc", "guides/onboarding", "--versions"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("v1  Onboarding  (by Claude Code for alice;");
    expect(await runCli(["doc", "guides/onboarding", "--version", "1"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("# Old");
    expect(await runCli(["doc", "guides/onboarding", "--version", "x"], h.io)).toBe(EXIT.usage);

    expect(
      await runCli(
        [
          "write",
          "guides/onboarding",
          "--title",
          "Onboarding",
          "--body",
          "# Welcome",
          "--base",
          "1",
        ],
        h.io,
      ),
    ).toBe(EXIT.ok);
    expect(h.out()).toContain("Wrote guides/onboarding (Onboarding), version 1; refers to plan");
    expect(calls.find((call) => call.key === `PUT ${IN}/docs/guides%2Fonboarding`)?.body).toEqual({
      title: "Onboarding",
      body: "# Welcome",
      baseVersion: 1,
    });
    // Without a title, the page keeps its own; a page that is not there yet needs one.
    expect(await runCli(["write", "guides/onboarding", "--body", "# Again"], h.io)).toBe(EXIT.ok);
    expect(await runCli(["write", "guides/new-page", "--body", "# New"], h.io)).toBe(EXIT.usage);
    expect(h.err()).toContain("Say its title");
    expect(await runCli(["write", "guides/onboarding"], h.io)).toBe(EXIT.usage);

    expect(
      await runCli(["attach", "guides/onboarding", "./report.md", "--label", "the report"], h.io),
    ).toBe(EXIT.ok);
    expect(h.out()).toContain(
      "Attached report.md (12 bytes) to guides/onboarding: 1 file on the page.",
    );
    expect(await runCli(["archive", "guides/onboarding"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("Archived guides/onboarding (Onboarding)");
    expect(await runCli(["restore", "guides/onboarding"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("Restored guides/onboarding (Onboarding).");
  });

  it("writes what followed a decision, and reads the record", async () => {
    const grown = { ...ANSWERED, outcome: "We changed it; see [the change](changes/parser)." };
    const { fetch, calls } = fakeConsole({
      [`PATCH ${IN}/decisions/${DECISION.id}`]: { body: grown },
      [`GET ${IN}/decisions/${DECISION.id}`]: { body: grown },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["decision", DECISION.id, "--outcome", "We changed it; see [the change](changes/parser)."],
        h.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls[0]?.body).toEqual({ outcome: "We changed it; see [the change](changes/parser)." });
    expect(h.out()).toContain(
      "what followed:\n    We changed it; see [the change](changes/parser).",
    );
    expect(await runCli(["decision", DECISION.id], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("what followed:");
  });

  it("addresses a waiting decision anew with --to, each person once, and refuses to do two things at once", async () => {
    const BOB = {
      ...PERSON,
      id: "0199c4d8-0000-7000-8000-000000000002",
      login: "bob",
      name: "Bob",
    };
    const passed = { ...DECISION, decider: BOB, deciders: [BOB, PERSON] };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      [`PUT ${IN}/decisions/${DECISION.id}/deciders`]: { body: passed },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["decision", DECISION.id, "--to", "bob", "--to", "me", "--to", "bob"], h.io),
    ).toBe(EXIT.ok);
    const sent = calls.find((call) => call.key.startsWith("PUT "));
    expect(sent?.body).toEqual({ deciderIds: [BOB.id, PERSON.id] });
    expect(h.out()).toContain(`for ${BOB.login}, ${PERSON.login}`);

    const both = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["decision", DECISION.id, "--to", "bob", "--outcome", "Done."], both.io),
    ).toBe(EXIT.usage);
    expect(both.err()).toContain("one thing at a time");
    const none = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id, "--to", "none"], none.io)).toBe(EXIT.usage);
  });

  it("writes what followed, and whom a decision is for, in the decision's own project where the directory names none", async () => {
    // A desk names no project, and the wake that brings an answer names the decision alone:
    // the write finds the decision's project as the read does (ADR-0068).
    const HR = "/api/v1/projects/hr";
    const BOB = { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" };
    const grown = { ...ANSWERED, outcome: "Done as answered." };
    const passed = { ...DECISION, decider: BOB, deciders: [BOB] };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      [`GET /api/v1/decisions/${DECISION.id}`]: {
        body: {
          project: { key: "hr", name: "HR", color: null, symbol: null, icon: null },
          decision: ANSWERED,
          mayAnswer: true,
        },
      },
      [`PATCH ${HR}/decisions/${DECISION.id}`]: { body: grown },
      [`PUT ${HR}/decisions/${DECISION.id}/deciders`]: { body: passed },
      [`PATCH ${IN}/decisions/${DECISION.id}`]: { body: grown },
    });
    const pair = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" };
    const written = harness({ fetch, env: pair });
    expect(
      await runCli(["decision", DECISION.id, "--outcome", "Done as answered."], written.io),
    ).toBe(EXIT.ok);
    expect(written.out()).toContain("what followed:\n    Done as answered.");
    expect(calls.map((call) => call.key)).toEqual([
      `GET /api/v1/decisions/${DECISION.id}`,
      `PATCH ${HR}/decisions/${DECISION.id}`,
    ]);
    expect(calls.at(-1)?.body).toEqual({ outcome: "Done as answered." });
    const addressed = harness({ fetch, env: pair });
    expect(await runCli(["decision", DECISION.id, "--to", "bob"], addressed.io)).toBe(EXIT.ok);
    expect(addressed.out()).toContain("for bob");
    expect(calls.at(-1)?.key).toBe(`PUT ${HR}/decisions/${DECISION.id}/deciders`);
    expect(calls.at(-1)?.body).toEqual({ deciderIds: [BOB.id] });
    // With a project named, nothing changes: the write goes there, and nothing is looked up.
    const before = calls.length;
    const named = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["decision", DECISION.id, "--outcome", "Done as answered."], named.io),
    ).toBe(EXIT.ok);
    expect(calls.slice(before).map((call) => call.key)).toEqual([
      `PATCH ${IN}/decisions/${DECISION.id}`,
    ]);
    // A decision out of reach is said as that, never as a project to name.
    const nowhere = harness({ fetch: fakeConsole({}).fetch, env: pair });
    expect(await runCli(["decision", DECISION.id, "--outcome", "Done."], nowhere.io)).toBe(
      EXIT.failed,
    );
    expect(nowhere.err()).toContain("decision.not_found");
    expect(nowhere.err()).not.toContain("Say which project");
  });

  it("reads an answer in the person's own words as one more option, marked as theirs", async () => {
    const own = {
      ...DECISION,
      options: [...DECISION.options, { id: "3", label: "Keep it, but warn", own: true }],
      answer: { option: "3", note: null, by: { ...PERSON, login: "bob" }, at: WHEN },
    };
    const { fetch } = fakeConsole({ [`GET ${IN}/decisions/${DECISION.id}`]: { body: own } });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("  3) Keep it, but warn  (the person's own answer, not one given)");
    expect(h.out()).toContain("Answered: 3) Keep it, but warn, in their own words, by bob");
  });

  it("says what the console refused, with its code, and hints at what to do", async () => {
    const { fetch } = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`POST ${IN}/runs`]: {
        status: 409,
        body: { error: { code: "run.task_closed", message: "the task is done or dropped" } },
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], h.io)).toBe(EXIT.failed);
    expect(h.err()).toBe("run.task_closed: the task is done or dropped\n");
    const out = fakeConsole({
      [`GET ${IN}/tasks?limit=50&offset=0&brief=true`]: {
        status: 401,
        body: { error: { code: "auth.required", message: "Sign in to continue." } },
      },
    });
    const o = harness({ fetch: out.fetch, env: SIGNED_IN });
    expect(await runCli(["tasks"], o.io)).toBe(EXIT.failed);
    expect(o.err()).toContain("auth.required");
    expect(o.err()).toContain("console login");
    // A token the console knows, for a person who is out, is told why and what to do (ADR-0044).
    const refused = fakeConsole({
      [`GET ${IN}/tasks?limit=50&offset=0&brief=true`]: {
        status: 403,
        body: { error: { code: "auth.deactivated", message: "The person is deactivated." } },
      },
    });
    const r = harness({ fetch: refused.fetch, env: SIGNED_IN });
    expect(await runCli(["tasks"], r.io)).toBe(EXIT.failed);
    expect(r.err()).toContain("auth.deactivated: The person is deactivated.");
    expect(r.err()).toContain("People page");
    expect(r.err()).toContain("console logout");
  });
});

describe("the plan on the command line", () => {
  /** Noon on 2026-10-11 by this machine's clock: the day the tests count from. */
  const NOON = Date.parse("2026-10-11T12:00:00");
  const BOB = { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" };

  it("narrows the tasks by what is due, one's own, a category and a goal", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks?open=true&worker=${PERSON.id}&dueBy=2026-10-10&limit=50&offset=0&brief=true`]:
        {
          body: { more: false, items: [{ ...TASK, dueOn: "2026-10-01" }] },
        },
      [`GET ${IN}/tasks?category=engineering&goal=${GOAL.id}&limit=50&offset=0&brief=true`]: {
        body: { more: false, items: [] },
      },
      [`GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0&brief=true`]: {
        body: { more: false, items: [TASK] },
      },
      [`GET ${IN}/tasks?unassigned=true&limit=50&offset=0&brief=true`]: {
        body: { more: false, items: [TASK] },
      },
      [`GET ${IN}/tasks?q=fix+parser&limit=50&offset=0&brief=true`]: {
        body: { more: false, items: [TASK] },
      },
      [`GET ${IN}/tasks?q=docs+README+typo&limit=50&offset=0&brief=true`]: {
        body: { more: false, items: [] },
      },
      [`GET ${IN}/tasks?q=README&limit=50&offset=0&brief=true`]: {
        body: { more: false, items: [] },
      },
    });
    // A search that finds nothing says what it looked for and how: every word must be in a
    // title, so three words found nothing where one of them would have found the task, and an
    // agent that read "No tasks." wrote the same work a second time.
    const missed = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--search", "docs README typo"], missed.io)).toBe(EXIT.ok);
    expect(missed.out()).toBe(
      `No tasks: no title holds every word of "docs README typo". Fewer words find more: one word of the thing's name, in the language the board is written in.\n`,
    );
    const one = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--search", "README"], one.io)).toBe(EXIT.ok);
    expect(one.out()).toBe('No tasks: no title holds "README".\n');
    const overdue = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--mine", "--due", "overdue"], overdue.io)).toBe(EXIT.ok);
    expect(overdue.out()).toBe("#7  ready  high  Fix the parser  (owner alice; due 2026-10-01)\n");
    const narrow = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--category", "engineering", "--goal", GOAL.id], narrow.io)).toBe(
      EXIT.ok,
    );
    expect(narrow.out()).toBe("No tasks.\n");
    const week = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--due", "week"], week.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0&brief=true`);
    const bad = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--due", "soon"], bad.io)).toBe(EXIT.usage);
    expect(bad.err()).toContain("Not a day: soon");
    const nobodys = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--unassigned"], nobodys.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/tasks?unassigned=true&limit=50&offset=0&brief=true`);
    expect(nobodys.out()).toBe("#7  ready  high  Fix the parser  (owner alice)\n");
    const both = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--mine", "--unassigned"], both.io)).toBe(EXIT.usage);
    expect(both.err()).toContain("--unassigned");
    // The words of a title find a task, as a parent is found (ADR-0037); blank words are no search.
    const searched = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--search", "fix parser"], searched.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/tasks?q=fix+parser&limit=50&offset=0&brief=true`);
    expect(searched.out()).toContain("#7");
    const blank = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--search", "  "], blank.io)).toBe(EXIT.usage);
    expect(blank.err()).toContain("--search <words>");
  });

  it("lists the teams with their keys and members, makes one, and puts a person in it, a team called by its key (ADR-0073, ADR-0074)", async () => {
    const TEAM = {
      id: "0199c4d8-0000-7000-8000-000000000071",
      key: "platform",
      name: "Platform",
      memberIds: [BOB.id],
      createdAt: "2026-11-02T01:00:00.000Z",
    };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/people": { body: { items: [PERSON, BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/teams": { body: { items: [TEAM] } },
      "POST /api/v1/teams": {
        status: 201,
        body: { ...TEAM, key: "ops", name: "Ops", memberIds: [] },
      },
      "POST /api/v1/teams/platform/members": { body: TEAM },
      "PATCH /api/v1/teams/platform": { body: { ...TEAM, name: "Platform team" } },
      "DELETE /api/v1/teams/nobody": {
        status: 404,
        body: { error: { code: "team.not_found", message: "The team was not found." } },
      },
    });
    const listed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["teams"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toContain("platform  Platform  1 member: bob");
    const made = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["team", "new", "ops", "Ops"], made.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ key: "ops", name: "Ops" });
    expect(made.out()).toContain("ops  Ops  0 members");
    const renamed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["team", "rename", "platform", "Platform team"], renamed.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ name: "Platform team" });
    const added = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["team", "add", "platform", "bob"], added.io)).toBe(EXIT.ok);
    expect(calls.at(-2)?.body).toEqual({ personId: BOB.id });
    expect(added.out()).toContain("platform  Platform  1 member: bob");
    const nowhere = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["team", "remove", "nobody"], nowhere.io)).not.toBe(EXIT.ok);
    expect(nowhere.err()).toContain("team.not_found");
    const usage = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["team"], usage.io)).toBe(EXIT.usage);
    const nameless = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["team", "new", "ops"], nameless.io)).toBe(EXIT.usage);
  });

  it("writes a task with its plan, and changes one in what the flags say, none clearing a field", async () => {
    const parentId = "0199c4d8-0000-7000-8000-000000000011";
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/people": { body: { items: [PERSON, BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=Bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=carol": { body: { items: [], listed: [], organization: null } },
      [`POST ${IN}/tasks`]: { status: 201, body: { ...TASK, dueOn: "2026-10-24" } },
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`GET ${IN}/tasks/3`]: { body: { ...TASK, id: parentId, number: 3 } },
      [`PATCH ${IN}/tasks/${TASK.id}`]: { body: { ...TASK, workers: [PERSON, BOB] } },
    });
    const h = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(
      await runCli(
        [
          "task",
          "new",
          "Plan the launch",
          "--category",
          "engineering",
          "--goal",
          GOAL.id,
          "--starts",
          "today",
          "--due",
          "+13",
          "--worker",
          "bob,me",
          "--worker",
          "Bob",
          "--parent",
          "3",
          "--priority",
          "high",
        ],
        h.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `POST ${IN}/tasks`)?.body).toEqual({
      title: "Plan the launch",
      priority: "high",
      category: "engineering",
      goalId: GOAL.id,
      startsOn: "2026-10-11",
      dueOn: "2026-10-24",
      workerIds: [BOB.id, PERSON.id],
      parentId,
    });
    expect(h.out()).toContain("Task #7 written");
    const edit = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(
      await runCli(
        ["task", "edit", "7", "--due", "none", "--worker", "me", "--category", "none"],
        edit.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH ${IN}/tasks/${TASK.id}`)?.body).toEqual({
      category: null,
      dueOn: null,
      workerIds: [PERSON.id],
    });
    expect(edit.out()).toContain("workers: alice, bob");
    const cleared = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["task", "edit", "7", "--worker", "none"], cleared.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ workerIds: [] });
    const mixed = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["task", "edit", "7", "--worker", "none,bob"], mixed.io)).toBe(EXIT.usage);
    expect(mixed.err()).toContain("--worker none alone");
    const nothing = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["task", "edit", "7"], nothing.io)).toBe(EXIT.usage);
    expect(nothing.err()).toContain("Say what to change");
    const nobody = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["task", "edit", "7", "--worker", "carol"], nobody.io)).toBe(EXIT.usage);
    expect(nobody.err()).toContain("Nobody of the workspace is called carol");
  });

  it("lists the roadmap, reads a goal with its tasks, sets one and changes one", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/goals?limit=50&offset=0`]: { body: { more: false, items: [GOAL] } },
      [`GET ${IN}/goals?q=ship&limit=1&offset=0`]: { body: { more: true, items: [GOAL] } },
      [`GET ${IN}/goals/${GOAL.id}`]: { body: GOAL },
      [`GET ${IN}/tasks?goal=${GOAL.id}&brief=true`]: { body: { more: false, items: [TASK] } },
      [`POST ${IN}/goals`]: { status: 201, body: GOAL },
      [`PATCH ${IN}/goals/${GOAL.id}`]: { body: { ...GOAL, state: "done" } },
    });
    const list = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goals"], list.io)).toBe(EXIT.ok);
    expect(list.out()).toBe(
      `${GOAL.id}  active  Ship v1  (due 2026-11-15; 2/4 done, 1 in progress)\n`,
    );
    // The roadmap searched by the words of a title, a page at a time.
    const found = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goals", "--search", "ship", "--limit", "1"], found.io)).toBe(EXIT.ok);
    expect(found.out()).toContain("Ship v1");
    expect(found.out()).toContain("... more: --offset 1");
    const one = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goal", GOAL.id], one.io)).toBe(EXIT.ok);
    expect(one.out()).toContain("What it means.");
    expect(one.out()).toContain("progress: 2/4 done, 1 in progress");
    expect(one.out()).toContain("#7  ready  high  Fix the parser");
    const set = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["goal", "new", "Ship v1", "--due", "2026-11-15", "--state", "active"], set.io),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `POST ${IN}/goals`)?.body).toEqual({
      title: "Ship v1",
      state: "active",
      dueOn: "2026-11-15",
    });
    expect(set.out()).toContain(`id: ${GOAL.id}`);
    const change = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goal", "edit", GOAL.id, "--state", "done"], change.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH ${IN}/goals/${GOAL.id}`)?.body).toEqual({
      state: "done",
    });
    expect(change.out()).toContain("state: done");
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goal", "edit", GOAL.id], nothing.io)).toBe(EXIT.usage);
    const wrong = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goal", "new", "x", "--state", "open"], wrong.io)).toBe(EXIT.usage);
    expect(wrong.err()).toContain("Not a state of a goal");
  });

  it("lists the categories, and what is on one's plate across the projects", async () => {
    const { fetch } = fakeConsole({
      "GET /api/v1/categories": { body: { more: false, items: [CATEGORY] } },
      "GET /api/v1/work": {
        body: {
          tasks: [
            {
              project: { key: "web", name: "The web app", color: null, symbol: null, icon: null },
              task: TASK,
            },
          ],
          closed: [
            {
              project: { key: "web", name: "The web app", color: null, symbol: null, icon: null },
              task: {
                ...TASK,
                id: "0199c4d8-0000-7000-8000-000000000031",
                number: 6,
                state: "done",
              },
            },
          ],
          decisions: [],
        },
      },
    });
    const list = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["categories"], list.io)).toBe(EXIT.ok);
    expect(list.out()).toBe("engineering  Engineering  (blue)\n");
    // No project is needed: the plate spans them all.
    const plate = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["work"], plate.io)).toBe(EXIT.ok);
    expect(plate.out()).toContain("tasks you work on:");
    expect(plate.out()).toContain("  web  #7  ready  high  Fix the parser");
    expect(plate.out()).toContain("decisions waiting for you: none");
    // What was closed is for the week on the plate's page: the words keep to the open tasks, the JSON carries it.
    expect(plate.out()).not.toContain("#6");
    const asJson = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["work", "--json"], asJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out()).closed).toHaveLength(1);
  });

  it("shows another person's plate by their login, for whoever oversees them", async () => {
    const bob = { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" };
    const { fetch } = fakeConsole({
      "GET /api/v1/people": { body: { items: [PERSON, bob], listed: [], organization: null } },
      "GET /api/v1/people?login=Bob": { body: { items: [bob], listed: [], organization: null } },
      "GET /api/v1/people?login=dave": { body: { items: [], listed: [], organization: null } },
      [`GET /api/v1/people/${bob.id}/work`]: {
        body: {
          tasks: [
            {
              project: { key: "web", name: "The web app", color: null, symbol: null, icon: null },
              task: { ...TASK, workers: [bob] },
            },
          ],
        },
      },
    });
    const seen = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["work", "--person", "Bob"], seen.io)).toBe(EXIT.ok);
    expect(seen.out()).toContain("tasks bob works on:");
    expect(seen.out()).toContain("  web  #7  ready  high  Fix the parser");
    expect(seen.out()).not.toContain("decisions waiting");
    const nobody = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["work", "--person", "dave"], nobody.io)).toBe(EXIT.usage);
    expect(nobody.err()).toContain("Nobody of the workspace is called dave");
  });
});

describe("a page at a time", () => {
  it("asks for a page of the tasks, the decisions and the runs, and says when there is more", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks?limit=1&offset=1&brief=true`]: { body: { more: true, items: [TASK] } },
      [`GET ${IN}/decisions?open=true&limit=50&offset=0`]: {
        body: { more: false, items: [DECISION] },
      },
      [`GET ${IN}/runs?open=true&limit=2&offset=0&brief=true`]: {
        body: { more: true, items: [RUN] },
      },
    });
    const page = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks", "--limit", "1", "--offset", "1"], page.io)).toBe(EXIT.ok);
    expect(page.out()).toContain("#7  ready  high  Fix the parser");
    expect(page.out()).toContain("... more: --offset 2");
    const waiting = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decisions", "--open"], waiting.io)).toBe(EXIT.ok);
    expect(waiting.out()).not.toContain("more:");
    const runs = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["runs", "--open", "--limit", "2"], runs.io)).toBe(EXIT.ok);
    expect(runs.out()).toContain(`last heard ${WHEN}`);
    expect(runs.out()).toContain("... more: --offset 2");
    expect(calls.map((call) => call.key)).toEqual([
      `GET ${IN}/tasks?limit=1&offset=1&brief=true`,
      `GET ${IN}/decisions?open=true&limit=50&offset=0`,
      `GET ${IN}/runs?open=true&limit=2&offset=0&brief=true`,
    ]);
    const bad = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks", "--limit", "0"], bad.io)).toBe(EXIT.usage);
    expect(bad.err()).toContain("Not a number of items");
  });
});

describe("configuring, as the person", () => {
  const BOB = {
    ...PERSON,
    id: "0199c4d8-0000-7000-8000-000000000002",
    login: "bob",
    name: "Bob Example",
  };
  const OPS = {
    ...PROJECT,
    id: "0199c4d8-0000-7000-8000-000000000051",
    key: "ops",
    name: "Operations",
    description: "Runs the place.",
    color: "teal",
    symbol: "OP",
    role: "owner",
    openDecisions: 0,
  };
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("writes a person's work email, or none, and prints it where the console answers one (ADR-0069)", async () => {
    const mailed = { ...BOB, email: "bob@example.test" };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      [`PATCH /api/v1/people/${BOB.id}`]: [{ body: mailed }, { body: { ...BOB, email: null } }],
    });
    const written = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "email", "bob", "Bob@Example.test"], written.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH /api/v1/people/${BOB.id}`)?.body).toEqual({
      email: "Bob@Example.test",
    });
    expect(written.out()).toBe("bob  Bob Example  <bob@example.test>  (member)\n");
    const cleared = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "email", "bob", "none"], cleared.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ email: null });
    expect(cleared.out()).toBe("bob  Bob Example  (member)\n");
    const missing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "email", "bob"], missing.io)).toBe(EXIT.usage);
  });

  it("writes what a member does, or none, and prints it beside their name (ADR-0084)", async () => {
    const titled = { ...BOB, title: "Release engineer" };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      [`PATCH /api/v1/people/${BOB.id}`]: [{ body: titled }, { body: { ...BOB, title: null } }],
    });
    const written = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "title", "bob", "Release engineer"], written.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH /api/v1/people/${BOB.id}`)?.body).toEqual({
      title: "Release engineer",
    });
    expect(written.out()).toBe("bob  Bob Example, Release engineer  (member)\n");
    const cleared = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "title", "bob", "none"], cleared.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ title: null });
    expect(cleared.out()).toBe("bob  Bob Example  (member)\n");
    const missing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "title", "bob"], missing.io)).toBe(EXIT.usage);
  });

  it("lists the agent accounts, reads one by its handle, and writes its avatar as a picture file (ADR-0084)", async () => {
    const parts = {
      set: 1,
      palette: 0,
      ground: 0,
      form: 1,
      material: 0,
      accent: 0,
      vein: 7,
    };
    const mira = {
      person: {
        ...BOB,
        id: "0199c4d8-0000-7000-8000-000000000009",
        login: "mira@acme.example",
        name: "Mira",
        kind: "agent",
        handle: "mira",
        title: "Release engineer",
        avatarParts: parts,
        invited: true,
      },
      manager: BOB,
      supervised: true,
    };
    const { fetch } = fakeConsole({
      "GET /api/v1/agents": [{ body: { items: [mira] } }, { body: { items: [] } }],
      "GET /api/v1/agents/mira": { body: mira },
    });
    const listed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agents"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toBe(
      "@mira  Mira, Release engineer  (signs in as mira@acme.example, reports to bob, not signed in yet)\n",
    );
    const none = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agents"], none.io)).toBe(EXIT.ok);
    expect(none.out()).toContain("No agent accounts that you see.");
    // By its handle, with the @ people call it by or without.
    const one = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "@mira"], one.io)).toBe(EXIT.ok);
    expect(one.out()).toBe(
      "@mira  Mira, Release engineer  (signs in as mira@acme.example, reports to bob, not signed in yet)\nstate: no runner has been heard from yet\nYou supervise it: an administrator, or above it in the reporting line.\n",
    );
    // The picture is drawn here, from the parts: a PNG of 1024 pixels a side.
    const written: { path: string; name: string; bytes: Uint8Array }[] = [];
    const drawn = harness({
      fetch,
      env: SIGNED_IN,
      writeBytes: async (path, bytes, name) => {
        written.push({ path, name, bytes });
        return `/home/mira/${path}`;
      },
    });
    expect(await runCli(["agent", "mira", "--avatar", "me.png"], drawn.io)).toBe(EXIT.ok);
    expect(drawn.out()).toBe(
      "The avatar of @mira is written to /home/mira/me.png: a PNG of 1024 pixels a side, for its profile elsewhere.\n",
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ path: "me.png", name: "mira.png" });
    const png = written[0]?.bytes ?? new Uint8Array();
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(1024);
    expect(await runCli(["agent"], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.usage);
  });

  it("makes an agent account for an administrator, from flags, with what is left out proposed (ADR-0084)", async () => {
    const made = {
      person: {
        ...BOB,
        id: "0199c4d8-0000-7000-8000-000000000009",
        login: "acme-mira",
        name: "Mira",
        kind: "agent",
        handle: "mira",
        title: "Release engineer",
        invited: true,
      },
      manager: BOB,
      supervised: true,
      firstSignIn: "login",
    };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      "POST /api/v1/agents": [
        { status: 201, body: { ...made, onboarding: { project: "web", number: 412 } } },
        { status: 201, body: { ...made, manager: null } },
        {
          status: 409,
          body: { error: { code: "agent.handle_taken", message: "Another has it." } },
        },
      ],
    });
    const full = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "agent",
          "new",
          "@mira",
          "--login",
          "acme-mira",
          "--title",
          "Release engineer",
          "--manager",
          "bob",
          "--seed",
          "s-1",
        ],
        full.io,
      ),
    ).toBe(EXIT.ok);
    // The host is read off the login, the name off the handle, and the project is the directory's.
    expect(calls.find((call) => call.key === "POST /api/v1/agents")?.body).toEqual({
      host: "gh",
      login: "acme-mira",
      handle: "mira",
      name: "Mira",
      title: "Release engineer",
      avatarSeed: "s-1",
      managerId: BOB.id,
      project: "web",
    });
    expect(full.out()).toContain(
      "@mira  Mira, Release engineer  (signs in as acme-mira, reports to bob, not signed in yet, its account not confirmed)",
    );
    // The account it signs in with is named, and when it has to be there; who makes it at the
    // provider is the organization's to say, and the command says nothing of it (ADR-0094). A
    // login at a git host goes to whoever registers it: there the account is held already.
    expect(full.out()).toContain(
      "It signs in as acme-mira: not confirmed, since this console reads no organization at the git host. That account has to be the organization's own at the git host already, since until its first sign-in binds it here the console lets in whoever holds that login.",
    );
    expect(full.out()).not.toContain("is made at the provider before its machine is set up");
    expect(full.out()).not.toMatch(/a person makes|person's to make|terms/i);
    // Its first task, where the console made one with it, and what comes next: a machine.
    expect(full.out()).toContain(
      "Its first task is #412 in web, with what setting it up takes; its runner is woken with it when it first starts.",
    );
    expect(full.out()).toContain("Next, a machine: console agent invite mira");
    // The least there is to say: the handle and the login; whoever makes it is its manager.
    const least = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "mira", "--login", "mira@acme.example"], least.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toEqual({
      host: "google",
      login: "mira@acme.example",
      handle: "mira",
      name: "Mira",
      project: "web",
    });
    // An older console, or a board that took no more tasks: nothing is said of a task.
    expect(least.out()).not.toContain("Its first task");
    // A Workspace makes its own addresses, so the account may be made on the way.
    expect(least.out()).toContain(
      "It signs in as acme-mira: that account is made at the provider before its machine is set up",
    );
    const taken = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "mira", "--login", "x"], taken.io)).toBe(EXIT.failed);
    const unsaid = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "mira"], unsaid.io)).toBe(EXIT.usage);
    expect(unsaid.err()).toContain("--login <login>");
  });

  it("says what the first sign-in of an account at a git host is held to (ADR-0126)", async () => {
    const waiting = (firstSignIn: string) => ({
      person: {
        ...BOB,
        id: "0199c4d8-0000-7000-8000-000000000009",
        login: "acme-mira",
        name: "Mira",
        kind: "agent",
        handle: "mira",
        invited: true,
      },
      manager: null,
      supervised: true,
      firstSignIn,
    });
    const { fetch } = fakeConsole({
      "POST /api/v1/agents": [
        { status: 201, body: waiting("account") },
        { status: 201, body: waiting("member") },
        { status: 201, body: waiting("login") },
      ],
      "GET /api/v1/agents/mira": { body: waiting("member") },
    });
    const said = async () => {
      const run = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["agent", "new", "mira", "--login", "acme-mira"], run.io)).toBe(EXIT.ok);
      return run.out();
    };
    // The host said which account the login is: that account alone is let in as it.
    const confirmed = await said();
    expect(confirmed).toContain(
      "(signs in as acme-mira, not signed in yet, its account confirmed at the host)",
    );
    expect(confirmed).toContain(
      "It signs in as acme-mira: confirmed at the git host, so that account alone is let in as it, whatever it is called by then.",
    );
    expect(confirmed).not.toContain("whoever holds that login");
    // The organization had no member called so, or could not be asked: not confirmed, and the
    // organization's word at its sign-in is what lets it in.
    const member = await said();
    expect(member).toContain("not signed in yet, its account not confirmed)");
    expect(member).toContain(
      "It signs in as acme-mira: not confirmed, since the organization at the git host has no member called so, or could not be asked. It is let in once it is a member there, and nobody else is under that login.",
    );
    // A console that reads no organization there: not confirmed, and why the account has to be
    // the organization's already.
    const login = await said();
    expect(login).toContain("not signed in yet, its account not confirmed)");
    expect(login).toContain(
      "It signs in as acme-mira: not confirmed, since this console reads no organization at the git host. That account has to be the organization's own at the git host already, since until its first sign-in binds it here the console lets in whoever holds that login.",
    );
    // An account read later says it on its line.
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "mira"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain(
      "(signs in as acme-mira, not signed in yet, its account not confirmed)",
    );
  });

  it("makes a member an agent account only where that is said (ADR-0104)", async () => {
    const converted = {
      person: { ...BOB, kind: "agent", handle: "bolt", name: "Bolt" },
      manager: null,
      supervised: true,
    };
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/agents": [
        {
          status: 409,
          body: {
            error: { code: "agent.login_is_member", message: "A member carries the login." },
          },
        },
        { status: 201, body: converted },
      ],
    });
    // Unsaid, the console refuses, and the command says the two ways on.
    const unsaid = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "bolt", "--login", "bob"], unsaid.io)).toBe(EXIT.failed);
    expect(calls.at(-1)?.body).not.toHaveProperty("convert");
    expect(unsaid.err()).toContain("agent.login_is_member");
    expect(unsaid.err()).toContain("nothing was changed");
    expect(unsaid.err()).toContain("--convert");
    // Said, it is sent, and the answer says what became of the member.
    const said = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "bolt", "--login", "bob", "--convert"], said.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toMatchObject({ login: "bob", handle: "bolt", convert: true });
    expect(said.out()).toContain("bob is an agent account from now on, with everything it did.");
    // The flag is in the command's own help, with the refusal it answers.
    const help = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["help", "agent"], help.io)).toBe(EXIT.ok);
    expect(help.out()).toContain("[--seed <seed>] [--convert]");
    expect(help.out()).toContain("agent.login_is_member");
  });

  it("keeps an agent account's secrets: the names, a value read alone, one set unseen, one removed (ADR-0087)", async () => {
    const kept = { name: "git.token", setAt: WHEN, seeded: false, expiresOn: "2027-11-10" };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/agents/me/secrets": [{ body: { items: [kept] } }, { body: { items: [] } }],
      "GET /api/v1/agents/me/secrets/git.token": { body: { ...kept, value: "the-value" } },
      "PUT /api/v1/agents/me/secrets/git.token": { body: kept },
      "DELETE /api/v1/agents/me/secrets/git.token": { status: 204 },
    });
    const names = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["secrets"], names.io)).toBe(EXIT.ok);
    expect(names.out()).toBe(`git.token  (set ${WHEN}, ends on 2027-11-10)\n`);
    const none = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["secrets"], none.io)).toBe(EXIT.ok);
    expect(none.out()).toContain("No secret is kept yet");
    // The value and nothing else, for whatever reads it next.
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["secret", "git.token"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toBe("the-value\n");
    // Set from what is typed unseen, never from an argument; the value is not said back.
    const set = harness({
      fetch,
      env: SIGNED_IN,
      readStdin: async () => "typed-unseen\n",
    });
    expect(await runCli(["secret", "git.token", "--set", "--expires", "2027-11-10"], set.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toEqual({ value: "typed-unseen", expiresOn: "2027-11-10" });
    expect(set.out()).toBe(`Kept: git.token  (set ${WHEN}, ends on 2027-11-10)\n`);
    expect(set.out()).not.toContain("typed-unseen");
    // Or from a file, whole, without the newline that ends it.
    const filed = harness({
      fetch,
      env: SIGNED_IN,
      readFile: async (path) => {
        expect(path).toBe("token.txt");
        return "from-a-file\n";
      },
    });
    expect(await runCli(["secret", "git.token", "--set", "--file", "token.txt"], filed.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toEqual({ value: "from-a-file" });
    const empty = harness({ fetch, env: SIGNED_IN, readStdin: async () => "\n" });
    expect(await runCli(["secret", "git.token", "--set"], empty.io)).toBe(EXIT.failed);
    expect(empty.err()).toContain("No value was given");
    const removed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["secret", "git.token", "--remove"], removed.io)).toBe(EXIT.ok);
    expect(removed.out()).toBe("The secret git.token is removed.\n");
    expect(await runCli(["secret"], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.usage);
  });

  it("tells an agent account that asks for its own secrets as a supervisor would which command is its own", async () => {
    const refusal = {
      status: 403,
      body: {
        error: {
          code: "auth.forbidden",
          message: "Only a supervisor of the agent account may do this.",
        },
      },
    };
    const mira = {
      ...ME,
      person: { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" },
      agent: null,
      session: { kind: "command", name: "console as mira on mac-mini" },
    };
    const asItself = fakeConsole({
      "GET /api/v1/agents/mira/secrets": refusal,
      "GET /api/v1/me": { body: mira },
    });
    const own = harness({ fetch: asItself.fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "secrets", "@mira"], own.io)).toBe(EXIT.failed);
    expect(own.err()).toBe(
      "auth.forbidden: console agent secrets is a supervisor's command, and you are @mira yourself. Your own store is read with console secrets, and one secret of it with console secret <name>.\n",
    );
    expect(own.out()).toBe("");
    // Asked of another account, or by a person who supervises none, it is the console's own refusal.
    const another = fakeConsole({
      "GET /api/v1/agents/juno/secrets": refusal,
      "GET /api/v1/me": { body: mira },
    });
    const other = harness({ fetch: another.fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "secrets", "juno"], other.io)).toBe(EXIT.failed);
    expect(other.err()).toContain(
      "auth.forbidden: Only a supervisor of the agent account may do this.",
    );
    expect(other.err()).not.toContain("console secrets");
    const person = fakeConsole({
      "GET /api/v1/agents/mira/secrets": refusal,
      "GET /api/v1/me": { body: ME },
    });
    const member = harness({ fetch: person.fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "secrets", "mira"], member.io)).toBe(EXIT.failed);
    expect(member.err()).toContain("Only a supervisor of the agent account may do this.");
    expect(member.err()).not.toContain("console secrets");
  });

  it("seeds a secret for an agent account one supervises, write-only, and lists and removes them (ADR-0087)", async () => {
    const seeded = { name: "mail.password", setAt: WHEN, seeded: true, expiresOn: null };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/agents/mira/secrets": { body: { items: [seeded] } },
      "PUT /api/v1/agents/mira/secrets/mail.password": { body: seeded },
      "DELETE /api/v1/agents/mira/secrets/mail.password": { status: 204 },
    });
    const names = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "secrets", "@mira"], names.io)).toBe(EXIT.ok);
    expect(names.out()).toBe(`mail.password  (set ${WHEN}, seeded by a supervisor)\n`);
    const seed = harness({ fetch, env: SIGNED_IN, readStdin: async () => "first-password\n" });
    expect(await runCli(["agent", "secret", "mira", "mail.password"], seed.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ value: "first-password" });
    expect(seed.out()).toContain("Seeded for @mira, which alone reads it back: mail.password");
    expect(seed.out()).not.toContain("first-password");
    const removed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "secret", "mira", "mail.password", "--remove"], removed.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.key).toBe("DELETE /api/v1/agents/mira/secrets/mail.password");
    expect(removed.out()).toBe("The secret mail.password of @mira is removed.\n");
    const unsaid = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "secret", "mira"], unsaid.io)).toBe(EXIT.usage);
  });

  it("sends an agent account a signal for a supervisor, and reads the record of them (ADR-0085)", async () => {
    const sent = (over: Record<string, unknown>) => ({
      number: 7,
      kind: "tell",
      by: BOB,
      agent: "Claude Code",
      plugin: null,
      source: "person",
      key: null,
      text: "",
      set: null,
      attachments: [],
      at: WHEN,
      ...over,
    });
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/agents/mira/signals": [
        { status: 201, body: sent({ text: "Hold the release." }) },
        { status: 201, body: sent({ number: 8, kind: "interrupt", text: "From a file." }) },
        { status: 201, body: sent({ number: 8, kind: "interrupt" }) },
        { status: 201, body: sent({ number: 9, kind: "stop" }) },
        {
          status: 201,
          body: sent({ number: 10, kind: "set", set: { model: "opus", effort: null } }),
        },
        {
          status: 400,
          body: { error: { code: "signal.not_offered", message: "Its product offers no such." } },
        },
      ],
      "GET /api/v1/agents/mira/signals?before=9&limit=2": {
        body: {
          items: [
            sent({ number: 8, kind: "interrupt", text: "From a file,\n  on two lines." }),
            sent({ number: 7, by: null, agent: null, source: "board", key: "#412", kind: "wake" }),
          ],
          more: true,
          delivered: 7,
        },
      },
      "GET /api/v1/agents/me/signals": { body: { items: [], more: false } },
    });
    const told = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "tell", "@mira", "Hold the release."], told.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ kind: "tell", text: "Hold the release." });
    expect(told.out()).toBe(
      `Sent to @mira: #7  tell  bob through Claude Code  ${WHEN}  Hold the release.\n`,
    );
    // The words from a file, or from standard input, as a report's are.
    const filed = harness({ fetch, env: SIGNED_IN, readFile: async () => "From a file.\n" });
    expect(await runCli(["agent", "interrupt", "mira", "--file", "words.md"], filed.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toEqual({ kind: "interrupt", text: "From a file." });
    // An interrupt without words stops the turn so that what the agent was told is read now.
    const bare = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "interrupt", "mira"], bare.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ kind: "interrupt" });
    // A stop needs no words, and sends none.
    const stopped = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "stop", "mira"], stopped.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ kind: "stop" });
    expect(stopped.out()).toBe(`Sent to @mira: #9  stop  bob through Claude Code  ${WHEN}\n`);
    // The model and the effort: what is named changes, `none` is the product's own again.
    const set = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["agent", "set", "mira", "--model", "opus", "--effort", "none"], set.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ kind: "set", set: { model: "opus", effort: null } });
    expect(set.out()).toContain("#10  set  bob through Claude Code");
    expect(set.out()).toContain("model opus, effort the product's own");
    const refused = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "set", "mira", "--model", "gpt"], refused.io)).toBe(EXIT.failed);
    expect(refused.err()).toContain("Its product offers no such.");

    // What is not said is asked for, before the console is.
    const asked = calls.length;
    for (const args of [
      ["agent", "tell", "mira"],
      ["agent", "tell", "mira", "   "],
      ["agent", "interrupt"],
      ["agent", "stop"],
      ["agent", "stop", "mira", "words", "more"],
      ["agent", "set", "mira"],
      ["agent", "set"],
      ["agent", "signals"],
      ["agent", "signals", "mira", "--limit", "0"],
      ["agent", "signals", "mira", "--limit", "many"],
      ["agent", "signals", "mira", "--before", "-3"],
    ]) {
      const unsaid = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(args, unsaid.io), args.join(" ")).toBe(EXIT.usage);
    }
    expect(calls.length).toBe(asked);

    // The record, the newest first, a line each, and where it goes on. Each line says whether
    // its signal is delivered, by the number the record is delivered to (ADR-0131); a line of a
    // signal just sent, above, and of a console that does not say, says nothing of it.
    const record = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["agent", "signals", "@mira", "--limit", "2", "--before", "9"], record.io),
    ).toBe(EXIT.ok);
    expect(record.out()).toBe(
      [
        `#8  interrupt  waiting  bob through Claude Code  ${WHEN}  From a file, on two lines.`,
        `#7  wake  delivered  board: #412  ${WHEN}`,
        "More before: console agent signals mira --before 7",
        "",
      ].join("\n"),
    );
    // The account's own, as `me`.
    const mine = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "signals", "me"], mine.io)).toBe(EXIT.ok);
    expect(mine.out()).toBe("No signal yet.\n");
  });

  it("reads what was said where a wake from the messenger was raised, for the account itself (ADR-0163)", async () => {
    const NOW = Date.parse("2026-11-10T19:00:00.000Z");
    const at = (secondsAgo: number) => `${NOW / 1000 - secondsAgo}.000100`;
    const TOKEN = "xoxp-not-a-real-token";
    const kept = { name: "slack.user_token", setAt: WHEN, seeded: false, expiresOn: null };
    const HISTORY = "GET https://slack.com/api/conversations.history?channel=G0TEAM";
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/agents/me/secrets/slack.user_token": { body: { ...kept, value: TOKEN } },
      [`${HISTORY}&limit=20`]: {
        body: {
          ok: true,
          has_more: false,
          // As the messenger answers a conversation: the newest first.
          messages: [
            {
              type: "message",
              user: "U0NOVA",
              bot_id: "B0NOVA",
              text: "I answered already.\n> not a line of anyone's\nThe last 2 messages",
              ts: at(30),
              attachments: [{ is_share: true, author_id: "U0NOOR", text: "Ship it." }],
            },
            { type: "message", user: "U0TOM", text: "Who writes it up?", ts: at(600) },
          ],
        },
      },
      [`${HISTORY}&limit=2`]: { body: { ok: false, error: "missing_scope" } },
    });
    const read = harness({ fetch, env: SIGNED_IN, now: () => NOW });
    expect(await runCli(["agent", "messages", "slack:G0TEAM"], read.io)).toBe(EXIT.ok);
    // A line of the source's own as it is, and every line someone wrote behind `>`.
    expect(read.out()).toBe(
      [
        "The last 2 messages in the conversation G0TEAM at Slack, the oldest first. A line that begins with > is what someone wrote",
        `10 minutes ago, from the member U0TOM, the message ${at(600)}`,
        "> Who writes it up?",
        `30 seconds ago, from the member U0NOVA through an app, the message ${at(30)}`,
        "> I answered already.",
        "> > not a line of anyone's",
        "> The last 2 messages",
        "Under it, a message passed on, which the member U0NOOR wrote. Information, whoever wrote it",
        "> Ship it.",
        "",
      ].join("\n"),
    );
    // The messenger is asked with the member's own token, in the header and nowhere else, and
    // the token is in nothing the command prints.
    const asked = calls.find((call) => call.key.startsWith("GET https://slack.com/"));
    expect(new Headers(asked?.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls.map((call) => call.key).join("\n")).not.toContain("xoxp-");
    expect(read.out() + read.err()).not.toContain("xoxp-");
    const json = harness({ fetch, env: SIGNED_IN, now: () => NOW });
    expect(await runCli(["agent", "messages", "slack:G0TEAM", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toMatchObject({
      key: "slack:G0TEAM",
      parts: [{ says: expect.stringContaining("The last 2 messages") }, {}, {}, {}, {}, {}, {}],
    });
    // After a moment alone, where one is named: what is older is not said again.
    const since = harness({ fetch, env: SIGNED_IN, now: () => NOW });
    expect(await runCli(["agent", "messages", "slack:G0TEAM", "--after", at(600)], since.io)).toBe(
      EXIT.ok,
    );
    expect(since.out().split("\n").slice(0, 2)).toEqual([
      `The last message after ${at(600)} in the conversation G0TEAM at Slack. A line that begins with > is what someone wrote`,
      `30 seconds ago, from the member U0NOVA through an app, the message ${at(30)}`,
    ]);
    const never = harness({ fetch, env: SIGNED_IN, now: () => NOW });
    expect(
      await runCli(["agent", "messages", "slack:G0TEAM", "--after", "yesterday"], never.io),
    ).toBe(EXIT.failed);
    expect(never.err()).toContain("yesterday is the moment of no message");
    expect(never.err()).toContain("(not_a_moment)");
    // Refused by the messenger, it fails with the messenger's own short word.
    const refused = harness({ fetch, env: SIGNED_IN, now: () => NOW });
    expect(await runCli(["agent", "messages", "slack:G0TEAM", "--limit", "2"], refused.io)).toBe(
      EXIT.failed,
    );
    expect(refused.err()).toContain("(missing_scope)");
    // An account that keeps no token to read with is told so, and the messenger is not asked.
    const bare = fakeConsole({
      "GET /api/v1/agents/me/secrets/slack.user_token": {
        status: 404,
        body: {
          error: { code: "secret.not_found", message: "The account keeps no secret of that name." },
        },
      },
    });
    const none = harness({ fetch: bare.fetch, env: SIGNED_IN, now: () => NOW });
    expect(await runCli(["agent", "messages", "slack:G0TEAM"], none.io)).toBe(EXIT.failed);
    expect(none.err()).toContain("(no_token)");
    expect(bare.calls.map((call) => call.key)).toEqual([
      "GET /api/v1/agents/me/secrets/slack.user_token",
    ]);
    // What names no source that reads, no conversation or no number is asked for, before the
    // console or the messenger is.
    const before = calls.length;
    for (const args of [
      ["agent", "messages"],
      ["agent", "messages", "G0TEAM"],
      ["agent", "messages", "console:G0TEAM"],
      ["agent", "messages", "chat:G0TEAM"],
      ["agent", "messages", "slack:"],
      ["agent", "messages", "slack:G0TEAM", "--limit", "many"],
      ["agent", "messages", "slack:G0TEAM", "--limit", "0"],
      ["agent", "messages", "slack:G0TEAM", "slack:D0MIRA"],
    ]) {
      const unsaid = harness({ fetch, env: SIGNED_IN, now: () => NOW });
      expect(await runCli(args, unsaid.io), args.join(" ")).toBe(EXIT.usage);
    }
    expect(calls.length).toBe(before);
    // What is spelled as no conversation is refused by the source, with nothing asked of the messenger.
    const odd = harness({ fetch, env: SIGNED_IN, now: () => NOW });
    expect(await runCli(["agent", "messages", "slack:general"], odd.io)).toBe(EXIT.failed);
    expect(odd.err()).toContain("(not_a_conversation)");
    expect(calls.length).toBe(before);
    // The command is in the help of its family.
    const help = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["help", "agent"], help.io)).toBe(EXIT.ok);
    expect(help.out()).toContain(
      "agent messages <source>:<conversation>[:<thread>] [--limit <n>] [--after <moment>]",
    );
  });

  it("raises a wake for an agent account's own, now or for later, and takes one away (ADR-0145)", async () => {
    const NOW = Date.parse("2026-11-20T03:10:20.000Z");
    const kept = (over: Record<string, unknown> = {}) => ({
      key: "wake",
      at: "2026-11-20T03:40:20.000Z",
      text: "Look at the deploy again.",
      createdAt: "2026-11-20T03:10:20.000Z",
      ...over,
    });
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: { ...ME, workspace: { ...ME.workspace, timeZone: "Asia/Seoul" } } },
      "POST /api/v1/agents/me/wakes": [
        { status: 201, body: { signal: { number: 9 }, kept: null } },
        { status: 201, body: { signal: null, kept: kept() } },
        {
          status: 201,
          body: {
            signal: null,
            kept: kept({ key: "deploy", at: "2026-11-20T05:30:00.000Z", text: "" }),
          },
        },
        { status: 201, body: { signal: null, kept: kept() } },
        {
          status: 429,
          body: {
            error: { code: "signal.too_many", message: "As many within the hour as it may." },
          },
        },
      ],
      "DELETE /api/v1/agents/me/wakes/deploy": { body: { items: [] } },
      "DELETE /api/v1/agents/me/wakes/wake": {
        status: 404,
        body: {
          error: { code: "wake.not_found", message: "The account keeps no wake of that name." },
        },
      },
      "GET /api/v1/agents/me/signals": { body: { items: [], more: false } },
      "GET /api/v1/agents/me/wakes": { body: { items: [kept()] } },
    });
    const at = { fetch, env: SIGNED_IN, now: () => NOW };
    // Now: the words alone, and the signal it became.
    const now = harness(at);
    expect(
      await runCli(["agent", "wake", "me", "Chrome is installed; go on with #28."], now.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("POST /api/v1/agents/me/wakes");
    expect(calls.at(-1)?.body).toEqual({ text: "Chrome is installed; go on with #28." });
    expect(now.out()).toBe(
      "Raised, as signal #9 of your record: your runner takes it as it takes any wake.\n",
    );
    // In so many minutes: a moment, and what takes it away.
    const later = harness(at);
    expect(
      await runCli(["agent", "wake", "me", "Look at the deploy again.", "--in", "30"], later.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({
      text: "Look at the deploy again.",
      at: "2026-11-20T03:40:20.000Z",
    });
    expect(later.out()).toContain(
      "Kept: to come  wake  2026-11-20T03:40:20.000Z  Look at the deploy again.",
    );
    expect(later.out()).toContain("Take it away: console agent wake me --cancel.");
    // At an hour of the workspace's clock, the next time it says so: 14:30 in Seoul is 05:30
    // of the same day, since it is 12:10 there; under a name of its own, with no words.
    const clock = harness(at);
    expect(
      await runCli(["agent", "wake", "me", "--at", "14:30", "--key", "deploy"], clock.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ at: "2026-11-20T05:30:00.000Z", key: "deploy" });
    expect(clock.out()).toContain("Take it away: console agent wake me --cancel --key deploy.");
    // `me` is the account wherever it stands among the flags.
    const flagged = harness(at);
    expect(await runCli(["agent", "wake", "--in", "30", "me"], flagged.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("POST /api/v1/agents/me/wakes");
    expect(calls.at(-1)?.body).toEqual({ at: "2026-11-20T03:40:20.000Z" });
    // An hour that has passed today is tomorrow's.
    expect(ownWakeMoment({ at: "09:00" }, "Asia/Seoul", new Date(NOW))?.toISOString()).toBe(
      "2026-11-21T00:00:00.000Z",
    );
    expect(ownWakeMoment({}, "Asia/Seoul", new Date(NOW))).toBeUndefined();
    // Across a night on which a zone's clock is put back, the hour asked for is the hour the
    // clock says then: 09:00 in New York on the first of November 2026, asked the evening
    // before, is fourteen hours of the world's clock on, not thirteen.
    expect(
      ownWakeMoment(
        { at: "09:00" },
        "America/New_York",
        new Date("2026-11-01T00:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-11-01T14:00:00.000Z");
    // And across a night on which it is put forward: 09:00 on the fourteenth of March 2027,
    // asked the evening before, is twelve hours of the world's clock on, not thirteen.
    const forward = (at: string, now: string) =>
      ownWakeMoment({ at }, "America/New_York", new Date(now))?.toISOString();
    expect(forward("09:00", "2027-03-14T01:00:00.000Z")).toBe("2027-03-14T13:00:00.000Z");
    // An hour the clock skips that night is no hour of that day: asked at ten to two for ten
    // past two, the moment is twenty minutes on, when the clock says ten past three, and never
    // one that has passed.
    expect(forward("02:10", "2027-03-14T06:50:00.000Z")).toBe("2027-03-14T07:10:00.000Z");
    expect(forward("02:30", "2027-03-14T01:00:00.000Z")).toBe("2027-03-14T07:30:00.000Z");
    // What the console refuses is said as it says it.
    const many = harness(at);
    expect(await runCli(["agent", "wake", "me"], many.io)).toBe(EXIT.failed);
    expect(many.err()).toContain("As many within the hour as it may.");
    // Taken away by its name; one that is not kept is said so.
    const gone = harness(at);
    expect(await runCli(["agent", "wake", "me", "--cancel", "--key", "deploy"], gone.io)).toBe(
      EXIT.ok,
    );
    expect(gone.out()).toBe("The wake deploy is taken away.\n");
    const none = harness(at);
    expect(await runCli(["agent", "wake", "me", "--cancel"], none.io)).toBe(EXIT.failed);
    expect(none.err()).toContain("The account keeps no wake of that name.");
    // What is not said right is asked for before the console is.
    const asked = calls.length;
    for (const args of [
      ["agent", "wake", "me", "--in", "0"],
      ["agent", "wake", "me", "--in", "soon"],
      ["agent", "wake", "me", "--at", "25:00"],
      ["agent", "wake", "me", "--in", "5", "--at", "14:00"],
      ["agent", "wake", "me", "--key", "Not A Name"],
      ["agent", "wake", "me", "words", "more"],
    ]) {
      const unsaid = harness(at);
      expect(await runCli(args, unsaid.io), args.join(" ")).toBe(EXIT.usage);
    }
    // --key is read before the console is asked who is asking; the rest before the wake is sent.
    expect(calls.slice(asked).map((call) => call.key)).not.toContain(
      "POST /api/v1/agents/me/wakes",
    );
    // What is kept for later stands over the record, which holds it once it is raised.
    const record = harness(at);
    expect(await runCli(["agent", "signals", "me"], record.io)).toBe(EXIT.ok);
    expect(record.out()).toBe(
      "to come  wake  2026-11-20T03:40:20.000Z  Look at the deploy again.\n",
    );
    // A person who asks is told what the console says, that this is an agent account's own.
    const person = harness({
      fetch: fakeConsole({
        "GET /api/v1/me": { body: ME },
        "POST /api/v1/agents/me/wakes": {
          status: 404,
          body: { error: { code: "agent.not_found", message: "No such agent account." } },
        },
      }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["agent", "wake", "me"], person.io)).toBe(EXIT.failed);
    expect(person.err()).toContain("No such agent account.");
  });

  it("begins a new conversation for an agent account's own, with why, when its turn is over (ADR-0154)", async () => {
    const mira = { ...BOB, id: "0199c4d8-0000-7000-8000-000000000009", login: "acme-mira" };
    const sent = (text: string) => ({
      number: 12,
      kind: "reset",
      by: { ...mira, name: "Mira", kind: "agent", handle: "mira" },
      agent: null,
      plugin: null,
      source: "person",
      key: null,
      text,
      set: null,
      attachments: [],
      at: WHEN,
    });
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/agents/me/reset": [
        { status: 201, body: sent("The release is out. Next: its notes.") },
        { status: 201, body: sent("From a file.") },
        {
          status: 409,
          body: { error: { code: "agent.stopped", message: "A supervisor stopped the agent." } },
        },
        {
          status: 429,
          body: { error: { code: "signal.too_many", message: "As many as an hour takes." } },
        },
      ],
    });
    const asked = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["agent", "reset", "me", "The release is out. Next: its notes."], asked.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("POST /api/v1/agents/me/reset");
    expect(calls.at(-1)?.body).toEqual({ text: "The release is out. Next: its notes." });
    // It says when the new conversation begins, and what goes with it: nothing but the words.
    expect(asked.out()).toBe(
      "Asked, as signal #12 of your record: when this turn is over, your session ends and a new conversation begins with these words. Nothing else of this one goes with it: put what must be kept on the board, in your desk or in your product's memory before the turn ends.\n",
    );
    // The words from a file, or from standard input, as a supervisor's are.
    const filed = harness({ fetch, env: SIGNED_IN, readFile: async () => "From a file.\n" });
    expect(await runCli(["agent", "reset", "me", "--file", "why.md"], filed.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ text: "From a file." });
    // What the console refuses is said as it says it: a stop that stands, and the hour's bound.
    const stopped = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "reset", "me", "Again."], stopped.io)).toBe(EXIT.failed);
    expect(stopped.err()).toContain("A supervisor stopped the agent.");
    const full = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "reset", "me", "Again."], full.io)).toBe(EXIT.failed);
    expect(full.err()).toContain("As many as an hour takes.");
    // Why is needed, and asked for before the console is.
    const before = calls.length;
    for (const args of [
      ["agent", "reset", "me"],
      ["agent", "reset", "me", "   "],
      ["agent", "reset", "me", "words", "more"],
    ]) {
      const unsaid = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(args, unsaid.io), args.join(" ")).toBe(EXIT.usage);
      expect(unsaid.err()).toContain('console agent reset me "<why>"');
    }
    expect(calls.length).toBe(before);
    // A console of before knows no such route, and is said to be one.
    const old = harness({ fetch: fakeConsole({}).fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "reset", "me", "Anew."], old.io)).toBe(EXIT.failed);
    expect(old.err()).toContain("This console does not take an account's own reset yet");
    // A supervisor's reset of another account is the signal it was: sent at once, words or none.
    const theirs = fakeConsole({
      "POST /api/v1/agents/mira/signals": { status: 201, body: { ...sent(""), by: BOB } },
    });
    const supervisor = harness({ fetch: theirs.fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "reset", "mira"], supervisor.io)).toBe(EXIT.ok);
    expect(theirs.calls.at(-1)?.body).toEqual({ kind: "reset" });
  });

  it("says how an agent account stands, and what its runner said, where the console answers it (ADR-0085)", async () => {
    const mira = {
      person: {
        ...BOB,
        id: "0199c4d8-0000-7000-8000-000000000009",
        login: "acme-mira",
        name: "Mira",
        kind: "agent",
        handle: "mira",
        title: null,
      },
      manager: BOB,
      supervised: true,
    };
    const { fetch } = fakeConsole({
      "GET /api/v1/agents/mira": [
        // A console that answers neither: an older one, or an account no runner said anything of.
        { body: mira },
        {
          body: {
            ...mira,
            state: { state: "refused", reason: "model_refused", since: WHEN, heardAt: WHEN },
            runner: {
              delivered: 8,
              latest: 10,
              session: null,
              machine: { name: "mac-mini", os: "macOS 15.1", user: "mira" },
              runner: "0.5.0",
              product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: false },
              offers: { models: [], efforts: [], steer: true, images: true, resume: true },
              running: { model: "opus", effort: null },
              settings: { model: "sonnet", effort: "high" },
            },
            // What its product last said of its allowance (ADR-0156): a share, a window the
            // product only calls near its limit, and one whose reset has passed.
            usage: [
              { name: "5-hour", used: 0.829, resetsAt: "2026-10-09T13:00:00.000Z", at: WHEN },
              { name: "weekly", used: null, resetsAt: null, near: true, at: WHEN },
              { name: "gone", used: 0.9, resetsAt: "2026-10-09T09:00:00.000Z", at: WHEN },
            ],
          },
        },
      ],
    });
    const unheard = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "mira"], unheard.io)).toBe(EXIT.ok);
    expect(unheard.out()).toContain("state: no runner has been heard from yet");
    expect(unheard.out()).not.toContain("runner:");
    expect(unheard.out()).not.toContain("usage:");
    const full = harness({ fetch, env: SIGNED_IN, now: () => Date.parse(WHEN) });
    expect(await runCli(["agent", "mira"], full.io)).toBe(EXIT.ok);
    expect(full.out()).toContain(
      [
        `state: refused (model refused) since ${WHEN}; its runner was last heard from ${WHEN}`,
        `usage: 5-hour 82% used, near its limit, resets 2026-10-09T13:00:00.000Z; weekly near its limit (as its product said ${WHEN})`,
        "runner: 0.5.0 on mac-mini (macOS 15.1), as mira",
        "product: Claude Code 2.1.0, a version the driver was not tried with",
        "set to: model sonnet, effort high",
        "runs with: model opus, effort the product's own",
        "signals: 8 of 10 delivered",
      ].join("\n"),
    );
  });

  it("records the accounts an agent holds elsewhere, and takes one away (ADR-0089)", async () => {
    const mira = {
      person: { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" },
      manager: null,
      supervised: false,
    };
    const { fetch, calls } = fakeConsole({
      "PATCH /api/v1/agents/mira": {
        body: { ...mira, accounts: { github: "acme-mira", slack: "U0123 (mira)" } },
      },
      "GET /api/v1/agents/mira": { body: { ...mira, accounts: { github: "acme-mira" } } },
    });
    const kept = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "agent",
          "@mira",
          "--account",
          "github=acme-mira",
          "--account",
          "slack = U0123 (mira)",
          "--account",
          "mail=none",
        ],
        kept.io,
      ),
    ).toBe(EXIT.ok);
    // One request with all of them: a name kept, and none for the one taken away.
    expect(calls.map((call) => call.key)).toEqual(["PATCH /api/v1/agents/mira"]);
    expect(calls[0]?.body).toEqual({
      accounts: { github: "acme-mira", slack: "U0123 (mira)", mail: null },
    });
    expect(kept.out()).toContain("accounts elsewhere: github acme-mira, slack U0123 (mira)");
    // Read back with the account's line; an account that records none says nothing of them.
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "mira"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain("accounts elsewhere: github acme-mira");
    // What names no service or no name is a misuse, and asks nothing of the console.
    const before = calls.length;
    for (const word of ["github", "=acme-mira", "github=", "  =  "]) {
      const wrong = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["agent", "mira", "--account", word], wrong.io), word).toBe(EXIT.usage);
      expect(wrong.err()).toContain("--account github=acme-mira");
    }
    expect(calls.length).toBe(before);
  });

  it("keeps the hours of an agent's day (ADR-0085)", async () => {
    const mira = {
      person: { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" },
      manager: null,
      supervised: true,
    };
    const { fetch, calls } = fakeConsole({
      "PATCH /api/v1/agents/mira": [
        { body: { ...mira, hours: { dayStart: "08:30", dayEnd: "18:00" } } },
        { body: { ...mira, hours: { dayStart: "09:00", dayEnd: null } } },
      ],
    });
    const kept = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["agent", "mira", "--day-start", "08:30", "--day-end", "18:00"], kept.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ dayStart: "08:30", dayEnd: "18:00" });
    expect(kept.out()).toContain("day: starts 08:30, ends 18:00, in the workspace's time zone");
    // none takes an hour away: the usual start, and no end.
    const usual = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["agent", "mira", "--day-start", "none", "--day-end", "none"], usual.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ dayStart: null, dayEnd: null });
    expect(usual.out()).toContain("day: starts 09:00, with no end, in the workspace's time zone");
    // What is no hour never leaves the machine.
    const before = calls.length;
    for (const word of ["9", "9:00", "24:00", "18:60", "noon"]) {
      const wrong = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["agent", "mira", "--day-end", word], wrong.io), word).toBe(EXIT.usage);
      expect(wrong.err()).toContain("Say one as 09:00 or 18:30, or none.");
    }
    expect(calls.length).toBe(before);
  });

  it("makes the invitation that leads a machine to an agent account, and takes it away (ADR-0088)", async () => {
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/agents/mira/invitation": {
        status: 201,
        body: {
          invitation: { createdAt: WHEN, expiresAt: "2026-10-16T10:00:00.000Z", by: BOB },
          code: "ABCD-EFGH",
          command: "console agent setup --console https://console.test --code ABCD-EFGH",
        },
      },
      "DELETE /api/v1/agents/mira/invitation": { status: 204 },
    });
    const made = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "invite", "@mira"], made.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("POST /api/v1/agents/mira/invitation");
    expect(made.out()).toContain("An invitation for @mira, good until 2026-10-16T10:00:00.000Z");
    expect(made.out()).toContain("It is no credential");
    // The one line for the agent's product, and where a person reads the same guide.
    expect(made.out()).toContain(
      "  Set this machine up for an agent account. Install what is missing yourself, without asking: first Node.js 24 or later and the command (npm i -g @skillcdn/console). Then run console agent setup --console https://console.test --code ABCD-EFGH and do what it prints. Ask me only for a sign-in or an administrator's password.",
    );
    expect(made.out()).toContain("https://console.test/setup/ABCD-EFGH");
    const revoked = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "invite", "mira", "--revoke"], revoked.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("DELETE /api/v1/agents/mira/invitation");
    expect(revoked.out()).toBe(
      "The invitation of @mira is taken away: its code opens nothing now.\n",
    );
    expect(await runCli(["agent", "invite"], harness({ fetch, env: SIGNED_IN }).io)).toBe(
      EXIT.usage,
    );
  });

  it("writes an invitation's line to a file, and says no code, where an agent's record would keep it", async () => {
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/agents/mira/invitation": {
        status: 201,
        body: {
          invitation: { createdAt: WHEN, expiresAt: "2026-10-16T10:00:00.000Z", by: BOB },
          code: "ABCD-EFGH",
          command: "console agent setup --console https://console.test --code ABCD-EFGH",
        },
      },
    });
    const written: {
      path: string;
      name: string;
      words: string;
      own: boolean;
      after: boolean;
      posted: number;
    }[] = [];
    const writeBytes: CliIo["writeBytes"] = async (path, bytes, name, options) => {
      written.push({
        path,
        name,
        words: new TextDecoder().decode(bytes),
        own: options?.private === true,
        after: options?.after === true,
        posted: calls.filter((call) => call.key.startsWith("POST")).length,
      });
      return path.startsWith("/") ? path : `/home/bob/${path}`;
    };
    const made = harness({ fetch, env: SIGNED_IN, terminal: false, writeBytes });
    expect(await runCli(["agent", "invite", "mira", "--out", "line.md"], made.io)).toBe(EXIT.ok);
    // The path is tried first, with nothing in it and before the invitation is made, and the
    // line is then written where the try landed; the file is the account's alone to read. The
    // try takes nothing away of what is at the path: the line of the invitation before stays
    // there until the new one is made and written in its place.
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual({
      path: "line.md",
      name: "mira-invitation.md",
      words: "",
      own: true,
      after: true,
      posted: 0,
    });
    expect(written[1]).toMatchObject({
      path: "/home/bob/line.md",
      own: true,
      after: false,
      posted: 1,
    });
    // The file holds what the command would have printed: the line, to be copied, and the guide.
    const words = written[1]?.words ?? "";
    expect(words).toContain("An invitation for @mira, good until 2026-10-16T10:00:00.000Z");
    expect(words).toContain(
      "\n```\nSet this machine up for an agent account. Install what is missing yourself, without asking: first Node.js 24 or later and the command (npm i -g @skillcdn/console). Then run console agent setup --console https://console.test --code ABCD-EFGH and do what it prints. Ask me only for a sign-in or an administrator's password.\n```\n",
    );
    expect(words).toContain("https://console.test/setup/ABCD-EFGH");
    // What is printed names the file and how it is handed on, and nothing of the code.
    expect(made.out()).toContain("An invitation for @mira, good until 2026-10-16T10:00:00.000Z");
    expect(made.out()).toContain("Its line is written to /home/bob/line.md and is not shown here");
    expect(made.out()).toContain("--file /home/bob/line.md --to <login>");
    // A comment carries the file as an attachment: its own words are printed back by the command
    // that writes them, which would put the line in the record all the same.
    expect(made.out()).toContain(
      'console comment <number> "<a line for them>" --attach /home/bob/line.md',
    );
    expect(made.out()).not.toContain("console comment <number> --file");
    expect(made.out() + made.err()).not.toContain("ABCD");
    expect(made.out() + made.err()).not.toContain("EFGH");
    // As data too: the invitation and the file, never the code or the command.
    const data = harness({ fetch, env: SIGNED_IN, writeBytes });
    expect(await runCli(["agent", "invite", "mira", "--out", "line.md", "--json"], data.io)).toBe(
      EXIT.ok,
    );
    expect(JSON.parse(data.out())).toEqual({
      handle: "mira",
      invitation: { createdAt: WHEN, expiresAt: "2026-10-16T10:00:00.000Z", by: BOB },
      file: "/home/bob/line.md",
    });
    // A path that cannot be written is said before anything is asked of the console: the
    // invitation before stands, and no code was made for nobody to hold.
    const asked = calls.length;
    const nowhere = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "invite", "mira", "--out", "/none/line.md"], nowhere.io)).toBe(
      EXIT.failed,
    );
    expect(nowhere.err()).toContain("Nothing can be written at /none/line.md");
    expect(nowhere.err()).toContain("no invitation was made");
    expect(calls.slice(asked).some((call) => call.key.startsWith("POST"))).toBe(false);
    // A file that takes the try and not the line leaves an invitation nobody holds the line of:
    // said, with what to do, and still without the code.
    let tries = 0;
    const halfway = harness({
      fetch,
      env: SIGNED_IN,
      writeBytes: async (path) => {
        tries += 1;
        if (tries > 1) {
          throw new Error("no room");
        }
        return path;
      },
    });
    expect(await runCli(["agent", "invite", "mira", "--out", "/full/line.md"], halfway.io)).toBe(
      EXIT.failed,
    );
    expect(halfway.err()).toContain("could not be written at /full/line.md");
    expect(halfway.err()).toContain("Make the invitation again");
    expect(halfway.out() + halfway.err()).not.toContain("ABCD");
    // A path a shell would split is spelled so that both shells take it whole.
    const spaced = harness({
      fetch,
      env: SIGNED_IN,
      writeBytes: async () => String.raw`C:\Users\mira lee\line.md`,
    });
    expect(await runCli(["agent", "invite", "mira", "--out", "line.md"], spaced.io)).toBe(EXIT.ok);
    expect(spaced.out()).toContain(String.raw`--attach 'C:\Users\mira lee\line.md'`);
    // Taking one away writes nothing: the two are not said together, and nothing is asked.
    const before = calls.length;
    const both = harness({ fetch, env: SIGNED_IN, writeBytes });
    expect(await runCli(["agent", "invite", "mira", "--revoke", "--out", "line.md"], both.io)).toBe(
      EXIT.usage,
    );
    expect(calls.length).toBe(before);
  });

  it("prints the guide an invitation's code opens, on a machine signed in nowhere (ADR-0088)", async () => {
    const setup = {
      account: {
        handle: "mira",
        name: "Mira",
        title: "Release engineer",
        login: "carol",
        host: "gh",
        avatarParts: null,
      },
      workspace: {
        name: "Acme",
        handle: "acme",
        domain: null,
        services: { git: { kind: "github", organization: "acme" } },
      },
      console: { url: ORIGIN },
      expiresAt: "2026-10-16T10:00:00.000Z",
    };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/setup/ABCD-EFGH": { body: setup },
      "GET /api/v1/setup/WXYZ-2345": {
        status: 404,
        body: { error: { code: "setup.not_found", message: "No setup has that code." } },
      },
    });
    // No login on this machine, and none is asked for: the line names the console, and the code
    // is taken as a person types one.
    const read = harness({ fetch });
    expect(
      await runCli(
        ["agent", "setup", "--console", ORIGIN, "--code", "abcdefgh", "--guide"],
        read.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.map((call) => call.key)).toEqual(["GET /api/v1/setup/ABCD-EFGH"]);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();
    expect(read.out()).toContain("# Setting up @mira (Mira, Release engineer)");
    expect(read.out()).toContain("The invitation is good until 2026-10-16T10:00:00.000Z.");
    // The part of whoever prepares the machine, and no more (ADR-0140): what the agent does
    // when it starts is its first task, and is printed to no session at the machine.
    expect(read.out()).toContain("## 2. On the machine (whoever prepares the machine)");
    expect(read.out()).toContain("- Then stop. That is the machine prepared.");
    expect(read.out()).not.toContain("When the agent starts");
    expect(read.out()).not.toContain("What the agent asks for");
    // The guide alone: nothing is asked of the console but what the code opens.
    expect(read.out()).not.toContain("Setting this machine up");
    expect(read.out()).toContain("`acme-mira`");
    expect(read.err()).toBe("");

    const json = harness({ fetch });
    expect(
      await runCli(["agent", "setup", "--url", ORIGIN, "--code", "ABCD-EFGH", "--json"], json.io),
    ).toBe(EXIT.ok);
    const said = JSON.parse(json.out()) as {
      setup: unknown;
      guide: { sections: { key: string }[] };
    };
    expect(said.setup).toEqual(setup);
    expect(said.guide.sections.map((section) => section.key)).toEqual([
      "before",
      "machine",
      "start",
      "browser",
      "asked",
    ]);

    // A code that opens nothing says so, and who makes another.
    const gone = harness({ fetch });
    expect(
      await runCli(["agent", "setup", "--console", ORIGIN, "--code", "WXYZ-2345"], gone.io),
    ).toBe(EXIT.failed);
    expect(gone.err()).toContain("No setup has that code");
    // Where the command has no machine to set up, it says the guide and that it goes no further.
    const nowhere = harness({ fetch });
    expect(
      await runCli(["agent", "setup", "--console", ORIGIN, "--code", "ABCD-EFGH"], nowhere.io),
    ).toBe(EXIT.failed);
    expect(nowhere.out()).toContain("# Setting up @mira");
    expect(nowhere.err()).toContain("A machine cannot be set up from here");
    expect(gone.err()).toContain("console agent invite <handle>");
    expect(gone.out()).toBe("");

    // What is no code, no console or no origin never leaves the machine.
    const before = calls.length;
    for (const args of [
      ["agent", "setup"],
      ["agent", "setup", "--code", "ABCD-EFGH"],
      ["agent", "setup", "--console", ORIGIN],
      ["agent", "setup", "--console", ORIGIN, "--code", "ABC"],
      ["agent", "setup", "--console", "console.test/path", "--code", "ABCD-EFGH"],
      ["agent", "setup", "--console", "http://console.test", "--code", "ABCD-EFGH"],
    ]) {
      expect(await runCli(args, harness({ fetch }).io), args.join(" ")).toBe(EXIT.usage);
    }
    expect(calls.length).toBe(before);
  });

  it("lists the people and says what one is", async () => {
    const dana = {
      id: "0199c4d8-0000-7000-8000-000000000077",
      host: "gh",
      login: "dana",
      createdAt: WHEN,
    };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/people": {
        body: {
          items: [
            PERSON,
            BOB,
            {
              ...BOB,
              id: "0199c4d8-0000-7000-8000-000000000078",
              login: "erin",
              name: null,
              status: "deactivated",
              deactivatedAt: WHEN,
            },
          ],
          listed: [dana],
          organization: null,
        },
      },
      "GET /api/v1/people?login=Bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=carol": { body: { items: [], listed: [], organization: null } },
      [`PATCH /api/v1/people/${BOB.id}`]: { body: { ...BOB, role: "admin" } },
    });
    const list = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["people"], list.io)).toBe(EXIT.ok);
    expect(list.out()).toBe(
      "alice  (member)\nbob  Bob Example  (member)\nerin  (member, deactivated)\ndana  (let in at GitHub, not signed in yet)\n",
    );
    const role = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "role", "Bob", "admin"], role.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH /api/v1/people/${BOB.id}`)?.body).toEqual({
      role: "admin",
    });
    expect(role.out()).toBe("bob  Bob Example  (admin)\n");
    const wrong = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "role", "bob", "boss"], wrong.io)).toBe(EXIT.usage);
    expect(wrong.err()).toContain("Not a role in the workspace");
    const nobody = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "role", "carol", "admin"], nobody.io)).toBe(EXIT.usage);
    expect(nobody.err()).toContain("console people");
    expect(await runCli(["person"], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.usage);
  });

  it("lets a login in, takes a listing away, and takes a person out and back in", async () => {
    const dana = {
      id: "0199c4d8-0000-7000-8000-000000000077",
      host: "google",
      login: "dana@acme.test",
      createdAt: WHEN,
    };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/people": { body: { items: [PERSON, BOB], listed: [dana], organization: null } },
      "GET /api/v1/people?login=Bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      "POST /api/v1/listings": { status: 201, body: dana },
      [`DELETE /api/v1/listings/${dana.id}`]: { status: 204 },
      [`PATCH /api/v1/people/${BOB.id}`]: {
        body: { ...BOB, status: "deactivated", deactivatedAt: WHEN },
      },
    });
    const add = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "add", "dana@acme.test"], add.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "POST /api/v1/listings")?.body).toEqual({
      host: "google",
      login: "dana@acme.test",
    });
    expect(add.out()).toBe("dana@acme.test  (let in at Google, not signed in yet)\n");
    const named = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "add", "dana", "--host", "gh"], named.io)).toBe(EXIT.ok);
    expect(calls.filter((call) => call.key === "POST /api/v1/listings").at(-1)?.body).toEqual({
      host: "gh",
      login: "dana",
    });
    const wrongHost = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "add", "dana", "--host", "gitlab"], wrongHost.io)).toBe(
      EXIT.usage,
    );
    const remove = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "remove", "Dana@acme.test"], remove.io)).toBe(EXIT.ok);
    expect(calls.some((call) => call.key === `DELETE /api/v1/listings/${dana.id}`)).toBe(true);
    expect(remove.out()).toBe("dana@acme.test is no longer let in.\n");
    const nobody = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "remove", "bob"], nobody.io)).toBe(EXIT.usage);
    expect(nobody.err()).toContain("person deactivate");
    const out = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "deactivate", "Bob"], out.io)).toBe(EXIT.ok);
    expect(
      calls.filter((call) => call.key === `PATCH /api/v1/people/${BOB.id}`).at(-1)?.body,
    ).toEqual({ status: "deactivated" });
    expect(out.out()).toBe("bob  Bob Example  (member, deactivated)\n");
    const back = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["person", "reactivate", "bob"], back.io)).toBe(EXIT.ok);
    expect(
      calls.filter((call) => call.key === `PATCH /api/v1/people/${BOB.id}`).at(-1)?.body,
    ).toEqual({ status: "active" });
    expect(await runCli(["person", "forget", "bob"], harness({ fetch, env: SIGNED_IN }).io)).toBe(
      EXIT.usage,
    );
  });

  it("makes a project, reads it, changes it, and gives it an image or takes it away", async () => {
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/projects": { status: 201, body: OPS },
      "GET /api/v1/projects/ops": { body: OPS },
      "PATCH /api/v1/projects/ops": { body: { ...OPS, name: "Ops", symbol: null } },
      "POST /api/v1/projects/ops/icon": {
        body: { ...OPS, icon: { sha256: "a".repeat(64), contentType: "image/png" } },
      },
      "DELETE /api/v1/projects/ops/icon": { body: OPS },
    });
    const made = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "project",
          "new",
          "ops",
          "Operations",
          "--description",
          "Runs the place.",
          "--visibility",
          "private",
          "--skills",
          "none",
          "--color",
          "teal",
          "--symbol",
          "OP",
        ],
        made.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "POST /api/v1/projects")?.body).toEqual({
      key: "ops",
      name: "Operations",
      description: "Runs the place.",
      visibility: "private",
      skillsAddress: null,
      color: "teal",
      symbol: "OP",
    });
    expect(made.out()).toContain("Project made: Operations (ops)");
    expect(made.out()).toContain("console use ops");
    const one = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "ops"], one.io)).toBe(EXIT.ok);
    expect(one.out()).toContain("project ops: Operations");
    expect(one.out()).toContain("visibility: private  role: owner  skills: the organization's");
    expect(one.out()).toContain("color: teal  symbol: OP  glyph: none  image: none");
    expect(one.out()).toContain("Runs the place.");
    const changed = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["project", "edit", "ops", "--name", "Ops", "--symbol", "none"], changed.io),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "PATCH /api/v1/projects/ops")?.body).toEqual({
      name: "Ops",
      symbol: null,
    });
    expect(changed.out()).toContain("project ops: Ops");
    expect(changed.out()).toContain("symbol: none");
    const pictured = harness({
      fetch,
      env: SIGNED_IN,
      readBytes: async (path) =>
        path === "mark.png" ? PNG : Promise.reject(new Error("no such file")),
    });
    expect(await runCli(["project", "icon", "ops", "mark.png"], pictured.io)).toBe(EXIT.ok);
    expect(
      calls.find((call) => call.key === "POST /api/v1/projects/ops/icon")?.init?.body,
    ).toBeInstanceOf(FormData);
    expect(pictured.out()).toContain("image: image/png");
    const bare = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "icon", "ops", "--remove"], bare.io)).toBe(EXIT.ok);
    expect(bare.out()).toContain("image: none");
    for (const args of [
      ["project", "new", "ops"],
      ["project", "edit", "ops"],
      ["project", "icon", "ops"],
      ["project", "icon", "ops", "mark.png", "--remove"],
      ["project", "new", "ops", "Operations", "--color", "crimson"],
      ["project", "new", "ops", "Operations", "--visibility", "secret"],
    ]) {
      const wrong = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(args, wrong.io), args.join(" ")).toBe(EXIT.usage);
    }
  });

  it("gives a project's mark an icon of the pack by its name, and answers a name that is none with the pack's", async () => {
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/projects": { status: 201, body: { ...OPS, glyph: "flag" } },
      "PATCH /api/v1/projects/ops": { body: { ...OPS, glyph: null } },
    });
    const made = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "new", "ops", "Operations", "--glyph", "flag"], made.io)).toBe(
      EXIT.ok,
    );
    expect(calls.find((call) => call.key === "POST /api/v1/projects")?.body).toEqual({
      key: "ops",
      name: "Operations",
      glyph: "flag",
    });
    const cleared = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "edit", "ops", "--glyph", "none"], cleared.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "PATCH /api/v1/projects/ops")?.body).toEqual({
      glyph: null,
    });
    expect(cleared.out()).toContain("symbol: OP  glyph: none  image: none");
    // A name that is none of the pack's sends nothing, and says what the pack holds.
    const sent = calls.length;
    for (const name of ["no-such-icon", "Flag", "constructor", ""]) {
      const wrong = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["project", "edit", "ops", "--glyph", name], wrong.io), name).toBe(
        EXIT.usage,
      );
      expect(wrong.err()).toContain("The pack's icons: ");
      expect(wrong.err()).toContain("calendar");
    }
    expect(calls).toHaveLength(sent);
  });

  it("shows the workspace's settings, and changes who sees whom for an administrator", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": {
        body: { ...ME, workspace: { ...ME.workspace, peopleVisibility: "everyone" } },
      },
      "PATCH /api/v1/workspace": {
        body: { ...ME.workspace, peopleVisibility: "shared_projects" },
      },
    });
    const shown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace"], shown.io)).toBe(EXIT.ok);
    expect(shown.out()).toContain("workspace Acme");
    expect(shown.out()).toContain("people visibility: everyone");
    const changed = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["workspace", "edit", "--people-visibility", "shared-projects"], changed.io),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "PATCH /api/v1/workspace")?.body).toEqual({
      peopleVisibility: "shared_projects",
    });
    expect(changed.out()).toContain("people visibility: shared_projects");
    expect(changed.out()).toContain("week begins on: auto");
    expect(changed.out()).toContain("time zone: none");
    // The week and the time zone go the same way; none takes the zone away.
    const planned = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["workspace", "edit", "--week-start", "monday", "--time-zone", "Asia/Seoul"],
        planned.io,
      ),
    ).toBe(EXIT.ok);
    const cleared = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "edit", "--time-zone", "none"], cleared.io)).toBe(EXIT.ok);
    expect(
      calls.filter((call) => call.key === "PATCH /api/v1/workspace").map((call) => call.body),
    ).toEqual([
      { peopleVisibility: "shared_projects" },
      { weekStart: "monday", timeZone: "Asia/Seoul" },
      { timeZone: null },
    ]);
    const wrong = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "edit", "--people-visibility", "friends"], wrong.io)).toBe(
      EXIT.usage,
    );
    expect(
      await runCli(
        ["workspace", "edit", "--week-start", "tuesday"],
        harness({ fetch, env: SIGNED_IN }).io,
      ),
    ).toBe(EXIT.usage);
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "edit"], nothing.io)).toBe(EXIT.usage);
    // The workspace's language (ADR-0081): one the console speaks, or none.
    const before = calls.length;
    expect(
      await runCli(
        ["workspace", "edit", "--language", "ko"],
        harness({ fetch, env: SIGNED_IN }).io,
      ),
    ).toBe(EXIT.ok);
    expect(
      await runCli(
        ["workspace", "edit", "--language", "none"],
        harness({ fetch, env: SIGNED_IN }).io,
      ),
    ).toBe(EXIT.ok);
    expect(
      calls
        .slice(before)
        .filter((call) => call.key === "PATCH /api/v1/workspace")
        .map((call) => call.body),
    ).toEqual([{ language: "ko" }, { language: null }]);
    const french = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "edit", "--language", "fr"], french.io)).toBe(EXIT.usage);
    expect(french.err()).toContain("a language the console speaks, or none");
  });

  it("names the organization's short name, its domain and the services its agents work with (ADR-0089)", async () => {
    const named = {
      ...ME.workspace,
      handle: "acme",
      domain: "acme.example",
      services: {
        identity: { kind: "google-workspace" },
        git: { kind: "github", organization: "acme" },
      },
    };
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": [{ body: ME }, { body: { ...ME, workspace: named } }],
      "PATCH /api/v1/workspace": { body: named },
      "POST /api/v1/agents": {
        status: 201,
        body: {
          person: {
            ...PERSON,
            login: "mira@acme.example",
            kind: "agent",
            handle: "mira",
            name: "Mira",
          },
          manager: null,
          supervised: true,
        },
      },
    });
    const bare = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace"], bare.io)).toBe(EXIT.ok);
    expect(bare.out()).toContain("handle: none  domain: none");
    expect(bare.out()).toContain("services: none");
    const changed = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "workspace",
          "edit",
          "--handle",
          "@acme",
          "--domain",
          "Acme.Example",
          "--service",
          "identity=google-workspace",
          "--service",
          "git=github,organization=acme",
          "--service",
          "messenger=none",
        ],
        changed.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "PATCH /api/v1/workspace")?.body).toEqual({
      handle: "acme",
      domain: "acme.example",
      services: {
        identity: { kind: "google-workspace" },
        git: { kind: "github", organization: "acme" },
        messenger: null,
      },
    });
    expect(changed.out()).toContain("handle: acme  domain: acme.example");
    expect(changed.out()).toContain("service identity: google-workspace");
    expect(changed.out()).toContain("service git: github, organization=acme");
    // Taken away with none.
    const cleared = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["workspace", "edit", "--handle", "none", "--domain", "none"], cleared.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ handle: null, domain: null });
    for (const service of [
      "github",
      "calendar=google",
      "git=",
      "git=github,organization",
      "git=github,kind=x",
    ]) {
      const wrong = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["workspace", "edit", "--service", service], wrong.io), service).toBe(
        EXIT.usage,
      );
    }

    // An agent account's login is what the identity service makes of the names, unless one is said.
    const made = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "mira"], made.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "POST /api/v1/agents")?.body).toMatchObject({
      host: "google",
      login: "mira@acme.example",
      handle: "mira",
    });
  });

  it("sets, connects and removes the workspace's SkillCDN token for an administrator, and shows it to nobody", async () => {
    const held = {
      ...ME.workspace,
      skills: { ...ME.workspace.skills, packToken: { setAt: "2026-10-18T09:00:00.000Z" } },
    };
    const started = {
      code: "ABCD-EFGH",
      url: "https://skillcdn.test/connect/ABCD-EFGH",
      expiresAt: "2026-10-18T09:10:00.000Z",
      intervalSeconds: 1,
    };
    const { fetch, calls } = fakeConsole({
      "PUT /api/v1/workspace/pack-token": { body: held },
      "DELETE /api/v1/workspace/pack-token": {
        body: { ...ME.workspace, skills: { ...ME.workspace.skills, packToken: null } },
      },
      "POST /api/v1/workspace/pack-token/connect": { status: 201, body: started },
      "POST /api/v1/workspace/pack-token/connect/claim": [
        { body: { status: "pending", ...started } },
        { body: { status: "connected", workspace: held } },
      ],
    });
    const pasted = harness({ fetch, env: SIGNED_IN, readStdin: async () => "scdn_repo_hand\n" });
    expect(await runCli(["workspace", "pack-token", "--stdin"], pasted.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "PUT /api/v1/workspace/pack-token")?.body).toEqual({
      token: "scdn_repo_hand",
    });
    expect(pasted.out()).toContain("SkillCDN token: set");
    expect(pasted.out()).not.toContain("scdn_repo_hand");
    const connected = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "pack-token", "--connect"], connected.io)).toBe(EXIT.ok);
    expect(connected.out()).toContain("ABCD-EFGH");
    expect(connected.out()).toContain("Connected.");
    const removed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "pack-token", "--remove"], removed.io)).toBe(EXIT.ok);
    expect(removed.out()).toContain("SkillCDN token: none");
    expect(await runCli(["workspace", "pack-token"], harness({ fetch, env: SIGNED_IN }).io)).toBe(
      EXIT.usage,
    );
  });

  it("prints moments in the workspace's time zone as the login kept it, learned at whoami, and leaves --json as the API gives it", async () => {
    const { fetch } = fakeConsole({
      "GET /api/v1/me": {
        body: { ...ME, workspace: { ...ME.workspace, timeZone: "Pacific/Kiritimati" } },
      },
      [`GET ${IN}/members`]: {
        body: { items: [{ person: PERSON, role: "owner", addedAt: WHEN, listed: true }] },
      },
      [`GET ${IN}`]: { body: PROJECT },
    });
    const store = memoryStore({
      default: ORIGIN,
      logins: [
        {
          url: ORIGIN,
          account: PERSON.login,
          token: "cns_t_secret",
          agent: undefined,
          since: undefined,
        },
      ],
    });
    const env = { CONSOLE_PROJECT: "web" };
    // Before the zone is known, a moment is as the API gave it.
    const before = harness({ fetch, env, store: store.store });
    expect(await runCli(["members"], before.io)).toBe(EXIT.ok);
    expect(before.out()).toBe(`${PERSON.login}  owner  (since 2026-10-09)\n`);
    // whoami learns the zone and keeps it on the login; from then on the moment is in it: the
    // day after, at fourteen hours ahead.
    const who = harness({ fetch, env, store: store.store });
    expect(await runCli(["whoami"], who.io)).toBe(EXIT.ok);
    expect(store.kept()?.logins[0]?.timeZone).toBe("Pacific/Kiritimati");
    const after = harness({ fetch, env, store: store.store });
    expect(await runCli(["members"], after.io)).toBe(EXIT.ok);
    expect(after.out()).toBe(`${PERSON.login}  owner  (since 2026-10-10)\n`);
    const raw = harness({ fetch, env, store: store.store });
    expect(await runCli(["members", "--json"], raw.io)).toBe(EXIT.ok);
    expect(raw.out()).toContain(WHEN);
  });

  it("says how an owner is listed in a project open to the workspace, where everyone is a member", async () => {
    const { fetch } = fakeConsole({
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      [`POST ${IN}/members`]: {
        status: 409,
        body: { error: { code: "member.open_project", message: "Everyone is a member." } },
      },
    });
    const refused = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["member", "add", "bob"], refused.io)).toBe(EXIT.failed);
    expect(refused.err()).toContain("open to the workspace");
    expect(refused.err()).toContain("--role owner");
    // A login nobody of the workspace has, or one not the person's to see, is said so.
    const nobody = harness({
      fetch: fakeConsole({
        "GET /api/v1/people?login=zed": { body: { items: [], listed: [], organization: null } },
      }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["member", "add", "zed"], nobody.io)).toBe(EXIT.usage);
    expect(nobody.err()).toContain("not yours to see");
  });

  it("lists the members, adds one, changes what they are, and takes them off the list", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/people": { body: { items: [PERSON, BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      "GET /api/v1/people?login=carol": { body: { items: [], listed: [], organization: null } },
      [`GET ${IN}/members`]: {
        body: { items: [{ person: PERSON, role: "owner", addedAt: WHEN }] },
      },
      [`POST ${IN}/members`]: {
        status: 201,
        body: { person: BOB, role: "member", addedAt: WHEN },
      },
      [`PATCH ${IN}/members/${BOB.id}`]: { body: { person: BOB, role: "owner", addedAt: WHEN } },
      [`DELETE ${IN}/members/${BOB.id}`]: { status: 204 },
      "POST /api/v1/projects/ops/members": {
        status: 201,
        body: { person: BOB, role: "owner", addedAt: WHEN },
      },
      "POST /api/v1/projects/dir/members": {
        status: 409,
        body: { error: { code: "member.exists", message: "The person is listed already." } },
      },
    });
    const list = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["members"], list.io)).toBe(EXIT.ok);
    expect(list.out()).toBe("alice  owner  (since 2026-10-09)\n");
    const added = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["member", "add", "bob"], added.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `POST ${IN}/members`)?.body).toEqual({
      personId: BOB.id,
    });
    expect(added.out()).toBe("bob  member  (since 2026-10-09)\n");
    // Several projects at once: one listed already is said so, and the rest go on.
    const several = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["member", "add", "bob", "--project", "ops,dir,ops", "--role", "owner"],
        several.io,
      ),
    ).toBe(EXIT.ok);
    expect(
      calls
        .filter((call) => call.key === "POST /api/v1/projects/ops/members")
        .map((call) => call.body),
    ).toEqual([{ personId: BOB.id, role: "owner" }]);
    expect(calls.some((call) => call.key === "POST /api/v1/projects/dir/members")).toBe(true);
    expect(several.out()).toBe("ops  bob  owner  (since 2026-10-09)\ndir  bob is listed already\n");
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["member", "add", "bob", "--project", "ops,dir", "--json"], asJson.io),
    ).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out())).toEqual([
      { project: "ops", member: { person: BOB, role: "owner", addedAt: WHEN } },
      { project: "dir", member: null },
    ]);
    const empty = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["member", "add", "bob", "--project", ","], empty.io)).toBe(EXIT.usage);
    const owner = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["member", "role", "bob", "owner"], owner.io)).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH ${IN}/members/${BOB.id}`)?.body).toEqual({
      role: "owner",
    });
    expect(owner.out()).toBe("bob  owner  (since 2026-10-09)\n");
    const gone = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["member", "remove", "bob"], gone.io)).toBe(EXIT.ok);
    expect(gone.out()).toBe("bob is no longer listed in the project.\n");
    const nobody = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["member", "add", "carol"], nobody.io)).toBe(EXIT.usage);
    expect(nobody.err()).toContain("Nobody of the workspace is called carol");
    const wrong = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["member", "role", "bob", "boss"], wrong.io)).toBe(EXIT.usage);
    expect(await runCli(["member"], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.usage);
  });

  it("makes, changes and removes a category", async () => {
    const { fetch, calls } = fakeConsole({
      "POST /api/v1/categories": { status: 201, body: CATEGORY },
      "PATCH /api/v1/categories/engineering": { body: { ...CATEGORY, name: "Eng" } },
      "DELETE /api/v1/categories/engineering": { status: 204 },
    });
    const made = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["category", "new", "engineering", "Engineering", "--color", "blue"], made.io),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === "POST /api/v1/categories")?.body).toEqual({
      key: "engineering",
      name: "Engineering",
      color: "blue",
    });
    expect(made.out()).toBe("engineering  Engineering  (blue)\n");
    const changed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["category", "edit", "engineering", "--name", "Eng"], changed.io)).toBe(
      EXIT.ok,
    );
    expect(calls.find((call) => call.key === "PATCH /api/v1/categories/engineering")?.body).toEqual(
      { name: "Eng" },
    );
    expect(changed.out()).toBe("engineering  Eng  (blue)\n");
    const gone = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["category", "remove", "engineering"], gone.io)).toBe(EXIT.ok);
    expect(gone.out()).toBe("Category engineering removed.\n");
    for (const args of [
      ["category"],
      ["category", "edit", "engineering"],
      ["category", "new", "ops"],
      ["category", "new", "ops", "Ops", "--color", "crimson"],
    ]) {
      const wrong = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(args, wrong.io), args.join(" ")).toBe(EXIT.usage);
    }
    const help = harness({ fetch });
    expect(await runCli(["help", "category"], help.io)).toBe(EXIT.ok);
    expect(help.out()).toContain("category.in_use");
    const whole = harness({ fetch });
    expect(await runCli(["help"], whole.io)).toBe(EXIT.ok);
    expect(whole.out()).toContain("Configuring, as the person");
    expect(whole.out()).toContain("project new <key> <name> [flags]");
    const project = harness({ fetch });
    expect(await runCli(["help", "project"], project.io)).toBe(EXIT.ok);
    expect(project.out()).toContain('project new <key> "<name>"');
  });
});

describe("a runner kept going across its runner.json (ADR-0144)", () => {
  /** Runners that end as told, in order, each noting the file it was begun with. */
  const runnersOf = (ends: readonly ("stopped" | "updated" | "changed")[]) => {
    const begun: string[] = [];
    const stops: number[] = [];
    let at = 0;
    return {
      begun,
      stops,
      start: (config: string) => {
        const mine = at;
        at += 1;
        begun.push(config);
        let stop: (() => void) | undefined;
        let asked = false;
        return {
          run: () =>
            new Promise<"stopped" | "updated" | "changed">((resolve) => {
              const how = asked ? "stopped" : ends[mine];
              if (how !== undefined) {
                resolve(how);
              }
              stop = () => resolve("stopped");
            }),
          stop: () => {
            stops.push(mine);
            asked = true;
            stop?.();
          },
        };
      },
    };
  };
  const never = new Promise<void>(() => undefined);

  it("begins the next runner with the file as it is, and ends when one ends for anything else", async () => {
    const runners = runnersOf(["changed", "changed", "updated"]);
    const files = ["second", "third"];
    const said: string[] = [];
    const how = await keepRunning({
      first: "first",
      read: async () => ({ ok: true, config: files.shift() ?? "none" }),
      start: runners.start,
      stopped: never,
      say: (line) => said.push(line),
    });
    expect(how).toBe("updated");
    expect(runners.begun).toEqual(["first", "second", "third"]);
    expect(said).toEqual([]);
  });

  it("begins the next runner with the file as it last read where it reads no more, so that there is always one", async () => {
    // The agent wrote its file again in the turn that was under way, wrongly this time: the
    // runner that ended for the first change is followed by one all the same, which is the
    // only way the agent is told what is wrong with its file.
    const runners = runnersOf(["changed", "changed", "stopped"]);
    const reads = [
      { ok: false as const, problem: "runner.json is not readable JSON" },
      { ok: true as const, config: "mended" },
    ];
    const said: string[] = [];
    const how = await keepRunning({
      first: "first",
      read: async () => reads.shift() ?? { ok: true as const, config: "none" },
      start: runners.start,
      stopped: never,
      say: (line) => said.push(line),
    });
    expect(how).toBe("stopped");
    expect(runners.begun).toEqual(["first", "first", "mended"]);
    expect(said).toEqual([
      "runner.json is not readable JSON: the runner starts again with the runner.json it last read",
    ]);
  });

  it("stops the runner that runs when it is asked to, and one begun while it was asked", async () => {
    let ask: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      ask = resolve;
    });
    // The second runner runs until it is stopped.
    const runners = runnersOf(["changed"]);
    const kept = keepRunning({
      first: "first",
      read: async () => ({ ok: true, config: "second" }),
      start: runners.start,
      stopped,
      say: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runners.begun).toEqual(["first", "second"]);
    ask();
    expect(await kept).toBe("stopped");
    expect(runners.stops).toEqual([1]);
    // Asked while the file was being read: the runner begun after is stopped at once.
    let askLate: () => void = () => undefined;
    const late = runnersOf(["changed"]);
    const ended = await keepRunning({
      first: "first",
      read: async () => {
        askLate();
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true, config: "second" };
      },
      start: late.start,
      stopped: new Promise<void>((resolve) => {
        askLate = resolve;
      }),
      say: () => undefined,
    });
    expect(ended).toBe("stopped");
    expect(late.begun).toEqual(["first", "second"]);
  });
});

describe("the runner on the command line (ADR-0085)", () => {
  const MIRA = {
    ...ME,
    person: { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" },
    agent: null,
    session: { kind: "command", name: "console on mac-mini" },
  };
  /** The machine the command is on, as a test hands it: nothing is started and nothing is written. */
  const host = (over: Partial<RunnerHost> = {}): RunnerHost => ({
    cwd: "/home/mira/desk",
    spawn: () => {
      throw new Error("nothing is started here");
    },
    os: "Darwin 24.1.0",
    user: "mira",
    readText: async () => undefined,
    writePrivate: async () => undefined,
    remove: async () => undefined,
    socket: () => {
      throw new Error("no socket is opened here");
    },
    untilStopped: () => new Promise(() => undefined),
    random: () => 0.5,
    ...over,
  });

  it("is an agent account's own, on the command signed in as the account, and nothing else's", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": [
        { body: ME },
        { body: { ...MIRA, session: null, agent: "a helper" } },
        { body: { ...ME, person: null } },
      ],
    });
    // A person's agent, a token an agent account made, and nobody.
    for (const word of ["an agent account's own", "an agent account's own", "does not know"]) {
      const refused = harness({ fetch, env: SIGNED_IN, runner: host() });
      expect(await runCli(["runner"], refused.io)).toBe(EXIT.failed);
      expect(refused.err()).toContain(word);
    }
    expect(calls.every((call) => call.key === "GET /api/v1/me")).toBe(true);
    const nowhere = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["runner"], nowhere.io)).toBe(EXIT.failed);
    expect(nowhere.err()).toContain("cannot be started here");
    const worded = harness({ fetch, env: SIGNED_IN, runner: host() });
    expect(await runCli(["runner", "now"], worded.io)).toBe(EXIT.usage);
  });

  it("uses nothing of a runner.json that does not read, and names no module it does not have", async () => {
    const { fetch, calls } = fakeConsole({ "GET /api/v1/me": { body: MIRA } });
    for (const [written, word] of [
      ["{", "runner.json is not readable JSON. Nothing of it is used"],
      [
        JSON.stringify({ secrets: { files: { "../.ssh/id": "ssh.key" } } }),
        "runner.json: secrets.files",
      ],
      [JSON.stringify({ driver: "another" }), "names the driver another"],
      [JSON.stringify({ wake: ["console", "pager"] }), "names the wake source pager"],
    ] as const) {
      const refused = harness({
        fetch,
        env: SIGNED_IN,
        runner: host({
          readText: async (path) => {
            expect(path).toBe("runner.json");
            return written;
          },
        }),
      });
      expect(await runCli(["runner"], refused.io), written).toBe(EXIT.failed);
      expect(refused.err(), written).toContain(word);
    }
    // Nothing was said to the console but who is asking.
    expect(calls.every((call) => call.key === "GET /api/v1/me")).toBe(true);
  });

  it("says it is there with what this machine is, and stops when it is told to", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": {
        body: { ...MIRA, workspace: { ...ME.workspace, timeZone: "Asia/Seoul" } },
      },
      "GET /api/v1/agents/me/secrets": { body: { items: [] } },
      "PUT /api/v1/agents/me/runner": {
        body: {
          latest: 4,
          delivered: 4,
          settings: { model: null, effort: null },
          state: "running",
        },
      },
    });
    const read: string[] = [];
    const run = harness({
      fetch,
      env: SIGNED_IN,
      hostname: "mac-mini",
      version: "0.5.0",
      runner: host({
        readText: async (path) => {
          read.push(path);
          return path === "runner.json" ? "{}" : undefined;
        },
        // Told to stop as soon as it listens for it.
        untilStopped: async () => undefined,
        keepAwake: async () => ({ by: "caffeinate" }),
      }),
    });
    expect(await runCli(["runner"], run.io)).toBe(EXIT.ok);
    expect(run.out()).toContain(
      "The runner of @mira at Acme (https://console.test) starts in /home/mira/desk.",
    );
    // The machine is held awake while it runs, and its own lines say by what (ADR-0140).
    expect(run.out()).toContain(
      "the machine is kept from sleeping while the runner runs (caffeinate)",
    );
    expect(run.out()).toContain(
      "the runner is there: Claude Code of a version it did not say, signals after #4",
    );
    expect(run.out()).toContain("the runner stopped");
    expect(read.map((path) => path.replaceAll("\\", "/"))).toEqual([
      "runner.json",
      "work/runner-state.json",
    ]);
    const beat = calls.find((call) => call.key === "PUT /api/v1/agents/me/runner")?.body;
    expect(beat).toMatchObject({
      state: "running",
      reason: "started",
      delivered: 0,
      session: null,
      machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
      runner: "0.5.0",
      product: { driver: "claude", name: "Claude Code", version: null, tried: false },
      offers: { models: ["opus", "sonnet", "haiku", "fable"], steer: true, resume: true },
    });
  });
});

describe("setting a machine up for an agent account (ADR-0088)", () => {
  const SERVICES = { git: { kind: "github", organization: "acme" } };
  const SETUP = {
    account: {
      handle: "mira",
      name: "Mira",
      title: "Release engineer",
      login: "acme-mira",
      host: "gh",
      avatarParts: null,
    },
    workspace: { name: "Acme", handle: "acme", domain: null, services: SERVICES },
    console: { url: ORIGIN },
    expiresAt: "2026-10-16T10:00:00.000Z",
  };
  const MIRA = {
    ...ME,
    workspace: { ...ME.workspace, handle: "acme", domain: null, services: SERVICES },
    person: {
      ...PERSON,
      login: "acme-mira",
      name: "Mira",
      kind: "agent",
      handle: "mira",
      title: "Release engineer",
    },
    agent: null,
    session: { kind: "command", name: "console as mira on mac-mini" },
  };
  const AGENT = { person: MIRA.person, manager: null, supervised: false };
  const HEARD = {
    ...AGENT,
    state: { state: "running", reason: "started", since: WHEN, heardAt: WHEN },
    runner: {
      delivered: 0,
      latest: 0,
      session: null,
      machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
      runner: "0.5.0",
      product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: false },
      offers: { models: [], efforts: [], steer: true, images: true, resume: true },
      running: { model: null, effort: null },
      settings: { model: null, effort: null },
    },
  };
  const SESSION = {
    id: "0199c4d8-0000-7000-8000-0000000000a1",
    current: false,
    createdAt: WHEN,
    lastSeenAt: WHEN,
    expiresAt: WHEN,
    browser: null,
    platform: null,
    address: null,
    kind: "command",
    name: "console as mira on mac-mini",
  };
  const PAGE = `${ORIGIN}/connect/WXYZ-2345`;
  const UNIT = "/Users/mira/Library/LaunchAgents/ai.skillcdn.console.runner.plist";
  const LINE = ["agent", "setup", "--console", ORIGIN, "--code", "ABCD-EFGH"];
  /** The account's command, signed in already: what the command keeps of it. */
  const KEPT: Credentials = {
    default: ORIGIN,
    logins: [
      {
        url: ORIGIN,
        account: "acme-mira",
        token: "cns_a_kept",
        agent: undefined,
        since: undefined,
        self: true,
      },
    ],
  };

  /** The console as a setup meets it: the invitation's code, the connection, the account and its runner. */
  const consoleOf = (over: Record<string, Answer | Answer[]> = {}) =>
    fakeConsole({
      "GET /api/v1/setup/ABCD-EFGH": { body: SETUP },
      "POST /api/v1/connect": {
        status: 201,
        body: { ...CONNECTION, code: "WXYZ-2345", url: PAGE },
      },
      "POST /api/v1/connect/claim": [
        { status: 202, body: { status: "pending", expiresAt: WHEN } },
        { body: { status: "signed_in", session: SESSION, secret: "cns_a_handed" } },
      ],
      "GET /api/v1/me": { body: MIRA },
      "DELETE /api/v1/me/token": { status: 204 },
      "GET /api/v1/agents/mira": [{ body: AGENT }, { body: HEARD }],
      "GET /api/v1/agents/me/secrets": { body: { items: [] } },
      ...over,
    });

  /** A machine that touches nothing: its files in memory, and what it was asked to run and to open. */
  function fakeMachine(
    over: {
      readonly platform?: string;
      readonly cwd?: string;
      readonly files?: Readonly<Record<string, string>>;
      readonly ran?: (command: string, args: readonly string[]) => Ran | undefined;
      /** A machine with no browser on it. */
      readonly bare?: boolean;
    } = {},
  ) {
    // A machine that has what a setup looks for (ADR-0140), the browser among it, unless a
    // test says otherwise: git and the product's command answer as every program does here.
    const files = new Map(
      Object.entries({
        ...(over.bare === true
          ? {}
          : {
              "/Applications/Google Chrome.app/Contents/Info.plist": "",
              "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe": "",
              "/opt/google/chrome/chrome": "",
            }),
        ...over.files,
      }),
    );
    const written: { path: string; mode: number }[] = [];
    const runs: {
      command: string;
      args: readonly string[];
      env: Readonly<Record<string, string>> | undefined;
    }[] = [];
    const opened: string[] = [];
    /** What the setup asked of the machine to look at it (ADR-0140), and what it set of the desk's own git. */
    const looked: string[] = [];
    const deskGit: (readonly string[])[] = [];
    const under = (path: string) => [...files.keys()].some((file) => file.startsWith(`${path}/`));
    const machine: SetupMachine = {
      platform: over.platform ?? "darwin",
      user: "mira",
      home: "/Users/mira",
      uid: 502,
      self: ["/usr/local/bin/node", "/opt/console/dist/cli/main.js"],
      searchPath: "/usr/local/bin:/usr/bin:/bin",
      path: (...parts) => {
        const [first = "", ...rest] = parts;
        const cwd = over.cwd ?? "/Users/mira";
        const base = first === "." ? cwd : first.startsWith("/") ? first : `${cwd}/${first}`;
        return [base, ...rest].join("/");
      },
      exists: async (path) => files.has(path) || under(path),
      read: async (path) => files.get(path),
      holds: async (path) => under(path),
      write: async (path, text, mode) => {
        files.set(path, text);
        written.push({ path, mode });
      },
      run: async (command, args, options) => {
        if (
          ["xcode-select", "pmset", "fdesetup", "defaults"].includes(command) ||
          args.at(-1) === "--version"
        ) {
          looked.push([command, ...args].join(" "));
        } else if (command === "git" && args[0] === "-C") {
          deskGit.push(args.slice(2));
        } else {
          runs.push({ command, args, env: options?.env });
        }
        return over.ran?.(command, args) ?? { code: 0, out: "", err: "" };
      },
      open: async (url) => {
        opened.push(url);
        return true;
      },
    };
    return { machine, files, written, runs, opened, looked, deskGit };
  }

  it("prints the guide, signs in as the account in the machine's browser, writes the desk and the service, and hears the runner", async () => {
    const { fetch, calls } = consoleOf();
    const at = fakeMachine();
    const store = memoryStore();
    const run = harness({ fetch, machine: at.machine, store: store.store, hostname: "mac-mini" });
    expect(await runCli(LINE, run.io)).toBe(EXIT.ok);
    const out = run.out();
    // The guide first, for whoever reads the command's words; then the machine.
    expect(out).toContain("# Setting up @mira (Mira, Release engineer)");
    expect(out).toContain("Setting this machine up for @mira, in the OS account mira on mac-mini.");
    // It asks to be the account itself, named by the OS account and the machine, and opens the
    // console's own page in the machine's browser.
    expect(calls.find((call) => call.key === "POST /api/v1/connect")?.body).toEqual({
      agent: "console as mira on mac-mini",
      as: "self",
    });
    expect(at.opened).toEqual([PAGE]);
    expect(out).toContain(`The page is opened in this machine's browser: ${PAGE}.`);
    expect(out).toContain("check that the page shows the code WXYZ-2345, and say that it is you");
    // The end of the wait is printed as every moment is, as a login's is: as the API gave it
    // while no login at this console has kept the workspace's time zone, and in that zone where
    // one has.
    expect(out).toContain(`\nWaiting for that, until ${WHEN}.\n`);
    const zoned = harness({
      fetch: consoleOf().fetch,
      machine: fakeMachine().machine,
      store: memoryStore({
        default: ORIGIN,
        logins: [
          {
            url: ORIGIN,
            account: "alice",
            token: "cns_t_before",
            agent: undefined,
            since: undefined,
            timeZone: "Asia/Seoul",
          },
        ],
      }).store,
      hostname: "mac-mini",
    });
    expect(await runCli(LINE, zoned.io)).toBe(EXIT.ok);
    expect(zoned.out()).toContain("\nWaiting for that, until 2026-10-09T19:00:00+09:00.\n");
    // What it keeps is the account's own session, as the default here; its secret is said nowhere.
    expect(store.kept()).toMatchObject({
      default: ORIGIN,
      logins: [{ url: ORIGIN, account: "acme-mira", token: "cns_a_handed", self: true }],
    });
    expect(out).toContain(
      "Signed in as @mira: what this command does from now on, the account does.",
    );
    expect(out).not.toContain("cns_a_handed");
    expect(out).not.toContain("is bound to it: console use");
    // The desk, from the template, in the OS account's home.
    expect(at.written.filter((file) => file.path.startsWith("/Users/mira/desk/"))).toEqual(
      ["README.md", "AGENTS.md", "CLAUDE.md", "runner.json", ".gitignore"].map((name) => ({
        path: `/Users/mira/desk/${name}`,
        mode: 0o644,
      })),
    );
    expect(at.files.get("/Users/mira/desk/AGENTS.md")).toContain("@mira");
    expect(at.files.get("/Users/mira/desk/AGENTS.md")).toContain("acme-mira");
    expect(out).toContain(
      "A new desk is written at /Users/mira/desk (README.md, AGENTS.md, CLAUDE.md, runner.json, .gitignore).",
    );
    // The service: the runner as this command was started, in the desk, at this console and as
    // this account; loaded with no administrator's rights, and nothing else is run.
    const unit = at.files.get(UNIT) ?? "";
    expect(unit).toContain(
      [
        "    <string>/usr/local/bin/node</string>",
        "    <string>/opt/console/dist/cli/main.js</string>",
        "    <string>runner</string>",
        "    <string>--url</string>",
        `    <string>${ORIGIN}</string>`,
        "    <string>--account</string>",
        "    <string>acme-mira</string>",
      ].join("\n"),
    );
    expect(unit).toContain("<key>WorkingDirectory</key>\n  <string>/Users/mira/desk</string>");
    expect(unit).not.toContain("cns_a_handed");
    expect(at.runs.map((ran) => [ran.command, ...ran.args])).toEqual([
      ["launchctl", "bootout", "gui/502/ai.skillcdn.console.runner"],
      ["launchctl", "bootstrap", "gui/502", UNIT],
    ]);
    expect(out).toContain(`The launchd service is written (${UNIT}) and loaded`);
    // And how the runner stands, with the machine and the OS account as it said them.
    expect(out).toContain(
      "The runner is heard from: mac-mini, Darwin 24.1.0, OS account mira. @mira is set up on this machine",
    );
    expect(run.err()).toBe("");
  });

  it("looks at the machine first, says everything that is missing at once, and asks nobody to sign in until it is there (ADR-0140)", async () => {
    // A new machine: no Command Line Tools, no product's command, no browser.
    const { fetch, calls } = consoleOf();
    const bare = fakeMachine({
      bare: true,
      ran: (command) =>
        command === "xcode-select" || command === "claude" || command === "codex"
          ? { code: 1, out: "", err: "not found" }
          : undefined,
    });
    const store = memoryStore();
    const run = harness({ fetch, machine: bare.machine, store: store.store });
    expect(await runCli(LINE, run.io)).toBe(EXIT.failed);
    expect(run.err()).toContain(
      "This machine lacks what the setup needs. Install each yourself, without asking, and run the line again:",
    );
    expect(run.err()).toContain("- git: the Command Line Tools are not installed");
    expect(run.err()).toContain(
      "- the agent's product: none of claude (Claude Code), codex (Codex) answers where this command looks for programs.",
    );
    // git is a placeholder that opens a window there: it is not asked for its version.
    expect(bare.looked).toEqual(["xcode-select -p", "claude --version", "codex --version"]);
    // Nobody was asked to sign in, and nothing was written or run.
    expect(calls.map((call) => call.key)).not.toContain("POST /api/v1/connect");
    expect(store.kept()).toBeUndefined();
    expect(bare.written).toEqual([]);
    expect(bare.runs).toEqual([]);

    // The product is there and the agent's browser is not, a Chrome with no window where
    // nobody names another (ADR-0151): said with the way out for an agent that signs in at no
    // page, which then sets the machine up with no browser named.
    const browserless = fakeMachine({ bare: true });
    const stopped = harness({
      fetch: consoleOf().fetch,
      machine: browserless.machine,
      store: memoryStore().store,
    });
    expect(await runCli(LINE, stopped.io)).toBe(EXIT.failed);
    expect(stopped.err()).toContain(
      "- Google Chrome: the agent's browser is a Chrome with no window, which Claude Code is started with, and the agent signs in at its services in it. Install it in /Applications, where the program that starts it looks.",
    );
    expect(stopped.err()).toContain("say --no-browser");
    // The program that drives it is there, and is not asked for.
    expect(stopped.err()).not.toContain("- chrome-devtools-mcp:");
    expect(browserless.looked).toContain("chrome-devtools-mcp --version");
    const without = fakeMachine({ bare: true });
    const went = harness({
      fetch: consoleOf().fetch,
      machine: without.machine,
      store: memoryStore().store,
    });
    expect(await runCli([...LINE, "--no-browser"], went.io)).toBe(EXIT.ok);
    expect(went.out()).toContain("The machine has what the setup needs: git, Claude Code.");
    // The desk says that it has none: a file that said nothing would mean the one with no
    // window (ADR-0151).
    expect(JSON.parse(without.files.get("/Users/mira/desk/runner.json") ?? "{}")).toMatchObject({
      browser: "none",
    });

    // The program that drives a Chrome with no window is not there: said with what installs
    // it, and with the product's own browser tool as the other way.
    const undriven = fakeMachine({
      ran: (command) =>
        command === "chrome-devtools-mcp"
          ? { code: null, out: "", err: "spawn ENOENT" }
          : undefined,
    });
    const lacking = harness({
      fetch: consoleOf().fetch,
      machine: undriven.machine,
      store: memoryStore().store,
    });
    expect(await runCli(LINE, lacking.io)).toBe(EXIT.failed);
    expect(lacking.err()).toContain(
      "- chrome-devtools-mcp: the program that drives a Chrome with no window for Claude Code does not answer. Install it: npm install -g chrome-devtools-mcp@latest. It runs on Node.js 20.19, 22.12 or later: where it is installed and does not answer, the machine's Node.js is older. For Claude Code's own browser tool instead, in a Chrome with a window and the Claude in Chrome extension, say --browser chrome.",
    );
    expect(undriven.written).toEqual([]);

    // Whoever runs the setup chooses the product's own browser tool: the browser is looked
    // for, the program is not, the extension is said in a line, and the desk names that one.
    const chosen = harness({
      fetch: consoleOf().fetch,
      machine: undriven.machine,
      store: memoryStore().store,
    });
    expect(await runCli([...LINE, "--browser", "chrome"], chosen.io)).toBe(EXIT.ok);
    expect(chosen.out()).toContain(
      "The machine has what the setup needs: git, Claude Code, Google Chrome.",
    );
    expect(chosen.out()).toContain(
      "Claude Code's browser tool also takes the Claude in Chrome extension in it",
    );
    expect(JSON.parse(undriven.files.get("/Users/mira/desk/runner.json") ?? "{}")).toMatchObject({
      driver: "claude",
      browser: "chrome",
    });
    // A browser is one of the two a setup looks for, and one is said or none.
    for (const words of [
      ["--browser", "firefox"],
      ["--browser", "none"],
      ["--browser", "chrome", "--no-browser"],
    ]) {
      const refused = harness({
        fetch: consoleOf().fetch,
        machine: fakeMachine().machine,
        store: memoryStore().store,
      });
      expect(await runCli([...LINE, ...words], refused.io)).toBe(EXIT.usage);
    }

    // The product named is the one looked for, and the one a new desk names.
    const other = fakeMachine({
      ran: (command) =>
        command === "codex" ? { code: 0, out: "codex-cli 0.130.0\n", err: "" } : undefined,
    });
    const named = harness({
      fetch: consoleOf().fetch,
      machine: other.machine,
      store: memoryStore().store,
    });
    expect(await runCli([...LINE, "--driver", "codex"], named.io)).toBe(EXIT.ok);
    expect(other.looked.slice(0, 3)).toEqual([
      "xcode-select -p",
      "git --version",
      "codex --version",
    ]);
    expect(named.out()).toContain(
      "The machine has what the setup needs: git, Codex (codex-cli 0.130.0).",
    );
    const codexDesk = JSON.parse(other.files.get("/Users/mira/desk/runner.json") ?? "{}");
    expect(codexDesk).toMatchObject({ driver: "codex" });
    // Its driver starts it with no browser, so its desk names none: a name there would read
    // as a browser the agent has.
    expect(codexDesk).not.toHaveProperty("browser");
    expect(named.out()).toContain("No browser for Codex: its driver starts it with none");
    const unknown = harness({
      fetch: consoleOf().fetch,
      machine: fakeMachine().machine,
      store: memoryStore().store,
    });
    expect(await runCli([...LINE, "--driver", "lathe"], unknown.io)).toBe(EXIT.usage);
  });

  it("names the product and its browser in a new desk, has the desk's git read the token from the store, and ends by handing over (ADR-0140)", async () => {
    const FIRST = {
      project: { key: "common", name: "Common", color: null, symbol: null, icon: null },
      task: { ...TASK, number: 28, title: "Set up @mira" },
    };
    const { fetch } = consoleOf({
      "GET /api/v1/agents/mira": [
        { body: AGENT },
        { body: HEARD },
        { body: HEARD },
        { body: { ...HEARD, runner: { ...HEARD.runner, session: SESSION.id } } },
      ],
      "GET /api/v1/work": { body: { tasks: [FIRST], decisions: [] } },
    });
    const at = fakeMachine({
      ran: (command, args) =>
        command === "claude"
          ? { code: 0, out: "2.1.329 (Claude Code)\n", err: "" }
          : command === "pmset"
            ? {
                code: 0,
                out: 'pid 412(caffeinate): [0x0001] 00:00:02 PreventUserIdleSystemSleep named: "caffeinate command-line tool"\n',
                err: "",
              }
            : command === "fdesetup"
              ? { code: 0, out: "FileVault is On.\n", err: "" }
              : command === "git" && args.includes("--get-all")
                ? { code: 1, out: "", err: "" }
                : undefined,
    });
    const run = harness({
      fetch,
      machine: at.machine,
      store: memoryStore().store,
      hostname: "mac-mini",
    });
    expect(await runCli(LINE, run.io)).toBe(EXIT.ok);
    const out = run.out();
    expect(at.looked).toEqual([
      "xcode-select -p",
      "git --version",
      "claude --version",
      "chrome-devtools-mcp --version",
      "pmset -g",
      "fdesetup status",
      "defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser",
      "defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates",
      "pmset -g assertions",
    ]);
    // The agent's browser is a Chrome with no window where nobody names another (ADR-0151):
    // nothing of it is unseen, so no line is said of an extension or a sign-in.
    expect(out).toContain(
      "The machine has what the setup needs: git, Claude Code (2.1.329 (Claude Code)), Google Chrome and chrome-devtools-mcp, which drives it with no window.",
    );
    expect(out).not.toContain("the Claude in Chrome extension");
    // What was found is what the runner starts with.
    expect(JSON.parse(at.files.get("/Users/mira/desk/runner.json") ?? "{}")).toMatchObject({
      driver: "claude",
      browser: "headless",
    });
    // The desk is a repository whose git asks the account's store for the token, for the
    // workspace's git host alone and in place of the machine's own helpers.
    expect(at.deskGit.map((args) => args.slice(0, 4).join(" "))).toEqual([
      "init --quiet",
      "config --local --get-all credential.https://github.com.helper",
      "config --local --replace-all credential.https://github.com.helper",
      "config --local --add credential.https://github.com.helper",
    ]);
    expect(at.deskGit[2]?.at(-1)).toBe("");
    const helper = at.deskGit[3]?.at(-1) ?? "";
    expect(helper).toContain(
      "'/usr/local/bin/node' '/opt/console/dist/cli/main.js' 'secret' 'git.token'",
    );
    expect(helper).toContain(`'--url' '${ORIGIN}' '--account' 'acme-mira'`);
    expect(helper).not.toContain("cns_a_handed");
    expect(out).toContain(
      "The desk's git reads the account's git.token from its store when https://github.com asks",
    );
    // The end: the session has begun, where to watch, the first task, and that the machine's
    // part ends here; then whether the machine is kept awake.
    expect(out).toContain("@mira's session has begun: the agent is at work.");
    expect(out).toContain(`Watch it: ${ORIGIN}/agents/mira`);
    expect(out).toContain(
      `Its first task: #28 "Set up @mira" in common, ${ORIGIN}/projects/common/tasks/28`,
    );
    expect(out).toContain("That is the machine prepared: stop here.");
    expect(out).toContain('say to it: console agent wake me "<what changed>"');
    // Asked of the system, which said that the runner's helper holds it.
    expect(out).toContain("The machine is kept from sleeping while the runner runs");
    // And last what its settings, read, still leave to whoever keeps it, with the cost.
    expect(out).toContain(
      "What on this machine still leaves @mira unheard with nobody there, for whoever keeps the machine to change or to accept:\n- A restart: FileVault is on,",
    );
    expect(out.trimEnd().endsWith("name who logs in after a restart.")).toBe(true);
  });

  it("gives up a sign-in that is not the account's, and sets nothing up", async () => {
    // A person at the browser said that the command is them.
    const person = { ...ME, agent: null, session: { kind: "command", name: "console as mira" } };
    const { fetch, calls } = consoleOf({ "GET /api/v1/me": { body: person } });
    const at = fakeMachine();
    const store = memoryStore();
    const run = harness({ fetch, machine: at.machine, store: store.store });
    expect(await runCli(LINE, run.io)).toBe(EXIT.failed);
    expect(run.err()).toContain("The page said that this command is alice, who is not @mira.");
    expect(run.err()).toContain("That sign-in is given up, and nothing was set up.");
    expect(calls.map((call) => call.key)).toContain("DELETE /api/v1/me/token");
    expect(store.kept()).toBeUndefined();
    expect(at.written).toEqual([]);
    expect(at.runs).toEqual([]);

    // Nobody said anything in time: nothing is kept either.
    const late = consoleOf({
      "POST /api/v1/connect/claim": {
        status: 404,
        body: { error: { code: "connect.not_found", message: "No connection." } },
      },
    });
    const waited = harness({ fetch: late.fetch, machine: fakeMachine().machine });
    expect(await runCli(LINE, waited.io)).toBe(EXIT.failed);
    expect(waited.err()).toContain("Nobody said in time that this command is the account");

    // An address that is not the console's own is not opened: it is printed, for a person to judge.
    const elsewhere = consoleOf({
      "POST /api/v1/connect": {
        status: 201,
        body: { ...CONNECTION, code: "WXYZ-2345", url: "https://elsewhere.test/connect/WXYZ-2345" },
      },
    });
    const wary = fakeMachine();
    const shown = harness({ fetch: elsewhere.fetch, machine: wary.machine });
    expect(await runCli(LINE, shown.io)).toBe(EXIT.ok);
    expect(wary.opened).toEqual([]);
    expect(shown.out()).toContain(
      "Open https://elsewhere.test/connect/WXYZ-2345 in this machine's browser.",
    );
  });

  it("leaves a desk that is there, and writes over no file of one that is half there", async () => {
    // Signed in already, and a desk with the agent's own files: only the service is written.
    const { fetch, calls } = consoleOf();
    const at = fakeMachine({
      files: {
        "/Users/mira/desk/runner.json": '{"driver":"claude"}\n',
        "/Users/mira/desk/AGENTS.md": "# Mine\n",
      },
    });
    const run = harness({ fetch, machine: at.machine, store: memoryStore(KEPT).store });
    expect(await runCli(LINE, run.io)).toBe(EXIT.ok);
    expect(run.out()).toContain("This command is signed in as @mira here already.");
    expect(calls.map((call) => call.key)).not.toContain("POST /api/v1/connect");
    expect(at.opened).toEqual([]);
    expect(run.out()).toContain(
      "The desk at /Users/mira/desk is there already, and is left as it is.",
    );
    expect(at.files.get("/Users/mira/desk/AGENTS.md")).toBe("# Mine\n");
    expect(at.written.map((file) => file.path)).toEqual([UNIT]);

    // A place that holds one file of its own gets the rest, and keeps its own.
    const half = fakeMachine({ files: { "/srv/desks/mira/README.md": "# My own words\n" } });
    const filled = harness({
      fetch: consoleOf().fetch,
      machine: half.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli([...LINE, "--desk", "/srv/desks/mira"], filled.io)).toBe(EXIT.ok);
    expect(half.files.get("/srv/desks/mira/README.md")).toBe("# My own words\n");
    expect(filled.out()).toContain(
      "A new desk is written at /srv/desks/mira (AGENTS.md, CLAUDE.md, runner.json, .gitignore).",
    );
    expect(half.files.get(UNIT)).toContain("<string>/srv/desks/mira</string>");
  });

  it("clones the desk an account pushed before, with its own token and never on a command line", async () => {
    const pushed = {
      "GET /api/v1/agents/me/secrets": {
        body: { items: [{ name: "git.token", setAt: WHEN, seeded: false, expiresOn: null }] },
      },
      "GET /api/v1/agents/me/secrets/git.token": {
        body: {
          name: "git.token",
          setAt: WHEN,
          seeded: false,
          expiresOn: null,
          value: "not-a-real-token-51c2",
        },
      },
    };
    const at = fakeMachine();
    const run = harness({
      fetch: consoleOf(pushed).fetch,
      machine: at.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, run.io)).toBe(EXIT.ok);
    const [clone] = at.runs;
    expect([clone?.command, ...(clone?.args ?? [])]).toEqual([
      "git",
      "clone",
      "--quiet",
      "https://github.com/acme-mira/desk.git",
      "/Users/mira/desk",
    ]);
    // The token reaches git through the environment alone, and git asks nobody at a terminal.
    expect(clone?.env?.CONSOLE_DESK_TOKEN).toBe("not-a-real-token-51c2");
    expect(clone?.env?.GIT_TERMINAL_PROMPT).toBe("0");
    // The helper that answers with it is named for the remote's own origin, and no other host's.
    expect(clone?.env?.GIT_CONFIG_KEY_0).toBe("credential.https://github.com.helper");
    expect(clone?.env?.GIT_CONFIG_VALUE_0).toBe("");
    expect(clone?.env?.GIT_CONFIG_KEY_1).toBe("credential.https://github.com.helper");
    expect(clone?.env?.GIT_CONFIG_VALUE_1).toContain("$CONSOLE_DESK_TOKEN");
    expect(Object.keys(clone?.env ?? {})).not.toContain("credential.helper");
    expect(JSON.stringify(clone?.args)).not.toContain("not-a-real-token");
    expect(clone?.env?.GIT_CONFIG_VALUE_1).not.toContain("not-a-real-token");
    expect(run.out()).toContain(
      "The desk is cloned from https://github.com/acme-mira/desk.git into /Users/mira/desk.",
    );
    expect(run.out()).not.toContain("not-a-real-token");
    expect(at.written.map((file) => file.path)).toEqual([UNIT]);

    // A clone that fails stops the setup, and writes no desk in its place.
    const refused = fakeMachine({
      ran: (command, args) =>
        // git itself is there: it is the clone that the host refuses.
        command === "git" && args[0] === "clone"
          ? {
              code: 128,
              out: "",
              err: "remote: Repository not found.\nfatal: repository not found\n",
            }
          : undefined,
    });
    const stopped = harness({
      fetch: consoleOf(pushed).fetch,
      machine: refused.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, stopped.io)).toBe(EXIT.failed);
    expect(stopped.err()).toContain(
      "The desk could not be cloned from https://github.com/acme-mira/desk.git: fatal: repository not found.",
    );
    expect(stopped.err()).toContain("--new-desk");
    expect(stopped.err()).not.toContain("not-a-real-token");
    expect(refused.written).toEqual([]);

    // Told to begin a new one, it writes the template and asks git for nothing.
    const fresh = fakeMachine();
    const begun = harness({
      fetch: consoleOf(pushed).fetch,
      machine: fresh.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli([...LINE, "--new-desk"], begun.io)).toBe(EXIT.ok);
    expect(fresh.runs.map((ran) => ran.command)).toEqual(["launchctl", "launchctl"]);
    expect(fresh.files.has("/Users/mira/desk/AGENTS.md")).toBe(true);

    // A place that holds something else is cloned into by nobody.
    const taken = fakeMachine({ files: { "/Users/mira/desk/notes.txt": "mine\n" } });
    const kept = harness({
      fetch: consoleOf(pushed).fetch,
      machine: taken.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, kept.io)).toBe(EXIT.failed);
    expect(kept.err()).toContain("holds something that is no desk");
    expect(taken.runs).toEqual([]);
  });

  it("writes no service where the platform has none or when asked not to, and says when one was not loaded", async () => {
    const elsewhere = fakeMachine({ platform: "freebsd" });
    const run = harness({
      fetch: consoleOf().fetch,
      machine: elsewhere.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, run.io)).toBe(EXIT.ok);
    expect(run.out()).toContain(
      `No service keeps a runner running on freebsd yet. Start the runner yourself and keep it running: cd /Users/mira/desk && console runner --url ${ORIGIN} --account acme-mira`,
    );
    expect(elsewhere.runs).toEqual([]);
    expect(elsewhere.files.has(UNIT)).toBe(false);
    expect(elsewhere.files.has("/Users/mira/desk/runner.json")).toBe(true);

    const asked = fakeMachine();
    const without = harness({
      fetch: consoleOf().fetch,
      machine: asked.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli([...LINE, "--no-service"], without.io)).toBe(EXIT.ok);
    expect(without.out()).toContain("No service is written, as asked.");
    expect(asked.files.has(UNIT)).toBe(false);
    expect(asked.runs).toEqual([]);

    // A login a shell would read as more than a word is quoted in the line a person runs, as
    // is a desk with a space in its name: on Windows as PowerShell takes one.
    const odd = { ...MIRA, person: { ...MIRA.person, login: "mi;ra$(id)@acme.example" } };
    const quoted = fakeMachine();
    const posix = harness({
      fetch: consoleOf({ "GET /api/v1/me": { body: odd } }).fetch,
      machine: quoted.machine,
      store: memoryStore(KEPT).store,
    });
    expect(
      await runCli([...LINE, "--no-service", "--desk", "/Users/mira/the desk"], posix.io),
    ).toBe(EXIT.ok);
    expect(posix.out()).toContain(
      `cd '/Users/mira/the desk' && console runner --url ${ORIGIN} --account 'mi;ra$(id)@acme.example'\n`,
    );
    const windows = harness({
      fetch: consoleOf({
        "GET /api/v1/me": {
          body: { ...odd, person: { ...odd.person, login: "o'mira@acme.example" } },
        },
      }).fetch,
      machine: fakeMachine({ platform: "win32" }).machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli([...LINE, "--no-service"], windows.io)).toBe(EXIT.ok);
    expect(windows.out()).toContain("--account 'o''mira@acme.example'\n");
    // The line's two commands are joined as the PowerShell every Windows has joins them: `&&`
    // is no line there before PowerShell 7.
    expect(windows.out()).toMatch(/: cd \S+; console runner --url /);
    expect(windows.out()).not.toContain("&& console runner");

    // The unit is written and the system would not load it: its own words, and what to look at.
    const unloaded = fakeMachine({
      ran: (_, args) =>
        args[0] === "bootstrap"
          ? { code: 5, out: "", err: "Bootstrap failed: 5: Input/output error\n" }
          : args[0] === "bootout"
            ? { code: 3, out: "", err: "Boot-out failed: 3: No such process\n" }
            : undefined,
    });
    const failed = harness({
      fetch: consoleOf().fetch,
      machine: unloaded.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, failed.io)).toBe(EXIT.failed);
    expect(failed.err()).toContain("was not loaded: launchctl bootstrap gui/502");
    expect(failed.err()).toContain("Bootstrap failed: 5: Input/output error.");
    expect(failed.err()).toContain("log in at the machine as that account");
    expect(unloaded.files.has(UNIT)).toBe(true);

    // A runner that says nothing in the while the command looks is said so, with where its lines are.
    const quiet = harness({
      fetch: consoleOf({ "GET /api/v1/agents/mira": { body: AGENT } }).fetch,
      machine: fakeMachine().machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, quiet.io)).toBe(EXIT.ok);
    expect(quiet.out()).toContain(
      "The runner is not heard from yet. Its own lines are in /Users/mira/Library/Logs/ai.skillcdn.console.runner.log",
    );
  });

  it("writes the service of the platform the machine is: a unit of the account's own systemd on Linux", async () => {
    const at = fakeMachine({ platform: "linux" });
    const run = harness({
      fetch: consoleOf().fetch,
      machine: at.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, run.io)).toBe(EXIT.ok);
    const unit = "/Users/mira/.config/systemd/user/skillcdn-console-runner.service";
    expect(at.files.get(unit)).toContain(
      `ExecStart="/usr/local/bin/node" "/opt/console/dist/cli/main.js" "runner" "--url" "${ORIGIN}" "--account" "acme-mira"`,
    );
    expect(at.files.get(unit)).toContain("WorkingDirectory=/Users/mira/desk");
    expect(at.files.has(UNIT)).toBe(false);
    // Lingering is asked for the account itself first, and its own systemd reached through the
    // folder the system keeps for it, which a shell entered from another account is not told of.
    const own = { XDG_RUNTIME_DIR: "/run/user/502" };
    expect(at.runs.map((ran) => [ran.command, ...ran.args, ran.env])).toEqual([
      ["loginctl", "enable-linger", "502", undefined],
      ["systemctl", "--user", "daemon-reload", own],
      ["systemctl", "--user", "enable", "skillcdn-console-runner.service", own],
      ["systemctl", "--user", "restart", "skillcdn-console-runner.service", own],
    ]);
    expect(run.out()).toContain(`The systemd-user service is written (${unit}) and loaded`);
    expect(run.out()).toContain("journalctl --user -u skillcdn-console-runner.service");
    expect(run.out()).not.toContain("Lingering was not turned on");

    // A system that keeps lingering for an administrator: the service is loaded all the same,
    // and the words say what is left to do and who does it.
    const kept = fakeMachine({
      platform: "linux",
      ran: (command) =>
        command === "loginctl"
          ? { code: 1, out: "", err: "Could not enable linger: Access denied\n" }
          : undefined,
    });
    const told = harness({
      fetch: consoleOf().fetch,
      machine: kept.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, told.io)).toBe(EXIT.ok);
    expect(told.out()).toContain(`The systemd-user service is written (${unit}) and loaded`);
    expect(told.out()).toContain(
      "Lingering was not turned on for this OS account, so the runner runs while the account has a session and no longer, and does not start with the machine: have an administrator run loginctl enable-linger 502.",
    );

    // The account's systemd is started by the lingering just asked for, and is there a moment
    // after the system answered: the first command to it is tried until it is.
    let reloads = 0;
    const starting = fakeMachine({
      platform: "linux",
      ran: (command, args) => {
        if (command === "systemctl" && args.includes("daemon-reload")) {
          reloads += 1;
          return reloads < 3
            ? { code: 1, out: "", err: "Failed to connect to bus: No such file or directory\n" }
            : undefined;
        }
        return undefined;
      },
    });
    const waited = harness({
      fetch: consoleOf().fetch,
      machine: starting.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, waited.io)).toBe(EXIT.ok);
    expect(starting.runs.map((ran) => ran.args.at(-1))).toEqual([
      "502",
      "daemon-reload",
      "daemon-reload",
      "daemon-reload",
      "skillcdn-console-runner.service",
      "skillcdn-console-runner.service",
    ]);

    // An account with no session and no lingering, so no systemd of its own: the unit stays
    // written, and the words say what to do.
    const sessionless = fakeMachine({
      platform: "linux",
      // The machine has what a setup looks for: it is the account's own systemd that is not there.
      ran: (command) =>
        command === "loginctl" || command === "systemctl"
          ? { code: 1, out: "", err: "Failed to connect to bus: No medium found\n" }
          : undefined,
    });
    const failed = harness({
      fetch: consoleOf().fetch,
      machine: sessionless.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, failed.io)).toBe(EXIT.failed);
    expect(failed.err()).toContain("Failed to connect to bus: No medium found.");
    expect(failed.err()).toContain("loginctl enable-linger");
    expect(sessionless.files.has(unit)).toBe(true);
    // Lingering once, then the first command to the account's systemd as often as it is tried.
    expect(sessionless.runs).toHaveLength(11);
  });

  it("writes the service of the platform the machine is: a task of the account's own on Windows", async () => {
    const back = String.fromCodePoint(0x5c);
    const folder = ["/Users/mira", "AppData", "Local", "skillcdn-console"].join(back);
    const definition = `${folder}${back}runner-task.xml`;
    const name = "SkillCDN Console Runner (mira)";
    const at = fakeMachine({ platform: "win32" });
    const run = harness({
      fetch: consoleOf().fetch,
      machine: at.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, run.io)).toBe(EXIT.ok);
    // The task is the account's, named by it: started when it logs on, with the runner's own words.
    expect(at.files.get(definition)).toContain("<UserId>mira</UserId>");
    expect(at.files.get(definition)).toContain(
      `$words = @('/opt/console/dist/cli/main.js', 'runner', '--url', '${ORIGIN}', '--account', 'acme-mira')`,
    );
    expect(at.files.get(definition)).toContain("Set-Location -LiteralPath '/Users/mira/desk'");
    expect(at.files.has(UNIT)).toBe(false);
    // Registered in place of the one that was there, the one that runs ended, and started now.
    expect(at.runs.map((ran) => [ran.command, ...ran.args])).toEqual([
      ["schtasks", "/Create", "/TN", name, "/XML", definition, "/F"],
      ["schtasks", "/End", "/TN", name],
      ["schtasks", "/Run", "/TN", name],
    ]);
    expect(run.out()).toContain(
      `The task-scheduler service is written (${definition}) and loaded: the runner starts with the OS account mira, and is started again when it ends. Its own lines are in ${folder}${back}runner.log.`,
    );

    // A machine that lets no account register a task: the definition stays written, and the
    // words say what the system said and what to look at.
    const closed = fakeMachine({
      platform: "win32",
      ran: (_, args) =>
        args[0] === "/Create" ? { code: 1, out: "", err: "ERROR: Access is denied.\n" } : undefined,
    });
    const refused = harness({
      fetch: consoleOf().fetch,
      machine: closed.machine,
      store: memoryStore(KEPT).store,
    });
    expect(await runCli(LINE, refused.io)).toBe(EXIT.failed);
    expect(refused.err()).toContain("was not loaded: schtasks /Create /TN");
    expect(refused.err()).toContain(
      "said: ERROR: Access is denied.. A scheduled task is registered",
    );
    expect(closed.files.has(definition)).toBe(true);
    expect(closed.runs).toHaveLength(1);

    // A refresh that wrote the definition again registers it, which ends nothing: the runner
    // this command may be running under goes on, and the next start is with what was written.
    const env = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_a_kept" };
    const moved = fakeMachine({
      platform: "win32",
      cwd: "/Users/mira/desk",
      files: { ...Object.fromEntries(at.files), [definition]: "<Task/>" },
    });
    const rewritten = harness({ fetch: consoleOf().fetch, env, machine: moved.machine });
    expect(await runCli(["agent", "setup", "--refresh"], rewritten.io)).toBe(EXIT.ok);
    expect(rewritten.out()).toContain(
      `The task-scheduler service is written again (${definition}). It is read when the task is next started: when the OS account next logs on, or once the task is ended and run again.\n`,
    );
    expect(moved.files.get(definition)).toBe(at.files.get(definition));
    expect(moved.runs.map((ran) => [ran.command, ...ran.args])).toEqual([
      ["schtasks", "/Create", "/TN", name, "/XML", definition, "/F"],
    ]);
  });

  it("has the system read a unit a refresh wrote again, where that ends nothing: on Linux", async () => {
    const env = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_a_kept" };
    const unit = "/Users/mira/.config/systemd/user/skillcdn-console-runner.service";
    const first = fakeMachine({ platform: "linux" });
    await runCli(
      LINE,
      harness({ fetch: consoleOf().fetch, machine: first.machine, store: memoryStore(KEPT).store })
        .io,
    );
    // As setup wrote it: nothing is written and nothing is run.
    const same = fakeMachine({
      platform: "linux",
      cwd: "/Users/mira/desk",
      files: Object.fromEntries(first.files),
    });
    const again = harness({ fetch: consoleOf().fetch, env, machine: same.machine });
    expect(await runCli(["agent", "setup", "--refresh"], again.io)).toBe(EXIT.ok);
    expect(again.out()).toContain(`The systemd-user service is as it was (${unit}).`);
    expect(same.runs).toEqual([]);

    // A unit that says something else is written again, and the account's systemd told to read
    // it: the runner this command may be running under goes on, and starts with it next time.
    const moved = fakeMachine({
      platform: "linux",
      cwd: "/Users/mira/desk",
      files: { ...Object.fromEntries(first.files), [unit]: "[Unit]\nDescription=An older one\n" },
    });
    const rewritten = harness({ fetch: consoleOf().fetch, env, machine: moved.machine });
    expect(await runCli(["agent", "setup", "--refresh"], rewritten.io)).toBe(EXIT.ok);
    expect(rewritten.out()).toContain(
      `The systemd-user service is written again (${unit}). It is read when the service is next started.\n`,
    );
    expect(moved.files.get(unit)).toBe(first.files.get(unit));
    expect(moved.runs.map((ran) => [ran.command, ...ran.args, ran.env])).toEqual([
      ["systemctl", "--user", "daemon-reload", { XDG_RUNTIME_DIR: "/run/user/502" }],
    ]);

    // Where the system could not be told, the words say what is left to run.
    const deaf = fakeMachine({
      platform: "linux",
      cwd: "/Users/mira/desk",
      files: { ...Object.fromEntries(first.files), [unit]: "[Unit]\nDescription=An older one\n" },
      ran: () => ({ code: 1, out: "", err: "Failed to connect to bus: No medium found\n" }),
    });
    const untold = harness({ fetch: consoleOf().fetch, env, machine: deaf.machine });
    expect(await runCli(["agent", "setup", "--refresh"], untold.io)).toBe(EXIT.ok);
    expect(untold.out()).toContain(
      "It is read when the service is next started. Run this first, which did not succeed here: systemctl --user daemon-reload.",
    );
  });

  it("derives a machine again with --refresh, for the account's own command, and unloads nothing", async () => {
    const env = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_a_kept" };
    // In the desk, with the unit as setup wrote it: nothing changes, and the services are said.
    const first = fakeMachine();
    await runCli(
      LINE,
      harness({ fetch: consoleOf().fetch, machine: first.machine, store: memoryStore(KEPT).store })
        .io,
    );
    const same = fakeMachine({ cwd: "/Users/mira/desk", files: Object.fromEntries(first.files) });
    const { fetch, calls } = consoleOf();
    const again = harness({ fetch, env, machine: same.machine });
    expect(await runCli(["agent", "setup", "--refresh"], again.io)).toBe(EXIT.ok);
    expect(again.out()).toContain("The desk at /Users/mira/desk is there already");
    expect(again.out()).toContain(`The launchd service is as it was (${UNIT}).`);
    expect(again.out()).toContain(
      "The services Acme names now, with what @mira is called at each:\n  git: GitHub, as acme-mira\n",
    );
    expect(same.written).toEqual([]);
    expect(same.runs).toEqual([]);
    expect(calls.map((call) => call.key)).not.toContain("GET /api/v1/setup/ABCD-EFGH");

    // A unit that says something else is written again, and read when the service is next
    // loaded: the runner this command may be running under is never unloaded.
    const moved = fakeMachine({
      cwd: "/Users/mira/desk",
      files: { ...Object.fromEntries(first.files), [UNIT]: "<plist>an older one</plist>\n" },
    });
    const rewritten = harness({ fetch: consoleOf().fetch, env, machine: moved.machine });
    expect(await runCli(["agent", "setup", "--refresh"], rewritten.io)).toBe(EXIT.ok);
    expect(rewritten.out()).toContain(
      `The launchd service is written again (${UNIT}). It is read when the OS account next logs in, or the machine starts again.`,
    );
    expect(moved.files.get(UNIT)).toBe(first.files.get(UNIT));
    expect(moved.runs).toEqual([]);

    // Nobody but the account's own command refreshes a machine.
    const person = harness({
      fetch: consoleOf({ "GET /api/v1/me": { body: ME } }).fetch,
      env,
      machine: fakeMachine().machine,
    });
    expect(await runCli(["agent", "setup", "--refresh"], person.io)).toBe(EXIT.failed);
    expect(person.err()).toContain("A machine is refreshed by the agent account's own command");
  });
});

describe("a person's desk on the command line (ADR-0115)", () => {
  const ALICE = { ...ME, person: { ...PERSON, login: "alice@acme.example", name: "Alice Kim" } };
  // The least (ADR-0122): no form of a thing to keep, and nothing under records/, web/ or work/.
  const FILES = ["README.md", "AGENTS.md", "CLAUDE.md", ".gitignore"];
  const SENTENCE =
    'Set this desk up as a repository of mine, with the skill for it in the organization\'s pack where it has one: console skills --search "desk setup" --limit 5';
  const WITH_PAGES =
    'Set this desk up as a repository of mine and bring its pages up, with the skill for it in the organization\'s pack where it has one: console skills --search "desk setup" --limit 5';
  /** Where the command's own skills are, as an installed package has them. */
  const SKILLS = "/usr/lib/node_modules/@skillcdn/console/skills/";
  const SHAPE =
    "Ask me what I want to keep and to see here, and shape the desk to it, as the skill keeping-a-desk says, shipped with the console command";
  /** What is next, as the command says it last: the two things in order, the second with the skill's place. */
  const NEXT = (first: string, place = `: ${SKILLS}keeping-a-desk/SKILL.md`) => [
    "Next, in that folder, say these to your agent in order; an agent that ran this command goes on with them there:",
    "",
    `1. ${first}`,
    `2. ${SHAPE}${place}`,
    "",
  ];
  /** The shell of a desk's pages as a package would carry it: the two words the command fills in, and a folder. */
  const SHELL = new Map([
    ["README.md", "# __TITLE__\n\nBuilt on @skillcdn/console __VERSION__.\n"],
    ["package.json", '{ "dependencies": { "@skillcdn/console": "__VERSION__" } }\n'],
    ["index.html", "<title>__TITLE__</title>\n"],
    ["src/main.tsx", 'export const title = "__TITLE__";\n'],
  ]);

  /** The files of a machine in memory, with the directory the command is run in. */
  function fakeFiles(cwd: string, initial: Readonly<Record<string, string>> = {}) {
    const files = new Map(Object.entries(initial));
    const written: { path: string; mode: number }[] = [];
    const under = (path: string) => [...files.keys()].some((file) => file.startsWith(`${path}/`));
    const machine: SetupMachine = {
      platform: "linux",
      user: "alice",
      home: "/home/alice",
      uid: 1000,
      self: undefined,
      searchPath: undefined,
      path: (...parts) => {
        const [first = "", ...rest] = parts;
        const base = first === "." ? cwd : first.startsWith("/") ? first : `${cwd}/${first}`;
        return [base, ...rest].join("/");
      },
      exists: async (path) => files.has(path) || under(path),
      read: async (path) => files.get(path),
      holds: async (path) => under(path),
      write: async (path, text, mode) => {
        files.set(path, text);
        written.push({ path, mode });
      },
      run: async () => {
        throw new Error("a desk runs nothing");
      },
      open: async () => {
        throw new Error("a desk opens nothing");
      },
    };
    return { machine, files, written };
  }

  const consoleFor = (me: unknown) => fakeConsole({ "GET /api/v1/me": { body: me } });
  const signedIn = () => memoryStore(one(ORIGIN, "cns_a_token", "alice@acme.example")).store;

  it("writes the desk's files into desk here, as an agent account's is called, asks the console who it is and nothing else, and ends with the sentence for the agent", async () => {
    const { fetch, calls } = consoleFor(ALICE);
    const at = fakeFiles("/work");
    const run = harness({ fetch, store: signedIn(), machine: at.machine, skillsDir: SKILLS });
    expect(await runCli(["desk"], run.io)).toBe(EXIT.ok);
    expect(calls.map((call) => call.key)).toEqual(["GET /api/v1/me"]);
    expect(at.written).toEqual(FILES.map((name) => ({ path: `/work/desk/${name}`, mode: 0o644 })));
    // What it writes is the package's template for the person the command is signed in as.
    const instructions = at.files.get("/work/desk/AGENTS.md") ?? "";
    expect(instructions).toContain(
      "I am Alice Kim (`alice@acme.example`), a member of Acme (https://console.test).",
    );
    expect(instructions).toContain("This desk is bound to no project");
    expect(at.files.get("/work/desk/CLAUDE.md")).toBe("@AGENTS.md\n");
    expect([...at.files.keys()].some((path) => path.endsWith("runner.json"))).toBe(false);
    expect(run.out()).toBe(
      [
        "A new desk is written at /work/desk (README.md, AGENTS.md, CLAUDE.md, .gitignore), for alice@acme.example. It is yours from now on: to edit, and to make a repository of.",
        ...NEXT(SENTENCE),
      ].join("\n"),
    );
    expect(run.err()).toBe("");
    // Nothing is written under the three places: each is there once it is used.
    expect(
      [...at.files.keys()].filter((path) => /^\/work\/desk\/(records|web|work)\//.test(path)),
    ).toEqual([]);
    // A person the provider gave no name is called by their login, and the folder by what
    // stands before an @.
    const plain = fakeFiles("/work");
    const unnamed = harness({
      fetch: consoleFor(ME).fetch,
      store: signedIn(),
      machine: plain.machine,
    });
    expect(await runCli(["desk"], unnamed.io)).toBe(EXIT.ok);
    expect(plain.files.get("/work/desk/AGENTS.md")).toContain("I am alice (`alice`)");
    // The desk says which language to write to them in, from what the console knows: the
    // person's own, else the workspace's, and nothing where neither is known.
    expect(plain.files.get("/work/desk/AGENTS.md")).not.toContain("Write to me in");
    const korean = fakeFiles("/work");
    const own = harness({
      fetch: consoleFor({ ...ALICE, language: "ko" }).fetch,
      store: signedIn(),
      machine: korean.machine,
    });
    expect(await runCli(["desk"], own.io)).toBe(EXIT.ok);
    expect(korean.files.get("/work/desk/AGENTS.md")).toContain("Write to me in Korean.");
    const japanese = fakeFiles("/work");
    const fromWorkspace = harness({
      fetch: consoleFor({ ...ALICE, workspace: { ...ME.workspace, language: "ja" } }).fetch,
      store: signedIn(),
      machine: japanese.machine,
    });
    expect(await runCli(["desk"], fromWorkspace.io)).toBe(EXIT.ok);
    expect(japanese.files.get("/work/desk/AGENTS.md")).toContain("Write to me in Japanese.");
  });

  it("writes into the directory named, this one as a full stop, and takes at most one", async () => {
    const here = fakeFiles("/work/mine");
    const dot = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: here.machine,
    });
    expect(await runCli(["desk", "."], dot.io)).toBe(EXIT.ok);
    expect(here.written.map((file) => file.path)).toEqual(
      FILES.map((name) => `/work/mine/${name}`),
    );
    expect(dot.out()).toContain("A new desk is written at /work/mine (");

    const there = fakeFiles("/work");
    const named = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: there.machine,
    });
    expect(await runCli(["desk", "/srv/desks/alice"], named.io)).toBe(EXIT.ok);
    expect(there.written.map((file) => file.path)).toEqual(
      FILES.map((name) => `/srv/desks/alice/${name}`),
    );

    const two = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: there.machine,
    });
    expect(await runCli(["desk", "one", "two"], two.io)).toBe(EXIT.usage);
    expect(two.err()).toContain("Say at most one directory: console desk [<directory>] [--web]");
  });

  it("writes over no file that is there, and says which it wrote and which it left", async () => {
    const half = fakeFiles("/work", {
      "/work/desk/AGENTS.md": "# My own words\n",
      "/work/desk/notes/today.md": "mine\n",
    });
    const run = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: half.machine,
    });
    expect(await runCli(["desk"], run.io)).toBe(EXIT.ok);
    expect(half.files.get("/work/desk/AGENTS.md")).toBe("# My own words\n");
    expect(half.written.map((file) => file.path)).toEqual(
      ["README.md", "CLAUDE.md", ".gitignore"].map((name) => `/work/desk/${name}`),
    );
    expect(run.out()).toContain(
      "The desk at /work/desk gains README.md, CLAUDE.md, .gitignore; AGENTS.md was there and is left as it is.",
    );
    // A second run finds everything there, changes nothing, and still says what comes next.
    const again = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: half.machine,
    });
    const before = half.written.length;
    expect(await runCli(["desk"], again.io)).toBe(EXIT.ok);
    expect(half.written).toHaveLength(before);
    expect(again.out()).toBe(
      [
        "The desk at /work/desk is there already, and is left as it is.",
        // A command with no skills beside it says where their place is asked.
        ...NEXT(SENTENCE, " (console skills says where it is)"),
      ].join("\n"),
    );
    // The shell asked for in a desk that is there: its member is shaping the desk already, so
    // nothing is next. A fresh run was sent back to the repository's setup in the middle of
    // building its page by the two lines printed again.
    const pages = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: half.machine,
      version: "0.5.1",
      deskWebTemplate: async () => SHELL,
    });
    expect(await runCli(["desk", "desk", "--web"], pages.io)).toBe(EXIT.ok);
    expect(pages.out()).toContain("The shell of its pages is written in /work/desk/web");
    expect(pages.out()).not.toContain("Next, in that folder");
    expect(pages.out()).not.toContain("Set this desk up as a repository");
  });

  it("writes none of a desk's own files for an agent account, whose desk is setup's, and the shell of its pages into the desk it names (ADR-0122)", async () => {
    const mira = {
      ...ME,
      person: { ...PERSON, login: "acme-mira", name: "Mira", kind: "agent", handle: "mira" },
      agent: null,
      session: { kind: "command", name: "console as mira on mac-mini" },
    };
    const at = fakeFiles("/home/mira");
    const run = harness({ fetch: consoleFor(mira).fetch, store: signedIn(), machine: at.machine });
    expect(await runCli(["desk"], run.io)).toBe(EXIT.failed);
    expect(run.err()).toContain(
      "@mira (acme-mira, member) is an agent account: its desk is settled by console agent setup, on its own machine, and nothing is written here. In that desk, console agent setup --refresh derives it again, and console desk . --web writes the shell of its pages.",
    );
    expect(at.written).toEqual([]);
    expect(run.out()).toBe("");

    // In its desk, with --web: the shell alone, titled by the account's name, and nothing of
    // the desk's own files, which are setup's and the agent's.
    const KEPT = {
      "/home/mira/desk/AGENTS.md": "# My own words\n",
      "/home/mira/desk/runner.json": "{}\n",
    };
    const desk = fakeFiles("/home/mira/desk", KEPT);
    const web = harness({
      fetch: consoleFor(mira).fetch,
      store: signedIn(),
      machine: desk.machine,
      version: "0.5.1",
      deskWebTemplate: async () => SHELL,
      skillsDir: SKILLS,
    });
    expect(await runCli(["desk", ".", "--web"], web.io)).toBe(EXIT.ok);
    expect(desk.written.map((file) => file.path)).toEqual(
      ["README.md", "package.json", "index.html", "src/main.tsx"].map(
        (name) => `/home/mira/desk/web/${name}`,
      ),
    );
    expect(desk.files.get("/home/mira/desk/web/index.html")).toBe(
      `<title>Mira${String.fromCodePoint(0x2019)}s desk</title>\n`,
    );
    expect(desk.files.get("/home/mira/desk/AGENTS.md")).toBe("# My own words\n");
    expect(desk.files.has("/home/mira/desk/README.md")).toBe(false);
    // Nothing is next: an agent account that asked for the shell is shaping its desk already.
    expect(web.out()).toBe(
      "The shell of its pages is written in /home/mira/desk/web (README.md, package.json, index.html, src/main.tsx), on @skillcdn/console 0.5.1: one empty page of your own until you say what you want to see, served from this machine by console serve once it is built; its README.md says how.\n",
    );
    const json = harness({
      fetch: consoleFor(mira).fetch,
      store: signedIn(),
      machine: fakeFiles("/home/mira/desk", KEPT).machine,
      version: "0.5.1",
      deskWebTemplate: async () => SHELL,
    });
    expect(await runCli(["desk", ".", "--web", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toEqual({
      directory: "/home/mira/desk",
      written: [],
      kept: [],
      web: {
        directory: "/home/mira/desk/web",
        written: ["README.md", "package.json", "index.html", "src/main.tsx"],
        version: "0.5.1",
      },
      next: [],
    });
    // A web/ that holds something is the agent's, and is left as it is.
    const held = fakeFiles("/home/mira/desk", {
      ...KEPT,
      "/home/mira/desk/web/package.json": "{}\n",
    });
    const again = harness({
      fetch: consoleFor(mira).fetch,
      store: signedIn(),
      machine: held.machine,
      version: "0.5.1",
      deskWebTemplate: async () => SHELL,
    });
    expect(await runCli(["desk", ".", "--web"], again.io)).toBe(EXIT.ok);
    expect(held.written).toEqual([]);
    expect(again.out()).toBe(
      "/home/mira/desk/web holds something already, and is left as it is.\n",
    );

    // A directory that is no desk gets nothing: not the folder a person's desk is made in by
    // default, and not a directory named.
    for (const line of [
      ["desk", "--web"],
      ["desk", "/srv/elsewhere", "--web"],
    ]) {
      const none = fakeFiles("/home/mira/desk", KEPT);
      const refused = harness({
        fetch: consoleFor(mira).fetch,
        store: signedIn(),
        machine: none.machine,
        version: "0.5.1",
        deskWebTemplate: async () => SHELL,
      });
      expect(await runCli(line, refused.io)).toBe(EXIT.failed);
      expect(refused.err()).toContain(
        "holds no AGENTS.md, so it is no desk, and nothing is written. An agent account's desk is settled by console agent setup; in it: console desk . --web",
      );
      expect(none.written).toEqual([]);
      expect(refused.out()).toBe("");
    }
    // A package with no shell says so, and nothing of a desk that would be written without it.
    const bare = harness({
      fetch: consoleFor(mira).fetch,
      store: signedIn(),
      machine: fakeFiles("/home/mira/desk", KEPT).machine,
      version: "0.5.1",
    });
    expect(await runCli(["desk", ".", "--web"], bare.io)).toBe(EXIT.failed);
    expect(bare.err()).toContain(
      "carries no shell of a desk's pages (template/desk-web): nothing is written.",
    );
    expect(bare.err()).not.toContain("the desk alone is written");
  });

  it("makes no desk inside a directory that works in a project, which the desk would work in too", async () => {
    const at = fakeFiles("/work/app");
    const bound = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: at.machine,
      directory: memoryDirectory({ project: "web" }).store,
    });
    expect(await runCli(["desk"], bound.io)).toBe(EXIT.failed);
    expect(bound.err()).toContain(
      "This directory works in the project web (.skillcdn-console.json here or in a directory above), and a desk made inside it would work there too.",
    );
    expect(at.written).toEqual([]);
    // A directory named in full is elsewhere, and is the person's to choose.
    const elsewhere = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: at.machine,
      directory: memoryDirectory({ project: "web" }).store,
    });
    expect(await runCli(["desk", "/home/alice/desk"], elsewhere.io)).toBe(EXIT.ok);
    expect(at.written).toHaveLength(FILES.length);
  });

  it("writes the shell of the desk's pages into web/ with --web, the version and the title filled in", async () => {
    const at = fakeFiles("/work");
    const run = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: at.machine,
      version: "0.5.1",
      deskWebTemplate: async () => SHELL,
      skillsDir: SKILLS,
    });
    expect(await runCli(["desk", "--web"], run.io)).toBe(EXIT.ok);
    const title = `Alice Kim${String.fromCodePoint(0x2019)}s desk`;
    expect(at.files.get("/work/desk/web/package.json")).toBe(
      '{ "dependencies": { "@skillcdn/console": "0.5.1" } }\n',
    );
    expect(at.files.get("/work/desk/web/index.html")).toBe(`<title>${title}</title>\n`);
    expect(at.files.get("/work/desk/web/src/main.tsx")).toBe(`export const title = "${title}";\n`);
    expect(at.files.get("/work/desk/web/README.md")).toContain("@skillcdn/console 0.5.1");
    expect(at.written.every((file) => file.mode === 0o644)).toBe(true);
    expect(run.out()).toBe(
      [
        "A new desk is written at /work/desk (README.md, AGENTS.md, CLAUDE.md, .gitignore), for alice@acme.example. It is yours from now on: to edit, and to make a repository of.",
        // The pages are one empty page of the person's own (ADR-0122), and the command says so.
        "The shell of its pages is written in /work/desk/web (README.md, package.json, index.html, src/main.tsx), on @skillcdn/console 0.5.1: one empty page of your own until you say what you want to see, served from this machine by console serve once it is built; its README.md says how.",
        ...NEXT(WITH_PAGES),
      ].join("\n"),
    );

    // A web/ that holds something is the person's: left as it is, and the sentence still asks for the pages.
    const held = fakeFiles("/work", { "/work/desk/web/package.json": "{}\n" });
    const kept = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: held.machine,
      version: "0.5.1",
      deskWebTemplate: async () => SHELL,
    });
    expect(await runCli(["desk", "--web"], kept.io)).toBe(EXIT.ok);
    expect(held.files.get("/work/desk/web/package.json")).toBe("{}\n");
    expect(held.written.some((file) => file.path.includes("/web/"))).toBe(false);
    expect(kept.out()).toContain("/work/desk/web holds something already, and is left as it is.");
    expect(kept.out()).toContain("and bring its pages up");

    // --json says what was written and the sentence, for a script.
    const json = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: fakeFiles("/work").machine,
      version: "0.5.1",
      deskWebTemplate: async () => SHELL,
      skillsDir: SKILLS,
    });
    expect(await runCli(["desk", "--web", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toEqual({
      directory: "/work/desk",
      written: FILES,
      kept: [],
      web: {
        directory: "/work/desk/web",
        written: ["README.md", "package.json", "index.html", "src/main.tsx"],
        version: "0.5.1",
      },
      next: [WITH_PAGES, `${SHAPE}: ${SKILLS}keeping-a-desk/SKILL.md`],
    });
  });

  it("writes nothing at all with --web where the package carries no shell, or the command does not know its version", async () => {
    for (const io of [
      { version: "0.5.1" },
      { version: "0.5.1", deskWebTemplate: async () => undefined },
      { version: "0.5.1", deskWebTemplate: async () => new Map<string, string>() },
    ]) {
      const at = fakeFiles("/work");
      const run = harness({
        fetch: consoleFor(ALICE).fetch,
        store: signedIn(),
        machine: at.machine,
        ...io,
      });
      expect(await runCli(["desk", "--web"], run.io)).toBe(EXIT.failed);
      expect(run.err()).toContain(
        "This command's package carries no shell of a desk's pages (template/desk-web): nothing is written. Without --web, the desk alone is written.",
      );
      expect(at.written).toEqual([]);
      expect(run.out()).toBe("");
    }
    const at = fakeFiles("/work");
    const unversioned = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: at.machine,
      deskWebTemplate: async () => SHELL,
    });
    expect(await runCli(["desk", "--web"], unversioned.io)).toBe(EXIT.failed);
    expect(unversioned.err()).toContain("This command does not know its version");
    expect(at.written).toEqual([]);
    // A path of the template that would leave web/ is written nowhere.
    const sly = fakeFiles("/work");
    const guarded = harness({
      fetch: consoleFor(ALICE).fetch,
      store: signedIn(),
      machine: sly.machine,
      version: "0.5.1",
      deskWebTemplate: async () =>
        new Map([
          ["../AGENTS.md", "mine now\n"],
          ["index.html", "ok\n"],
        ]),
    });
    expect(await runCli(["desk", "--web"], guarded.io)).toBe(EXIT.ok);
    expect(sly.files.get("/work/desk/AGENTS.md")).toContain("# AGENTS.md");
    expect([...sly.files.keys()].filter((path) => path.includes("/web/"))).toEqual([
      "/work/desk/web/index.html",
    ]);
  });

  it("says itself in full in its own help, and stays off the map, as what a person runs for themselves does", async () => {
    const { fetch } = fakeConsole({});
    const own = harness({ fetch });
    expect(await runCli(["help", "desk"], own.io)).toBe(EXIT.ok);
    expect(own.out()).toContain("console desk [<directory>] [--web]");
    expect(own.out()).toContain("A desk is bound to no project");
    expect(own.out()).toContain(
      "An agent account's desk is settled by console agent setup; in that desk, desk . --web writes the shell of its pages and nothing else.",
    );
    // What it writes is the least, and what a desk keeps is its member's to say (ADR-0122).
    expect(own.out()).toContain(
      "It writes the least: README.md; AGENTS.md, the instructions of an agent that works for you there; CLAUDE.md, which points a product to them; and .gitignore.",
    );
    expect(own.out()).not.toContain("records/README.md");
    // The skill that shapes a desk is named with its place, as whoami names the board's.
    expect(own.out()).toContain(
      "How a desk is shaped to what its member asks to keep and to see is the skill keeping-a-desk, shipped with this command (console skills says where it is).\n",
    );
    const placed = harness({
      fetch,
      skillsDir: "C:\\npm\\node_modules\\@skillcdn\\console\\skills\\",
    });
    expect(await runCli(["help", "desk"], placed.io)).toBe(EXIT.ok);
    expect(placed.out()).toContain(
      "is the skill keeping-a-desk, shipped with this command: C:\\npm\\node_modules\\@skillcdn\\console\\skills\\keeping-a-desk\\SKILL.md\n",
    );
    // No other command's help names a skill of its own.
    const other = harness({ fetch, skillsDir: SKILLS });
    expect(await runCli(["help", "serve"], other.io)).toBe(EXIT.ok);
    expect(other.out()).not.toContain("shipped with this command");
    const map = harness({ fetch });
    expect(await runCli([], map.io)).toBe(EXIT.ok);
    expect(map.out()).not.toContain("console desk");
  });
});

describe("the check of a desk's records on the command line (ADR-0117)", () => {
  /** The records of a desk in memory, as the command is handed them: JSON as what it holds, any other file as its bytes. */
  function recordsOf(files: Readonly<Record<string, unknown>>, pointers: readonly string[] = []) {
    const text = (value: unknown): string =>
      typeof value === "string" ? value : JSON.stringify(value);
    const asked: string[] = [];
    const recordsAt: NonNullable<CliIo["recordsAt"]> = (directory) => {
      asked.push(directory);
      return {
        directory: directory === "." ? "/work/desk" : directory,
        files: {
          read: async (path) =>
            path in files && typeof files[path] !== "number" ? text(files[path]) : undefined,
          size: async (path) =>
            !(path in files)
              ? undefined
              : typeof files[path] === "number"
                ? (files[path] as number)
                : text(files[path]).length,
          pointer: async (path) => pointers.includes(path),
        },
      };
    };
    return { recordsAt, asked };
  }
  const RECORDS = {
    "index.json": { collections: [{ key: "ad-creatives", title: "Ad creatives" }] },
    "ad-creatives/collection.json": {
      title: "Ad creatives",
      statuses: [{ key: "used", label: "Used" }],
      metrics: [{ key: "clicks", label: "Clicks", unit: "count" }],
    },
    "ad-creatives/items.json": [
      {
        id: "c-001",
        title: "Morning commute",
        madeOn: "2026-11-03",
        status: "used",
        files: [{ label: "The video", path: "files/c-001.mp4" }],
      },
    ],
    "ad-creatives/uses.json": [{ item: "c-001", on: "2026-11-06", where: "Feed" }],
    "ad-creatives/metrics.json": [{ item: "c-001", on: "2026-11-06", values: { clicks: 36 } }],
    "ad-creatives/files/c-001.mp4": 480_000_000,
  };
  /** A console that must not be asked: the check reads files and nothing else. */
  const silent: CliIo["fetch"] = async () => {
    throw new Error("the check asks nothing of a console");
  };

  it("says that records read right, with how much each collection keeps, and asks nothing of a console", async () => {
    const at = recordsOf(RECORDS);
    const run = harness({ fetch: silent, recordsAt: at.recordsAt });
    expect(await runCli(["desk", "check"], run.io)).toBe(EXIT.ok);
    expect(at.asked).toEqual(["."]);
    expect(run.out()).toBe(
      [
        "The records in /work/desk read right: 1 collection.",
        "  ad-creatives: 1 item, 1 use, 1 row of figures",
        "",
      ].join("\n"),
    );
    expect(run.err()).toBe("");
    // Another desk is named, and at most one.
    const there = recordsOf(RECORDS);
    const named = harness({ fetch: silent, recordsAt: there.recordsAt });
    expect(await runCli(["desk", "check", "/srv/desks/alice"], named.io)).toBe(EXIT.ok);
    expect(there.asked).toEqual(["/srv/desks/alice"]);
    expect(named.out()).toContain("The records in /srv/desks/alice read right");
    const two = harness({ fetch: silent, recordsAt: there.recordsAt });
    expect(await runCli(["desk", "check", "one", "two"], two.io)).toBe(EXIT.usage);
    expect(two.err()).toContain("Say at most one directory: console desk check [<directory>]");
  });

  it("says that there are no records yet where the desk has no index, and that is no failure", async () => {
    const run = harness({
      fetch: silent,
      recordsAt: recordsOf({ "README.md": "# The records of this desk\n" }).recordsAt,
    });
    expect(await runCli(["desk", "check"], run.io)).toBe(EXIT.ok);
    expect(run.out()).toBe(
      "No collection is kept in /work/desk: records/index.json is not there. What else is under records/ is the desk's own shape, and not this check's to read. Where a collection is wanted, the skill keeping-a-desk says how one is kept (collections.md).\n",
    );
  });

  it("says each problem with its file and ends in 1, with what still reads", async () => {
    const run = harness({
      fetch: silent,
      recordsAt: recordsOf({
        ...RECORDS,
        "ad-creatives/items.json": [
          { id: "c-001", title: "Morning commute", madeOn: "3 November", status: "paused" },
        ],
        "ad-creatives/uses.json": "[ not json",
      }).recordsAt,
    });
    expect(await runCli(["desk", "check"], run.io)).toBe(EXIT.failed);
    expect(run.out()).toBe(
      [
        "records/ad-creatives/items.json: [0].madeOn is a day, written as 2026-11-15",
        "records/ad-creatives/uses.json: is not JSON",
        "",
      ].join("\n"),
    );
    expect(run.err()).toContain(
      "2 problems in the records of /work/desk. Mend the files and run this again.",
    );
    // One file wrong, and the collection that still reads is said with it.
    const partly = harness({
      fetch: silent,
      recordsAt: recordsOf({
        ...RECORDS,
        "ad-creatives/uses.json": [{ item: "c-404", on: "2026-11-06", where: "Feed" }],
      }).recordsAt,
    });
    expect(await runCli(["desk", "check"], partly.io)).toBe(EXIT.failed);
    expect(partly.out()).toBe(
      [
        "records/ad-creatives/uses.json: [0] names the item c-404, which is not there",
        "What reads:",
        "  ad-creatives: 1 item, 1 use, 1 row of figures",
        "",
      ].join("\n"),
    );
    expect(partly.err()).toContain("1 problem in the records of /work/desk.");
  });

  it("notes a file that git LFS has not fetched here, which is nothing wrong with the record", async () => {
    const run = harness({
      fetch: silent,
      recordsAt: recordsOf({ ...RECORDS, "ad-creatives/files/c-001.mp4": 133 }, [
        "ad-creatives/files/c-001.mp4",
      ]).recordsAt,
    });
    expect(await runCli(["desk", "check"], run.io)).toBe(EXIT.ok);
    expect(run.out()).toBe(
      [
        "note: records/ad-creatives/items.json: [0] (c-001) file files/c-001.mp4 is a git LFS pointer, not fetched on this machine: git lfs pull fetches it",
        "The records in /work/desk read right: 1 collection.",
        "  ad-creatives: 1 item, 1 use, 1 row of figures",
        "",
      ].join("\n"),
    );
  });

  it("notes a use dated before its item was made, and ends in 0: only the member knows which day is wrong", async () => {
    const run = harness({
      fetch: silent,
      recordsAt: recordsOf({
        ...RECORDS,
        "ad-creatives/uses.json": [{ item: "c-001", on: "2026-11-02", where: "The teaser" }],
        "ad-creatives/metrics.json": [{ item: "c-001", on: "2026-11-01", values: { clicks: 3 } }],
      }).recordsAt,
    });
    expect(await runCli(["desk", "check"], run.io)).toBe(EXIT.ok);
    expect(run.out()).toBe(
      [
        "note: records/ad-creatives/uses.json: [0] is dated 2026-11-02, before its item c-001 was made (2026-11-03)",
        "note: records/ad-creatives/metrics.json: [0] is dated 2026-11-01, before its item c-001 was made (2026-11-03)",
        "The records in /work/desk read right: 1 collection.",
        "  ad-creatives: 1 item, 1 use, 1 row of figures",
        "",
      ].join("\n"),
    );
    expect(run.err()).toBe("");
  });

  it("answers what it found as JSON with --json, and still ends in 1 where there is a problem", async () => {
    const run = harness({ fetch: silent, recordsAt: recordsOf(RECORDS).recordsAt });
    expect(await runCli(["desk", "check", "--json"], run.io)).toBe(EXIT.ok);
    expect(JSON.parse(run.out())).toEqual({
      directory: "/work/desk",
      found: true,
      problems: [],
      notes: [],
      collections: [{ key: "ad-creatives", items: 1, uses: 1, metricRows: 1 }],
    });
    const wrong = harness({
      fetch: silent,
      recordsAt: recordsOf({ ...RECORDS, "index.json": "nothing" }).recordsAt,
    });
    expect(await runCli(["desk", "check", "--json"], wrong.io)).toBe(EXIT.failed);
    expect(JSON.parse(wrong.out())).toMatchObject({
      found: true,
      problems: [{ file: "records/index.json", problem: "is not JSON" }],
    });
    // Where the command has no files to read, it says so.
    const nowhere = harness({ fetch: silent });
    expect(await runCli(["desk", "check"], nowhere.io)).toBe(EXIT.failed);
    expect(nowhere.err()).toContain("A desk's records cannot be read from here.");
  });
});

describe("the versions of the command and the console (ADR-0025)", () => {
  const SAYS = { version: "0.1.18", clientRange: ">=0.1.18 <0.2.0" };
  const GLOBAL: Install = {
    kind: "global",
    manager: "npm",
    root: "C:/Users/alice/AppData/Roaming/npm",
  };
  const IN_PROJECT: Install = { kind: "project", manager: "pnpm", root: "/work/app" };
  const NO_TASKS = {
    [`GET ${IN}/tasks?limit=50&offset=0&brief=true`]: { body: { more: false, items: [] } },
    [`GET ${IN}/tasks?limit=50&offset=0`]: { body: { more: false, items: [] } },
  };

  it("names itself on every request, and says where it is installed and what the console takes", async () => {
    const { fetch, calls } = fakeConsole(
      { "GET /api/v1/me": { body: ME }, [`GET ${IN}`]: { body: PROJECT } },
      SAYS,
    );
    const userAgent = "skillcdn-console/0.1.18 (cli; node 24.11.0; win32)";
    const h = harness({ fetch, env: SIGNED_IN, version: "0.1.18", userAgent, install: GLOBAL });
    expect(await runCli(["whoami"], h.io)).toBe(EXIT.ok);
    expect(new Headers(calls[0]?.init?.headers).get("user-agent")).toBe(userAgent);
    expect(h.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project web (The web app), named by CONSOLE_PROJECT\nBefore the first task, read console rules and the skill working-the-board (console skills says where it is); for one command's flags, console help <command>.\nThis command is 0.1.18, installed for the machine with npm in C:/Users/alice/AppData/Roaming/npm; the console is 0.1.18 and takes >=0.1.18 <0.2.0; this command works with a console from 0.1.0 on.\n`,
    );
    expect(h.err()).toBe("");
    // Where the skill working-the-board is, as the machine writes paths, when the command knows.
    const located = harness({
      fetch,
      env: SIGNED_IN,
      version: "0.1.18",
      install: GLOBAL,
      skillsDir:
        "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\@skillcdn\\console\\skills\\",
    });
    expect(await runCli(["whoami"], located.io)).toBe(EXIT.ok);
    expect(located.out()).toContain(
      "\nBefore the first task, read console rules and the skill working-the-board; for one command's flags, console help <command>. The skill: C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\@skillcdn\\console\\skills\\working-the-board\\SKILL.md\n",
    );
    // The line names nothing else to read: an agent that has the skill is not sent to the
    // whole help, and the line is no longer than the one it replaces.
    const second = located.out().split("\n")[1] ?? "";
    expect(second).not.toMatch(/console help(?! <command>)/);
    expect(second.length).toBeLessThanOrEqual(
      "What this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command: C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\@skillcdn\\console\\skills\\working-the-board\\SKILL.md"
        .length,
    );
    const version = harness({ fetch, version: "0.1.18", install: GLOBAL });
    expect(await runCli(["--version"], version.io)).toBe(EXIT.ok);
    expect(version.out()).toBe(
      "console 0.1.18 (@skillcdn/console), installed for the machine with npm in C:/Users/alice/AppData/Roaming/npm\n",
    );
    const json = harness({ fetch, env: SIGNED_IN, version: "0.1.18", install: GLOBAL });
    expect(await runCli(["whoami", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toMatchObject({
      console: SAYS,
      command: { version: "0.1.18", install: GLOBAL },
    });
  });

  it("notices a newer console once a day, and a console older than the command, on stderr only", async () => {
    // From 1.0 a command one minor behind is answered, and told once that a newer one exists.
    const later = { version: "1.4.2", clientRange: ">=1.3.0 <1.6.0" };
    const notices = memoryNotices();
    const behind = (now: string, store = notices.store) =>
      harness({
        fetch: fakeConsole(NO_TASKS, later).fetch,
        env: SIGNED_IN,
        version: "1.4.0",
        install: IN_PROJECT,
        notices: store,
        now: () => Date.parse(now),
      });
    const first = behind("2026-10-13T10:00:00Z");
    expect(await runCli(["tasks"], first.io)).toBe(EXIT.ok);
    expect(first.out()).not.toContain("newer");
    expect(first.err()).toBe(
      "A newer command exists: the console runs 1.4.2, this command is 1.4.0. Update it: pnpm add @skillcdn/console@1.4.2 (in /work/app)\n",
    );
    expect(notices.kept()).toEqual({
      command: "1.4.0",
      console: "1.4.2",
      shownAt: "2026-10-13T10:00:00.000Z",
    });
    const sameDay = behind("2026-10-13T20:00:00Z");
    expect(await runCli(["tasks"], sameDay.io)).toBe(EXIT.ok);
    expect(sameDay.err()).toBe("");
    const nextDay = behind("2026-10-14T11:00:00Z");
    expect(await runCli(["tasks"], nextDay.io)).toBe(EXIT.ok);
    expect(nextDay.err()).toContain("A newer command exists");
    // With --json, the console's JSON stays on stdout and the notice on stderr.
    const json = behind("2026-10-15T11:00:00Z", memoryNotices().store);
    expect(await runCli(["tasks", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toEqual({ more: false, items: [] });
    expect(json.err()).toContain("A newer command exists");
    // Before 1.0 a command newer than the console, within the minor, is answered and warned.
    const ahead = harness({
      fetch: fakeConsole(NO_TASKS, SAYS).fetch,
      env: SIGNED_IN,
      version: "0.1.19",
      install: GLOBAL,
    });
    expect(await runCli(["tasks"], ahead.io)).toBe(EXIT.ok);
    expect(ahead.err()).toBe(
      "This command (0.1.19) is newer than the console (0.1.18, which takes >=0.1.18 <0.2.0): it works, and what the console has not got yet is refused as not found; nothing to do until then. The console's operator updates it; to match the console meanwhile: npm install -g @skillcdn/console@0.1.18\n",
    );
    // The same version, or a console that says nothing of itself: nothing to say.
    const same = harness({
      fetch: fakeConsole(NO_TASKS, SAYS).fetch,
      env: SIGNED_IN,
      version: "0.1.18",
    });
    expect(await runCli(["tasks"], same.io)).toBe(EXIT.ok);
    expect(same.err()).toBe("");
    const mute = harness({ fetch: fakeConsole(NO_TASKS).fetch, env: SIGNED_IN, version: "0.1.19" });
    expect(await runCli(["tasks"], mute.io)).toBe(EXIT.ok);
    expect(mute.err()).toBe("");
    // whoami says it itself, every time, in its own words.
    const who = harness({
      fetch: fakeConsole({ "GET /api/v1/me": { body: ME }, [`GET ${IN}`]: { body: PROJECT } }, SAYS)
        .fetch,
      env: SIGNED_IN,
      version: "0.1.19",
      install: GLOBAL,
      notices: memoryNotices({
        command: "0.1.19",
        console: "0.1.18",
        shownAt: "2026-10-13T10:00:00.000Z",
      }).store,
      now: () => Date.parse("2026-10-13T10:01:00Z"),
    });
    expect(await runCli(["whoami"], who.io)).toBe(EXIT.ok);
    expect(who.out()).toContain(
      "This command is newer than the console: it works, and what the console has not got yet is refused as not found; nothing to do until then. To match the console then: npm install -g @skillcdn/console@0.1.18",
    );
    expect(who.err()).toBe("");
  });

  it("is refused outside the range with 426, exits with 4, and says the command to run", async () => {
    const refused = (code: string, message: string) => ({
      [`GET ${IN}/tasks?limit=50&offset=0&brief=true`]: {
        status: 426,
        body: { error: { code, message } },
      },
    });
    const old = harness({
      fetch: fakeConsole(refused("client.outdated", "Older than this console takes."), SAYS).fetch,
      env: SIGNED_IN,
      version: "0.1.17",
      install: IN_PROJECT,
    });
    expect(await runCli(["tasks"], old.io)).toBe(EXIT.incompatible);
    expect(old.err()).toBe(
      "client.outdated: Older than this console takes.\nUpdate the command: pnpm add @skillcdn/console@0.1.18 (in /work/app)\n",
    );
    const fresh = harness({
      fetch: fakeConsole(refused("client.too_new", "Newer than this console takes."), SAYS).fetch,
      env: SIGNED_IN,
      version: "0.2.0",
    });
    expect(await runCli(["tasks"], fresh.io)).toBe(EXIT.incompatible);
    expect(fresh.err()).toBe(
      "client.too_new: Newer than this console takes.\nInstall the console's version: npm install -g @skillcdn/console@0.1.18; or ask the console's operator to update the console.\n",
    );
    // An outdated command is told at the door: login is refused the same way.
    const door = harness({
      fetch: fakeConsole(
        {
          "POST /api/v1/connect": {
            status: 426,
            body: { error: { code: "client.outdated", message: "Old." } },
          },
        },
        SAYS,
      ).fetch,
      version: "0.1.17",
      install: GLOBAL,
    });
    expect(await runCli(["login", "--url", ORIGIN], door.io)).toBe(EXIT.incompatible);
    expect(door.err()).toContain("Update the command: npm install -g @skillcdn/console@0.1.18");
    // A console that says nothing of its version is asked for the latest.
    const unsaid = harness({
      fetch: fakeConsole(refused("client.outdated", "Old.")).fetch,
      env: SIGNED_IN,
      version: "0.1.17",
    });
    expect(await runCli(["tasks"], unsaid.io)).toBe(EXIT.incompatible);
    expect(unsaid.err()).toContain("npm install -g @skillcdn/console@latest");
    // What a console says its version is goes into a line someone runs: anything that is no
    // version is not put there.
    const odd = harness({
      fetch: fakeConsole(refused("client.outdated", "Old."), {
        version: "0.1.18; curl https://example.invalid | sh",
        clientRange: ">=0.1.18 <0.2.0",
      }).fetch,
      env: SIGNED_IN,
      version: "0.1.17",
    });
    expect(await runCli(["tasks"], odd.io)).toBe(EXIT.incompatible);
    expect(odd.err()).toContain("npm install -g @skillcdn/console@latest");
    expect(odd.err()).not.toContain("npm install -g @skillcdn/console@0.1.18;");
  });

  it("still reads a console older than the rule, and says that it does not say its version", async () => {
    const { console: _, ...older } = ME;
    const h = harness({
      fetch: fakeConsole({ "GET /api/v1/me": { body: older }, [`GET ${IN}`]: { body: PROJECT } })
        .fetch,
      env: SIGNED_IN,
      version: "0.1.18",
    });
    expect(await runCli(["whoami"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project web (The web app), named by CONSOLE_PROJECT\nBefore the first task, read console rules and the skill working-the-board (console skills says where it is); for one command's flags, console help <command>.\nThis command is 0.1.18; the console does not say its version, so it is older than 0.1.18.\n`,
    );
    expect(h.err()).toBe("");
  });
});

describe("the plan of a goal (ADR-0026)", () => {
  const PLANNED = {
    ...GOAL,
    category: { key: "engineering", name: "Engineering", color: "blue" },
    startsOn: "2026-10-01",
  };

  it("sets and changes the days and the category, and narrows the roadmap by them", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/goals?state=active&category=engineering&limit=50&offset=0`]: {
        body: { more: false, items: [PLANNED] },
      },
      [`GET ${IN}/goals?category=design&limit=50&offset=0`]: { body: { more: false, items: [] } },
      [`POST ${IN}/goals`]: { status: 201, body: PLANNED },
      [`PATCH ${IN}/goals/${GOAL.id}`]: { body: { ...PLANNED, category: null, startsOn: null } },
    });
    const narrowed = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["goals", "--state", "active", "--category", "engineering"], narrowed.io),
    ).toBe(EXIT.ok);
    expect(narrowed.out()).toBe(
      `${GOAL.id}  active  Ship v1  (engineering; starts 2026-10-01; due 2026-11-15; 2/4 done, 1 in progress)\n`,
    );
    const none = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goals", "--category", "design"], none.io)).toBe(EXIT.ok);
    expect(none.out()).toBe("No goal matches.\n");
    const set = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "goal",
          "new",
          "Ship v1",
          "--category",
          "engineering",
          "--starts",
          "2026-10-01",
          "--due",
          "2026-11-15",
        ],
        set.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `POST ${IN}/goals`)?.body).toEqual({
      title: "Ship v1",
      category: "engineering",
      startsOn: "2026-10-01",
      dueOn: "2026-11-15",
    });
    const cleared = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["goal", "edit", GOAL.id, "--category", "none", "--starts", "none"], cleared.io),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH ${IN}/goals/${GOAL.id}`)?.body).toEqual({
      category: null,
      startsOn: null,
    });
    expect(cleared.out()).toContain("category: none  starts: none  due: 2026-11-15");
    const wrongState = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["goals", "--state", "open"], wrongState.io)).toBe(EXIT.usage);
    const help = harness({ fetch });
    expect(await runCli(["help", "goal"], help.io)).toBe(EXIT.ok);
    expect(help.out()).toContain("--starts <day|none>");
    expect(help.out()).toContain("goal.invalid_dates");
  });
});

describe("the consoles the command is signed in to (ADR-0027)", () => {
  const OTHER = "https://other.test";
  /** Two consoles, told apart by their origin: what each was asked. */
  function twoConsoles(table: Record<string, Answer | Answer[]>) {
    const first = fakeConsole(table);
    const second = fakeConsole(table);
    const fetch: CliIo["fetch"] = (url, init) =>
      url.startsWith(OTHER)
        ? second.fetch(url.replace(OTHER, ORIGIN), init)
        : first.fetch(url, init);
    return { fetch, first: first.calls, second: second.calls };
  }
  const both: Credentials = {
    default: ORIGIN,
    logins: [
      { url: ORIGIN, account: "alice", token: "cns_t_first", agent: undefined, since: undefined },
      { url: OTHER, account: "alice", token: "cns_t_second", agent: "Codex", since: WHEN },
    ],
  };
  const tasks = {
    [`GET ${IN}/tasks?limit=50&offset=0&brief=true`]: { body: { more: false, items: [TASK] } },
  };

  it("sends a token only to the console that issued it, as the directory, the flag or the default names it", async () => {
    const { fetch, first, second } = twoConsoles(tasks);
    // The directory bound to the other console: its token goes there, and nothing goes to the first.
    const bound = harness({
      fetch,
      store: memoryStore(both).store,
      directory: memoryDirectory({ project: "web", url: OTHER }).store,
    });
    expect(await runCli(["tasks"], bound.io)).toBe(EXIT.ok);
    expect(first).toHaveLength(0);
    expect(new Headers(second[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_second");
    // The default console, with nothing in the directory but the project.
    const plain = harness({
      fetch,
      store: memoryStore(both).store,
      directory: memoryDirectory({ project: "web" }).store,
    });
    expect(await runCli(["tasks"], plain.io)).toBe(EXIT.ok);
    expect(new Headers(first.at(-1)?.init?.headers).get("authorization")).toBe(
      "Bearer cns_t_first",
    );
    // A console nobody is signed in to here gets no request, whatever token is kept for another.
    const elsewhere = harness({ fetch, store: memoryStore(both).store });
    expect(await runCli(["whoami", "--url", "https://third.test"], elsewhere.io)).toBe(EXIT.failed);
    expect(elsewhere.err()).toContain("Nobody is signed in here at https://third.test");
    expect(elsewhere.err()).toContain("console login --url https://third.test");
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // A directory bound to a console nobody is signed in to says so, naming the directory.
    const stranded = harness({
      fetch,
      store: memoryStore(one(ORIGIN, "cns_t_first")).store,
      directory: memoryDirectory({ project: "web", url: OTHER }).store,
    });
    expect(await runCli(["tasks"], stranded.io)).toBe(EXIT.failed);
    expect(stranded.err()).toContain(`This directory works at ${OTHER}`);
    expect(second).toHaveLength(1);
    // Half of the environment's pair is no credential at all.
    const half = harness({ fetch, env: { CONSOLE_URL: ORIGIN }, store: memoryStore(both).store });
    expect(await runCli(["tasks"], half.io)).toBe(EXIT.failed);
    expect(half.err()).toContain("Both CONSOLE_URL and CONSOLE_TOKEN");
    // The environment's token goes to the environment's console, and to no other.
    const env = harness({
      fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_env" },
      store: memoryStore(both).store,
      directory: memoryDirectory({ project: "web", url: OTHER }).store,
    });
    expect(await runCli(["tasks"], env.io)).toBe(EXIT.ok);
    expect(new Headers(first.at(-1)?.init?.headers).get("authorization")).toBe("Bearer cns_t_env");
    expect(second).toHaveLength(1);
    expect(
      [bound.out(), plain.out(), elsewhere.err(), stranded.err(), half.err()].join(),
    ).not.toContain("cns_t_");
  });

  it("tells two accounts at one console apart by --account or by the directory, and asks when nothing says which", async () => {
    const { fetch, first } = twoConsoles(tasks);
    const two: Credentials = {
      default: ORIGIN,
      logins: [
        { url: ORIGIN, account: "alice", token: "cns_t_alice", agent: undefined, since: undefined },
        { url: ORIGIN, account: "bob", token: "cns_t_bob", agent: undefined, since: undefined },
      ],
    };
    const unsaid = harness({
      fetch,
      store: memoryStore(two).store,
      directory: memoryDirectory({ project: "web" }).store,
    });
    expect(await runCli(["tasks"], unsaid.io)).toBe(EXIT.failed);
    expect(unsaid.err()).toContain(
      "Several accounts are signed in at https://console.test (alice, bob)",
    );
    expect(unsaid.err()).toContain("--account <login>");
    expect(first).toHaveLength(0);
    const flagged = harness({
      fetch,
      store: memoryStore(two).store,
      directory: memoryDirectory({ project: "web" }).store,
    });
    expect(await runCli(["tasks", "--account", "bob"], flagged.io)).toBe(EXIT.ok);
    expect(new Headers(first.at(-1)?.init?.headers).get("authorization")).toBe("Bearer cns_t_bob");
    const fromDirectory = harness({
      fetch,
      store: memoryStore(two).store,
      directory: memoryDirectory({ project: "web", account: "alice" }).store,
    });
    expect(await runCli(["tasks"], fromDirectory.io)).toBe(EXIT.ok);
    expect(new Headers(first.at(-1)?.init?.headers).get("authorization")).toBe(
      "Bearer cns_t_alice",
    );
    const nobody = harness({
      fetch,
      store: memoryStore(two).store,
      directory: memoryDirectory({ project: "web", account: "carol" }).store,
    });
    expect(await runCli(["tasks"], nobody.io)).toBe(EXIT.failed);
    expect(nobody.err()).toContain("as carol");
  });

  it("lists the logins without a token, signs out of one console, and keeps the rest", async () => {
    const { fetch, first, second } = twoConsoles({ "DELETE /api/v1/me/token": { status: 204 } });
    const memory = memoryStore(both);
    const listed = harness({ fetch, store: memory.store });
    expect(await runCli(["logins"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toBe(
      `${ORIGIN}  alice  (default)\n${OTHER}  alice  Codex  since ${WHEN.slice(0, 10)}\n`,
    );
    const asJson = harness({ fetch, store: memory.store });
    expect(await runCli(["logins", "--json"], asJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out())).toEqual({
      default: ORIGIN,
      logins: [
        { url: ORIGIN, account: "alice", agent: null, self: false, since: null, default: true },
        {
          url: OTHER,
          account: "alice",
          agent: "Codex",
          self: false,
          since: WHEN,
          default: false,
        },
      ],
    });
    expect(asJson.out()).not.toContain("cns_t_");
    const out = harness({ fetch, store: memory.store });
    expect(await runCli(["logout", "--url", OTHER], out.io)).toBe(EXIT.ok);
    expect(first).toHaveLength(0);
    expect(second.map((call) => call.key)).toEqual(["DELETE /api/v1/me/token"]);
    expect(new Headers(second[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_second");
    expect(memory.kept()).toEqual({ default: ORIGIN, logins: [both.logins[0]] });
    expect(out.out()).toContain(`Signed out of ${OTHER} as alice`);
    // With several consoles, no default and nothing to say which, the command asks rather than guessing.
    const several = harness({ fetch, store: memoryStore({ ...both, default: undefined }).store });
    expect(await runCli(["logout"], several.io)).toBe(EXIT.failed);
    expect(several.err()).toContain("console logout --url <origin>");
    // Nothing kept for the console named: nothing to forget, and no request.
    const none = harness({ fetch, store: memoryStore(both).store });
    expect(await runCli(["logout", "--url", "https://third.test"], none.io)).toBe(EXIT.failed);
    expect(none.err()).toContain("nothing to forget");
    expect(second).toHaveLength(1);
  });

  it("binds a directory to the console and the account it used, and never to a token", async () => {
    const { fetch } = twoConsoles({ [`GET ${IN}`]: { body: PROJECT } });
    const directory = memoryDirectory();
    const other = harness({ fetch, store: memoryStore(both).store, directory: directory.store });
    expect(await runCli(["use", "web", "--url", OTHER], other.io)).toBe(EXIT.ok);
    expect(directory.kept()).toEqual({ project: "web", url: OTHER });
    expect(other.out()).toContain(
      `Working in The web app (web) at ${OTHER} from this directory on`,
    );
    // The default console is named too (ADR-0112): what is the default on this machine is
    // another console's on the next, and a file that said only the project would follow it there.
    const plain = memoryDirectory();
    const first = harness({ fetch, store: memoryStore(both).store, directory: plain.store });
    expect(await runCli(["use", "web"], first.io)).toBe(EXIT.ok);
    expect(plain.kept()).toEqual({ project: "web", url: ORIGIN });
    expect(first.out()).toContain(
      `Working in The web app (web) at ${ORIGIN} from this directory on`,
    );
    // Two accounts at a console: the one asked for is named, and only when it is asked for.
    const two: Credentials = {
      default: ORIGIN,
      logins: [
        { url: ORIGIN, account: "alice", token: "cns_t_alice", agent: undefined, since: undefined },
        { url: ORIGIN, account: "bob", token: "cns_t_bob", agent: undefined, since: undefined },
      ],
    };
    const named = memoryDirectory();
    const asBob = harness({ fetch, store: memoryStore(two).store, directory: named.store });
    expect(await runCli(["use", "web", "--account", "bob"], asBob.io)).toBe(EXIT.ok);
    expect(named.kept()).toEqual({ project: "web", url: ORIGIN, account: "bob" });
    expect(asBob.out()).toContain(`at ${ORIGIN} as bob from this directory on`);
    // A directory that named its account before keeps it when it is bound anew; one that named
    // none gains none, so that a file to be committed never carries somebody's account unasked.
    const again = harness({ fetch, store: memoryStore(two).store, directory: named.store });
    expect(await runCli(["use", "web"], again.io)).toBe(EXIT.ok);
    expect(named.kept()).toEqual({ project: "web", url: ORIGIN, account: "bob" });
    const one = memoryDirectory();
    const alone = harness({ fetch, store: memoryStore(both).store, directory: one.store });
    expect(await runCli(["use", "web"], alone.io)).toBe(EXIT.ok);
    expect(one.kept()).toEqual({ project: "web", url: ORIGIN });
    expect(JSON.stringify([directory.kept(), plain.kept(), named.kept()])).not.toContain("cns_t_");
  });

  it("asks the console for the project a directory names, and says where its key came from (ADR-0112)", async () => {
    const LINES =
      "Before the first task, read console rules and the skill working-the-board (console skills says where it is); for one command's flags, console help <command>.\nThis command is of a version it does not know; the console is 0.1.18 and takes >=0.1.18 <0.2.0; this command works with a console from 0.0.0 on.\n";
    const table = { "GET /api/v1/me": { body: ME }, [`GET ${IN}`]: { body: PROJECT } };
    const pair = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" };
    // Named by the directory's file: the directory that holds it is said, since a file of a
    // folder above the checkout is the one nobody looks for.
    const { fetch, calls } = fakeConsole(table);
    const found = { store: memoryDirectory({ project: "web" }).store };
    const above: DirectoryStore = {
      load: async () => ({ project: "web", url: ORIGIN, directory: "/work" }),
      save: found.store.save,
    };
    const fromFile = harness({ fetch, env: pair, directory: above });
    expect(await runCli(["whoami"], fromFile.io)).toBe(EXIT.ok);
    expect(fromFile.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project web (The web app), named by .skillcdn-console.json in /work\n${LINES}`,
    );
    expect(calls.map((call) => call.key)).toEqual(["GET /api/v1/me", `GET ${IN}`]);
    // A store that keeps no files says the file alone.
    const plain = harness({ fetch, env: pair, directory: found.store });
    expect(await runCli(["whoami"], plain.io)).toBe(EXIT.ok);
    expect(plain.out()).toContain("; project web (The web app), named by .skillcdn-console.json\n");
    // The environment wins over the file, and the flag over both; each is named as what decided.
    const fromEnvironment = harness({ fetch, env: SIGNED_IN, directory: above });
    expect(await runCli(["whoami"], fromEnvironment.io)).toBe(EXIT.ok);
    expect(fromEnvironment.out()).toContain(
      "; project web (The web app), named by CONSOLE_PROJECT\n",
    );
    const fromFlag = harness({
      fetch,
      env: { ...pair, CONSOLE_PROJECT: "ops" },
      directory: above,
    });
    expect(await runCli(["whoami", "--project", "web"], fromFlag.io)).toBe(EXIT.ok);
    expect(fromFlag.out()).toContain("; project web (The web app), named by --project\n");
    // --json carries the key as before, and the name and the source beside it.
    const json = harness({ fetch, env: pair, directory: above });
    expect(await runCli(["whoami", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toMatchObject({
      project: "web",
      projectName: "The web app",
      projectSource: { kind: "directory", directory: "/work" },
    });
    // No project named: nothing is asked of the console about one, and the command ends well.
    const none = fakeConsole(table);
    const unnamed = harness({ fetch: none.fetch, env: pair });
    expect(await runCli(["whoami"], unnamed.io)).toBe(EXIT.ok);
    expect(unnamed.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; no project named here\n${LINES}`,
    );
    expect(none.calls.map((call) => call.key)).toEqual(["GET /api/v1/me"]);
    const unnamedJson = harness({ fetch: none.fetch, env: pair });
    expect(await runCli(["whoami", "--json"], unnamedJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(unnamedJson.out())).toMatchObject({
      project: null,
      projectName: null,
      projectSource: null,
    });
    // A project the console does not have, or does not show: who and where are still said, and
    // the command ends as refused, so that a check of the binding does not pass on a key alone.
    const gone = fakeConsole({
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/projects/elsewhere": {
        status: 404,
        body: { error: { code: "project.not_found", message: "The project was not found." } },
      },
    });
    const stale: DirectoryStore = {
      load: async () => ({ project: "elsewhere", directory: "/work/app" }),
      save: found.store.save,
    };
    const missing = harness({ fetch: gone.fetch, env: pair, directory: stale });
    expect(await runCli(["whoami"], missing.io)).toBe(EXIT.failed);
    expect(missing.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project elsewhere, named by .skillcdn-console.json in /work/app, which this console does not have or does not show you\n${LINES}`,
    );
    expect(missing.err()).toBe(
      `project.not_found: ${ORIGIN} has no project elsewhere, or it is not yours to see. The key is named by .skillcdn-console.json in /work/app.\nWhere the project is there and you are not in it, one of its owners lists you: console member add alice --project elsewhere. Where the key is wrong, the directory is bound to the right one, the key the repository's agreement names or the one the person says, with console use <key>; console projects lists the projects you may work in at this console.\n`,
    );
    const missingJson = harness({ fetch: gone.fetch, env: pair, directory: stale });
    expect(await runCli(["whoami", "--json"], missingJson.io)).toBe(EXIT.failed);
    expect(JSON.parse(missingJson.out())).toMatchObject({
      project: "elsewhere",
      projectName: null,
      projectSource: { kind: "directory", directory: "/work/app" },
    });
    expect(missingJson.err()).toContain("project.not_found: ");
    // Every command that works in the project a directory or the environment names says the
    // same of one the console does not show: the key, the console, what named it, and the two
    // things a person can do about it, where the console's own line names none of them.
    const answered = fakeConsole({
      "GET /api/v1/me": { body: ME },
      [`GET /api/v1/decisions/${DECISION.id}`]: {
        body: {
          project: { key: "hr", name: "HR", color: null, symbol: null, icon: null },
          decision: DECISION,
          mayAnswer: true,
        },
      },
    });
    const unseen: { fetch: CliIo["fetch"] } = {
      fetch: async (url, init) =>
        url.includes("/api/v1/projects/elsewhere")
          ? Response.json(
              { error: { code: "project.not_found", message: "The project was not found." } },
              { status: 404 },
            )
          : answered.fetch(url, init),
    };
    const TWO_CASES =
      "Where the project is there and you are not in it, one of its owners lists you: console member add alice --project elsewhere. Where the key is wrong, the directory is bound to the right one, the key the repository's agreement names or the one the person says, with console use <key>; console projects lists the projects you may work in at this console.\n";
    const kept = memoryStore(one(ORIGIN, "cns_t_kept")).store;
    for (const args of [["tasks"], ["rules"], ["task", "7"], ["take", "7"], ["skills"]]) {
      const refused = harness({ fetch: unseen.fetch, store: kept, directory: stale });
      expect(await runCli(args, refused.io), args.join(" ")).toBe(EXIT.failed);
      expect(refused.out()).toBe("");
      expect(refused.err(), args.join(" ")).toBe(
        `project.not_found: ${ORIGIN} has no project elsewhere, or it is not yours to see. The key is named by .skillcdn-console.json in /work/app.\n${TWO_CASES}`,
      );
    }
    // The second case says who settles it and with what, and hands the reader no command to
    // run: an agent told to do as it sees fit ran "console use" at once and went on with no task.
    expect(TWO_CASES).not.toMatch(/\bbind this directory\b/);
    expect(TWO_CASES).toContain(
      "the key the repository's agreement names or the one the person says",
    );
    // Named by the environment, the key is mended there; and a login the command does not know
    // is left for the person to fill in.
    const byEnvironment = harness({
      fetch: unseen.fetch,
      env: { ...pair, CONSOLE_PROJECT: "elsewhere" },
    });
    expect(await runCli(["tasks"], byEnvironment.io)).toBe(EXIT.failed);
    expect(byEnvironment.err()).toBe(
      `project.not_found: ${ORIGIN} has no project elsewhere, or it is not yours to see. The key is named by CONSOLE_PROJECT.\nWhere the project is there and you are not in it, one of its owners lists you: console member add <your login> --project elsewhere. Where the key is wrong, CONSOLE_PROJECT is set to the right one, the key the repository's agreement names or the one the person says, or unset; console projects lists the projects you may work in at this console.\n`,
    );
    // Named on the command itself, the key is in front of whoever typed it: the console's own words.
    const byFlag = harness({ fetch: unseen.fetch, env: pair });
    expect(await runCli(["tasks", "--project", "elsewhere"], byFlag.io)).toBe(EXIT.failed);
    expect(byFlag.err()).toBe(
      "project.not_found: The project was not found.\nNo project has this key, or it is not yours to see. console projects lists the projects you may work in.\n",
    );
    // A decision is still reached wherever it is, from a directory whose own project is not seen.
    const reaching = harness({ fetch: unseen.fetch, store: kept, directory: stale });
    expect(await runCli(["decision", DECISION.id], reaching.io)).toBe(EXIT.ok);
    expect(reaching.out()).toContain(DECISION.question);
    // Any other refusal of that request is the refusal itself, as of any command.
    const refusing = fakeConsole({
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}`]: {
        status: 403,
        body: { error: { code: "auth.deactivated", message: "The person is out." } },
      },
    });
    const out = harness({ fetch: refusing.fetch, env: SIGNED_IN });
    expect(await runCli(["whoami"], out.io)).toBe(EXIT.failed);
    expect(out.err()).toContain("auth.deactivated");
  });

  it("does not follow a redirect with the token, and takes an http console on this machine alone", async () => {
    const calls: string[] = [];
    const redirecting: CliIo["fetch"] = async (url, init) => {
      calls.push(url);
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.test/api/v1/me" },
      });
    };
    const h = harness({ fetch: redirecting, store: memoryStore(one(ORIGIN, "cns_t_kept")).store });
    expect(await runCli(["whoami"], h.io)).toBe(EXIT.failed);
    expect(calls).toEqual([`${ORIGIN}/api/v1/me`]);
    const { fetch } = fakeConsole({ "GET /api/v1/me": { body: ME } });
    const clear = harness({
      fetch,
      store: memoryStore().store,
      readStdin: async () => "cns_t_x\n",
    });
    expect(await runCli(["login", "--url", "http://console.test", "--token-stdin"], clear.io)).toBe(
      EXIT.usage,
    );
    expect(clear.err()).toContain("Not a safe origin");
    const local = harness({
      fetch: fakeConsole({}).fetch,
      store: memoryStore(one("http://localhost:3000", "cns_t_local")).store,
    });
    expect(await runCli(["whoami"], local.io)).toBe(EXIT.failed);
    expect(local.err()).not.toContain("Not a safe origin");
  });

  it("refuses to write over a credentials file it cannot read", async () => {
    const broken: CredentialStore = {
      load: async () => {
        throw new CredentialsError(
          "credentials.malformed",
          "/home/alice/.config/skillcdn-console/credentials.json",
        );
      },
      save: async () => {
        throw new Error("must not be written");
      },
      clear: async () => undefined,
    };
    const { fetch } = fakeConsole({ "GET /api/v1/me": { body: ME } });
    const h = harness({ fetch, store: broken, readStdin: async () => "cns_t_new\n" });
    expect(await runCli(["login", "--url", ORIGIN, "--token-stdin"], h.io)).toBe(EXIT.failed);
    expect(h.err()).toContain("could not be read as one");
    expect(h.err()).toContain("Move it away");
  });
});

// How a part of a skill that is not its last ends: the skillcdn command's own words (SkillCDN
// 0.6.2), which say to read on now, then the command that reads the next part, alone on the
// last line. The console prints nothing after it; the sentence itself is held by that
// command's tests.
const endsWithNext = (printed: string, line: string): boolean =>
  printed.includes("This part ends before the skill does: ") &&
  printed.endsWith(`until a part says the skill is complete:\n${line}\n`);

/** What the last part of a skill read in parts ends with, in the same command's words. */
const LAST_PART = "Skill context is complete: this was its last part.\n";

describe("the pack of the project, through the console (ADR-0028)", () => {
  const AT = {
    address: "/gh/acme/skills",
    source: "https://skillcdn.test",
    page: "https://skillcdn.test/gh/acme/skills",
    status: "ready",
    refusal: null,
  };
  const SKILL = {
    path: "review/SKILL.md",
    ruleChain: [{ path: "SKILLCDN.md", body: "Be kind", truncated: true }],
    references: [{ href: "guide.md", path: "review/guide.md", status: "available" }],
    complete: false,
    nextCursor: "two",
    includedContents: [],
    name: "review",
    directory: "review",
    description: "Reviews a change.",
    license: "MIT",
    compatibility: null,
    allowedTools: null,
    metadata: {},
    body: "Read the ",
    files: ["review/guide.md"],
    filesTruncated: false,
    included: [],
    warnings: [],
    translations: {},
    serving: {
      license: { kind: "permissive", name: "MIT", source: "LICENSE" },
      full: true,
      sourceUrl: "https://github.com/acme/skills/blob/main/review/SKILL.md",
    },
    rules: { path: "SKILLCDN.md", body: "Be kind", truncated: true },
  };
  const PAGE_ONE = { ...AT, read: { status: "ready", commit: COMMIT, skill: SKILL } };
  const PAGE_TWO = {
    ...AT,
    read: {
      status: "ready",
      commit: COMMIT,
      skill: {
        ...SKILL,
        ruleChain: [{ path: "SKILLCDN.md", body: ".", truncated: false }],
        body: "diff.",
        includedContents: [{ path: "review/checklist.md", content: "- tests", truncated: false }],
        included: ["review/checklist.md"],
        complete: true,
        nextCursor: null,
      },
    },
  };
  const file = (
    path: string,
    content: string,
    offset: number,
    nextOffset: number | null,
    totalLength: number,
  ) => ({
    ...AT,
    read: { kind: "file", commit: COMMIT, path, content, offset, nextOffset, totalLength },
  });

  it("reads a skill whole, its rules first, page after page, rendered as a model is given it; and a file of the pack", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}/skills/one?path=review%2FSKILL.md`]: { body: PAGE_ONE },
      [`GET ${IN}/skills/one?path=review%2FSKILL.md&cursor=two`]: { body: PAGE_TWO },
      [`GET ${IN}/skills/file?path=review%2Fguide.md&limit=24000`]: {
        body: file("review/guide.md", "How to ", 0, 7, 14),
      },
      [`GET ${IN}/skills/file?path=review%2Fguide.md&offset=7&limit=24000`]: {
        body: file("review/guide.md", "review.", 7, null, 14),
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "review/SKILL.md"], h.io)).toBe(EXIT.ok);
    const out = h.out();
    expect(out).toContain(
      "Skill: review\nSource: acme/skills (commit 0123456)\nDescription: Reviews a change.",
    );
    expect(out).toContain("MIT");
    expect(out).toContain(
      "Supporting files, readable with console skill --file:\n- review/guide.md",
    );
    // The pages joined: the rules, the body, the included file, each whole.
    expect(out).toContain("Be kind.");
    expect(out).toContain("Read the diff.");
    expect(out).toContain("review/checklist.md");
    expect(out).toContain("- tests");
    expect(out).not.toContain("Skill context is incomplete");
    expect(out).toContain("review/guide.md (available)");
    expect(calls.map((call) => call.key)).toEqual([
      `GET ${IN}/skills`,
      `GET ${IN}/skills/one?path=review%2FSKILL.md`,
      `GET ${IN}/skills/one?path=review%2FSKILL.md&cursor=two`,
    ]);
    // A file is read a page at a time, as the skillcdn command reads one (ADR-0118, ADR-0124):
    // a page a host shows whole unless --limit says otherwise, and where the next begins, which
    // --offset then reads.
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "--file", "review/guide.md"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain("File: review/guide.md (characters 0 to 7 of 14)");
    expect(read.out()).toContain("More follows: call console skill --file with offset 7.");
    expect(read.out()).toContain("--- content ---\nHow to \n");
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/skills/file?path=review%2Fguide.md&limit=24000`);
    const rest = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "--file", "review/guide.md", "--offset", "7"], rest.io)).toBe(
      EXIT.ok,
    );
    expect(rest.out()).toContain("File: review/guide.md (characters 7 to 14 of 14)");
    expect(rest.out()).toContain("--- content ---\nreview.");
    expect(rest.out()).not.toContain("More follows");
    expect(calls.at(-1)?.key).toBe(
      `GET ${IN}/skills/file?path=review%2Fguide.md&offset=7&limit=24000`,
    );
    // The URI console skills lists beside the path is taken too; one of another pack is not.
    const byUri = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "skill://gh/acme/skills/review/SKILL.md"], byUri.io)).toBe(
      EXIT.ok,
    );
    expect(byUri.out()).toContain("Read the diff.");
    const elsewhere = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "skill://gh/other/pack/review/SKILL.md"], elsewhere.io)).toBe(
      EXIT.usage,
    );
    expect(elsewhere.err()).toContain(
      "That URI is of another pack, /gh/other/pack; this project's pack is at /gh/acme/skills",
    );
    const odd = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "skill://elsewhere/review/SKILL.md"], odd.io)).toBe(EXIT.usage);
    expect(odd.err()).toContain("Not a skill's URI the console knows");
    // Described only: named and pointed at, nothing of its body.
    const described = harness({
      fetch: fakeConsole({
        [`GET ${IN}/skills`]: { body: LISTING },
        [`GET ${IN}/skills/one?path=review%2FSKILL.md`]: {
          body: {
            ...PAGE_ONE,
            read: {
              ...PAGE_ONE.read,
              skill: {
                ...SKILL,
                complete: true,
                nextCursor: null,
                body: "",
                serving: {
                  license: { kind: "restrictive", name: "BUSL-1.1", source: null },
                  full: false,
                  sourceUrl: "https://github.com/acme/skills/blob/main/review/SKILL.md",
                },
              },
            },
          },
        },
      }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["skill", "review/SKILL.md"], described.io)).toBe(EXIT.ok);
    expect(described.out()).toContain("Described only");
    expect(described.out()).toContain("https://github.com/acme/skills/blob/main/review/SKILL.md");
    expect(described.out()).not.toContain("Supporting files");
    // The token the project holds no longer works: said in words, with what an owner does.
    const refused = harness({
      fetch: fakeConsole({
        [`GET ${IN}/skills`]: { body: LISTING },
        [`GET ${IN}/skills/one?path=review%2FSKILL.md`]: {
          body: {
            ...AT,
            status: "token_invalid",
            refusal: {
              code: "auth.invalid_token",
              message: "The token is no good here.",
              sourceUrl: null,
              directories: [],
            },
            read: null,
          },
        },
      }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["skill", "review/SKILL.md"], refused.io)).toBe(EXIT.failed);
    expect(refused.out()).toBe("");
    expect(refused.err()).toContain(
      "skill at /gh/acme/skills, served by https://skillcdn.test: token_invalid",
    );
    expect(refused.err()).toContain("console project pack-token");
    expect(refused.err()).toContain("The token is no good here.");
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill"], nothing.io)).toBe(EXIT.usage);
  });

  it("reads a file of the pack by --file alone, browses a folder a page at a time, and searches by words", async () => {
    const entry = {
      name: null,
      description: null,
      skillCount: 0,
      documentCount: 0,
      size: null,
      manifestPath: null,
      language: null,
    };
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}/skills/file?path=README.md&limit=24000`]: {
        body: file("README.md", "The pack.", 0, null, 9),
      },
      [`GET ${IN}/skills/browse?path=docs`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            path: "docs",
            overview: {
              path: "docs/README.md",
              title: "Documentation",
              description: "How the docs are organized.",
            },
            entries: [
              {
                ...entry,
                kind: "directory",
                path: "docs/adr",
                name: "Decisions",
                documentCount: 54,
                overviewPath: "docs/adr/README.md",
              },
              {
                ...entry,
                kind: "skill",
                path: "docs/review/SKILL.md",
                name: "review",
                description: "Reviews a change.",
                license: { kind: "permissive", name: "MIT", source: null },
              },
              {
                ...entry,
                kind: "file",
                path: "docs/architecture.md",
                name: "Architecture",
                size: 1234,
              },
            ],
            diagnostics: [],
            nextCursor: "two",
          },
        },
      },
      [`GET ${IN}/skills/browse?path=docs&cursor=two`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            path: "docs",
            entries: [
              { ...entry, kind: "file", path: "docs/roadmap.md", name: "Roadmap", size: 99 },
            ],
            diagnostics: [],
            nextCursor: null,
          },
        },
      },
      [`GET ${IN}/skills/find?query=review&path=docs&limit=5`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            query: "review",
            path: "docs",
            items: [
              {
                kind: "skill",
                path: "docs/review/SKILL.md",
                name: "review",
                directory: "docs/review",
                description: "Reviews a change.",
                translations: {},
                files: [{ path: "docs/review/guide.md", title: "Guide", summary: null }],
                moreFiles: 2,
                license: { kind: "permissive", name: "MIT", source: null },
              },
              {
                kind: "document",
                path: "docs/handbook.md",
                title: "Handbook",
                summary: "Welcome.",
                skillDirectory: null,
              },
            ],
            diagnostics: [],
            nextCursor: "more",
            totals: null,
          },
        },
      },
    });
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "--file", "README.md"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain("File: README.md (9 characters)");
    expect(read.out()).toContain("--- content ---\nThe pack.");
    // The folder whole, across its pages, as browse_repo lays it out, with the reads named as the commands.
    const browsed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs"], browsed.io)).toBe(EXIT.ok);
    const folder = browsed.out();
    expect(folder).toContain("Folder: docs\nSource: acme/skills (commit 0123456)");
    expect(folder).toContain("Documentation");
    expect(folder).toContain("Optional overview: console skill --file docs/README.md.");
    expect(folder).toContain(
      "- directory: docs/adr (Decisions); 0 skills, 54 documents; overview: docs/adr/README.md",
    );
    expect(folder).toContain("- skill: docs/review/SKILL.md (review)");
    expect(folder).toContain("- file: docs/architecture.md (Architecture)");
    // One page, as the skillcdn command browses (ADR-0118): a page that ends before the folder
    // does ends with the command that reads the next, a line to run, and names no cursor
    // (SkillCDN 0.6.3).
    expect(folder).not.toContain("docs/roadmap.md");
    expect(folder.endsWith("\n\nNext page: console skills docs --cursor two\n")).toBe(true);
    expect(folder).not.toContain("nextCursor");
    const next = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs", "--cursor", "two"], next.io)).toBe(EXIT.ok);
    expect(next.out()).toContain("- file: docs/roadmap.md (Roadmap)");
    expect(next.out()).not.toContain("Next page");
    expect(calls.map((call) => call.key).filter((key) => key.includes("browse"))).toEqual([
      `GET ${IN}/skills/browse?path=docs`,
      `GET ${IN}/skills/browse?path=docs&cursor=two`,
    ]);
    // --limit says how long a page of a folder is, within what the pack takes.
    const sized = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs", "--limit", "500"], sized.io)).toBe(EXIT.usage);
    expect(sized.err()).toContain("--limit takes an integer between 1 and 200");
    // One page of a search, in relevance order, with the cursor that continues it.
    const found = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs", "--search", "review", "--limit", "5"], found.io)).toBe(
      EXIT.ok,
    );
    const results = found.out();
    expect(results).toContain('2 results for "review" in acme/skills (commit 0123456):');
    expect(results).toContain("1. skill: review (docs/review/SKILL.md)\n   Reviews a change.");
    expect(results).toContain(
      "   Matching files:\n   - docs/review/guide.md - Guide\n   - ... (2 more)",
    );
    expect(results).toContain("2. document: docs/handbook.md - Handbook\n   Welcome.");
    // A page that ends before what was found does ends with the command that reads the next,
    // asked as this one was: the words, the folder and the length. How a skill is loaded
    // stands above the results then, so that the line to run is the last one read.
    expect(
      results.endsWith(
        "\n\nNext page: console skills --search review docs --limit 5 --cursor more\n",
      ),
    ).toBe(true);
    expect(results.startsWith("A skill is loaded, its rules first")).toBe(true);
    expect(results).not.toContain("nextCursor");
    // The folder a search keeps to is said after the words, or with --path, as the skillcdn
    // command's find takes it; said twice, it is not understood.
    const within = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["skills", "--search", "review", "--path", "docs", "--limit", "5"], within.io),
    ).toBe(EXIT.ok);
    expect(within.out()).toContain('2 results for "review" in acme/skills (commit 0123456):');
    expect(
      within
        .out()
        .endsWith(
          "\nNext page: console skills --search review --path docs --limit 5 --cursor more\n",
        ),
    ).toBe(true);
    // Where the pack is read is said again in the line, as it was said for this page.
    const elsewhere = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["skills", "--search", "review", "docs", "--limit", "5", "--project", "web"],
        elsewhere.io,
      ),
    ).toBe(EXIT.ok);
    expect(
      elsewhere
        .out()
        .endsWith(
          "\nNext page: console skills --search review docs --limit 5 --cursor more --project web\n",
        ),
    ).toBe(true);
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/skills/find?query=review&path=docs&limit=5`);
    const twice = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs", "--search", "review", "--path", "docs"], twice.io)).toBe(
      EXIT.usage,
    );
    expect(await runCli(["skills", "--path", "docs"], harness({ fetch, env: SIGNED_IN }).io)).toBe(
      EXIT.usage,
    );
    // The JSON the console answered: the one page, as it came.
    const json = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs", "--json"], json.io)).toBe(EXIT.ok);
    const parsed = JSON.parse(json.out()) as {
      read: { entries: { path: string }[]; nextCursor: string | null };
    };
    expect(parsed.read.entries.map((entry) => entry.path)).toEqual([
      "docs/adr",
      "docs/review/SKILL.md",
      "docs/architecture.md",
    ]);
    expect(parsed.read.nextCursor).toBe("two");
    expect(await runCli(["skills", "--limit", "5"], harness({ fetch, env: SIGNED_IN }).io)).toBe(
      EXIT.usage,
    );
    expect(
      await runCli(
        ["skills", "--search", "x", "--limit", "99"],
        harness({ fetch, env: SIGNED_IN }).io,
      ),
    ).toBe(EXIT.usage);
  });

  it("outlines a document of the pack a page at a time, and reads one section of it as asked (SkillCDN 0.4)", async () => {
    const outline = (headings: unknown[], nextCursor: string | null) => ({
      ...AT,
      read: {
        status: "ready",
        commit: COMMIT,
        path: "docs/guide.md",
        outline: { path: "docs/guide.md", size: 400, totalLength: 390, headings, truncated: false },
        entries: [],
        diagnostics: [],
        nextCursor,
      },
    });
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}/skills/browse?path=docs%2Fguide.md`]: {
        body: outline([{ level: 1, text: "Guide", offset: 0, length: 120 }], "two"),
      },
      [`GET ${IN}/skills/browse?path=docs%2Fguide.md&cursor=two`]: {
        body: outline([{ level: 2, text: "Setup", offset: 120, length: 270 }], null),
      },
      [`GET ${IN}/skills/file?path=docs%2Fguide.md&offset=120&limit=5`]: {
        body: file("docs/guide.md", "Setup", 120, 125, 390),
      },
      [`GET ${IN}/skills/file?path=docs%2Fguide.md&limit=400`]: {
        body: file("docs/guide.md", "Whole.", 0, null, 6),
      },
    });
    // A page of the outline, with the read that takes a section named as the command; a page
    // that ends before the outline does ends with the command that reads the next, as a
    // folder's does.
    const outlined = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs/guide.md"], outlined.io)).toBe(EXIT.ok);
    const printed = outlined.out();
    expect(printed).toContain("File: docs/guide.md (390 characters; 1 heading)");
    expect(printed).toContain(
      "Outline; a section is read with console skill --file: the path, its offset and its limit.\n- # Guide (offset 0, limit 120)\n",
    );
    expect(printed.endsWith("\n\nNext page: console skills docs/guide.md --cursor two\n")).toBe(
      true,
    );
    expect(printed).not.toContain("nextCursor");
    const further = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs/guide.md", "--cursor", "two"], further.io)).toBe(EXIT.ok);
    expect(further.out()).toContain("## Setup (offset 120, limit 270)");
    expect(further.out()).not.toContain("Next page");
    expect(calls.map((call) => call.key).filter((key) => key.includes("browse"))).toEqual([
      `GET ${IN}/skills/browse?path=docs%2Fguide.md`,
      `GET ${IN}/skills/browse?path=docs%2Fguide.md&cursor=two`,
    ]);
    const json = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs/guide.md", "--json"], json.io)).toBe(EXIT.ok);
    const parsed = JSON.parse(json.out()) as {
      read: {
        outline: { headings: { text: string }[] };
        entries: unknown[];
        nextCursor: string | null;
      };
    };
    expect(parsed.read.outline.headings.map((heading) => heading.text)).toEqual(["Guide"]);
    expect(parsed.read.entries).toEqual([]);
    expect(parsed.read.nextCursor).toBe("two");
    // One section as the outline named it: the page as asked, saying where the file continues.
    const section = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["skill", "--file", "docs/guide.md", "--offset", "120", "--limit", "5"],
        section.io,
      ),
    ).toBe(EXIT.ok);
    expect(section.out()).toContain(
      "File: docs/guide.md (characters 120 to 125 of 390)\nSource: acme/skills (commit 0123456)\nThe file continues at offset 125.",
    );
    expect(section.out()).toContain("--- content ---\nSetup");
    expect(section.out()).not.toContain("More follows");
    // A limit that reaches the end of the file asks for nothing more.
    const whole = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "--file", "docs/guide.md", "--limit", "400"], whole.io)).toBe(
      EXIT.ok,
    );
    expect(whole.out()).toContain("File: docs/guide.md (6 characters)");
    expect(whole.out()).not.toContain("continues");
    // The flags go with --file, within their bounds.
    for (const args of [
      ["skill", "review/SKILL.md", "--offset", "1"],
      ["skill", "--limit", "5"],
      ["skill", "--file", "docs/guide.md", "--limit", "0"],
      ["skill", "--file", "docs/guide.md", "--limit", "100001"],
      ["skill", "--file", "docs/guide.md", "--offset", "x"],
      ["skill", "--file", "docs/guide.md", "--offset", "1.5"],
    ]) {
      const h = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(args, h.io), args.join(" ")).toBe(EXIT.usage);
    }
  });

  it("loads a skill by its folder too, says so where no skill is at a path, and names the load after a search and a listing", async () => {
    const LOAD =
      "A skill is loaded, its rules first, with console skill <the path of its SKILL.md>, a long one in parts; --file reads a file of the pack as it is, without the rules.";
    const nothing = (code: string, message: string) => ({
      ...AT,
      status: "not_found",
      refusal: { code, message, sourceUrl: null, directories: [] },
      read: null,
    });
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}/skills/one?path=review%2FSKILL.md`]: { body: PAGE_ONE },
      [`GET ${IN}/skills/one?path=review%2FSKILL.md&cursor=two`]: { body: PAGE_TWO },
      [`GET ${IN}/skills/one?path=SKILL.md`]: {
        body: nothing("skill.not_found", "No skill at that SKILL.md path."),
      },
      [`GET ${IN}/skills/one?path=docs%2Fguide.md%2FSKILL.md`]: {
        body: nothing("skill.not_found", "No skill at that SKILL.md path."),
      },
      [`GET ${IN}/skills/file?path=review%2Fnothing.md&limit=24000`]: {
        body: nothing("file.not_found", "No file at that path in this pack."),
      },
      [`GET ${IN}/skills/one?path=hidden%2FSKILL.md`]: {
        body: nothing("mount.repo_not_found", "Nothing is served here to the asker."),
      },
      [`GET ${IN}/skills/find?query=review`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            query: "review",
            path: "",
            items: [
              {
                kind: "skill",
                path: "review/SKILL.md",
                name: "review",
                directory: "review",
                description: "Reviews a change.",
                translations: {},
                files: [],
                moreFiles: 0,
                license: { kind: "permissive", name: "MIT", source: null },
              },
            ],
            diagnostics: [],
            nextCursor: null,
            totals: null,
          },
        },
      },
    });
    // A skill's folder is its skill: what a search prints beside the name is often cut there.
    for (const given of ["review", "review/", "review/SKILL.md"]) {
      const h = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["skill", given], h.io), given).toBe(EXIT.ok);
      expect(h.out(), given).toContain("Read the diff.");
      expect(calls.at(-1)?.key, given).toBe(
        `GET ${IN}/skills/one?path=review%2FSKILL.md&cursor=two`,
      );
    }
    // The root's own skill is read by the dot, as the root is everywhere.
    const root = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "."], root.io)).toBe(EXIT.failed);
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/skills/one?path=SKILL.md`);
    // No skill at the path: refused in the skillcdn command's words (ADR-0118), with the path
    // that was read, the reads that find the exact one and the skills there are; nothing of a
    // token, since the pack has just answered its listing.
    const missing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "docs/guide.md"], missing.io)).toBe(EXIT.failed);
    expect(missing.out()).toBe("");
    expect(missing.err()).toBe(
      'skill.not_found: No skill at "docs/guide.md/SKILL.md". Use console skills <folder> or console skills --search for its exact SKILL.md path. Available: review/SKILL.md.\n',
    );
    // No file at the path: the pack's own code and words, as that command prints them.
    const noFile = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "--file", "review/nothing.md"], noFile.io)).toBe(EXIT.failed);
    expect(noFile.out()).toBe("");
    expect(noFile.err()).toBe("file.not_found: No file at that path in this pack.\n");
    // A pack that stops answering between the listing and the read is still the token's to mend.
    const hidden = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "hidden"], hidden.io)).toBe(EXIT.failed);
    expect(hidden.err()).toContain("the project holds no pack token for it");
    expect(hidden.err()).toContain("Nothing is served here to the asker.");
    // --json prints what the console answered, which says the status, and ends as refused too.
    const missingJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "docs/guide.md", "--json"], missingJson.io)).toBe(EXIT.failed);
    expect(JSON.parse(missingJson.out())).toMatchObject({
      status: "not_found",
      refusal: { code: "skill.not_found" },
    });
    // After what a search found, and after the listing, how a skill is loaded: the pack's own
    // footer names how a section is read, and a skill read as a file comes without its rules.
    const found = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "--search", "review"], found.io)).toBe(EXIT.ok);
    expect(found.out()).toContain("skill: review (review/SKILL.md)");
    expect(found.out().endsWith(`\n${LOAD}\n`)).toBe(true);
    const listed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toContain(`\n${LOAD}\nThe plugins of this console have skills`);
    // What a program takes carries no such line.
    const json = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "--search", "review", "--json"], json.io)).toBe(EXIT.ok);
    expect(json.out()).not.toContain("A skill is loaded");
  });

  it("prints a listing longer than one read in pages, each ending with the command that lists the rest (SkillCDN 0.6.2)", async () => {
    // Four hundred skills described in Hangul, three bytes a character: some sixty thousand
    // bytes, more than twice what a host shows of one command. The documents outside them are
    // counted and not listed (SkillCDN 0.6.3), however many there are.
    const skills = Array.from({ length: 400 }, (_, at) => {
      const directory = `skills/skill-${String(at).padStart(3, "0")}`;
      return {
        path: `${directory}/SKILL.md`,
        name: `skill-${at}`,
        directory,
        description: "가".repeat(40),
        warnings: [],
        translations: {},
      };
    });
    const documents = Array.from({ length: 300 }, (_, at) => ({
      path: `docs/page-${String(at).padStart(3, "0")}.md`,
      title: `Page ${at}`,
      summary: "가".repeat(40),
    }));
    const long = {
      ...LISTING,
      counts: { skills: skills.length, documents: documents.length },
      mount: {
        ...MOUNT,
        index: {
          ...MOUNT.index,
          skillCount: skills.length,
          documentCount: documents.length,
          skills,
          documents,
        },
      },
    };
    const { fetch, calls } = fakeConsole({ [`GET ${IN}/skills`]: { body: long } });
    const bytes = (text: string): number => new TextEncoder().encode(text).length;
    const page = async (...more: string[]): Promise<string> => {
      const ran = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["skills", ...more], ran.io), more.join(" ")).toBe(EXIT.ok);
      return ran.out();
    };
    const first = await page();
    // The whole output is one a host shows whole, the console's own lines counted with it.
    expect(bytes(first)).toBeLessThanOrEqual(28_000 + 1);
    // The console's lines stand above the listing here, so that the last line is the command.
    expect(
      first.startsWith("skills at /gh/acme/skills, served by https://skillcdn.test: ready\n"),
    ).toBe(true);
    const numbered = first.indexOf("1. skill: skill-0 (skills/skill-000/SKILL.md)");
    expect(numbered).toBeGreaterThan(0);
    expect(first.indexOf("A skill is loaded, its rules first")).toBeLessThan(numbered);
    expect(first.indexOf("The plugins of this console have skills")).toBeLessThan(numbered);
    // The first page counts what the pack holds, says how many skills are left to the command
    // below it, and leaves the documents to the commands that read them.
    expect(first).toContain("400 skills and 300 documents in acme/skills (commit 0123456):");
    expect(first).toMatch(/\n\d+ skills are outside this page; the command below continues\.\n/);
    expect(first).toContain("The 300 documents outside the skills are not listed here: ");
    const next = /\n\nThe listing goes on: (console skills --cursor (\S+))\n$/.exec(first);
    expect(next, first.slice(-200)).not.toBeNull();
    // Every page from a cursor is the pack's own words alone, within the bound, and the last
    // says that it is the last.
    const seen = [first];
    let cursor = next?.[2];
    while (cursor !== undefined) {
      const more = await page("--cursor", cursor);
      expect(bytes(more)).toBeLessThanOrEqual(28_000 + 1);
      expect(more.startsWith("Continued from the page before. This page lists:\n")).toBe(true);
      expect(more).not.toContain("A skill is loaded");
      seen.push(more);
      cursor = /\n\nThe listing goes on: console skills --cursor (\S+)\n$/.exec(more)?.[1];
      expect(seen.length).toBeLessThan(10);
    }
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.at(-1)?.endsWith("The listing is complete: this was its last page.\n")).toBe(true);
    // No skill is listed twice and none is left out, and no document is listed on any page.
    const listed = seen.join("\n").match(/\d+\. skill: \S+ \((skills\/skill-\d{3}\/SKILL\.md)\)/g);
    expect(listed?.map((line) => line.replace(/^.*\(|\)$/g, ""))).toEqual(
      skills.map((skill) => skill.path),
    );
    expect(seen.join("\n")).not.toContain("docs/page-");
    // One answer of the console for each command: the pages are cut from it here.
    expect(calls.every((call) => call.key === `GET ${IN}/skills`)).toBe(true);
    // The next page is asked as this one was.
    const given = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "--project", "web"], given.io)).toBe(EXIT.ok);
    expect(given.out()).toMatch(
      /\nThe listing goes on: console skills --cursor \S+ --project web\n$/,
    );
    // A cursor of another index, or one that is none, is refused in the pack's words.
    for (const wrong of ["12-ffffffffffff", "nonsense", "0-0123456789ab", "9999-0123456789ab"]) {
      const refused = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["skills", "--cursor", wrong], refused.io), wrong).toBe(EXIT.failed);
      expect(refused.out()).toBe("");
      expect(refused.err()).toContain("request.invalid: This continuation does not match");
    }
    // --json is the console's answer, whole, as before.
    const json = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "--json"], json.io)).toBe(EXIT.ok);
    expect((JSON.parse(json.out()) as typeof long).mount.index.documents).toHaveLength(300);
    // A length is still a folder's or a search's to take.
    const limited = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "--limit", "5"], limited.io)).toBe(EXIT.usage);
    expect(limited.err()).toContain("--limit goes with a folder or with --search");
  });

  it("reads the organization's pack where no project is named, and says whose pack it is (ADR-0113)", async () => {
    const ORG = "/api/v1/workspace/skills";
    const LINE =
      "The organization's pack, since no project is named here: --project <key>, or a directory bound with console use <key>, reads a project's own.\n";
    const pair = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" };
    const { fetch, calls } = fakeConsole({
      [`GET ${ORG}`]: { body: LISTING },
      [`GET ${ORG}/one?path=review%2FSKILL.md`]: { body: PAGE_ONE },
      [`GET ${ORG}/one?path=review%2FSKILL.md&cursor=two`]: { body: PAGE_TWO },
      [`GET ${ORG}/file?path=review%2Fguide.md&limit=24000`]: {
        body: file("review/guide.md", "How to review.", 0, null, 14),
      },
      [`GET ${ORG}/find?query=review&limit=5`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            query: "review",
            path: "",
            items: [],
            diagnostics: [],
            nextCursor: null,
            totals: null,
          },
        },
      },
      [`GET ${ORG}/rows?path=docs%2Fcodes.md&limit=5000`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            path: "docs/codes.md",
            tables: [
              { path: "docs/codes.md", heading: ["Codes"], columns: ["Code"], rows: [["A1"]] },
            ],
            rowCount: 1,
            nextCursor: null,
          },
        },
      },
      // A project is named in another directory: its own pack, as before.
      [`GET ${IN}/skills`]: { body: LISTING },
    });
    // The listing: the line first, then the pack as a project's is listed.
    const listed = harness({
      fetch,
      env: pair,
      skillsDir: "/usr/lib/node_modules/@skillcdn/console/skills/",
    });
    expect(await runCli(["skills"], listed.io)).toBe(EXIT.ok);
    expect(listed.out().startsWith(LINE)).toBe(true);
    expect(listed.out()).toContain(
      "skills at /gh/acme/skills, served by https://skillcdn.test: ready",
    );
    expect(listed.out()).toContain(
      "The console's own skills, for working the board and keeping a desk: /usr/lib/node_modules/@skillcdn/console/skills/",
    );
    // A skill whole, a file and a search, each under the line.
    const loaded = harness({ fetch, env: pair });
    expect(await runCli(["skill", "review/SKILL.md"], loaded.io)).toBe(EXIT.ok);
    expect(loaded.out().startsWith(`${LINE}Skill: review\n`)).toBe(true);
    expect(loaded.out()).toContain("Read the diff.");
    const read = harness({ fetch, env: pair });
    expect(await runCli(["skill", "--file", "review/guide.md"], read.io)).toBe(EXIT.ok);
    expect(read.out().startsWith(LINE)).toBe(true);
    expect(read.out()).toContain("--- content ---\nHow to review.");
    const found = harness({ fetch, env: pair });
    expect(await runCli(["skills", "--search", "review", "--limit", "5"], found.io)).toBe(EXIT.ok);
    expect(found.out().startsWith(LINE)).toBe(true);
    // What a program takes carries no line: the tables as data, and --json.
    const data = harness({ fetch, env: pair });
    expect(await runCli(["skills", "--rows", "docs/codes.md"], data.io)).toBe(EXIT.ok);
    expect(data.out()).toBe("path,heading,Code\r\ndocs/codes.md,Codes,A1\r\n");
    const json = harness({ fetch, env: pair });
    expect(await runCli(["skills", "--json"], json.io)).toBe(EXIT.ok);
    expect(JSON.parse(json.out())).toMatchObject({ address: "/gh/acme/skills", status: "ready" });
    // Every read went to the workspace's routes, and none to a project's.
    expect(calls.map((call) => call.key)).toEqual([
      `GET ${ORG}`,
      `GET ${ORG}`,
      `GET ${ORG}/one?path=review%2FSKILL.md`,
      `GET ${ORG}/one?path=review%2FSKILL.md&cursor=two`,
      `GET ${ORG}`,
      `GET ${ORG}/file?path=review%2Fguide.md&limit=24000`,
      `GET ${ORG}`,
      `GET ${ORG}/find?query=review&limit=5`,
      `GET ${ORG}`,
      `GET ${ORG}/rows?path=docs%2Fcodes.md&limit=5000`,
      `GET ${ORG}`,
    ]);
    // A project named, by the flag here: its own pack, and no line.
    const named = harness({ fetch, env: pair });
    expect(await runCli(["skills", "--project", "web"], named.io)).toBe(EXIT.ok);
    expect(named.out()).not.toContain("The organization's pack");
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/skills`);
    // A pack that is not served, or whose token went stale, is the workspace's to mend, by an
    // administrator; and no address is the console's to name.
    const refusal = (status: string) =>
      fakeConsole({
        [`GET ${ORG}`]: {
          body: {
            ...LISTING,
            status,
            refusal: null,
            items: [],
            mount: null,
            ...(status === "none" ? { address: null, page: null } : {}),
          },
        },
      }).fetch;
    const hidden = harness({ fetch: refusal("not_found"), env: pair });
    expect(await runCli(["skills"], hidden.io)).toBe(EXIT.failed);
    expect(hidden.out()).toBe("");
    // Whose pack it is comes first on a refusal too.
    expect(hidden.err().startsWith(LINE)).toBe(true);
    expect(hidden.err()).toContain(
      "the organization's pack is private and the workspace holds no SkillCDN token for it (console workspace pack-token --connect, for an administrator)",
    );
    expect(hidden.err()).not.toContain("console project pack-token");
    const stale = harness({ fetch: refusal("token_invalid"), env: pair });
    expect(await runCli(["skill", "review/SKILL.md"], stale.io)).toBe(EXIT.failed);
    expect(stale.err()).toContain(
      "The SkillCDN token the workspace holds no longer works at the deployment: an administrator sets a new one (console workspace pack-token --connect).",
    );
    const none = harness({ fetch: refusal("none"), env: pair });
    expect(await runCli(["skills"], none.io)).toBe(EXIT.failed);
    expect(none.err()).toContain(
      "No skills address: the console names none for the organization's skills, and no project is named here.",
    );
  });

  it("takes the tables and the code blocks of the pack as data: the pages joined, one CSV or the blocks as written, printed or written to a file (ADR-0100)", async () => {
    const table = (path: string, heading: string, rows: string[][]) => ({
      path,
      heading: ["Codes", heading],
      columns: ["Code", "Meaning"],
      rows,
    });
    const rowsPage = (tables: unknown[], rowCount: number, nextCursor: string | null) => ({
      ...AT,
      read: { status: "ready", commit: COMMIT, path: "docs/annex", tables, rowCount, nextCursor },
    });
    const refused = {
      ...AT,
      status: "not_found",
      refusal: {
        code: "file.not_found",
        message: "No Markdown document at that path in this mount, and none under it.",
        sourceUrl: null,
        directories: [],
      },
      read: null,
    };
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}/skills/rows?path=docs%2Fannex&limit=5000`]: {
        body: rowsPage(
          [
            table("docs/annex/codes-1.md", "A to B", [
              ["A1", "Starts"],
              ["B1", 'Says "stop", then stops'],
            ]),
          ],
          2,
          "two",
        ),
      },
      [`GET ${IN}/skills/rows?path=docs%2Fannex&cursor=two&limit=5000`]: {
        body: rowsPage([table("docs/annex/codes-2.md", "C to D", [["C1", "Waits"]])], 1, null),
      },
      [`GET ${IN}/skills/rows?path=docs%2Fannex&heading=C+to+D&limit=5000`]: {
        body: rowsPage([table("docs/annex/codes-2.md", "C to D", [["C1", "Waits"]])], 1, null),
      },
      [`GET ${IN}/skills/rows?path=docs%2Fempty.md&limit=5000`]: { body: rowsPage([], 0, null) },
      [`GET ${IN}/skills/rows?path=nothing&limit=5000`]: { body: refused },
      [`GET ${IN}/skills/rows?path=endless&limit=5000`]: {
        body: rowsPage([table("endless/a.md", "A", [["A1", "Starts"]])], 1, "again"),
      },
      [`GET ${IN}/skills/rows?path=endless&cursor=again&limit=5000`]: {
        body: rowsPage([table("endless/a.md", "A", [["A1", "Starts"]])], 1, "again"),
      },
      [`GET ${IN}/skills/code?limit=500`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            path: "",
            blocks: [
              {
                path: "docs/annex/codes-1.md",
                heading: ["Codes", "A to B"],
                language: "sh",
                text: "machine --start",
              },
              { path: "docs/notes.md", heading: [], language: "", text: "as written\n" },
            ],
            nextCursor: null,
          },
        },
      },
      [`GET ${IN}/skills/code?path=nothing&limit=500`]: { body: refused },
      [`GET ${IN}/skills/browse?path=docs%2Fannex%2Fcodes-1.md`]: {
        body: {
          ...AT,
          read: {
            status: "ready",
            commit: COMMIT,
            path: "docs/annex/codes-1.md",
            outline: {
              path: "docs/annex/codes-1.md",
              size: 400,
              totalLength: 390,
              headings: [],
              truncated: false,
              tables: { count: 1, rows: 2 },
              codeBlocks: 1,
              data: {
                rows: `${IN}/skills/rows?path=docs%2Fannex%2Fcodes-1.md`,
                code: `${IN}/skills/code?path=docs%2Fannex%2Fcodes-1.md`,
              },
            },
            entries: [],
            diagnostics: [],
            nextCursor: null,
          },
        },
      },
    });
    const run = async (args: string[], overrides: Partial<CliIo> = {}) => {
      const h = harness({ fetch, env: SIGNED_IN, ...overrides });
      return { code: await runCli(args, h.io), out: h.out(), err: h.err() };
    };
    // The tables under a folder as one CSV: every page the console answers, joined, a table
    // written in two files coming out under one header, a cell with a comma or a quote quoted.
    const csv = await run(["skills", "--rows", "docs/annex"]);
    expect(csv.code).toBe(EXIT.ok);
    expect(csv.out).toBe(
      [
        "path,heading,Code,Meaning",
        "docs/annex/codes-1.md,Codes > A to B,A1,Starts",
        'docs/annex/codes-1.md,Codes > A to B,B1,"Says ""stop"", then stops"',
        "docs/annex/codes-2.md,Codes > C to D,C1,Waits",
        "",
      ].join("\r\n"),
    );
    expect(calls.map((call) => call.key).filter((key) => key.includes("/rows"))).toEqual([
      `GET ${IN}/skills/rows?path=docs%2Fannex&limit=5000`,
      `GET ${IN}/skills/rows?path=docs%2Fannex&cursor=two&limit=5000`,
    ]);
    // Under a heading; and as the console answered it, the pages joined.
    const under = await run(["skills", "--rows", "docs/annex", "--heading", "C to D"]);
    expect(under.out).toContain("docs/annex/codes-2.md,Codes > C to D,C1,Waits");
    expect(under.out).not.toContain("codes-1.md");
    const json = await run(["skills", "--rows", "docs/annex", "--json"]);
    const parsed = JSON.parse(json.out) as {
      status: string;
      read: { tables: { path: string }[]; rowCount: number; nextCursor: string | null };
    };
    expect(parsed.status).toBe("ready");
    expect(parsed.read.tables.map((one) => one.path)).toEqual([
      "docs/annex/codes-1.md",
      "docs/annex/codes-2.md",
    ]);
    expect(parsed.read.rowCount).toBe(3);
    expect(parsed.read.nextCursor).toBeNull();
    // Written to a file instead, with how much it holds said.
    const written: { path: string; text: string; name: string }[] = [];
    const saved = await run(["skills", "--rows", "docs/annex", "--out", "codes.csv"], {
      writeBytes: async (path, bytes, name) => {
        written.push({ path, text: new TextDecoder().decode(bytes), name });
        return `/work/${path}`;
      },
    });
    expect(saved.code).toBe(EXIT.ok);
    // In the skillcdn command's words (ADR-0118).
    expect(saved.out).toBe("Wrote 3 rows of 2 tables to /work/codes.csv.\n");
    expect(written).toEqual([{ path: "codes.csv", text: csv.out, name: "rows.csv" }]);
    // As an array of rows, each with its file, its section and its cells by column name, as
    // that command's --format json prints them.
    const asJson = await run(["skills", "--rows", "docs/annex", "--format", "json"]);
    expect(asJson.code).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out)).toEqual([
      {
        path: "docs/annex/codes-1.md",
        heading: "Codes > A to B",
        cells: { Code: "A1", Meaning: "Starts" },
      },
      {
        path: "docs/annex/codes-1.md",
        heading: "Codes > A to B",
        cells: { Code: "B1", Meaning: 'Says "stop", then stops' },
      },
      {
        path: "docs/annex/codes-2.md",
        heading: "Codes > C to D",
        cells: { Code: "C1", Meaning: "Waits" },
      },
    ]);
    expect((await run(["skills", "--rows", "docs/annex", "--format", "xml"])).code).toBe(
      EXIT.usage,
    );
    expect((await run(["skills", "--code", "--format", "json"])).code).toBe(EXIT.usage);
    const unwritable = await run(["skills", "--rows", "docs/annex", "--out", "/nowhere/x.csv"]);
    expect(unwritable.code).toBe(EXIT.failed);
    expect(unwritable.err).toContain("The file could not be written at /nowhere/x.csv.");
    // The code blocks of the whole pack, as written, each under a line that says where it stands.
    const code = await run(["skills", "--code"]);
    expect(code.code).toBe(EXIT.ok);
    // Printed as the skillcdn command prints them: the line that names a block closed as it opens.
    expect(code.out).toBe(
      "--- docs/annex/codes-1.md > Codes > A to B (sh) ---\nmachine --start\n\n--- docs/notes.md ---\nas written\n\n",
    );
    // --grep keeps the blocks whose text matches, a regular expression run on this machine.
    const kept = await run(["skills", "--code", "--grep", "^machine"]);
    expect(kept.out).toBe("--- docs/annex/codes-1.md > Codes > A to B (sh) ---\nmachine --start\n");
    const unkept = await run(["skills", "--code", "--grep", "("]);
    expect(unkept.code).toBe(EXIT.usage);
    expect(unkept.err).toContain("--grep takes a regular expression");
    expect((await run(["skills", "--rows", "docs/annex", "--grep", "x"])).code).toBe(EXIT.usage);
    // No table is a CSV of its header alone, as the skillcdn command prints it, which a
    // program takes as it is; a line beside it, on standard error, says that there is none.
    const empty = await run(["skills", "--rows", "docs/empty.md"]);
    expect(empty.code).toBe(EXIT.ok);
    expect(empty.out).toBe("path,heading\r\n");
    expect(empty.err).toBe("No tables in docs/empty.md.\n");
    // What the pack refuses fails, on standard error, so that a file a program takes is never
    // a refusal; and so does a read that does not reach its end.
    for (const what of ["--rows", "--code"]) {
      const missing = await run(["skills", what, "nothing"]);
      expect(missing.code, what).toBe(EXIT.failed);
      expect(missing.out).toBe("");
      // The pack's own code and words, as the skillcdn command prints a refusal.
      expect(missing.err).toBe(
        "file.not_found: No Markdown document at that path in this mount, and none under it.\n",
      );
    }
    const endless = await run(["skills", "--rows", "endless"]);
    expect(endless.code).toBe(EXIT.failed);
    expect(endless.out).toBe("");
    expect(endless.err).toContain(
      "invalid_response: The tables under endless are more than the command reads at once (64 pages): name a folder or a file under it.",
    );
    // A document's outline names the two reads as commands; --json keeps what the console said.
    const outlined = await run(["skills", "docs/annex/codes-1.md"]);
    expect(outlined.out).toContain(
      "Tables: 1 with 2 rows; as data: console skills --rows docs/annex/codes-1.md",
    );
    expect(outlined.out).toContain(
      "Code blocks: 1; as data: console skills --code docs/annex/codes-1.md",
    );
    const outline = await run(["skills", "docs/annex/codes-1.md", "--json"]);
    expect(
      (JSON.parse(outline.out) as { read: { outline: { data: unknown } } }).read.outline.data,
    ).toEqual({
      rows: `${IN}/skills/rows?path=docs%2Fannex%2Fcodes-1.md`,
      code: `${IN}/skills/code?path=docs%2Fannex%2Fcodes-1.md`,
    });
    // One of the two, without a search, and the flags of theirs with them.
    for (const args of [
      ["skills", "--rows", "--code", "docs"],
      ["skills", "--rows", "docs", "--search", "codes"],
      ["skills", "--code", "docs", "--limit", "5"],
      ["skills", "docs", "--heading", "Codes"],
      ["skills", "docs", "--out", "codes.csv"],
      ["skills", "--rows", "docs", "more"],
    ]) {
      expect((await run(args)).code, args.join(" ")).toBe(EXIT.usage);
    }
  });

  /** A page of a long skill: `length` characters of one letter, and the cursor of the next page, or the end. */
  const longPage = (letter: string, length: number, nextCursor: string | null) => ({
    ...AT,
    read: {
      status: "ready",
      commit: COMMIT,
      skill: {
        ...SKILL,
        ruleChain:
          letter === "a" ? [{ path: "SKILLCDN.md", body: "Be kind.", truncated: false }] : [],
        rules: { path: "SKILLCDN.md", body: "Be kind.", truncated: false },
        body: `${letter.repeat(length)}\n`,
        complete: nextCursor === null,
        nextCursor,
      },
    },
  });

  it("prints how many pages of a skill follow a part, where the pack counts them, and that the last part is the last, in the skillcdn command's words", async () => {
    // Five pages of twelve thousand characters, two a part, and the pack says of each page how
    // many follow it, as one of SkillCDN 0.6.1 does.
    const page = (letter: string, nextCursor: string | null, pagesLeft: number) => {
      const answer = longPage(letter, 12_000, nextCursor);
      return { ...answer, read: { ...answer.read, skill: { ...answer.read.skill, pagesLeft } } };
    };
    const ONE = "/skills/one?path=review%2FSKILL.md";
    const { fetch } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}${ONE}`]: { body: page("a", "two", 4) },
      [`GET ${IN}${ONE}&cursor=two`]: { body: page("b", "three", 3) },
      [`GET ${IN}${ONE}&cursor=three`]: { body: page("c", "four", 2) },
      [`GET ${IN}${ONE}&cursor=four`]: { body: page("d", "five", 1) },
      [`GET ${IN}${ONE}&cursor=five`]: { body: page("e", null, 0) },
    });
    const part = async (cursor?: string): Promise<string> => {
      const ran = harness({ fetch, env: SIGNED_IN });
      expect(
        await runCli(
          ["skill", "review", ...(cursor === undefined ? [] : ["--cursor", cursor])],
          ran.io,
        ),
      ).toBe(EXIT.ok);
      return ran.out();
    };
    // The first part holds two pages: what follows it is what follows its second page, and
    // not the page that was asked for to know that it did not fit.
    const first = await part();
    expect(endsWithNext(first, "console skill review --cursor three")).toBe(true);
    expect(first).toContain("3 more pages follow this part");
    const second = await part("three");
    expect(endsWithNext(second, "console skill review --cursor five")).toBe(true);
    expect(second).toContain("1 more page follows this part");
    // The last part says that it is: the end is said, and not only what is missing.
    const last = await part("five");
    expect(last).toContain("e".repeat(12_000));
    expect(last.endsWith(`\n\n${LAST_PART}`)).toBe(true);
    expect(last).not.toContain("This part ends before");
    expect(last).not.toContain("more page");
    // The words are said once, by the library: the console's own sentence after them is gone.
    for (const printed of [first, second, last]) {
      expect(printed).not.toContain("This part stops in the middle");
      expect(printed).not.toContain("The skill is complete: this was its last part.");
    }
  });

  it("ends a skill of several pages that prints whole with none of a part's words", async () => {
    // Three pages that fit together in what a host shows whole. The library tries the first two
    // before it has the third, and asks for the line that would read on from them: a line that
    // is then not printed, and that the command once took for a part that goes on.
    const page = (letter: string, nextCursor: string | null) => longPage(letter, 6_000, nextCursor);
    const ONE = "/skills/one?path=review%2FSKILL.md";
    const { fetch } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}${ONE}`]: { body: page("a", "two") },
      [`GET ${IN}${ONE}&cursor=two`]: { body: page("b", "three") },
      [`GET ${IN}${ONE}&cursor=three`]: { body: page("c", null) },
    });
    const whole = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "review"], whole.io)).toBe(EXIT.ok);
    const printed = whole.out();
    expect(printed).toContain("a".repeat(6_000));
    expect(printed).toContain("c".repeat(6_000));
    expect(printed).not.toContain("This part ends before");
    expect(printed).not.toContain("Skill context is incomplete");
    // Read in one command, it is whole as any short skill is, and says nothing of parts.
    expect(printed).not.toContain("this was its last part");
  });

  it("prints a long skill in parts a host shows whole, each ending with the command that reads the next (ADR-0124)", async () => {
    // Three pages of twelve thousand characters each: two fit in what a host shows whole, the
    // third does not.
    const page = (letter: string, nextCursor: string | null) =>
      longPage(letter, 12_000, nextCursor);
    const ONE = "/skills/one?path=review%2FSKILL.md";
    const table = (root: string) => ({
      [`GET ${root}${ONE}`]: { body: page("a", "two") },
      [`GET ${root}${ONE}&cursor=two`]: { body: page("b", "three") },
      [`GET ${root}${ONE}&cursor=three`]: { body: page("c", null) },
    });
    const { fetch, calls } = fakeConsole({ [`GET ${IN}/skills`]: { body: LISTING }, ...table(IN) });
    const first = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "review"], first.io)).toBe(EXIT.ok);
    const part = first.out();
    // The first part: as many pages as fit, said to be incomplete at its head, and the command
    // that reads the next as its last line, with the skill as it was named.
    expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(28_000 + 1);
    expect(part).toContain(
      "Skill context is incomplete. Read the next part before using it: console skill review --cursor three",
    );
    expect(part).toContain("a".repeat(12_000));
    expect(part).toContain("b".repeat(12_000));
    expect(part).not.toContain("ccc");
    expect(endsWithNext(part, "console skill review --cursor three")).toBe(true);
    // The page that did not fit was asked for, to know it, and is asked again with its part.
    expect(calls.map((call) => call.key)).toEqual([
      `GET ${IN}/skills`,
      `GET ${IN}${ONE}`,
      `GET ${IN}${ONE}&cursor=two`,
      `GET ${IN}${ONE}&cursor=three`,
    ]);
    // The next part, from the cursor: the rest, and nothing more to read.
    const second = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "review", "--cursor", "three"], second.io)).toBe(EXIT.ok);
    expect(second.out()).toContain("c".repeat(12_000));
    expect(second.out()).not.toContain("aaa");
    expect(second.out()).not.toContain("This part ends before");
    expect(second.out()).not.toContain("Skill context is incomplete");
    expect(second.out().endsWith(LAST_PART)).toBe(true);
    // The next part is asked as this one was: the project, the console and the account as given.
    const given = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "review/SKILL.md", "--project", "web"], given.io)).toBe(EXIT.ok);
    expect(
      endsWithNext(given.out(), "console skill review/SKILL.md --cursor three --project web"),
    ).toBe(true);
    // --json is the console's answer with the skill whole in it, as the skillcdn command's is.
    const json = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "review", "--json"], json.io)).toBe(EXIT.ok);
    const whole = JSON.parse(json.out()) as {
      status: string;
      read: { skill: { body: string; complete: boolean } };
    };
    expect(whole.status).toBe("ready");
    expect(whole.read.skill.body).toBe(
      `${"a".repeat(12_000)}\n${"b".repeat(12_000)}\n${"c".repeat(12_000)}\n`,
    );
    expect(whole.read.skill.complete).toBe(true);
    // A cursor goes with a skill; a file reads on from an offset.
    const mixed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "--file", "review/guide.md", "--cursor", "two"], mixed.io)).toBe(
      EXIT.usage,
    );
    expect(mixed.err()).toContain("--cursor reads the next part of a skill");
    // The organization's pack: the part under its line, and the next asked the same way.
    const ORG = "/api/v1/workspace/skills";
    const organization = fakeConsole({
      [`GET ${ORG}`]: { body: LISTING },
      [`GET ${ORG}/one?path=review%2FSKILL.md`]: { body: page("a", "two") },
      [`GET ${ORG}/one?path=review%2FSKILL.md&cursor=two`]: { body: page("b", "three") },
      [`GET ${ORG}/one?path=review%2FSKILL.md&cursor=three`]: { body: page("c", null) },
    });
    const unbound = harness({
      fetch: organization.fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
    });
    expect(await runCli(["skill", "review"], unbound.io)).toBe(EXIT.ok);
    expect(
      unbound.out().startsWith("The organization's pack, since no project is named here"),
    ).toBe(true);
    expect(endsWithNext(unbound.out(), "console skill review --cursor three")).toBe(true);
    // The line the console prints above the part is counted with it: the whole stays one a host shows whole.
    expect(new TextEncoder().encode(unbound.out()).length).toBeLessThanOrEqual(28_000 + 1);
    // A plugin's pack is read with the plugin's own commands, and its parts name them.
    const PLUGIN = "/api/v1/plugins/hello";
    const plugin = fakeConsole({
      [`GET ${PLUGIN}/skills`]: { body: LISTING },
      ...table(PLUGIN),
      [`GET ${PLUGIN}/skills/one?path=nothing%2FSKILL.md`]: {
        body: {
          ...AT,
          status: "not_found",
          refusal: {
            code: "skill.not_found",
            message: "No skill at that SKILL.md path.",
            sourceUrl: null,
            directories: [],
          },
          read: null,
        },
      },
    });
    const ofPlugin = harness({ fetch: plugin.fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "skill", "review"], ofPlugin.io)).toBe(EXIT.ok);
    expect(ofPlugin.out()).toContain("readable with console plugin hello skill --file");
    expect(endsWithNext(ofPlugin.out(), "console plugin hello skill review --cursor three")).toBe(
      true,
    );
    const rest = harness({ fetch: plugin.fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "skill", "review", "--cursor", "three"], rest.io)).toBe(
      EXIT.ok,
    );
    expect(rest.out()).toContain("c".repeat(12_000));
    const missing = harness({ fetch: plugin.fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "skill", "nothing"], missing.io)).toBe(EXIT.failed);
    expect(missing.err()).toBe(
      'skill.not_found: No skill at "nothing/SKILL.md". Use console plugin hello skills <folder> or console plugin hello skills --search for its exact SKILL.md path. Available: review/SKILL.md.\n',
    );
  });

  it("names a skill's own folder by the command that lists it, where the skill does not list every file (SkillCDN 0.6.3)", async () => {
    // A skill whose files are more than it lists: the line that says where the rest are is one
    // a shell runs, in the commands of the pack that was read, asked as the skill was.
    const cut = (directory: string) => ({
      ...AT,
      read: {
        status: "ready",
        commit: COMMIT,
        skill: {
          ...SKILL,
          path: directory === "" ? "SKILL.md" : `${directory}/SKILL.md`,
          directory,
          ruleChain: [],
          references: [],
          body: "Read the diff.",
          files: [`${directory === "" ? "" : `${directory}/`}guide.md`],
          filesTruncated: true,
          complete: true,
          nextCursor: null,
        },
      },
    });
    const one = (path: string) => `/skills/one?${new URLSearchParams({ path })}`;
    const PLUGIN = "/api/v1/plugins/hello";
    const { fetch } = fakeConsole({
      [`GET ${IN}/skills`]: { body: LISTING },
      [`GET ${IN}${one("review/SKILL.md")}`]: { body: cut("review") },
      [`GET ${IN}${one("SKILL.md")}`]: { body: cut("") },
      [`GET ${IN}${one("it's here/SKILL.md")}`]: { body: cut("it's here") },
      [`GET ${IN}${one("it's $here/SKILL.md")}`]: { body: cut("it's $here") },
      [`GET ${PLUGIN}/skills`]: { body: LISTING },
      [`GET ${PLUGIN}${one("review/SKILL.md")}`]: { body: cut("review") },
    });
    const folderLine = async (...args: string[]): Promise<string> => {
      const ran = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(args, ran.io), args.join(" ")).toBe(EXIT.ok);
      const line = /\n- \.\.\. \((.*) for all supporting files\)\n/.exec(ran.out());
      expect(line, ran.out()).not.toBeNull();
      // Never the call of a tool, which a reader of a command cannot run.
      expect(ran.out()).not.toContain('{"path"');
      expect(ran.out()).not.toContain("<folder>");
      return line?.[1] ?? "";
    };
    expect(await folderLine("skill", "review")).toBe("console skills review");
    // The root is the dot: the command without a folder is the listing.
    expect(await folderLine("skill", "SKILL.md")).toBe("console skills .");
    // Where the pack is read is said again, and a plugin's pack is listed by the plugin's command.
    expect(await folderLine("skill", "review", "--project", "web")).toBe(
      "console skills review --project web",
    );
    expect(await folderLine("plugin", "hello", "skill", "review")).toBe(
      "console plugin hello skills review",
    );
    // A folder spelled for both shells, and words in place of a line where no spelling serves both.
    expect(await folderLine("skill", "it's here")).toBe('console skills "it\'s here"');
    expect(await folderLine("skill", "it's $here")).toBe(
      `console skills with this skill's folder, quoted for your shell. ${NO_LINE_TO_RUN}`,
    );
  });

  it("spells the command that reads the next part so that bash and PowerShell run it as it is, or prints none where no spelling serves both", async () => {
    const page = (letter: string, nextCursor: string | null) =>
      longPage(letter, 12_000, nextCursor);
    const partOf = async (path: string, more: readonly string[] = []) => {
      const one = (cursor?: string) =>
        `GET ${IN}/skills/one?${new URLSearchParams(cursor === undefined ? { path } : { path, cursor })}`;
      const { fetch } = fakeConsole({
        [`GET ${IN}/skills`]: { body: LISTING },
        [one()]: { body: page("a", "two") },
        [one("two")]: { body: page("b", "three") },
        [one("three")]: { body: page("c", null) },
      });
      const run = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["skill", path, ...more], run.io), path).toBe(EXIT.ok);
      // The command that reads the next part is the last line printed, alone on it.
      const out = run.out().trimEnd();
      return out.slice(out.lastIndexOf("\n") + 1);
    };
    // `$`, a backtick and parentheses, which bash and PowerShell expand inside double quotes,
    // and a space: in single quotes, inside which neither reads anything.
    expect(await partOf("skills/$(x) `y` $HOME/SKILL.md")).toBe(
      "console skill 'skills/$(x) `y` $HOME/SKILL.md' --cursor three",
    );
    // A single quote: in double quotes, where nothing else in the path is read by either.
    expect(await partOf("skills/it's (draft)/SKILL.md")).toBe(
      `console skill "skills/it's (draft)/SKILL.md" --cursor three`,
    );
    // The flags that say where the pack is read are spelled the same way.
    expect(await partOf("review/SKILL.md", ["--project", "web", "--account", "it's me"])).toBe(
      `console skill review/SKILL.md --cursor three --project web --account "it's me"`,
    );
    // A single quote with `$`: no one spelling keeps it whole in both, so no line is printed,
    // and the next part is still said, with why.
    const none = await partOf("skills/it's $(x)/SKILL.md");
    expect(none).toBe(
      `the command you ran, with --cursor three in place of any it had, each word quoted for your shell. ${NO_LINE_TO_RUN}`,
    );
  });

  it("connects the pack with a code a person approves at SkillCDN, printing the page and the code and waiting", async () => {
    const started = {
      code: "ABCD-EFGH",
      url: "https://skillcdn.test/connect/ABCD-EFGH",
      expiresAt: WHEN,
      intervalSeconds: 1,
    };
    const { fetch, calls } = fakeConsole({
      [`POST ${IN}/pack-token/connect`]: { status: 201, body: started },
      [`POST ${IN}/pack-token/connect/claim`]: [
        { body: { status: "pending", ...started } },
        { body: { status: "connected", project: { ...PROJECT, packToken: { setAt: WHEN } } } },
      ],
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "pack-token", "web", "--connect"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("the code ABCD-EFGH");
    expect(h.out()).toContain("https://skillcdn.test/connect/ABCD-EFGH");
    expect(h.out()).toContain("Connected.");
    expect(h.out()).toContain("pack token: set");
    expect(calls.filter((call) => call.key === `POST ${IN}/pack-token/connect/claim`)).toHaveLength(
      2,
    );
    const declined = harness({
      fetch: fakeConsole({
        [`POST ${IN}/pack-token/connect`]: { status: 201, body: started },
        [`POST ${IN}/pack-token/connect/claim`]: { body: { status: "ended", reason: "declined" } },
      }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["project", "pack-token", "web", "--connect"], declined.io)).toBe(
      EXIT.failed,
    );
    expect(declined.err()).toContain("declined");
    const both = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "pack-token", "web", "--connect", "--stdin"], both.io)).toBe(
      EXIT.usage,
    );
  });

  it("gives the project its pack token from standard input and never an argument, and takes it away", async () => {
    const { fetch, calls } = fakeConsole({
      [`PUT ${IN}/pack-token`]: { body: { ...PROJECT, packToken: { setAt: WHEN } } },
      [`DELETE ${IN}/pack-token`]: { body: PROJECT },
    });
    const h = harness({ fetch, env: SIGNED_IN, readStdin: async () => "scdn_repo_secret\n" });
    expect(await runCli(["project", "pack-token", "web", "--stdin"], h.io)).toBe(EXIT.ok);
    expect(calls[0]?.key).toBe(`PUT ${IN}/pack-token`);
    expect(calls[0]?.body).toEqual({ token: "scdn_repo_secret" });
    expect(h.out()).toContain(`pack token: set ${WHEN}`);
    expect(h.out()).not.toContain("scdn_repo_secret");
    const removed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "pack-token", "web", "--remove"], removed.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`DELETE ${IN}/pack-token`);
    expect(removed.out()).toContain("pack token: none");
    const neither = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["project", "pack-token", "web"], neither.io)).toBe(EXIT.usage);
    const empty = harness({ fetch, env: SIGNED_IN, readStdin: async () => "\n" });
    expect(await runCli(["project", "pack-token", "web", "--stdin"], empty.io)).toBe(EXIT.failed);
    expect(empty.err()).toContain("No token was given");
  });
});

describe("the archive on the command line (ADR-0029)", () => {
  const DONE = { ...TASK, state: "done", doneAt: WHEN };
  const ARCHIVED = { ...DONE, archivedAt: "2026-10-12T10:00:00.000Z" };

  it("lists the tasks put away alone, puts one away, every one of a goal, and brings one back", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks?archived=true&limit=50&offset=0&brief=true`]: {
        body: { more: false, items: [ARCHIVED] },
      },
      [`GET ${IN}/tasks/7`]: { body: DONE },
      [`POST ${IN}/tasks/${TASK.id}/archive`]: { body: ARCHIVED },
      [`POST ${IN}/tasks/${TASK.id}/restore`]: { body: DONE },
      [`POST ${IN}/tasks/archive`]: { body: { archived: 3 } },
    });
    const listed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks", "--archived"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toBe("#7  done  high  Fix the parser  (owner alice; archived)\n");
    const one = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["task", "archive", "7"], one.io)).toBe(EXIT.ok);
    expect(calls.slice(-2).map((call) => call.key)).toEqual([
      `GET ${IN}/tasks/7`,
      `POST ${IN}/tasks/${TASK.id}/archive`,
    ]);
    expect(one.out()).toBe("#7  done  high  Fix the parser  (owner alice; archived)\n");
    const ofGoal = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["task", "archive", "--goal", GOAL.id], ofGoal.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`POST ${IN}/tasks/archive`);
    expect(calls.at(-1)?.body).toEqual({ goalId: GOAL.id });
    expect(ofGoal.out()).toBe("3 tasks of the goal put away.\n");
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["task", "archive", "--goal", GOAL.id, "--json"], asJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out())).toEqual({ archived: 3 });
    const back = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["task", "restore", "7"], back.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`POST ${IN}/tasks/${TASK.id}/restore`);
    expect(back.out()).toBe("#7  done  high  Fix the parser  (owner alice)\n");
  });

  it("asks which task, or which goal, and not both", async () => {
    const { fetch, calls } = fakeConsole({});
    for (const args of [
      ["task", "archive"],
      ["task", "archive", "7", "--goal", GOAL.id],
      ["task", "archive", "7", "8"],
      ["task", "restore"],
      ["task", "restore", "7", "8"],
    ]) {
      const h = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(args, h.io), args.join(" ")).toBe(EXIT.usage);
      expect(h.err()).toContain("console task");
    }
    expect(calls).toHaveLength(0);
  });
});

describe("what the board told a member, on the command line (ADR-0157)", () => {
  const WEB = { key: "web", name: "The web app", color: null, symbol: null, icon: null };
  const BOB = { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" };
  const happened = (over: Record<string, unknown>) => ({
    id: 41,
    kind: "task.commented",
    actor: BOB,
    agent: "Codex on the laptop",
    projectId: PROJECT.id,
    taskId: TASK.id,
    decisionId: null,
    runId: null,
    documentId: null,
    goalId: null,
    plugin: null,
    data: { number: 7, title: TASK.title, excerpt: "Which screen did you mean?" },
    createdAt: WHEN,
    ...over,
  });
  const COMMENTED = {
    id: "0199c4d8-0000-7000-8000-000000000091",
    kind: "commented",
    followed: false,
    readAt: null,
    createdAt: WHEN,
    event: happened({}),
    project: WEB,
  };
  const MOVED = {
    id: "0199c4d8-0000-7000-8000-000000000092",
    kind: "moved",
    followed: true,
    readAt: "2026-10-09T11:00:00.000Z",
    createdAt: WHEN,
    event: happened({
      id: 40,
      kind: "task.moved",
      actor: PERSON,
      agent: null,
      data: { number: 7, title: TASK.title, from: "ready", to: "in_progress" },
    }),
    project: WEB,
  };
  // What the console says of an agent account is of no project, and nobody did it.
  const UNHEARD = {
    id: "0199c4d8-0000-7000-8000-000000000093",
    kind: "agent",
    followed: false,
    readAt: null,
    createdAt: WHEN,
    event: happened({
      id: 39,
      kind: "agent.state_changed",
      actor: null,
      agent: null,
      projectId: null,
      taskId: null,
      data: { login: "acme-mira", handle: "mira", state: "unheard" },
    }),
    project: null,
  };
  // A decision that waits for the member: its event names no number, so the line says its id.
  const ASKED = {
    id: "0199c4d8-0000-7000-8000-000000000094",
    kind: "decision",
    followed: false,
    readAt: null,
    createdAt: WHEN,
    event: happened({
      id: 38,
      kind: "decision.raised",
      taskId: null,
      decisionId: DECISION.id,
      data: { question: DECISION.question },
    }),
    project: WEB,
  };
  const SETTINGS = {
    kinds: {
      assigned: false,
      ready: true,
      moved: false,
      changed: false,
      commented: false,
      archived: false,
      decision: false,
      answered: false,
      agent: true,
    },
    defaults: {
      assigned: false,
      ready: false,
      moved: false,
      changed: false,
      commented: false,
      archived: false,
      decision: false,
      answered: false,
      agent: true,
    },
    projectsOff: [{ key: "ops", name: "Operations" }],
    ownAgents: false,
  };
  const ALL = "GET /api/v1/notifications?limit=50&offset=0";
  const READ = "POST /api/v1/notifications/read";
  const SETTINGS_AT = "/api/v1/notifications/settings";
  const OLDER = "has no notifications yet: it is older than the command.";

  it("lists what one was told, newest first, each with why and what happened as the feed says it", async () => {
    const { fetch, calls } = fakeConsole({
      [ALL]: { body: { items: [COMMENTED, MOVED, UNHEARD, ASKED], more: false, unread: 3 } },
      "GET /api/v1/notifications?unread=true&limit=2&offset=4": {
        body: { items: [COMMENTED], more: true, unread: 7 },
      },
      "GET /api/v1/notifications?unread=true&limit=50&offset=0": {
        body: { items: [], more: false, unread: 0 },
      },
      "GET /api/v1/notifications?limit=50&offset=50": {
        body: { items: [MOVED], more: false, unread: 0 },
      },
      "GET /api/v1/notifications?limit=50&offset=100": {
        body: { items: [], more: false, unread: 0 },
      },
    });
    const listed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notifications"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toBe(
      [
        // Who did it, as which agent, and the feed's own sentence.
        `${COMMENTED.id}  unread  ${WHEN}  commented  web  bob as Codex on the laptop commented on #7 Fix the parser: Which screen did you mean?`,
        // Told because the task is followed, whatever the kinds say; and read already.
        `${MOVED.id}  read  ${WHEN}  moved (followed)  web  alice moved #7 Fix the parser from Ready to In progress`,
        // Of no project, and the console's own word.
        `${UNHEARD.id}  unread  ${WHEN}  agent  the console has not heard from @mira`,
        // A decision by its id, which the commands that read and answer it take.
        `${ASKED.id}  unread  ${WHEN}  decision  web  bob as Codex on the laptop asked: Keep the old behaviour?  (decision ${DECISION.id})`,
        "3 unread. Mark read: console notifications --read <id> [<id>...], or --read-all.",
        "",
      ].join("\n"),
    );
    // The member's own, across the projects: nothing of a project is asked for.
    expect(calls.map((call) => call.key)).toEqual([ALL]);
    // Those not read yet, a page of them, and how the next is asked for.
    const paged = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["notifications", "--unread", "--limit", "2", "--offset", "4"], paged.io),
    ).toBe(EXIT.ok);
    expect(paged.out()).toMatch(
      /\n7 unread\. Mark read: console notifications --read <id> \[<id>\.\.\.\], or --read-all\.\n\.\.\. more: --offset 6\n$/,
    );
    // Nothing to list is one plain line, and none unread is said so.
    const none = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notifications", "--unread"], none.io)).toBe(EXIT.ok);
    expect(none.out()).toBe("No unread notifications.\n");
    const all = harness({
      fetch: fakeConsole({ [ALL]: { body: { items: [], more: false, unread: 0 } } }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["notifications"], all.io)).toBe(EXIT.ok);
    expect(all.out()).toBe("No notifications.\n");
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notifications", "--offset", "50"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toMatch(/\nNone unread\.\n$/);
    const past = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notifications", "--offset", "100"], past.io)).toBe(EXIT.ok);
    expect(past.out()).toBe("No notifications that far back.\n");
    // --json is the console's own answer.
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notifications", "--json"], asJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out())).toEqual({
      items: [COMMENTED, MOVED, UNHEARD, ASKED],
      more: false,
      unread: 3,
    });
  });

  it("keeps a notification a line, whatever someone wrote in what it carries", async () => {
    const broken = {
      ...COMMENTED,
      event: happened({ data: { number: 7, title: TASK.title, excerpt: "One.\n\nTwo.\tThree." } }),
    };
    const h = harness({
      fetch: fakeConsole({ [ALL]: { body: { items: [broken], more: false, unread: 1 } } }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["notifications"], h.io)).toBe(EXIT.ok);
    expect(h.out().split("\n")).toHaveLength(3);
    expect(h.out()).toContain("commented on #7 Fix the parser: One. Two. Three.\n");
  });

  it("marks the notifications named read, or every one, and says how many are still unread", async () => {
    const { fetch, calls } = fakeConsole({
      [READ]: [
        { body: { read: 2, unread: 3, at: "2026-11-24T03:00:00.000Z" } },
        { body: { read: 3, unread: 0, at: "2026-11-24T03:00:05.000Z" } },
      ],
    });
    const some = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["notifications", "--read", COMMENTED.id, UNHEARD.id, COMMENTED.id], some.io),
    ).toBe(EXIT.ok);
    // Each id once, as given.
    expect(calls.at(-1)?.key).toBe(READ);
    expect(calls.at(-1)?.body).toEqual({ ids: [COMMENTED.id, UNHEARD.id] });
    expect(some.out()).toBe("Marked 2 read; 3 still unread.\n");
    const all = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notifications", "--read-all"], all.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ all: true });
    expect(all.out()).toBe("Marked 3 read; 0 still unread.\n");
  });

  it("refuses a reading without an id, a listing's flags beside a reading, and a word it does not take", async () => {
    const { fetch, calls } = fakeConsole({});
    for (const [args, says] of [
      [["notifications", "--read"], "Say which, by the ids the listing prints"],
      [["notifications", "--read", COMMENTED.id, "--read-all"], "Say one: --read <id>"],
      [["notifications", "--read-all", COMMENTED.id], "Say one: --read <id>"],
      [["notifications", "--read", COMMENTED.id, "--unread"], "are a listing's"],
      [["notifications", "--read-all", "--limit", "5"], "are a listing's"],
      [["notifications", "--read-all", "--offset", "5"], "are a listing's"],
      [["notifications", COMMENTED.id], "an id goes with --read"],
      [["notifications", "--limit", "0"], "--limit takes an integer between 1 and 200"],
      [["notifications", "--limit", "201"], "--limit takes an integer between 1 and 200"],
      [["notifications", "--offset", "-1"], "offset"],
      [["notifications", "--since", "today"], "--since"],
    ] as const) {
      const h = harness({ fetch, env: SIGNED_IN });
      expect(await runCli([...args], h.io), args.join(" ")).toBe(EXIT.usage);
      expect(h.err(), args.join(" ")).toContain(says);
      expect(h.out()).toBe("");
    }
    // Nothing was asked of the console.
    expect(calls).toHaveLength(0);
  });

  it("says what one is told of: each kind, the projects turned off and one's own agents, and names no plugin", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${SETTINGS_AT}`]: {
        // A kind a newer console has is read, and said by its name alone.
        body: {
          ...SETTINGS,
          kinds: { ...SETTINGS.kinds, mentioned: true },
          defaults: { ...SETTINGS.defaults, mentioned: true },
        },
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notify"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toBe(
      [
        "assigned  off  a task was given to you, as its owner or to work on",
        // Chosen otherwise than a member who chose nothing has it.
        "ready  on  a task you work on is ready to begin  (default: off)",
        "moved  off  a task you own went from one state to another",
        "changed  off  the title, the body or the days of a task of yours changed",
        "commented  off  someone wrote on a task of yours",
        "archived  off  a task of yours was put away",
        "decision  off  a decision waits for you",
        "answered  off  a decision you raised was answered",
        "agent  on  an agent account that reports to you stopped, was refused, failed or is not heard from, or runs again, or raised a decision for you",
        "mentioned  on",
        "projects off: ops (Operations)",
        "own agents: off  (what an agent of your own did as you is not told to you)",
        "",
      ].join("\n"),
    );
    expect(calls.map((call) => call.key)).toEqual([`GET ${SETTINGS_AT}`]);
  });

  it("takes no plugin's setting: what a plugin sends on is the plugin's own", async () => {
    const { fetch, calls } = fakeConsole({});
    const h = harness({ fetch, env: SIGNED_IN });
    // A flag that named a plugin is none of the command's, and nothing is asked of the console.
    expect(await runCli(["notify", "--via", "messenger", "--off", "ready"], h.io)).toBe(EXIT.usage);
    expect(calls).toHaveLength(0);
  });

  it("turns kinds on and off, and one's own agents, in one change, and prints the settings as they are now", async () => {
    const now = {
      ...SETTINGS,
      kinds: { ...SETTINGS.kinds, commented: true, decision: true, ready: false },
      projectsOff: [],
      ownAgents: true,
    };
    const { fetch, calls } = fakeConsole({ [`PUT ${SETTINGS_AT}`]: { body: now } });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["notify", "--on", "commented", "--on", "decision", "--off", "ready", "--own-agents", "on"],
        h.io,
      ),
    ).toBe(EXIT.ok);
    // Only what the flags say, the other kinds staying as they are; nothing is read first.
    expect(calls.map((call) => call.key)).toEqual([`PUT ${SETTINGS_AT}`]);
    expect(calls[0]?.body).toEqual({
      kinds: { commented: true, decision: true, ready: false },
      ownAgents: true,
    });
    expect(h.out()).toContain("commented  on  someone wrote on a task of yours  (default: off)\n");
    expect(h.out()).toContain("ready  off  a task you work on is ready to begin\n");
    expect(h.out()).toContain("projects off: none\n");
    expect(h.out()).toContain(
      "own agents: on  (what an agent of your own did as you is told to you too)\n",
    );
  });

  it("turns a project off or on again by sending the whole list, read as it stands", async () => {
    const now = { ...SETTINGS, projectsOff: [{ key: "web", name: "The web app" }] };
    const { fetch, calls } = fakeConsole({
      [`GET ${SETTINGS_AT}`]: { body: SETTINGS },
      [`PUT ${SETTINGS_AT}`]: [
        { body: now },
        {
          status: 404,
          body: { error: { code: "project.not_found", message: "The project was not found." } },
        },
      ],
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["notify", "--project-off", "web", "--project-on", "ops", "--off", "agent"],
        h.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.map((call) => call.key)).toEqual([`GET ${SETTINGS_AT}`, `PUT ${SETTINGS_AT}`]);
    // Those that were, less the one turned on again, and the one turned off now.
    expect(calls[1]?.body).toEqual({ kinds: { agent: false }, projectsOff: ["web"] });
    expect(h.out()).toContain("projects off: web (The web app)\n");
    // One that is off already is sent once; a key the console does not know is its to refuse.
    const again = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["notify", "--project-off", "ops", "--project-off", "nowhere"], again.io),
    ).toBe(EXIT.failed);
    expect(calls.at(-1)?.body).toEqual({ projectsOff: ["ops", "nowhere"] });
    expect(again.err()).toContain("project.not_found: The project was not found.");
  });

  it("puts everything back with --reset, alone", async () => {
    const { fetch, calls } = fakeConsole({
      [`PUT ${SETTINGS_AT}`]: { body: { ...SETTINGS, kinds: SETTINGS.defaults, projectsOff: [] } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["notify", "--reset"], h.io)).toBe(EXIT.ok);
    expect(calls.map((call) => call.key)).toEqual([`PUT ${SETTINGS_AT}`]);
    expect(calls[0]?.body).toEqual({ reset: true });
    expect(h.out()).toContain("ready  off  a task you work on is ready to begin\n");
    expect(h.out()).not.toContain("(default:");
  });

  it("refuses a kind that is none, before any request, and what says two things at once", async () => {
    const { fetch, calls } = fakeConsole({});
    const KINDS =
      "One of assigned, ready, moved, changed, commented, archived, decision, answered, agent";
    for (const [args, says] of [
      [["notify", "--on", "mentions"], `Not a kind of notification: mentions. ${KINDS}`],
      [
        ["notify", "--off", "ready", "--off", "Ready"],
        `Not a kind of notification: Ready. ${KINDS}`,
      ],
      [["notify", "--on", "ready", "--off", "ready"], "ready is said both on and off"],
      [["notify", "--project-off", "web", "--project-on", "web"], "web is said both on and off"],
      [["notify", "--own-agents", "yes"], "Not what --own-agents takes: yes. One of on, off"],
      [["notify", "--reset", "--on", "ready"], "--reset stands alone"],
      [["notify", "--reset", "--project-off", "web"], "--reset stands alone"],
      [["notify", "--reset", "--own-agents", "off"], "--reset stands alone"],
      [["notify", "ready"], "ready"],
      [["notify", "--on"], "--on"],
    ] as const) {
      const h = harness({ fetch, env: SIGNED_IN });
      expect(await runCli([...args], h.io), args.join(" ")).toBe(EXIT.usage);
      expect(h.err(), args.join(" ")).toContain(says);
    }
    expect(calls).toHaveLength(0);
  });

  it("turns a task's notifications on with follow and off with mute, saying what holds now", async () => {
    const FOLLOW = `PUT ${IN}/tasks/${TASK.id}/follow`;
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`GET /api/v1/projects/ops/tasks/${TASK.id}`]: { body: TASK },
      [FOLLOW]: [
        // Turned on where the settings would be silent of it, then off again, as they have it.
        { body: { on: true, usual: false, all: true } },
        { body: { on: false, usual: false, all: false } },
        // Turned off where the settings tell of it, then on again, as they have it.
        { body: { on: false, usual: true, all: false } },
        { body: { on: true, usual: true, all: false } },
      ],
      [`PUT /api/v1/projects/ops/tasks/${TASK.id}/follow`]: {
        body: { on: true, usual: false, all: true },
      },
    });
    const followed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["follow", "7"], followed.io)).toBe(EXIT.ok);
    // The task is read for what it is called, then the choice is kept by its id.
    expect(calls.map((call) => call.key)).toEqual([`GET ${IN}/tasks/7`, FOLLOW]);
    expect(calls.at(-1)?.body).toEqual({ on: true });
    expect(followed.out()).toBe(
      "Notifications of #7 Fix the parser are on: you are told of everything that happens on it. Turn them off: console mute 7\n",
    );
    const back = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["mute", "7"], back.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ on: false });
    expect(back.out()).toBe(
      "Notifications of #7 Fix the parser are off, as your settings have it. Turn them on: console follow 7\n",
    );
    const muted = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["mute", "7"], muted.io)).toBe(EXIT.ok);
    expect(muted.out()).toBe(
      "Notifications of #7 Fix the parser are off: you are told of nothing of it. Turn them on: console follow 7\n",
    );
    const again = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["follow", "7"], again.io)).toBe(EXIT.ok);
    expect(again.out()).toBe(
      "Notifications of #7 Fix the parser are on, as your settings have it: you are told of it by the kinds you have on (console notify). Turn them off: console mute 7\n",
    );
    // By its id, in the project the flag names; --json is the console's own answer.
    const elsewhere = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["follow", TASK.id, "--project", "ops", "--json"], elsewhere.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.key).toBe(`PUT /api/v1/projects/ops/tasks/${TASK.id}/follow`);
    expect(JSON.parse(elsewhere.out())).toEqual({ on: true, usual: false, all: true });
  });

  it("asks which task to follow or to mute, and says a task that is not there as the console does", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks/99`]: {
        status: 404,
        body: { error: { code: "task.not_found", message: "The task was not found." } },
      },
    });
    for (const word of ["follow", "mute"]) {
      for (const args of [[word], [word, "7", "8"]]) {
        const h = harness({ fetch, env: SIGNED_IN });
        expect(await runCli(args, h.io), args.join(" ")).toBe(EXIT.usage);
        expect(h.err()).toContain(`Say which task: console ${word} <number|id>`);
      }
      // Turning one back is the other word: there is no flag for it.
      const flagged = harness({ fetch, env: SIGNED_IN });
      expect(await runCli([word, "7", "--off"], flagged.io)).toBe(EXIT.usage);
    }
    expect(calls).toHaveLength(0);
    const missing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["mute", "99"], missing.io)).toBe(EXIT.failed);
    expect(missing.err()).toContain("task.not_found: The task was not found.");
    // In a directory that names no project, the command says so, and asks nothing.
    const nowhere = harness({
      fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
    });
    expect(await runCli(["follow", "7"], nowhere.io)).toBe(EXIT.failed);
    expect(nowhere.err()).toContain("Say which project: --project <key>");
  });

  it("says on a task whether its notifications are on, and by whose doing", async () => {
    const routes = {
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`GET ${IN}/decisions?task=${TASK.id}`]: { body: { more: false, items: [] } },
      [`GET ${IN}/runs?task=${TASK.id}&brief=true`]: { body: { more: false, items: [] } },
      [`GET ${IN}/runs?task=${TASK.id}`]: { body: { more: false, items: [] } },
      [`GET ${IN}/tasks/${TASK.id}/comments`]: { body: { items: [] } },
    };
    const AT = `GET ${IN}/tasks/${TASK.id}/follow`;
    for (const [follow, line] of [
      [
        { on: true, usual: false, all: true },
        "notifications: on, turned on by you: you are told of everything that happens on it",
      ],
      // Turned on by hand before the settings came to say on too: everything still.
      [
        { on: true, usual: true, all: true },
        "notifications: on, turned on by you: you are told of everything that happens on it",
      ],
      [
        { on: false, usual: true, all: false },
        "notifications: off, turned off by you: you are told of nothing of it",
      ],
      [{ on: true, usual: true, all: false }, "notifications: on, as your settings have it"],
      [{ on: false, usual: false, all: false }, "notifications: off, as your settings have it"],
    ] as const) {
      const h = harness({
        fetch: fakeConsole({ ...routes, [AT]: { body: follow } }).fetch,
        env: SIGNED_IN,
      });
      expect(await runCli(["task", "7"], h.io)).toBe(EXIT.ok);
      expect(h.out()).toContain(`\n${line}\n`);
    }
    // --json carries it beside the task.
    const asJson = harness({
      fetch: fakeConsole({ ...routes, [AT]: { body: { on: false, usual: true, all: false } } })
        .fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["task", "7", "--json"], asJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out())).toMatchObject({
      task: { number: 7 },
      follow: { on: false, usual: true, all: false },
    });
    // A console of before has no such route: the task is printed, and nothing is said of it.
    const older = harness({ fetch: fakeConsole(routes).fetch, env: SIGNED_IN });
    expect(await runCli(["task", "7"], older.io)).toBe(EXIT.ok);
    expect(older.out()).toContain("#7 Fix the parser\n");
    expect(older.out()).not.toContain("notifications:");
    expect(older.err()).toBe("");
    // Anything else the console refuses the read with ends the command, as its other reads do.
    const refused = harness({
      fetch: fakeConsole({
        ...routes,
        [AT]: {
          status: 403,
          body: { error: { code: "auth.forbidden", message: "Not yours to read." } },
        },
      }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["task", "7"], refused.io)).toBe(EXIT.failed);
    expect(refused.err()).toContain("auth.forbidden: Not yours to read.");
  });

  it("says a console of before the notifications is one, on every command of theirs", async () => {
    // It answers their paths as nothing; the task is one it has.
    const old = fakeConsole({ [`GET ${IN}/tasks/7`]: { body: TASK } }, { version: "0.6.0" });
    for (const args of [
      ["notifications"],
      ["notifications", "--read-all"],
      ["notifications", "--read", COMMENTED.id],
      ["notify"],
      ["notify", "--on", "ready"],
      ["notify", "--project-off", "web"],
      ["notify", "--reset"],
      ["follow", "7"],
      ["mute", "7"],
    ]) {
      const h = harness({ fetch: old.fetch, env: SIGNED_IN });
      expect(await runCli(args, h.io), args.join(" ")).toBe(EXIT.failed);
      expect(h.err(), args.join(" ")).toBe(`This console, 0.6.0, ${OLDER}\n`);
      expect(h.out()).toBe("");
    }
    // A console that does not say its version is said without one.
    const silent = harness({ fetch: fakeConsole({}).fetch, env: SIGNED_IN });
    expect(await runCli(["notifications"], silent.io)).toBe(EXIT.failed);
    expect(silent.err()).toBe(`This console ${OLDER}\n`);
  });

  it("says each command in its own help, with the kinds and what is refused", async () => {
    const { fetch } = fakeConsole({});
    const notifications = harness({ fetch });
    expect(await runCli(["help", "notifications"], notifications.io)).toBe(EXIT.ok);
    expect(notifications.out()).toContain("notifications --read <id> [<id>...]");
    expect(notifications.out()).toContain("limit: 1 to 200");
    const notify = harness({ fetch });
    expect(await runCli(["notify", "--help"], notify.io)).toBe(EXIT.ok);
    expect(notify.out()).toContain(
      "kind: one of assigned, ready, moved, changed, commented, archived, decision, answered, agent",
    );
    expect(notify.out()).toContain("--own-agents on|off");
    // What a plugin sends on is set at the plugin: the command has no flag for it.
    expect(notify.out()).not.toContain("--via");
    expect(notify.out()).toContain("is chosen at that plugin");
    for (const word of ["follow", "mute"]) {
      const one = harness({ fetch });
      expect(await runCli(["help", word], one.io)).toBe(EXIT.ok);
      expect(one.out()).toContain(`console ${word} <number|id>
`);
      expect(one.out()).not.toContain("--off");
      expect(one.out()).toContain("a console older than the command has no notifications yet");
    }
  });
});

describe("the console the command works with (ADR-0038)", () => {
  it("refuses a console older than its floor itself, in the console's form, and works with one at it", async () => {
    const routes = {
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/projects": { body: { items: [] } },
      [`GET ${IN}`]: { body: PROJECT },
    };
    const old = harness({
      fetch: fakeConsole(routes, { version: "0.3.1", clientRange: ">=0.3.0 <0.4.0" }).fetch,
      env: SIGNED_IN,
      version: "0.3.5",
      consoleAtLeast: "0.3.2",
      install: { kind: "global", manager: "npm", root: "C:/Users/alice/AppData/Roaming/npm" },
    });
    expect(await runCli(["projects"], old.io)).toBe(EXIT.incompatible);
    expect(old.err()).toContain(
      "console.outdated: This console, 0.3.1, is older than this command (0.3.5) works with (>=0.3.2 <0.4.0).",
    );
    expect(old.err()).toContain(
      "Install the console's version: npm install -g @skillcdn/console@0.3.1",
    );
    const fine = harness({
      fetch: fakeConsole(routes, { version: "0.3.2", clientRange: ">=0.3.2 <0.4.0" }).fetch,
      env: SIGNED_IN,
      version: "0.3.5",
      consoleAtLeast: "0.3.2",
    });
    expect(await runCli(["projects"], fine.io)).toBe(EXIT.ok);
    const who = harness({
      fetch: fakeConsole(routes, { version: "0.3.2" }).fetch,
      env: SIGNED_IN,
      version: "0.3.5",
      consoleAtLeast: "0.3.2",
    });
    expect(await runCli(["whoami"], who.io)).toBe(EXIT.ok);
    expect(who.out()).toContain("this command works with a console from 0.3.2 on");
  });
});

describe("this week on the command line (ADR-0039)", () => {
  it("ends the week as the workspace begins it, else as the person's language has it, else as the machine's", async () => {
    // Noon on Sunday 2026-10-11 by this machine's clock.
    const NOON = Date.parse("2026-10-11T12:00:00");
    const nothing = { body: { more: false, items: [] } };
    const monday = fakeConsole({
      "GET /api/v1/me": { body: { ...ME, workspace: { ...ME.workspace, weekStart: "monday" } } },
      [`GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0&brief=true`]: nothing,
    });
    const m = harness({ fetch: monday.fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--due", "week"], m.io)).toBe(EXIT.ok);
    expect(monday.calls.at(-1)?.key).toBe(
      `GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0&brief=true`,
    );
    // Left to the language, a Korean week begins on Sunday: the week of the 11th ends on the 17th.
    const korean = fakeConsole({
      "GET /api/v1/me": { body: { ...ME, language: "ko" } },
      [`GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0&brief=true`]: nothing,
    });
    const k = harness({ fetch: korean.fetch, env: SIGNED_IN, now: () => NOON, locale: "en-GB" });
    expect(await runCli(["tasks", "--due", "week"], k.io)).toBe(EXIT.ok);
    expect(korean.calls.at(-1)?.key).toBe(
      `GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0&brief=true`,
    );
    // No language chosen: the machine's, a British one beginning on Monday.
    const british = fakeConsole({
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0&brief=true`]: nothing,
    });
    const b = harness({ fetch: british.fetch, env: SIGNED_IN, now: () => NOON, locale: "en-GB" });
    expect(await runCli(["tasks", "--due", "week"], b.io)).toBe(EXIT.ok);
    expect(british.calls.at(-1)?.key).toBe(
      `GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0&brief=true`,
    );
  });
});

describe("the plugins on the command line (ADR-0049, ADR-0053)", () => {
  const AT = "/api/v1/plugins/hello";
  const BOB = { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" };
  const PLUGIN = {
    key: "hello",
    name: { en: "Hello", ko: "헬로" },
    description: { en: "Greetings kept as records: who greeted whom." },
    agentNote: { en: "Keeps greetings as records; greet someone with greet." },
    version: "0.1.0",
    state: "enabled",
    problems: [],
    roles: ["greeter"],
    declaredRoles: [{ key: "greeter", name: { en: "Greeter" }, description: { en: "Greets." } }],
    defaultRole: "greeter",
    menu: null,
    pages: [],
    widgets: [],
    board: null,
    boardNeeds: "optional",
    capabilities: ["files"],
    consent: null,
    projects: null,
    requires: {},
    dataVersion: 1,
    enabledAt: WHEN,
  };
  const GREET = {
    name: "greet",
    kind: "command",
    about: "Greets someone, and keeps the greeting as a record.",
    args: {
      to: { type: "text", about: "who is greeted", optional: false, positional: true, max: 80 },
      text: { type: "text", about: "the words", optional: true, positional: false, max: 200 },
      loud: { type: "boolean", optional: true, positional: false },
    },
    roles: ["greeter"],
  };
  const LATEST = {
    name: "latest",
    kind: "query",
    about: "The latest greetings, newest first.",
    args: {
      limit: { type: "number", optional: true, positional: false, integer: true, min: 1, max: 50 },
    },
    roles: ["greeter"],
  };
  const SETTING = {
    key: "greeting",
    type: "text",
    name: { en: "Greeting" },
    description: null,
    required: false,
    default: "Hello",
    min: null,
    max: 40,
    options: null,
    of: null,
    set: true,
    value: "Hi",
    setAt: null,
  };
  const SECRET = {
    ...SETTING,
    key: "token",
    type: "secret",
    name: { en: "Token" },
    default: null,
    max: null,
    set: false,
    value: null,
  };
  const DETAIL = {
    ...PLUGIN,
    operations: [GREET, LATEST],
    skills: `${AT}/skills`,
    boardDefaults: { key: "hello-board", name: { en: "Hello board" }, description: { en: "" } },
    settings: [SETTING, SECRET],
    grants: null,
    events: `${AT}/events`,
  };
  const RECORD = {
    id: "0199c4d8-0000-7000-8000-000000000090",
    collection: "greetings",
    project: null,
    owner: BOB.id,
    data: { to: "world", text: "Hi, world!", by: "bob" },
    version: 1,
    createdAt: WHEN,
    updatedAt: WHEN,
    createdBy: BOB.id,
    updatedBy: BOB.id,
    archivedAt: null,
  };
  const INVOKED = {
    kind: "command",
    text: `Hi, world! (kept as ${RECORD.id})`,
    data: RECORD,
    waiting: null,
  };
  const GRANT = {
    id: "0199c4d8-0000-7000-8000-0000000000b0",
    role: "greeter",
    person: { id: BOB.id, login: "bob", name: null },
    project: null,
    everyone: false,
    createdAt: WHEN,
  };

  it("lists the plugins one may use, one plugin with its commands, and one command in full", async () => {
    const { fetch } = fakeConsole({
      "GET /api/v1/plugins": { body: { items: [PLUGIN], sql: false } },
      [`GET ${AT}`]: { body: DETAIL },
      "GET /api/v1/me": { body: ME },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugins"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("hello  Hello 0.1.0  enabled  roles: greeter");
    expect(h.out()).toContain("One plugin, with its commands: console plugin <key>.");
    const one = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello"], one.io)).toBe(EXIT.ok);
    expect(one.out()).toContain("hello: Hello 0.1.0, enabled");
    expect(one.out()).toContain("For agents: Keeps greetings as records");
    expect(one.out()).toContain("Your roles in it: greeter.");
    expect(one.out()).toContain(
      "Board project: none yet. enable --board new makes hello-board (Hello board).",
    );
    // The listing, which an agent reads whole at every first use, shows the positionals and the
    // required flags and folds the rest into [options]; help <command> has them all.
    expect(one.out()).toContain("  console plugin hello greet <to> [options]");
    expect(one.out()).not.toContain("greet <to> [--text <text>] [--loud]");
    expect(one.out()).toContain(
      "One in full, with every option: console plugin hello help <command>.",
    );
    expect(one.out()).toContain("[query] The latest greetings, newest first.");
    expect(one.out()).toContain("console plugin hello skills lists them");
    expect(one.out()).toContain('  greeting (text): "Hi"  Greeting');
    expect(one.out()).toContain("  token (secret): not set  Token");
    const help = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "help", "greet"], help.io)).toBe(EXIT.ok);
    expect(help.out()).toContain("console plugin hello greet <to> [--text <text>] [--loud]");
    expect(help.out()).toContain("A command. Greets someone");
    expect(help.out()).toContain("  <to>  text, up to 80 characters: who is greeted");
    expect(help.out()).toContain(
      "  [--text <text>]  text, up to 200 characters, optional: the words",
    );
    expect(help.out()).toContain("  [--loud]  true or false; the flag alone is true, optional");
    expect(help.out()).toContain("Roles: greeter");
    expect(help.out()).toContain("plugin.invalid_args: a word does not fit the definition");
    const every = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "help"], every.io)).toBe(EXIT.ok);
    expect(every.out()).toContain("console plugin hello latest [options]\n    [query] The latest");
    const unknown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "help", "nothing"], unknown.io)).toBe(EXIT.usage);
    expect(unknown.err()).toContain("Not a command or a query of hello you may run: nothing.");
    // A plugin's name in the language the person chose, where the manifest has it.
    const korean = fakeConsole({
      "GET /api/v1/plugins": { body: { items: [PLUGIN], sql: false } },
      "GET /api/v1/me": { body: { ...ME, language: "ko" } },
    });
    const k = harness({ fetch: korean.fetch, env: SIGNED_IN });
    expect(await runCli(["plugins"], k.io)).toBe(EXIT.ok);
    expect(k.out()).toContain("hello  헬로 0.1.0  enabled");
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin"], nothing.io)).toBe(EXIT.usage);
    expect(nothing.err()).toContain("Say which plugin: console plugin <key>");
  });

  it("prints a plugin's jobs and the one that keeps failing, and nothing of them for a plugin without (ADR-0128)", async () => {
    const SINCE = "2026-10-08T02:18:00.000Z";
    const PROBLEM =
      "the job match has failed since 2026-10-08T02:18:00Z: plugin.failed among its events says why";
    const JOBS = [
      {
        name: "match",
        every: "P1D",
        at: "02:18",
        lastRunAt: WHEN,
        lastOutcome: "failed",
        nextAt: "2026-10-10T02:18:00.000Z",
        failedSince: SINCE,
      },
      {
        name: "rotate",
        every: "PT1H",
        at: null,
        lastRunAt: WHEN,
        lastOutcome: "ok",
        nextAt: "2026-10-09T11:00:00.000Z",
        failedSince: null,
      },
      {
        name: "sweep",
        every: "PT5M",
        at: null,
        lastRunAt: null,
        lastOutcome: null,
        nextAt: null,
        failedSince: null,
      },
    ];
    const now = fakeConsole({
      "GET /api/v1/plugins": { body: { items: [{ ...PLUGIN, problems: [PROBLEM] }], sql: false } },
      [`GET ${AT}`]: { body: { ...DETAIL, problems: [PROBLEM], jobs: JOBS } },
      "GET /api/v1/me": { body: ME },
    });
    const listed = harness({ fetch: now.fetch, env: SIGNED_IN });
    expect(await runCli(["plugins"], listed.io)).toBe(EXIT.ok);
    expect(listed.out()).toContain(
      `hello  Hello 0.1.0  enabled  roles: greeter  problems: ${PROBLEM}`,
    );
    const one = harness({ fetch: now.fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello"], one.io)).toBe(EXIT.ok);
    expect(one.out()).toContain(`problems: ${PROBLEM}`);
    expect(one.out()).toContain(
      [
        "Jobs (what went wrong in one: console plugin hello events --kind plugin.failed):",
        `  match  every P1D at 02:18  last run ${WHEN}: failed, failing since ${SINCE}  next: 2026-10-10T02:18:00.000Z`,
        `  rotate  every PT1H  last run ${WHEN}: ok  next: 2026-10-09T11:00:00.000Z`,
        "  sweep  every PT5M  has not run yet  next: not scheduled",
        "",
        "Settings:",
      ].join("\n"),
    );
    // A plugin that declares none has none to print, whether the console names an empty list
    // or none: no empty block.
    for (const before of [DETAIL, { ...DETAIL, jobs: [] }]) {
      const old = fakeConsole({ [`GET ${AT}`]: { body: before }, "GET /api/v1/me": { body: ME } });
      const was = harness({ fetch: old.fetch, env: SIGNED_IN });
      expect(await runCli(["plugin", "hello"], was.io)).toBe(EXIT.ok);
      expect(was.out()).toContain("hello: Hello 0.1.0, enabled");
      expect(was.out()).not.toContain("Jobs");
      expect(was.out()).not.toContain("problems:");
      expect(was.out()).toContain(
        "console plugin hello skills lists them; console plugin hello skill <path> reads one. Read the one that fits before the first command.\n\nSettings:",
      );
    }
  });

  it("reads a plugin's events, and the failures alone by kind (ADR-0128)", async () => {
    const event = (
      id: number,
      kind: string,
      data: Record<string, unknown>,
      actor: unknown = null,
    ) => ({
      id,
      kind,
      actor,
      agent: actor === null ? null : "Claude Code",
      projectId: null,
      taskId: null,
      decisionId: null,
      runId: null,
      documentId: null,
      goalId: null,
      plugin: "hello",
      data,
      createdAt: WHEN,
    });
    const FAILED = event(31, "plugin.failed", {
      key: "hello",
      problem: "the job match failed (plugin.failed)",
    });
    const COMMAND = event(
      30,
      "plugin.command",
      { command: "greet", outcome: "refused", code: "plugin.forbidden", durationMs: 12, args: {} },
      PERSON,
    );
    const ENABLED = event(29, "plugin.enabled", { key: "hello", capabilities: ["files"] }, PERSON);
    const { fetch, calls } = fakeConsole({
      [`GET ${AT}/events?limit=50&offset=0`]: {
        body: { items: [FAILED, COMMAND, ENABLED], more: false },
      },
      [`GET ${AT}/events?limit=1&offset=2&kind=plugin.failed`]: {
        body: { items: [FAILED], more: true },
      },
      [`GET ${AT}/events?limit=50&offset=0&kind=plugin.upgraded`]: {
        body: { items: [], more: false },
      },
    });
    const all = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "events"], all.io)).toBe(EXIT.ok);
    expect(all.out()).toBe(
      [
        `#31  ${WHEN}  plugin.failed  the console  the job match failed (plugin.failed)`,
        `#30  ${WHEN}  plugin.command  alice as Claude Code  greet refused (plugin.forbidden), 12 ms`,
        `#29  ${WHEN}  plugin.enabled  alice as Claude Code  {"key":"hello","capabilities":["files"]}`,
        "",
      ].join("\n"),
    );
    const failures = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["plugin", "hello", "events", "--kind", "plugin.failed", "--limit", "1", "--offset", "2"],
        failures.io,
      ),
    ).toBe(EXIT.ok);
    expect(failures.out()).toBe(
      `#31  ${WHEN}  plugin.failed  the console  the job match failed (plugin.failed)\n... more: --offset 3\n`,
    );
    expect(calls.at(-1)?.key).toBe(`GET ${AT}/events?limit=1&offset=2&kind=plugin.failed`);
    const none = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "events", "--kind", "plugin.upgraded"], none.io)).toBe(
      EXIT.ok,
    );
    // Nothing answered is nothing the caller may read: whether the plugin has events that are
    // not theirs, the console does not say, and neither does the command.
    expect(none.out()).toBe("No plugin.upgraded event of hello that you may read.\n");
    const beyond = fakeConsole({
      [`GET ${AT}/events?limit=50&offset=50`]: { body: { items: [], more: false } },
    });
    const far = harness({ fetch: beyond.fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "events", "--offset", "50"], far.io)).toBe(EXIT.ok);
    expect(far.out()).toBe("No event of hello that you may read, that far back.\n");
    // What is not asked right is said before the console is asked.
    for (const words of [
      ["--kind", "failed"],
      ["--kind", "Plugin.Failed"],
      ["--limit", "101"],
      ["--offset", "-1"],
      ["plugin.failed"],
    ]) {
      const bad = harness({ fetch, env: SIGNED_IN });
      expect(await runCli(["plugin", "hello", "events", ...words], bad.io), words.join(" ")).toBe(
        EXIT.usage,
      );
    }
    // A plugin nobody may know of is the console's refusal, as for every read of it.
    const unknown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "nothing", "events"], unknown.io)).toBe(EXIT.failed);
  });

  it("runs a command by the words as typed, which the console parses, and says when a decision waits", async () => {
    const { fetch, calls } = fakeConsole({
      [`POST ${AT}/invoke`]: [
        { body: INVOKED },
        { body: { ...INVOKED, text: "Requested.", waiting: DECISION.id, project: "hello-board" } },
        {
          status: 400,
          body: { error: { code: "plugin.invalid_args", message: "to is required" } },
        },
        { body: { kind: "query", text: "", data: [{ to: "moon" }], waiting: null } },
        { body: INVOKED },
      ],
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "greet", "world", "--text", "Hi there", "--loud"], h.io),
    ).toBe(EXIT.ok);
    // The words go as typed, after the command's name; the project the directory works in goes with them.
    expect(calls[0]?.body).toEqual({
      argv: ["greet", "world", "--text", "Hi there", "--loud"],
      project: "web",
    });
    expect(h.out()).toBe(`${INVOKED.text}\n`);
    // A command that raised a decision: its id on a line of its own, and exit 3.
    const waiting = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "request", "--run", RUN.id], waiting.io)).toBe(
      EXIT.waiting,
    );
    expect(calls[1]?.body).toEqual({ argv: ["request"], project: "web", run: RUN.id });
    expect(waiting.out()).toContain("Requested.");
    expect(waiting.out()).toContain(`decision id: ${DECISION.id}`);
    expect(waiting.out()).toContain(
      `The decision waits for a person in the project hello-board: console decision ${DECISION.id} --wait 100`,
    );
    // The console's refusal, in its form, and exit 1.
    const refused = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "greet"], refused.io)).toBe(EXIT.failed);
    expect(refused.err()).toContain("plugin.invalid_args: to is required");
    // A query prints its answer as JSON; = binds a value too.
    const query = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "latest", "--limit=1"], query.io)).toBe(EXIT.ok);
    expect(calls[3]?.body).toEqual({ argv: ["latest", "--limit=1"], project: "web" });
    expect(JSON.parse(query.out())).toEqual([{ to: "moon" }]);
    // --json prints the whole answer, and is the command's own wherever it stands among the words.
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "greet", "world", "--json"], asJson.io)).toBe(EXIT.ok);
    expect(calls[4]?.body).toEqual({ argv: ["greet", "world"], project: "web" });
    expect(JSON.parse(asJson.out())).toEqual(INVOKED);
  });

  it("uploads a file first and sends its handle with the words, and saves a file a query answers", async () => {
    const HANDLE = {
      handle: "0199c4d8-0000-7000-8000-0000000000a0",
      name: "notes.txt",
      type: "text/plain",
      bytes: 5,
    };
    const { fetch, calls } = fakeConsole({
      [`POST ${AT}/files`]: { status: 201, body: HANDLE },
      [`POST ${AT}/invoke`]: [
        { body: INVOKED },
        { body: INVOKED },
        {
          body: {
            kind: "query",
            text: "",
            data: {
              file: {
                name: "report.csv",
                type: "text/csv",
                bytes: 3,
                base64: Buffer.from("a,b").toString("base64"),
              },
            },
            waiting: null,
          },
        },
      ],
    });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      readBytes: async (path) => {
        expect(path).toBe("notes.txt");
        return new TextEncoder().encode("hello");
      },
    });
    expect(
      await runCli(["plugin", "hello", "attach", "--file", "notes.txt", "--note", "x"], h.io),
    ).toBe(EXIT.ok);
    expect(calls[0]?.key).toBe(`POST ${AT}/files`);
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
    expect(calls[1]?.body).toEqual({
      argv: ["attach", "--note", "x"],
      files: [HANDLE.handle],
      project: "web",
    });
    // - reads the file from standard input.
    const stdin = harness({ fetch, env: SIGNED_IN, readStdin: async () => "from stdin" });
    expect(await runCli(["plugin", "hello", "attach", "-"], stdin.io)).toBe(EXIT.ok);
    expect(calls[3]?.body).toEqual({ argv: ["attach"], files: [HANDLE.handle], project: "web" });
    const both = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "attach", "-", "--file", "x"], both.io)).toBe(
      EXIT.usage,
    );
    // A query that answers a file: saved under its name, as console file saves one.
    const written: { path: string; name: string; bytes: number }[] = [];
    const saving = harness({
      fetch,
      env: SIGNED_IN,
      writeBytes: async (path, bytes, name) => {
        written.push({ path, name, bytes: bytes.byteLength });
        return `/work/${path}`;
      },
    });
    expect(await runCli(["plugin", "hello", "export"], saving.io)).toBe(EXIT.ok);
    expect(written).toEqual([{ path: "report.csv", name: "report.csv", bytes: 3 }]);
    expect(saving.out()).toBe("Saved report.csv (3 bytes, text/csv) at /work/report.csv\n");
  });

  it("reads a plugin's records, one record, and its versions", async () => {
    const where = new URLSearchParams({
      where: JSON.stringify({ to: "world", n: 3, done: true }),
      order: "-id",
      limit: "5",
    });
    const { fetch } = fakeConsole({
      [`GET ${AT}/records/greetings?${where}`]: {
        body: { items: [RECORD, { ...RECORD, archivedAt: WHEN }], after: "next-cursor" },
      },
      [`GET ${AT}/records/greetings?q=moon&project=web`]: { body: { items: [], after: null } },
      [`GET ${AT}/records/greetings/${RECORD.id}`]: { body: RECORD },
      [`GET ${AT}/records/greetings/${RECORD.id}/versions`]: {
        body: { items: [{ version: 1, data: RECORD.data, at: WHEN, by: BOB.id }] },
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "plugin",
          "hello",
          "records",
          "greetings",
          "--where",
          "to=world",
          "--where",
          "n=3",
          "--where",
          "done=true",
          "--order",
          "id:desc",
          "--limit",
          "5",
        ],
        h.io,
      ),
    ).toBe(EXIT.ok);
    expect(h.out()).toContain(
      `${RECORD.id}  v1  ${WHEN}  {"to":"world","text":"Hi, world!","by":"bob"}`,
    );
    expect(h.out()).toContain(`${RECORD.id}  v1  ${WHEN}  archived  {"to"`);
    expect(h.out()).toContain("More: --after next-cursor");
    // Words, and the project's records: the project is the command's own flag.
    const searched = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["plugin", "hello", "records", "greetings", "--search", "moon", "--project", "web"],
        searched.io,
      ),
    ).toBe(EXIT.ok);
    expect(searched.out()).toBe("No records.\n");
    const one = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "records", "greetings", RECORD.id], one.io)).toBe(
      EXIT.ok,
    );
    expect(one.out()).toContain(`id: ${RECORD.id}  collection: greetings  version: 1`);
    expect(one.out()).toContain(`owner: ${BOB.id}`);
    expect(one.out()).toContain('"to": "world"');
    const versions = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["plugin", "hello", "records", "greetings", RECORD.id, "--versions"],
        versions.io,
      ),
    ).toBe(EXIT.ok);
    expect(versions.out()).toContain(`v1  ${WHEN}  by ${BOB.id}  {"to":"world"`);
    const bad = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "records", "greetings", "--where", "nope"], bad.io),
    ).toBe(EXIT.usage);
  });

  it("reads a plugin's skills as a project's pack, and says where the plugins' skills are after the project's", async () => {
    const { fetch } = fakeConsole({
      [`GET ${AT}/skills`]: {
        body: {
          ...LISTING,
          address: "/local/plugins/hello",
          source: null,
          page: null,
          items: [
            {
              ...LISTING.items[0],
              page: null,
              uri: "skill://local/plugins/hello/review/SKILL.md",
            },
          ],
          mount: {
            ...MOUNT,
            address: "/local/plugins/hello",
            repository: {
              ...MOUNT.repository,
              host: "local",
              owner: "plugins",
              name: "hello",
              defaultBranch: "",
              avatar: "",
            },
            verified: true,
          },
        },
      },
      [`GET ${IN}/skills`]: { body: LISTING },
    });
    const h = harness({ fetch, env: SIGNED_IN, skillsDir: "/usr/lib/skills/" });
    expect(await runCli(["plugin", "hello", "skills"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(
      "skills at /local/plugins/hello, read from the console's machine: ready",
    );
    expect(h.out()).toContain("review/SKILL.md: Reviews a change.");
    expect(h.out()).not.toContain("The console's own skills");
    expect(h.out()).not.toContain("The plugins of this console have skills");
    const project = harness({ fetch, env: SIGNED_IN, skillsDir: "/usr/lib/skills/" });
    expect(await runCli(["skills"], project.io)).toBe(EXIT.ok);
    expect(project.out()).toContain(
      "The console's own skills, for working the board and keeping a desk: /usr/lib/skills/",
    );
    expect(project.out()).toContain(
      "The plugins of this console have skills of their own: console plugins lists the plugins, console plugin <key> skills the skills of one.",
    );
  });

  it("says what a plugin requires and what it can go without, and turns the optional ones on and off (ADR-0060)", async () => {
    const OPTIONAL = {
      ...DETAIL,
      capabilities: ["board:read"],
      optionalCapabilities: ["jobs", "files"],
    };
    const { fetch, calls } = fakeConsole({
      [`GET ${AT}`]: { body: { ...OPTIONAL, consent: ["board:read", "jobs"] } },
      "GET /api/v1/me": { body: ME },
      [`POST ${AT}/enable`]: { body: { ...OPTIONAL, board: null, projects: "all" } },
      [`PATCH ${AT}/consent`]: { body: { ...OPTIONAL, consent: ["board:read", "files"] } },
    });
    // Enabling names what it requires; what it can go without is said, and left off.
    const enabling = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "enable", "--consent", "board:read"], enabling.io),
    ).toBe(EXIT.ok);
    expect(enabling.out()).toContain("hello requires one capability:\n  board:read: opens ");
    expect(enabling.out()).toContain("It can go without these");
    expect(enabling.out()).toContain("  jobs: opens ");
    expect(calls.find((call) => call.key === `POST ${AT}/enable`)?.body).toMatchObject({
      consent: ["board:read"],
    });
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "capabilities"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain("required: board:read");
    expect(read.out()).toContain("optional, on: jobs");
    expect(read.out()).toContain("optional, off: files");
    // What it requires stays, whatever is named; `none` takes every optional one away.
    const changed = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "capabilities", "--consent", "files"], changed.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ consent: ["board:read", "files"] });
    expect(changed.out()).toContain("optional, on: files");
    const none = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "capabilities", "--consent", "none"], none.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toEqual({ consent: ["board:read"] });
    const stray = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "capabilities", "files"], stray.io)).toBe(EXIT.usage);
  });

  it("lists a secret kept per key by its keys, and sets and removes its value under one key (ADR-0111)", async () => {
    const TEAM = {
      ...SECRET,
      key: "teamToken",
      name: { en: "Bot token" },
      set: true,
      setAt: null,
      keyed: { max: 50 },
      keys: [
        { key: "T0001", setAt: WHEN, expiresAt: null, source: "slack.com" },
        { key: "T0002", setAt: WHEN, expiresAt: null, source: "administrator" },
      ],
    };
    const { fetch, calls } = fakeConsole({
      [`GET ${AT}`]: { body: { ...DETAIL, settings: [SETTING, TEAM] } },
      "GET /api/v1/me": { body: ME },
      [`PUT ${AT}/secrets/teamToken/keys/T0003`]: { status: 204 },
      [`DELETE ${AT}/secrets/teamToken/keys/T0001`]: { status: 204 },
    });
    const shown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "settings"], shown.io)).toBe(EXIT.ok);
    expect(shown.out()).toContain("  teamToken (secret, per key): 2 of 50 keys  Bot token\n");
    expect(shown.out()).toMatch(/\n {4}T0001: set [^\n]* from slack\.com\n {4}T0002: set /);
    const sealed = harness({ fetch, env: SIGNED_IN, readStdin: async () => "xoxb-s3cret\n" });
    expect(
      await runCli(["plugin", "hello", "secret", "teamToken", "--key", "T0003"], sealed.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`PUT ${AT}/secrets/teamToken/keys/T0003`);
    expect(calls.at(-1)?.body).toEqual({ value: "xoxb-s3cret" });
    expect(sealed.out()).toContain("Set the secret teamToken under T0003 of hello");
    expect(sealed.out()).not.toContain("xoxb-s3cret");
    const removed = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["plugin", "hello", "secret", "teamToken", "--key", "T0001", "--remove"],
        removed.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`DELETE ${AT}/secrets/teamToken/keys/T0001`);
    expect(removed.out()).toContain("Removed the secret teamToken under T0001 of hello.");
  });

  it("enables with consent to every capability after saying what each opens, configures, seals a secret, grants and revokes", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${AT}`]: { body: { ...DETAIL, state: "installed", capabilities: ["files"] } },
      "GET /api/v1/me": { body: ME },
      [`POST ${AT}/enable`]: {
        body: { ...DETAIL, board: { key: "hello-board", name: "Hello board" }, projects: "all" },
      },
      [`PATCH ${AT}/settings`]: { body: DETAIL },
      [`PUT ${AT}/secrets/token`]: { status: 204 },
      [`DELETE ${AT}/secrets/token`]: { status: 204 },
      "GET /api/v1/people?login=bob": { body: { items: [BOB], listed: [], organization: null } },
      [`POST ${AT}/grants`]: { status: 201, body: GRANT },
      [`DELETE ${AT}/grants/${GRANT.id}`]: { body: GRANT },
      [`POST ${AT}/disable`]: { body: { ...DETAIL, state: "disabled" } },
    });
    // Without consent to every capability: what each opens is said, and nothing is asked of the console.
    const asked = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "enable"], asked.io)).toBe(EXIT.usage);
    expect(asked.out()).toContain("hello requires one capability:\n  files: opens ");
    expect(asked.err()).toContain("--consent files. Not named: files.");
    expect(calls.some((call) => call.key === `POST ${AT}/enable`)).toBe(false);
    const enabled = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "plugin",
          "hello",
          "enable",
          "--consent",
          "files",
          "--board",
          "new",
          "--set",
          "greeting=Hey",
        ],
        enabled.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `POST ${AT}/enable`)?.body).toEqual({
      consent: ["files"],
      board: { create: { key: "hello-board", name: "Hello board", description: "" } },
      projects: "all",
      settings: { greeting: "Hey" },
    });
    expect(enabled.out()).toContain(
      "Enabled hello, with the board project hello-board; on every project.",
    );
    expect(enabled.out()).not.toContain("The workspace has no time zone");
    // A plugin that reads a time of day while the workspace has no time zone: the administrator is told.
    const zoneless = fakeConsole({
      [`GET ${AT}`]: { body: { ...DETAIL, state: "installed", capabilities: ["files"] } },
      "GET /api/v1/me": { body: ME },
      [`POST ${AT}/enable`]: {
        body: { ...DETAIL, board: null, projects: "all", needsTimeZone: true },
      },
    });
    const told = harness({ fetch: zoneless.fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "enable", "--consent", "files"], told.io)).toBe(
      EXIT.ok,
    );
    expect(told.out()).toContain(
      "The workspace has no time zone: the plugin's times of day run on UTC until an administrator sets one, with console workspace edit --time-zone <zone>.",
    );
    // A plugin that names the mark of its project (ADR-0155): the project is made with it. One
    // that names none, or a console of before, which answers no mark, sends none, as above.
    const marked = fakeConsole({
      [`GET ${AT}`]: {
        body: {
          ...DETAIL,
          state: "installed",
          capabilities: ["files"],
          boardDefaults: { ...DETAIL.boardDefaults, glyph: "calendar", color: "teal" },
        },
      },
      "GET /api/v1/me": { body: ME },
      [`POST ${AT}/enable`]: {
        body: { ...DETAIL, board: { key: "hello-board", name: "Hello board" }, projects: "all" },
      },
    });
    const made = harness({ fetch: marked.fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "enable", "--consent", "files", "--board", "new"], made.io),
    ).toBe(EXIT.ok);
    expect(marked.calls.find((call) => call.key === `POST ${AT}/enable`)?.body).toEqual({
      consent: ["files"],
      board: {
        create: {
          key: "hello-board",
          name: "Hello board",
          description: "",
          color: "teal",
          glyph: "calendar",
        },
      },
      projects: "all",
    });
    const chosen = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        [
          "plugin",
          "hello",
          "enable",
          "--consent",
          "files",
          "--board",
          "ops",
          "--projects",
          "web,ops",
        ],
        chosen.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({
      consent: ["files"],
      board: { project: "ops" },
      projects: ["web", "ops"],
    });
    // The settings: shown, changed as their types have it, a secret set from standard input alone.
    const shown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "settings"], shown.io)).toBe(EXIT.ok);
    expect(shown.out()).toContain('Settings of hello:\n  greeting (text): "Hi"  Greeting');
    const changed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "settings", "--set", "greeting="], changed.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toEqual({ values: { greeting: null } });
    const secretly = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "settings", "--set", "token=x"], secretly.io)).toBe(
      EXIT.usage,
    );
    expect(secretly.err()).toContain("token is a secret: console plugin hello secret token");
    const sealed = harness({ fetch, env: SIGNED_IN, readStdin: async () => "s3cret\n" });
    expect(await runCli(["plugin", "hello", "secret", "token"], sealed.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`PUT ${AT}/secrets/token`);
    expect(calls.at(-1)?.body).toEqual({ value: "s3cret" });
    expect(sealed.out()).not.toContain("s3cret");
    // At a terminal the value is typed unseen, after a prompt naming the secret; it reaches the
    // console and nothing the command prints.
    const prompts: string[] = [];
    const typed = harness({
      fetch,
      env: SIGNED_IN,
      readStdin: async () => {
        throw new Error("standard input is not read when the terminal is asked");
      },
      readSecret: async (prompt) => {
        prompts.push(prompt);
        return "typ3d\n";
      },
    });
    expect(await runCli(["plugin", "hello", "secret", "token"], typed.io)).toBe(EXIT.ok);
    expect(prompts).toEqual(["Secret token of hello (typed unseen; Enter ends it): "]);
    expect(calls.at(-1)?.body).toEqual({ value: "typ3d" });
    expect(typed.out() + typed.err()).not.toContain("typ3d");
    const empty = harness({ fetch, env: SIGNED_IN, readStdin: async () => "" });
    expect(await runCli(["plugin", "hello", "secret", "token"], empty.io)).toBe(EXIT.usage);
    expect(empty.err()).toContain("Type the value at the prompt, or redirect a file into it");
    expect(empty.err()).toContain("Never give it on the command line");
    const removed = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "secret", "token", "--remove"], removed.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.key).toBe(`DELETE ${AT}/secrets/token`);
    // Grants: to a person by login, to everyone; and taken back by id.
    const granted = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "grant", "greeter", "--person", "bob"], granted.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ role: "greeter", person: BOB.id });
    expect(granted.out()).toContain(`Granted: ${GRANT.id}  greeter to person bob  since`);
    const everyone = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "grant", "greeter", "--everyone"], everyone.io)).toBe(
      EXIT.ok,
    );
    expect(calls.at(-1)?.body).toEqual({ role: "greeter", everyone: true });
    const members = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "grant", "greeter", "--project", "ops"], members.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ role: "greeter", project: "ops" });
    const asPlugin = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "grant", "greeter", "--plugin", "messenger"], asPlugin.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ role: "greeter", plugin: "messenger" });
    const toTeam = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["plugin", "hello", "grant", "greeter", "--team", "platform"], toTeam.io),
    ).toBe(EXIT.ok);
    expect(calls.at(-1)?.body).toEqual({ role: "greeter", team: "platform" });
    const whom = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "grant", "greeter"], whom.io)).toBe(EXIT.usage);
    const revoked = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "revoke", GRANT.id], revoked.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`DELETE ${AT}/grants/${GRANT.id}`);
    expect(revoked.out()).toContain("Revoked: ");
    const disabled = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["plugin", "hello", "disable"], disabled.io)).toBe(EXIT.ok);
    expect(disabled.out()).toContain("Disabled hello:");
  });

  it("prints the plugins the console names with the rules, a line each, with take and with rules", async () => {
    const ruled = {
      ...RULES,
      plugins: [
        {
          key: "hello",
          name: { en: "Hello" },
          agentNote: { en: "Keeps greetings as records; greet someone with greet." },
          description: { en: "Greetings kept as records." },
          roles: ["greeter"],
        },
        {
          key: "leave",
          name: { en: "Leave" },
          agentNote: null,
          description: { en: "Leave requests and their approval." },
          roles: ["employee"],
        },
      ],
    };
    const { fetch } = fakeConsole({
      [`GET ${IN}/rules`]: { body: ruled },
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
      [`GET ${IN}/tasks/${TASK.id}/comments`]: { body: { items: [] } },
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(
      "## Plugins\n\n- hello (Hello): Keeps greetings as records; greet someone with greet. Start with console plugin hello.\n- leave (Leave): Leave requests and their approval. Start with console plugin leave.",
    );
    const taken = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], taken.io)).toBe(EXIT.ok);
    expect(taken.out()).toMatch(/Ask before pushing\.[\s\S]*## Plugins[\s\S]*Say how it goes/);
    // The workspace's rules alone, with every plugin the person may use; none named, nothing said.
    const bare = fakeConsole({
      "GET /api/v1/rules": { body: { ...RULES.workspace, plugins: [] } },
      "GET /api/v1/me": { body: ME },
    });
    const w = harness({
      fetch: bare.fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
    });
    expect(await runCli(["rules"], w.io)).toBe(EXIT.ok);
    expect(w.out()).not.toContain("## Plugins");
  });
});
