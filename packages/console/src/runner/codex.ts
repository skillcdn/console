import type { DriverHost } from "./registry.js";
import type {
  Child,
  Driver,
  DriverEvent,
  DriverMessage,
  DriverSession,
  Fact,
  StartOptions,
} from "./types.js";

// The `codex` driver (docs/specs/runner.md): the Codex binary, unmodified, run with nobody at
// its terminal, `codex exec --json`. A process a turn: the message on its standard input, an
// event a line on its standard output, and the conversation gone on with by the id its first
// turn named. The product takes no message while a turn runs, so one that arrives then waits
// for the turn to end, and one that is to be read now ends the turn's process first.
//
// Written from what the binary printed when it was run (0.164.0), with its own help for the
// words it is started with; what was not seen there is marked where it is read. Everything the
// product prints is data: read by shape, never run, and bounded by the runner before it is
// sent on.

/** How long a process asked to end is given before it is killed. */
const KILL_GRACE_MS = 5000;
/** How much of a tool's input a tool call shows. */
const MAX_INPUT_LENGTH = 4000;
/** How many models, and how many levels of effort, are read from the product's own list. */
const MAX_OFFERED = 50;
/** How much of its list of models is read: it carries each model's own instructions. */
const MAX_CATALOG_LENGTH = 8 * 1024 * 1024;

/**
 * A word that goes on the product's command line: a model, a level of effort, a conversation's
 * id. Anything else is no such word, and is left out: it never becomes an option of the
 * product's, or a setting beside the one it was meant for.
 */
const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const word = (value: string | null | undefined): string | undefined =>
  typeof value === "string" && WORD.test(value) ? value : undefined;

/**
 * What an error says when the product is not signed in or its login ran out. Its words for it
 * were not seen, since that takes signing it out: read by pattern, and no contract.
 */
const SIGN_IN =
  /not (?:logged|signed) in|codex login|log ?in again|sign in again|\b401\b|unauthorized|token (?:has )?(?:expired|been revoked)|invalid (?:api )?key/i;

/** The product's words for what runs without asking: its three sandboxes, and the flag by which its own reviewer answers what a sandbox would ask. */
const MODES = ["read-only", "workspace-write", "approve-for-me", "danger-full-access"] as const;
/**
 * The mode the driver names where the desk names none. A product is started in its own default
 * wherever that default is one for a run nobody attends, and its driver then names nothing.
 * This product's is not: with nobody at its terminal it runs in its read-only sandbox, where a
 * file written is refused (seen with 0.164.0). So the driver names the mode the product has
 * for such a run, in which the desk may be written and the product's own reviewer answers what
 * would otherwise be asked of a person.
 */
const UNATTENDED_MODE = "approve-for-me";
/** The mode that allows the least: nothing is written. */
const LEAST_MODE = "read-only";

/**
 * The mode a session runs in: the one above where the desk names none. A mode named that is
 * none of the product's is a mistake in the desk's file, and is never read as leave to do more.
 */
export function codexMode(named: string | undefined): string {
  return named === undefined
    ? UNATTENDED_MODE
    : (MODES.find((mode) => mode === named) ?? LEAST_MODE);
}

/**
 * A mode as the settings the product takes at any turn, a conversation begun or one gone on
 * with: a turn keeps nothing of the mode the turn before ran in. Whatever a mode does not allow
 * is asked of nobody: refused, or answered by the product's reviewer.
 */
function modeArguments(mode: string): readonly string[] {
  const set = (key: string, value: string): string[] => ["-c", `${key}="${value}"`];
  switch (mode) {
    case "approve-for-me":
      return [
        ...set("sandbox_mode", "workspace-write"),
        ...set("approval_policy", "on-request"),
        ...set("approvals_reviewer", "auto_review"),
      ];
    case "workspace-write":
    case "danger-full-access":
      return [...set("sandbox_mode", mode), ...set("approval_policy", "never")];
    default:
      return [...set("sandbox_mode", "read-only"), ...set("approval_policy", "never")];
  }
}

/** The arguments one turn of the product is started with. */
export function codexArguments(turn: {
  readonly model: string | null;
  readonly effort: string | null;
  readonly permissions: string | undefined;
  /** The conversation to go on with, or nothing for a new one. */
  readonly conversation: string | undefined;
}): readonly string[] {
  const model = word(turn.model);
  const effort = word(turn.effort);
  const conversation = word(turn.conversation);
  return [
    "exec",
    ...(conversation === undefined ? [] : ["resume"]),
    "--json",
    // The desk is the agent's own, a repository or not one yet.
    "--skip-git-repo-check",
    ...modeArguments(codexMode(turn.permissions)),
    ...(model === undefined ? [] : ["-m", model]),
    ...(effort === undefined ? [] : ["-c", `model_reasoning_effort="${effort}"`]),
    ...(conversation === undefined ? [] : [conversation]),
    // The message is read from the standard input.
    "-",
  ];
}

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

