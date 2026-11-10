import { describe, expect, it } from "vitest";
import { codexArguments, createCodexDriver } from "./codex.js";
import { ownRunnerModules } from "./modules.js";
import type { Child, DriverEvent, DriverMessage, StartOptions } from "./types.js";

// The `codex` driver against a product that is not there: a child a turn, whose lines the test
// writes in the shapes the binary printed when the driver was run against it (0.164.0): each
// cut down to what a reader could take from it, with every id and path invented. What the
// binary was not seen to print, its reasoning, a tool of a server and a search, is in the
// shapes its documentation gives.

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

function started(over: Partial<StartOptions> = {}) {
  const turns: ReturnType<typeof fakeChild>[] = [];
  const driver = createCodexDriver({
    spawn: (_command, args, options) => {
      const fake = fakeChild(args, options);
      turns.push(fake);
      return fake.child;
    },
    cwd: "/home/mira/desk",
  });
  const session = driver.start({
    cwd: "/home/mira/desk",
    env: { GIT_TOKEN: "not-a-real-token" },
    model: null,
    effort: null,
    resume: undefined,
    ...over,
  });
  const events: DriverEvent[] = [];
  const read = (async () => {
    for await (const event of session.events) {
      events.push(event);
    }
  })();
  /** The process of a turn, once the driver started it: the first is 0. */
  const turn = async (index: number) => {
    await until(`turn ${index} to start`, () => turns.length > index);
    const fake = turns[index];
    if (fake === undefined) {
      throw new Error("no such turn");
    }
    return fake;
  };
  /** What the session said once it said so many things. */
  const said = async (count: number) => {
    await until(`${count} events, of ${JSON.stringify(events)}`, () => events.length >= count);
    await tick();
    return events;
  };
  return { driver, session, turns, turn, events, said, read };
}

const THREAD = "0199c4d8-0000-7000-8000-0000000000c1";
const message = (text: string, priority: "now" | "next" = "next"): DriverMessage => ({
  text,
  images: [],
  priority,
});
const BEGAN = [{ type: "thread.started", thread_id: THREAD }, { type: "turn.started" }];
const USAGE = { input_tokens: 17162, cached_input_tokens: 12928, output_tokens: 5 };
const answers = (id: string, text: string) => ({
  type: "item.completed",
  item: { id, type: "agent_message", text },
});
const COMPLETED = { type: "turn.completed", usage: USAGE };
/** The settings a turn is started with where the desk names no mode: the product's own reviewer answers. */
const REVIEWED = [
  "-c",
  'sandbox_mode="workspace-write"',
  "-c",
  'approval_policy="on-request"',
  "-c",
  'approvals_reviewer="auto_review"',
];

