import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_LENGTH } from "../limits.js";
import { type CliIo, EXIT, runCli } from "./cli.js";
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
/** The rules as a project answers them: the console's own at the workspace, and the project's own page. */
const RULES = {
  workspace: {
    source: "reference",
    body: "# Rules for agents on this board\n\nRead these.",
    page: null,
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
const OPEN_RUNS = `GET ${IN}/runs?open=true&mine=true`;

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
    // Every command is on the map, but the two that are started on a machine and left to run:
    // the one a person serves a console of their own with, and an agent account's runner.
    for (const [name, help] of Object.entries(COMMAND_HELP)) {
      if (name !== "serve" && name !== "runner") {
        expect(whole.out()).toContain(`  console ${help.overview ?? help.usage}\n`);
      }
    }
    expect(whole.out()).not.toContain(
      "--token-stdin takes a token made by hand instead, typed unseen",
    );
    expect(whole.out()).not.toContain("--parent <number|id>");
    // A map stays one: what the agent accounts added (ADR-0084, ADR-0087) is five commands, a
    // line each.
    expect(whole.out().length).toBeLessThan(11_300);
    // What holds everywhere: every exit code, the fourth included.
    expect(whole.out()).toContain("4 the command and the\nconsole do not go together");
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
    expect(h.out()).toContain("The session is kept while it is used");
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
      "What this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command",
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
      [`GET ${IN}/tasks?limit=50&offset=0`]: { body: { more: false, items: [TASK] } },
      "GET /api/v1/projects/ops/tasks?limit=50&offset=0": { body: { more: false, items: [] } },
      "GET /api/v1/projects/dir/tasks?limit=50&offset=0": { body: { more: false, items: [] } },
    });
    const flagged = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks", "--project", "ops"], flagged.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("GET /api/v1/projects/ops/tasks?limit=50&offset=0");
    const fromDirectory = harness({
      fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
      directory: memoryDirectory({ project: "dir" }).store,
    });
    expect(await runCli(["tasks"], fromDirectory.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("GET /api/v1/projects/dir/tasks?limit=50&offset=0");
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
    expect(used.out()).toContain("Working in The web app (web) from this directory on");
    expect(used.out()).toContain("left out of a public one");
    expect(used.out()).toContain("/work/app/.skillcdn-console.json");
    expect(used.out()).toContain(
      "**Bound to a console?** When `.skillcdn-console.json` is in this checkout, or `console whoami` names a project",
    );
    expect(directory.kept()).toEqual({ project: "web" });
    const unknown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["use", "nothing"], unknown.io)).toBe(EXIT.failed);
    expect(unknown.err()).toContain("not_found");
    const who = harness({
      fetch: fakeConsole({ "GET /api/v1/me": { body: ME } }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["whoami"], who.io)).toBe(EXIT.ok);
    expect(who.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project web\nWhat this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command (console skills says where it is).\nThis command is of a version it does not know; the console is 0.1.18 and takes >=0.1.18 <0.2.0; this command works with a console from 0.0.0 on.\n`,
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

  it("takes the token from the environment over what was kept, and answers JSON on demand", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks?limit=50&offset=0`]: { body: { more: false, items: [TASK] } },
    });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      store: memoryStore(one("https://other.test", "cns_t_kept")).store,
    });
    expect(await runCli(["tasks", "--json"], h.io)).toBe(EXIT.ok);
    expect(JSON.parse(h.out())).toEqual({ more: false, items: [TASK] });
    expect(calls[0]?.key).toBe(`GET ${IN}/tasks?limit=50&offset=0`);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_secret");
    const words = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks"], words.io)).toBe(EXIT.ok);
    expect(words.out()).toBe("#7  ready  high  Fix the parser  (owner alice)\n");
  });

  it("lists the pack as a client is told of it on connect, every skill and document, and where the console's own skills are", async () => {
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
    // Every skill and document, as a search without words lists them.
    expect(out).toContain("1. skill: review (review/SKILL.md)\n   Reviews a change.");
    expect(out).toContain("2. document: docs/guide.md - Guide");
    // Where a person connects an agent of its own, and where the console's own skills are.
    expect(out).toContain("a person makes at https://skillcdn.test/gh/acme/skills");
    expect(out).toContain(
      "The console's own skills, for working the board: /usr/lib/node_modules/@skillcdn/console/skills/",
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
    const n = harness({ fetch: none.fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], n.io)).toBe(EXIT.ok);
    expect(n.out()).toBe(
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
    expect(await runCli(["skills"], d.io)).toBe(EXIT.ok);
    expect(d.out()).toContain("could not be reached");
    expect(d.out()).toContain("No answer.");
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
    // The rules come with the run, the workspace's then the project's, before what to do next.
    expect(h.out()).toMatch(/Read these\.[\s\S]*Ask before pushing\.[\s\S]*Say how it goes/);
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
    expect(JSON.parse(asJson.out())).toEqual({
      run: RUN,
      task: TASK,
      comments: [COMMENT],
      rules: RULES,
    });
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

  it("reads the rules as they are for the person: {language} filled with the language they read in", async () => {
    const ruled = {
      ...RULES,
      workspace: { ...RULES.workspace, body: "# Ours. Write what people read in {language}." },
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

  it("reads the rules that hold, writes a project's or the workspace's, and puts them away", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/rules": { body: RULES.workspace },
      "GET /api/v1/me": { body: ME },
      [`PUT ${IN}/docs/rules`]: { body: { ...RULES_DOC, version: 3 } },
      "PUT /api/v1/rules": {
        body: { source: "written", body: "# Ours", page: { ...RULES_PAGE, version: 1 } },
      },
      "POST /api/v1/rules/archive": { body: RULES.workspace },
      [`POST ${IN}/docs/rules/archive`]: { body: { ...RULES_DOC, archivedAt: WHEN } },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(
      "Rules of the workspace: the console's own, until an administrator writes the organization's (console rules write --workspace).",
    );
    expect(h.out()).toContain("Read these.");
    expect(h.out()).toContain("Rules of this project (v2, by alice; ");
    expect(h.out()).toContain("Ask before pushing.");
    // Without a project named, the workspace's alone.
    const alone = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["rules"], alone.io)).toBe(EXIT.ok);
    expect(alone.out()).toContain("Read these.");
    expect(alone.out()).not.toContain("this project");
    const written = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write", "--body", "# Ours"], written.io)).toBe(EXIT.ok);
    expect(written.out()).toBe("Wrote this project's rules, version 3.\n");
    expect(calls.at(-1)?.body).toEqual({ title: "Rules", body: "# Ours" });
    const workspace = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(
        ["rules", "write", "--workspace", "--body", "# Ours", "--base", "2"],
        workspace.io,
      ),
    ).toBe(EXIT.ok);
    expect(workspace.out()).toBe("Wrote the workspace's rules, version 1.\n");
    expect(calls.at(-1)?.body).toEqual({ body: "# Ours", baseVersion: 2 });
    const away = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write", "none", "--workspace"], away.io)).toBe(EXIT.ok);
    expect(away.out()).toBe("The organization's rules are put away: the console's own hold.\n");
    const projectAway = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write", "none"], projectAway.io)).toBe(EXIT.ok);
    expect(projectAway.out()).toBe("This project's rules are put away: it adds none now.\n");
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["rules", "write"], nothing.io)).toBe(EXIT.usage);
    expect(nothing.err()).toContain("none to put the written rules away");
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
    expect(h.out()).toContain(`for ${BOB.login})`);
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
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { more: false, items: [RUN] } },
      [`POST ${IN}/runs/${RUN.id}/end`]: {
        body: { ...RUN, status: "finished", summary: "Done." },
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["finish", "--summary", "Done."], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("up for review");
    expect(calls[1]?.body).toEqual({ status: "finished", summary: "Done." });
    expect(await runCli(["fail"], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.ok);
    expect(calls[3]?.body).toEqual({ status: "failed" });
    expect(await runCli(["abandon", RUN.id], harness({ fetch, env: SIGNED_IN }).io)).toBe(EXIT.ok);
    expect(calls[4]?.key).toBe(`POST ${IN}/runs/${RUN.id}/end`);
    expect(calls[4]?.body).toEqual({ status: "abandoned" });
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
      [`GET ${IN}/tasks?limit=50&offset=0`]: {
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
      [`GET ${IN}/tasks?limit=50&offset=0`]: {
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
      [`GET ${IN}/tasks?open=true&worker=${PERSON.id}&dueBy=2026-10-10&limit=50&offset=0`]: {
        body: { more: false, items: [{ ...TASK, dueOn: "2026-10-01" }] },
      },
      [`GET ${IN}/tasks?category=engineering&goal=${GOAL.id}&limit=50&offset=0`]: {
        body: { more: false, items: [] },
      },
      [`GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0`]: {
        body: { more: false, items: [TASK] },
      },
      [`GET ${IN}/tasks?unassigned=true&limit=50&offset=0`]: {
        body: { more: false, items: [TASK] },
      },
      [`GET ${IN}/tasks?q=fix+parser&limit=50&offset=0`]: {
        body: { more: false, items: [TASK] },
      },
    });
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
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0`);
    const bad = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--due", "soon"], bad.io)).toBe(EXIT.usage);
    expect(bad.err()).toContain("Not a day: soon");
    const nobodys = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--unassigned"], nobodys.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/tasks?unassigned=true&limit=50&offset=0`);
    expect(nobodys.out()).toBe("#7  ready  high  Fix the parser  (owner alice)\n");
    const both = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--mine", "--unassigned"], both.io)).toBe(EXIT.usage);
    expect(both.err()).toContain("--unassigned");
    // The words of a title find a task, as a parent is found (ADR-0037); blank words are no search.
    const searched = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--search", "fix parser"], searched.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe(`GET ${IN}/tasks?q=fix+parser&limit=50&offset=0`);
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
      [`GET ${IN}/tasks?goal=${GOAL.id}`]: { body: { more: false, items: [TASK] } },
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
      [`GET ${IN}/tasks?limit=1&offset=1`]: { body: { more: true, items: [TASK] } },
      [`GET ${IN}/decisions?open=true&limit=50&offset=0`]: {
        body: { more: false, items: [DECISION] },
      },
      [`GET ${IN}/runs?open=true&limit=2&offset=0`]: { body: { more: true, items: [RUN] } },
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
      `GET ${IN}/tasks?limit=1&offset=1`,
      `GET ${IN}/decisions?open=true&limit=50&offset=0`,
      `GET ${IN}/runs?open=true&limit=2&offset=0`,
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
      "@mira  Mira, Release engineer  (signs in as acme-mira, reports to bob, not signed in yet)",
    );
    // The account it signs in with is named, and when it has to be there; who makes it at the
    // provider is the organization's to say, and the command says nothing of it (ADR-0094).
    expect(full.out()).toContain(
      "It signs in as acme-mira: that account is made at the provider before its machine is set up",
    );
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
    const taken = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "mira", "--login", "x"], taken.io)).toBe(EXIT.failed);
    const unsaid = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "new", "mira"], unsaid.io)).toBe(EXIT.usage);
    expect(unsaid.err()).toContain("--login <login>");
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

    // The record, the newest first, a line each, and where it goes on.
    const record = harness({ fetch, env: SIGNED_IN });
    expect(
      await runCli(["agent", "signals", "@mira", "--limit", "2", "--before", "9"], record.io),
    ).toBe(EXIT.ok);
    expect(record.out()).toBe(
      [
        `#8  interrupt  bob through Claude Code  ${WHEN}  From a file, on two lines.`,
        `#7  wake  board: #412  ${WHEN}`,
        "More before: console agent signals mira --before 7",
        "",
      ].join("\n"),
    );
    // The account's own, as `me`.
    const mine = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "signals", "me"], mine.io)).toBe(EXIT.ok);
    expect(mine.out()).toBe("No signal yet.\n");
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
              runner: "0.4.8",
              product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: false },
              offers: { models: [], efforts: [], steer: true, images: true, resume: true },
              running: { model: "opus", effort: null },
              settings: { model: "sonnet", effort: "high" },
            },
          },
        },
      ],
    });
    const unheard = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "mira"], unheard.io)).toBe(EXIT.ok);
    expect(unheard.out()).toContain("state: no runner has been heard from yet");
    expect(unheard.out()).not.toContain("runner:");
    const full = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["agent", "mira"], full.io)).toBe(EXIT.ok);
    expect(full.out()).toContain(
      [
        `state: refused (model refused) since ${WHEN}; its runner was last heard from ${WHEN}`,
        "runner: 0.4.8 on mac-mini (macOS 15.1), as mira",
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
      "  Run: console agent setup --console https://console.test --code ABCD-EFGH (before it: npm i -g @skillcdn/console), then do what it prints",
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
    expect(read.out()).toContain("## 2. On the machine (the agent)");
    expect(read.out()).toContain("      console agent setup --refresh");
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
    expect(one.out()).toContain("color: teal  symbol: OP  image: none");
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
      version: "0.4.8",
      runner: host({
        readText: async (path) => {
          read.push(path);
          return path === "runner.json" ? "{}" : undefined;
        },
        // Told to stop as soon as it listens for it.
        untilStopped: async () => undefined,
      }),
    });
    expect(await runCli(["runner"], run.io)).toBe(EXIT.ok);
    expect(run.out()).toContain(
      "The runner of @mira at Acme (https://console.test) starts in /home/mira/desk.",
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
      runner: "0.4.8",
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
      runner: "0.4.8",
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
    } = {},
  ) {
    const files = new Map(Object.entries(over.files ?? {}));
    const written: { path: string; mode: number }[] = [];
    const runs: {
      command: string;
      args: readonly string[];
      env: Readonly<Record<string, string>> | undefined;
    }[] = [];
    const opened: string[] = [];
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
        runs.push({ command, args, env: options?.env });
        return over.ran?.(command, args) ?? { code: 0, out: "", err: "" };
      },
      open: async (url) => {
        opened.push(url);
        return true;
      },
    };
    return { machine, files, written, runs, opened };
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
    // What it keeps is the account's own session, as the default here; its secret is said nowhere.
    expect(store.kept()).toMatchObject({
      default: ORIGIN,
      logins: [{ url: ORIGIN, account: "acme-mira", token: "cns_a_handed", self: true }],
    });
    expect(out).toContain(
      "Signed in as @mira: what this command does from now on, the account does.",
    );
    expect(out).not.toContain("cns_a_handed");
    expect(out).not.toContain("Next, say which project");
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
    expect(clone?.env?.GIT_CONFIG_KEY_1).toBe("credential.helper");
    expect(clone?.env?.GIT_CONFIG_VALUE_1).toContain("$CONSOLE_DESK_TOKEN");
    expect(JSON.stringify(clone?.args)).not.toContain("not-a-real-token");
    expect(clone?.env?.GIT_CONFIG_VALUE_1).not.toContain("not-a-real-token");
    expect(run.out()).toContain(
      "The desk is cloned from https://github.com/acme-mira/desk.git into /Users/mira/desk.",
    );
    expect(run.out()).not.toContain("not-a-real-token");
    expect(at.written.map((file) => file.path)).toEqual([UNIT]);

    // A clone that fails stops the setup, and writes no desk in its place.
    const refused = fakeMachine({
      ran: (command) =>
        command === "git"
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
      ran: () => ({ code: 1, out: "", err: "Failed to connect to bus: No medium found\n" }),
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

describe("the versions of the command and the console (ADR-0025)", () => {
  const SAYS = { version: "0.1.18", clientRange: ">=0.1.18 <0.2.0" };
  const GLOBAL: Install = {
    kind: "global",
    manager: "npm",
    root: "C:/Users/alice/AppData/Roaming/npm",
  };
  const IN_PROJECT: Install = { kind: "project", manager: "pnpm", root: "/work/app" };
  const NO_TASKS = {
    [`GET ${IN}/tasks?limit=50&offset=0`]: { body: { more: false, items: [] } },
  };

  it("names itself on every request, and says where it is installed and what the console takes", async () => {
    const { fetch, calls } = fakeConsole({ "GET /api/v1/me": { body: ME } }, SAYS);
    const userAgent = "skillcdn-console/0.1.18 (cli; node 24.11.0; win32)";
    const h = harness({ fetch, env: SIGNED_IN, version: "0.1.18", userAgent, install: GLOBAL });
    expect(await runCli(["whoami"], h.io)).toBe(EXIT.ok);
    expect(new Headers(calls[0]?.init?.headers).get("user-agent")).toBe(userAgent);
    expect(h.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project web\nWhat this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command (console skills says where it is).\nThis command is 0.1.18, installed for the machine with npm in C:/Users/alice/AppData/Roaming/npm; the console is 0.1.18 and takes >=0.1.18 <0.2.0; this command works with a console from 0.1.0 on.\n`,
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
      "How the board is worked: the skill working-the-board, shipped with this command: C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\@skillcdn\\console\\skills\\working-the-board\\SKILL.md\n",
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
      fetch: fakeConsole({ "GET /api/v1/me": { body: ME } }, SAYS).fetch,
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
      [`GET ${IN}/tasks?limit=50&offset=0`]: { status: 426, body: { error: { code, message } } },
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
  });

  it("still reads a console older than the rule, and says that it does not say its version", async () => {
    const { console: _, ...older } = ME;
    const h = harness({
      fetch: fakeConsole({ "GET /api/v1/me": { body: older } }).fetch,
      env: SIGNED_IN,
      version: "0.1.18",
    });
    expect(await runCli(["whoami"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toBe(
      `alice (member) at Acme, ${ORIGIN}; project web\nWhat this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command (console skills says where it is).\nThis command is 0.1.18; the console does not say its version, so it is older than 0.1.18.\n`,
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
  const tasks = { [`GET ${IN}/tasks?limit=50&offset=0`]: { body: { more: false, items: [TASK] } } };

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
    // The default console is not named: a directory that says only the project follows the default.
    const plain = memoryDirectory();
    const first = harness({ fetch, store: memoryStore(both).store, directory: plain.store });
    expect(await runCli(["use", "web"], first.io)).toBe(EXIT.ok);
    expect(plain.kept()).toEqual({ project: "web" });
    // Two accounts at a console: the one used is named.
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
    expect(named.kept()).toEqual({ project: "web", account: "bob" });
    expect(JSON.stringify([directory.kept(), plain.kept(), named.kept()])).not.toContain("cns_t_");
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
      [`GET ${IN}/skills/file?path=review%2Fguide.md`]: {
        body: file("review/guide.md", "How to ", 0, 7, 14),
      },
      [`GET ${IN}/skills/file?path=review%2Fguide.md&offset=7`]: {
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
    const read = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill", "--file", "review/guide.md"], read.io)).toBe(EXIT.ok);
    expect(read.out()).toContain("File: review/guide.md (14 characters)");
    expect(read.out()).toContain("--- content ---\nHow to review.");
    expect(read.out()).not.toContain("More follows");
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
    expect(await runCli(["skill", "review/SKILL.md"], refused.io)).toBe(EXIT.ok);
    expect(refused.out()).toContain("pack token");
    expect(refused.out()).toContain("console project pack-token");
    expect(refused.out()).toContain("The token is no good here.");
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skill"], nothing.io)).toBe(EXIT.usage);
  });

  it("reads a file of the pack by --file alone, browses a folder page after page, and searches by words", async () => {
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
      [`GET ${IN}/skills/file?path=README.md`]: {
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
    expect(folder).toContain("- file: docs/roadmap.md (Roadmap)");
    expect(folder).not.toContain("nextCursor");
    expect(calls.map((call) => call.key).filter((key) => key.includes("browse"))).toEqual([
      `GET ${IN}/skills/browse?path=docs`,
      `GET ${IN}/skills/browse?path=docs&cursor=two`,
    ]);
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
    expect(results).toContain('nextCursor: "more"');
    // The same JSON the console answered, with the pages joined.
    const json = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs", "--json"], json.io)).toBe(EXIT.ok);
    const parsed = JSON.parse(json.out()) as {
      read: { entries: { path: string }[]; nextCursor: string | null };
    };
    expect(parsed.read.entries.map((entry) => entry.path)).toEqual([
      "docs/adr",
      "docs/review/SKILL.md",
      "docs/architecture.md",
      "docs/roadmap.md",
    ]);
    expect(parsed.read.nextCursor).toBeNull();
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

  it("outlines a document of the pack across its pages, and reads one section of it as asked (SkillCDN 0.4)", async () => {
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
    // The outline whole, its pages joined, with the read that takes a section named as the command.
    const outlined = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills", "docs/guide.md"], outlined.io)).toBe(EXIT.ok);
    const printed = outlined.out();
    expect(printed).toContain(
      "File: docs/guide.md (390 characters; 2 headings)\nSource: acme/skills (commit 0123456)",
    );
    expect(printed).toContain(
      "Outline; a section is read with console skill --file: the path, its offset and its limit.\n- # Guide (offset 0, limit 120)\n  - ## Setup (offset 120, limit 270)",
    );
    expect(printed).not.toContain("nextCursor");
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
    expect(parsed.read.outline.headings.map((heading) => heading.text)).toEqual(["Guide", "Setup"]);
    expect(parsed.read.entries).toEqual([]);
    expect(parsed.read.nextCursor).toBeNull();
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
      [`GET ${IN}/tasks?archived=true&limit=50&offset=0`]: {
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

describe("the console the command works with (ADR-0038)", () => {
  it("refuses a console older than its floor itself, in the console's form, and works with one at it", async () => {
    const routes = {
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/projects": { body: { items: [] } },
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
      [`GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0`]: nothing,
    });
    const m = harness({ fetch: monday.fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["tasks", "--due", "week"], m.io)).toBe(EXIT.ok);
    expect(monday.calls.at(-1)?.key).toBe(`GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0`);
    // Left to the language, a Korean week begins on Sunday: the week of the 11th ends on the 17th.
    const korean = fakeConsole({
      "GET /api/v1/me": { body: { ...ME, language: "ko" } },
      [`GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0`]: nothing,
    });
    const k = harness({ fetch: korean.fetch, env: SIGNED_IN, now: () => NOON, locale: "en-GB" });
    expect(await runCli(["tasks", "--due", "week"], k.io)).toBe(EXIT.ok);
    expect(korean.calls.at(-1)?.key).toBe(`GET ${IN}/tasks?dueBy=2026-10-17&limit=50&offset=0`);
    // No language chosen: the machine's, a British one beginning on Monday.
    const british = fakeConsole({
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0`]: nothing,
    });
    const b = harness({ fetch: british.fetch, env: SIGNED_IN, now: () => NOON, locale: "en-GB" });
    expect(await runCli(["tasks", "--due", "week"], b.io)).toBe(EXIT.ok);
    expect(british.calls.at(-1)?.key).toBe(`GET ${IN}/tasks?dueBy=2026-10-11&limit=50&offset=0`);
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
    expect(one.out()).toContain("Board project: none yet.");
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
      "The console's own skills, for working the board: /usr/lib/skills/",
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

  it("prints the plugins the console names after the rules, a line each, with take and with rules", async () => {
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
