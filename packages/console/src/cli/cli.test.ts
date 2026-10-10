import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_LENGTH } from "../limits.js";
import { type CliIo, EXIT, runCli } from "./cli.js";
import type { CredentialStore, Credentials } from "./credentials.js";
import type { DirectorySettings, DirectoryStore } from "./directory.js";

const WHEN = "2026-10-09T10:00:00.000Z";
const PERSON = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: null,
  avatar: null,
  role: "member",
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
  links: [],
  openDecisions: 0,
  openRuns: 0,
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
const ME = { workspace: { name: "Acme" }, person: PERSON, signIn: [] };
const PROJECT = {
  id: "0199c4d8-0000-7000-8000-000000000050",
  key: "web",
  name: "The web app",
  description: "",
  visibility: "private",
  skillsAddress: null,
  role: "member",
  openDecisions: 1,
  openRuns: 0,
  createdAt: WHEN,
  updatedAt: WHEN,
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
    readSecret: async () => "",
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
      readSecret: async () => "cns_t_nothing",
    });
    expect(await runCli(["login", "--url", "https://console.test"], r.io)).toBe(EXIT.failed);
    expect(r.err()).toContain("does not know this token");
    expect(empty.kept()).toBeUndefined();

    const path = harness({ fetch, store: memoryStore().store });
    expect(await runCli(["login", "--url", "https://console.test/board"], path.io)).toBe(
      EXIT.usage,
    );
    expect(path.err()).toContain("Not an origin");
  });

  it("works in the project the flag, the environment or the directory names, and says so when none does", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks`]: { body: { items: [TASK] } },
      "GET /api/v1/projects/ops/tasks": { body: { items: [] } },
      "GET /api/v1/projects/dir/tasks": { body: { items: [] } },
    });
    const flagged = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks", "--project", "ops"], flagged.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("GET /api/v1/projects/ops/tasks");
    const fromDirectory = harness({
      fetch,
      env: { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" },
      directory: memoryDirectory({ project: "dir" }).store,
    });
    expect(await runCli(["tasks"], fromDirectory.io)).toBe(EXIT.ok);
    expect(calls.at(-1)?.key).toBe("GET /api/v1/projects/dir/tasks");
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
      "web  The web app  (member; 1 decision waiting)\nops  Ops  (owner; 2 agents at work)\n",
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

  it("takes the token from the environment over what was kept, and answers JSON on demand", async () => {
    const { fetch, calls } = fakeConsole({ [`GET ${IN}/tasks`]: { body: { items: [TASK] } } });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      store: memoryStore({ url: "https://other.test", token: "cns_t_kept" }).store,
    });
    expect(await runCli(["tasks", "--json"], h.io)).toBe(EXIT.ok);
    expect(JSON.parse(h.out())).toEqual({ items: [TASK] });
    expect(calls[0]?.key).toBe(`GET ${IN}/tasks`);
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
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["skills"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain("skills at /gh/acme/skills, served by https://skillcdn.test: ready");
    expect(h.out()).toContain(
      "review  Reviews a change.\n    skill://gh/acme/skills/review/SKILL.md",
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

  it("takes a task by its number and says which run began", async () => {
    const { fetch, calls } = fakeConsole({
      [`GET ${IN}/tasks/7`]: { body: TASK },
      [`POST ${IN}/runs`]: { status: 201, body: RUN },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], h.io)).toBe(EXIT.ok);
    expect(h.out()).toContain(
      `Run ${RUN.id} began on #7 Fix the parser, as "Claude Code" for alice`,
    );
    expect(h.out()).toContain("It fails on empty input.");
    expect(calls[1]?.body).toEqual({ taskId: TASK.id });
    const named = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7", "--agent", "Codex on the laptop"], named.io)).toBe(EXIT.ok);
    expect(calls[3]?.body).toEqual({ taskId: TASK.id, agent: "Codex on the laptop" });
  });

  it("reports on the one open run, and asks which when there are several or none", async () => {
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { items: [RUN] } },
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
        body: { items: [RUN, { ...RUN, id: "0199c4d8-0000-7000-8000-000000000021" }] },
      },
    });
    const s = harness({ fetch: several.fetch, env: SIGNED_IN });
    expect(await runCli(["report", "which?"], s.io)).toBe(EXIT.failed);
    expect(s.err()).toContain("--run <id>");
    const none = fakeConsole({ [OPEN_RUNS]: { body: { items: [] } } });
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
      [OPEN_RUNS]: { body: { items: [RUN] } },
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
      [OPEN_RUNS]: { body: { items: [RUN] } },
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
      [OPEN_RUNS]: { body: { items: [RUN] } },
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
      [OPEN_RUNS]: { body: { items: [RUN] } },
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
      [OPEN_RUNS]: { body: { items: [RUN] } },
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
        body: { error: { code: "run.task_taken", message: "an agent is at work on it already" } },
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], h.io)).toBe(EXIT.failed);
    expect(h.err()).toBe("run.task_taken: an agent is at work on it already\n");
    const out = fakeConsole({
      [`GET ${IN}/tasks`]: {
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