describe("the codex driver", () => {
  it("is the package's driver for Codex, beside the one for Claude Code", () => {
    const modules = ownRunnerModules({ user: "mira" });
    expect(modules.drivers.names()).toEqual(["claude", "codex"]);
    const { driver } = started();
    expect(driver.name).toBe("codex");
    // The builds the driver was run against, and no other.
    expect(driver.product).toEqual({ name: "Codex", tried: ["0.164.0-alpha.11.1"] });
    // No message is taken in a turn and no picture is handed over; the model is each turn's.
    expect(driver.can).toEqual({ steer: false, images: false, resume: true, set: true });
    expect(driver.permissions).toEqual({
      modes: ["read-only", "workspace-write", "approve-for-me", "danger-full-access"],
      unattended: "approve-for-me",
      least: "read-only",
    });
  });

  it("starts a turn of the unmodified binary with nobody at the terminal: a conversation begun, or one gone on with", () => {
    const turn = (over: Partial<Parameters<typeof codexArguments>[0]> = {}) =>
      codexArguments({
        model: null,
        effort: null,
        permissions: undefined,
        conversation: undefined,
        ...over,
      });
    expect(turn()).toEqual(["exec", "--json", "--skip-git-repo-check", ...REVIEWED, "-"]);
    expect(turn({ model: "gpt-6-luna", effort: "low", conversation: THREAD })).toEqual([
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      ...REVIEWED,
      "-m",
      "gpt-6-luna",
      "-c",
      'model_reasoning_effort="low"',
      THREAD,
      "-",
    ]);
    // The mode the desk names, in the product's own word, said at every turn; whatever a mode
    // does not allow is asked of nobody.
    const modeOf = (permissions: string | undefined) => turn({ permissions }).slice(3, -1);
    expect(modeOf("read-only")).toEqual([
      "-c",
      'sandbox_mode="read-only"',
      "-c",
      'approval_policy="never"',
    ]);
    expect(modeOf("workspace-write")).toEqual([
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      'approval_policy="never"',
    ]);
    expect(modeOf("danger-full-access")).toEqual([
      "-c",
      'sandbox_mode="danger-full-access"',
      "-c",
      'approval_policy="never"',
    ]);
    expect(modeOf("approve-for-me")).toEqual(REVIEWED);
    // A mode that is none of the product's is never leave to do more: the one that allows the least.
    expect(modeOf("everything")).toEqual(modeOf("read-only"));
    expect(modeOf("Danger-Full-Access")).toEqual(modeOf("read-only"));
    // What is no word of a command line never becomes an option of the product's, or a setting
    // beside the one it was meant for: it is left out.
    expect(
      turn({
        model: "--dangerously-bypass-approvals-and-sandbox",
        effort: 'high" -c sandbox_mode="danger-full-access',
        conversation: "--last",
      }),
    ).toEqual(turn());
    expect(turn({ model: "gpt 6", effort: "", conversation: "../another" })).toEqual(turn());
  });

  it("hands a turn its message on the standard input, in the desk, with what the session was handed", async () => {
    const { session, turn, said } = started({ model: "gpt-6-luna", effort: "low" });
    await session.send(message("[console k3f9a2 #1 · tell · Jane · 14:02]\nLook at this."));
    const first = await turn(0);
    await until("the message", () => first.ended);
    expect(first.sent).toEqual(["[console k3f9a2 #1 · tell · Jane · 14:02]\nLook at this."]);
    expect(first.options).toEqual({
      cwd: "/home/mira/desk",
      env: { GIT_TOKEN: "not-a-real-token" },
    });
    expect(first.args).toEqual(
      codexArguments({
        model: "gpt-6-luna",
        effort: "low",
        permissions: undefined,
        conversation: undefined,
      }),
    );
    first.says(...BEGAN, answers("item_0", "ready"), COMPLETED);
    first.exits(0);
    expect(await said(5)).toEqual([
      { type: "running", model: "gpt-6-luna", effort: "low", version: null },
      { type: "conversation", id: THREAD },
      {
        type: "event",
        kind: "status",
        text: "The product started.",
        data: { model: "gpt-6-luna", effort: "low", version: null, mode: "approve-for-me" },
      },
      { type: "event", kind: "assistant", text: "ready" },
      { type: "turn_completed" },
    ]);
    // The next message goes on with the conversation the first turn named, and says nothing
    // again of how the product runs.
    await session.send(message("And this."));
    const second = await turn(1);
    expect(second.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(second.args.slice(-2)).toEqual([THREAD, "-"]);
    second.says(...BEGAN, answers("item_0", "seen"), COMPLETED);
    second.exits(0);
    expect((await said(7)).slice(5)).toEqual([
      { type: "event", kind: "assistant", text: "seen" },
      { type: "turn_completed" },
    ]);
  });

  it("goes on with the conversation a session before left, where it names one", async () => {
    const { session, turn } = started({ resume: THREAD });
    await session.send(message("Go on."));
    expect((await turn(0)).args).toEqual(
      codexArguments({
        model: null,
        effort: null,
        permissions: undefined,
        conversation: THREAD,
      }),
    );
  });

  it("reads what the product does as whole blocks, a line each, until the turn completes", async () => {
    const { session, turn, said } = started();
    await session.send(message("Cut the release."));
    const first = await turn(0);
    first.says(
      ...BEGAN,
      answers("item_0", "I will check the notes, then patch them."),
      {
        type: "item.started",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "/bin/bash -lc 'cat notes.txt'",
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "/bin/bash -lc 'cat notes.txt'",
          aggregated_output: "hello\n",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.started",
        item: {
          id: "item_2",
          type: "file_change",
          changes: [
            { path: "/home/mira/desk/a.txt", kind: "add" },
            { path: "/home/mira/desk/notes.txt", kind: "update" },
          ],
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_2",
          type: "file_change",
          changes: [
            { path: "/home/mira/desk/a.txt", kind: "add" },
            { path: "/home/mira/desk/notes.txt", kind: "update" },
          ],
          status: "completed",
        },
      },
      // A command the product wrote no beginning of, which ended in something other than 0.
      {
        type: "item.completed",
        item: {
          id: "item_3",
          type: "command_execution",
          command: "/bin/bash -lc 'exit 3'",
          aggregated_output: "",
          exit_code: 3,
          status: "failed",
        },
      },
      answers("item_4", "done"),
      COMPLETED,
    );
    first.exits(0);
    expect((await said(12)).slice(3)).toEqual([
      { type: "event", kind: "assistant", text: "I will check the notes, then patch them." },
      {
        type: "event",
        kind: "tool_call",
        text: "/bin/bash -lc 'cat notes.txt'",
        data: { tool: "command_execution", id: "item_1" },
      },
      {
        type: "event",
        kind: "tool_result",
        text: "hello\n",
        data: { id: "item_1", error: false, exit: 0 },
        pictures: [],
      },
      {
        type: "event",
        kind: "tool_call",
        text: "add /home/mira/desk/a.txt\nupdate /home/mira/desk/notes.txt",
        data: { tool: "file_change", id: "item_2" },
      },
      {
        type: "event",
        kind: "tool_result",
        text: "",
        data: { id: "item_2", error: false },
        pictures: [],
      },
      {
        type: "event",
        kind: "tool_call",
        text: "/bin/bash -lc 'exit 3'",
        data: { tool: "command_execution", id: "item_3" },
      },
      {
        type: "event",
        kind: "tool_result",
        text: "",
        data: { id: "item_3", error: true, exit: 3 },
        pictures: [],
      },
      { type: "event", kind: "assistant", text: "done" },
      { type: "turn_completed" },
    ]);
  });

  it("reads what the product prints as data, whatever it is, and runs none of it", async () => {
    const { session, turn, said } = started();
    await session.send(message("Go."));
    const first = await turn(0);
    first.says(
      "",
      "not json at all",
      "[1,2,3]",
      '{"type":42}',
      '{"no":"type"}',
      { type: "thread.started" },
      { type: "item.completed" },
      { type: "item.completed", item: "a string" },
      { type: "item.completed", item: { type: "agent_message" } },
      { type: "item.completed", item: { type: "something_new", text: "ignored" } },
      { type: "item.started", item: { type: "agent_message", text: "not said twice" } },
      { type: "something.else", text: "ignored" },
      // In the shapes the product's documentation gives: its reasoning, a tool of a server, a search.
      {
        type: "item.completed",
        item: { id: "r1", type: "reasoning", text: "The notes are short." },
      },
      {
        type: "item.completed",
        item: {
          id: "m1",
          type: "mcp_tool_call",
          server: "board",
          tool: "search",
          arguments: { query: "release" },
          result: { content: [{ type: "text", text: "Two tasks." }] },
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "m2",
          type: "mcp_tool_call",
          server: "board",
          tool: "write",
          error: { message: "not allowed" },
          status: "failed",
        },
      },
      { type: "item.completed", item: { id: "w1", type: "web_search", query: "release notes" } },
      // A word of warning inside a turn, and a tool's input shown bounded.
      {
        type: "item.completed",
        item: { id: "e1", type: "error", message: "A model's data is not found." },
      },
      {
        type: "item.completed",
        item: { type: "command_execution", command: "x".repeat(9000), exit_code: 0 },
      },
      COMPLETED,
    );
    first.exits(0);
    const events = (await said(12)).slice(1);
    expect(
      events.map((event) =>
        event.type === "event" ? [event.kind, event.text.slice(0, 40), event.data] : event.type,
      ),
    ).toEqual([
      // A conversation the product did not name is none to go on with.
      [
        "status",
        "The product started.",
        { model: null, effort: null, version: null, mode: "approve-for-me" },
      ],
      ["thinking", "The notes are short.", undefined],
      ["tool_call", '{"query":"release"}', { tool: "board.search", id: "m1" }],
      ["tool_result", '{"content":[{"type":"text","text":"Two t', { id: "m1", error: false }],
      ["tool_call", "", { tool: "board.write", id: "m2" }],
      ["tool_result", "not allowed", { id: "m2", error: true }],
      ["tool_call", "release notes", { tool: "web_search", id: "w1" }],
      ["error", "A model's data is not found.", undefined],
      ["tool_call", "x".repeat(40), { tool: "command_execution", id: null }],
      ["tool_result", "", { id: null, error: false, exit: 0 }],
      "turn_completed",
    ]);
    const long = events.find((event) => event.type === "event" && event.text.startsWith("xxx"));
    expect((long as { text: string }).text.length).toBeLessThan(4100);
  });

  it("keeps a message that arrives while a turn runs for the turn after, and says the agent done when nothing waits", async () => {
    const { session, turn, turns, said } = started();
    await session.send(message("Run the tests."));
    const first = await turn(0);
    first.says(...BEGAN);
    // The product takes no message in a turn: two that arrive wait, and no process is started.
    await session.send(message("And say which failed."));
    await session.send(message("Then stop."));
    await tick();
    expect(turns).toHaveLength(1);
    expect(first.killed).toEqual([]);
    first.says(answers("item_0", "All passed."), COMPLETED);
    first.exits(0);
    // The first turn's end is not the agent done: what waited is the next turn's, read together.
    const second = await turn(1);
    await until("the message", () => second.ended);
    expect(second.sent).toEqual(["And say which failed.\n\nThen stop."]);
    expect(second.args.slice(0, 2)).toEqual(["exec", "resume"]);
    second.says(...BEGAN, answers("item_0", "None failed."), COMPLETED);
    second.exits(0);
    expect((await said(6)).slice(3)).toEqual([
      { type: "event", kind: "assistant", text: "All passed." },
      { type: "event", kind: "assistant", text: "None failed." },
      { type: "turn_completed" },
    ]);
  });

  it("ends the turn's process for a message that is to be read now, and for an interrupt", async () => {
    const { session, turn, said } = started();
    await session.send(message("Run the tests."));
    const first = await turn(0);
    first.says(...BEGAN);
    await session.send(message("Stop that.", "now"));
    await until("the turn's process to be ended", () => first.killed.length === 1);
    expect(first.killed).toEqual(["SIGTERM"]);
    // One that arrives while it ends is not a reason to end it twice.
    await session.send(message("And look here.", "now"));
    expect(first.killed).toEqual(["SIGTERM"]);
    first.exits(null, "SIGTERM");
    const second = await turn(1);
    await until("the message", () => second.ended);
    expect(second.sent).toEqual(["Stop that.\n\nAnd look here."]);
    expect(second.args.slice(-2)).toEqual([THREAD, "-"]);
    second.says(...BEGAN, answers("item_0", "halted"), COMPLETED);
    second.exits(0);
    expect((await said(6)).slice(3)).toEqual([
      { type: "event", kind: "status", text: "The turn was stopped for a message." },
      { type: "event", kind: "assistant", text: "halted" },
      { type: "turn_completed" },
    ]);

    // An interrupt with nothing to say: the turn is stopped, and the agent waits for more.
    await session.send(message("Run them again."));
    const third = await turn(2);
    third.says(...BEGAN);
    await session.interrupt();
    await until("the turn's process to be ended", () => third.killed.length === 1);
    third.exits(null, "SIGTERM");
    expect((await said(8)).slice(6)).toEqual([
      { type: "event", kind: "status", text: "The turn was stopped." },
      { type: "turn_completed" },
    ]);
    // With no turn under way there is nothing to stop.
    await session.interrupt();
    await tick();
    expect(third.killed).toEqual(["SIGTERM"]);
  });

  it("says how a turn failed: the product not there, a turn the service refused, a sign-in that ran out, a process that fell over", async () => {
    const missing = started();
    await missing.session.send(message("Go."));
    (await missing.turn(0)).exits(null, null, "spawn codex ENOENT");
    expect(await missing.said(2)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product could not be started: spawn codex ENOENT",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
    ]);
    // Tried again by the runner: a message after it starts a process again.
    await missing.session.send(message("Go."));
    expect((await missing.turn(1)).args[0]).toBe("exec");

    // What failed a turn is written twice, and said once: a turn that ended, and the next is taken.
    const refused = started({ model: "no-such-model" });
    await refused.session.send(message("Go."));
    const turn = await refused.turn(0);
    const answer = JSON.stringify({
      type: "error",
      status: 400,
      error: { type: "invalid_request_error", message: "The model is not supported." },
    });
    turn.says(
      { type: "thread.started", thread_id: THREAD },
      { type: "turn.started" },
      { type: "error", message: answer },
      { type: "turn.failed", error: { message: answer } },
    );
    turn.exits(1);
    expect((await refused.said(5)).slice(3)).toEqual([
      { type: "event", kind: "error", text: "The model is not supported." },
      { type: "turn_completed" },
    ]);

    // A sign-in that ran out, by pattern: the agent cannot go on, and what was sent is the runner's to send again.
    const signedOut = started();
    await signedOut.session.send(message("Go."));
    await signedOut.session.send(message("And this."));
    const out = await signedOut.turn(0);
    out.says(...BEGAN, {
      type: "turn.failed",
      error: { message: "Not logged in. Run codex login." },
    });
    out.exits(1);
    expect((await signedOut.said(5)).slice(3)).toEqual([
      { type: "event", kind: "error", text: "Not logged in. Run codex login." },
      { type: "cannot_go_on", state: "failed", reason: "sign_in" },
    ]);
    await tick();
    expect(signedOut.turns).toHaveLength(1);

    // A process that fell over in its turn, with no word of how the turn ended, says how it
    // ended, with the end of what it wrote of it: the agent cannot go on by itself, and what the
    // turn was at is not known, so nothing is sent again.
    const crashed = started();
    await crashed.session.send(message("Go."));
    await crashed.session.send(message("And this."));
    const gone = await crashed.turn(0);
    gone.says(...BEGAN);
    gone.writes("a stack trace\n");
    gone.exits(101);
    expect((await crashed.said(5)).slice(3)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product's process ended with code 101 before the turn did.\na stack trace",
      },
      { type: "cannot_go_on", state: "failed", reason: "crashed" },
    ]);
    await tick();
    expect(crashed.turns).toHaveLength(1);

    // One that ended before any turn started took nothing, a conversation it does not find
    // again say, in the words the binary had for it: what was sent is the runner's to send again.
    const lost = started({ resume: THREAD });
    await lost.session.send(message("Go."));
    const none = await lost.turn(0);
    none.writes(
      `Error: thread/resume: thread/resume failed: no rollout found for thread id ${THREAD} (code -32600)\n`,
    );
    none.exits(1);
    expect(await lost.said(2)).toEqual([
      {
        type: "event",
        kind: "error",
        text: `The product's process ended with code 1 before the turn did.\nError: thread/resume: thread/resume failed: no rollout found for thread id ${THREAD} (code -32600)`,
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
    ]);
    // A supervisor's next word is tried at once, in a process of its own.
    await lost.session.send(message("Go."));
    expect((await lost.turn(1)).args).toContain("resume");
  });

  it("takes the model and the effort from the next turn on, and says so when it runs with them", async () => {
    const { session, turn, said } = started({ model: "gpt-6-luna" });
    await session.send(message("Go."));
    const first = await turn(0);
    first.says(...BEGAN, COMPLETED);
    first.exits(0);
    await said(4);
    expect(await session.set({ model: "gpt-6-sol", effort: "high" })).toBe(true);
    await session.send(message("Again."));
    const second = await turn(1);
    expect(second.args).toEqual(
      codexArguments({
        model: "gpt-6-sol",
        effort: "high",
        permissions: undefined,
        conversation: THREAD,
      }),
    );
    second.says(...BEGAN, COMPLETED);
    second.exits(0);
    expect((await said(6)).slice(4)).toEqual([
      { type: "running", model: "gpt-6-sol", effort: "high", version: null },
      { type: "turn_completed" },
    ]);
    // The product's own choice again: nothing named.
    expect(await session.set({ model: null, effort: null })).toBe(true);
    await session.send(message("Once more."));
    expect((await turn(2)).args).not.toContain("-m");
  });

  it("stops by ending the turn under way, and takes nothing after", async () => {
    const { session, turn, said, read } = started();
    await session.send(message("Run the tests."));
    const first = await turn(0);
    first.says(...BEGAN);
    await session.send(message("And this."));
    const stopping = session.stop();
    await until("the turn's process to be ended", () => first.killed.length === 1);
    first.exits(null, "SIGTERM");
    await stopping;
    await read;
    // Nothing of the turn that was ended is an error, and what waited starts no turn.
    expect((await said(4)).slice(3)).toEqual([{ type: "ended", how: "exited" }]);
    await expect(session.send(message("More."))).rejects.toThrow();

    // A session with no turn under way ends at once.
    const idle = started();
    await idle.session.stop();
    await idle.read;
    expect(idle.events).toEqual([{ type: "ended", how: "exited" }]);
    expect(idle.turns).toEqual([]);
  });

  it("asks the installed product what it is and what it offers, without starting a turn", async () => {
    const calls: (readonly string[])[] = [];
    const answer = (args: readonly string[]): string[] => {
      if (args[0] === "--version") {
        return ["codex-cli 0.164.0-alpha.11.1"];
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
        fake.says(...answer(args));
        fake.exits(0);
        return fake.child;
      },
      cwd: "/home/mira/desk",
    });
    expect(await driver.probe()).toEqual({
      version: "0.164.0-alpha.11.1",
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
});
