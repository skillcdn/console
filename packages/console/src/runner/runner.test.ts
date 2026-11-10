import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../client.js";
import type {
  RestAgentSession,
  RestAgentSessionInput,
  RestRunnerHeartbeatInput,
  RestSignal,
  RestTranscriptEventInput,
} from "../schemas.js";
import { DEFAULT_RUNNER_CONFIG, type RunnerConfig } from "./config.js";
import { WITHHELD } from "./redact.js";
import { createRunner, type RunnerClient, type RunnerState } from "./runner.js";
import type { Driver, DriverEvent, DriverMessage, StartOptions } from "./types.js";

// The runner against a console and a product that are both the test's: what it asks of the
// one and hands the other, in order. The durations are shortened; nothing waits on a clock the
// test does not let run.

const WHEN = "2026-11-10T14:02:11.000Z";
const JANE = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  host: "gh",
  login: "jane",
  name: "Jane",
  avatarUrl: null,
  role: "member",
  status: "active",
  createdAt: WHEN,
} as unknown as NonNullable<RestSignal["by"]>;
const TOKEN = "not-a-real-token-4f9a2c71";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what: string, predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waited in vain for ${what}`);
    }
    await sleep(5);
  }
}

/** A session of a product the test speaks for. */
function fakeSession(options: StartOptions, can: { set: boolean }) {
  const sent: DriverMessage[] = [];
  const queue: DriverEvent[] = [];
  let waiting: (() => void) | undefined;
  let closed = false;
  const emit = (...events: DriverEvent[]) => {
    queue.push(...events);
    waiting?.();
  };
  const state = { interrupted: 0, stopped: false, set: [] as object[] };
  return {
    options,
    sent,
    state,
    emit,
    session: {
      send: async (message: DriverMessage) => {
        if (closed) {
          throw new Error("the process takes no more input");
        }
        sent.push(message);
      },
      interrupt: async () => {
        state.interrupted += 1;
      },
      set: async (choice: object) => {
        state.set.push(choice);
        return can.set;
      },
      stop: async () => {
        state.stopped = true;
        emit({ type: "ended", how: "exited" });
      },
      events: (async function* () {
        for (;;) {
          while (queue.length === 0) {
            await new Promise<void>((resolve) => {
              waiting = resolve;
            });
          }
          const event = queue.shift();
          if (event === undefined) {
            continue;
          }
          yield event;
          if (event.type === "ended") {
            closed = true;
            return;
          }
        }
      })(),
    },
  };
}

function fakeDriver(
  over: { set?: boolean; onStart?: (session: ReturnType<typeof fakeSession>) => void } = {},
) {
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const driver: Driver = {
    name: "claude",
    product: { name: "Claude Code", tried: ["2.1.0"] },
    can: { steer: true, images: true, resume: true, set: over.set ?? false },
    probe: async () => ({ version: "2.1.0", models: ["opus", "sonnet"], efforts: ["low", "high"] }),
    start(options) {
      const session = fakeSession(options, { set: over.set ?? false });
      sessions.push(session);
      over.onStart?.(session);
      return session.session;
    },
  };
  return { driver, sessions };
}

/** A console the test speaks for: what it was told, and what it sends. */
function fakeConsole() {
  const beats: RestRunnerHeartbeatInput[] = [];
  const begun: RestAgentSessionInput[] = [];
  const ended: string[] = [];
  const streams: number[] = [];
  const kept = new Map<string, RestTranscriptEventInput[]>();
  const uploads: string[] = [];
  const signals: RestSignal[] = [];
  const secrets = new Map<string, string>();
  const read: string[] = [];
  /** The pictures of signals the runner asked for, as number and id. */
  const fetched: string[] = [];
  const listeners = new Set<() => void>();
  const says = {
    delivered: 0,
    state: undefined as "stopped" | undefined,
    settings: { model: null as string | null, effort: null as string | null },
    /** What the next sending of a transcript is answered with, once. */
    refuse: undefined as ApiError | undefined,
    sessions: 0,
  };
  const sessionOf = (id: string, input?: RestAgentSessionInput): RestAgentSession => ({
    id,
    month: "2026-11",
    startedAt: WHEN,
    endedAt: null,
    ended: null,
    product: input?.product ?? {
      driver: "claude",
      name: "Claude Code",
      version: null,
      tried: false,
    },
    model: input?.model ?? null,
    effort: input?.effort ?? null,
    resumed: input?.resumed ?? false,
    machine: input?.machine ?? { name: "m", os: "o", user: "u" },
    events: kept.get(id)?.length ?? 0,
    lastEventAt: null,
    away: false,
  });
  const client: RunnerClient = {
    runnerHeartbeat: async (input) => {
      beats.push(input);
      says.delivered = Math.max(says.delivered, input.delivered);
      return {
        latest: signals.length,
        delivered: says.delivered,
        settings: says.settings,
        state: says.state ?? input.state,
      };
    },
    signalStream: (after, abort) => {
      streams.push(after);
      return (async function* () {
        let cursor = after;
        while (!abort.aborted) {
          const next = signals.find((signal) => signal.number > cursor);
          if (next !== undefined) {
            cursor = next.number;
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            const done = () => {
              listeners.delete(done);
              resolve();
            };
            listeners.add(done);
            abort.addEventListener("abort", done, { once: true });
          });
        }
      })();
    },
    beginAgentSession: async (input) => {
      begun.push(input);
      says.sessions += 1;
      const id = `0199c4d8-0000-7000-8000-00000000000${says.sessions}`;
      kept.set(id, []);
      return sessionOf(id, input);
    },
    sendTranscript: async (id, input) => {
      if (says.refuse !== undefined) {
        const refusal = says.refuse;
        says.refuse = undefined;
        throw refusal;
      }
      const events = kept.get(id) ?? [];
      for (const event of input.events) {
        if (event.n === events.length + 1) {
          events.push(event);
        } else if (event.n > events.length + 1) {
          throw new ApiError(409, "transcript.gap", "A gap.");
        }
      }
      kept.set(id, events);
      return { last: events.length };
    },
    uploadTranscriptFile: async (_id, file) => {
      uploads.push(file.name);
      return {
        id: `0199c4d8-0000-7000-8000-0000000000f${uploads.length}`,
        name: file.name,
        size: 3,
        contentType: file.contentType ?? "image/png",
      };
    },
    endAgentSession: async (id, input) => {
      ended.push(input.how);
      return sessionOf(id);
    },
    agentSession: async (_handle, id) => sessionOf(id),
    secrets: async () => ({
      items: [...secrets.keys()].map((name) => ({
        name,
        setAt: WHEN,
        seeded: false,
        expiresOn: null,
      })),
    }),
    readSignalFile: async (number, fileId) => {
      fetched.push(`${number}/${fileId}`);
      return { name: fileId, contentType: "image/png", bytes: Uint8Array.from([9, 8, 7]) };
    },
    secret: async (name) => {
      read.push(name);
      return { name, value: secrets.get(name) ?? "", setAt: WHEN, seeded: false, expiresOn: null };
    },
  };
  return {
    client,
    beats,
    begun,
    ended,
    streams,
    kept,
    uploads,
    secrets,
    read,
    fetched,
    says,
    /** Sends a signal: the next number of the record. */
    signal(over: Partial<RestSignal> = {}): RestSignal {
      const signal: RestSignal = {
        number: signals.length + 1,
        kind: "tell",
        by: JANE,
        agent: null,
        plugin: null,
        source: "person",
        key: null,
        text: "",
        set: null,
        attachments: [],
        at: new Date().toISOString(),
        ...over,
      };
      signals.push(signal);
      // As the console does: a choice is kept with the account, and the heartbeat answers it.
      if (signal.kind === "set" && signal.set !== null) {
        says.settings = signal.set;
      }
      for (const listener of [...listeners]) {
        listener();
      }
      return signal;
    },
    /** The events the console has of the session begun `index`th, as kind and text. */
    events: (index = 1) =>
      (kept.get(`0199c4d8-0000-7000-8000-00000000000${index}`) ?? []).map((event) => [
        event.n,
        event.kind,
        event.text,
      ]),
  };
}

const running: { stop(): void; done: Promise<void> }[] = [];
afterEach(async () => {
  for (const one of running.splice(0)) {
    one.stop();
    await one.done;
  }
});

function setup(
  over: {
    config?: Partial<RunnerConfig>;
    driver?: Parameters<typeof fakeDriver>[0];
    state?: RunnerState;
    before?: (console: ReturnType<typeof fakeConsole>) => void;
  } = {},
) {
  const console = fakeConsole();
  over.before?.(console);
  const product = fakeDriver(over.driver);
  const saved: RunnerState[] = [];
  const files = { written: [] as [string, string][], removed: [] as string[] };
  const log: string[] = [];
  const runner = createRunner({
    client: console.client,
    driver: product.driver,
    config: { ...DEFAULT_RUNNER_CONFIG, ...over.config },
    cwd: "/home/mira/desk",
    machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
    version: "0.4.8",
    now: () => Date.now(),
    random: () => 0.5,
    time: () => "14:02",
    files: {
      write: async (path, text) => {
        files.written.push([path, text]);
      },
      remove: async (path) => {
        files.removed.push(path);
      },
    },
    state: {
      load: async () => over.state,
      save: async (state) => {
        saved.push(state);
      },
    },
    log: (line) => log.push(line),
    timing: {
      heartbeatMs: 40,
      batchMs: 10,
      groupWindowMs: 25,
      coolDownMs: 200,
      maxCoolDownMs: 500,
      reconnectMs: 10,
    },
  });
  const done = runner.run();
  running.push({ stop: () => runner.stop(), done });
  return { console, product, saved, files, log, runner, done };
}

/** The session started `index`th, once it was. */
async function sessionOf(product: ReturnType<typeof fakeDriver>, index = 1) {
  await until(`session ${index} to start`, () => product.sessions.length >= index);
  const session = product.sessions[index - 1];
  if (session === undefined) {
    throw new Error("no session");
  }
  return session;
}
const STARTED: DriverEvent[] = [
  { type: "running", model: "opus", effort: "high", version: "2.1.0" },
  { type: "conversation", id: "c-1" },
  { type: "event", kind: "status", text: "The product started." },
];

describe("the runner", () => {
  it("says it is there, and listens from where the console's record stands", async () => {
    const { console } = setup({
      state: { delivered: 3, conversation: "c-0" },
      before: (at) => {
        at.says.delivered = 5;
      },
    });
    await until("the stream to be asked for", () => console.streams.length === 1);
    // The most either side has: a runner that lost its count goes on from the console's.
    expect(console.streams).toEqual([5]);
    expect(console.beats[0]).toEqual({
      state: "running",
      reason: "started",
      delivered: 3,
      session: null,
      machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
      runner: "0.4.8",
      product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
      offers: {
        models: ["opus", "sonnet"],
        efforts: ["low", "high"],
        steer: true,
        images: true,
        resume: true,
      },
      running: { model: null, effort: null },
    });
    // And again, while nothing happens.
    await until("a second heartbeat", () => console.beats.length >= 2);
  });

  it("begins a session when there is something to deliver, and hands it over under a header", async () => {
    const { console, product, saved } = setup();
    console.signal({ text: "Hold the release." });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    expect(session.options).toEqual({
      cwd: "/home/mira/desk",
      env: {},
      model: null,
      effort: null,
      resume: undefined,
    });
    expect(console.begun).toEqual([
      {
        product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
        model: null,
        effort: null,
        resumed: false,
        machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
      },
    ]);
    const [message] = session.sent;
    const mark = /^\[console ([a-z0-9]{6}) · session\]\n/.exec(message?.text ?? "")?.[1];
    expect(mark).toBeDefined();
    expect(message?.text).toContain(`carries the mark ${mark}`);
    expect(
      message?.text.endsWith(`[console ${mark} #1 · tell · Jane · 14:02]\nHold the release.`),
    ).toBe(true);
    expect(message).toMatchObject({ images: [], priority: "next" });

    // What the product does is reported in order, after what it was sent.
    session.emit(
      ...STARTED,
      { type: "event", kind: "assistant", text: "Held." },
      { type: "turn_completed" },
    );
    await until("the transcript", () => console.events().length === 3);
    expect(console.events()).toEqual([
      [1, "person", "Hold the release."],
      [2, "status", "The product started."],
      [3, "assistant", "Held."],
    ]);
    expect(console.kept.values().next().value?.[0]?.data).toEqual({
      signal: 1,
      kind: "tell",
      source: "person",
      key: null,
      by: "jane",
      agent: null,
    });
    // What it keeps for its own next start: the last signal delivered, and the conversation.
    await until("the state", () => saved.at(-1)?.conversation === "c-1");
    expect(saved.at(-1)).toEqual({ delivered: 1, conversation: "c-1" });
    await until("a heartbeat with the session", () =>
      console.beats.some(
        (beat) => beat.session !== null && beat.delivered === 1 && beat.running.model === "opus",
      ),
    );
  });

  it("hands over what arrives together as one message, and says what a header is once a session", async () => {
    const { console, product } = setup();
    console.signal({ text: "First." });
    console.signal({ kind: "wake", by: null, source: "board", key: "#412", text: "ready" });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    expect(session.sent[0]?.text).toContain("#1 · tell · Jane · 14:02]\nFirst.\n\n[console");
    expect(session.sent[0]?.text).toContain("#2 · wake · board: #412 · 14:02]\nready");
    session.emit(...STARTED, { type: "turn_completed" });
    console.signal({ text: "Second." });
    await until("the second message", () => session.sent.length === 2);
    expect(session.sent[1]?.text).toMatch(
      /^\[console [a-z0-9]{6} #3 · tell · Jane · 14:02\]\nSecond\.$/,
    );
    expect(console.begun).toHaveLength(1);
    expect(console.events().map((event) => event[1])).toContain("wake");
  });

  it("stops the turn under way for an interrupt, and gives its words at once", async () => {
    const { console, product } = setup();
    console.signal({ text: "A long task." });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    console.signal({ kind: "interrupt", text: "Stop that." });
    await until("the interrupt", () => session.sent.length === 2);
    expect(session.sent[1]).toMatchObject({ priority: "now" });
    expect(session.sent[1]?.text).toContain("#2 · interrupt · Jane · 14:02]\nStop that.");
    // With no turn under way there is nothing to stop: the words are read as a tell's are.
    session.emit({ type: "turn_completed" });
    await sleep(20);
    console.signal({ kind: "interrupt", text: "Another word." });
    await until("the words", () => session.sent.length === 3);
    expect(session.sent[2]).toMatchObject({ priority: "next" });
  });

  it("stops for a supervisor and stays stopped: what arrives is kept until a restart, which goes on with the conversation", async () => {
    const { console, product } = setup();
    console.signal({ text: "Begin." });
    const first = await sessionOf(product);
    await until("the message", () => first.sent.length === 1);
    first.emit(...STARTED, { type: "turn_completed" });
    await until("the conversation", () => console.events().length >= 2);

    console.signal({ kind: "stop", text: "Wait for the review." });
    await until("the stop", () => console.ended.length === 1);
    expect(first.state.stopped).toBe(true);
    expect(console.ended).toEqual(["stopped"]);
    await until("the state", () => console.beats.at(-1)?.state === "stopped");
    expect(console.beats.at(-1)).toMatchObject({ state: "stopped", reason: "stop", session: null });
    // The session's record says it was stopped, by whom, and that it ended.
    expect(console.events().slice(-2)).toEqual([
      [expect.any(Number), "person", "Wait for the review."],
      [expect.any(Number), "status", "The session ended: stopped."],
    ]);

    console.signal({ text: "Meanwhile." });
    await sleep(120);
    expect(product.sessions).toHaveLength(1);

    console.signal({ kind: "restart", text: "Go on." });
    const second = await sessionOf(product, 2);
    await until("the message", () => second.sent.length === 1);
    expect(second.options.resume).toBe("c-1");
    expect(console.begun[1]).toMatchObject({ resumed: true });
    const text = second.sent[0]?.text ?? "";
    expect(text).toMatch(/^\[console [a-z0-9]{6} · session\]/);
    expect(text).not.toContain("You were reset");
    expect(text).toContain("#3 · tell · Jane · 14:02]\nMeanwhile.");
    expect(text).toContain("#4 · restart · Jane · 14:02]\nGo on.");
    await until("the state", () => console.beats.at(-1)?.state === "running");
    expect(console.beats.some((beat) => beat.reason === "resumed")).toBe(true);
  });

  it("begins a new conversation for a reset, and says who reset it", async () => {
    const { console, product, saved } = setup();
    console.signal({ text: "Begin." });
    const first = await sessionOf(product);
    await until("the message", () => first.sent.length === 1);
    first.emit(...STARTED);
    await until("the conversation", () => saved.at(-1)?.conversation === "c-1");
    // In the middle of a turn: the session ends all the same.
    console.signal({ kind: "reset", text: "Start over from the board." });
    const second = await sessionOf(product, 2);
    await until("the message", () => second.sent.length === 1);
    expect(console.ended).toEqual(["reset"]);
    expect(second.options.resume).toBeUndefined();
    expect(console.begun[1]).toMatchObject({ resumed: false });
    expect(second.sent[0]?.text).toContain("You were reset by Jane: this is a new conversation");
    expect(second.sent[0]?.text).toContain(
      "#2 · reset · Jane · 14:02]\nStart over from the board.",
    );
    expect(saved.some((state) => state.conversation === undefined && state.delivered === 1)).toBe(
      true,
    );
  });

  it("takes the model and the effort chosen for it at the next session, which begins when no turn is under way", async () => {
    const { console, product } = setup();
    console.signal({ text: "Begin." });
    const first = await sessionOf(product);
    await until("the message", () => first.sent.length === 1);
    first.emit(...STARTED);
    await until("the transcript", () => console.events().length >= 2);
    // Mid-turn: the choice waits for the turn to complete.
    console.signal({ kind: "set", set: { model: "sonnet", effort: "low" } });
    await until("the driver to be asked", () => first.state.set.length === 1);
    await sleep(40);
    expect(console.ended).toEqual([]);
    first.emit({ type: "turn_completed" });
    await until("the session to end", () => console.ended.length === 1);
    expect(console.ended).toEqual(["restarted"]);

    console.signal({ text: "Go on." });
    const second = await sessionOf(product, 2);
    expect(second.options).toMatchObject({ model: "sonnet", effort: "low", resume: "c-1" });
    expect(console.begun[1]).toMatchObject({ model: "sonnet", effort: "low", resumed: true });
    // A product that takes them in a running session keeps its session.
    const live = setup({ driver: { set: true } });
    live.console.signal({ text: "Begin." });
    const session = await sessionOf(live.product);
    await until("the message", () => session.sent.length === 1);
    session.emit(...STARTED, { type: "turn_completed" });
    live.console.signal({ kind: "set", set: { model: "sonnet", effort: null } });
    await until("the driver to be asked", () => session.state.set.length === 1);
    await sleep(40);
    expect(live.console.ended).toEqual([]);
  });

  it("waits when the agent cannot go on: a supervisor's word is tried at once, the rest after a cool-down", async () => {
    const { console, product } = setup();
    console.signal({ text: "Begin." });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    session.emit(...STARTED, { type: "cannot_go_on", state: "refused", reason: "model_refused" });
    await until("the state", () => console.beats.at(-1)?.state === "refused");
    expect(console.beats.at(-1)).toMatchObject({ state: "refused", reason: "model_refused" });
    // Nothing is restarted, and what arrives by itself waits.
    const asked = Date.now();
    console.signal({ kind: "wake", by: null, source: "board", key: "#7" });
    await sleep(80);
    expect(session.sent).toHaveLength(1);
    expect(product.sessions).toHaveLength(1);
    await until("the cool-down to end", () => session.sent.length === 2);
    expect(Date.now() - asked).toBeGreaterThanOrEqual(150);
    expect(session.sent[1]?.text).toContain("#2 · wake · board: #7");

    // Refused again: the wait is twice as long, and a supervisor's word does not wait for it.
    session.emit({ type: "cannot_go_on", state: "refused", reason: "model_refused" });
    await sleep(20);
    console.signal({ kind: "wake", by: null, source: "board", key: "#8" });
    await sleep(60);
    expect(session.sent).toHaveLength(2);
    console.signal({ text: "Try this instead." });
    await until("the supervisor's word", () => session.sent.length === 3);
    expect(session.sent[2]?.text).toContain("#3 · wake · board: #8");
    expect(session.sent[2]?.text).toContain("#4 · tell · Jane · 14:02]\nTry this instead.");
    // A turn that completes ends the waiting.
    session.emit({ type: "turn_completed" });
    await until("the state", () => console.beats.at(-1)?.reason === "completed");
    expect(console.beats.at(-1)).toMatchObject({ state: "running", reason: "completed" });
    expect(console.begun).toHaveLength(1);
  });

  it("tries again what a product that did not start never took, after the cool-down, and says it failed", async () => {
    let starts = 0;
    const { console, product } = setup({
      driver: {
        onStart: (session) => {
          starts += 1;
          if (starts === 1) {
            session.emit(
              { type: "event", kind: "error", text: "The product could not be started: ENOENT" },
              { type: "cannot_go_on", state: "failed", reason: "start" },
              { type: "ended", how: "crashed" },
            );
          }
        },
      },
    });
    console.signal({ text: "Begin." });
    await until("the failure", () => console.beats.some((beat) => beat.state === "failed"));
    expect(console.beats.find((beat) => beat.state === "failed")).toMatchObject({
      reason: "start",
    });
    await until("the end of the session", () => console.ended.length === 1);
    expect(console.ended).toEqual(["crashed"]);
    // Tried again by itself once the cool-down is over, with what was to be said.
    const second = await sessionOf(product, 2);
    await until("the message", () => second.sent.length === 1);
    expect(second.sent[0]?.text).toContain("#1 · tell · Jane · 14:02]\nBegin.");
    second.emit(...STARTED, { type: "turn_completed" });
    await until("the state", () => console.beats.at(-1)?.state === "running");
  });

  it("hands a session the secrets runner.json names, and takes every value of the store out of what it reports", async () => {
    const { console, product, files, runner, done } = setup({
      config: {
        secrets: {
          env: { GIT_TOKEN: "git.token", MISSING: "not.kept" },
          files: { ".netrc": "netrc" },
        },
      },
      before: (at) => {
        at.secrets.set("git.token", TOKEN);
        at.secrets.set("netrc", "machine git.example password hunter2-not-real");
        at.secrets.set("mail.password", "another-invented-value");
      },
    });
    console.signal({ text: "Begin." });
    const session = await sessionOf(product);
    expect(session.options.env).toEqual({ GIT_TOKEN: TOKEN });
    expect(files.written).toEqual([[".netrc", "machine git.example password hunter2-not-real"]]);
    // Every value of the store was read, the ones no session is handed among them.
    expect([...console.read].sort()).toEqual(["git.token", "mail.password", "netrc"]);
    session.emit(
      ...STARTED,
      {
        type: "event",
        kind: "tool_result",
        text: `GIT_TOKEN=${TOKEN}\nAuthorization: Basic ${Buffer.from(`mira:${TOKEN}`).toString("base64")}\n`,
        data: { id: "toolu_01", echoed: "another-invented-value" },
      },
      { type: "turn_completed" },
    );
    await until("the transcript", () => console.events().length === 3);
    const reported = JSON.stringify([...console.kept.values()]);
    expect(reported).not.toContain(TOKEN);
    expect(reported).not.toContain(Buffer.from(TOKEN).toString("base64").slice(4, -4));
    expect(reported).not.toContain("another-invented-value");
    expect(console.events()[2]?.[2]).toContain(`GIT_TOKEN=${WITHHELD}`);
    // Its files go with the session.
    runner.stop();
    await done;
    expect(files.removed).toEqual([".netrc"]);
    expect(console.ended).toEqual(["exited"]);
  });

  it("hands in the pictures an event carries, and goes on from where the console stands after a gap or a refusal", async () => {
    const { console, product, log } = setup();
    console.signal({ text: "Begin." });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    await until("the first event", () => console.events().length === 1);
    // The console is away for one batch: kept, and sent with the next.
    console.says.refuse = new ApiError(0, "network", "The server could not be reached.");
    session.emit({
      type: "event",
      kind: "tool_result",
      text: "A screenshot.",
      pictures: [
        { name: "tool-1-1.png", contentType: "image/png", bytes: Uint8Array.from([1, 2, 3]) },
      ],
    });
    await until("the event", () => console.events().length === 2);
    expect(console.kept.values().next().value?.[1]?.files).toEqual([
      "0199c4d8-0000-7000-8000-0000000000f1",
    ]);
    expect(log.some((line) => line.includes("waits to be sent (network)"))).toBe(true);
    // A text beyond what the console takes is cut, and says so.
    session.emit({ type: "event", kind: "assistant", text: "x".repeat(300 * 1024) });
    await until("the long event", () => console.events().length === 3);
    const long = String(console.events()[2]?.[2]);
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(256 * 1024);
    expect(long).toContain("[cut by the runner: 307200 bytes in all]");
    // The console lost what it had: told of the gap, the runner asks where it stands and goes on from there.
    console.kept.set("0199c4d8-0000-7000-8000-000000000001", []);
    session.emit({ type: "event", kind: "assistant", text: "After the gap." });
    await until("the event after the gap", () => console.events().length === 1);
    expect(console.events()).toEqual([[1, "assistant", "After the gap."]]);
    // A session the console takes nothing more of is not sent to again.
    console.says.refuse = new ApiError(409, "transcript.session_over", "Over.");
    session.emit({ type: "event", kind: "assistant", text: "Too late." });
    await until("the refusal", () => log.some((line) => line.includes("takes nothing more")));
    session.emit({ type: "event", kind: "assistant", text: "And later." });
    await sleep(50);
    expect(console.events()).toHaveLength(1);
  });

  it("hands the product the pictures a supervisor sent, and keeps them with what the agent was sent", async () => {
    const { console, product } = setup();
    const picture = {
      id: "0199c4d8-0000-7000-8000-0000000000a1",
      name: "screen.png",
      size: 3,
      contentType: "image/png",
    };
    console.signal({ text: "Look at this.", attachments: [picture] });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    expect(console.fetched).toEqual([`1/${picture.id}`]);
    expect(session.sent[0]?.images).toEqual([
      { name: "screen.png", contentType: "image/png", bytes: Uint8Array.from([9, 8, 7]) },
    ]);
    // The transcript says what the agent was sent, the picture with it.
    await until("the transcript", () => console.events().length === 1);
    expect(console.uploads).toEqual(["screen.png"]);
    expect(console.kept.values().next().value?.[0]).toMatchObject({
      kind: "person",
      text: "Look at this.",
      files: ["0199c4d8-0000-7000-8000-0000000000f1"],
    });
  });

  it("holds a stop the console says stands, which the runner did not see itself", async () => {
    const { console, product } = setup({
      state: { delivered: 2, conversation: "c-1" },
      before: (at) => {
        at.says.state = "stopped";
        at.signal({ text: "Old." });
        at.signal({ kind: "stop" });
      },
    });
    await until("the stream", () => console.streams.length === 1);
    console.signal({ text: "Kept." });
    await sleep(120);
    expect(product.sessions).toHaveLength(0);
    expect(console.beats.at(-1)).toMatchObject({ state: "stopped", reason: "stop" });
    console.says.state = undefined;
    console.signal({ kind: "restart" });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    expect(session.options.resume).toBe("c-1");
    expect(session.sent[0]?.text).toContain("#3 · tell · Jane · 14:02]\nKept.");
  });

  it("begins a new conversation with the day where runner.json says daily, when the agent is idle then", async () => {
    const { console, product } = setup({ config: { conversation: "daily" } });
    console.signal({ text: "Begin." });
    const first = await sessionOf(product);
    await until("the message", () => first.sent.length === 1);
    first.emit(...STARTED, { type: "turn_completed" });
    await until("the transcript", () => console.events().length >= 2);
    console.signal({
      kind: "wake",
      by: null,
      source: "schedule",
      key: "day",
      text: "The day's briefing.",
    });
    const second = await sessionOf(product, 2);
    await until("the message", () => second.sent.length === 1);
    expect(console.ended).toEqual(["restarted"]);
    expect(second.options.resume).toBeUndefined();
    expect(second.sent[0]?.text).toContain(
      "#2 · wake · schedule: day · 14:02]\nThe day's briefing.",
    );
    expect(second.sent[0]?.text).not.toContain("You were reset");
  });

  it("asks for its stream again when it ends, from the last signal it received", async () => {
    const console = fakeConsole();
    const product = fakeDriver();
    let asked = 0;
    const stream = console.client.signalStream;
    const client: RunnerClient = {
      ...console.client,
      signalStream: (after, abort) => {
        asked += 1;
        if (asked === 1) {
          return (async function* () {
            yield* [] as RestSignal[];
            throw new ApiError(0, "network", "The stream of signals ended before its end.");
          })();
        }
        return stream(after, abort);
      },
    };
    const log: string[] = [];
    const runner = createRunner({
      client,
      driver: product.driver,
      config: DEFAULT_RUNNER_CONFIG,
      cwd: "/d",
      machine: { name: "m", os: "o", user: "u" },
      version: "0.4.8",
      now: () => Date.now(),
      random: () => 0.1,
      time: () => "14:02",
      files: { write: async () => undefined, remove: async () => undefined },
      state: { load: async () => undefined, save: async () => undefined },
      log: (line) => log.push(line),
      timing: { heartbeatMs: 40, batchMs: 10, groupWindowMs: 10, reconnectMs: 10 },
    });
    const done = runner.run();
    running.push({ stop: () => runner.stop(), done });
    console.signal({ text: "After the stream came back." });
    const session = await sessionOf(product);
    await until("the message", () => session.sent.length === 1);
    expect(asked).toBeGreaterThanOrEqual(2);
    expect(log.some((line) => line.includes("the stream of signals ended (network)"))).toBe(true);
  });
});
