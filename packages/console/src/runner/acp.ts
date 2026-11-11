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
  Probe,
  StartOptions,
} from "./types.js";

// The driver for any product that speaks the Agent Client Protocol (ADR-0085): the product's
// command, which `runner.json` names, started once for a session and spoken to over its standard
// input and output, a JSON-RPC message a line. The runner is the protocol's client. It offers
// the agent no file and no terminal of its own, so the agent works with its own tools in the
// desk; it answers what the agent asks leave for, since nobody is at a terminal to ask; and it
// reads what the agent does as whole blocks, where the protocol sends a message in pieces.
// Written from the protocol's documentation, version 1, and read against the types the protocol
// publishes and the source of one agent that speaks it, and run against that agent since.

/** The protocol's version this driver speaks. */
const PROTOCOL_VERSION = 1;
/** How long a session that is stopped is given to end by itself, then after it was asked to. */
const STOP_GRACE_MS = 5000;
const KILL_GRACE_MS = 2000;
/** How long the product is given to say what it is and to open a session. */
const START_TIMEOUT_MS = 120_000;
/** How long it is given to say what it is and offers, asked without a session to run. */
const PROBE_TIMEOUT_MS = 30_000;
/** The most of a tool's input that is shown. */
const MAX_INPUT_LENGTH = 4000;
/** The most that is kept of what a command printed while it ran, where an agent sends it in pieces. */
const MAX_PRINTED_LENGTH = 200_000;
/** The most that is shown of what an error carries beside its message. */
const MAX_DETAIL_LENGTH = 1000;
/** The protocol's code for a request the agent takes only once the product is signed in. */
const AUTH_REQUIRED = -32000;
/** The answer to a request for a method this client does not offer. */
const METHOD_NOT_FOUND = -32601;

/**
 * What an error says when the product is not signed in. The products' words for it are their
 * own: read by pattern, beside the protocol's own code for it.
 */
const SIGN_IN =
  /not (?:logged|signed) in|logged out|(?:log|sign) ?in (?:is )?required|authentication (?:is )?required|auth_required|invalid (?:x-)?api[- ]key|token (?:has )?expired|unauthorized/i;

/**
 * What the runner answers where the agent asks leave for a tool call, in the driver's own two
 * words. `allow` lets it, once each: a run nobody attends has nobody to ask, and an agent that
 * is refused everything does no work. `deny` refuses each, for an agent that is to do only what
 * its own mode lets it without asking. Beside the two, the desk may name one of the agent's own
 * modes, which the protocol has a session say and set: the agent then runs in it, and what it
 * still asks is refused, since the mode is what it may do with nobody there.
 */
const MODES = ["allow", "deny"] as const;

/**
 * The mode an agent has for a run nobody attends, by what the agent calls itself: the one in
 * which it works without asking and asks leave only for what its own review holds back. The
 * driver names it where the desk names none, as the other drivers name their product's, and
 * refuses what the agent still asks. Seen with the adapters that put Codex and Claude Code
 * behind the protocol, whose words for it are `agent` and `auto`. An agent the driver does not
 * know runs in its own mode and is allowed what it asks: the desk names its mode for such a run.
 */
const UNATTENDED_MODES: Readonly<Record<string, string>> = {
  Codex: "agent",
  "Claude Agent": "auto",
};

/**
 * The agents the driver was run against, each by what it calls itself, with the versions it said
 * of itself: the adapters that put Codex and Claude Code behind the protocol, each run on
 * Windows with a real account.
 */
const TRIED: Readonly<Record<string, readonly string[]>> = {
  Codex: ["2.6.0"],
  "Claude Agent": ["0.106.0"],
};
const UNATTENDED_MODE = "allow";
const LEAST_MODE = "deny";

/** The mode a session answers in: the one named where it is one of the two, the least where it is not, `allow` where none is named. */
export function acpMode(named: string | undefined): (typeof MODES)[number] {
  if (named === undefined) {
    return UNATTENDED_MODE;
  }
  return named === "allow" || named === "deny" ? named : LEAST_MODE;
}

const PICTURE_TYPES: ReadonlySet<string> = new Set(TRANSCRIPT_PICTURE_TYPES);
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const wait = (ms: number): Promise<"timeout"> =>
  new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms).unref?.();
  });

/**
 * What an error carries beside its message, as words: an agent may say "Internal error" and put
 * why under `data`, as text or as an object with a message of its own.
 */
function detailOf(data: unknown): string | undefined {
  const words = isObject(data)
    ? (textOf(data.message) ?? textOf(data.details) ?? textOf(data.error))
    : textOf(data);
  const detail = words?.trim();
  return detail === undefined || detail.length === 0
    ? undefined
    : detail.slice(0, MAX_DETAIL_LENGTH);
}

/** What a request was refused with, as the protocol says it: the message, with what it carries beside it. */
class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string, data?: unknown) {
    const detail = detailOf(data);
    super(detail === undefined || message.includes(detail) ? message : `${message}: ${detail}`);
    this.code = code;
  }
}

