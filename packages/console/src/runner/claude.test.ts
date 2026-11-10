import process from "node:process";
import { describe, expect, it } from "vitest";
import { claudeArguments, createClaudeDriver } from "./claude.js";
import { createSpawn } from "./process.js";
import type { Child, DriverEvent, Spawn } from "./types.js";

// The `claude` driver against a product that is not there: a child whose lines the test writes,
// in the shapes the product's documentation gives for its streaming JSON output. Nothing here
// was recorded from a binary; a version the driver was tried with brings its own fixtures.

/** A child the test speaks for: what it was started with, what it was sent, and its output to write. */
function fakeChild() {
  const sent: string[] = [];
  const killed: string[] = [];
  const queue: (string | undefined)[] = [];
  let waiting: (() => void) | undefined;
  let exit: (how: { code: number | null; signal: string | null; error?: string }) => void = () =>
    undefined;
  let ended = false;
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
  let stderr = "";
  return {
    child,
    sent,
    killed,
    /** One line of output, as an object. */
    says: (line: unknown) => push(typeof line === "string" ? line : JSON.stringify(line)),
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

function started(over: Partial<Parameters<typeof claudeArguments>[0]> = {}) {
  const fake = fakeChild();
  const calls: { command: string; args: readonly string[]; cwd: string; env: object }[] = [];
  const spawn: Spawn = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    return fake.child;
  };
  const driver = createClaudeDriver({ spawn, cwd: "/home/mira/desk" });
  const session = driver.start({
    cwd: "/home/mira/desk",
    env: { GIT_TOKEN: "not-a-real-token" },
    model: null,
    effort: null,
    resume: undefined,
    ...over,
  });
  return { ...fake, driver, session, calls };
}

async function collect(events: AsyncIterable<DriverEvent>): Promise<DriverEvent[]> {
  const all: DriverEvent[] = [];
  for await (const event of events) {
    all.push(event);
  }
  return all;
}

const INIT = {
  type: "system",
  subtype: "init",
  session_id: "0199c4d8-0000-7000-8000-0000000000c1",
  model: "claude-opus-5-5",
  effort: "high",
  claude_code_version: "2.1.0",
};
const RESULT = { type: "result", subtype: "success", is_error: false, result: "Done." };

describe("the claude driver", () => {
  it("starts the unmodified binary over its streaming JSON, with nobody at the terminal", () => {
    const plain = started();
    expect(plain.calls).toEqual([
      {
        command: "claude",
        args: [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-prompts",
          "none",
        ],
        cwd: "/home/mira/desk",
        env: { GIT_TOKEN: "not-a-real-token" },
      },
    ]);
    expect(
      claudeArguments({
        cwd: "/d",
        env: {},
        model: "opus",
        effort: "high",
        resume: "0199c4d8-0000-7000-8000-0000000000c1",
      }).slice(8),
    ).toEqual([
      "--model",
      "opus",
      "--effort",
      "high",
      "--resume",
      "0199c4d8-0000-7000-8000-0000000000c1",
    ]);
    expect(plain.driver.can).toEqual({ steer: true, images: true, resume: true, set: false });
    // No version is said to be tried until the driver was run against it.
    expect(plain.driver.product).toEqual({ name: "Claude Code", tried: [] });
  });

  it("sends a message as one line, with its pictures as image blocks and the product's own priority", async () => {
    const { session, sent } = started();
    await session.send({
      text: "[console k3f9a2 #1 · tell · Jane · 14:02]\nLook at this.",
      images: [{ name: "shot.png", contentType: "image/png", bytes: Uint8Array.from([1, 2, 3]) }],
      priority: "now",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("\n");
    expect(JSON.parse(sent[0] ?? "")).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "[console k3f9a2 #1 · tell · Jane · 14:02]\nLook at this." },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
        ],
      },
      parent_tool_use_id: null,
      priority: "now",
    });
    // The model and the effort are taken when the product starts.
    expect(await session.set({ model: "opus" })).toBe(false);
  });

  it("reads what the product does as whole blocks, a line each, until a turn completes", async () => {
    const { session, says, exits } = started();
    says(INIT);
    says({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "The release waits on a migration." },
          { type: "text", text: "I will check the migration." },
          { type: "tool_use", id: "toolu_01", name: "Bash", input: { command: "git status" } },
          {
            type: "tool_use",
            id: "toolu_02",
            name: "Search",
            input: { query: "migration", limit: 5, in: "docs", deep: true },
          },
        ],
      },
    });
    says({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "toolu_01", content: "On branch main" },
          {
            type: "tool_result",
            tool_use_id: "toolu_02",
            is_error: true,
            content: [
              { type: "text", text: "Two matches." },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
              {
                type: "image",
                source: { type: "base64", media_type: "image/svg+xml", data: "AQID" },
              },
            ],
          },
        ],
      },
    });
    // What the runner sent comes back as a line of its own: the runner's to record, not the driver's.
    says({ type: "user", message: { content: [{ type: "text", text: "Hold the release." }] } });
    says({ type: "system", subtype: "compact_boundary" });
    says({ type: "system", subtype: "api_retry", attempt: 2 });
    says({
      ...RESULT,
      permission_denials: [
        { tool_name: "Bash", tool_use_id: "toolu_03", tool_input: { command: "sudo rm -rf /" } },
      ],
    });
    exits(0);
    expect(await collect(session.events)).toEqual([
      { type: "running", model: "claude-opus-5-5", effort: "high", version: "2.1.0" },
      { type: "conversation", id: "0199c4d8-0000-7000-8000-0000000000c1" },
      {
        type: "event",
        kind: "status",
        text: "The product started.",
        data: { model: "claude-opus-5-5", effort: "high", version: "2.1.0" },
      },
      { type: "event", kind: "thinking", text: "The release waits on a migration." },
      { type: "event", kind: "assistant", text: "I will check the migration." },
      {
        type: "event",
        kind: "tool_call",
        text: "git status",
        data: { tool: "Bash", id: "toolu_01" },
      },
      {
        type: "event",
        kind: "tool_call",
        text: '{"query":"migration","limit":5,"in":"docs","deep":true}',
        data: { tool: "Search", id: "toolu_02" },
      },
      {
        type: "event",
        kind: "tool_result",
        text: "On branch main",
        data: { id: "toolu_01", error: false },
        pictures: [],
      },
      {
        type: "event",
        kind: "tool_result",
        text: "Two matches.\n[a picture the transcript does not keep]",
        data: { id: "toolu_02", error: true },
        pictures: [
          { name: "tool-2-1.png", contentType: "image/png", bytes: Buffer.from([1, 2, 3]) },
        ],
      },
      { type: "event", kind: "status", text: "The product compacted the conversation." },
      {
        type: "event",
        kind: "error",
        text: "The product is asking the model again after a request that failed.",
        data: { attempt: 2 },
      },
      {
        type: "event",
        kind: "permission",
        text: "Denied, with nobody at the terminal to ask: Bash sudo rm -rf /",
        data: { tool: "Bash", answer: "denied", id: "toolu_03" },
      },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);
  });

  it("reads what the product prints as data, whatever it is, and runs none of it", async () => {
    const { session, says, exits } = started();
    says("");
    says("not json at all");
    says("[1,2,3]");
    says('{"type":42}');
    says('{"no":"type"}');
    says({ type: "assistant" });
    says({ type: "assistant", message: { content: "a string, not blocks" } });
    says({
      type: "assistant",
      message: { content: [null, 7, { type: "text" }, { type: "tool_use" }] },
    });
    says({
      type: "user",
      message: { content: [{ type: "tool_result", content: { not: "blocks" } }] },
    });
    says({ type: "system", subtype: "something_new" });
    says({ type: "something_else", text: "ignored" });
    says({ type: "result", permission_denials: "none", result: 42 });
    says({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", input: { text: "x".repeat(9000) } }],
      },
    });
    exits(0);
    const events = await collect(session.events);
    expect(events.map((event) => (event.type === "event" ? event.kind : event.type))).toEqual([
      "tool_call",
      "tool_result",
      "turn_completed",
      "tool_call",
      "ended",
    ]);
    expect(events[0]).toMatchObject({ text: "", data: { tool: "a tool", id: null } });
    expect(events[1]).toMatchObject({ text: "", data: { id: null, error: false }, pictures: [] });
    // A tool's input is shown bounded.
    expect((events[3] as { text: string }).text.length).toBeLessThan(4100);
  });

  it("says that the model refused, and that the product is not signed in, as an agent that cannot go on", async () => {
    const refused = started();
    refused.says(INIT);
    refused.says({ type: "result", subtype: "success", is_error: false, stop_reason: "refusal" });
    refused.exits(0);
    expect((await collect(refused.session.events)).slice(3)).toEqual([
      { type: "event", kind: "error", text: "The model refused to answer." },
      { type: "cannot_go_on", state: "refused", reason: "model_refused" },
      { type: "ended", how: "exited" },
    ]);

    const signedOut = started();
    signedOut.says(INIT);
    signedOut.says({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "Not logged in. Please run /login",
    });
    signedOut.exits(1);
    expect((await collect(signedOut.session.events)).slice(3)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "Not logged in. Please run /login",
        data: { subtype: "error_during_execution" },
      },
      { type: "cannot_go_on", state: "failed", reason: "sign_in" },
      // Said once: the process ending after it adds nothing.
      { type: "ended", how: "crashed" },
    ]);

    // A turn that ended with another error is a turn that ended: the agent takes the next message.
    const errored = started();
    errored.says(INIT);
    errored.says({ type: "result", subtype: "error_max_turns", is_error: true, result: "" });
    errored.exits(0);
    expect((await collect(errored.session.events)).slice(3)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The turn ended with an error.",
        data: { subtype: "error_max_turns" },
      },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);
  });

  it("says how a process that is gone ended: never started, crashed in a turn, or not signed in", async () => {
    const missing = started();
    missing.exits(null, null, "spawn claude ENOENT");
    expect(await collect(missing.session.events)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product could not be started: spawn claude ENOENT",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
      { type: "ended", how: "crashed" },
    ]);

    const crashed = started();
    crashed.says(INIT);
    crashed.writes("a stack trace\n");
    crashed.exits(null, "SIGSEGV");
    expect((await collect(crashed.session.events)).slice(3)).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product's process ended on SIGSEGV.\na stack trace",
      },
      { type: "cannot_go_on", state: "failed", reason: "crashed" },
      { type: "ended", how: "crashed" },
    ]);

    const expired = started();
    expired.writes("Error: OAuth token has expired\n");
    expired.exits(1);
    expect((await collect(expired.session.events)).slice(1)).toEqual([
      { type: "cannot_go_on", state: "failed", reason: "sign_in" },
      { type: "ended", how: "crashed" },
    ]);
  });

  it("stops a turn with the signal the product documents, and the process by closing its input", async () => {
    const { session, killed, exits, child } = started();
    await session.interrupt();
    expect(killed).toEqual(["SIGINT"]);
    const stopping = session.stop();
    // Asked first: the input closes, and a process that ends by itself is not made to.
    exits(0);
    await stopping;
    expect(killed).toEqual(["SIGINT"]);
    expect(await collect(session.events)).toEqual([{ type: "ended", how: "exited" }]);
    void child;
  });

  it("asks the installed product what it is, without starting a session", async () => {
    const fake = fakeChild();
    const calls: (readonly string[])[] = [];
    const driver = createClaudeDriver({
      spawn: (_command, args) => {
        calls.push(args);
        return fake.child;
      },
      cwd: "/home/mira/desk",
    });
    fake.says("2.1.211 (Claude Code)");
    fake.exits(0);
    expect(await driver.probe()).toEqual({
      version: "2.1.211",
      models: ["opus", "sonnet", "haiku", "fable"],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(calls).toEqual([["--version"]]);
    // A product that is not there offers the same, and says no version.
    const gone = createClaudeDriver({
      spawn: () => {
        throw new Error("spawn claude ENOENT");
      },
      cwd: "/d",
    });
    expect((await gone.probe()).version).toBeUndefined();
  });
});

