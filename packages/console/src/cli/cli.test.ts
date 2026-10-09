import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_LENGTH } from "../limits.js";
import { type CliIo, EXIT, runCli } from "./cli.js";
import type { CredentialStore, Credentials } from "./credentials.js";

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
  createdAt: WHEN,
  updatedAt: WHEN,
};
const ANSWERED = {
  ...DECISION,
  answer: { option: "2", note: "Carefully.", by: { ...PERSON, login: "bob" }, at: WHEN },
};
const ME = { workspace: { name: "Acme" }, person: PERSON, signIn: [] };
const ORIGIN = "https://console.test";
const SIGNED_IN = { CONSOLE_URL: ORIGIN, CONSOLE_TOKEN: "cns_t_secret" };
const OPEN_RUNS = "GET /api/v1/runs?open=true&mine=true";

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

  it("takes the token from the environment over what was kept, and answers JSON on demand", async () => {
    const { fetch, calls } = fakeConsole({ "GET /api/v1/tasks": { body: { items: [TASK] } } });
    const h = harness({
      fetch,
      env: SIGNED_IN,
      store: memoryStore({ url: "https://other.test", token: "cns_t_kept" }).store,
    });
    expect(await runCli(["tasks", "--json"], h.io)).toBe(EXIT.ok);
    expect(JSON.parse(h.out())).toEqual({ items: [TASK] });
    expect(calls[0]?.key).toBe("GET /api/v1/tasks");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer cns_t_secret");
    const words = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["tasks"], words.io)).toBe(EXIT.ok);
    expect(words.out()).toBe("#7  ready  high  Fix the parser  (owner alice)\n");
  });

  it("takes a task by its number and says which run began", async () => {
    const { fetch, calls } = fakeConsole({
      "GET /api/v1/tasks/7": { body: TASK },
      "POST /api/v1/runs": { status: 201, body: RUN },
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
      [`POST /api/v1/runs/${RUN.id}/reports`]: {
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
    expect(calls.at(-1)?.key).toBe(`POST /api/v1/runs/${RUN.id}/reports`);
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
      [`POST /api/v1/runs/${RUN.id}/artifacts`]: { status: 201, body: RUN },
      [`POST /api/v1/runs/${RUN.id}/files`]: { status: 201, body: handedIn },
      [`GET /api/v1/runs/${RUN.id}`]: { body: handedIn },
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
      "the report: notes.md (10 bytes, text/markdown; read at /api/v1/files/0199c4d8-0000-7000-8000-000000000022)",
    );
  });

  it("reads a body from a file or from standard input", async () => {
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { items: [RUN] } },
      [`POST /api/v1/runs/${RUN.id}/reports`]: { status: 201, body: RUN },
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
      "POST /api/v1/decisions": { status: 201, body: DECISION },
      [`GET /api/v1/decisions/${DECISION.id}?wait=50`]: [{ body: DECISION }, { body: ANSWERED }],
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
      "POST /api/v1/decisions": { status: 201, body: DECISION },
    });
    const u = harness({ fetch: unanswered.fetch, env: SIGNED_IN });
    expect(
      await runCli(["ask", "Which?", "--option", "a", "--option", "b", "--wait", "0"], u.io),
    ).toBe(EXIT.waiting);
    expect(u.out()).toContain(`console decision ${DECISION.id} --wait 100`);
    expect(unanswered.calls.map((call) => call.key)).toEqual([OPEN_RUNS, "POST /api/v1/decisions"]);

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
      [`GET /api/v1/decisions/${DECISION.id}`]: { body: DECISION },
      [`GET /api/v1/decisions/${DECISION.id}?wait=50`]: { body: DECISION },
      [`GET /api/v1/decisions/${DECISION.id}?wait=40`]: { body: DECISION },
    });
    // Every look at the clock is forty seconds later than the last.
    const h = harness({ fetch, env: SIGNED_IN, now: () => (clock += 40_000) });
    expect(await runCli(["decision", DECISION.id, "--wait", "120"], h.io)).toBe(EXIT.waiting);
    expect(calls.map((call) => call.key)).toEqual([
      `GET /api/v1/decisions/${DECISION.id}`,
      `GET /api/v1/decisions/${DECISION.id}?wait=50`,
      `GET /api/v1/decisions/${DECISION.id}?wait=40`,
    ]);
    const shown = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["decision", DECISION.id], shown.io)).toBe(EXIT.ok);
    expect(shown.out()).toContain("waits for a person.");
  });

  it("ends a run as finished, failed or abandoned", async () => {
    const { fetch, calls } = fakeConsole({
      [OPEN_RUNS]: { body: { items: [RUN] } },
      [`POST /api/v1/runs/${RUN.id}/end`]: {
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
    expect(calls[4]?.key).toBe(`POST /api/v1/runs/${RUN.id}/end`);
    expect(calls[4]?.body).toEqual({ status: "abandoned" });
  });

  it("says what the console refused, with its code, and hints at what to do", async () => {
    const { fetch } = fakeConsole({
      "GET /api/v1/tasks/7": { body: TASK },
      "POST /api/v1/runs": {
        status: 409,
        body: { error: { code: "run.task_taken", message: "an agent is at work on it already" } },
      },
    });
    const h = harness({ fetch, env: SIGNED_IN });
    expect(await runCli(["take", "7"], h.io)).toBe(EXIT.failed);
    expect(h.err()).toBe("run.task_taken: an agent is at work on it already\n");
    const out = fakeConsole({
      "GET /api/v1/tasks": {
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