const bounded = (text: string): string =>
  text.length > MAX_INPUT_LENGTH ? `${text.slice(0, MAX_INPUT_LENGTH)}…` : text;

/** Anything as a line of text a person reads, bounded. */
function shown(value: unknown): string {
  if (typeof value === "string") {
    return bounded(value);
  }
  try {
    return bounded(JSON.stringify(value) ?? "");
  } catch {
    return "";
  }
}

/**
 * What an error of the product says. It writes one as the answer of the service it asked, a
 * line of JSON inside its line, where the service answered; the words are read out of it.
 */
function errorOf(message: unknown): string {
  const text = textOf(message) ?? "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (isObject(parsed) && isObject(parsed.error) && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {
    // Words, and not an answer of the service: said as they are.
  }
  return text;
}

/** What the lines of one session left so far, for the next line to be read by. */
interface Read {
  /** Whether the product said that a conversation began. */
  began: boolean;
  /** What was last said of how it runs, and the conversation it last named. */
  runs: string | undefined;
  conversation: string | undefined;
  /** The tool calls said already, by the product's id for each. */
  readonly called: Set<string>;
  /** The last error said, which the product writes twice where a turn fails of it. */
  error: string | undefined;
  /** Whether the turn under way said that it completed, and what it said where it failed. */
  completed: boolean;
  failed: string | undefined;
}

/** What a turn runs with, as the session's first event and the heartbeat say it. */
interface Runs {
  readonly model: string | null;
  readonly effort: string | null;
  readonly mode: string;
}

/** A tool call of the product, by the kind of item it writes for one: its name and its input as a line. */
function callOf(item: Json): { readonly tool: string; readonly text: string } | undefined {
  switch (item.type) {
    case "command_execution":
      return { tool: "command_execution", text: shown(item.command ?? "") };
    case "file_change": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return {
        tool: "file_change",
        text: bounded(
          changes
            .filter(isObject)
            .map((change) => `${textOf(change.kind) ?? "change"} ${textOf(change.path) ?? ""}`)
            .join("\n"),
        ),
      };
    }
    // The two below are in the shape the product's documentation gives them: not seen run.
    case "mcp_tool_call":
      return {
        tool: `${textOf(item.server) ?? "mcp"}.${textOf(item.tool) ?? "tool"}`,
        text: item.arguments === undefined ? "" : shown(item.arguments),
      };
    case "web_search":
      return { tool: "web_search", text: shown(item.query ?? "") };
    default:
      return undefined;
  }
}

/** What came back from a tool call, where the product says: a command's output, or what a tool answered. */
function resultOf(item: Json): string {
  if (item.type === "command_execution") {
    return textOf(item.aggregated_output) ?? "";
  }
  if (item.type === "mcp_tool_call") {
    if (isObject(item.error) && typeof item.error.message === "string") {
      return item.error.message;
    }
    return item.result === undefined || item.result === null ? "" : shown(item.result);
  }
  return "";
}

/** The events of one line of the product's output. `read` is what the lines before it left. */
function eventsOf(line: Json, read: Read, runs: Runs): DriverEvent[] {
  const events: DriverEvent[] = [];
  const item = isObject(line.item) ? line.item : undefined;
  switch (line.type) {
    case "thread.started": {
      // Written at the start of every turn: said on once, and again where it is something else.
      const said = JSON.stringify([runs.model, runs.effort]);
      const conversation = textOf(line.thread_id);
      if (said !== read.runs) {
        // The product names neither its model nor its version here: what it was asked for.
        events.push({ type: "running", model: runs.model, effort: runs.effort, version: null });
      }
      if (conversation !== undefined && conversation !== read.conversation) {
        events.push({ type: "conversation", id: conversation });
      }
      if (!read.began) {
        events.push({
          type: "event",
          kind: "status",
          text: "The product started.",
          data: { model: runs.model, effort: runs.effort, version: null, mode: runs.mode },
        });
      }
      read.began = true;
      read.runs = said;
      read.conversation = conversation ?? read.conversation;
      return events;
    }
    case "item.started": {
      const call = item === undefined ? undefined : callOf(item);
      const id = textOf(item?.id);
      if (call !== undefined) {
        events.push({
          type: "event",
          kind: "tool_call",
          text: call.text,
          data: { tool: call.tool, id: id ?? null },
        });
        if (id !== undefined) {
          read.called.add(id);
        }
      }
      return events;
    }
    case "item.completed": {
      if (item === undefined) {
        return events;
      }
      const id = textOf(item.id);
      if (item.type === "agent_message" && typeof item.text === "string") {
        events.push({ type: "event", kind: "assistant", text: item.text });
      } else if (item.type === "reasoning" && typeof item.text === "string") {
        // As the product's documentation has it: none was written in the runs it was tried in.
        events.push({ type: "event", kind: "thinking", text: item.text });
      } else if (item.type === "error") {
        // A word of warning inside a turn: the turn goes on.
        events.push({ type: "event", kind: "error", text: errorOf(item.message) });
      } else {
        const call = callOf(item);
        if (call === undefined) {
          return events;
        }
        // A call the product wrote no beginning of is said with its end.
        if (id === undefined || !read.called.delete(id)) {
          events.push({
            type: "event",
            kind: "tool_call",
            text: call.text,
            data: { tool: call.tool, id: id ?? null },
          });
        }
        if (item.type === "web_search") {
          return events;
        }
        const exit = typeof item.exit_code === "number" ? item.exit_code : null;
        const data: Record<string, Fact> = {
          id: id ?? null,
          error: item.status === "failed" || (exit !== null && exit !== 0),
        };
        if (exit !== null) {
          data.exit = exit;
        }
        events.push({
          type: "event",
          kind: "tool_result",
          text: resultOf(item),
          data,
          pictures: [],
        });
      }
      return events;
    }
    case "turn.completed":
      read.completed = true;
      return events;
    case "turn.failed":
    case "error": {
      const said = errorOf(
        line.type === "error" ? line.message : isObject(line.error) ? line.error.message : "",
      );
      if (line.type === "turn.failed") {
        read.failed = said;
      }
      // The product writes what failed a turn twice: as an error, and as the turn's failing.
      if (said !== read.error) {
        events.push({
          type: "event",
          kind: "error",
          text: said.length === 0 ? "The turn ended with an error." : said,
        });
      }
      read.error = said;
      return events;
    }
    default:
      return events;
  }
}

