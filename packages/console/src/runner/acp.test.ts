import { describe, expect, it } from "vitest";
import { acpMode, createAcpDriver } from "./acp.js";
import { parseRunnerConfig } from "./config.js";
import { ownRunnerModules } from "./modules.js";
import type { Child, DriverEvent, DriverSession, StartOptions } from "./types.js";

// The `acp` driver against an agent that is not there: a child whose answers the test writes, in
// the shapes the protocol's documentation gives (version 1), with every id invented.

type Json = Record<string, unknown>;

/** An agent the test speaks for: what it was started with, what it was sent, and how it answers. */
function fakeAgent(
  answers: (message: Json, agent: { says(...lines: Json[]): void }) => void,
  started: { command: string; args: readonly string[]; cwd: string } = {
    command: "",
    args: [],
    cwd: "",
  },
) {
  const sent: Json[] = [];
  const killed: string[] = [];
  const queue: (string | undefined)[] = [];
  let waiting: (() => void) | undefined;
  let exit: (how: { code: number | null; signal: string | null; error?: string }) => void = () =>
    undefined;
  let ended = false;
  let gone = false;
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
  const says = (...lines: Json[]) => {
    for (const line of lines) {
      push(JSON.stringify({ jsonrpc: "2.0", ...line }));
    }
  };
  const exits = (code: number | null, signal: string | null = null, error?: string) => {
    if (gone) {
      return;
    }
    gone = true;
    push(undefined);
    exit({ code, signal, ...(error === undefined ? {} : { error }) });
  };
  const child: Child = {
    write: async (line) => {
      const message = JSON.parse(line) as Json;
      sent.push(message);
      answers(message, { says });
    },
    // An agent whose input closes ends, as a well-behaved one does.
    end: () => {
      ended = true;
      exits(0);
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
      exits(null, signal);
    },
    exited,
  };
  return {
    child,
    started,
    sent,
    killed,
    says,
    exits,
    writes: (text: string) => {
      stderr = text;
    },
    get ended() {
      return ended;
    },
    /** The requests and notifications sent under a method, in order. */
    of: (method: string) => sent.filter((message) => message.method === method),
  };
}

const INITIALIZED = {
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    promptCapabilities: { image: true },
  },
  agentInfo: { name: "lathe", title: "Lathe", version: "2.3.1" },
  authMethods: [],
};
const CONFIG = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "lathe-small",
    options: [
      { value: "lathe-small", name: "Small" },
      { value: "lathe-large", name: "Large" },
    ],
  },
  {
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "low",
    options: [
      {
        group: "levels",
        name: "Levels",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
    ],
  },
];
const update = (sessionUpdate: string, more: Json): Json => ({
  method: "session/update",
  params: { sessionId: "sess-1", update: { sessionUpdate, ...more } },
});
const text = (words: string): Json => ({ type: "text", text: words });

/** An agent that opens a session and answers a prompt as the test says. */
function agentThat(
  over: {
    initialized?: Json;
    opened?: Json;
    prompt?: (message: Json, agent: { says(...lines: Json[]): void }) => void;
    other?: (message: Json, agent: { says(...lines: Json[]): void }) => boolean;
  } = {},
) {
  /** What was chosen in this session, by the choice's id. */
  const chosen = new Map<string, string>();
  return fakeAgent((message, agent) => {
    if (over.other?.(message, agent) === true) {
      return;
    }
    switch (message.method) {
      case "initialize":
        agent.says({ id: message.id, result: over.initialized ?? INITIALIZED });
        return;
      case "session/new":
        agent.says({
          id: message.id,
          result: over.opened ?? { sessionId: "sess-1", configOptions: CONFIG },
        });
        return;
      case "session/set_config_option": {
        const params = message.params as { configId: string; value: string };
        chosen.set(params.configId, params.value);
        agent.says({
          id: message.id,
          result: {
            // The whole list as it stands now, as the protocol has an agent answer.
            configOptions: CONFIG.map((option) => ({
              ...option,
              currentValue: chosen.get(option.id) ?? option.currentValue,
            })),
          },
        });
        return;
      }
      case "session/prompt":
        if (over.prompt === undefined) {
          agent.says({ id: message.id, result: { stopReason: "end_turn" } });
        } else {
          over.prompt(message, agent);
        }
        return;
      default:
        return;
    }
  });
}