describe("a child process on this machine", () => {
  // A process of this runtime that answers each line it reads, as a product answers a message.
  const ECHO =
    'process.stdin.setEncoding("utf8");let rest="";process.stdin.on("data",(chunk)=>{rest+=chunk;for(;;){const end=rest.indexOf("\\n");if(end===-1)break;const line=rest.slice(0,end);rest=rest.slice(end+1);process.stdout.write(JSON.stringify({heard:line,token:process.env.GIT_TOKEN??null})+"\\n");}});process.stdin.on("end",()=>{process.stderr.write("input closed\\n");process.exit(3);});';

  it("takes lines and gives lines, with what it was handed in its environment, and says how it ended", async () => {
    const spawn = createSpawn({});
    const child = spawn(process.execPath, ["-e", ECHO], {
      cwd: process.cwd(),
      env: { GIT_TOKEN: "not-a-real-token" },
    });
    const lines: string[] = [];
    const reading = (async () => {
      for await (const line of child.lines) {
        lines.push(line);
        if (lines.length === 2) {
          child.end();
        }
      }
    })();
    await child.write("one");
    await child.write("two");
    await reading;
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { heard: "one", token: "not-a-real-token" },
      { heard: "two", token: "not-a-real-token" },
    ]);
    expect(await child.exited).toEqual({ code: 3, signal: null });
    expect(child.errors()).toContain("input closed");
    await expect(child.write("three")).rejects.toThrow();
  });

  it("says that a command is not there to start, when asked how it ended", async () => {
    const spawn = createSpawn({});
    const child = spawn("no-such-command-of-the-console", [], { cwd: process.cwd(), env: {} });
    const lines: string[] = [];
    for await (const line of child.lines) {
      lines.push(line);
    }
    expect(lines).toEqual([]);
    expect((await child.exited).error).toContain("ENOENT");
  });
});
