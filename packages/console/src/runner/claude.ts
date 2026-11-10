import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES } from "../limits.js";
import { TRANSCRIPT_PICTURE_TYPES } from "../vocabulary.js";
import type { DriverHost } from "./registry.js";
import type {
  Child,
  Driver,
  DriverEvent,
  DriverMessage,
  DriverSession,
  Fact,
  Picture,
  StartOptions,
} from "./types.js";

// The `claude` driver (docs/specs/runner.md): the Claude Code binary, unmodified, over its
// streaming JSON input and output. One message a line on its standard input, one event a line
// on its standard output. What the product's documentation states is relied on; what it leaves
// unsaid is marked where it is read, and held by fixtures in the tests. Everything the product
// prints is data: read by shape, never run, and bounded by the runner before it is sent on.

/** The product's aliases for its models and its levels of effort, as its documentation lists them: the binary offers no list to ask. */
const MODELS = ["opus", "sonnet", "haiku", "fable"] as const;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** How long a process asked to end is given before it is made to, and then before it is killed. */
const STOP_GRACE_MS = 5000;
const KILL_GRACE_MS = 2000;
/** How much of a tool's input a tool call shows when the tool is not one whose input reads as a line. */
const MAX_INPUT_LENGTH = 4000;

const PICTURE_TYPES: ReadonlySet<string> = new Set(TRANSCRIPT_PICTURE_TYPES);
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * What an error says when the product is not signed in, its login ran out or its key is refused.
 * The product's words for it are its own and not a contract: read by pattern, and held by the
 * fixtures of the versions the driver was tried with.
 */
const SIGN_IN =
  /not logged in|please run \/login|log ?in (?:is )?required|authentication[_ ]error|invalid (?:x-)?api[- ]key|oauth token (?:has )?(?:expired|been revoked)|token (?:has )?expired|unauthorized/i;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** One line of the product's output as an object with a type, or nothing for anything else. */
function lineOf(line: string): Json | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(line);
    return isObject(parsed) && typeof parsed.type === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A tool's input as a person reads it: the command of a shell, the path of a file, or the input whole and bounded. */
function inputOf(input: unknown): string {
  if (isObject(input)) {
    const line = textOf(input.command) ?? textOf(input.file_path) ?? textOf(input.path);
    if (line !== undefined && Object.keys(input).length <= 3) {
      return line;
    }
  }
  let whole: string;
  try {
    whole = JSON.stringify(input) ?? "";
  } catch {
    whole = "";
  }
  return whole.length > MAX_INPUT_LENGTH ? `${whole.slice(0, MAX_INPUT_LENGTH)}…` : whole;
}

/** The pictures and the text of what a tool returned: a string, or blocks of text and pictures. */
function resultOf(
  content: unknown,
  name: string,
): { readonly text: string; readonly pictures: Picture[] } {
  if (typeof content === "string") {
    return { text: content, pictures: [] };
  }
  const texts: string[] = [];
  const pictures: Picture[] = [];
  for (const block of Array.isArray(content) ? content : []) {
    if (!isObject(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    } else if (block.type === "image" && isObject(block.source)) {
      const type = textOf(block.source.media_type) ?? "";
      const data = textOf(block.source.data);
      // A picture of a kind a transcript keeps, within the bound on a file; anything else is said and left.
      if (
        block.source.type === "base64" &&
        data !== undefined &&
        PICTURE_TYPES.has(type) &&
        data.length <= Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4
      ) {
        const bytes = Buffer.from(data, "base64");
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_FILE_BYTES) {
          pictures.push({
            name: `${name}-${pictures.length + 1}.${EXTENSIONS[type] ?? "png"}`,
            contentType: type,
            bytes,
          });
          continue;
        }
      }
      texts.push("[a picture the transcript does not keep]");
    }
  }
  return { text: texts.join("\n"), pictures };
}

/** What a denial says of the tool it denied. */
function denialOf(denial: unknown): DriverEvent | undefined {
  if (!isObject(denial)) {
    return undefined;
  }
  const tool = textOf(denial.tool_name) ?? "a tool";
  const data: Record<string, Fact> = { tool, answer: "denied" };
  const id = textOf(denial.tool_use_id);
  if (id !== undefined) {
    data.id = id;
  }
  return {
    type: "event",
    kind: "permission",
    text: `Denied, with nobody at the terminal to ask: ${tool} ${inputOf(denial.tool_input)}`.trim(),
    data,
  };
}

