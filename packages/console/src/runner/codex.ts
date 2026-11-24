import { randomUUID } from "node:crypto";
import type { DriverHost } from "./registry.js";
import { connectionOf, METHOD_NOT_FOUND, RpcError } from "./rpc.js";
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
  plainCut,
  plainCutEnd,
  type StartOptions,
} from "./types.js";

// The `codex` driver (docs/specs/runner.md, ADR-0153): the Codex binary, unmodified, run as its
// app server, `codex app-server`: one process a session, spoken to over its standard input and
// output, a JSON-RPC message a line. A conversation is a thread of the product's, begun or gone
// on with when the session opens. A message starts a turn, and one that arrives while a turn
// runs is put into that turn (`turn/steer`), where the product reads it after the step under
// way; one that is to be read now stops the turn first.
//
// Written from the protocol as the binary itself writes it out (`codex app-server
// generate-ts`, 0.172.0), from the product's own source at that build, and from what the binary
// answered when it was spoken to signed out, 0.139.0, 0.167.0 and 0.172.0: a thread begun and
// gone on with, a turn started, a message put into it and said back, a turn stopped, a turn
// that failed for the sign-in, and what it refuses. A turn of a signed-in product, with its
// tools, is in the shapes of that protocol and was not seen run. Everything the product writes
// is data: read by shape, never run, and bounded by the runner before it is sent on.

/** The words the product is started with: its app server, on its standard input and output. */
const ARGUMENTS = ["app-server"] as const;
/** How long a session that is stopped is given to end by itself, then after it was asked to. */
const STOP_GRACE_MS = 5000;
const KILL_GRACE_MS = 2000;
/** How long the product is given to open a conversation. */
const START_TIMEOUT_MS = 120_000;
/** How much of a tool's input a tool call shows. */
const MAX_INPUT_LENGTH = 4000;
/** How many models, and how many levels of effort, are read from the product's own list. */
const MAX_OFFERED = 50;
/** How much of its list of models is read: it carries each model's own instructions. */
const MAX_CATALOG_LENGTH = 8 * 1024 * 1024;

/**
 * A word the product is handed as one: a model, a level of effort, a conversation's id.
 * Anything else is no such word, and is left out.
 */
const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const word = (value: string | null | undefined): string | undefined =>
  typeof value === "string" && WORD.test(value) ? value : undefined;

/**
 * What an error says when the product is not signed in or its login ran out, beside the status
 * the service answered with. Seen signed out (0.172.0): `unexpected status 401 Unauthorized:
 * Missing bearer or basic authentication in header`. The rest is read by pattern, and no contract.
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

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * A mode as the settings a conversation is begun or gone on with, each said whole: a thread
 * keeps what it last ran with, and one gone on with ran in whatever the desk named then.
 * Whatever a mode does not allow is asked of nobody: refused, or answered by the product's
 * reviewer.
 */
function modeSettings(mode: string): Json {
  switch (mode) {
    case "approve-for-me":
      return {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
      };
    case "workspace-write":
    case "danger-full-access":
      return { sandbox: mode, approvalPolicy: "never", approvalsReviewer: "user" };
    default:
      return { sandbox: "read-only", approvalPolicy: "never", approvalsReviewer: "user" };
  }
}

/**
 * What the product is asked to keep to itself: a block as it grows, a piece at a time, where
 * the driver reads whole blocks, and counts nobody asked for.
 */
const UNREAD = [
  "thread/started",
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/plan/delta",
  "thread/tokenUsage/updated",
  "account/rateLimits/updated",
] as const;

/** What the runner says of itself when it begins: nothing of the product's that is still an experiment is asked for. */
const hello = (version: string | undefined): Json => ({
  clientInfo: {
    name: "skillcdn-console-runner",
    title: "SkillCDN Console runner",
    version: version ?? "0.0.0",
  },
  capabilities: { experimentalApi: false, optOutNotificationMethods: UNREAD },
});

/**
 * A path the product is handed as a picture: one the runner wrote under the desk's
 * `work/inbox/`, and no other file of the machine.
 */