/** The two ends of the protocol on one process: requests with their answers, and what arrives unasked. */
interface Connection {
  request(method: string, params: Json): Promise<unknown>;
  notify(method: string, params: Json): Promise<void>;
  /** Answers a request of the agent's. */
  answer(id: unknown, result: Json): Promise<void>;
  refuse(id: unknown, code: number, message: string): Promise<void>;
  /** Reads the process to its end, handing over what the agent says and asks. */
  read(on: {
    notification(method: string, params: Json): void;
    request(id: unknown, method: string, params: Json): void;
  }): Promise<void>;
}

function connectionOf(child: Child): Connection {
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const write = (message: Json): Promise<void> =>
    child.write(JSON.stringify({ jsonrpc: "2.0", ...message }));
  return {
    request(method, params) {
      const id = next;
      next += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ id, method, params }).catch((error: unknown) => {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    notify: (method, params) => write({ method, params }),
    answer: (id, result) => write({ id, result }),
    refuse: (id, code, message) => write({ id, error: { code, message } }),
    async read(on) {
      try {
        for await (const text of child.lines) {
          if (text.trim().length === 0) {
            continue;
          }
          let line: unknown;
          try {
            line = JSON.parse(text);
          } catch {
            // What is no message of the protocol is none of the runner's: a line a product
            // printed beside it, say.
            continue;
          }
          if (!isObject(line)) {
            continue;
          }
          const method = textOf(line.method);
          if (method !== undefined) {
            const params = isObject(line.params) ? line.params : {};
            if (line.id === undefined || line.id === null) {
              on.notification(method, params);
            } else {
              on.request(line.id, method, params);
            }
            continue;
          }
          const waiting = typeof line.id === "number" ? pending.get(line.id) : undefined;
          if (waiting === undefined || typeof line.id !== "number") {
            continue;
          }
          pending.delete(line.id);
          if (isObject(line.error)) {
            waiting.reject(
              new RpcError(
                typeof line.error.code === "number" ? line.error.code : 0,
                textOf(line.error.message) ?? "the request was refused",
                line.error.data,
              ),
            );
          } else {
            waiting.resolve(line.result);
          }
        }
      } catch {
        // The output closed in the middle of a line: how the process ended says the rest.
      }
      // Nothing answers what was asked of a process that is gone.
      for (const waiting of pending.values()) {
        waiting.reject(new Error("the product's process ended"));
      }
      pending.clear();
    },
  };
}

/** What one of the product's choices is, as the protocol lists it: its id, what it stands at, and what it may be set to. */
interface Choice {
  readonly id: string;
  readonly current: string | null;
  readonly values: readonly string[];
}

/** The choice of a category among a session's configuration: the model, or the level of thought. */
function choiceOf(options: unknown, category: string): Choice | undefined {
  for (const option of listOf(options)) {
    if (!isObject(option) || option.category !== category || option.type !== "select") {
      continue;
    }
    const id = textOf(option.id);
    if (id === undefined) {
      continue;
    }
    const values: string[] = [];
    for (const entry of listOf(option.options)) {
      if (!isObject(entry)) {
        continue;
      }
      // A flat list of values, or groups of them.
      for (const one of Array.isArray(entry.options) ? entry.options : [entry]) {
        const value = isObject(one) ? textOf(one.value) : undefined;
        if (value !== undefined && value.length > 0 && value.length <= 200) {
          values.push(value);
        }
      }
    }
    return { id, current: textOf(option.currentValue) ?? null, values: values.slice(0, 100) };
  }
  return undefined;
}

/** The agent's own modes, as a session says them: a choice of the category `mode`, or its modes. */
interface Standing {
  readonly choice: Choice;
  /** How one is set: as a choice of the session's configuration, or as the session's mode. */
  readonly by: "option" | "mode";
}

function standingOf(opened: unknown): Standing | undefined {
  if (!isObject(opened)) {
    return undefined;
  }
  const configured = choiceOf(opened.configOptions, "mode");
  if (configured !== undefined) {
    return { choice: configured, by: "option" };
  }
  if (!isObject(opened.modes)) {
    return undefined;
  }
  const values = listOf(opened.modes.availableModes)
    .map((one) => (isObject(one) ? textOf(one.id) : undefined))
    .filter((id): id is string => id !== undefined && id.length > 0 && id.length <= 200)
    .slice(0, 100);
  return values.length === 0
    ? undefined
    : {
        choice: { id: "", current: textOf(opened.modes.currentModeId) ?? null, values },
        by: "mode",
      };
}

/** A tool's input as a person reads it: the command of a shell, the path of a file, or the input whole and bounded. */
function inputOf(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  if (isObject(input)) {
    // An input with nothing in it yet is none: an agent may open a call before it is whole.
    if (Object.keys(input).length === 0) {
      return "";
    }
    const line =
      textOf(input.command) ??
      textOf(input.file_path) ??
      textOf(input.path) ??
      textOf(input.abs_path);
    if (line !== undefined && Object.keys(input).length <= 3) {
      return line;
    }
  }
  let whole: string;
  try {
    whole = typeof input === "string" ? input : (JSON.stringify(input) ?? "");
  } catch {
    whole = "";
  }
  return whole.length > MAX_INPUT_LENGTH ? `${whole.slice(0, MAX_INPUT_LENGTH)}…` : whole;
}

/** The text and the pictures of what a tool call holds: blocks of content, a change to a file, a terminal. */
function contentOf(
  content: unknown,
  name: string,
): { readonly text: string; readonly pictures: Picture[] } {
  const texts: string[] = [];
  const pictures: Picture[] = [];
  for (const item of listOf(content)) {
    if (!isObject(item)) {
      continue;
    }
    if (item.type === "diff") {
      const path = textOf(item.path) ?? "a file";
      // What became of the file: as the agent says it beside the protocol where it does, read
      // from the text before where it does not. A file changed in several places is said once.
      const said = isObject(item._meta) ? textOf(item._meta.kind) : undefined;
      const fresh = item.oldText === null || item.oldText === undefined;
      const what =
        said === "delete"
          ? "Removed"
          : said === "add" || (said === undefined && fresh)
            ? "Wrote"
            : "Changed";
      if (!texts.includes(`${what} ${path}`)) {
        texts.push(`${what} ${path}`);
      }
      continue;
    }
    if (item.type !== "content" || !isObject(item.content)) {
      continue;
    }
    const block = item.content;
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    } else if (block.type === "image") {
      const type = textOf(block.mimeType) ?? "";
      const data = textOf(block.data);
      // A picture of a kind a transcript keeps, within the bound on a file; anything else is said and left.
      if (
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
    } else if (block.type === "resource_link") {
      texts.push(textOf(block.uri) ?? "");
    }
  }
  return { text: texts.filter((text) => text.length > 0).join("\n"), pictures };
}

/** What the agent says it is: its name as people read it, and its version. */
function agentOf(initialized: unknown): { name: string | undefined; version: string | undefined } {
  const info =
    isObject(initialized) && isObject(initialized.agentInfo) ? initialized.agentInfo : {};
  const short = (value: unknown): string | undefined => {
    const text = textOf(value)?.trim();
    return text === undefined || text.length === 0 ? undefined : text.slice(0, 80);
  };
  return { name: short(info.title) ?? short(info.name), version: short(info.version) };
}

/** What the runner says of itself when it begins: no file and no terminal of its own, so that the agent works with its own tools. */
const hello = (version: string | undefined): Json => ({
  protocolVersion: PROTOCOL_VERSION,
  // What the agent has to tell beside its work, a warning say, is taken as a notice: an agent
  // that is offered none says it as its own words, in the middle of its answer.
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    session: { notices: {} },
  },
  // The protocol has a client say its version: the command's, or none that it knows.
  clientInfo: {
    name: "skillcdn-console-runner",
    title: "SkillCDN Console runner",
    version: version ?? "0.0.0",
  },
});