/** What the lines of one process left so far, for the next line to be read by. */
interface Read {
  /** Whether the product said that it began. */
  began: boolean;
  /** How many results of tools it wrote, which name the pictures among them. */
  results: number;
  /** What it last said it runs with, and the conversation it last named: said on when they change. */
  runs: string | undefined;
  conversation: string | undefined;
  /** The permission mode the driver asked for. */
  readonly asked: string;
  /** The messages written to it that it has not said it took, by the id each was written under. */
  readonly waiting: Set<string>;
  /** Whether it said of any message that it took it: a build that says none back is read without. */
  acknowledges: boolean;
  /** The tool calls of the turn it said were denied, which the turn's result says again. */
  readonly denied: Set<string>;
}

/** The product's permission modes, as its documentation and its own help name them. */
const MODES = [
  "default",
  "manual",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;
/** Its two words for the mode in which whatever needs approval is asked for: one it takes, the other it says. */
const MANUAL_MODES: ReadonlySet<string> = new Set(["default", "manual"]);
/**
 * The mode the driver names where the desk names none. A product is started in its own default
 * wherever that default is one for a run nobody attends, and its driver then names nothing.
 * This product's is not: with nobody at its terminal it starts in its manual mode (seen with
 * 2.1.321, with settings files and without), in which whatever needs approval, a file written
 * among it, is denied. So the driver names `auto`, in which the product's own classifier
 * reviews each action. A build that starts such a run in `auto` by itself needs nothing named,
 * and this constant goes.
 */
const UNATTENDED_MODE = "auto";
/** The mode that allows the least: what would prompt is denied. */
const LEAST_MODE = "dontAsk";

/**
 * The mode a session is started in: the one above where the desk names none. A mode named that
 * is none of the product's is a mistake in the desk's file, and is never read as leave to do
 * more: the session starts in the mode that allows the least, and its denials say so in the
 * transcript.
 */
export function claudeMode(named: string | undefined): string {
  return named === undefined
    ? UNATTENDED_MODE
    : (MODES.find((mode) => mode === named) ?? LEAST_MODE);
}

const sameMode = (one: string, other: string): boolean =>
  one === other || (MANUAL_MODES.has(one) && MANUAL_MODES.has(other));

/** The events of one line of the product's output. `state` is what the lines before it left. */
function eventsOf(line: Json, state: Read): DriverEvent[] {
  const events: DriverEvent[] = [];
  const message = isObject(line.message) ? line.message : undefined;
  const blocks = Array.isArray(message?.content) ? message.content : [];
  switch (line.type) {
    case "system": {
      if (line.subtype === "init") {
        // The product says how it runs when it starts and again at every turn after: said on
        // once, and again where what it says is something else.
        const model = textOf(line.model) ?? null;
        const effort = textOf(line.effort) ?? null;
        const version = textOf(line.claude_code_version) ?? null;
        const mode = textOf(line.permissionMode) ?? null;
        const runs = JSON.stringify([model, effort, version, mode]);
        const conversation = textOf(line.session_id);
        if (runs !== state.runs) {
          events.push({ type: "running", model, effort, version });
        }
        if (conversation !== undefined && conversation !== state.conversation) {
          events.push({ type: "conversation", id: conversation });
        }
        if (!state.began) {
          // A mode the account or the model does not have is not the one the product starts
          // in: said where it is read, since it is what the agent does without asking.
          const other = mode !== null && !sameMode(mode, state.asked);
          events.push({
            type: "event",
            kind: "status",
            text: other
              ? `The product started, in the permission mode ${mode} and not in ${state.asked}, which it was asked for.`
              : "The product started.",
            data: { model, effort, version, mode },
          });
        } else if (runs !== state.runs) {
          events.push({
            type: "event",
            kind: "status",
            text: "The product goes on with another model, or in another permission mode.",
            data: { model, effort, version, mode },
          });
        }
        state.began = true;
        state.runs = runs;
        state.conversation = conversation ?? state.conversation;
      } else if (line.subtype === "compact_boundary") {
        events.push({
          type: "event",
          kind: "status",
          text: "The product compacted the conversation.",
        });
      } else if (line.subtype === "api_retry") {
        const attempt = typeof line.attempt === "number" ? line.attempt : null;
        events.push({
          type: "event",
          kind: "error",
          text: "The product is asking the model again after a request that failed.",
          data: { attempt },
        });
      } else if (line.subtype === "permission_denied") {
        // Said when it happens, and again in the turn's result, which is then not said twice.
        const denied = denialOf(line);
        if (denied !== undefined) {
          events.push(denied);
          const id = textOf(line.tool_use_id);
          if (id !== undefined) {
            state.denied.add(id);
          }
        }
      }
      return events;
    }
    case "assistant": {
      for (const block of blocks) {
        if (!isObject(block)) {
          continue;
        }
        if (block.type === "text" && typeof block.text === "string") {
          events.push({ type: "event", kind: "assistant", text: block.text });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          events.push({ type: "event", kind: "thinking", text: block.thinking });
        } else if (block.type === "tool_use") {
          const tool = textOf(block.name) ?? "a tool";
          events.push({
            type: "event",
            kind: "tool_call",
            text: inputOf(block.input),
            data: { tool, id: textOf(block.id) ?? null },
          });
        }
      }
      return events;
    }
    case "user": {
      // A message said back is one the product took off its input: the runner's to record, and
      // no longer waited for here.
      if (line.isReplay === true) {
        const id = textOf(line.uuid);
        if (id !== undefined && state.waiting.delete(id)) {
          state.acknowledges = true;
        }
        return events;
      }
      // What came back from a tool is recorded here.
      for (const block of blocks) {
        if (!isObject(block) || block.type !== "tool_result") {
          continue;
        }
        state.results += 1;
        const result = resultOf(block.content, `tool-${state.results}`);
        events.push({
          type: "event",
          kind: "tool_result",
          text: result.text,
          data: { id: textOf(block.tool_use_id) ?? null, error: block.is_error === true },
          pictures: result.pictures,
        });
      }
      return events;
    }
    case "result": {
      for (const denial of Array.isArray(line.permission_denials) ? line.permission_denials : []) {
        const denied = denialOf(denial);
        const id = isObject(denial) ? textOf(denial.tool_use_id) : undefined;
        if (denied !== undefined && (id === undefined || !state.denied.has(id))) {
          events.push(denied);
        }
      }
      state.denied.clear();
      const said = textOf(line.result) ?? "";
      // The model's own word for an answer it would not give.
      if (line.stop_reason === "refusal") {
        events.push({
          type: "event",
          kind: "error",
          text: "The model refused to answer.",
        });
        events.push({ type: "cannot_go_on", state: "refused", reason: "model_refused" });
        return events;
      }
      // A turn that was stopped says so in the product's word for how it ended, and is no
      // error, whatever else its result says: it is what was asked for.
      const stopped = textOf(line.terminal_reason)?.startsWith("aborted") === true;
      if (line.is_error === true && !stopped) {
        events.push({
          type: "event",
          kind: "error",
          text: said.length === 0 ? "The turn ended with an error." : said,
          data: { subtype: textOf(line.subtype) ?? null },
        });
        if (SIGN_IN.test(said)) {
          events.push({ type: "cannot_go_on", state: "failed", reason: "sign_in" });
          return events;
        }
      }
      // A build that says no message back is read without: every result ends a turn.
      if (!state.acknowledges) {
        state.waiting.clear();
      }
      // A turn that ended while a message waits is not the agent done: the product goes on
      // with that message by itself, in a turn of its own. So it is with a turn stopped for a
      // message, and with a message written as a turn was ending.
      if (state.waiting.size > 0) {
        if (stopped) {
          events.push({
            type: "event",
            kind: "status",
            text: "The turn was stopped for a message.",
          });
        }
        return events;
      }
      if (stopped) {
        events.push({ type: "event", kind: "status", text: "The turn was stopped." });
      }
      events.push({ type: "turn_completed" });
      return events;
    }
    case "command_lifecycle": {
      // What the product says became of a message: one it is done with, or will not take, is
      // not waited for, whether or not it was said back.
      const id = textOf(line.command_uuid);
      if (id !== undefined && (line.state === "completed" || line.state === "cancelled")) {
        state.waiting.delete(id);
      }
      return events;
    }
    default:
      return events;
  }
}

/** A message as one line of the product's input, under the id the product says back when it takes it. */
function inputLineOf(message: DriverMessage, uuid: string): string {
  return JSON.stringify({
    type: "user",
    uuid,
    message: {
      role: "user",
      content: [
        { type: "text", text: message.text },
        ...message.images.map((image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.contentType,
            data: Buffer.from(image.bytes).toString("base64"),
          },
        })),
      ],
    },
    parent_tool_use_id: null,
    // The product's own word for when a message is read: `next` when the tool calls under way
    // finish, in the same turn; `now` in a turn of its own, the one under way stopped for it
    // once its tool calls finish. Seen with 2.1.321.
    priority: message.priority,
  });
}

