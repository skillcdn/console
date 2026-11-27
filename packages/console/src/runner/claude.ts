import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES } from "../limits.js";
import { TRANSCRIPT_PICTURE_TYPES } from "../vocabulary.js";
import { HEADLESS_TOOL, headlessServers } from "./browser.js";
import type { DriverHost } from "./registry.js";
import {
  type Child,
  type Cut,
  type Driver,
  type DriverEvent,
  type DriverMessage,
  type DriverSession,
  errorsShown,
  type Fact,
  notStarted,
  type Picture,
  plainCut,
  plainCutEnd,
  type StartOptions,
  type UsageWindow,
} from "./types.js";
import { saysUsageLimit } from "./usage.js";

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
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** How many windows of the product's allowance a line is read for: more than it has. */
const MAX_WINDOWS = 8;
/** The product's word for a window, as it spells one. */
const WINDOW = /^[a-z][a-z0-9_]{0,39}$/;
/**
 * The week's window of one model, the bucket the product keeps for a model beside the week of
 * all of them: `seven_day_overage_included`, which its own description of the line calls the
 * "overage-included weekly (per-model bucket)" window, and which its usage screen shows as the
 * week of a model by name, "Current week (Fable)". Seen beside the week's own at twice its
 * share (2.1.322). It is a window of a part of the allowance (`UsageWindow.part`): the agent
 * is told of it at the shares it is told of any window at, in words of its own.
 */
const MODEL_WEEK = "seven_day_overage_included";
/**
 * The model `MODEL_WEEK` is the week of. WRITTEN BY HAND: the line names no model with the
 * bucket (2.1.322, 2.1.330), neither beside the window nor anywhere else in it, and the product
 * keeps the one bucket for the one model its usage screen names, Fable as of 2026-11, whatever
 * model the session runs. To change when the product does:
 * - where a line comes to name the model of the bucket, read it there in place of this word;
 * - where the usage screen names another model for it, write that one here;
 * - where the product keeps such a bucket for a second model, under a word of its own
 *   (`seven_day_opus`, as it once spelled one), nothing is to do: `windowName` says it by
 *   that word already, "weekly opus".
 */
const MODEL_WEEK_OF = "fable";
/** A window of what the product allows beyond the subscription, which is no share of the subscription's. */
const BEYOND = /overage/;

/** A window's name in plain words: the product's `five_hour` and `seven_day` as a person calls them, the rest as it comes. */
const windowName = (word: string): string =>
  word
    .replace(/^five_hour/, "5-hour")
    .replace(/^seven_day/, "weekly")
    .replaceAll("_", " ");

/**
 * A moment the product gives in seconds since the epoch, in milliseconds; nothing for anything
 * that is no such number. One past the year 5000 as seconds was given in milliseconds already.
 */
function momentOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const ms = value < 1e11 ? value * 1000 : value;
  return ms < 1e14 ? Math.floor(ms) : undefined;
}

/** A share used, from 0 to 1, or nothing for anything that is no such number. */
const shareOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(1, value)
    : undefined;

/**
 * The windows of the allowance as the product says them of a request (`rate_limit_info`): each
 * of `unifiedWindows` with how much of it is used and when it resets, or the one window the
 * line itself is of where it names no others. The product marks these fields as its own and no
 * contract (seen with 2.1.330): read by shape, bounded, and nothing where they are not there.
 */
function windowsOf(info: Json): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const add = (word: unknown, one: Json): void => {
    if (typeof word !== "string" || !WINDOW.test(word) || windows.length >= MAX_WINDOWS) {
      return;
    }
    const part = word === MODEL_WEEK;
    const name = part
      ? `weekly ${MODEL_WEEK_OF}`
      : BEYOND.test(word)
        ? undefined
        : windowName(word);
    if (name === undefined) {
      return;
    }
    const used = shareOf(one.utilization);
    const resetsAt = momentOf(one.resetsAt);
    const near = one.status === "allowed_warning";
    if (used !== undefined || near) {
      windows.push({ name, used, resetsAt, ...(near ? { near } : {}), ...(part ? { part } : {}) });
    }
  };
  if (isObject(info.unifiedWindows)) {
    for (const [word, one] of Object.entries(info.unifiedWindows)) {
      if (isObject(one)) {
        add(word, one);
      }
    }
  }
  if (windows.length === 0) {
    add(info.rateLimitType, info);
  }
  return windows;
}

