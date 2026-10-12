import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_LENGTH } from "../limits.js";
import { type CliIo, EXIT, runCli } from "./cli.js";
import type { CredentialStore, Credentials } from "./credentials.js";
import type { DirectorySettings, DirectoryStore } from "./directory.js";
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
};
const TOKEN = {
  id: "0199c4d8-0000-7000-8000-000000000030",
  name: "Claude Code on laptop",
  createdAt: WHEN,
  expiresAt: null,
  lastUsedAt: null,
};
const CONNECTION = {
  code: "ABCD-EFGH",
  url: `${"https://console.test"}/connect/ABCD-EFGH`,
  secret: "cns_c_secret",
  expiresAt: WHEN,
  interval: 1,
};
const PROJECT = {
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
const OPEN_RUNS = `GET ${IN}/runs?open=true&mine=true`;

interface Answer {
  readonly status?: number;
  readonly body?: unknown;
}

/** A console that answers from a table: one answer per route, or several in turn. */
function fakeConsole(table: Record<string, Answer | Answer[]>) {
  const calls: { key: string; init: RequestInit | undefined; body: unknown }[] = [];
  const fetch: CliIo["fetch"] = async (url, init) => {
    const key = `${init?.method ?? "GET"} ${url.replace(ORIGIN, "")}`;
    const raw = init?.body;
    calls.push({ key, init, body: typeof raw === "string" ? JSON.parse(raw) : undefined });
    const entry = table[key];
    const answer = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (answer === undefined) {
      return new Response(
        JSON.stringify({ error: { code: "not_found", message: "Nothing here." } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
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
    expect(memory.kept()).toEqual({ url: "https://console.test", token: "cns_t_new" });
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
    expect(memory.kept()).toEqual({ url: ORIGIN, token: "cns_t_handed" });
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
    expect(late.calls[0]?.body).toEqual({ agent: "The console command" });
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
    expect(used.out()).toContain("/work/app/.skillcdn-console.json");
    expect(directory.kept()).toEqual({ project: "web" });
    const unknown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["use", "nothing"], unknown.io)).toBe(EXIT.failed);
    expect(unknown.err()).toContain("not_found");
    const who = harness({
      fetch: fakeConsole({ "GET /api/v1/me": { body: ME } }).fetch,
      env: SIGNED_IN,
    });
    expect(await runCli(["whoami"], who.io)).toBe(EXIT.ok);
    expect(who.out()).toBe(`alice (member) at Acme, ${ORIGIN}; project web\n`);
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
      store: memoryStore({ url: "https://other.test", token: "cns_t_kept" }).store,
    });
    expect(await runCli(["tasks", "--json"], h.io)).toBe(EXIT.ok);
    expect(JSON.parse(h.out())).toEqual({ more: false, items: [TASK] });
    expect(calls[0]?.key).toBe(`GET ${IN}/tasks?limit=50&offset=0`);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_secret");
    const words = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks"], words.io)).toBe(EXIT.ok);
    expect(words.out()).toBe("#7  ready  high  Fix the parser  (owner alice)\n");
  });

  it("lists the organization's skills, each with what an agent loads it by", async () => {
    const skills = {
      address: "/gh/acme/skills",
      source: "https://skillcdn.test",
      page: "https://skillcdn.test/gh/acme/skills",
      status: "ready",
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
    };
    const { fetch } = fakeConsole({ [`GET ${IN}/skills`]: { body: skills } });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      skillsDir: "/usr/lib/node_modules/@skillcdn/console/skills/",
    });
    expect(await runCli(["skills"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("skills at /gh/acme/skills, served by https://skillcdn.test: ready");
    expect(h.out()).toContain(
      "review  Reviews a change.\n    skill://gh/acme/skills/review/SKILL.md",
    );
    // Where a person connects an agent that has no connection, and where the console's own skills are.
    expect(h.out()).toContain(
      "an agent without one is connected by a person at https://skillcdn.test/gh/acme/skills",
    );
    expect(h.out()).toContain(
      "The console's own skills, for working the board: /usr/lib/node_modules/@skillcdn/console/skills/",
    );
    const none = fakeConsole({
      [`GET ${IN}/skills`]: {
        body: {
          address: null,
          source: "https://skillcdn.ai",
          page: null,
          status: "none",
          items: [],
        },
      },
    });
    const n = harness({ fetch: none.fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], n.io)).toBe(EXIT.ok);
    expect(n.out()).toBe("No skills address: neither this project nor the console names one.\n");
    const down = fakeConsole({
      [`GET ${IN}/skills`]: { body: { ...skills, status: "unavailable", items: [] } },
    });
    const d = harness({ fetch: down.fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], d.io)).toBe(EXIT.ok);
    expect(d.out()).toContain("could not be reached");
  });

  it("takes a task by its number, says which run began, and prints the rules that hold", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
      [`GET ${IN}/rules`]: { body: RULES },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(
      `Run ${RUN.id} began on #7 Fix the parser, as "Claude Code" for alice`,
    );
    expect(h.out()).toContain("It fails on empty input.");
    // The rules come with the run, the workspace's then the project's, before what to do next.
    expect(h.out()).toMatch(/Read these\.[\s\S]*Ask before pushing\.[\s\S]*Say how it goes/);
    expect(calls[1]?.body).toEqual({ taskId: TASK.id });
    const named = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--agent", "Codex on the laptop"], named.io)).toBe(EXIT.ok);
    expect(calls[4]?.body).toEqual({ taskId: TASK.id, agent: "Codex on the laptop" });
    const asJson = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--json"], asJson.io)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.out())).toEqual({ run: RUN, task: TASK, rules: RULES });
  });

  it("reads the rules that hold, writes a project's or the workspace's, and puts them away", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/rules`]: { body: RULES },
      "GET /api/v1/rules": { body: RULES.workspace },
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
      `the report: notes.md (10 bytes, text/markdown; read at ${ORIGIN}${IN}/files/0199c4d8-0000-7000-8000-000000000022)`,
    );
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
  });

  it("writes a task with its plan, and changes one in what the flags say, none clearing a field", async () => {
    const parentId = "0199c4d8-0000-7000-8000-000000000011";
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/me": { body: ME },
      "GET /api/v1/people": { body: { items: [PERSON, BOB], listed: [], organization: null } },
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
  });

  it("shows another person's plate by their login, for whoever oversees them", async () => {
    const bob = { ...PERSON, id: "0199c4d8-0000-7000-8000-000000000002", login: "bob" };
    const { fetch } = fakeConsole({
      "GET /api/v1/people": { body: { items: [PERSON, bob], listed: [], organization: null } },
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

  it("lists the members, adds one, changes what they are, and takes them off the list", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/people": { body: { items: [PERSON, BOB], listed: [], organization: null } },
      [`GET ${IN}/members`]: {
        body: { items: [{ person: PERSON, role: "owner", addedAt: WHEN }] },
      },
      [`POST ${IN}/members`]: {
        status: 201,
        body: { person: BOB, role: "member", addedAt: WHEN },
      },
      [`PATCH ${IN}/members/${BOB.id}`]: { body: { person: BOB, role: "owner", addedAt: WHEN } },
      [`DELETE ${IN}/members/${BOB.id}`]: { status: 204 },
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
    expect(whole.out()).toContain('project new <key> "<name>"');
  });
});