/**
 * The request that stops the turn under way, the tool call in it too, and nothing else: what
 * the product's own client library sends on this input. With nothing under way it does nothing.
 * Seen with 2.1.321, which answers it with a line of its own and ends the turn with a result.
 */
function interruptLineOf(id: string): string {
  return JSON.stringify({
    type: "control_request",
    request_id: id,
    request: { subtype: "interrupt" },
  });
}

const wait = (ms: number): Promise<"timeout"> =>
  new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms).unref?.();
  });

function sessionOf(child: Child, asked: string, uuid: () => string): DriverSession {
  let stopping = false;
  const state: Read = {
    began: false,
    results: 0,
    runs: undefined,
    conversation: undefined,
    asked,
    waiting: new Set(),
    denied: new Set(),
    acknowledges: false,
  };

  async function* events(): AsyncGenerator<DriverEvent> {
    let waits = false;
    try {
      for await (const text of child.lines) {
        const line = lineOf(text);
        for (const event of line === undefined ? [] : eventsOf(line, state)) {
          waits = event.type === "cannot_go_on" || (waits && event.type !== "turn_completed");
          yield event;
        }
      }
    } catch {
      // The output closed in the middle of a line: how the process ended says the rest.
    }
    const exit = await child.exited;
    const clean = stopping || (exit.code === 0 && exit.signal === null && exit.error === undefined);
    if (!clean && !waits) {
      const said = child.errors().trim();
      const text =
        exit.error !== undefined
          ? `The product could not be started: ${exit.error}`
          : `The product's process ended${exit.signal === null ? ` with code ${exit.code}` : ` on ${exit.signal}`}.${said.length === 0 ? "" : `\n${said}`}`;
      yield { type: "event", kind: "error", text };
      yield {
        type: "cannot_go_on",
        state: "failed",
        reason: SIGN_IN.test(said) ? "sign_in" : state.began ? "crashed" : "start",
      };
    }
    yield { type: "ended", how: clean ? "exited" : "crashed" };
  }

  return {
    events: events(),
    async send(message) {
      const id = uuid();
      state.waiting.add(id);
      try {
        // A message that is to be read now stops what is under way first: the product's own
        // `now` waits for a tool call to finish, however long it runs.
        if (message.priority === "now") {
          await child.write(interruptLineOf(uuid()));
        }
        await child.write(inputLineOf(message, id));
      } catch (error) {
        state.waiting.delete(id);
        throw error;
      }
    },
    interrupt: () => child.write(interruptLineOf(uuid())),
    // The product takes its model and its effort when it starts: the runner begins the next
    // session with them.
    set: async () => false,
    async stop() {
      stopping = true;
      child.end();
      if ((await Promise.race([child.exited, wait(STOP_GRACE_MS)])) === "timeout") {
        child.kill("SIGTERM");
        if ((await Promise.race([child.exited, wait(KILL_GRACE_MS)])) === "timeout") {
          child.kill("SIGKILL");
        }
      }
    },
  };
}