const PICTURE_PATH = /^work\/inbox\/[1-9]\d{0,15}\/([^/\\]{1,200})$/;
const isPicturePath = (path: string): boolean => {
  const name = PICTURE_PATH.exec(path)?.[1];
  return name !== undefined && !/^\.+$/.test(name);
};

/**
 * Messages as the input of a turn: what arrived together is read together, each under its own
 * header, and every picture of it goes with it, as a file by its path in the desk.
 */
function inputOf(messages: readonly DriverMessage[], desk: string): Json[] {
  const root = desk.replace(/[\\/]+$/, "");
  return [
    { type: "text", text: messages.map((message) => message.text).join("\n\n"), text_elements: [] },
    ...messages.flatMap((message) =>
      message.images.flatMap((picture) =>
        picture.path !== undefined && isPicturePath(picture.path)
          ? [{ type: "localImage", path: `${root}/${picture.path}` }]
          : [],
      ),
    ),
  ];
}

/** Anything as a line of text a person reads, bounded. */
function shown(value: unknown, cut: Cut): string {
  if (typeof value === "string") {
    return cut(value, MAX_INPUT_LENGTH);
  }
  try {
    return cut(JSON.stringify(value) ?? "", MAX_INPUT_LENGTH);
  } catch {
    return "";
  }
}

/**
 * What an error of the product says: its message, with what it carries beside it. It may write
 * the message as the answer of the service it asked, a line of JSON, where the service
 * answered; the words are read out of it.
 */
function errorOf(error: unknown): string {
  const said = isObject(error) ? error : {};
  let message = textOf(said.message)?.trim() ?? "";
  try {
    const parsed: unknown = JSON.parse(message);
    if (isObject(parsed) && isObject(parsed.error) && typeof parsed.error.message === "string") {
      message = parsed.error.message;
    }
  } catch {
    // Words, and not an answer of the service: said as they are.
  }
  const more = textOf(said.additionalDetails)?.trim() ?? "";
  if (more.length === 0 || message.includes(more)) {
    return message;
  }
  return message.length === 0 ? more : `${message}\n${more}`;
}

/**
 * Whether an error says that the product is not signed in: in the product's own word for it,
 * by the status the service refused it with, or in its words.
 */
function signedOut(error: unknown): boolean {
  const info = isObject(error) ? error.codexErrorInfo : undefined;
  const refused =
    isObject(info) &&
    Object.values(info).some((one) => isObject(one) && one.httpStatusCode === 401);
  return info === "unauthorized" || refused || SIGN_IN.test(errorOf(error));
}

/** A tool call of the product, by the kind of item it writes for one: its name and its input as a line. */
function callOf(
  item: Json,
  cut: Cut,
): { readonly tool: string; readonly text: string } | undefined {
  switch (item.type) {
    case "commandExecution":
      return { tool: "command_execution", text: shown(item.command ?? "", cut) };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return {
        tool: "file_change",
        text: cut(
          changes
            .filter(isObject)
            .map((change) => {
              const kind = isObject(change.kind) ? textOf(change.kind.type) : textOf(change.kind);
              return `${kind ?? "change"} ${textOf(change.path) ?? ""}`;
            })
            .join("\n"),
          MAX_INPUT_LENGTH,
        ),
      };
    }
    case "mcpToolCall":
      return {
        tool: `${textOf(item.server) ?? "mcp"}.${textOf(item.tool) ?? "tool"}`,
        text: item.arguments === undefined ? "" : shown(item.arguments, cut),
      };
    case "webSearch":
      return { tool: "web_search", text: shown(item.query ?? "", cut) };
    default:
      return undefined;
  }
}

/** What came back from a tool call, where the product says: a command's output, or what a tool answered. */
function resultOf(item: Json, cut: Cut): string {
  if (item.type === "commandExecution") {
    return textOf(item.aggregatedOutput) ?? "";
  }
  if (item.type === "mcpToolCall") {
    if (isObject(item.error) && typeof item.error.message === "string") {
      return item.error.message;
    }
    return item.result === undefined || item.result === null ? "" : shown(item.result, cut);
  }
  return "";
}

