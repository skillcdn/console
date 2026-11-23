import process from "node:process";
import { describe, expect, it } from "vitest";
import { claudeArguments, createClaudeDriver } from "./claude.js";
import { createSpawn } from "./process.js";
import { cutShown, cutShownEnd, redactorOf, WITHHELD } from "./redact.js";
import type { Child, DriverEvent, Spawn } from "./types.js";

// The `claude` driver against a product that is not there: a child whose lines the test writes,
// in the shapes the binary printed when the driver was run against it (2.1.321): each line cut
// down to what a reader could take from it, with every id, name and path invented. What the
// binary was not seen to print, a refusal and a sign-in that ran out, is in the shapes its
// documentation gives.

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
  // The ids the driver writes under, in order: m1, m2 and so on, for the test to say back.
  let made = 0;
  const uuid = () => {
    made += 1;
    return `m${made}`;
  };
  const driver = createClaudeDriver({ spawn, cwd: "/home/mira/desk", uuid });
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

const CONVERSATION = "0199c4d8-0000-7000-8000-0000000000c1";
/** How the product says it runs: when it starts, and again at the start of every turn. */
const INIT = {
  type: "system",
  subtype: "init",
  cwd: "/home/mira/desk",
  session_id: CONVERSATION,
  tools: ["Bash", "Read", "Write"],
  mcp_servers: [],
  model: "claude-sonnet-5-5",
  permissionMode: "auto",
  apiKeySource: "none",
  claude_code_version: "2.1.321",
  capabilities: ["interrupt_receipt_v1", "msg_lifecycle_v1"],
  uuid: "0199c4d8-0000-7000-8000-00000000e001",
};
const STARTED = [
  { type: "running", model: "claude-sonnet-5-5", effort: null, version: "2.1.321" },
  { type: "conversation", id: CONVERSATION },
  {
    type: "event",
    kind: "status",
    text: "The product started.",
    data: { model: "claude-sonnet-5-5", effort: null, version: "2.1.321", mode: "auto" },
  },
];
/** A turn that completed. */
const RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  stop_reason: "end_turn",
  terminal_reason: "completed",
  result: "Done.",
  permission_denials: [],
  num_turns: 1,
  session_id: CONVERSATION,
};
/** A message the product took off its input, said back under the id it was written with. */
const taken = (uuid: string, text: string) => ({
  type: "user",
  message: { role: "user", content: [{ type: "text", text }] },
  parent_tool_use_id: null,
  uuid,
  isReplay: true,
});
/** What the product says became of a message. */
const became = (uuid: string, state: "queued" | "started" | "completed" | "cancelled") => ({
  type: "command_lifecycle",
  command_uuid: uuid,
  state,
  session_id: CONVERSATION,
});
const says1 = (text: string) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
  parent_tool_use_id: null,
  session_id: CONVERSATION,
});
const message = (text: string, priority: "now" | "next" = "next") => ({
  text,
  images: [],
  priority,
});

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
          "--replay-user-messages",
          // Named because the product does not start a run nobody attends in it by itself.
          "--permission-mode",
          "auto",
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
      }).slice(11),
    ).toEqual([
      "--model",
      "opus",
      "--effort",
      "high",
      "--resume",
      "0199c4d8-0000-7000-8000-0000000000c1",
    ]);
    // A model as the product spells one with marks is a word; what is none, a value that
    // begins as an option among it, is left out and never read as an option of the product's.
    expect(
      claudeArguments({
        cwd: "/d",
        env: {},
        model: "opus[1m]",
        effort: "--dangerously-skip-permissions",
        resume: "--settings=/tmp/x.json",
      }).slice(11),
    ).toEqual(["--model", "opus[1m]"]);
    expect(
      claudeArguments({ cwd: "/d", env: {}, model: "a b", effort: "", resume: "c 1" }).slice(11),
    ).toEqual([]);
    expect(plain.driver.can).toEqual({ steer: true, images: true, resume: true, set: false });
    // The mode the desk names, in the product's own word; one that is none of the product's is
    // never leave to do more: the session starts in the mode that allows the least.
    const modeOf = (permissions: string | undefined) => {
      const args = claudeArguments({
        cwd: "/d",
        env: {},
        model: null,
        effort: null,
        resume: undefined,
        permissions,
      });
      return args[args.indexOf("--permission-mode") + 1];
    };
    expect(modeOf(undefined)).toBe("auto");
    expect(modeOf("dontAsk")).toBe("dontAsk");
    expect(modeOf("bypassPermissions")).toBe("bypassPermissions");
    // The product's two words for the mode that asks, as the desk writes either.
    expect(modeOf("manual")).toBe("manual");
    expect(modeOf("default")).toBe("default");
    expect(modeOf("dontask")).toBe("dontAsk");
    expect(modeOf("everything")).toBe("dontAsk");
    expect(plain.driver.permissions).toEqual({
      modes: ["default", "manual", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"],
      unattended: "auto",
      least: "dontAsk",
    });
    // The builds the driver was run against, and no other.
    expect(plain.driver.product).toEqual({
      name: "Claude Code",
      tried: ["2.1.321", "2.1.322", "2.1.329"],
    });
    // The browser its browser tool works in is asked for when the product starts, where the
    // desk names it, and by its name alone (ADR-0140).
    const bare = { cwd: "/d", env: {}, model: null, effort: null, resume: undefined };
    expect(claudeArguments({ ...bare, browser: "chrome" })).toContain("--chrome");
    expect(claudeArguments(bare)).not.toContain("--chrome");
    expect(claudeArguments({ ...bare, browser: "--dangerously-anything" })).not.toContain(
      "--dangerously-anything",
    );
  });

  it("starts the product with the program that drives a headless Chrome as a server of its own, where the desk names that browser (ADR-0149)", () => {
    const bare = { cwd: "/d", env: {}, model: "opus", effort: null, resume: undefined };
    const serversOf = (args: readonly string[]): unknown =>
      JSON.parse(args[args.indexOf("--mcp-config") + 1] ?? "null");
    const headless = claudeArguments({ ...bare, browser: "headless" }, "darwin");
    expect(serversOf(headless)).toEqual({
      mcpServers: {
        "chrome-devtools": {
          command: "chrome-devtools-mcp",
          args: ["--headless", "--no-usage-statistics", "--no-performance-crux"],
        },
      },
    });
    // The product's own browser tool is not asked for beside it, and the option that takes
    // the server is followed by an option: it takes whatever stands after it up to the next.
    expect(headless).not.toContain("--chrome");
    expect(headless[headless.indexOf("--mcp-config") + 2]).toBe("--model");
    // The mode is what it is without a browser: the server's tools are leave for nothing.
    expect(headless.filter((word) => /allow/i.test(word))).toEqual([]);
    expect(headless[headless.indexOf("--permission-mode") + 1]).toBe("auto");
    // On Windows the program is a script, started through the system's own interpreter.
    expect(serversOf(claudeArguments({ ...bare, browser: "headless" }, "win32"))).toMatchObject({
      mcpServers: {
        "chrome-devtools": {
          command: "cmd",
          args: [
            "/c",
            "chrome-devtools-mcp",
            "--headless",
            "--no-usage-statistics",
            "--no-performance-crux",
          ],
        },
      },
    });
    // A desk that names the product's own tool, or none, is started with no server, and one
    // that names none with neither.
    expect(claudeArguments({ ...bare, browser: "chrome" }, "darwin")).not.toContain("--mcp-config");
    const none = claudeArguments({ ...bare, browser: "none" }, "darwin");
    expect(none).not.toContain("--mcp-config");
    expect(none).not.toContain("--chrome");
    expect(none).toEqual(claudeArguments(bare, "darwin"));
    // The driver starts the product for the system its host says it is on.
    const fake = fakeChild();
    const spawned: (readonly string[])[] = [];
    const driver = createClaudeDriver({
      cwd: "/d",
      platform: "win32",
      spawn: (_command, args) => {
        spawned.push(args);
        return fake.child;
      },
    });
    driver.start({ ...bare, browser: "headless" });
    expect(serversOf(spawned[0] ?? [])).toMatchObject({
      mcpServers: { "chrome-devtools": { command: "cmd" } },
    });
  });

  it("sends a message as one line under an id of its own, with its pictures as image blocks and the product's own priority", async () => {
    const { session, sent } = started();
    await session.send({
      text: "[console k3f9a2 #1 · tell · Jane · 14:02]\nLook at this.",
      images: [{ name: "shot.png", contentType: "image/png", bytes: Uint8Array.from([1, 2, 3]) }],
      priority: "next",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("\n");
    expect(JSON.parse(sent[0] ?? "")).toEqual({
      type: "user",
      uuid: "m1",
      message: {
        role: "user",
        content: [
          { type: "text", text: "[console k3f9a2 #1 · tell · Jane · 14:02]\nLook at this." },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
        ],
      },
      parent_tool_use_id: null,
      priority: "next",
    });
    // A message to be read now stops what is under way first, the tool call in it too: the
    // product's own request for it, and then the message.
    await session.send(message("Stop that.", "now"));
    expect(sent.slice(1).map((line) => JSON.parse(line))).toEqual([
      { type: "control_request", request_id: "m3", request: { subtype: "interrupt" } },
      {
        type: "user",
        uuid: "m2",
        message: { role: "user", content: [{ type: "text", text: "Stop that." }] },
        parent_tool_use_id: null,
        priority: "now",
      },
    ]);
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
    says(taken("0199c4d8-0000-7000-8000-00000000a001", "Hold the release."));
    // Lines that are the product's own business: what its commands are, how much of its
    // allowance is left, a task of a shell begun and ended, what became of a message.
    says({ type: "system", subtype: "commands_changed", commands: [{ name: "review" }] });
    says({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } });
    says({ type: "system", subtype: "task_started", task_id: "b1", tool_use_id: "toolu_01" });
    says({ type: "system", subtype: "task_notification", task_id: "b1", status: "completed" });
    says(became("0199c4d8-0000-7000-8000-00000000a001", "started"));
    says({ type: "control_response", response: { subtype: "success", request_id: "r1" } });
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
      ...STARTED,
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

  it("writes no event of a thought with no words, a sub-agent's included", async () => {
    // As a run under the runner had it: most thinking blocks carried a signature and no text,
    // and each was an event counted against what an hour of a session takes.
    const { session, says, exits } = started();
    says({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "", signature: "c2lnbmVkLWludmVudGVk" },
          { type: "thinking", thinking: " \n\t ", signature: "c2lnbmVkLWludmVudGVk" },
          { type: "thinking", thinking: "The tests first." },
          {
            type: "tool_use",
            id: "toolu_a1",
            name: "Agent",
            input: { subagent_type: "Explore", description: "Read src/ of acme/web" },
          },
        ],
      },
      parent_tool_use_id: null,
    });
    says({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "", signature: "c2lnbmVkLWludmVudGVk" },
          { type: "text", text: "Looking." },
        ],
      },
      parent_tool_use_id: "toolu_a1",
    });
    exits(0);
    const events = (await collect(session.events)).filter((event) => event.type === "event");
    expect(events.map((event) => [event.kind, event.text])).toEqual([
      ["thinking", "The tests first."],
      ["tool_call", expect.stringContaining("Read src/ of acme/web")],
      ["assistant", "Looking."],
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

  it("cuts what it shows of a tool's input with what it was handed to cut with, and never by itself first", async () => {
    // What the runner hands a session takes the account's secrets out before it cuts: the
    // driver hands it the input whole, a megabyte of it too, with the length it shows.
    const asked: { length: number; most: number }[] = [];
    const { session, says, exits } = started({
      cut: (text, most) => {
        asked.push({ length: text.length, most });
        return `[cut to ${most} of ${text.length}]`;
      },
    });
    says({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_01",
            name: "Write",
            input: { text: "x".repeat(1_000_000) },
          },
          // A command reads as a line, whole: the runner takes its secrets out and bounds it.
          { type: "tool_use", id: "toolu_02", name: "Bash", input: { command: "git status" } },
        ],
      },
    });
    says({
      type: "system",
      subtype: "permission_denied",
      tool_name: "Write",
      tool_use_id: "toolu_03",
      tool_input: { text: "y".repeat(9000), more: [1, 2, 3], and: "more", than: "three" },
    });
    exits(0);
    const events = await collect(session.events);
    expect(events[0]).toMatchObject({ kind: "tool_call", text: "[cut to 4000 of 1000011]" });
    expect(events[1]).toMatchObject({ kind: "tool_call", text: "git status" });
    expect((events[2] as { text: string }).text).toMatch(
      /^Denied, with nobody at the terminal to ask: Write \[cut to 4000 of \d+\]$/,
    );
    expect(asked.map((one) => one.most)).toEqual([4000, 4000]);
  });

  it("says which sub-agent a line is of, by the call that started it, and nothing for a line of the session's own", async () => {
    // As the product's documentation has a sub-agent's lines: each names the tool call that
    // started the sub-agent (`parent_tool_use_id`). Not seen run by this driver's fixtures.
    const { session, says, exits } = started();
    says(INIT);
    says({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Two of them, side by side." },
          {
            type: "tool_use",
            id: "toolu_a1",
            name: "Agent",
            input: { subagent_type: "Explore", description: "Find the routes", prompt: "Look." },
          },
          {
            type: "tool_use",
            id: "toolu_a2",
            name: "Task",
            input: { description: "Read the spec", prompt: "Read." },
          },
        ],
      },
      parent_tool_use_id: null,
    });
    // What the first sub-agent thinks, says and calls, and what its tool answered.
    says({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "Where are they?" },
          { type: "text", text: "Looking in the routes." },
          { type: "tool_use", id: "toolu_s1", name: "Bash", input: { command: "ls src" } },
        ],
      },
      parent_tool_use_id: "toolu_a1",
    });
    says({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_s1", content: "rest.ts" }] },
      parent_tool_use_id: "toolu_a1",
    });
    // The second, whose call named no kind: called by what it is for.
    says({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "toolu_s2", name: "Read", input: { file_path: "a.md" } }],
      },
      parent_tool_use_id: "toolu_a2",
    });
    // A line that names a call the driver never read still says whose it is, by the id alone.
    says({
      type: "assistant",
      message: { content: [{ type: "text", text: "From elsewhere." }] },
      parent_tool_use_id: "toolu_unknown",
    });
    // What came back to the session itself from the first call: the session's own.
    says({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_a1", content: "Found." }] },
      parent_tool_use_id: null,
    });
    says(says1("Done with both."));
    exits(0);
    const events = (await collect(session.events)).filter((event) => event.type === "event");
    expect(events.slice(1).map((event) => [event.kind, event.text, event.data])).toEqual([
      ["assistant", "Two of them, side by side.", undefined],
      // The call that starts a sub-agent says so, with what it calls it.
      [
        "tool_call",
        expect.stringContaining("Find the routes"),
        { tool: "Agent", id: "toolu_a1", starts: "Explore: Find the routes" },
      ],
      [
        "tool_call",
        expect.stringContaining("Read the spec"),
        { tool: "Task", id: "toolu_a2", starts: "Read the spec" },
      ],
      ["thinking", "Where are they?", { parent: "toolu_a1", subagent: "Explore: Find the routes" }],
      [
        "assistant",
        "Looking in the routes.",
        { parent: "toolu_a1", subagent: "Explore: Find the routes" },
      ],
      [
        "tool_call",
        "ls src",
        { tool: "Bash", id: "toolu_s1", parent: "toolu_a1", subagent: "Explore: Find the routes" },
      ],
      [
        "tool_result",
        "rest.ts",
        { id: "toolu_s1", error: false, parent: "toolu_a1", subagent: "Explore: Find the routes" },
      ],
      [
        "tool_call",
        "a.md",
        { tool: "Read", id: "toolu_s2", parent: "toolu_a2", subagent: "Read the spec" },
      ],
      ["assistant", "From elsewhere.", { parent: "toolu_unknown" }],
      ["tool_result", "Found.", { id: "toolu_a1", error: false }],
      ["assistant", "Done with both.", undefined],
    ]);
  });

  it("tells two sub-agents of one kind apart by what each was started for", async () => {
    // Two calls of one kind at once, as a run of the product under the runner made them.
    const { session, says, exits } = started();
    says({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_e1",
            name: "Agent",
            input: {
              description: "Read src/ of acme/web",
              subagent_type: "Explore",
              prompt: "List what src/ holds.",
            },
          },
          {
            type: "tool_use",
            id: "toolu_e2",
            name: "Agent",
            input: {
              description: "Read test/ of acme/web",
              subagent_type: "Explore",
              prompt: "List what test/ holds.",
            },
          },
          // A kind and what it is for of any length: the two within the bound, the kind first.
          {
            type: "tool_use",
            id: "toolu_e3",
            name: "Agent",
            input: { subagent_type: "Explore", description: `Read ${"d".repeat(200)}` },
          },
          // A kind on a tool of another name, with no word of what it is for: the kind alone.
          { type: "tool_use", id: "toolu_e4", name: "Spawn", input: { subagent_type: "Plan" } },
        ],
      },
    });
    for (const parent of ["toolu_e1", "toolu_e2", "toolu_e3", "toolu_e4"]) {
      says({
        type: "assistant",
        message: { content: [{ type: "text", text: "A line." }] },
        parent_tool_use_id: parent,
      });
    }
    exits(0);
    const events = (await collect(session.events)).filter((event) => event.type === "event");
    expect(events.slice(4).map((event) => event.data?.subagent)).toEqual([
      "Explore: Read src/ of acme/web",
      "Explore: Read test/ of acme/web",
      `Explore: Read ${"d".repeat(65)}${String.fromCodePoint(0x2026)}`,
      "Plan",
    ]);
    // What it was started for is cut with the kind, after the secrets are out of the two: a
    // value that crosses the bound is not shown in part.
    const SECRET = "not-a-real-token-4f9a2c71";
    const redact = redactorOf([SECRET]);
    const cutting = started({ cut: (text, most, more) => cutShown(redact, text, most, more) });
    cutting.says({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_e5",
            name: "Agent",
            input: { subagent_type: "Explore", description: `${"d".repeat(60)} ${SECRET}` },
          },
        ],
      },
    });
    cutting.says({
      type: "assistant",
      message: { content: [{ type: "text", text: "A line." }] },
      parent_tool_use_id: "toolu_e5",
    });
    cutting.exits(0);
    const cut = (await collect(cutting.session.events)).filter((event) => event.type === "event");
    expect(cut[1]?.data?.subagent).toBe(
      `${`Explore: ${"d".repeat(60)} ${WITHHELD}`.slice(0, 79)}${String.fromCodePoint(0x2026)}`,
    );
  });

  it("reads who a line is of as data: a name of any length is bounded, and what is no id names nobody", async () => {
    const { session, says, exits } = started();
    says({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_a1",
            name: "Agent",
            input: { subagent_type: `  ${"k".repeat(5000)}  `, description: 7 },
          },
          // A kind that is no word, on a tool that starts no sub-agent: none is remembered.
          { type: "tool_use", id: "toolu_b1", name: "Bash", input: { subagent_type: 42 } },
          // A tool that starts one and says nothing of it: called as the tool is.
          { type: "tool_use", id: "toolu_a3", name: "Agent", input: null },
        ],
      },
    });
    for (const parent of ["toolu_a1", "toolu_b1", "toolu_a3", "", 42, { id: "x" }, ["toolu_a1"]]) {
      says({
        type: "assistant",
        message: { content: [{ type: "text", text: "A line." }] },
        parent_tool_use_id: parent,
      });
    }
    exits(0);
    const events = (await collect(session.events)).filter((event) => event.type === "event");
    expect(events.slice(3).map((event) => event.data)).toEqual([
      { parent: "toolu_a1", subagent: `${"k".repeat(79)}${String.fromCodePoint(0x2026)}` },
      { parent: "toolu_b1" },
      { parent: "toolu_a3", subagent: "Agent" },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // A call says that it starts a sub-agent in the same bounded name, before anything of the
    // sub-agent arrives; a call that starts none says nothing of the kind.
    expect(events.slice(0, 3).map((event) => event.data?.starts)).toEqual([
      `${"k".repeat(79)}${String.fromCodePoint(0x2026)}`,
      undefined,
      "Agent",
    ]);
  });

  it("cuts what a sub-agent is called, and the end of what the product wrote on its standard error, after the secrets are out", async () => {
    // The runner's own cuts, over a store of one value: a value that crosses the bound is not
    // shown in part, at the end of a name or at the head of what was printed last.
    const mark = String.fromCodePoint(0x2026);
    const SECRET = "not-a-real-token-4f9a2c71";
    const redact = redactorOf([SECRET]);
    const runnerCuts = {
      cut: (text: string, most: number, more?: boolean) => cutShown(redact, text, most, more),
      cutEnd: (text: string, most: number, more?: boolean) => cutShownEnd(redact, text, most, more),
    };
    const named = started(runnerCuts);
    named.says({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_a1",
            name: "Agent",
            // The value begins at the 71st character and runs past the 80th.
            input: { subagent_type: `${"k".repeat(70)}${SECRET}`, prompt: "Look." },
          },
        ],
      },
    });
    named.says({
      type: "assistant",
      message: { content: [{ type: "text", text: "A line." }] },
      parent_tool_use_id: "toolu_a1",
    });
    named.exits(0);
    const lines = (await collect(named.session.events)).filter((event) => event.type === "event");
    const subagent = lines[1]?.data?.subagent;
    expect(subagent).toBe(`${`${"k".repeat(70)}${WITHHELD}`.slice(0, 79)}${mark}`);
    expect(String(subagent)).not.toContain(SECRET.slice(0, 1));

    // What it printed last, 4,000 characters of it shown, with a value across the cut.
    const crashed = started(runnerCuts);
    crashed.says(INIT);
    crashed.writes(`a stack trace ${SECRET}${"t".repeat(3990)}\n`);
    crashed.exits(1);
    const ended = (await collect(crashed.session.events)).find(
      (event) => event.type === "event" && event.kind === "error",
    );
    const text = ended?.type === "event" ? ended.text : "";
    expect(text).toBe(
      `The product's process ended with code 1.\n${mark}${`${WITHHELD}${"t".repeat(3990)}`.slice(-4000)}`,
    );
    for (let length = 1; length < SECRET.length; length += 1) {
      expect(text.includes(`${SECRET.slice(-length)}t`), `${length}`).toBe(false);
    }
    // What the process kept the end of begins with the mark of a cut, and may begin inside a
    // value: nothing of that value's end is shown, however little was printed after it.
    const kept = started(runnerCuts);
    kept.says(INIT);
    kept.writes(`${mark}${SECRET.slice(-9)} ${"m".repeat(100)} out of memory\n`);
    kept.exits(1);
    const said = (await collect(kept.session.events)).find(
      (event) => event.type === "event" && event.kind === "error",
    );
    const keptText = said?.type === "event" ? said.text : "";
    expect(keptText).toMatch(/^The product's process ended with code 1\.\n…m+ out of memory$/);
    expect(keptText).not.toContain(SECRET.slice(-4));
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
        // A command that is not there is said as that, with where it is looked for.
        text: "The product could not be started: its command claude was not found where the runner looks for programs. Install it, or put its folder on the PATH the runner is started with.",
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

  it("stops a turn with the product's own request for it, and the process by closing its input", async () => {
    const { session, sent, killed, says, exits } = started();
    says(INIT);
    await session.send(message("Run the tests."));
    says(taken("m1", "Run the tests."));
    await session.interrupt();
    expect(JSON.parse(sent[1] ?? "")).toEqual({
      type: "control_request",
      request_id: "m2",
      request: { subtype: "interrupt" },
    });
    // How the product ends a turn that was stopped: the tool call given up, and a result that
    // calls itself an error. It is what was asked for: a status, and the agent waits for more.
    says({ type: "control_response", response: { subtype: "success", request_id: "m2" } });
    says({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01",
            is_error: true,
            content: "The user doesn't want to proceed with this tool use.",
          },
        ],
      },
    });
    says({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "[Request interrupted by user for tool use]" }],
      },
    });
    says({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      stop_reason: "tool_use",
      terminal_reason: "aborted_tools",
      errors: ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"],
      permission_denials: [],
    });
    const stopping = session.stop();
    // Asked first: the input closes, and a process that ends by itself is not made to.
    exits(0);
    await stopping;
    expect(killed).toEqual([]);
    expect((await collect(session.events)).slice(3)).toEqual([
      { type: "taken" },
      {
        type: "event",
        kind: "tool_result",
        text: "The user doesn't want to proceed with this tool use.",
        data: { id: "toolu_01", error: true },
        pictures: [],
      },
      { type: "event", kind: "status", text: "The turn was stopped." },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);
  });

  it("says once how the product runs, though the product says it at every turn, and again when it changes", async () => {
    const { session, says, exits } = started();
    says(INIT);
    says(says1("ready"));
    says({ ...RESULT, result: "ready" });
    // The second turn begins as the first did: nothing new, and nothing said.
    says({ ...INIT, uuid: "0199c4d8-0000-7000-8000-00000000e002" });
    says(says1("again"));
    says({ ...RESULT, result: "again" });
    // Another model answers the third: said, since it is what the agent runs with now.
    says({ ...INIT, model: "claude-opus-5-5" });
    says(RESULT);
    exits(0);
    expect(await collect(session.events)).toEqual([
      ...STARTED,
      { type: "event", kind: "assistant", text: "ready" },
      { type: "turn_completed" },
      { type: "event", kind: "assistant", text: "again" },
      { type: "turn_completed" },
      { type: "running", model: "claude-opus-5-5", effort: null, version: "2.1.321" },
      {
        type: "event",
        kind: "status",
        text: "The product goes on with another model, or in another permission mode.",
        data: { model: "claude-opus-5-5", effort: null, version: "2.1.321", mode: "auto" },
      },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);
  });

  it("says the mode the product started in where it is not the one asked for", async () => {
    // Asked for `auto`, where nothing names another: a product that starts in its manual mode
    // says so, by the word it has for it.
    const manual = started();
    manual.says({ ...INIT, permissionMode: "default" });
    manual.exits(0);
    expect((await collect(manual.session.events))[2]).toEqual({
      type: "event",
      kind: "status",
      text: "The product started, in the permission mode default and not in auto, which it was asked for.",
      data: { model: "claude-sonnet-5-5", effort: null, version: "2.1.321", mode: "default" },
    });
    // The mode that asks has two words, one the product takes and one it says: the same mode.
    const asked = started({ permissions: "manual" });
    asked.says({ ...INIT, permissionMode: "default" });
    asked.exits(0);
    expect((await collect(asked.session.events))[2]).toMatchObject({
      text: "The product started.",
    });
    // A build that says an effort is read for it.
    const older = started();
    older.says({ ...INIT, effort: "high", permissionMode: undefined });
    older.exits(0);
    expect((await collect(older.session.events)).slice(0, 3)).toEqual([
      { type: "running", model: "claude-sonnet-5-5", effort: "high", version: "2.1.321" },
      { type: "conversation", id: CONVERSATION },
      {
        type: "event",
        kind: "status",
        text: "The product started.",
        data: { model: "claude-sonnet-5-5", effort: "high", version: "2.1.321", mode: null },
      },
    ]);
  });

  it("says a turn completed when nothing it was sent still waits: a message read in the turn, after it, or in its place", async () => {
    // A message written while a tool call is under way is read when the call finishes, in the
    // same turn: two messages, and one turn.
    const within = started();
    within.says(INIT);
    await within.session.send(message("Run the tests."));
    within.says(taken("m1", "Run the tests."));
    await within.session.send(message("And say which failed."));
    within.says(taken("m2", "And say which failed."));
    within.says(says1("Two failed."));
    within.says(RESULT);
    within.exits(0);
    // Each is said taken where the product says it back: there the record has it.
    expect((await collect(within.session.events)).slice(3)).toEqual([
      { type: "taken" },
      { type: "taken" },
      { type: "event", kind: "assistant", text: "Two failed." },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);

    // A message written as a turn was ending starts a turn of its own: the first result is not
    // the agent done, and the second is.
    const after = started();
    await after.session.send(message("One."));
    await after.session.send(message("Two."));
    after.says(INIT);
    after.says(taken("m1", "One."));
    after.says(says1("one"));
    after.says(RESULT);
    after.says(became("m1", "completed"));
    after.says(INIT);
    after.says(taken("m2", "Two."));
    after.says(says1("two"));
    after.says(RESULT);
    after.exits(0);
    expect((await collect(after.session.events)).slice(3)).toEqual([
      { type: "taken" },
      { type: "event", kind: "assistant", text: "one" },
      { type: "taken" },
      { type: "event", kind: "assistant", text: "two" },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);

    // A turn stopped for a message: its result is no error and no end, and the message's turn follows.
    const instead = started();
    instead.says(INIT);
    await instead.session.send(message("Run the tests."));
    instead.says(taken("m1", "Run the tests."));
    await instead.session.send(message("Stop that.", "now"));
    instead.says({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      stop_reason: "tool_use",
      terminal_reason: "aborted_tools",
      permission_denials: [],
    });
    instead.says(became("m1", "cancelled"));
    instead.says(INIT);
    instead.says(taken("m2", "Stop that."));
    instead.says(says1("halted"));
    instead.says(RESULT);
    instead.exits(0);
    expect((await collect(instead.session.events)).slice(3)).toEqual([
      { type: "taken" },
      { type: "event", kind: "status", text: "The turn was stopped for a message." },
      { type: "taken" },
      { type: "event", kind: "assistant", text: "halted" },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);
  });

  it("waits for no message the product is done with or says nothing of", async () => {
    // A message the product says it will not take is not waited for, said back or not.
    const dropped = started();
    dropped.says(INIT);
    await dropped.session.send(message("One."));
    dropped.says(taken("m1", "One."));
    await dropped.session.send(message("Two."));
    dropped.says(became("m2", "cancelled"));
    dropped.says(RESULT);
    dropped.exits(0);
    // One it will not take is never said taken.
    expect((await collect(dropped.session.events)).slice(3)).toEqual([
      { type: "taken" },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);

    // A build that says no message back is read without: every result ends a turn.
    const silent = started();
    silent.says(INIT);
    await silent.session.send(message("One."));
    await silent.session.send(message("Two."));
    silent.says(RESULT);
    silent.says(RESULT);
    silent.exits(0);
    // What it was sent is taken by the time a turn ends, for all the driver can know.
    expect((await collect(silent.session.events)).slice(3)).toEqual([
      { type: "taken" },
      { type: "taken" },
      { type: "turn_completed" },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);

    // Someone else's line that calls itself a message taken is nobody's the driver wrote.
    const forged = started();
    forged.says(INIT);
    await forged.session.send(message("One."));
    forged.says(taken("not-the-drivers", "One."));
    forged.says(RESULT);
    forged.exits(0);
    expect((await collect(forged.session.events)).slice(3)).toEqual([
      { type: "taken" },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);
  });

  it("says a denial once: when it happens, and not again with the turn's result", async () => {
    const { session, says, exits } = started({ permissions: "dontAsk" });
    says({ ...INIT, permissionMode: "dontAsk" });
    says({
      type: "system",
      subtype: "permission_denied",
      tool_name: "Write",
      tool_use_id: "toolu_01",
      decision_reason_type: "mode",
      message: "Permission to use Write has been denied.",
    });
    says({
      ...RESULT,
      permission_denials: [
        {
          tool_name: "Write",
          tool_use_id: "toolu_01",
          tool_input: { file_path: "/home/mira/desk/note.txt", content: "hello" },
        },
        // One the product said nothing of before is said here.
        { tool_name: "Bash", tool_use_id: "toolu_02", tool_input: { command: "sudo true" } },
      ],
    });
    exits(0);
    expect((await collect(session.events)).slice(3)).toEqual([
      {
        type: "event",
        kind: "permission",
        text: "Denied, with nobody at the terminal to ask: Write",
        data: { tool: "Write", answer: "denied", id: "toolu_01" },
      },
      {
        type: "event",
        kind: "permission",
        text: "Denied, with nobody at the terminal to ask: Bash sudo true",
        data: { tool: "Bash", answer: "denied", id: "toolu_02" },
      },
      { type: "turn_completed" },
      { type: "ended", how: "exited" },
    ]);
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

  it("keeps the end of what a process wrote on its standard error, and says where its beginning was let go", async () => {
    const spawn = createSpawn({});
    const wrote = (script: string) =>
      spawn(process.execPath, ["-e", script], { cwd: process.cwd(), env: {} });
    const long = wrote(
      'process.stderr.write("b".repeat(20000));process.stderr.write("e".repeat(100)+"END");',
    );
    for await (const _ of long.lines) {
      // Nothing is printed on its standard output.
    }
    await long.exited;
    const kept = long.errors();
    expect(kept.startsWith(`${String.fromCodePoint(0x2026)}b`)).toBe(true);
    expect(kept.endsWith(`${"e".repeat(100)}END`)).toBe(true);
    expect(kept.length).toBe(16_001);
    const short = wrote('process.stderr.write("only this");');
    for await (const _ of short.lines) {
      // Nothing is printed on its standard output.
    }
    await short.exited;
    expect(short.errors()).toBe("only this");
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