/** The arguments the product is started with. */
export function claudeArguments(options: StartOptions): readonly string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    // A message is said back when the product takes it off its input: how the driver knows
    // that a turn which ended left none waiting.
    "--replay-user-messages",
    // Nobody is at the terminal: the mode says what runs without asking, what would still ask
    // is denied, and the tool that asks a person is taken away.
    "--permission-mode",
    claudeMode(options.permissions),
    "--permission-prompts",
    "none",
    ...(options.model === null ? [] : ["--model", options.model]),
    ...(options.effort === null ? [] : ["--effort", options.effort]),
    ...(options.resume === undefined ? [] : ["--resume", options.resume]),
  ];
}

/**
 * The builds of the binary the driver was run against, a turn, a tool call, a picture each way,
 * a message during a tool call, a turn stopped for a message, a denial and a conversation gone
 * on with: what the fixtures of the tests were written down from.
 */
const TRIED = ["2.1.321"] as const;

export function createClaudeDriver(host: DriverHost): Driver {
  const command = host.command ?? "claude";
  const uuid = host.uuid ?? randomUUID;
  return {
    name: "claude",
    product: { name: "Claude Code", tried: TRIED },
    can: { steer: true, images: true, resume: true, set: false },
    permissions: { modes: MODES, unattended: UNATTENDED_MODE, least: LEAST_MODE },
    async probe() {
      let version: string | undefined;
      try {
        const child = host.spawn(command, ["--version"], { cwd: host.cwd, env: {} });
        child.end();
        let first: string | undefined;
        for await (const line of child.lines) {
          first ??= line;
        }
        await child.exited;
        // One line: the version, then what the product is called.
        version = /^\s*(\d+\.\d+\.\d+[^\s]*)/.exec(first ?? "")?.[1];
      } catch {
        version = undefined;
      }
      return { version, models: MODELS, efforts: EFFORTS };
    },
    start(options) {
      return sessionOf(
        host.spawn(command, claudeArguments(options), { cwd: options.cwd, env: options.env }),
        claudeMode(options.permissions),
        uuid,
      );
    },
  };
}
