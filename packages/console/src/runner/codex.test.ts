import { describe, expect, it } from "vitest";
import { codexBuild, createCodexDriver } from "./codex.js";
import { ownRunnerModules } from "./modules.js";
import type { Child, DriverEvent, DriverMessage, StartOptions } from "./types.js";

// The `codex` driver against a product that is not there: one process a session, which the test
// speaks for, a JSON-RPC message a line. What it is written and what it answers are in the
// shapes the product's app server has (`codex app-server generate-ts`, 0.172.0). What the
// binary itself answered when it was spoken to signed out (0.139.0, 0.167.0, 0.172.0) is cut
// down to what a reader could take from it, with every id and path invented: how it begins and
// goes on with a thread, starts a turn and says its message back, takes a message into a turn,
// stops one, refuses what it refuses, and fails a turn for the sign-in. A turn's tools, its
// reasoning and what it asks leave for are in the generated shapes, and were not seen run.

type Json = Record<string, unknown>;

/** A process the test speaks for: what it was started with, what it was sent, and its output to write. */
function fakeChild(args: readonly string[], options: { cwd: string; env: object }) {
  const sent: string[] = [];
  const killed: string[] = [];
  const queue: (string | undefined)[] = [];
  let waiting: (() => void) | undefined;
  let exit: (how: { code: number | null; signal: string | null; error?: string }) => void = () =>
    undefined;
  let ended = false;
  let stderr = "";
  const exited = new Promise<{ code: number | null; signal: string | null; error?: string }>(
    (resolve) => {
      exit = resolve;
    },
  );
  const push = (line: string | undefined) => {
    queue.push(line);
    waiting?.();
  };
  const child: Child = {
    write: async (line) => {
      sent.push(line);
    },
    end: () => {
      ended = true;
    },
    lines: (async function* () {
      for (;;) {
        while (queue.length === 0) {
          await new Promise<void>((resolve) => {
            waiting = resolve;
          });
        }
        const line = queue.shift();
        if (line === undefined) {
          return;
        }
        yield line;
      }
    })(),
    errors: () => stderr,
    kill: (signal) => {
      killed.push(signal);
    },
    exited,
  };
  return {
    child,
    args,
    options,
    sent,
    killed,
    says: (...lines: unknown[]) => {
      for (const line of lines) {
        push(typeof line === "string" ? line : JSON.stringify(line));
      }
    },
    /** The output closes and the process ends. */
    exits: (code: number | null, signal: string | null = null, error?: string) => {
      push(undefined);
      exit({ code, signal, ...(error === undefined ? {} : { error }) });
    },
    writes: (text: string) => {
      stderr = text;
    },
    get ended() {
      return ended;
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function until(what: string, test: () => boolean): Promise<void> {
  for (let tries = 0; tries < 500; tries += 1) {
    if (test()) {
      return;
    }
    await tick();
  }
  throw new Error(`never: ${what}`);
}

const DESK = "/home/mira/desk";
const THREAD = "0199c4d8-0000-7000-8000-0000000000c1";
const TURN = "0199c4d8-0000-7000-8000-0000000000d1";
const NEXT_TURN = "0199c4d8-0000-7000-8000-0000000000d2";

/** What the product answers when it is told who speaks to it. */
const INITIALIZED = {
  userAgent: "skillcdn-console-runner/0.172.0 (Linux 6.8; x86_64) unknown",
  codexHome: "/home/mira/.codex",
  platformFamily: "unix",
  platformOs: "linux",
};
/** What it answers when a thread is begun or gone on with: the thread, and what it runs with. */
const opened = (over: Json = {}): Json => ({
  thread: {
    id: THREAD,
    sessionId: THREAD,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    status: { type: "idle" },
    cwd: DESK,
    cliVersion: "0.172.0",
    source: "vscode",
    turns: [],
  },
  model: "gpt-6-sol",
  modelProvider: "openai",
  cwd: DESK,
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
  sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
  reasoningEffort: null,
  ...over,
});
const turnOf = (id: string, status = "inProgress", error: Json | null = null): Json => ({
  id,
  rootTurnId: id,
  items: [],
  itemsView: "notLoaded",
  status,
  error,
  startedAt: 1795496007,
  completedAt: status === "inProgress" ? null : 1795496022,
  durationMs: status === "inProgress" ? null : 15556,
});
const turnStarted = (id: string): Json => ({
  method: "turn/started",
  params: { threadId: THREAD, turn: turnOf(id) },
  emittedAtMs: 1795496007269,
});
const turnCompleted = (id: string, status = "completed", error: Json | null = null): Json => ({
  method: "turn/completed",
  params: { threadId: THREAD, turn: turnOf(id, status, error) },
  emittedAtMs: 1795496022785,
});
const itemOf = (method: "item/started" | "item/completed", item: Json, turn = TURN): Json => ({
  method,
  params: { item, threadId: THREAD, turnId: turn },
});
/** A message said back, as the product says one when it reads it: under the id it was handed over with. */
const saidBack = (clientId: string, text: string, turn = TURN): Json[] => {
  const item = {
    type: "userMessage",
    id: `item-${clientId}`,
    clientId,
    content: [{ type: "text", text, text_elements: [] }],
  };
  return [itemOf("item/started", item, turn), itemOf("item/completed", item, turn)];
};
const answer = (id: string, text: string): Json =>
  itemOf("item/completed", { type: "agentMessage", id, text, phase: null });

const message = (text: string, priority: "now" | "next" = "next"): DriverMessage => ({
  text,
  images: [],
  priority,
});
const textOf = (text: string): Json => ({ type: "text", text, text_elements: [] });

/** The settings a thread is begun with where the desk names no mode: the product's own reviewer answers. */
const REVIEWED = {
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
};

function started(over: Partial<StartOptions> = {}) {
  const processes: ReturnType<typeof fakeChild>[] = [];
  let ids = 0;
  const driver = createCodexDriver({
    spawn: (_command, args, options) => {
      const fake = fakeChild(args, options);
      processes.push(fake);
      return fake.child;
    },
    cwd: DESK,
    version: "0.6.4",
    // The ids a message is handed over under, in order: m-1, m-2 and so on.
    uuid: () => {
      ids += 1;
      return `m-${ids}`;
    },
  });
  const session = driver.start({
    cwd: DESK,
    env: { GIT_TOKEN: "not-a-real-token" },
    model: null,
    effort: null,
    resume: undefined,
    ...over,
  });
  const product = processes[0];
  if (product === undefined) {
    throw new Error("the product was not started");
  }
  const events: DriverEvent[] = [];
  /** How many messages the product was said to have taken: told apart from the blocks, which the tests read in order. */
  const taken = { count: 0 };
  const read = (async () => {
    for await (const event of session.events) {
      if (event.type === "taken") {
        taken.count += 1;
      } else {
        events.push(event);
      }
    }
  })();
  /** Everything the product was written, a message a line. */
  const sent = (): Json[] => product.sent.map((line) => JSON.parse(line) as Json);
  const answered = new Set<unknown>();
  /** The oldest request of a method that the test has not answered yet, once the driver made it. */
  const request = async (method: string): Promise<{ id: unknown; params: Json }> => {
    const found: { one?: Json } = {};
    await until(`a request of ${method}, of ${product.sent.join(" ")}`, () => {
      found.one = sent().find(
        (one) => one.method === method && one.id !== undefined && !answered.has(one.id),
      );
      return found.one !== undefined;
    });
    answered.add(found.one?.id);
    return { id: found.one?.id, params: (found.one?.params ?? {}) as Json };
  };
  /** Answers the oldest unanswered request of a method; what it was asked with. */
  const answers = async (method: string, result: Json): Promise<Json> => {
    const asked = await request(method);
    product.says({ id: asked.id, result });
    return asked.params;
  };
  const refuses = async (method: string, text: string, code = -32600): Promise<Json> => {
    const asked = await request(method);
    product.says({ id: asked.id, error: { code, message: text } });
    return asked.params;
  };
  /** What the session said once it said so many things. */
  const said = async (count: number) => {
    await until(`${count} events, of ${JSON.stringify(events)}`, () => events.length >= count);
    await tick();
    return events;
  };
  /** The conversation opens: the product says what it is, and begins a thread. What the thread was begun with. */
  const opens = async (thread: Json = opened()): Promise<Json> => {
    await answers("initialize", INITIALIZED);
    const settings = await answers("thread/start", thread);
    await said(3);
    return settings;
  };
  /** How many of a method the product was written. */
  const count = (method: string): number => sent().filter((one) => one.method === method).length;
  return {
    driver,
    session,
    processes,
    product,
    events,
    said,
    read,
    taken,
    sent,
    request,
    answers,
    refuses,
    opens,
    count,
  };
}

/** The blocks of a session as a test reads them: a kind with the beginning of its text and its facts, or what the driver said. */
const shapes = (events: readonly DriverEvent[]) =>
  events.map((event) =>
    event.type === "event" ? [event.kind, event.text.slice(0, 60), event.data] : event.type,
  );

describe("the codex driver", () => {
  it("is the package's driver for Codex, beside the one for Claude Code", () => {
    const modules = ownRunnerModules({ user: "mira" });
    expect(modules.drivers.names()).toEqual(["acp", "claude", "codex"]);
    const { driver } = started();
    expect(driver.name).toBe("codex");
    // The build a turn of a signed-in product ran through the driver with is listed as tried.
    expect(driver.product).toEqual({ name: "Codex", tried: ["0.171.0-alpha.13.2"] });
    // A message is put into the turn under way; a picture is taken as a file, by its path in
    // the desk; the model is said with a turn. A message it says taken is one the product
    // said back out of the conversation, or began a turn with: it stands there (ADR-0166).
    expect(driver.can).toEqual({
      steer: true,
      images: true,
      imageFiles: true,
      resume: true,
      set: true,
      holdsTaken: true,
    });
    expect(driver.permissions).toEqual({
      modes: ["read-only", "workspace-write", "approve-for-me", "danger-full-access"],
      unattended: "approve-for-me",
      least: "read-only",
    });
  });

  it("starts the unmodified binary as its app server, once for a session, and begins a thread in the desk", async () => {
    const { product, sent, answers, opens, said, processes, session } = started({
      model: "gpt-6-luna",
      effort: "low",
    });
    expect(product.args).toEqual(["app-server"]);
    expect(product.options).toEqual({ cwd: DESK, env: { GIT_TOKEN: "not-a-real-token" } });
    const settings = await opens(opened({ model: "gpt-6-luna" }));
    // The product leaves the protocol's version out on the wire, and is written to without.
    expect(sent().every((one) => one.jsonrpc === undefined)).toBe(true);
    expect(sent()[0]).toEqual({
      id: 0,
      method: "initialize",
      params: {
        clientInfo: {
          name: "skillcdn-console-runner",
          title: "SkillCDN Console runner",
          version: "0.6.4",
        },
        // Nothing that is still an experiment, and no block a piece at a time.
        capabilities: {
          experimentalApi: false,
          optOutNotificationMethods: expect.arrayContaining([
            "item/agentMessage/delta",
            "item/commandExecution/outputDelta",
          ]),
        },
      },
    });
    expect(sent()[1]).toEqual({ method: "initialized" });
    // The mode where the desk names none, and the model the account's settings name; the
    // effort is said with a turn.
    expect(settings).toEqual({ cwd: DESK, ...REVIEWED, model: "gpt-6-luna" });
    expect(await said(3)).toEqual([
      { type: "conversation", id: THREAD },
      // What the product says it runs with, and its own version.
      { type: "running", model: "gpt-6-luna", effort: null, version: "0.172.0" },
      {
        type: "event",
        kind: "status",
        text: "The product started.",
        data: { model: "gpt-6-luna", effort: null, version: "0.172.0", mode: "approve-for-me" },
      },
    ]);

    // One process for the session, whatever it is sent: a turn starts no other.
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    expect(processes).toHaveLength(1);
  });

  it("says the mode the desk names in the product's own words, whole, and never reads another word as leave to do more", async () => {
    // The product answers the sandbox it was asked for, in its own word for it in an answer.
    const settingsOf = async (permissions: string | undefined, sandbox = "workspaceWrite") =>
      started({ permissions }).opens(opened({ sandbox: { type: sandbox } }));
    const unattended = { approvalPolicy: "never", approvalsReviewer: "user" };
    expect(await settingsOf(undefined)).toEqual({ cwd: DESK, ...REVIEWED });
    expect(await settingsOf("approve-for-me")).toEqual({ cwd: DESK, ...REVIEWED });
    // Whatever a sandbox does not allow is asked of nobody.
    expect(await settingsOf("read-only", "readOnly")).toEqual({
      cwd: DESK,
      sandbox: "read-only",
      ...unattended,
    });
    expect(await settingsOf("workspace-write")).toEqual({
      cwd: DESK,
      sandbox: "workspace-write",
      ...unattended,
    });
    expect(await settingsOf("danger-full-access", "dangerFullAccess")).toEqual({
      cwd: DESK,
      sandbox: "danger-full-access",
      ...unattended,
    });
    // A mode that is none of the product's is the one that allows the least.
    const least = await settingsOf("read-only", "readOnly");
    expect(await settingsOf("everything", "readOnly")).toEqual(least);
    expect(await settingsOf("Danger-Full-Access", "readOnly")).toEqual(least);
    // What is no word for a model is left out, and so is one for an effort, said with a turn.
    const odd = started({ model: "gpt 6\n--dangerous", effort: 'high", "sandbox": "x' });
    expect(await odd.opens()).toEqual({ cwd: DESK, ...REVIEWED });
    await odd.session.send(message("Go."));
    expect(await odd.answers("turn/start", { turn: turnOf(TURN) })).toEqual({
      threadId: THREAD,
      clientUserMessageId: "m-1",
      input: [textOf("Go.")],
    });
  });

  it("goes on with the conversation a session before left, where it names one", async () => {
    const { answers, said, count } = started({ resume: THREAD, permissions: "workspace-write" });
    await answers("initialize", INITIALIZED);
    // Gone on with in the mode the desk names now, and without its history said again.
    expect(await answers("thread/resume", opened({ reasoningEffort: "high" }))).toEqual({
      threadId: THREAD,
      cwd: DESK,
      sandbox: "workspace-write",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      excludeTurns: true,
    });
    expect((await said(3)).slice(0, 2)).toEqual([
      { type: "conversation", id: THREAD },
      // A thread keeps what it last ran with, and says so.
      { type: "running", model: "gpt-6-sol", effort: "high", version: "0.172.0" },
    ]);
    expect(count("thread/start")).toBe(0);

    // An id that is no word is no conversation to go on with.
    const odd = started({ resume: "../another thread" });
    await odd.opens();
    expect(odd.count("thread/resume")).toBe(0);
  });

  it("asks a build that takes no word against the history again without it (seen with 0.139.0)", async () => {
    const { answers, refuses, said } = started({ resume: THREAD });
    await answers("initialize", INITIALIZED);
    await refuses(
      "thread/resume",
      "thread/resume.excludeTurns requires experimentalApi capability",
    );
    expect(await answers("thread/resume", opened())).toEqual({
      threadId: THREAD,
      cwd: DESK,
      ...REVIEWED,
    });
    // Gone on with: said as it is, with no word of a conversation begun.
    expect((await said(3)).at(0)).toEqual({ type: "conversation", id: THREAD });
  });

  it("begins a new conversation where the product has the one it had no more, and says so", async () => {
    const another = "0199c4d8-0000-7000-8000-0000000000c2";
    const { answers, refuses, said } = started({ resume: THREAD });
    await answers("initialize", INITIALIZED);
    // As the binary answered for a thread it does not keep (0.172.0).
    await refuses("thread/resume", `no rollout found for thread id ${THREAD}`);
    await answers("thread/start", opened({ thread: { id: another, cliVersion: "0.172.0" } }));
    expect(shapes(await said(4)).slice(0, 2)).toEqual([
      ["status", "The product could not go on with the conversation it had (no", undefined],
      "conversation",
    ]);
    // Said as one begun anew: the runner counts nothing from before it as held (ADR-0166).
    expect((await said(4)).at(1)).toEqual({ type: "conversation", id: another, anew: true });
  });

  it("starts a turn with a message, and says it taken when the product says it back", async () => {
    const { session, product, opens, answers, said, taken } = started({
      model: "gpt-6-luna",
      effort: "low",
    });
    await opens(opened({ model: "gpt-6-luna" }));
    const told = "[console k3f9a2 #1 · tell · Jane · 14:02]\nSay hello.";
    await session.send(message(told));
    expect(await answers("turn/start", { turn: turnOf(TURN) })).toEqual({
      threadId: THREAD,
      clientUserMessageId: "m-1",
      input: [textOf(told)],
      model: "gpt-6-luna",
      effort: "low",
    });
    // The effort the account's settings name is said with the turn, and the session says so.
    expect((await said(4)).at(3)).toEqual({
      type: "running",
      model: "gpt-6-luna",
      effort: "low",
      version: "0.172.0",
    });
    // Handed over, and not taken until the product says so.
    product.says(turnStarted(TURN));
    await tick();
    expect(taken.count).toBe(0);
    product.says(...saidBack("m-1", told));
    await until("the message to be taken", () => taken.count === 1);
    product.says(answer("item-1", "Hello."), turnCompleted(TURN));
    expect((await said(6)).slice(4)).toEqual([
      { type: "event", kind: "assistant", text: "Hello." },
      { type: "turn_completed" },
    ]);
    // Said back at its beginning and at its end: taken once.
    expect(taken.count).toBe(1);
  });

  it("hands a message its pictures as files of the desk, by the paths the runner wrote them at", async () => {
    const picture = (path: string | undefined) => ({
      name: "screen.png",
      contentType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
      path,
    });
    const { session, product, opens, answers } = started({ cwd: `${DESK}/` });
    await opens();
    await session.send({
      text: "Look at these.",
      images: [
        picture("work/inbox/8812/screen.png"),
        picture("work/inbox/8812/second shot.png"),
        // A picture a tool returned has no path, and what is no file the runner wrote is none
        // the product is handed: another file of the machine, or a folder's own name.
        picture(undefined),
        picture("/etc/passwd"),
        picture("work/inbox/8812/../../../secret.png"),
        picture("work/inbox/8812/.."),
        picture("work/inbox/0/zero.png"),
        picture("--dangerously-bypass-approvals-and-sandbox"),
      ],
      priority: "next",
    });
    expect((await answers("turn/start", { turn: turnOf(TURN) })).input).toEqual([
      textOf("Look at these."),
      { type: "localImage", path: `${DESK}/work/inbox/8812/screen.png` },
      { type: "localImage", path: `${DESK}/work/inbox/8812/second shot.png` },
    ]);
    // One put into the turn under way carries its pictures the same way.
    product.says(turnStarted(TURN));
    await session.send({
      text: "And this.",
      images: [picture("work/inbox/8813/third.png")],
      priority: "next",
    });
    expect((await answers("turn/steer", { turnId: TURN })).input).toEqual([
      textOf("And this."),
      { type: "localImage", path: `${DESK}/work/inbox/8813/third.png` },
    ]);
  });

  it("reads what the product does as whole blocks, a message each, until the turn completes", async () => {
    const { session, product, opens, answers, said } = started();
    await opens();
    await session.send(message("Cut the release."));
    await answers("turn/start", { turn: turnOf(TURN) });
    const command = {
      type: "commandExecution",
      id: "call_1",
      command: "/bin/bash -lc 'cat notes.txt'",
      cwd: DESK,
      status: "inProgress",
      aggregatedOutput: null,
      exitCode: null,
    };
    const change = {
      type: "fileChange",
      id: "call_2",
      changes: [
        { path: `${DESK}/a.txt`, kind: { type: "add" }, diff: "+a\n" },
        { path: `${DESK}/notes.txt`, kind: { type: "update", move_path: null }, diff: "@@\n" },
      ],
      status: "inProgress",
    };
    product.says(
      turnStarted(TURN),
      ...saidBack("m-1", "Cut the release."),
      // A block as it begins says nothing: its end is the block.
      itemOf("item/started", { type: "agentMessage", id: "item_0", text: "" }),
      answer("item_0", "I will check the notes, then patch them."),
      itemOf("item/completed", {
        type: "reasoning",
        id: "item_r",
        summary: ["The notes are short."],
        content: [],
      }),
      itemOf("item/started", command),
      itemOf("item/completed", {
        ...command,
        status: "completed",
        aggregatedOutput: "hello\n",
        exitCode: 0,
      }),
      itemOf("item/started", change),
      itemOf("item/completed", { ...change, status: "completed" }),
      itemOf("item/started", { ...command, id: "call_3", command: "false" }),
      itemOf("item/completed", {
        ...command,
        id: "call_3",
        command: "false",
        status: "failed",
        aggregatedOutput: "",
        exitCode: 1,
      }),
      // A call its sandbox or its reviewer did not let run.
      itemOf("item/completed", {
        ...command,
        id: "call_4",
        command: "rm -rf /",
        status: "declined",
      }),
      itemOf("item/completed", {
        type: "mcpToolCall",
        id: "call_5",
        server: "board",
        tool: "search",
        status: "completed",
        arguments: { query: "release" },
        result: { content: [{ type: "text", text: "Two tasks." }], structuredContent: null },
        error: null,
      }),
      itemOf("item/completed", {
        type: "mcpToolCall",
        id: "call_6",
        server: "board",
        tool: "write",
        status: "failed",
        arguments: {},
        result: null,
        error: { message: "not allowed" },
      }),
      itemOf("item/completed", { type: "webSearch", id: "call_7", query: "release notes" }),
      answer("item_9", "Done."),
      turnCompleted(TURN),
    );
    expect(shapes((await said(20)).slice(3))).toEqual([
      ["assistant", "I will check the notes, then patch them.", undefined],
      ["thinking", "The notes are short.", undefined],
      ["tool_call", "/bin/bash -lc 'cat notes.txt'", { tool: "command_execution", id: "call_1" }],
      ["tool_result", "hello\n", { id: "call_1", error: false, exit: 0 }],
      [
        "tool_call",
        `add ${DESK}/a.txt\nupdate ${DESK}/notes.txt`,
        { tool: "file_change", id: "call_2" },
      ],
      ["tool_result", "", { id: "call_2", error: false }],
      ["tool_call", "false", { tool: "command_execution", id: "call_3" }],
      ["tool_result", "", { id: "call_3", error: true, exit: 1 }],
      // A call the product wrote no beginning of is said with its end.
      ["tool_call", "rm -rf /", { tool: "command_execution", id: "call_4" }],
      ["tool_result", "", { id: "call_4", error: true }],
      ["tool_call", '{"query":"release"}', { tool: "board.search", id: "call_5" }],
      [
        "tool_result",
        '{"content":[{"type":"text","text":"Two tasks."}],"structured',
        { id: "call_5", error: false },
      ],
      ["tool_call", "{}", { tool: "board.write", id: "call_6" }],
      ["tool_result", "not allowed", { id: "call_6", error: true }],
      ["tool_call", "release notes", { tool: "web_search", id: "call_7" }],
      ["assistant", "Done.", undefined],
      "turn_completed",
    ]);
  });

  it("reads what the product writes as data, whatever it is, and runs none of it", async () => {
    const { session, product, opens, answers, said, taken } = started();
    await opens();
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    const elsewhere = "0199c4d8-0000-7000-8000-0000000000ff";
    product.says(
      "",
      "not json at all",
      "[1,2,3]",
      '{"method":42}',
      '{"no":"method"}',
      // An answer to nothing that was asked.
      { id: 999, result: { turn: turnOf(NEXT_TURN) } },
      { method: "item/completed" },
      { method: "item/completed", params: "a string" },
      { method: "item/completed", params: { threadId: THREAD } },
      { method: "item/completed", params: { threadId: THREAD, item: "a string" } },
      { method: "item/completed", params: { threadId: THREAD, item: { type: "agentMessage" } } },
      itemOf("item/completed", { type: "agentMessage", id: "a", text: 42 }),
      itemOf("item/completed", { type: "reasoning", id: "r", summary: "none", content: [7, null] }),
      itemOf("item/completed", { type: "somethingNew", id: "n", text: "ignored" }),
      itemOf("item/completed", { type: "__proto__", id: "p", text: "ignored" }),
      { method: "something/else", params: { threadId: THREAD, text: "ignored" } },
      { method: "turn/started", params: { threadId: THREAD } },
      // A message said back that is none the driver handed over.
      ...saidBack("someone-else", "Not mine."),
      itemOf("item/completed", { type: "userMessage", id: "u", clientId: { $ne: null } }),
      // Another thread of the product's, an agent's it started say: its blocks are not this
      // session's, and its turn's end is not this turn's.
      {
        method: "item/completed",
        params: {
          threadId: elsewhere,
          turnId: TURN,
          item: { type: "agentMessage", id: "x", text: "Said elsewhere." },
        },
      },
      {
        method: "turn/completed",
        params: { threadId: elsewhere, turn: turnOf(TURN, "completed") },
      },
      { method: "turn/completed", params: { turn: turnOf(TURN, "completed") } },
      // The end of a turn that is not the one under way.
      turnCompleted(NEXT_TURN),
      // A tool's input shown bounded, and markup kept as the text it is.
      itemOf("item/completed", {
        type: "commandExecution",
        command: "x".repeat(9000),
        exitCode: 0,
      }),
      answer("item_1", "<img src=x onerror=alert(1)>"),
    );
    const events = (await said(6)).slice(3);
    expect(shapes(events)).toEqual([
      ["tool_call", "x".repeat(60), { tool: "command_execution", id: null }],
      ["tool_result", "", { id: null, error: false, exit: 0 }],
      ["assistant", "<img src=x onerror=alert(1)>", undefined],
    ]);
    const long = events.find((event) => event.type === "event" && event.text.startsWith("xxx"));
    expect((long as { text: string }).text.length).toBeLessThan(4100);
    // Nothing of it took the message, and nothing of it ended the turn.
    expect(taken.count).toBe(0);
    product.says(turnCompleted(TURN));
    expect((await said(7)).at(6)).toEqual({ type: "turn_completed" });
    // A turn began with its message, which is the product's from then on.
    expect(taken.count).toBe(1);
  });

  it("cuts what it shows of a call with what it was handed to cut with, and never by itself first", async () => {
    // What the runner hands a session takes the account's secrets out before it cuts: the
    // driver hands it a command, a tool's arguments and what a tool answered whole.
    const asked: { length: number; most: number }[] = [];
    const { session, product, opens, answers, said } = started({
      cut: (text, most) => {
        asked.push({ length: text.length, most });
        return text.length > most ? `[cut to ${most} of ${text.length}]` : text;
      },
    });
    await opens();
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(
      itemOf("item/completed", {
        type: "commandExecution",
        command: "x".repeat(1_000_000),
        exitCode: 0,
      }),
      itemOf("item/completed", {
        type: "mcpToolCall",
        id: "m1",
        server: "board",
        tool: "search",
        arguments: { query: "q".repeat(9000) },
        result: { content: [{ type: "text", text: "r".repeat(9000) }] },
        status: "completed",
      }),
      turnCompleted(TURN),
    );
    const events = await said(8);
    const texts = events.flatMap((event) => (event.type === "event" ? [event.text] : []));
    expect(texts).toContain("[cut to 4000 of 1000000]");
    expect(texts.filter((text) => text.startsWith("[cut to 4000 of 90"))).toHaveLength(2);
    expect(asked.every((one) => one.most === 4000)).toBe(true);
    expect(asked.map((one) => one.length)).toContain(1_000_000);
  });

  it("puts a message that arrives while a turn runs into that turn, and says it taken when the product reads it", async () => {
    const { session, product, opens, answers, said, taken, count } = started();
    await opens();
    await session.send(message("Run the tests."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(
      turnStarted(TURN),
      ...saidBack("m-1", "Run the tests."),
      itemOf("item/started", { type: "commandExecution", id: "call_1", command: "pnpm test" }),
    );
    await until("the first message to be taken", () => taken.count === 1);

    // While the command runs, a supervisor says something, and then something more.
    await session.send(message("Skip the slow ones."));
    await session.send(message("And say how long it took."));
    const steered = await answers("turn/steer", { turnId: TURN });
    // Into the turn the driver knows to be under way, under an id the product says back.
    expect(steered).toEqual({
      threadId: THREAD,
      expectedTurnId: TURN,
      clientUserMessageId: "m-2",
      input: [textOf("Skip the slow ones.")],
    });
    // One at a time, in the order they arrived: the second follows the first one's answer.
    expect((await answers("turn/steer", { turnId: TURN })).clientUserMessageId).toBe("m-3");
    // Put in is not read: the product reads them when the command is done, and says so.
    await tick();
    expect(taken.count).toBe(1);
    product.says(
      itemOf("item/completed", {
        type: "commandExecution",
        id: "call_1",
        command: "pnpm test",
        aggregatedOutput: "ok\n",
        exitCode: 0,
        status: "completed",
      }),
      ...saidBack("m-2", "Skip the slow ones."),
    );
    await until("the second message to be taken", () => taken.count === 2);
    product.says(...saidBack("m-3", "And say how long it took."));
    await until("the third message to be taken", () => taken.count === 3);
    product.says(answer("item_2", "Skipped them: four seconds."), turnCompleted(TURN));
    expect(shapes((await said(7)).slice(3))).toEqual([
      ["tool_call", "pnpm test", { tool: "command_execution", id: "call_1" }],
      ["tool_result", "ok\n", { id: "call_1", error: false, exit: 0 }],
      ["assistant", "Skipped them: four seconds.", undefined],
      // One turn took all three: the agent is done once, when nothing waits.
      "turn_completed",
    ]);
    expect(count("turn/start")).toBe(1);
    expect(count("turn/interrupt")).toBe(0);
  });

  it("keeps a message the product took into no turn for the turn after, first of what waits", async () => {
    const { session, product, opens, answers, refuses, said, taken, count } = started();
    await opens();
    await session.send(message("Run the tests."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(turnStarted(TURN), ...saidBack("m-1", "Run the tests."));
    await until("the first message to be taken", () => taken.count === 1);

    // The turn was over when the message arrived, as the binary answers then (0.172.0).
    await session.send(message("One more thing."));
    await refuses("turn/steer", "no active turn to steer");
    // Nothing more is put into a turn that took none: what arrives waits for its end.
    await session.send(message("And another."));
    await tick();
    await tick();
    expect(count("turn/steer")).toBe(1);
    expect(count("turn/start")).toBe(1);
    product.says(turnCompleted(TURN));
    // Read together, in the order they arrived; the agent is not done while they wait.
    expect(await answers("turn/start", { turn: turnOf(NEXT_TURN) })).toEqual({
      threadId: THREAD,
      clientUserMessageId: "m-3",
      input: [textOf("One more thing.\n\nAnd another.")],
    });
    expect(await said(3)).toHaveLength(3);
    product.says(
      turnStarted(NEXT_TURN),
      ...saidBack("m-3", "One more thing.\n\nAnd another.", NEXT_TURN),
      turnCompleted(NEXT_TURN),
    );
    expect((await said(4)).at(3)).toEqual({ type: "turn_completed" });
    expect(taken.count).toBe(3);
  });

  it("sends again a message that was put into a turn and never read, where the turn was stopped first (seen with 0.139.0)", async () => {
    const { session, product, opens, answers, request, said, taken } = started();
    await opens();
    await session.send(message("Run the tests."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(turnStarted(TURN), ...saidBack("m-1", "Run the tests."));
    await until("the first message to be taken", () => taken.count === 1);

    // Put in, as the product answers, and not read yet: the step under way goes on.
    await session.send(message("Skip the slow ones."));
    await answers("turn/steer", { turnId: TURN });
    // A message that is to be read now stops the turn: the product lets go of what it had
    // not read, and says so in no word.
    await session.send(message("Stop, and read this.", "now"));
    expect((await request("turn/interrupt")).params).toEqual({ threadId: THREAD, turnId: TURN });
    product.says(turnCompleted(TURN, "interrupted"));
    expect((await said(4)).at(3)).toEqual({
      type: "event",
      kind: "status",
      text: "The turn was stopped for a message.",
    });
    // The one that was never read goes first, and the one the turn was stopped for after it.
    expect(await answers("turn/start", { turn: turnOf(NEXT_TURN) })).toEqual({
      threadId: THREAD,
      clientUserMessageId: "m-3",
      input: [textOf("Skip the slow ones.\n\nStop, and read this.")],
    });
    // Neither was taken before the product said so.
    expect(taken.count).toBe(1);
    product.says(
      ...saidBack("m-3", "Skip the slow ones.\n\nStop, and read this.", NEXT_TURN),
      turnCompleted(NEXT_TURN),
    );
    expect((await said(5)).at(4)).toEqual({ type: "turn_completed" });
    expect(taken.count).toBe(3);
  });

  it("puts a message that arrives as a turn is being started into it once the product named the turn", async () => {
    const { session, product, opens, answers, said, taken, count } = started();
    await opens();
    await session.send(message("Run the tests."));
    await session.send(message("Also the linter."));
    await tick();
    await tick();
    // One request at a time, in order: the second waits for the first one's answer.
    expect(count("turn/start")).toBe(1);
    expect(count("turn/steer")).toBe(0);
    expect((await answers("turn/start", { turn: turnOf(TURN) })).input).toEqual([
      textOf("Run the tests."),
    ]);
    expect(await answers("turn/steer", { turnId: TURN })).toEqual({
      threadId: THREAD,
      expectedTurnId: TURN,
      clientUserMessageId: "m-2",
      input: [textOf("Also the linter.")],
    });
    product.says(
      ...saidBack("m-1", "Run the tests."),
      ...saidBack("m-2", "Also the linter."),
      turnCompleted(TURN),
    );
    expect((await said(4)).at(3)).toEqual({ type: "turn_completed" });
    expect(taken.count).toBe(2);
  });

  it("puts a message into a turn the product began by itself, and says the agent done at its end", async () => {
    const { session, product, opens, answers, said, taken, count } = started();
    await opens();
    product.says(turnStarted(TURN), answer("item_0", "Going on with what I was asked to finish."));
    await said(4);
    await session.send(message("Hold the release."));
    expect((await answers("turn/steer", { turnId: TURN })).expectedTurnId).toBe(TURN);
    expect(count("turn/start")).toBe(0);
    product.says(...saidBack("m-1", "Hold the release."), turnCompleted(TURN));
    expect((await said(5)).at(4)).toEqual({ type: "turn_completed" });
    expect(taken.count).toBe(1);
  });

  it("stops the turn under way for an interrupt, once the product named it, and nothing where none is under way", async () => {
    const { session, product, opens, answers, request, said, taken, count } = started();
    await opens();
    await session.send(message("Run the tests."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(turnStarted(TURN));
    await session.interrupt();
    expect((await request("turn/interrupt")).params).toEqual({ threadId: THREAD, turnId: TURN });
    // Asked once, however often it is said.
    await session.interrupt();
    await tick();
    expect(count("turn/interrupt")).toBe(1);
    // The product answers when the turn is over, and says so by itself (as seen, 0.172.0).
    product.says(turnCompleted(TURN, "interrupted"));
    expect((await said(5)).slice(3)).toEqual([
      { type: "event", kind: "status", text: "The turn was stopped." },
      { type: "turn_completed" },
    ]);
    // The turn began with its message, which was the product's from then on.
    expect(taken.count).toBe(1);

    // With nothing under way an interrupt stops nothing.
    await session.interrupt();
    await tick();
    expect(count("turn/interrupt")).toBe(1);

    // One that is asked before the product named the turn is said once it did.
    await session.send(message("Run them again."));
    await session.interrupt();
    await tick();
    expect(count("turn/interrupt")).toBe(1);
    await answers("turn/start", { turn: turnOf(NEXT_TURN) });
    expect((await request("turn/interrupt")).params).toEqual({
      threadId: THREAD,
      turnId: NEXT_TURN,
    });
    // A turn that completed all the same was not stopped, and is not said to have been.
    product.says(turnCompleted(NEXT_TURN));
    expect((await said(6)).at(5)).toEqual({ type: "turn_completed" });
  });

  it("says a product that is not there to start, and one whose build has no app server", async () => {
    const gone = started();
    gone.product.exits(null, null, "spawn codex ENOENT");
    await gone.read;
    expect(gone.events).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product could not be started: its command codex was not found where the runner looks for programs. Install it, or put its folder on the PATH the runner is started with.",
      },
      // Nothing was taken: the runner sends again what it sent.
      { type: "cannot_go_on", state: "failed", reason: "start" },
      { type: "ended", how: "crashed" },
    ]);

    const old = started();
    old.product.writes("error: unrecognized subcommand 'app-server'\n");
    old.product.exits(2);
    await old.read;
    expect(old.events).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product's process ended with code 2 before it answered as its app server, which this driver speaks to (codex app-server).\nerror: unrecognized subcommand 'app-server'",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
      { type: "ended", how: "crashed" },
    ]);
  });

  it("says a process that fell over, with the end of what it wrote on its standard error kept as it was handed to keep it", async () => {
    // What the process kept the end of begins with the mark of a cut: the runner is told so,
    // and shows nothing of a secret its beginning may end.
    const asked: { length: number; most: number; more: boolean | undefined }[] = [];
    const { session, product, opens, answers, read, events } = started({
      cutEnd: (text, most, more) => {
        asked.push({ length: text.length, most, more });
        return `[the end, ${most} at most]`;
      },
    });
    await opens();
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.writes(`${String.fromCodePoint(0x2026)}${"e".repeat(16_000)}\n`);
    product.exits(null, "SIGKILL");
    await read;
    expect(events.slice(3)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product's process ended on SIGKILL.\n[the end, 4000 at most]",
      },
      // What the turn was at is not known: nothing is sent again.
      { type: "cannot_go_on", state: "failed", reason: "crashed" },
      { type: "ended", how: "crashed" },
    ]);
    expect(asked).toEqual([{ length: 16_000, most: 4000, more: true }]);
    // A process that is gone takes nothing: the runner keeps what it would have handed over.
    await expect(session.send(message("More."))).rejects.toThrow("takes no more input");
  });

  it("says a product that is not signed in, as the binary said it signed out, and takes the next message after", async () => {
    // What the binary wrote when it was spoken to signed out (0.172.0), each cut down: the
    // tries it makes again, then the turn failed with the status the service answered.
    const refused =
      "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header";
    const failed = {
      message: refused,
      codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } },
      additionalDetails: null,
    };
    const { session, product, opens, answers, said, taken } = started();
    await opens();
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(
      turnStarted(TURN),
      ...saidBack("m-1", "Go."),
      {
        method: "error",
        params: {
          error: {
            message: "Reconnecting... 2/5",
            codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
            additionalDetails: refused,
          },
          willRetry: true,
          threadId: THREAD,
          turnId: TURN,
        },
      },
      {
        method: "warning",
        params: { threadId: THREAD, message: "Falling back from WebSockets to HTTPS transport." },
      },
      {
        method: "error",
        params: { error: failed, willRetry: false, threadId: THREAD, turnId: TURN },
      },
      turnCompleted(TURN, "failed", failed),
    );
    expect((await said(6)).slice(3)).toEqual([
      { type: "event", kind: "error", text: `Reconnecting... 2/5\n${refused}` },
      // What failed the turn is written twice, and said once.
      { type: "event", kind: "error", text: refused },
      { type: "cannot_go_on", state: "failed", reason: "sign_in" },
    ]);
    expect(taken.count).toBe(1);

    // The process is still there: what a supervisor says next is tried in the same session.
    await session.send(message("Try again."));
    expect((await answers("turn/start", { turn: turnOf(NEXT_TURN) })).input).toEqual([
      textOf("Try again."),
    ]);
    product.says(...saidBack("m-2", "Try again.", NEXT_TURN), turnCompleted(NEXT_TURN));
    expect((await said(7)).at(6)).toEqual({ type: "turn_completed" });

    // The product's own word for it, and its words, are read the same.
    for (const error of [
      { message: "Your session ended.", codexErrorInfo: "unauthorized" },
      { message: "Not logged in. Run codex login.", codexErrorInfo: "other" },
    ]) {
      const other = started();
      await other.opens();
      await other.session.send(message("Go."));
      await other.answers("turn/start", { turn: turnOf(TURN) });
      other.product.says(turnCompleted(TURN, "failed", error));
      expect((await other.said(5)).at(4)).toEqual({
        type: "cannot_go_on",
        state: "failed",
        reason: "sign_in",
      });
    }
  });

  it("takes a turn the product itself says failed as a turn that ended", async () => {
    const { session, product, opens, answers, said } = started();
    await opens();
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    // The words of the service it asked, a line of JSON inside its line, are read out of it.
    const failed = {
      message: JSON.stringify({ error: { message: "The model is overloaded.", code: 529 } }),
      codexErrorInfo: "serverOverloaded",
      additionalDetails: null,
    };
    product.says(
      {
        method: "error",
        params: { error: failed, willRetry: false, threadId: THREAD, turnId: TURN },
      },
      turnCompleted(TURN, "failed", failed),
    );
    expect((await said(5)).slice(3)).toEqual([
      { type: "event", kind: "error", text: "The model is overloaded." },
      { type: "turn_completed" },
    ]);

    // One that says nothing of why is said all the same.
    await session.send(message("Again."));
    await answers("turn/start", { turn: turnOf(NEXT_TURN) });
    product.says(turnCompleted(NEXT_TURN, "failed"));
    expect((await said(7)).slice(5)).toEqual([
      { type: "event", kind: "error", text: "The turn ended with an error." },
      { type: "turn_completed" },
    ]);
  });

  it("says a turn the product refuses to start, and goes on with what waits", async () => {
    const { session, opens, answers, refuses, said, taken } = started();
    await opens();
    await session.send(message("x".repeat(40)));
    await session.send(message("And this."));
    await refuses("turn/start", "Input exceeds the maximum length of 1048576 characters.", -32602);
    expect((await said(4)).at(3)).toEqual({
      type: "event",
      kind: "error",
      text: "The product refused the turn: Input exceeds the maximum length of 1048576 characters.",
    });
    // A turn that ended: the message is not sent again, and the next one is the next turn's.
    expect((await answers("turn/start", { turn: turnOf(TURN) })).input).toEqual([
      textOf("And this."),
    ]);
    expect(taken.count).toBe(1);

    // Refused for the sign-in, nothing was taken: the runner sends again what it sent.
    const out = started();
    await out.opens();
    await out.session.send(message("Go."));
    await out.refuses("turn/start", "Not logged in: run codex login.");
    expect((await out.said(5)).slice(3)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product refused the turn: Not logged in: run codex login.",
      },
      { type: "cannot_go_on", state: "failed", reason: "sign_in" },
    ]);
    expect(out.taken.count).toBe(0);
  });

  it("says a conversation that does not open, ends the process, and takes nothing after", async () => {
    const refused = started();
    await refused.answers("initialize", INITIALIZED);
    await refused.session.send(message("Waits for the conversation."));
    await refused.refuses("thread/start", "invalid thread settings override: sandbox");
    expect(await refused.said(2)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product did not open a conversation: invalid thread settings override: sandbox",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
    ]);
    await until("the process to be ended", () => refused.product.ended);
    await expect(refused.session.send(message("More."))).rejects.toThrow("takes no more input");
    expect(refused.count("turn/start")).toBe(0);
    refused.product.exits(0);
    await refused.read;
    expect(refused.events.at(-1)).toEqual({ type: "ended", how: "exited" });

    const out = started();
    await out.refuses("initialize", "401 Unauthorized");
    expect((await out.said(2)).slice(0, 2)).toEqual([
      { type: "event", kind: "error", text: "The product is not signed in: 401 Unauthorized" },
      { type: "cannot_go_on", state: "failed", reason: "sign_in" },
    ]);

    const nameless = started();
    await nameless.answers("initialize", INITIALIZED);
    await nameless.answers("thread/start", { thread: { id: "../not an id" }, model: "gpt-6-sol" });
    expect((await nameless.said(2)).at(0)).toEqual({
      type: "event",
      kind: "error",
      text: "The product opened a conversation and did not say which.",
    });
  });

  it("refuses what the product asks of a person, with nobody at its terminal, and records it", async () => {
    const { session, product, opens, answers, said, sent } = started();
    await opens();
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    const where = { threadId: THREAD, turnId: TURN, itemId: "call_1" };
    product.says(
      {
        id: "ask-1",
        method: "item/commandExecution/requestApproval",
        params: { ...where, command: "git push --force", reason: "outside the sandbox" },
      },
      {
        id: "ask-2",
        method: "item/fileChange/requestApproval",
        params: { ...where, itemId: "call_2", reason: "writes outside the desk" },
      },
      {
        id: "ask-3",
        method: "item/permissions/requestApproval",
        params: { ...where, itemId: "call_3", reason: null, permissions: { network: {} } },
      },
      {
        id: "ask-4",
        method: "item/tool/requestUserInput",
        params: { ...where, itemId: "call_4", questions: [{ id: "q", question: "Which?" }] },
      },
      {
        id: "ask-5",
        method: "mcpServer/elicitation/request",
        params: { threadId: THREAD, turnId: TURN, serverName: "board", message: "Your name?" },
      },
      // What the runner offered none of: a tool of its own, a sign-in of its own.
      { id: "ask-6", method: "item/tool/call", params: { ...where, tool: "anything" } },
      { id: 7, method: "account/chatgptAuthTokens/refresh", params: {} },
    );
    expect(shapes((await said(8)).slice(3))).toEqual([
      [
        "permission",
        "Denied, with nobody at the terminal to ask: git push --force",
        { tool: "command_execution", answer: "denied", id: "call_1" },
      ],
      [
        "permission",
        "Denied, with nobody at the terminal to ask: writes outside t",
        { tool: "file_change", answer: "denied", id: "call_2" },
      ],
      [
        "permission",
        "Denied, with nobody at the terminal to ask: more than the mo",
        { tool: "permissions", answer: "denied", id: "call_3" },
      ],
      [
        "permission",
        "Denied, with nobody at the terminal to ask: a question for a",
        { tool: "request_user_input", answer: "denied", id: "call_4" },
      ],
      [
        "permission",
        "Denied, with nobody at the terminal to ask: Your name?",
        { tool: "board.elicitation", answer: "denied" },
      ],
    ]);
    await until("every request to be answered", () => sent().some((one) => one.id === 7));
    expect(sent().filter((one) => one.method === undefined)).toEqual([
      { id: "ask-1", result: { decision: "decline" } },
      { id: "ask-2", result: { decision: "decline" } },
      // No leave to do more than the mode allows.
      { id: "ask-3", result: { permissions: {}, scope: "turn" } },
      { id: "ask-4", result: { answers: {} } },
      { id: "ask-5", result: { action: "decline", content: null, _meta: null } },
      { id: "ask-6", error: { code: -32601, message: "item/tool/call is not offered" } },
      {
        id: 7,
        error: { code: -32601, message: "account/chatgptAuthTokens/refresh is not offered" },
      },
    ]);
  });

  it("says the model and the effort with the next turn, and says so when it runs with them", async () => {
    const { session, product, opens, answers, said } = started();
    await opens();
    await session.send(message("One."));
    // Neither is named: the conversation runs with the product's own.
    expect(await answers("turn/start", { turn: turnOf(TURN) })).toEqual({
      threadId: THREAD,
      clientUserMessageId: "m-1",
      input: [textOf("One.")],
    });
    // Taken in a running session: no session is ended for it.
    expect(await session.set({ model: "gpt-6-luna", effort: "high" })).toBe(true);
    product.says(turnCompleted(TURN));
    await said(4);
    await session.send(message("Two."));
    expect(await answers("turn/start", { turn: turnOf(NEXT_TURN) })).toEqual({
      threadId: THREAD,
      clientUserMessageId: "m-2",
      input: [textOf("Two.")],
      model: "gpt-6-luna",
      effort: "high",
    });
    expect((await said(5)).at(4)).toEqual({
      type: "running",
      model: "gpt-6-luna",
      effort: "high",
      version: "0.172.0",
    });
    product.says(turnCompleted(NEXT_TURN));
    await said(6);

    // A choice left at the product's own is not said, and one left as it is stays: the
    // conversation goes on with what it ran with, and nothing new is said of it.
    expect(await session.set({ effort: null })).toBe(true);
    await session.send(message("Three."));
    expect(await answers("turn/start", { turn: turnOf(TURN) })).toEqual({
      threadId: THREAD,
      clientUserMessageId: "m-3",
      input: [textOf("Three.")],
      model: "gpt-6-luna",
    });
    product.says(turnCompleted(TURN));
    expect((await said(7)).slice(6)).toEqual([{ type: "turn_completed" }]);
  });

  it("stops by closing the product's input, which ends it, and takes nothing after", async () => {
    const { session, product, opens, answers, read, events, count } = started();
    await opens();
    await session.send(message("Run the tests."));
    await answers("turn/start", { turn: turnOf(TURN) });
    const stopping = session.stop();
    // As the binary ends when its input closes, a turn under way or none (0.172.0).
    await until("the product's input to be closed", () => product.ended);
    product.exits(0);
    await stopping;
    await read;
    expect(events.at(-1)).toEqual({ type: "ended", how: "exited" });
    expect(product.killed).toEqual([]);
    await expect(session.send(message("More."))).rejects.toThrow("takes no more input");
    expect(count("turn/start")).toBe(1);
    // Stopped twice, it is ended once.
    await session.stop();
  });

  it("asks the installed product what it is and what it offers, without starting a session", async () => {
    const calls: (readonly string[])[] = [];
    const answerOf = (args: readonly string[]): string[] => {
      if (args[0] === "--version") {
        return ["codex-cli 0.172.0"];
      }
      // The product's own list, as it prints it: a line of JSON, each model with much else.
      return [
        JSON.stringify({
          models: [
            {
              slug: "gpt-6-sol",
              display_name: "GPT-6-Sol",
              visibility: "list",
              supported_reasoning_levels: [
                { effort: "low" },
                { effort: "medium" },
                { effort: "high" },
              ],
              base_instructions: "x".repeat(2000),
            },
            {
              slug: "gpt-6-luna",
              visibility: "list",
              supported_reasoning_levels: [{ effort: "medium" }, { effort: "max" }],
            },
            // One it does not list for a person to choose, and what is no model's name.
            { slug: "codex-auto-review", visibility: "hide", supported_reasoning_levels: [] },
            { slug: "--dangerously-bypass-approvals-and-sandbox", visibility: "list" },
            { slug: 42, visibility: "list", supported_reasoning_levels: "all" },
            "not a model",
          ],
        }),
      ];
    };
    const driver = createCodexDriver({
      spawn: (_command, args, options) => {
        calls.push(args);
        const fake = fakeChild(args, options);
        fake.says(...answerOf(args));
        fake.exits(0);
        return fake.child;
      },
      cwd: "/home/mira/desk",
    });
    expect(await driver.probe()).toEqual({
      version: "0.172.0",
      models: ["gpt-6-sol", "gpt-6-luna"],
      efforts: ["low", "medium", "high", "max"],
    });
    expect(calls).toEqual([["--version"], ["debug", "models"]]);

    // A product that is not there says no version and offers nothing; one whose list does not read offers nothing.
    const gone = createCodexDriver({
      spawn: () => {
        throw new Error("spawn codex ENOENT");
      },
      cwd: "/d",
    });
    expect(await gone.probe()).toEqual({ version: undefined, models: [], efforts: [] });
    const odd = createCodexDriver({
      spawn: (_command, args, options) => {
        const fake = fakeChild(args, options);
        fake.says(args[0] === "--version" ? "codex-cli 1.2.3" : "{ not json");
        fake.exits(0);
        return fake.child;
      },
      cwd: "/d",
    });
    expect(await odd.probe()).toEqual({ version: "1.2.3", models: [], efforts: [] });
  });

  it("says a usage limit as that, by the product's word for it or by its words, with the reset the product last said", async () => {
    // The product's own word for it, as its protocol has it; its words are invented, in the
    // shape of an error it writes. Neither was seen said: that takes using an allowance up.
    for (const error of [
      {
        message: "Usage limit reached.",
        codexErrorInfo: "usageLimitExceeded",
        additionalDetails: null,
      },
      { message: "You've hit your usage limit. Try again at 3:15 PM.", codexErrorInfo: "other" },
    ]) {
      const limited = started();
      await limited.opens();
      await limited.session.send(message("Go."));
      await limited.session.send(message("And this."));
      await limited.answers("turn/start", { turn: turnOf(TURN) });
      limited.product.says(turnStarted(TURN), turnCompleted(TURN, "failed", error));
      expect((await limited.said(5)).slice(3)).toEqual([
        { type: "event", kind: "error", text: error.message },
        // No moment: the product said nothing of a window that is used up.
        { type: "cannot_go_on", state: "failed", reason: "usage_limit" },
      ]);
      await tick();
      // What waited is the runner's to hand over again, and no second turn is started with it.
      expect(limited.count("turn/start")).toBe(1);
      expect(limited.events.some((event) => event.type === "turn_completed")).toBe(false);
    }
    // A throttle and a conversation's length are turns that failed, and the next message is taken.
    for (const info of ["rateLimitExceeded", "contextWindowExceeded", "serverOverloaded"]) {
      const other = started();
      await other.opens();
      await other.session.send(message("Go."));
      await other.answers("turn/start", { turn: turnOf(TURN) });
      other.product.says(
        turnStarted(TURN),
        turnCompleted(TURN, "failed", { message: "Try again later.", codexErrorInfo: info }),
      );
      expect((await other.said(5)).at(4), info).toEqual({ type: "turn_completed" });
    }
  });

  it("says the allowance as the product says it, and until when a limit stands by the window that is used up", async () => {
    const { session, product, opens, answers, said, events } = started();
    await opens();
    // As a signed-in product answered when it was asked (0.171.0, on Windows, no turn): a share
    // in hundredths, a length in minutes, a moment in seconds, and no second window.
    const limits = (primary: Json | null, secondary: Json | null = null): Json => ({
      method: "account/rateLimits/updated",
      params: {
        rateLimits: {
          limitId: "codex",
          limitName: null,
          normalModelSlug: null,
          primary,
          secondary,
          credits: { hasCredits: false, unlimited: false, balance: "0" },
          individualLimit: null,
          spendControlReached: false,
          planType: "prolite",
          rateLimitReachedType: null,
        },
      },
    });
    product.says(limits({ usedPercent: 4, windowDurationMins: 10080, resetsAt: 1795927747 }));
    expect((await said(4)).at(3)).toEqual({
      type: "usage",
      windows: [{ name: "weekly", used: 0.04, resetsAt: 1795927747000 }],
    });
    // Two windows, named by how long each lasts; an update that says nothing of one says
    // nothing of it, and what is no window says nothing at all.
    product.says(
      limits(
        { usedPercent: 81.5, windowDurationMins: 300, resetsAt: 1795540000 },
        { usedPercent: 250, windowDurationMins: 43200, resetsAt: null },
      ),
      limits(null),
      { method: "account/rateLimits/updated", params: { rateLimits: "none" } },
      limits({ usedPercent: "many", windowDurationMins: -5, resetsAt: 12 }),
      limits({ usedPercent: 100, windowDurationMins: 300, resetsAt: 1795540000 }),
      // The same said again is said on once: the product writes it several times a turn.
      limits({ usedPercent: 100, windowDurationMins: 300, resetsAt: 1795540000 }),
    );
    await tick();
    expect((await said(6)).slice(4)).toEqual([
      {
        type: "usage",
        windows: [
          { name: "5-hour", used: 0.815, resetsAt: 1795540000000 },
          { name: "30-day", used: 1, resetsAt: undefined },
        ],
      },
      { type: "usage", windows: [{ name: "5-hour", used: 1, resetsAt: 1795540000000 }] },
    ]);
    // A bucket kept apart from the plan's, one model's own: its windows are said with its
    // name after their own, by its id where it has none, and never as the plan's.
    const apart = (limitId: string, limitName: string | null, primary: Json): Json => ({
      method: "account/rateLimits/updated",
      params: {
        rateLimits: { limitId, limitName, primary, secondary: null, credits: null },
      },
    });
    product.says(
      apart("codex_spark", "GPT-5.3-Codex-Spark", {
        usedPercent: 12,
        windowDurationMins: 10080,
        resetsAt: 1795927747,
      }),
      apart("codex_other", null, { usedPercent: 3, windowDurationMins: 300, resetsAt: null }),
      // A name that is only space is none: the bucket is said by its id, never as the plan's.
      apart("codex_blank", " \t ", { usedPercent: 2, windowDurationMins: 10080, resetsAt: null }),
      apart("codex_long", `A   name\n${"x".repeat(200)}`, {
        usedPercent: 1,
        windowDurationMins: 300,
        resetsAt: null,
      }),
    );
    await tick();
    expect((await said(10)).slice(6)).toEqual([
      {
        type: "usage",
        windows: [
          { name: "weekly GPT-5.3-Codex-Spark", used: 0.12, resetsAt: 1795927747000, apart: true },
        ],
      },
      {
        type: "usage",
        windows: [{ name: "5-hour codex_other", used: 0.03, resetsAt: undefined, apart: true }],
      },
      {
        type: "usage",
        windows: [{ name: "weekly codex_blank", used: 0.02, resetsAt: undefined, apart: true }],
      },
      {
        type: "usage",
        windows: [
          { name: `5-hour A name ${"x".repeat(17)}`, used: 0.01, resetsAt: undefined, apart: true },
        ],
      },
    ]);
    // A turn that then fails on the limit says until when: the reset of the window used up.
    await session.send(message("Go."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(
      turnStarted(TURN),
      turnCompleted(TURN, "failed", {
        message: "Usage limit reached.",
        codexErrorInfo: "usageLimitExceeded",
      }),
    );
    await said(12);
    expect(events.at(-1)).toEqual({
      type: "cannot_go_on",
      state: "failed",
      reason: "usage_limit",
      until: 1795540000000,
    });
  });

  it("starts with no build older than the one that says a message back, and says which build runs", async () => {
    // A build with the app server and no id on a message said back (0.130.0, by its protocol):
    // a message put into a turn there is read and never said back.
    const old = started();
    await old.answers("initialize", {
      ...INITIALIZED,
      userAgent: "skillcdn-console-runner/0.138.2 (Mac OS 26.1.0; arm64) unknown",
    });
    expect(await old.said(2)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "This Codex is 0.138.2, and the driver speaks to 0.139.0 or later, whose app server says a message back when it reads it. Update it, as it was installed.",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
    ]);
    expect(old.count("thread/start")).toBe(0);
    // The oldest build itself is spoken to, and a build before its release too.
    for (const userAgent of [
      "skillcdn-console-runner/0.139.0 (Linux 6.8; x86_64) unknown",
      "skillcdn-console-runner/0.171.0-alpha.13.2 (Windows 10.0.26300; x86_64) xterm-256color (skillcdn-console-runner; 0.0.0)",
    ]) {
      const fine = started();
      await fine.answers("initialize", { ...INITIALIZED, userAgent });
      // The build that runs is the one that answered: the conversation says the one that began it.
      await fine.answers("thread/start", opened({ thread: { id: THREAD, cliVersion: "0.164.0" } }));
      expect((await fine.said(3))[1]).toMatchObject({
        type: "running",
        version: userAgent.includes("0.139.0") ? "0.139.0" : "0.171.0-alpha.13.2",
      });
    }
    expect(codexBuild("skillcdn-console-runner/0.171.0-alpha.13.2 (Windows 10.0.26300)")).toEqual({
      text: "0.171.0-alpha.13.2",
      numbers: [0, 171, 0],
    });
    for (const none of [
      undefined,
      42,
      "",
      "codex",
      "x/y",
      `a/${"9".repeat(40)}.1.1`,
      "a b/1.2.3",
    ]) {
      expect(codexBuild(none), String(none)).toBeUndefined();
    }
  });

  it("puts no message into a turn of a build that says nothing of itself until it said one back", async () => {
    const { session, product, answers, said, taken, count } = started();
    await answers("initialize", { codexHome: "/home/mira/.codex" });
    await answers("thread/start", opened());
    expect((await said(3))[1]).toMatchObject({ type: "running", version: null });
    await session.send(message("Run the tests."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(turnStarted(TURN));
    // Not known to say a message back: one that arrives now waits, where put into the turn
    // it could be read, never said back, and handed over once more.
    await session.send(message("Also the linter."));
    await tick();
    await tick();
    expect(count("turn/steer")).toBe(0);
    // It said the first one back: what waited is put into the turn now.
    product.says(...saidBack("m-1", "Run the tests."));
    expect((await answers("turn/steer", { turnId: TURN })).clientUserMessageId).toBe("m-2");
    product.says(...saidBack("m-2", "Also the linter."), turnCompleted(TURN));
    expect((await said(4)).at(3)).toEqual({ type: "turn_completed" });
    expect(taken.count).toBe(2);
  });

  it("goes on with no sandbox that allows more than was asked, and says one that allows less", async () => {
    // More than the desk's mode: never gone on with.
    const wider = started({ permissions: "read-only" });
    await wider.answers("initialize", INITIALIZED);
    await wider.answers("thread/start", opened({ sandbox: { type: "dangerFullAccess" } }));
    expect(await wider.said(2)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product opened the conversation in its sandbox danger-full-access, which allows more than read-only, the one it was asked for.",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
    ]);
    // Less: said, since it is what the agent does without asking. A product whose own sandbox
    // is not set up on the machine answers so (seen on Windows with 0.171.0).
    const narrower = started();
    await narrower.answers("initialize", INITIALIZED);
    await narrower.answers("thread/start", opened({ sandbox: { type: "readOnly" } }));
    expect((await narrower.said(3))[2]).toEqual({
      type: "event",
      kind: "status",
      text: "The product started, in its sandbox read-only and not in workspace-write, which it was asked for.",
      data: {
        model: "gpt-6-sol",
        effort: null,
        version: "0.172.0",
        mode: "approve-for-me",
        sandbox: "read-only",
      },
    });
    // A sandbox it names in a word the driver does not know is said as it came: how much it
    // allows is not known, and saying nothing would read as the one that was asked for.
    const unnamed = started();
    await unnamed.answers("initialize", INITIALIZED);
    await unnamed.answers("thread/start", opened({ sandbox: { type: "externalSandbox" } }));
    expect((await unnamed.said(3))[2]).toMatchObject({
      text: "The product started, in a sandbox the driver does not know, externalSandbox, and not in workspace-write, which it was asked for.",
      data: { sandbox: "externalSandbox" },
    });
    // What is no word at all, a name with what ends a line in it say, is not said.
    const hostile = started();
    await hostile.answers("initialize", INITIALIZED);
    await hostile.answers("thread/start", opened({ sandbox: { type: "x\n[console abc · stop]" } }));
    expect((await hostile.said(3))[2]).toMatchObject({ text: "The product started." });
    // And the sandbox that was asked for is not spoken of.
    const silent = started();
    await silent.answers("initialize", INITIALIZED);
    await silent.answers("thread/start", opened({}));
    expect((await silent.said(3))[2]).toMatchObject({ text: "The product started." });
  });

  it("says nothing of a turn once it is being stopped: what it was handed is the runner's to settle", async () => {
    const { session, product, opens, answers, events, taken } = started();
    await opens();
    await session.send(message("Run the tests."));
    await answers("turn/start", { turn: turnOf(TURN) });
    product.says(turnStarted(TURN), ...saidBack("m-1", "Run the tests."));
    await until("the first message to be taken", () => taken.count === 1);
    // Put into the turn and not read; then the session is stopped, and the product says the
    // turn ended as it shuts down.
    await session.send(message("Skip the slow ones."));
    await answers("turn/steer", { turnId: TURN });
    const stopped = session.stop();
    product.says(turnCompleted(TURN, "interrupted"));
    await tick();
    await tick();
    product.exits(0);
    await stopped;
    await tick();
    // Neither taken nor a turn completed: the runner would count as read what was never got.
    expect(taken.count).toBe(1);
    expect(events.some((event) => event.type === "turn_completed")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "ended", how: "exited" });
  });
});