/** Ends a process: its input closed first, then asked, then made to. */
async function endOf(child: Child): Promise<void> {
  child.end();
  if ((await Promise.race([child.exited, wait(STOP_GRACE_MS)])) === "timeout") {
    child.kill("SIGTERM");
    if ((await Promise.race([child.exited, wait(KILL_GRACE_MS)])) === "timeout") {
      child.kill("SIGKILL");
    }
  }
}

function sessionOf(
  child: Child,
  options: StartOptions,
  /** The version of the command the runner is, said to the product. */
  own: string | undefined,
): DriverSession {
  const connection = connectionOf(child);
  /** How what the agent asks leave for is answered: settled once the session says its modes. */
  let mode = acpMode(options.permissions);

  // What the session says, in order, for whoever reads it: until it ends.
  const said: DriverEvent[] = [];
  let reader: (() => void) | undefined;
  /**
   * The tool calls under way, by id: what each is called and was called with, what it holds so
   * far, what its command printed, and whether it and its end were said.
   */
  const calls = new Map<
    string,
    {
      tool: string;
      title: string;
      input: string;
      said: boolean;
      done: boolean;
      content: unknown;
      raw: unknown;
      printed: string;
    }
  >();
  /**
   * The calls that began and are not said yet, in order: an agent may open a call before what
   * it is called with is whole, and say that in an update. A call is said once its input is
   * known, and before anything else is, so that the transcript keeps the order of what happened.
   */
  const held: string[] = [];
  const emit = (...events: DriverEvent[]): void => {
    for (const id of held.splice(0)) {
      const call = calls.get(id);
      if (call === undefined || call.said) {
        continue;
      }
      call.said = true;
      said.push({
        type: "event",
        kind: "tool_call",
        text:
          call.input.length === 0 || call.title.includes(call.input)
            ? call.title
            : `${call.title}\n${call.input}`.trim(),
        data: { tool: call.tool, id },
      });
    }
    said.push(...events);
    reader?.();
    reader = undefined;
  };
  async function* events(): AsyncGenerator<DriverEvent> {
    for (;;) {
      const next = said.shift();
      if (next === undefined) {
        await new Promise<void>((resolve) => {
          reader = resolve;
        });
        continue;
      }
      yield next;
      if (next.type === "ended") {
        return;
      }
    }
  }

  let stopping = false;
  /** Whether the product answered at all: a process that ends before is one that did not start. */
  let began = false;
  /** Whether the session cannot go on, as was said: nothing more is said of how the process ends. */
  let gaveUp = false;
  let session: string | undefined;
  let takesImages = false;
  /** Whether the agent has said what it takes: before that, nothing is known of pictures. */
  let saidWhatItTakes = false;
  let model: Choice | undefined;
  let effort: Choice | undefined;
  /** The agent's version, and what the session was last said to run with. */
  let product: string | null = null;
  let ran: { model: string | null; effort: string | null } | undefined;
  /**
   * Says what the session runs with, where that is not what was said last: when it opens, when
   * a choice is taken in it, and when the agent changes one itself. The runner tells the
   * console from it, so a choice that is taken and not said stays the old one on every page.
   */
  const runs = (): void => {
    const now = { model: model?.current ?? null, effort: effort?.current ?? null };
    if (ran !== undefined && ran.model === now.model && ran.effort === now.effort) {
      return;
    }
    ran = now;
    emit({ type: "running", ...now, version: product });
  };
  /** While a conversation is loaded, what the agent replays of it is none of this session's. */
  let replaying = false;
  /** The turn under way: why it was stopped where it was, and whether the agent was refused leave in it. */
  let turn: { cut: "message" | "stopped" | undefined; refused: boolean } | undefined;
  /** The messages that wait for the session to open, or for the turn under way to end. */
  let waiting: DriverMessage[] = [];
  let ready = false;
  let results = 0;

  /** What the agent says in pieces, kept until it is whole: a block of the transcript. */
  let piece: { kind: "assistant" | "thinking"; text: string } | undefined;
  const flush = (): void => {
    // A block is its words: an agent may begin one with empty lines, which are none of it.
    const words = piece?.text.trim() ?? "";
    if (piece !== undefined && words.length > 0) {
      emit({ type: "event", kind: piece.kind, text: words });
    }
    piece = undefined;
  };
  const chunk = (kind: "assistant" | "thinking", content: unknown): void => {
    const text = isObject(content) && content.type === "text" ? textOf(content.text) : undefined;
    if (text === undefined) {
      return;
    }
    if (piece !== undefined && piece.kind !== kind) {
      flush();
    }
    piece = { kind, text: `${piece?.text ?? ""}${text}` };
  };

  const toolUpdate = (update: Json, first: boolean): void => {
    const id = textOf(update.toolCallId);
    if (id === undefined) {
      return;
    }
    let call = calls.get(id);
    // A call opened under an id whose call is done is another call: an agent that numbers its
    // calls anew at every turn has each of them on the record.
    if (first && call?.done === true) {
      call = undefined;
    }
    const known = call !== undefined;
    if (call === undefined) {
      call = {
        tool: textOf(update.name) ?? textOf(update.kind) ?? "tool",
        title: "",
        input: "",
        said: false,
        done: false,
        content: undefined,
        raw: undefined,
        printed: "",
      };
      calls.set(id, call);
      flush();
      held.push(id);
    }
    if (!call.said && !(known && first)) {
      // What a call is called, and was called with, as it was said last before the call is.
      call.title = textOf(update.title) ?? call.title;
      const input = inputOf(update.rawInput);
      if (input.length > 0) {
        call.input = input;
      }
      // Said once its input is known, or at the next thing said of it: a call may have none.
      if (call.input.length > 0 || known) {
        emit();
      }
    }
    if ((known && first) || call.done) {
      return;
    }
    // An update says what changed and leaves the rest as it was: what a call holds is what was
    // said of it last, when it began or since.
    if (update.content !== undefined && update.content !== null) {
      call.content = update.content;
    }
    if (update.rawOutput !== undefined && update.rawOutput !== null) {
      call.raw = update.rawOutput;
    }
    // Beside the protocol, an agent may send what a command prints while it runs: whole, or a
    // piece at a time. It is the call's result where the call holds no text of its own.
    const beside = isObject(update._meta) ? update._meta : {};
    const whole = isObject(beside.terminal_output)
      ? textOf(beside.terminal_output.data)
      : undefined;
    const more = isObject(beside.terminal_output_delta)
      ? textOf(beside.terminal_output_delta.data)
      : undefined;
    if (whole !== undefined) {
      call.printed = whole.slice(0, MAX_PRINTED_LENGTH);
    } else if (more !== undefined && call.printed.length < MAX_PRINTED_LENGTH) {
      call.printed = `${call.printed}${more}`.slice(0, MAX_PRINTED_LENGTH);
    }
    const status = textOf(update.status);
    if (status === "completed" || status === "failed") {
      call.done = true;
      flush();
      results += 1;
      const result = contentOf(call.content, `tool-${results}`);
      const output =
        result.text.length > 0
          ? result.text
          : call.printed.trim().length > 0
            ? call.printed
            : inputOf(call.raw);
      // Nothing more is read of a call that ended.
      call.content = undefined;
      call.raw = undefined;
      call.printed = "";
      emit({
        type: "event",
        kind: "tool_result",
        text: output,
        data: { id, error: status === "failed" },
        pictures: result.pictures,
      });
    }
  };

  const onUpdate = (params: Json): void => {
    if (replaying || !isObject(params.update)) {
      return;
    }
    const update = params.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        chunk("assistant", update.content);
        return;
      case "agent_thought_chunk":
        chunk("thinking", update.content);
        return;
      case "tool_call":
        toolUpdate(update, true);
        return;
      case "tool_call_update":
        toolUpdate(update, false);
        return;
      case "plan": {
        flush();
        const lines = listOf(update.entries)
          .filter(isObject)
          .map(
            (entry) => `- [${textOf(entry.status) ?? "pending"}] ${textOf(entry.content) ?? ""}`,
          );
        if (lines.length > 0) {
          emit({ type: "event", kind: "status", text: `Plan:\n${lines.join("\n")}` });
        }
        return;
      }
      case "notice": {
        // What the agent tells beside its work: an error as one, anything else as a status.
        const title = textOf(update.title)?.trim() ?? "";
        const more = textOf(update.description)?.trim() ?? "";
        const words = [title, more].filter((one) => one.length > 0).join("\n");
        if (words.length > 0) {
          flush();
          emit({
            type: "event",
            kind: update.severity === "error" ? "error" : "status",
            text: words.slice(0, MAX_INPUT_LENGTH),
          });
        }
        return;
      }
      case "config_option_update":
        model = choiceOf(update.configOptions, "model") ?? model;
        effort = choiceOf(update.configOptions, "thought_level") ?? effort;
        runs();
        return;
      default:
        // What the client was not asked to keep: the commands the agent offers, its mode, how
        // much it used, what a person typed, said back.
        return;
    }
  };

  const onRequest = (id: unknown, method: string, params: Json): void => {
    if (method !== "session/request_permission") {
      // No file and no terminal were offered: an agent that asks for one all the same is told.
      void connection
        .refuse(id, METHOD_NOT_FOUND, `${method} is not offered`)
        .catch(() => undefined);
      return;
    }
    const call = isObject(params.toolCall) ? params.toolCall : {};
    const callId = textOf(call.toolCallId);
    const known = callId === undefined ? undefined : calls.get(callId);
    const title = textOf(call.title) ?? known?.tool ?? "a tool call";
    const kinds =
      mode === "allow" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
    const options = listOf(params.options).filter(isObject);
    const option = kinds
      .map((kind) => options.find((one) => one.kind === kind))
      .find((one) => one !== undefined && typeof one.optionId === "string");
    const data: Record<string, Fact> = {
      tool: known?.tool ?? textOf(call.kind) ?? "tool",
      answer: option === undefined ? "cancelled" : mode === "allow" ? "allowed" : "denied",
    };
    if (callId !== undefined) {
      data.id = callId;
    }
    if (turn !== undefined && data.answer !== "allowed") {
      turn.refused = true;
    }
    flush();
    emit({
      type: "event",
      kind: "permission",
      text:
        option === undefined
          ? `Not answered, the agent offered no way to ${mode === "allow" ? "allow" : "refuse"} it: ${title}`
          : mode === "allow"
            ? `Allowed, with nobody at the terminal to ask: ${title}`
            : `Denied, with nobody at the terminal to ask: ${title}`,
      data,
    });
    void connection
      .answer(id, {
        outcome:
          option === undefined
            ? { outcome: "cancelled" }
            : { outcome: "selected", optionId: option.optionId },
      })
      .catch(() => undefined);
  };

  /** Sets one of the product's choices; whether it took it. Nothing asked is taken. */
  const choose = async (
    choice: Choice | undefined,
    value: string | null | undefined,
  ): Promise<boolean> => {
    if (value === undefined || value === null) {
      return true;
    }
    if (session === undefined || choice === undefined || !choice.values.includes(value)) {
      return false;
    }
    if (choice.current === value) {
      return true;
    }
    try {
      const result = await connection.request("session/set_config_option", {
        sessionId: session,
        configId: choice.id,
        value,
      });
      const options = isObject(result) ? result.configOptions : undefined;
      model = choiceOf(options, "model") ?? model;
      effort = choiceOf(options, "thought_level") ?? effort;
      return true;
    } catch {
      return false;
    }
  };

  /**
   * How the session stands to what the agent may do. The driver's own two words leave the
   * agent's mode as it is. A mode of the agent's own, the one the desk names or, where it names
   * none, the one the agent has for a run nobody attends, is set, and what the agent still asks
   * is refused. A mode named that the agent does not offer is a mistake in the desk's file, and
   * is never read as leave to do more.
   */
  const stand = async (
    standing: Standing | undefined,
    agent: string | undefined,
  ): Promise<void> => {
    const named = options.permissions;
    if (named === "allow" || named === "deny") {
      return;
    }
    const wanted = named ?? (agent === undefined ? undefined : UNATTENDED_MODES[agent]);
    if (wanted === undefined) {
      return;
    }
    const offered = standing?.choice.values ?? [];
    if (standing === undefined || !offered.includes(wanted)) {
      if (named !== undefined) {
        emit({
          type: "event",
          kind: "status",
          text: `runner.json names the mode ${named}, which this agent does not offer${offered.length === 0 ? "" : ` (it offers ${offered.join(", ")})`}: it runs in its own, and what it asks leave for is refused.`,
        });
      }
      return;
    }
    mode = "deny";
    if (standing.choice.current === wanted) {
      return;
    }
    try {
      if (standing.by === "option") {
        await connection.request("session/set_config_option", {
          sessionId: session ?? "",
          configId: standing.choice.id,
          value: wanted,
        });
      } else {
        await connection.request("session/set_mode", { sessionId: session ?? "", modeId: wanted });
      }
    } catch (error) {
      emit({
        type: "event",
        kind: "status",
        text: `The agent did not take the mode ${wanted}${error instanceof Error ? ` (${error.message})` : ""}: it runs in its own, and what it asks leave for is refused.`,
      });
    }
  };

  /** One turn: what arrived together is read together, each under its own header. */
  const prompt = (messages: readonly DriverMessage[]): void => {
    const mine: NonNullable<typeof turn> = { cut: undefined, refused: false };
    turn = mine;
    const blocks: Json[] = [];
    for (const message of messages) {
      const left = takesImages ? [] : message.images;
      // Where the runner did not know yet that this agent takes no picture, the message says a
      // picture was shown: said here that it was not, with where it is in the desk.
      const where = left.flatMap((image) => (image.path === undefined ? [] : [image.path]));
      blocks.push({
        type: "text",
        text:
          left.length === 0
            ? message.text
            : `${message.text}\n\n(${left.length} picture${left.length === 1 ? "" : "s"} came with this and ${left.length === 1 ? "was" : "were"} not shown to you: this agent takes none as a picture.${where.length === 0 ? "" : ` Open ${where.join(", ")}.`})`,
      });
      for (const image of takesImages ? message.images : []) {
        blocks.push({
          type: "image",
          mimeType: image.contentType,
          data: Buffer.from(image.bytes).toString("base64"),
        });
      }
    }
    void (async () => {
      let reason: string | undefined;
      let failure: unknown;
      try {
        const result = await connection.request("session/prompt", {
          sessionId: session ?? "",
          prompt: blocks,
        });
        reason = isObject(result) ? textOf(result.stopReason) : undefined;
      } catch (error) {
        failure = error;
      }
      flush();
      turn = undefined;
      if (gaveUp) {
        return;
      }
      if (failure !== undefined) {
        const words = failure instanceof Error ? failure.message : String(failure);
        if (failure instanceof RpcError) {
          emit({ type: "event", kind: "error", text: `The agent refused the turn: ${words}` });
          if (failure.code === AUTH_REQUIRED || SIGN_IN.test(words)) {
            gaveUp = true;
            waiting = [];
            emit({ type: "cannot_go_on", state: "failed", reason: "sign_in" });
            return;
          }
          // A turn the agent itself said failed is a turn that ended: it takes the next message.
        } else {
          // The process is gone: how it ended is said where its output ends.
          return;
        }
      } else if (reason === "refusal") {
        gaveUp = true;
        waiting = [];
        emit(
          { type: "event", kind: "error", text: "The model refused to answer." },
          { type: "cannot_go_on", state: "refused", reason: "model_refused" },
        );
        return;
      } else if (reason === "cancelled" || mine.cut !== undefined) {
        emit({
          type: "event",
          kind: "status",
          // An agent may end its turn where it is refused leave: nobody stopped that one.
          text:
            mine.cut === "message"
              ? "The turn was stopped for a message."
              : mine.cut === undefined && mine.refused
                ? "The agent ended the turn where it was refused leave."
                : "The turn was stopped.",
        });
      } else if (reason === "max_tokens" || reason === "max_turn_requests") {
        emit({
          type: "event",
          kind: "status",
          text:
            reason === "max_tokens"
              ? "The turn ended at the most the model writes in one."
              : "The turn ended at the most requests the agent makes in one.",
        });
      }
      // The agent is done when nothing it was sent still waits: what arrived meanwhile is its next turn.
      if (waiting.length > 0) {
        const next = waiting;
        waiting = [];
        prompt(next);
      } else {
        emit({ type: "turn_completed" });
      }
    })();
  };

  const stopTurn = (cut: "message" | "stopped"): void => {
    if (turn === undefined || turn.cut !== undefined || session === undefined) {
      return;
    }
    turn.cut = cut;
    void connection.notify("session/cancel", { sessionId: session }).catch(() => undefined);
  };

  /** Why the session could not open, said once; the process is ended, and nothing more is said of it. */
  const cannotStart = (text: string, reason: "start" | "sign_in"): void => {
    gaveUp = true;
    waiting = [];
    emit({ type: "event", kind: "error", text }, { type: "cannot_go_on", state: "failed", reason });
    void endOf(child);
  };

  const open = async (): Promise<void> => {
    const initialized = await connection.request("initialize", hello(own));
    began = true;
    const version = isObject(initialized) ? initialized.protocolVersion : undefined;
    if (version !== PROTOCOL_VERSION) {
      cannotStart(
        `The product speaks version ${String(version)} of the Agent Client Protocol, and this runner version ${PROTOCOL_VERSION}.`,
        "start",
      );
      return;
    }
    const capabilities =
      isObject(initialized) && isObject(initialized.agentCapabilities)
        ? initialized.agentCapabilities
        : {};
    takesImages =
      isObject(capabilities.promptCapabilities) && capabilities.promptCapabilities.image === true;
    saidWhatItTakes = true;
    const resumes =
      isObject(capabilities.sessionCapabilities) &&
      capabilities.sessionCapabilities.resume !== undefined &&
      capabilities.sessionCapabilities.resume !== null &&
      capabilities.sessionCapabilities.resume !== false;
    const loads = capabilities.loadSession === true;
    const place = { cwd: options.cwd, mcpServers: [] };
    let opened: unknown;
    if (options.resume !== undefined && (resumes || loads)) {
      // Gone on with where the agent can: without its history said again where it resumes, and
      // with it replayed, and left unread, where it only loads.
      replaying = !resumes;
      try {
        opened = await connection.request(resumes ? "session/resume" : "session/load", {
          sessionId: options.resume,
          ...place,
        });
        session = options.resume;
      } catch (error) {
        // Not signed in is said as that, and a process that is gone where its output ends.
        if (
          !(error instanceof RpcError) ||
          error.code === AUTH_REQUIRED ||
          SIGN_IN.test(error.message)
        ) {
          throw error;
        }
        // A conversation the agent has no more, or never kept: said, and a new one begun, as
        // the runner begins one where the conversation kept was another product's.
        emit({
          type: "event",
          kind: "status",
          text: `The agent could not go on with the conversation it had (${error.message}): a new one begins.`,
        });
      } finally {
        replaying = false;
      }
    } else if (options.resume !== undefined) {
      emit({
        type: "event",
        kind: "status",
        text: "This agent goes on with no conversation from one session to the next: a new one begins.",
      });
    }
    if (session === undefined) {
      opened = await connection.request("session/new", place);
      session = isObject(opened) ? textOf(opened.sessionId) : undefined;
      if (session === undefined) {
        cannotStart("The product opened a session and did not say which.", "start");
        return;
      }
    }
    const configuration = isObject(opened) ? opened.configOptions : undefined;
    model = choiceOf(configuration, "model");
    effort = choiceOf(configuration, "thought_level");
    await choose(model, options.model);
    await choose(effort, options.effort);
    const agent = agentOf(initialized);
    await stand(standingOf(opened), agent.name);
    product = agent.version ?? null;
    emit({ type: "conversation", id: session });
    runs();
    ready = true;
    if (waiting.length > 0) {
      const next = waiting;
      waiting = [];
      prompt(next);
    }
  };

  void (async () => {
    const reading = connection.read({
      notification: (method, params) => {
        if (method === "session/update") {
          onUpdate(params);
        }
      },
      request: onRequest,
    });
    const opening = open().catch((error: unknown) => {
      if (gaveUp || stopping) {
        return;
      }
      if (error instanceof RpcError) {
        const signIn = error.code === AUTH_REQUIRED || SIGN_IN.test(error.message);
        cannotStart(
          signIn
            ? `The product is not signed in: ${error.message}`
            : `The product did not open a session: ${error.message}`,
          signIn ? "sign_in" : "start",
        );
      }
      // Anything else is a process that is gone: how it ended is said where its output ends.
    });
    const late = wait(START_TIMEOUT_MS).then(() => {
      if (!ready && !gaveUp && !stopping) {
        cannotStart("The product did not open a session in time.", "start");
      }
    });
    void late;
    await reading;
    await opening;
    flush();
    const exit = await child.exited;
    const clean = stopping || (exit.code === 0 && exit.signal === null && exit.error === undefined);
    if (!clean && !gaveUp) {
      const errors = child.errors().trim();
      emit(
        {
          type: "event",
          kind: "error",
          text:
            exit.error !== undefined
              ? `The product could not be started: ${exit.error}`
              : `The product's process ended${exit.signal === null ? ` with code ${exit.code}` : ` on ${exit.signal}`}.${errors.length === 0 ? "" : `\n${errors}`}`,
        },
        {
          type: "cannot_go_on",
          state: "failed",
          reason: SIGN_IN.test(errors) ? "sign_in" : began ? "crashed" : "start",
        },
      );
    }
    emit({ type: "ended", how: clean ? "exited" : "crashed" });
  })();

  return {
    events: events(),
    images: () => (saidWhatItTakes ? takesImages : undefined),
    async send(message) {
      if (stopping || gaveUp) {
        throw new Error("the session takes no more input");
      }
      if (!ready || turn !== undefined) {
        waiting.push(message);
        // The protocol takes no message in a turn: one to be read now stops the turn, and is
        // the turn after.
        if (message.priority === "now") {
          stopTurn("message");
        }
        return;
      }
      prompt([message]);
    },
    async interrupt() {
      stopTurn("stopped");
    },
    async set(next) {
      const tookModel = await choose(model, next.model);
      const tookEffort = await choose(effort, next.effort);
      runs();
      return tookModel && tookEffort;
    },
    async stop() {
      stopping = true;
      await endOf(child);
    },
  };
}