const wait = (ms: number): Promise<"timeout"> =>
  new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms).unref?.();
  });

/** Ends a process: asked first, then killed. */
async function endOf(child: Child): Promise<void> {
  child.kill("SIGTERM");
  if ((await Promise.race([child.exited, wait(KILL_GRACE_MS)])) === "timeout") {
    child.kill("SIGKILL");
  }
}

function sessionOf(
  host: { readonly spawn: DriverHost["spawn"]; readonly command: string },
  options: StartOptions,
): DriverSession {
  // What the session says, in order, for whoever reads it: until it ends.
  const said: DriverEvent[] = [];
  let reader: (() => void) | undefined;
  const emit = (...events: DriverEvent[]): void => {
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

  const read: Read = {
    began: false,
    runs: undefined,
    conversation: undefined,
    called: new Set(),
    error: undefined,
    completed: false,
    failed: undefined,
  };
  const mode = codexMode(options.permissions);
  let conversation = word(options.resume);
  let choice = { model: options.model, effort: options.effort };
  /** The turn under way: its process, why it was ended where it was, and when it is read to its end. */
  let turn:
    | {
        readonly child: Child;
        cut: "message" | "stopped" | "ended" | undefined;
        done: Promise<void>;
      }
    | undefined;
  /** The messages that arrived while a turn ran: the next turn's. */
  let waiting: DriverMessage[] = [];
  let over = false;

  const run = (messages: readonly DriverMessage[]): void => {
    const child = host.spawn(
      host.command,
      codexArguments({ ...choice, permissions: options.permissions, conversation }),
      { cwd: options.cwd, env: options.env },
    );
    const mine: NonNullable<typeof turn> = { child, cut: undefined, done: Promise.resolve() };
    const runs: Runs = {
      model: word(choice.model) ?? null,
      effort: word(choice.effort) ?? null,
      mode,
    };
    read.completed = false;
    read.failed = undefined;
    read.error = undefined;
    read.called.clear();
    turn = mine;
    mine.done = (async () => {
      try {
        // One message: what arrived together is read together, each under its own header.
        await child.write(messages.map((message) => message.text).join("\n\n"));
      } catch {
        // A process that is gone takes nothing: how it ended says the rest.
      }
      child.end();
      try {
        for await (const text of child.lines) {
          const line = lineOf(text);
          if (line !== undefined) {
            emit(...eventsOf(line, read, runs));
          }
        }
      } catch {
        // The output closed in the middle of a line: how the process ended says the rest.
      }
      const exit = await child.exited;
      conversation = word(read.conversation) ?? conversation;
      turn = undefined;
      if (mine.cut === "ended") {
        return;
      }
      if (mine.cut !== undefined) {
        emit({
          type: "event",
          kind: "status",
          text:
            mine.cut === "message"
              ? "The turn was stopped for a message."
              : "The turn was stopped.",
        });
      } else if (exit.error !== undefined) {
        emit(
          { type: "event", kind: "error", text: `The product could not be started: ${exit.error}` },
          { type: "cannot_go_on", state: "failed", reason: "start" },
        );
        // Nothing was taken: the runner sends again what it sent.
        waiting = [];
        return;
      } else if (!read.completed) {
        const errors = child.errors().trim();
        if (read.failed === undefined) {
          emit({
            type: "event",
            kind: "error",
            text: `The product's process ended${exit.signal === null ? ` with code ${exit.code}` : ` on ${exit.signal}`} before the turn did.${errors.length === 0 ? "" : `\n${errors}`}`,
          });
        }
        if (SIGN_IN.test(`${read.failed ?? ""}\n${errors}`)) {
          emit({ type: "cannot_go_on", state: "failed", reason: "sign_in" });
          waiting = [];
          return;
        }
        // A turn that ended with any other error is a turn that ended: the agent takes the next message.
      }
      // The agent is done when nothing it was sent still waits: what arrived meanwhile is its next turn.
      if (waiting.length > 0) {
        const next = waiting;
        waiting = [];
        run(next);
      } else {
        emit({ type: "turn_completed" });
      }
    })();
  };

  return {
    events: events(),
    async send(message) {
      if (over) {
        throw new Error("the session takes no more input");
      }
      if (turn === undefined) {
        run([message]);
        return;
      }
      waiting.push(message);
      // The product takes no message in a turn: one to be read now ends the turn's process.
      if (message.priority === "now" && turn.cut === undefined) {
        turn.cut = "message";
        void endOf(turn.child);
      }
    },
    async interrupt() {
      if (turn !== undefined && turn.cut === undefined) {
        turn.cut = "stopped";
        void endOf(turn.child);
      }
    },
    // Each turn is started with them: taken from the next turn on.
    async set(next) {
      choice = {
        model: next.model === undefined ? choice.model : next.model,
        effort: next.effort === undefined ? choice.effort : next.effort,
      };
      return true;
    },
    async stop() {
      if (over) {
        return;
      }
      over = true;
      waiting = [];
      const open = turn;
      if (open !== undefined) {
        open.cut = "ended";
        await endOf(open.child);
        await open.done;
      }
      emit({ type: "ended", how: "exited" });
    },
  };
}

/** The models and the levels of effort of the product's own list, as far as it reads as one. */
function offeredOf(text: string): { models: string[]; efforts: string[] } {
  const models: string[] = [];
  const efforts: string[] = [];
  let catalog: unknown;
  try {
    catalog = JSON.parse(text);
  } catch {
    return { models, efforts };
  }
  for (const model of isObject(catalog) && Array.isArray(catalog.models) ? catalog.models : []) {
    // The models the product lists for a person to choose from, and no other.
    if (!isObject(model) || model.visibility !== "list") {
      continue;
    }
    const slug = word(textOf(model.slug));
    if (slug !== undefined && !models.includes(slug) && models.length < MAX_OFFERED) {
      models.push(slug);
    }
    const levels = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels
      : [];
    for (const level of levels) {
      const effort = word(isObject(level) ? textOf(level.effort) : textOf(level));
      if (effort !== undefined && !efforts.includes(effort) && efforts.length < MAX_OFFERED) {
        efforts.push(effort);
      }
    }
  }
  return { models, efforts };
}

/** The builds of the binary the driver was run against: what the fixtures of the tests were written down from. */
const TRIED = ["0.164.0-alpha.11.1"] as const;

export function createCodexDriver(host: DriverHost): Driver {
  const command = host.command ?? "codex";
  /** What the product prints for a command that asks it something, or nothing where it could not be asked. */
  const asked = async (args: readonly string[]): Promise<string | undefined> => {
    try {
      const child = host.spawn(command, args, { cwd: host.cwd, env: {} });
      child.end();
      let text = "";
      for await (const line of child.lines) {
        if (text.length <= MAX_CATALOG_LENGTH) {
          text = text.length === 0 ? line : `${text}\n${line}`;
        }
      }
      const exit = await child.exited;
      return exit.error === undefined && text.length <= MAX_CATALOG_LENGTH ? text : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    name: "codex",
    product: { name: "Codex", tried: TRIED },
    // No message is taken in a turn, and a picture is taken as a file, which the driver has
    // nowhere to write: neither is offered. The model and the effort are each turn's.
    can: { steer: false, images: false, resume: true, set: true },
    permissions: { modes: MODES, unattended: UNATTENDED_MODE, least: LEAST_MODE },
    async probe() {
      // One line: what the command is called, then its version.
      const version = /(\d+\.\d+\.\d+[^\s]*)/.exec((await asked(["--version"])) ?? "")?.[1];
      // The product's own list of its models, which it prints for whoever debugs it.
      const offered = offeredOf((await asked(["debug", "models"])) ?? "");
      return { version, models: offered.models, efforts: offered.efforts };
    },
    start(options) {
      return sessionOf({ spawn: host.spawn, command }, options);
    },
  };
}