/**
 * Whether a line of the product's says that what the subscription allows is used up, and until
 * when where it says: its typed word for it (`api_error`, with what the refused request said of
 * the limit beside it), which the product marks as its own and no contract, or its words, which
 * it says stay the fallback. `said` is the text of a line that is an error of the product's
 * own. Written down from the product's record of a limit reached (2.1.330): no stream of one
 * was recorded, since that takes using an allowance up.
 */
function limitOf(line: Json, said: string): { readonly until: number | undefined } | undefined {
  const typed = line.api_error === "usage_limit_reached";
  if (!typed && !saysUsageLimit(said)) {
    return undefined;
  }
  const params = isObject(line.api_error_params) ? line.api_error_params : undefined;
  const info = isObject(params?.rate_limit_info) ? params.rate_limit_info : undefined;
  return { until: momentOf(info?.resetsAt) };
}

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
function inputOf(input: unknown, cut: Cut): string {
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
  return cut(whole, MAX_INPUT_LENGTH);
}

/** The most characters of what a sub-agent is called that an event carries. */
const MAX_SUBAGENT_LENGTH = 80;
/** How many calls that started a sub-agent are remembered by their ids: the oldest is let go past it. */
const MAX_SUBAGENTS = 500;
/** The product's tools that start a sub-agent, as it has called them: one whose input names a kind of sub-agent is one too. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);

/** How much of what the product says of a sub-agent that failed an event shows. */
const MAX_SUMMARY_LENGTH = 1000;

/** Keeps a word under a key among at most `MAX_SUBAGENTS`: the oldest is let go past it. */
function remember(kept: Map<string, string>, key: string, word: string): void {
  if (!kept.has(key) && kept.size >= MAX_SUBAGENTS) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) {
      kept.delete(oldest);
    }
  }
  kept.set(key, word);
}

/** A word of a call's input, trimmed, or nothing where it holds none. */
const wordOf = (input: unknown, name: string): string | undefined => {
  const word = isObject(input) ? textOf(input[name])?.trim() : undefined;
  return word === undefined || word.length === 0 ? undefined : word;
};

/**
 * What a call that starts a sub-agent calls it: the kind of sub-agent its input names and what
 * its input says it is for, the kind first (`Explore: Read src/ of acme/web`), so that two of
 * one kind at once are told apart; the one of the two the input names alone; the tool where
 * it names neither; nothing for a call that starts none. Within the bound, mark and all, cut
 * after the secrets are out of it, as everything a driver shows a part of is.
 */