/** A session that never began, with why: said once, as an agent that cannot go on. */
function unstarted(text: string): DriverSession {
  async function* events(): AsyncGenerator<DriverEvent> {
    yield { type: "event", kind: "error", text };
    yield { type: "cannot_go_on", state: "failed", reason: "start" };
    yield { type: "ended", how: "crashed" };
  }
  return {
    events: events(),
    send: async () => {
      throw new Error("the session takes no more input");
    },
    interrupt: async () => undefined,
    set: async () => false,
    stop: async () => undefined,
  };
}

/**
 * What the driver is started with: the command that speaks the protocol and its words, which
 * `runner.json` names, since there is no one product behind this driver.
 */
export function createAcpDriver(host: DriverHost): Driver {
  const command = host.command;
  const args = host.args ?? [];
  /** What the product said it is called, once it was asked. */
  let name: string | undefined;
  const start = (cwd: string, env: Readonly<Record<string, string>>): Child =>
    host.spawn(command ?? "", args, { cwd, env });
  return {
    name: "acp",
    get product() {
      return {
        name: name ?? "An agent over the Agent Client Protocol",
        tried: (name === undefined ? undefined : TRIED[name]) ?? [],
      };
    },
    // A message waits for the turn under way, or stops it: none is taken in one. Pictures, a
    // conversation gone on with and the model are the agent's to offer, and are asked of it.
    can: { steer: false, images: true, resume: true, set: true },
    permissions: { modes: MODES, unattended: UNATTENDED_MODE, least: LEAST_MODE },
    async probe(): Promise<Probe> {
      const nothing: Probe = { version: undefined, models: [], efforts: [] };
      if (command === undefined) {
        return nothing;
      }
      let child: Child;
      try {
        child = start(host.cwd, {});
      } catch {
        return nothing;
      }
      const connection = connectionOf(child);
      const reading = connection.read({
        notification: () => undefined,
        request: (id, method) => {
          void connection
            .refuse(id, METHOD_NOT_FOUND, `${method} is not offered`)
            .catch(() => undefined);
        },
      });
      const asked = (async (): Promise<Probe> => {
        const initialized = await connection.request("initialize", hello(host.version));
        const agent = agentOf(initialized);
        name = agent.name ?? name;
        try {
          // What it offers to choose from is a session's to say: one is opened, and closed
          // again where the agent closes one, so that it keeps nothing of a session nobody had.
          const opened = await connection.request("session/new", { cwd: host.cwd, mcpServers: [] });
          const configuration = isObject(opened) ? opened.configOptions : undefined;
          const capabilities =
            isObject(initialized) && isObject(initialized.agentCapabilities)
              ? initialized.agentCapabilities
              : {};
          const closes =
            isObject(capabilities.sessionCapabilities) &&
            isObject(capabilities.sessionCapabilities.close);
          const opening = isObject(opened) ? textOf(opened.sessionId) : undefined;
          if (closes && opening !== undefined) {
            await connection
              .request("session/close", { sessionId: opening })
              .catch(() => undefined);
          }
          return {
            version: agent.version,
            models: choiceOf(configuration, "model")?.values ?? [],
            efforts: choiceOf(configuration, "thought_level")?.values ?? [],
          };
        } catch {
          return { version: agent.version, models: [], efforts: [] };
        }
      })().catch(() => nothing);
      const probe = await Promise.race([asked, wait(PROBE_TIMEOUT_MS).then(() => nothing)]);
      await endOf(child);
      await reading;
      return probe;
    },
    start(options) {
      if (command === undefined) {
        return unstarted(
          "runner.json names the driver acp and no command for it: say which program speaks the protocol, as product.command.",
        );
      }
      return sessionOf(start(options.cwd, options.env), options, host.version);
    },
  };
}
