import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_LENGTH } from "../limits.js";
import { type CliIo, EXIT, runCli } from "./cli.js";
import { type CredentialStore, type Credentials, CredentialsError } from "./credentials.js";
import type { DirectorySettings, DirectoryStore } from "./directory.js";
import type { Install } from "./install.js";
import type { NoticeStore, VersionNotice } from "./notices.js";
import type { Listen, ServeHandler } from "./serve.js";

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
  assignee: null,
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
    expect(whole.out()).not.toContain("--token-stdin reads a token");
    expect(whole.out()).not.toContain("--parent <number|id>");
    expect(whole.out().length).toBeLessThan(11_000);
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
    expect(login.out()).toContain("--token-stdin reads a token");
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
    expect(h.out() + down.out()).not.toContain("cns_");
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
      `alice (member) at Acme, ${ORIGIN}; project web\nWhat this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command (console skills says where it is).\nThis command is of a version it does not know; the console is 0.1.18 and takes >=0.1.18 <0.2.0.\n`,
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
      "console skills <folder> explores folders; console skills --search matches",
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
    expect(n.out()).toBe("No skills address: neither this project nor the console names one.\n");
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

  it("reads the rules as they are for the person: {language} filled with the language they chose", async () => {
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
    // Nothing chosen: the task's language, as the people of the board wrote it.
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
    expect(shown.out()).toContain("waits for a person.");
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
  });
});

describe("the plan on the command line", () => {
  /** Noon on 2026-10-11 by this machine's clock: the day the tests count from. */
  const NOON = Date.parse("2026-10-11T12:00:00");
  const BOB = { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" };

  it("narrows the tasks by what is due, one's own, a category and a goal", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      [`GET ${IN}/tasks?open=true&assignee=${PERSON.id}&dueBy=2026-10-10&limit=50&offset=0`]: {
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
      [`PATCH ${IN}/tasks/${TASK.id}`]: { body: { ...TASK, assignee: PERSON } },
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
          "--assignee",
          "bob",
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
      assigneeId: BOB.id,
      parentId,
    });
    expect(h.out()).toContain("Task #7 written");
    const edit = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(
      await runCli(
        ["task", "edit", "7", "--due", "none", "--assignee", "me", "--category", "none"],
        edit.io,
      ),
    ).toBe(EXIT.ok);
    expect(calls.find((call) => call.key === `PATCH ${IN}/tasks/${TASK.id}`)?.body).toEqual({
      category: null,
      dueOn: null,
      assigneeId: PERSON.id,
    });
    expect(edit.out()).toContain("assignee: alice");
    const nothing = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["task", "edit", "7"], nothing.io)).toBe(EXIT.usage);
    expect(nothing.err()).toContain("Say what to change");
    const nobody = harness({ fetch, env: SIGNED_IN, now: () => NOON });
    expect(await runCli(["task", "edit", "7", "--assignee", "carol"], nobody.io)).toBe(EXIT.usage);
    expect(nobody.err()).toContain("Nobody of the workspace is called carol");
  });

  it("lists the roadmap, reads a goal with its tasks, sets one and changes one", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/goals`]: { body: { more: false, items: [GOAL] } },
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
    expect(plate.out()).toContain("tasks assigned to you:");
    expect(plate.out()).toContain("  web  #7  ready  high  Fix the parser");
    expect(plate.out()).toContain("decisions waiting: none");
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
              task: { ...TASK, assignee: bob },
            },
          ],
        },
      },
    });
    const seen = harness({ fetch, env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" } });
    expect(await runCli(["work", "--person", "Bob"], seen.io)).toBe(EXIT.ok);
    expect(seen.out()).toContain("tasks assigned to bob:");
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
    const wrong = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "edit", "--people-visibility", "friends"], wrong.io)).toBe(
      EXIT.usage,
    );
    const nothing = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["workspace", "edit"], nothing.io)).toBe(EXIT.usage);
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
      `alice (member) at Acme, ${ORIGIN}; project web\nWhat this organization asks of agents: console rules. How the board is worked: the skill working-the-board, shipped with this command (console skills says where it is).\nThis command is 0.1.18, installed for the machine with npm in C:/Users/alice/AppData/Roaming/npm; the console is 0.1.18 and takes >=0.1.18 <0.2.0.\n`,
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
      [`GET ${IN}/goals?state=active&category=engineering`]: {
        body: { more: false, items: [PLANNED] },
      },
      [`GET ${IN}/goals?category=design`]: { body: { more: false, items: [] } },
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
        { url: ORIGIN, account: "alice", agent: null, since: null, default: true },
        { url: OTHER, account: "alice", agent: "Codex", since: WHEN, default: false },
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