const wait = (ms: number): Promise<"timeout"> =>
  new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms).unref?.();
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

/** The turn under way. */
interface Turn {
  /** The product's id for it, once the product said it. */
  id: string | undefined;
  /** Why it was stopped, where it was. */
  cut: "message" | "stopped" | undefined;
  /** Whether a message is put into it: not once the product refused one, a turn that is over or one of a kind it puts none into. */
  steers: boolean;
}

/** What the product was handed and has not said it took: under the id it says it back by. */
interface Handed {
  readonly id: string;
  readonly messages: readonly DriverMessage[];
  /** Whether it was put into a turn under way, where the others began one. */
  readonly steered: boolean;
}

function sessionOf(
  child: Child,
  host: {
    readonly command: string;
    readonly version: string | undefined;
    readonly uuid: () => string;
  },
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

  const cut = options.cut ?? plainCut;
  const connection = connectionOf(child, { cut, header: false });
  const mode = codexMode(options.permissions);
  let choice = { model: options.model, effort: options.effort };
  /** What the conversation runs with, as the product said it or as it was last asked. */
  let runs: { model: string | null; effort: string | null } = { model: null, effort: null };
  let version: string | null = null;
  /** The conversation, once it is open. */
  let thread: string | undefined;
  /** Whether the product answered at all, whether the conversation is open, and whether the session gave up or is being stopped. */
  let began = false;
  let ready = false;
  let gaveUp = false;
  let stopping = false;
  /** Whether the product's output closed: nothing more reaches a process that is gone. */
  let over = false;
  let turn: Turn | undefined;
  /** The messages the product was not handed yet: the next turn's, or the next put into the one under way. */
  let waiting: DriverMessage[] = [];
  let handed: Handed[] = [];
  /** Whether a request that hands messages over is on its way: they are handed over one request at a time, in order. */
  let busy = false;
  /** The tool calls said already, by the product's id for each. */
  const called = new Set<string>();
  /** The last error said, which the product writes twice where a turn fails of it. */
  let lastError: string | undefined;

  const taken = (count: number): DriverEvent[] =>
    Array.from({ length: count }, (): DriverEvent => ({ type: "taken" }));

  const sayError = (words: string): void => {
    if (words !== lastError) {
      emit({
        type: "event",
        kind: "error",
        text: words.length === 0 ? "The turn ended with an error." : words,
      });
    }
    lastError = words;
  };

  /** Asks the product to stop a turn: once it said which turn it is. */
  const interruptOf = (one: Turn): void => {
    if (one.id === undefined || thread === undefined) {
      return;
    }
    // Answered when the turn is over, which the product says by itself too.
    void connection
      .request("turn/interrupt", { threadId: thread, turnId: one.id })
      .catch(() => undefined);
  };

  const stopTurn = (why: "message" | "stopped"): void => {
    if (turn === undefined || turn.cut !== undefined) {
      return;
    }
    turn.cut = why;
    interruptOf(turn);
  };

  /** Starts a turn with what waited: one message, each part under its own header. */
  const start = async (messages: readonly DriverMessage[]): Promise<void> => {
    const mine: Turn = { id: undefined, cut: undefined, steers: true };
    const entry: Handed = { id: host.uuid(), messages, steered: false };
    turn = mine;
    handed.push(entry);
    lastError = undefined;
    // Said with the turn, and kept by the conversation from then on. A choice left at the
    // product's own is not said: the conversation goes on with what it ran with.
    const model = word(choice.model);
    const effort = word(choice.effort);
    if (
      (model !== undefined && model !== runs.model) ||
      (effort !== undefined && effort !== runs.effort)
    ) {
      runs = { model: model ?? runs.model, effort: effort ?? runs.effort };
      emit({ type: "running", model: runs.model, effort: runs.effort, version });
    }
    try {
      const result = await connection.request("turn/start", {
        threadId: thread ?? "",
        clientUserMessageId: entry.id,
        input: inputOf(messages, options.cwd),
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
      });
      if (turn === mine) {
        mine.id ??= isObject(result) && isObject(result.turn) ? textOf(result.turn.id) : undefined;
        // A stop that was asked before the product named the turn is said now.
        if (mine.cut !== undefined) {
          interruptOf(mine);
        }
      }
    } catch (error) {
      if (turn === mine) {
        turn = undefined;
      }
      handed = handed.filter((one) => one !== entry);
      if (!(error instanceof RpcError)) {
        // The process is gone: how it ended is said where its output ends.
        return;
      }
      emit({
        type: "event",
        kind: "error",
        text: `The product refused the turn: ${error.message}`,
      });
      if (SIGN_IN.test(error.message)) {
        // Nothing was taken: the runner sends again what it sent.
        waiting = [];
        handed = [];
        emit({ type: "cannot_go_on", state: "failed", reason: "sign_in" });
        return;
      }
      // A turn the product itself refused is a turn that ended: it takes the next message.
      emit(...taken(messages.length));
      done();
    }
  };

  /**
   * Puts a message into the turn under way. The product answers that it was put in, and says
   * the message back when it reads it, after the step under way: that is when it is taken.
   */
  const steer = async (message: DriverMessage, into: Turn): Promise<void> => {
    const entry: Handed = { id: host.uuid(), messages: [message], steered: true };
    handed.push(entry);
    try {
      await connection.request("turn/steer", {
        threadId: thread ?? "",
        expectedTurnId: into.id ?? "",
        clientUserMessageId: entry.id,
        input: inputOf([message], options.cwd),
      });
    } catch {
      // Not put in: the turn is over, or is one a message is put into none of. It waits for
      // the turn's end, first of what waits, unless that end came first and has it wait already.
      into.steers = false;
      if (handed.includes(entry)) {
        handed = handed.filter((one) => one !== entry);
        waiting.unshift(message);
      }
    }
  };

  /** Hands over what waits, one request at a time: a turn started, or a message put into the one under way. */
  const pump = (): void => {
    if (busy || !ready || gaveUp || stopping || over) {
      return;
    }
    const head = waiting[0];
    if (head === undefined) {
      return;
    }
    const after = (): void => {
      busy = false;
      pump();
    };
    if (turn === undefined) {
      busy = true;
      void start(waiting.splice(0)).finally(after);
      return;
    }
    // A turn that is being stopped, or takes no message, is waited for: its end hands over.
    if (turn.cut !== undefined || !turn.steers || turn.id === undefined) {
      return;
    }
    busy = true;
    waiting.shift();
    void steer(head, turn).finally(after);
  };

  /** A turn ended: the agent is done when nothing it was sent still waits. */
  const done = (): void => {
    if (waiting.length > 0) {
      pump();
    } else {
      emit({ type: "turn_completed" });
    }
  };

  /** The product said a message back: it read it, and the message is taken. */
  const took = (id: string | undefined): void => {
    const entry = handed.find((one) => one.id === id);
    if (entry !== undefined) {
      handed = handed.filter((one) => one !== entry);
      emit(...taken(entry.messages.length));
    }
  };

  const onItem = (params: Json, completed: boolean): void => {
    const item = isObject(params.item) ? params.item : undefined;
    if (item === undefined) {
      return;
    }
    const id = textOf(item.id);
    if (item.type === "userMessage") {
      took(textOf(item.clientId));
      return;
    }
    if (!completed) {
      const call = callOf(item, cut);
      if (call !== undefined) {
        emit({
          type: "event",
          kind: "tool_call",
          text: call.text,
          data: { tool: call.tool, id: id ?? null },
        });
        if (id !== undefined) {
          called.add(id);
        }
      }
      return;
    }
    if (item.type === "agentMessage") {
      if (typeof item.text === "string" && item.text.length > 0) {
        emit({ type: "event", kind: "assistant", text: item.text });
      }
      return;
    }
    if (item.type === "reasoning") {
      const parts = [item.summary, item.content].flatMap((one) =>
        Array.isArray(one) ? one.filter((part) => typeof part === "string") : [],
      );
      if (parts.length > 0) {
        emit({ type: "event", kind: "thinking", text: parts.join("\n\n") });
      }
      return;
    }
    const call = callOf(item, cut);
    if (call === undefined) {
      return;
    }
    // A call the product wrote no beginning of is said with its end.
    if (id === undefined || !called.delete(id)) {
      emit({
        type: "event",
        kind: "tool_call",
        text: call.text,
        data: { tool: call.tool, id: id ?? null },
      });
    }
    if (item.type === "webSearch") {
      return;
    }
    const exit = typeof item.exitCode === "number" ? item.exitCode : null;
    const data: Record<string, Fact> = {
      id: id ?? null,
      // Declined is the product's word for a call its sandbox or its reviewer did not let run.
      error:
        item.status === "failed" || item.status === "declined" || (exit !== null && exit !== 0),
    };
    if (exit !== null) {
      data.exit = exit;
    }
    emit({ type: "event", kind: "tool_result", text: resultOf(item, cut), data, pictures: [] });
  };

  const onTurnCompleted = (params: Json): void => {
    const ended = isObject(params.turn) ? params.turn : {};
    const id = textOf(ended.id);
    if (turn === undefined || (turn.id !== undefined && id !== undefined && turn.id !== id)) {
      return;
    }
    const mine = turn;
    turn = undefined;
    called.clear();
    // What the product did not say it took. A turn began with its first message, which is the
    // product's from then on. One put into the turn and never said back was not read: the
    // product lets go of it where the turn is stopped first (seen with 0.139.0), so it is the
    // next turn's, before whatever else waits.
    const again: DriverMessage[] = [];
    for (const one of handed) {
      if (one.steered) {
        again.push(...one.messages);
      } else {
        emit(...taken(one.messages.length));
      }
    }
    handed = [];
    waiting = [...again, ...waiting];
    if (ended.status === "failed") {
      sayError(errorOf(ended.error));
      if (signedOut(ended.error)) {
        // The runner sends again what it sent, once the product is signed in.
        waiting = [];
        emit({ type: "cannot_go_on", state: "failed", reason: "sign_in" });
        return;
      }
      // A turn the product itself said failed is a turn that ended: the agent takes the next message.
    } else if (ended.status === "interrupted") {
      emit({
        type: "event",
        kind: "status",
        text:
          mine.cut === "message" ? "The turn was stopped for a message." : "The turn was stopped.",
      });
    }
    done();
  };

  const onNotification = (method: string, params: Json): void => {
    // A thread of the product's other than the conversation's is none of the session's: what
    // an agent it started does there is that agent's, and its turns are not this one's.
    if (thread === undefined || params.threadId !== thread) {
      return;
    }
    switch (method) {
      case "turn/started": {
        const id = isObject(params.turn) ? textOf(params.turn.id) : undefined;
        if (turn === undefined) {
          // A turn the product began by itself: a message that arrives now is put into it.
          turn = { id, cut: undefined, steers: true };
          pump();
        } else {
          turn.id ??= id;
        }
        return;
      }
      case "turn/completed":
        onTurnCompleted(params);
        return;
      case "item/started":
        onItem(params, false);
        return;
      case "item/completed":
        onItem(params, true);
        return;
      case "error":
        // A word of warning inside a turn, a try that is made again say: the turn goes on, and
        // says by itself where it ends of one.
        sayError(errorOf(params.error));
        return;
      default:
        // Whatever else it writes, how the thread stands, what it plans, what its reviewer
        // found, is left where it is.
        return;
    }
  };

  /** What the product asks of whoever is at its terminal: nobody is, so it is refused and recorded. */
  const onRequest = (id: unknown, method: string, params: Json): void => {
    const denied = (tool: string, what: string, answer: Json): void => {
      const data: Record<string, Fact> = { tool, answer: "denied" };
      const item = textOf(params.itemId);
      if (item !== undefined) {
        data.id = item;
      }
      emit({
        type: "event",
        kind: "permission",
        text: `Denied, with nobody at the terminal to ask: ${cut(what, MAX_INPUT_LENGTH)}`,
        data,
      });
      void connection.answer(id, answer).catch(() => undefined);
    };
    const reason = textOf(params.reason)?.trim();
    switch (method) {
      case "item/commandExecution/requestApproval":
        denied("command_execution", textOf(params.command) ?? reason ?? "a command", {
          decision: "decline",
        });
        return;
      case "item/fileChange/requestApproval":
        denied("file_change", reason ?? "a change to files", { decision: "decline" });
        return;
      case "item/permissions/requestApproval":
        // Leave to do more than the mode allows: none is given.
        denied("permissions", reason ?? "more than the mode allows", {
          permissions: {},
          scope: "turn",
        });
        return;
      case "item/tool/requestUserInput":
        denied("request_user_input", "a question for a person", { answers: {} });
        return;
      case "mcpServer/elicitation/request":
        denied(
          `${textOf(params.serverName) ?? "mcp"}.elicitation`,
          textOf(params.message) ?? "a question for a person",
          { action: "decline", content: null, _meta: null },
        );
        return;
      default:
        // No tool and no sign-in of the runner's own was offered: a product that asks for one
        // all the same is told.
        void connection
          .refuse(id, METHOD_NOT_FOUND, `${method} is not offered`)
          .catch(() => undefined);
    }
  };

  /** Why the conversation could not open, said once; the process is ended, and nothing more is said of it. */
  const cannotStart = (text: string, reason: "start" | "sign_in"): void => {
    gaveUp = true;
    waiting = [];
    emit({ type: "event", kind: "error", text }, { type: "cannot_go_on", state: "failed", reason });
    void endOf(child);
  };

  const open = async (): Promise<void> => {
    await connection.request("initialize", hello(host.version));
    began = true;
    await connection.notify("initialized");
    const model = word(choice.model);
    const settings: Json = {
      cwd: options.cwd,
      ...modeSettings(mode),
      ...(model === undefined ? {} : { model }),
    };
    let opened: unknown;
    const resume = word(options.resume);
    if (resume !== undefined) {
      try {
        // Gone on with, without its history said again: nobody reads it here.
        opened = await connection
          .request("thread/resume", { threadId: resume, ...settings, excludeTurns: true })
          .catch((error: unknown) => {
            // A build that takes that word only as an experiment (0.139.0) is asked without it.
            if (error instanceof RpcError && error.message.includes("excludeTurns")) {
              return connection.request("thread/resume", { threadId: resume, ...settings });
            }
            throw error;
          });
      } catch (error) {
        // Not signed in is said as that, and a process that is gone where its output ends.
        if (!(error instanceof RpcError) || SIGN_IN.test(error.message)) {
          throw error;
        }
        // A conversation the product has no more: said, and a new one begun, as the runner
        // begins one where the conversation kept was another product's.
        emit({
          type: "event",
          kind: "status",
          text: `The product could not go on with the conversation it had (${error.message}): a new one begins.`,
        });
      }
    }
    opened ??= await connection.request("thread/start", settings);
    const said = isObject(opened) ? opened : {};
    const named = isObject(said.thread) ? said.thread : {};
    thread = word(textOf(named.id));
    if (thread === undefined) {
      cannotStart("The product opened a conversation and did not say which.", "start");
      return;
    }
    version = textOf(named.cliVersion)?.slice(0, 80) ?? null;
    runs = {
      model: word(textOf(said.model)) ?? model ?? null,
      effort: word(textOf(said.reasoningEffort)) ?? null,
    };
    emit(
      { type: "conversation", id: thread },
      { type: "running", model: runs.model, effort: runs.effort, version },
      {
        type: "event",
        kind: "status",
        text: "The product started.",
        data: { model: runs.model, effort: runs.effort, version, mode },
      },
    );
    ready = true;
    pump();
  };

  void (async () => {
    const reading = connection.read({ notification: onNotification, request: onRequest });
    const opening = open().catch((error: unknown) => {
      if (gaveUp || stopping) {
        return;
      }
      if (error instanceof RpcError) {
        const signIn = SIGN_IN.test(error.message);
        cannotStart(
          signIn
            ? `The product is not signed in: ${error.message}`
            : `The product did not open a conversation: ${error.message}`,
          signIn ? "sign_in" : "start",
        );
      }
      // Anything else is a process that is gone: how it ended is said where its output ends.
    });
    void wait(START_TIMEOUT_MS).then(() => {
      if (!ready && !gaveUp && !stopping) {
        cannotStart("The product did not open a conversation in time.", "start");
      }
    });
    await reading;
    over = true;
    await opening;
    const exit = await child.exited;
    const clean = stopping || (exit.code === 0 && exit.signal === null && exit.error === undefined);
    if (!clean && !gaveUp) {
      const errors = child.errors().trim();
      // Its end, cut after the secrets are out, so that none stands at the cut.
      const shown = errorsShown(errors, options.cutEnd ?? plainCutEnd);
      const how = exit.signal === null ? ` with code ${exit.code}` : ` on ${exit.signal}`;
      emit(
        {
          type: "event",
          kind: "error",
          text:
            exit.error !== undefined
              ? notStarted(exit.error, host.command)
              : `The product's process ended${how}${began ? "" : " before it answered as its app server, which this driver speaks to (codex app-server)"}.${shown.length === 0 ? "" : `\n${shown}`}`,
        },
        {
          type: "cannot_go_on",
          state: "failed",
          // Before the conversation was open nothing was taken, and the runner sends again
          // what it sent; after, what a turn was at is not known.
          reason: SIGN_IN.test(errors) ? "sign_in" : ready ? "crashed" : "start",
        },
      );
    }
    emit({ type: "ended", how: clean ? "exited" : "crashed" });
  })();

  return {
    events: events(),
    async send(message) {
      // Kept by the runner, where it is not handed over: a product that is gone takes nothing.
      if (stopping || gaveUp || over) {
        throw new Error("the session takes no more input");
      }
      waiting.push(message);
      // One that is to be read now stops the turn under way, and is the turn after.
      if (message.priority === "now") {
        stopTurn("message");
      }
      pump();
    },
    async interrupt() {
      stopTurn("stopped");
    },
    // Said with the next turn that is started, and the conversation's from then on.
    async set(next) {
      choice = {
        model: next.model === undefined ? choice.model : next.model,
        effort: next.effort === undefined ? choice.effort : next.effort,
      };
      return true;
    },
    async stop() {
      if (stopping) {
        return;
      }
      stopping = true;
      waiting = [];
      await endOf(child);
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

/**
 * The builds of the binary the driver ran a turn against. None yet: the app server was spoken to
 * signed out, which is where the shapes of the tests that say so were written down from, and a
 * build is listed once a turn of a signed-in product ran through the driver.
 */
const TRIED: readonly string[] = [];

export function createCodexDriver(host: DriverHost): Driver {
  const command = host.command ?? "codex";
  const uuid = host.uuid ?? randomUUID;
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
    // A message is put into the turn under way. A picture is taken as a file, by its path in
    // the desk. The model and the effort are said with a turn, and taken from the next one on.
    can: { steer: true, images: true, imageFiles: true, resume: true, set: true },
    permissions: { modes: MODES, unattended: UNATTENDED_MODE, least: LEAST_MODE },
    async probe() {
      // One line: what the command is called, then its version.
      const version = /(\d+\.\d+\.\d+[^\s]*)/.exec((await asked(["--version"])) ?? "")?.[1];
      // The product's own list of its models, which it prints for whoever debugs it.
      const offered = offeredOf((await asked(["debug", "models"])) ?? "");
      return { version, models: offered.models, efforts: offered.efforts };
    },
    start(options) {
      return sessionOf(
        host.spawn(command, ARGUMENTS, { cwd: options.cwd, env: options.env }),
        { command, version: host.version, uuid },
        options,
      );
    },
  };
}