const OPTIONS: StartOptions = {
  cwd: "/home/mira/desk",
  env: {},
  model: null,
  effort: null,
  resume: undefined,
};

function driverFor(agent: ReturnType<typeof fakeAgent>) {
  return createAcpDriver({
    spawn: (command, args, options) => {
      agent.started.command = command;
      agent.started.args = args;
      agent.started.cwd = options.cwd;
      return agent.child;
    },
    cwd: "/home/mira/desk",
    command: "lathe",
    args: ["--acp"],
  });
}

/** What a session says, read until one of a kind comes, or it ends. */
async function until(
  session: DriverSession,
  seen: DriverEvent[],
  stop: (event: DriverEvent) => boolean,
): Promise<DriverEvent[]> {
  const reader = session.events[Symbol.asyncIterator]();
  for (;;) {
    const next = await reader.next();
    if (next.done === true) {
      return seen;
    }
    seen.push(next.value);
    if (stop(next.value)) {
      return seen;
    }
  }
}
const isType = (type: DriverEvent["type"]) => (event: DriverEvent) => event.type === type;
const message = (words: string, priority: "now" | "next" = "next") => ({
  text: words,
  images: [],
  priority,
});

describe("the acp driver", () => {
  it("is the package's driver for whichever product speaks the protocol, started with the command the desk names", () => {
    const modules = ownRunnerModules({ user: "mira" });
    expect(modules.drivers.names()).toEqual(["acp", "claude", "codex"]);
    const driver = driverFor(agentThat());
    expect(driver.name).toBe("acp");
    // A message waits for the turn or stops it; the rest is the agent's to offer.
    expect(driver.can).toEqual({ steer: false, images: true, resume: true, set: true });
    expect(driver.permissions).toEqual({
      modes: ["allow", "deny"],
      unattended: "allow",
      least: "deny",
    });
    expect([acpMode(undefined), acpMode("allow"), acpMode("deny"), acpMode("yolo")]).toEqual([
      "allow",
      "allow",
      "deny",
      "deny",
    ]);
    // The desk names the command and its words; a file that names too much is refused whole.
    expect(
      parseRunnerConfig('{"driver":"acp","product":{"command":"lathe","args":["--acp"]}}'),
    ).toMatchObject({
      ok: true,
      config: { driver: "acp", product: { command: "lathe", args: ["--acp"] } },
    });
    expect(parseRunnerConfig('{"product":{"command":"lathe"}}')).toMatchObject({
      ok: true,
      config: { product: { command: "lathe", args: [] } },
    });
    expect(parseRunnerConfig('{"product":{"command":""}}').ok).toBe(false);
    expect(parseRunnerConfig('{"product":{"args":["x"]}}').ok).toBe(false);
  });

  it("opens a session as the protocol's client, with no file and no terminal of its own, and says what runs", async () => {
    const agent = agentThat();
    const session = driverFor(agent).start(OPTIONS);
    const seen = await until(session, [], isType("running"));
    expect(agent.started).toEqual({ command: "lathe", args: ["--acp"], cwd: "/home/mira/desk" });
    expect(agent.sent[0]).toEqual({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "skillcdn-console-runner", title: "SkillCDN Console runner" },
      },
    });
    expect(agent.sent[1]).toMatchObject({
      method: "session/new",
      params: { cwd: "/home/mira/desk", mcpServers: [] },
    });
    expect(seen).toEqual([
      { type: "conversation", id: "sess-1" },
      { type: "running", model: "lathe-small", effort: "low", version: "2.3.1" },
    ]);
    await session.stop();
    expect(agent.ended).toBe(true);
    expect(await until(session, [], isType("ended"))).toEqual([{ type: "ended", how: "exited" }]);
  });

  it("starts with the model and the effort chosen for it, where the agent offers them, and takes another in a running session", async () => {
    const agent = agentThat();
    const session = driverFor(agent).start({ ...OPTIONS, model: "lathe-large", effort: "high" });
    const seen = await until(session, [], isType("running"));
    expect(agent.of("session/set_config_option").map((one) => one.params)).toEqual([
      { sessionId: "sess-1", configId: "model", value: "lathe-large" },
      { sessionId: "sess-1", configId: "thinking", value: "high" },
    ]);
    expect(seen.at(-1)).toEqual({
      type: "running",
      model: "lathe-large",
      effort: "high",
      version: "2.3.1",
    });
    // In a running session: what it offers is taken, what it does not is said not to be.
    expect(await session.set({ model: "lathe-small" })).toBe(true);
    expect(await session.set({ effort: "high" })).toBe(true);
    expect(await session.set({ model: "another" })).toBe(false);
    expect(agent.of("session/set_config_option")).toHaveLength(3);
    await session.stop();
  });

  it("reads a turn as whole blocks: what the agent says and thinks in pieces, a tool call and what came back, a plan", async () => {
    const png = Buffer.from("a picture").toString("base64");
    const agent = agentThat({
      prompt: (asked, one) => {
        one.says(
          update("user_message_chunk", { content: text("said back") }),
          update("agent_thought_chunk", { content: text("Let me ") }),
          update("agent_thought_chunk", { content: text("look.") }),
          update("agent_message_chunk", { content: text("I will ") }),
          update("agent_message_chunk", { content: text("list the desk.") }),
          update("plan", {
            entries: [
              { content: "List the desk", priority: "high", status: "in_progress" },
              { content: "Report", priority: "low", status: "pending" },
            ],
          }),
          update("tool_call", {
            toolCallId: "call-1",
            title: "List files",
            kind: "execute",
            status: "pending",
            rawInput: { command: "ls -la" },
          }),
          update("tool_call_update", { toolCallId: "call-1", status: "in_progress" }),
          update("tool_call_update", {
            toolCallId: "call-1",
            status: "completed",
            content: [
              { type: "content", content: text("README.md\nwork") },
              { type: "content", content: { type: "image", mimeType: "image/png", data: png } },
              { type: "diff", path: "/home/mira/desk/notes.md", oldText: null, newText: "x" },
            ],
          }),
          // Said again by an agent that repeats itself: the end of a call is said once.
          update("tool_call_update", { toolCallId: "call-1", status: "completed" }),
          update("usage_update", { used: 10, size: 100 }),
          update("agent_message_chunk", { content: text("Done.") }),
          { id: asked.id, result: { stopReason: "end_turn" } },
        );
      },
    });
    const session = driverFor(agent).start(OPTIONS);
    await session.send(message("[#1] What is in the desk?"));
    const seen = await until(session, [], isType("turn_completed"));
    expect(agent.of("session/prompt").map((one) => one.params)).toEqual([
      { sessionId: "sess-1", prompt: [{ type: "text", text: "[#1] What is in the desk?" }] },
    ]);
    expect(seen.slice(2)).toEqual([
      { type: "event", kind: "thinking", text: "Let me look." },
      { type: "event", kind: "assistant", text: "I will list the desk." },
      {
        type: "event",
        kind: "status",
        text: "Plan:\n- [in_progress] List the desk\n- [pending] Report",
      },
      {
        type: "event",
        kind: "tool_call",
        text: "List files\nls -la",
        data: { tool: "execute", id: "call-1" },
      },
      {
        type: "event",
        kind: "tool_result",
        text: "README.md\nwork\nWrote /home/mira/desk/notes.md",
        data: { id: "call-1", error: false },
        pictures: [
          { name: "tool-1-1.png", contentType: "image/png", bytes: Buffer.from("a picture") },
        ],
      },
      { type: "event", kind: "assistant", text: "Done." },
      { type: "turn_completed" },
    ]);
    await session.stop();
  });

  it("answers what the agent asks leave for, since nobody is at a terminal: allowed once, or refused where the desk says so", async () => {
    const asking = (ids: { allow: string; reject: string } | undefined) =>
      agentThat({
        prompt: (asked, one) => {
          one.says(
            update("tool_call", { toolCallId: "call-1", title: "Remove a folder", kind: "delete" }),
            {
              id: "ask-1",
              method: "session/request_permission",
              params: {
                sessionId: "sess-1",
                toolCall: { toolCallId: "call-1", title: "Remove a folder" },
                options:
                  ids === undefined
                    ? []
                    : [
                        { optionId: "always", name: "Always", kind: "allow_always" },
                        { optionId: ids.allow, name: "Allow", kind: "allow_once" },
                        { optionId: ids.reject, name: "Reject", kind: "reject_once" },
                      ],
              },
            },
            // The agent goes on only once it was answered.
          );
          setTimeout(() => one.says({ id: asked.id, result: { stopReason: "end_turn" } }), 20);
        },
      });
    const answered = async (agent: ReturnType<typeof agentThat>, permissions?: string) => {
      const session = driverFor(agent).start({ ...OPTIONS, permissions });
      await session.send(message("Tidy up."));
      const seen = await until(session, [], isType("turn_completed"));
      await session.stop();
      return {
        answer: agent.sent.find((one) => one.id === "ask-1"),
        said: seen.filter((event) => event.type === "event" && event.kind === "permission"),
      };
    };
    const allowed = await answered(asking({ allow: "once", reject: "no" }));
    expect(allowed.answer).toEqual({
      jsonrpc: "2.0",
      id: "ask-1",
      result: { outcome: { outcome: "selected", optionId: "once" } },
    });
    expect(allowed.said).toEqual([
      {
        type: "event",
        kind: "permission",
        text: "Allowed, with nobody at the terminal to ask: Remove a folder",
        data: { tool: "delete", answer: "allowed", id: "call-1" },
      },
    ]);
    const denied = await answered(asking({ allow: "once", reject: "no" }), "deny");
    expect(denied.answer?.result).toEqual({ outcome: { outcome: "selected", optionId: "no" } });
    expect(denied.said[0]).toMatchObject({
      text: "Denied, with nobody at the terminal to ask: Remove a folder",
      data: { answer: "denied" },
    });
    // A mode that is none of the driver's is the least of them.
    expect(
      (await answered(asking({ allow: "once", reject: "no" }), "yolo")).answer?.result,
    ).toEqual({ outcome: { outcome: "selected", optionId: "no" } });
    // An agent that offers no way to answer is told that it was not.
    const none = await answered(asking(undefined));
    expect(none.answer?.result).toEqual({ outcome: { outcome: "cancelled" } });
    expect(none.said[0]).toMatchObject({ data: { answer: "cancelled" } });
  });

  it("offers the agent no file and no terminal, and says so where it asks for one", async () => {
    const agent = agentThat({
      prompt: (asked, one) => {
        one.says({ id: 7, method: "fs/read_text_file", params: { path: "/etc/hosts" } });
        setTimeout(() => one.says({ id: asked.id, result: { stopReason: "end_turn" } }), 20);
      },
    });
    const session = driverFor(agent).start(OPTIONS);
    await session.send(message("Read it."));
    await until(session, [], isType("turn_completed"));
    expect(agent.sent.find((one) => one.id === 7)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "fs/read_text_file is not offered" },
    });
    await session.stop();
  });

  it("keeps a message that arrives in a turn for the turn after, and stops the turn for one that is to be read now", async () => {
    const prompts: Json[] = [];
    const agent = agentThat({
      prompt: (asked, one) => {
        prompts.push(asked);
        if (prompts.length > 1) {
          one.says({ id: asked.id, result: { stopReason: "end_turn" } });
        }
      },
      other: (sent, one) => {
        if (sent.method === "session/cancel") {
          one.says({ id: prompts[0]?.id, result: { stopReason: "cancelled" } });
          return true;
        }
        return false;
      },
    });
    const session = driverFor(agent).start(OPTIONS);
    await session.send(message("First."));
    await until(session, [], isType("running"));
    // In the turn: one that waits, then one to be read now, which stops the turn.
    await session.send(message("Second."));
    expect(agent.of("session/cancel")).toEqual([]);
    await session.send(message("Third, now.", "now"));
    expect(agent.of("session/cancel").map((one) => one.params)).toEqual([{ sessionId: "sess-1" }]);
    const seen = await until(session, [], isType("turn_completed"));
    expect(seen).toEqual([
      { type: "event", kind: "status", text: "The turn was stopped for a message." },
      { type: "turn_completed" },
    ]);
    // What arrived together is one turn, each a block of its own; the agent is done after it.
    expect(prompts.map((one) => (one.params as { prompt: unknown }).prompt)).toEqual([
      [{ type: "text", text: "First." }],
      [
        { type: "text", text: "Second." },
        { type: "text", text: "Third, now." },
      ],
    ]);
    await session.stop();
  });

  it("stops the turn under way when it is interrupted, and nothing else", async () => {
    let turn: Json | undefined;
    const agent = agentThat({
      prompt: (asked) => {
        turn = asked;
      },
      other: (sent, one) => {
        if (sent.method === "session/cancel") {
          one.says(update("agent_message_chunk", { content: text("Stopping.") }), {
            id: turn?.id,
            result: { stopReason: "cancelled" },
          });
          return true;
        }
        return false;
      },
    });
    const session = driverFor(agent).start(OPTIONS);
    // Nothing to stop: nothing is sent.
    await until(session, [], isType("running"));
    await session.interrupt();
    expect(agent.of("session/cancel")).toEqual([]);
    await session.send(message("A long task."));
    await session.interrupt();
    await session.interrupt();
    expect(agent.of("session/cancel")).toHaveLength(1);
    expect(await until(session, [], isType("turn_completed"))).toEqual([
      { type: "event", kind: "assistant", text: "Stopping." },
      { type: "event", kind: "status", text: "The turn was stopped." },
      { type: "turn_completed" },
    ]);
    // The session is there for the next message.
    await session.send(message("Go on."));
    expect(agent.of("session/prompt")).toHaveLength(2);
    await session.stop();
  });

  it("says that the agent cannot go on where the model refused, and takes nothing more", async () => {
    const agent = agentThat({
      prompt: (asked, one) => one.says({ id: asked.id, result: { stopReason: "refusal" } }),
    });
    const session = driverFor(agent).start(OPTIONS);
    await session.send(message("Something it will not do."));
    const seen = await until(session, [], isType("cannot_go_on"));
    expect(seen.slice(2)).toEqual([
      { type: "event", kind: "error", text: "The model refused to answer." },
      { type: "cannot_go_on", state: "refused", reason: "model_refused" },
    ]);
    await expect(session.send(message("Again."))).rejects.toThrow("takes no more input");
    await session.stop();
  });

  it("says where a turn ended at a bound of the model's or the agent's, and that a turn the agent refused ended", async () => {
    const reasons = ["max_tokens", "max_turn_requests"];
    const agent = agentThat({
      prompt: (asked, one) => {
        const reason = reasons.shift();
        one.says(
          reason === undefined
            ? { id: asked.id, error: { code: -32603, message: "the tool server is away" } }
            : { id: asked.id, result: { stopReason: reason } },
        );
      },
    });
    const session = driverFor(agent).start(OPTIONS);
    const turn = async (words: string) => {
      await session.send(message(words));
      return (await until(session, [], isType("turn_completed"))).filter(
        (event) => event.type === "event",
      );
    };
    expect(await turn("One.")).toEqual([
      {
        type: "event",
        kind: "status",
        text: "The turn ended at the most the model writes in one.",
      },
    ]);
    expect(await turn("Two.")).toEqual([
      {
        type: "event",
        kind: "status",
        text: "The turn ended at the most requests the agent makes in one.",
      },
    ]);
    expect(await turn("Three.")).toEqual([
      { type: "event", kind: "error", text: "The agent refused the turn: the tool server is away" },
    ]);
    await session.stop();
  });

  it("goes on with a conversation where the agent can: resumed, or loaded with what it replays left unread", async () => {
    const resumes = agentThat({
      initialized: {
        ...INITIALIZED,
        agentCapabilities: { sessionCapabilities: { resume: {} }, loadSession: true },
      },
      other: (sent, one) => {
        if (sent.method === "session/resume") {
          one.says({ id: sent.id, result: {} });
          return true;
        }
        return false;
      },
    });
    const resumed = driverFor(resumes).start({ ...OPTIONS, resume: "sess-9" });
    expect(await until(resumed, [], isType("running"))).toEqual([
      { type: "conversation", id: "sess-9" },
      { type: "running", model: null, effort: null, version: "2.3.1" },
    ]);
    expect(resumes.of("session/resume").map((one) => one.params)).toEqual([
      { sessionId: "sess-9", cwd: "/home/mira/desk", mcpServers: [] },
    ]);
    expect(resumes.of("session/new")).toEqual([]);
    await resumed.stop();

    const loads = agentThat({
      other: (sent, one) => {
        if (sent.method === "session/load") {
          one.says(
            update("user_message_chunk", { content: text("An old question.") }),
            update("agent_message_chunk", { content: text("An old answer.") }),
            { id: sent.id, result: { configOptions: CONFIG } },
          );
          return true;
        }
        return false;
      },
    });
    const loaded = driverFor(loads).start({ ...OPTIONS, resume: "sess-9" });
    // Nothing of what was replayed is this session's.
    expect(await until(loaded, [], isType("running"))).toEqual([
      { type: "conversation", id: "sess-9" },
      { type: "running", model: "lathe-small", effort: "low", version: "2.3.1" },
    ]);
    await loaded.stop();

    // An agent that goes on with none begins a new one, and the transcript says so.
    const forgets = agentThat({ initialized: { ...INITIALIZED, agentCapabilities: {} } });
    const fresh = driverFor(forgets).start({ ...OPTIONS, resume: "sess-9" });
    expect(await until(fresh, [], isType("running"))).toEqual([
      {
        type: "event",
        kind: "status",
        text: "This agent goes on with no conversation from one session to the next: a new one begins.",
      },
      { type: "conversation", id: "sess-1" },
      { type: "running", model: "lathe-small", effort: "low", version: "2.3.1" },
    ]);
    await fresh.stop();
  });

  it("hands a picture over where the agent takes one, and says so where it takes none", async () => {
    const picture = {
      name: "screen.png",
      contentType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    };
    const takes = agentThat();
    const first = driverFor(takes).start(OPTIONS);
    await first.send({ text: "Look.", images: [picture], priority: "next" });
    await until(first, [], isType("turn_completed"));
    expect(takes.of("session/prompt").map((one) => one.params)).toEqual([
      {
        sessionId: "sess-1",
        prompt: [
          { type: "text", text: "Look." },
          { type: "image", mimeType: "image/png", data: "AQID" },
        ],
      },
    ]);
    await first.stop();

    const blind = agentThat({ initialized: { ...INITIALIZED, agentCapabilities: {} } });
    const second = driverFor(blind).start(OPTIONS);
    await second.send({ text: "Look.", images: [picture, picture], priority: "next" });
    await until(second, [], isType("turn_completed"));
    expect(blind.of("session/prompt").map((one) => one.params)).toEqual([
      {
        sessionId: "sess-1",
        prompt: [
          {
            type: "text",
            text: "Look.\n\n(2 pictures came with this and could not be handed over: this agent takes none.)",
          },
        ],
      },
    ]);
    await second.stop();
  });

  it("says that the product is not signed in, by the protocol's own word for it, and ends it", async () => {
    const agent = agentThat({
      other: (sent, one) => {
        if (sent.method === "session/new") {
          one.says({ id: sent.id, error: { code: -32000, message: "Authentication required" } });
          return true;
        }
        return false;
      },
    });
    const session = driverFor(agent).start(OPTIONS);
    await session.send(message("Hello."));
    expect(await until(session, [], isType("ended"))).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product is not signed in: Authentication required",
      },
      { type: "cannot_go_on", state: "failed", reason: "sign_in" },
      { type: "ended", how: "exited" },
    ]);
    expect(agent.ended).toBe(true);
    await expect(session.send(message("Again."))).rejects.toThrow("takes no more input");
  });

  it("says a product that speaks another version of the protocol, and one that opened no session", async () => {
    const newer = agentThat({ initialized: { ...INITIALIZED, protocolVersion: 2 } });
    expect(await until(driverFor(newer).start(OPTIONS), [], isType("ended"))).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product speaks version 2 of the Agent Client Protocol, and this runner version 1.",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
      { type: "ended", how: "exited" },
    ]);
    const refused = agentThat({
      other: (sent, one) => {
        if (sent.method === "session/new") {
          one.says({ id: sent.id, error: { code: -32602, message: "no such folder" } });
          return true;
        }
        return false;
      },
    });
    expect(
      (await until(driverFor(refused).start(OPTIONS), [], isType("ended"))).slice(0, 2),
    ).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product did not open a session: no such folder",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
    ]);
  });

  it("says how the product's process ended where it fell over: before it answered, and in a turn", async () => {
    const absent = fakeAgent(() => undefined);
    const never = driverFor(absent).start(OPTIONS);
    absent.exits(null, null, "spawn lathe ENOENT");
    expect(await until(never, [], isType("ended"))).toEqual([
      {
        type: "event",
        kind: "error",
        text: "The product could not be started: spawn lathe ENOENT",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
      { type: "ended", how: "crashed" },
    ]);

    const falls = agentThat({
      prompt: (_asked, one) => {
        one.says(update("agent_message_chunk", { content: text("Working on it") }));
        setTimeout(() => {
          falls.writes("panic: out of memory");
          falls.exits(1);
        }, 10);
      },
    });
    const session = driverFor(falls).start(OPTIONS);
    await session.send(message("A task."));
    const seen = await until(session, [], isType("ended"));
    expect(seen.slice(2)).toEqual([
      { type: "event", kind: "assistant", text: "Working on it" },
      {
        type: "event",
        kind: "error",
        text: "The product's process ended with code 1.\npanic: out of memory",
      },
      { type: "cannot_go_on", state: "failed", reason: "crashed" },
      { type: "ended", how: "crashed" },
    ]);
  });

  it("asks the product what it is and offers without a session to run, and leaves it", async () => {
    const agent = agentThat();
    const driver = driverFor(agent);
    expect(driver.product).toEqual({
      name: "An agent over the Agent Client Protocol",
      tried: [],
    });
    expect(await driver.probe()).toEqual({
      version: "2.3.1",
      models: ["lathe-small", "lathe-large"],
      efforts: ["low", "high"],
    });
    // What it said it is called is what the runner calls it from then on.
    expect(driver.product.name).toBe("Lathe");
    expect(agent.ended).toBe(true);
    // A product that is not there offers nothing, and nothing fails for it.
    const absent = fakeAgent(() => undefined);
    const probing = driverFor(absent).probe();
    absent.exits(null, null, "spawn lathe ENOENT");
    expect(await probing).toEqual({ version: undefined, models: [], efforts: [] });
  });

  it("says that the desk names no command, where it names the driver alone", async () => {
    const driver = createAcpDriver({
      spawn: () => {
        throw new Error("nothing is started");
      },
      cwd: "/home/mira/desk",
    });
    expect(await driver.probe()).toEqual({ version: undefined, models: [], efforts: [] });
    expect(await until(driver.start(OPTIONS), [], isType("ended"))).toEqual([
      {
        type: "event",
        kind: "error",
        text: "runner.json names the driver acp and no command for it: say which program speaks the protocol, as product.command.",
      },
      { type: "cannot_go_on", state: "failed", reason: "start" },
      { type: "ended", how: "crashed" },
    ]);
  });
});