function subagentOf(tool: string, input: unknown, cut: Cut): string | undefined {
  const kind = wordOf(input, "subagent_type");
  if (kind === undefined && !SUBAGENT_TOOLS.has(tool)) {
    return undefined;
  }
  const about = wordOf(input, "description");
  const name =
    kind !== undefined && about !== undefined ? `${kind}: ${about}` : (kind ?? about ?? tool);
  return cut(name, MAX_SUBAGENT_LENGTH - 1);
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
function denialOf(denial: unknown, cut: Cut): DriverEvent | undefined {
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
    text: `Denied, with nobody at the terminal to ask: ${tool} ${inputOf(denial.tool_input, cut)}`.trim(),
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
  /** The model it last said it runs, which a window of one model's own is named by. */
  model: string | undefined;
  conversation: string | undefined;
  /** The permission mode the driver asked for. */
  readonly asked: string;
  /** Whether the product was started with the server that drives the agent's browser. */
  readonly drivesBrowser: boolean;
  /** The messages written to it that it has not said it took, by the id each was written under. */
  readonly waiting: Set<string>;
  /** Whether it said of any message that it took it: a build that says none back is read without. */
  acknowledges: boolean;
  /** The tool calls of the turn it said were denied, which the turn's result says again. */
  readonly denied: Set<string>;
  /** The calls that started a sub-agent, by their ids, with what each calls it. */
  readonly subagents: Map<string, string>;
  /**
   * The sub-agents the product spoke of, by the id it knows each by as a task of its own, with
   * the id of the call that started each: what it says of a task later, that it ended, names
   * the task.
   */
  readonly tasks: Map<string, string>;
  /** The calls the product started a sub-agent of in the background, until each is answered. */
  readonly launched: Set<string>;
  /** How many sub-agents it last said are at work in the background; nothing until one is. */
  background: number | undefined;
  /**
   * The usage limit the turn under way ran into, where it did: until when, where the product
   * said, and the words it was said in, which the turn's result says again.
   */
  limit: { until: number | undefined; said: string | undefined } | undefined;
  /** When the limit resets that a request of the turn under way was refused by, where the product said so of the request. */
  resets: number | undefined;
  /** What cuts a text to what is shown of it. */
  readonly cut: Cut;
}

/**
 * Whose a line of the product is, as facts of its events (ADR-0131): a line a sub-agent wrote
 * names the call that started that sub-agent, by the id the product gave the call, as the
 * product's documentation has it (`parent_tool_use_id`), and what that call called it, where
 * the call was read. Nothing for a line of the session's own.
 */
function whoseOf(line: Json, state: Read): Record<string, Fact> {
  const parent = textOf(line.parent_tool_use_id);
  if (parent === undefined || parent.length === 0) {
    return {};
  }
  // A sub-agent's line names the sub-agent too, by the id the product's word on its tasks
  // names it by (`agent_id`; seen with 2.1.330): what the line says of the two holds over what
  // a task's start said, which names another call where a sub-agent was started again.
  const task = textOf(line.agent_id);
  if (task !== undefined && task.length > 0) {
    remember(state.tasks, task, parent);
  }
  return factsOf(parent, state);
}

/** The facts of an event of the sub-agent a call started: the call, and what it called the sub-agent where it was read. */
function factsOf(parent: string, state: Read): Record<string, Fact> {
  const subagent = state.subagents.get(parent);
  return subagent === undefined ? { parent } : { parent, subagent };
}

/** How the product says a task ended, as its documentation has the three. */
const TASK_ENDS: ReadonlySet<string> = new Set(["completed", "failed", "stopped"]);

/**
 * What the product says when a sub-agent ended (`task_notification`, as its documentation has
 * the line; seen with 2.1.322 of the three) as an event of that sub-agent's: how it ended,
 * `completed`, `failed` or `stopped`, under `over`. A sub-agent that goes on in the background is answered for when it starts, so this
 * is the one word the record has of its end. Nothing for a task that is no sub-agent the
 * driver knows the call of: a command, a watch, or one a process before this one started.
 */
function overOf(line: Json, state: Read): DriverEvent | undefined {
  const how = textOf(line.status);
  if (how === undefined || !TASK_ENDS.has(how)) {
    return undefined;
  }
  const said = textOf(line.tool_use_id);
  const parent =
    state.tasks.get(textOf(line.task_id) ?? "") ??
    (said !== undefined && state.subagents.has(said) ? said : undefined);
  if (parent === undefined) {
    return undefined;
  }
  // Why it failed is the product's to say, in words of its own: shown within a bound, cut
  // after the secrets are out.
  const why = how === "failed" ? (textOf(line.summary)?.trim() ?? "") : "";
  const text =
    how === "completed"
      ? "The sub-agent is done."
      : how === "stopped"
        ? "The sub-agent was stopped."
        : `The sub-agent failed.${why.length === 0 ? "" : `\n${state.cut(why, MAX_SUMMARY_LENGTH)}`}`;
  return { type: "event", kind: "status", text, data: { ...factsOf(parent, state), over: how } };
}

/**
 * Whether what a tool answered is the product's word that the sub-agent the call started goes
 * on in the background, and not what that sub-agent answered, as the structured output the
 * product writes beside the result says it (`tool_use_result`, whose `status` is
 * `async_launched` there, as its own declaration of the tool's output has it): the output of
 * the one result a line carries, for a call that was moved to the background after it was made.
 * A call made so says it as its sub-agent starts (`task_started`), the one word there is of a
 * call a sub-agent made, whose answer carries no such output (seen with 2.1.322).
 */
const launchedOf = (line: Json, results: number): boolean =>
  results === 1 &&
  isObject(line.tool_use_result) &&
  line.tool_use_result.status === "async_launched";

/**
 * The sub-agents at work in the background, by the product's list of its tasks there, which it
 * writes whole as it changes (`background_tasks_changed`; seen with 2.1.322). A command a
 * sub-agent left running there (`parent_task_id`) is that sub-agent at work, though it ended
 * its turn: the product starts it again when the command ends. A command of the session's own
 * is none.
 */
function agentsOf(tasks: unknown): number {
  const agents = new Set<string>();
  for (const task of listOf(tasks)) {
    if (isObject(task)) {
      const id = textOf(task.task_type === "local_agent" ? task.task_id : task.parent_task_id);
      if (id !== undefined) {
        agents.add(id);
      }
    }
  }
  return agents.size;
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
        state.model = model ?? undefined;
        const conversation = textOf(line.session_id);
        if (state.background !== undefined) {
          events.push({ type: "turn_started" });
        }
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
          // The product goes on where a server it was started with did not start, and says so
          // only here: without this line an agent that was told it has a browser has none,
          // and nobody reads why.
          const failed =
            state.drivesBrowser &&
            listOf(line.mcp_servers).some(
              (server) =>
                isObject(server) &&
                server.name === HEADLESS_TOOL.server &&
                server.status === "failed",
            );
          if (failed) {
            events.push({
              type: "event",
              kind: "status",
              text: `The agent's browser did not start: the product could not start ${HEADLESS_TOOL.command}, so this session has no browser. On this machine: ${HEADLESS_TOOL.install}, which runs on ${HEADLESS_TOOL.needs}; or name "browser": "none" in runner.json.`,
            });
          }
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
        // The runner's to know too: what the agent was handed before is a summary at best.
        events.push({ type: "compacted" });
      } else if (line.subtype === "api_retry") {
        const attempt = typeof line.attempt === "number" ? line.attempt : null;
        events.push({
          type: "event",
          kind: "error",
          text: "The product is asking the model again after a request that failed.",
          data: { attempt },
        });
      } else if (line.subtype === "task_started") {
        // A sub-agent is a task of the product's own, which names the call that started it
        // (`task_type`, `tool_use_id`, as its documentation has them).
        const task = textOf(line.task_id);
        const call = textOf(line.tool_use_id);
        if (line.task_type === "local_agent" && task !== undefined && call !== undefined) {
          const known = state.tasks.get(task);
          if (known === undefined) {
            remember(state.tasks, task, call);
            if (line.is_backgrounded === true) {
              state.launched.add(call);
            }
          } else {
            // One known already is started again, by a message the agent sent it or by the
            // product once a command of its own ended (seen with 2.1.322): an event of the
            // sub-agent's, under the call its events name, whatever call this line names.
            events.push({
              type: "event",
              kind: "status",
              text: "The sub-agent was started again.",
              data: factsOf(known, state),
            });
          }
        }
      } else if (line.subtype === "background_tasks_changed") {
        const agents = agentsOf(line.tasks);
        if (agents !== (state.background ?? 0)) {
          state.background = agents;
          events.push({ type: "background", agents });
        }
      } else if (line.subtype === "task_notification") {
        const over = overOf(line, state);
        if (over !== undefined) {
          events.push(over);
        }
      } else if (line.subtype === "permission_denied") {
        // Said when it happens, and again in the turn's result, which is then not said twice.
        const denied = denialOf(line, state.cut);
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
      const whose = whoseOf(line, state);
      // A fact is said only where there is one: a line of the session's own carries none.
      const said = Object.keys(whose).length === 0 ? {} : { data: whose };
      // An error of the product's own, which it writes in the model's place: where it says the
      // usage limit is reached, in the session's own turn, it is the product's word and no
      // answer of the agent's, and the turn's result is read by it.
      if (
        (typeof line.error === "string" || line.is_api_error_message === true) &&
        Object.keys(whose).length === 0
      ) {
        const words = blocks
          .flatMap((block) =>
            isObject(block) && block.type === "text" && typeof block.text === "string"
              ? [block.text]
              : [],
          )
          .join("\n");
        const limit = limitOf(line, words);
        if (limit !== undefined) {
          state.limit = { until: limit.until, said: words };
          events.push({
            type: "event",
            kind: "error",
            text: words.length === 0 ? "The product's usage limit is reached." : words,
            data: { limit: "reached" },
          });
          return events;
        }
      }
      for (const block of blocks) {
        if (!isObject(block)) {
          continue;
        }
        if (block.type === "text" && typeof block.text === "string") {
          events.push({ type: "event", kind: "assistant", text: block.text, ...said });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          // A thought the product sends with no words, its signature alone, is no event: it
          // would show nothing, and count against what an hour of a session takes.
          if (block.thinking.trim().length > 0) {
            events.push({ type: "event", kind: "thinking", text: block.thinking, ...said });
          }
        } else if (block.type === "tool_use") {
          const tool = textOf(block.name) ?? "a tool";
          const id = textOf(block.id);
          const subagent = subagentOf(tool, block.input, state.cut);
          if (id !== undefined && subagent !== undefined) {
            // What the sub-agent this call starts does names the call: remembered by its id.
            remember(state.subagents, id, subagent);
          }
          events.push({
            type: "event",
            kind: "tool_call",
            text: inputOf(block.input, state.cut),
            // A call that starts a sub-agent says so, with what it calls it: a page then knows
            // of the sub-agent before its first line arrives.
            data: {
              tool,
              id: id ?? null,
              ...(subagent === undefined ? {} : { starts: subagent }),
              ...whose,
            },
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
          events.push({ type: "taken" });
        }
        return events;
      }
      // What came back from a tool is recorded here, a sub-agent's tool as the session's own.
      const whose = whoseOf(line, state);
      const results = blocks.filter((block) => isObject(block) && block.type === "tool_result");
      // An answer that says the sub-agent goes on in the background is not that sub-agent's
      // answer: said, so that whoever reads the session takes it for at work from there on.
      const moved = launchedOf(line, results.length);
      for (const block of results) {
        if (!isObject(block)) {
          continue;
        }
        const launched = state.launched.delete(textOf(block.tool_use_id) ?? "") || moved;
        state.results += 1;
        const result = resultOf(block.content, `tool-${state.results}`);
        events.push({
          type: "event",
          kind: "tool_result",
          text: result.text,
          data: {
            id: textOf(block.tool_use_id) ?? null,
            error: block.is_error === true,
            ...(launched ? { background: true } : {}),
            ...whose,
          },
          pictures: result.pictures,
        });
      }
      return events;
    }
    case "result": {
      for (const denial of Array.isArray(line.permission_denials) ? line.permission_denials : []) {
        const denied = denialOf(denial, state.cut);
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
      // A turn that ended on the usage limit: the agent cannot go on until a window resets, and
      // whatever it was handed and had not answered is the runner's to hand over again. Said
      // once, though the product writes it twice, in the model's place and as the result.
      const met = state.limit;
      const resets = state.resets;
      state.limit = undefined;
      state.resets = undefined;
      const limit = line.is_error === true && !stopped ? (limitOf(line, said) ?? met) : undefined;
      if (limit !== undefined) {
        // A build that says no message back: what it was written is not waited for here, and
        // is the runner's to hand over again.
        if (!state.acknowledges) {
          state.waiting.clear();
        }
        if (met?.said === undefined || (said.length > 0 && said !== met.said)) {
          events.push({
            type: "event",
            kind: "error",
            text: said.length === 0 ? "The product's usage limit is reached." : said,
            data: { limit: "reached" },
          });
        }
        events.push({
          type: "cannot_go_on",
          state: "failed",
          reason: "usage_limit",
          until: limit.until ?? met?.until ?? resets,
        });
        return events;
      }
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
        state.waiting.forEach(() => {
          events.push({ type: "taken" });
        });
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
    case "rate_limit_event": {
      // What the product says of the allowance after a request: said on as it is, for the
      // runner to tell its agent by. A request the limit refused says when the limit resets.
      const info = isObject(line.rate_limit_info) ? line.rate_limit_info : undefined;
      if (info === undefined) {
        return events;
      }
      const windows = windowsOf(info);
      if (windows.length > 0) {
        events.push({ type: "usage", windows });
      }
      if (info.status === "rejected") {
        state.resets = momentOf(info.resetsAt) ?? state.resets;
      }
      return events;
    }
    case "command_lifecycle": {
      // What the product says became of a message: one it is done with, or will not take, is
      // not waited for, whether or not it was said back.
      const id = textOf(line.command_uuid);
      if (
        id !== undefined &&
        (line.state === "completed" || line.state === "cancelled") &&
        state.waiting.delete(id) &&
        line.state === "completed"
      ) {
        // Done with, and never said back: taken all the same.
        events.push({ type: "taken" });
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

function sessionOf(
  child: Child,
  command: string,
  asked: string,
  drivesBrowser: boolean,
  uuid: () => string,
  cut: Cut,
  cutEnd: Cut,
): DriverSession {
  let stopping = false;
  const state: Read = {
    began: false,
    results: 0,
    runs: undefined,
    model: undefined,
    conversation: undefined,
    asked,
    drivesBrowser,
    waiting: new Set(),
    denied: new Set(),
    acknowledges: false,
    subagents: new Map(),
    tasks: new Map(),
    launched: new Set(),
    background: undefined,
    limit: undefined,
    resets: undefined,
    cut,
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
      // Its end, cut after the secrets are out, so that none stands at the cut.
      const shown = errorsShown(said, cutEnd);
      const text =
        exit.error !== undefined
          ? notStarted(exit.error, command)
          : `The product's process ended${exit.signal === null ? ` with code ${exit.code}` : ` on ${exit.signal}`}.${shown.length === 0 ? "" : `\n${shown}`}`;
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

/**
 * A word that goes on the product's command line: a model or a level of effort as the console
 * spells one, a conversation's id. Anything else is no such word, and is left out: it never
 * becomes an option of the product's, which a value that begins with a dash would be read as.
 */
const WORD = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,199}$/;
const word = (value: string | null | undefined): string | undefined =>
  typeof value === "string" && WORD.test(value) ? value : undefined;

/**
 * The arguments the product is started with. `platform` is the system the runner is on, as the
 * runtime names it: what a program named beside the product's own is started as.
 */
/** Whether a browser a desk names is the one the driver has the product start a server for. */
const drivesBrowser = (browser: string | undefined): boolean =>
  browser === "headless" || browser === "window";

export function claudeArguments(options: StartOptions, platform?: string): readonly string[] {
  const model = word(options.model);
  const effort = word(options.effort);
  const resume = word(options.resume);
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
    // The product's browser tool is off in a run nobody attends unless it is asked for when the
    // product starts: seen with 2.1.329, where its own setting for it did nothing in this mode.
    ...(options.browser === "chrome" ? ["--chrome"] : []),
    // A headless browser is no tool of the product's own (ADR-0151): the product starts the
    // program that drives one as a server of its own, named here for this run alone, and its
    // settings are left as they are. The server's tools are leave for nothing by themselves:
    // the mode decides of them as of every tool. The option takes every word after it up to
    // the next option, so an option follows it, and never a word of its own.
    ...(drivesBrowser(options.browser)
      ? ["--mcp-config", JSON.stringify(headlessServers(platform, options.browser === "window"))]
      : []),
    ...(model === undefined ? [] : ["--model", model]),
    ...(effort === undefined ? [] : ["--effort", effort]),
    ...(resume === undefined ? [] : ["--resume", resume]),
  ];
}

/**
 * The builds of the binary the driver was run against, a turn, a tool call, a picture each way,
 * a message during a tool call, a turn stopped for a message, a denial and a conversation gone
 * on with: what the fixtures of the tests were written down from, of the first two. The third
 * kept an agent account at work against a live console for a day, its browser tool among it,
 * and no fixture was taken of it.
 */
const TRIED = ["2.1.321", "2.1.322", "2.1.329"] as const;

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
        host.spawn(command, claudeArguments(options, host.platform), {
          cwd: options.cwd,
          env: options.env,
        }),
        command,
        claudeMode(options.permissions),
        drivesBrowser(options.browser),
        uuid,
        options.cut ?? plainCut,
        options.cutEnd ?? plainCutEnd,
      );
    },
  };
}
