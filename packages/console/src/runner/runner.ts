import { ApiError, type ConsoleClient } from "../client.js";
import {
  MAX_RUNNER_LINE_LENGTH,
  MAX_RUNNER_OFFERS,
  MAX_TRANSCRIPT_ATTACHMENTS,
  MAX_TRANSCRIPT_BATCH,
  MAX_TRANSCRIPT_BATCH_BYTES,
  MAX_TRANSCRIPT_FACT_LENGTH,
  MAX_TRANSCRIPT_FACT_NAME_LENGTH,
  MAX_TRANSCRIPT_FACTS,
  MAX_TRANSCRIPT_TEXT_BYTES,
} from "../limits.js";
import { type RestSignal, type RestTranscriptEventInput, RUNNER_CHOICE } from "../schemas.js";
import { hasForbiddenCodePoint } from "../text.js";
import type { AgentStateReason, TranscriptKind } from "../vocabulary.js";
import type { RunnerConfig } from "./config.js";
import {
  type Attached,
  composeSignals,
  deskName,
  GROUP_WINDOW_MS,
  introOf,
  makeMark,
} from "./message.js";
import { cutShown, cutShownEnd, type Redactor, redactorOf } from "./redact.js";
import type {
  Driver,
  DriverEvent,
  DriverSession,
  Fact,
  Picture,
  Probe,
  WakeHost,
  WakeSource,
} from "./types.js";

// The runner (ADR-0085, docs/specs/runner.md): one process per agent account on its machine. It
// keeps one session of the agent's product at a time, feeds it what the console sends, reports
// what the product does, and says every thirty seconds that it is there. It restarts nothing by
// itself: an agent that cannot go on waits, and a supervisor's signal is what is tried next.
// The one thing it ends for by itself is an update of the command it runs from (ADR-0101): when
// no turn is under way, for the service that keeps it to start it again with the new one.
//
// Everything that changes what the runner holds goes through one queue, handled one at a time:
// a signal received, a word of the driver's, a timer that fired. What the product prints is
// numbered and kept for the next batch as it arrives, so that nothing of a session is left
// behind when the session ends.

/** How often the runner says it is there. */
export const HEARTBEAT_MS = 30_000;
/** How often what the product did is sent, while there is something to send. */
export const BATCH_MS = 1000;
/** How long what arrives by itself waits after the agent could not go on: at first, and at most, twice as long after each try that ends the same way. */
export const COOL_DOWN_MS = 15 * 60_000;
export const MAX_COOL_DOWN_MS = 4 * 60 * 60_000;
/** How long the runner waits before it asks for its stream of signals again. */
export const RECONNECT_MS = 5000;
/** What an autosave's commit says: the runner's, and never the agent's own words. */
export const AUTOSAVE_MESSAGE = "Autosave at the end of a session";
/**
 * How long the runner holds back what the console refused as more than an hour takes
 * (ADR-0132), the events of a session and the wakes of its wake sources: a minute at first,
 * twice as long after each refusal that follows, a quarter of an hour at most.
 */
export const HOLD_MS = 60_000;
export const MAX_HOLD_MS = 15 * 60_000;
/** The longest the runner waits before it starts a wake source again that keeps ending at once. */
export const MAX_SOURCE_PAUSE_MS = 5 * 60_000;
/** How long a wake source holds before the runner takes it to have worked. */
const SOURCE_HELD_MS = 60_000;
/** The kinds of file a console keeps as a picture: what a product is handed as one. */
const PICTURE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * How many events wait to be sent, and how many bytes of them, their pictures counted, before
 * the oldest are let go: a console away for hours is not kept up with in memory. What is let go
 * is said on the record, in the place of the first of them.
 */
const MAX_OUTBOX = 20_000;
export const MAX_OUTBOX_BYTES = 64 * 1024 * 1024;
/** Room left in a batch for what wraps its events. */
const BATCH_ROOM_BYTES = MAX_TRANSCRIPT_BATCH_BYTES - 64 * 1024;
/** What the id of a picture takes of a batch, with its quotes and its comma. */
const FILE_ID_BYTES = 48;
/** The fewest bytes a text is cut down to where the console refuses its event alone as too large. */
const LEAST_CUT_BYTES = 1024;
/** The name of the secret an account keeps its git host's token under (ADR-0088): what the autosave's push is handed. */
export const GIT_TOKEN_SECRET = "git.token";

/** What of the console the runner asks: the account's own routes, on its command's session. */
export type RunnerClient = Pick<
  ConsoleClient,
  | "runnerHeartbeat"
  | "signalStream"
  | "beginAgentSession"
  | "sendTranscript"
  | "uploadTranscriptFile"
  | "endAgentSession"
  | "agentSession"
  | "secrets"
  | "secret"
  | "readSignalFile"
  | "raiseWake"
>;

/** What the runner keeps between its own restarts. No secret is in it. */
export interface RunnerState {
  /**
   * The number of the last signal that is delivered, every one before it too (ADR-0131): the
   * product said it took it, or the record says it was never read or was let go, or the runner
   * acted on it itself. One handed to a product that has not said so is not delivered yet, and
   * is sent again to a runner started after.
   */
  readonly delivered: number;
  /** The conversation the next session goes on with, where the product resumes one. */
  readonly conversation: string | undefined;
  /**
   * The driver the conversation was begun under. A conversation is a product's own: a desk whose
   * `runner.json` names another product since begins a new one. Kept by a runner that did not
   * say, it is taken as this driver's.
   */
  readonly driver?: string | undefined;
}

export interface RunnerOptions {
  readonly client: RunnerClient;
  readonly driver: Driver;
  readonly config: RunnerConfig;
  /** The desk: the directory the runner was started in. */
  readonly cwd: string;
  readonly machine: { readonly name: string; readonly os: string; readonly user: string };
  /** The version of the package the runner runs from. */
  readonly version: string;
  /**
   * The version of that package as it stands on the machine now, read again from where the
   * runner runs from; nothing where it cannot be read. Left out, the runner never ends for an
   * update (ADR-0101).
   */
  readonly installed?: (() => Promise<string | undefined>) | undefined;
  /**
   * The command that installs the console's version of the package where the runner runs from,
   * for an agent whose runner the console refuses as too old; nothing where it cannot be said.
   */
  readonly updateCommand?: (() => string | undefined) | undefined;
  readonly now: () => number;
  readonly random: () => number;
  /** A moment as a header says it: the hour and the minute in the workspace's zone. */
  readonly time: (iso: string) => string;
  /**
   * Files under the desk's ignored `work/`, written for their owner alone: what a session is
   * handed of the account's store, removed at its end, and what came with a signal, under
   * `inbox/<number>/`, which is the agent's to keep or to remove.
   */
  readonly files: {
    write(path: string, value: string | Uint8Array): Promise<void>;
    remove(path: string): Promise<void>;
  };
  readonly state: {
    load(): Promise<RunnerState | undefined>;
    save(state: RunnerState): Promise<void>;
  };
  /** A line for whoever reads the runner's own output: ids, numbers and codes, never what a signal or an event says. */
  readonly log: (line: string) => void;
  /**
   * Runs git in the desk to its end and answers how it ended, for the autosave (ADR-0088); left
   * out, the runner saves nothing. It asks nobody at a terminal, and what it prints is not kept.
   * A step that reaches the git host is handed the token the account's store keeps for it,
   * where it keeps one: for that command alone, on no command line and in no file.
   */
  readonly git?:
    | ((
        args: readonly string[],
        handed?: { readonly token?: string | undefined },
      ) => Promise<number | null>)
    | undefined;
  /** The wake sources `runner.json` names beside the console's own, and what they need of the machine. */
  readonly wakes?:
    | {
        readonly sources: readonly WakeSource[];
        readonly fetch: WakeHost["fetch"];
        readonly socket: WakeHost["socket"];
      }
    | undefined;
  /**
   * How the desk's `runner.json` stands against the one this runner was started with (ADR-0144):
   * the same, another that reads, or one that does not read, with what is wrong with it in a few
   * words. Left out, the runner never ends for its file.
   */
  readonly reconfigured?:
    | (() => Promise<"same" | "changed" | { readonly problem: string }>)
    | undefined;
  /** The durations, for a test to shorten. */
  readonly timing?: Partial<{
    heartbeatMs: number;
    batchMs: number;
    groupWindowMs: number;
    coolDownMs: number;
    maxCoolDownMs: number;
    reconnectMs: number;
    holdMs: number;
    maxHoldMs: number;
  }>;
  /** The bounds, for a test to lower. */
  readonly bounds?: Partial<{ outboxBytes: number }>;
}

/**
 * How a runner ended: stopped by whoever runs it, by itself for an update of the command it runs
 * from, or by itself for a `runner.json` that changed, which the next runner is started with.
 */
export type RunnerEnd = "stopped" | "updated" | "changed";

export interface Runner {
  /** Runs until it ends: resolves, with how, when the open session is ended and nothing is left to send. */
  run(): Promise<RunnerEnd>;
  /** Stops the runner: the session open is ended as exited. */
  stop(): void;
}

interface Outgoing {
  n: number;
  readonly kind: TranscriptKind;
  readonly at: string;
  text: string;
  data: Record<string, Fact>;
  readonly pictures: readonly Picture[];
  /** The ids its pictures were kept under, once they were handed in: a batch sent again hands none in twice. */
  files?: readonly string[];
  /** What it holds of the runner's memory while it waits: its text and its pictures. */
  held: number;
  /** How many events it stands for, where it says that the runner let some go unsent. */
  gone?: number;
}

/** What an event takes of a batch as the console counts one: its JSON, and the ids of its pictures. */
const sentBytes = (event: Outgoing): number =>
  Buffer.byteLength(
    JSON.stringify({
      n: event.n,
      kind: event.kind,
      at: event.at,
      text: event.text,
      data: event.data,
    }),
  ) +
  event.pictures.length * FILE_ID_BYTES +
  16;

/** What an event holds of memory: its text, its facts roughly, and the bytes of its pictures. */
const heldBytes = (event: Pick<Outgoing, "text" | "pictures">): number =>
  Buffer.byteLength(event.text) +
  1024 +
  event.pictures.reduce((sum, picture) => sum + picture.bytes.byteLength, 0);

interface OpenSession {
  readonly id: string;
  readonly mark: string;
  readonly driver: DriverSession;
  readonly startedAt: number;
  /** Whether its first message, which says what a header is, is still to be sent. */
  first: boolean;
  /** Whether a turn is under way: something was sent and the product has not said it is done. */
  turn: boolean;
  /** The signals of the turn under way. */
  sent: readonly RestSignal[];
  /**
   * The messages handed to the product, the oldest first, each with what writes it on the
   * record: written at once where the product was waiting for one, and when the product takes
   * it where a turn was under way.
   */
  handed: {
    written: boolean;
    /** Writes its signals on the record, as never read where so, and only those asked for where some are. */
    readonly write: (unread?: boolean, only?: (signal: RestSignal) => boolean) => void;
    /** Its signals: counted as delivered once the product took the message. */
    readonly signals: readonly RestSignal[];
  }[];
  /**
   * Whether the product took a message of this session, or completed a turn of it. One that
   * has not is still starting, for all the runner knows: it took nothing it was handed.
   */
  took: boolean;
  /** The number of the last event of it. */
  n: number;
  /** What the product did and the console has not been sent yet, and what that holds of memory. */
  outbox: Outgoing[];
  waiting: number;
  /** Whether the console takes nothing more of it: over there, or its month away. */
  refused: boolean;
  /** The console took as many of its events as an hour takes: until when nothing is sent, and how long that was. */
  hold?: { readonly until: number; readonly pause: number } | undefined;
  /** Why the console did not take what waits, in its code: said where the session ends with it unsent. */
  unsent?: string | undefined;
  running: { model: string | null; effort: string | null };
  /** The files written for it, to remove at its end. */
  readonly written: string[];
  /** Resolves when the product's output has been read to its end. */
  pumped: Promise<void>;
}

type Message =
  | { readonly t: "signal"; readonly signal: RestSignal }
  | { readonly t: "driver"; readonly session: OpenSession; readonly event: DriverEvent }
  | { readonly t: "deliver" }
  | { readonly t: "flush" }
  | { readonly t: "heartbeat" }
  | { readonly t: "stop" };

/** The word a text the runner cut ends with: how long it was whole. */
const CUT_NOTE = /\n\[cut by the runner: (\d+) bytes in all\]$/;

/**
 * A text within `bytes` of UTF-8, cut between characters, with a word that says it was cut. A
 * text cut before and cut again still says how long it was whole.
 */
function boundedText(text: string, bytes: number): string {
  if (text.length * 3 <= bytes) {
    return text;
  }
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= bytes) {
    return text;
  }
  const before = CUT_NOTE.exec(text);
  const whole = before === null ? encoded.byteLength : Number(before[1]);
  const body = before === null ? encoded : Buffer.from(text.slice(0, before.index), "utf8");
  const note = `\n[cut by the runner: ${whole} bytes in all]`;
  let end = Math.min(body.byteLength, Math.max(0, bytes - Buffer.byteLength(note)));
  while (end > 0 && ((body[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return `${body.subarray(0, end).toString("utf8")}${note}`;
}

/** The facts of a block within the bounds the console takes them in, a text among them with its secrets taken out. */
function boundedFacts(
  data: Readonly<Record<string, Fact>> | undefined,
  redact: (text: string) => string,
): Record<string, Fact> {
  const facts: Record<string, Fact> = {};
  for (const [name, fact] of Object.entries(data ?? {}).slice(0, MAX_TRANSCRIPT_FACTS)) {
    if (name.length === 0 || name.length > MAX_TRANSCRIPT_FACT_NAME_LENGTH) {
      continue;
    }
    if (typeof fact === "string") {
      facts[name] = redact(fact).slice(0, MAX_TRANSCRIPT_FACT_LENGTH);
    } else if (typeof fact !== "number" || Number.isFinite(fact)) {
      facts[name] = fact;
    }
  }
  return facts;
}

/** A model or a level of effort as the console takes one, or nothing for a name it would refuse. */
const choiceOf = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.length <= MAX_RUNNER_LINE_LENGTH && RUNNER_CHOICE.test(value)
    ? value
    : null;

/** Of what a product offers to choose from, what the console takes: the names it would refuse left out, the most it takes. */
const offeredOf = (values: readonly string[]): string[] =>
  values.filter((value) => choiceOf(value) !== null).slice(0, MAX_RUNNER_OFFERS);

/** A line a runner says of its product as the console takes one, or nothing where it is none. */
const lineOf = (value: string | null | undefined): string | null => {
  const line = (value ?? "").trim().slice(0, MAX_RUNNER_LINE_LENGTH).trim();
  return line.length === 0 || hasForbiddenCodePoint(line) ? null : line;
};

export function createRunner(options: RunnerOptions): Runner {
  const { client, driver, config, log } = options;
  const timing = {
    heartbeatMs: HEARTBEAT_MS,
    batchMs: BATCH_MS,
    groupWindowMs: GROUP_WINDOW_MS,
    coolDownMs: COOL_DOWN_MS,
    maxCoolDownMs: MAX_COOL_DOWN_MS,
    reconnectMs: RECONNECT_MS,
    holdMs: HOLD_MS,
    maxHoldMs: MAX_HOLD_MS,
    ...options.timing,
  };
  /** How long what an hour's bound refused is held back: the first time, and twice as long each time after. */
  const heldFor = (before: { readonly pause: number } | undefined): number =>
    before === undefined ? timing.holdMs : Math.min(before.pause * 2, timing.maxHoldMs);
  const bounds = { outboxBytes: MAX_OUTBOX_BYTES, ...options.bounds };

  // What keeps failing is said once, and again when what is said of it changes, so that an hour
  // without the console is a line and not thousands; that it is over is said once too.
  const saidOf = new Map<string, string>();
  const sayOnce = (about: string, line: string): void => {
    if (saidOf.get(about) !== line) {
      saidOf.set(about, line);
      log(line);
    }
  };
  const sayOver = (about: string, line?: string): void => {
    if (saidOf.delete(about) && line !== undefined) {
      log(line);
    }
  };

  // The queue: everything that changes what the runner holds, one at a time.
  const queue: Message[] = [];
  let wake: (() => void) | undefined;
  const push = (message: Message): void => {
    queue.push(message);
    wake?.();
  };
  const next = async (): Promise<Message> => {
    for (;;) {
      const message = queue.shift();
      if (message !== undefined) {
        return message;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  };

  let stopped = false;
  const abort = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, message: Message): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      push(message);
    }, ms);
    timers.add(timer);
  };

  // What the runner holds.
  /** The number of the last signal delivered, every one before it too: what is kept and said to the console. */
  let delivered = 0;
  /** The signals handed to the product that it has not taken yet, by number: not delivered, and not sent twice. */
  const owed = new Set<number>();
  /** The highest number of a signal the product took, or the record says was never read or let go. */
  let settled = 0;
  /** The number of the last signal the stream gave, and of the last one acted on: the second is behind the first while one waits in the queue. */
  let received = 0;
  let handled = 0;
  let conversation: string | undefined;
  let stands: { state: "running" | "stopped" | "refused" | "failed"; reason: AgentStateReason } = {
    state: "running",
    reason: "started",
  };
  let said = "";
  let settings: { model: string | null; effort: string | null } = { model: null, effort: null };
  let probe: Probe = { version: undefined, models: [], efforts: [] };
  let productVersion: string | null = null;
  let session: OpenSession | undefined;
  /** What was received and not handed to the product yet, in order. */
  let pending: RestSignal[] = [];
  /** A supervisor's stop stands: nothing is delivered until a restart or a reset. */
  let held = false;
  /** The agent could not go on: how many tries ended so, and when what arrives by itself goes next. */
  let waits: { tries: number; until: number } | undefined;
  /** The next session begins a new conversation, and says who reset it. */
  let resetBy: string | undefined;
  /** The open session is to end as soon as no turn is under way: what was chosen for it is taken when one starts. */
  let renew = false;
  let deliverAt: number | undefined;
  /** The number of the last signal the runner acted on itself. */
  let acted = 0;
  let flushing = false;
  /** The values of the account's store, by what the store said of them last. */
  let secretsStamp: string | undefined;
  let secretValues = new Map<string, string>();
  let redact: Redactor = redactorOf([]);
  let tooOldSaid = false;
  /** The console took as many wakes of this runner's as an hour takes: until when none is raised, and how long that was. */
  let wakesHeld: { readonly until: number; readonly pause: number } | undefined;
  /**
   * The package the runner runs from, where it is another version than the runner's: the one
   * last seen, and the one seen twice running, which the runner ends for.
   */
  let seenVersion: string | undefined;
  let seenAt = 0;
  let updatedTo: string | undefined;
  /**
   * The desk's `runner.json`, where it is another than the one the runner was started with:
   * how it was last seen, a file that reads or what is wrong with one that does not, and since
   * when it is seen so; whether the runner ends for it; and what is wrong with it that the
   * agent was told of.
   */
  let sighted:
    | { readonly what: "changed" | { readonly problem: string }; readonly at: number }
    | undefined;
  let reconfigure = false;
  let toldOf: string | undefined;
  /** How each wake source stands, by its name: what the heartbeat says of them. */
  const sources = new Map<
    string,
    { state: "connected" | "waiting" | "failing"; since: number; why: string | undefined }
  >();
  /**
   * The signals a product was handed and never took, since it did not start or was not signed
   * in, which are kept to be sent again; and, of those, the ones a reset gave one more try: a
   * product that does not start with them again is not sent them a third time.
   */
  const sentBefore = new Set<number>();
  const lastTry = new Set<number>();

  const persist = async (): Promise<void> => {
    try {
      await options.state.save({ delivered, conversation, driver: driver.name });
    } catch {
      log("the runner's state could not be written; it goes on from the console's record");
    }
  };

  const setState = (state: typeof stands.state, reason: AgentStateReason): void => {
    stands = { state, reason };
    push({ t: "heartbeat" });
  };

  /** Asks for a delivery after the window that groups what arrives together, or at a moment. */
  const scheduleDeliver = (at: number = options.now() + timing.groupWindowMs): void => {
    if (deliverAt !== undefined && deliverAt <= at) {
      return;
    }
    deliverAt = at;
    later(Math.max(0, at - options.now()), { t: "deliver" });
  };

  const record = (
    target: OpenSession,
    kind: TranscriptKind,
    text: string,
    data?: Readonly<Record<string, Fact>>,
    pictures: readonly Picture[] = [],
  ): void => {
    target.n += 1;
    const event = {
      n: target.n,
      kind,
      at: new Date(options.now()).toISOString(),
      text: boundedText(redact(text), MAX_TRANSCRIPT_TEXT_BYTES),
      data: boundedFacts(data, redact),
      pictures: pictures.slice(0, MAX_TRANSCRIPT_ATTACHMENTS),
    };
    const held = heldBytes(event);
    target.outbox.push({ ...event, held });
    target.waiting += held;
    // A batch on its way names the events at the head: they are let go, where they must be,
    // before the next one is put together.
    if (!flushing) {
      trim(target);
    }
  };

  /**
   * Lets go of the oldest of what waits to be sent once more waits than the runner keeps, and
   * says so on the record: one event stands in the place of the first let go, with how many
   * went, and those after it are numbered on from it, so that the console is sent no gap.
   */
  const trim = (target: OpenSession): void => {
    if (target.outbox.length <= MAX_OUTBOX && target.waiting <= bounds.outboxBytes) {
      return;
    }
    let first: Outgoing | undefined;
    let gone = 0;
    // Down to nine tenths of each bound, so that the next event does not find it full again.
    while (
      target.outbox.length > 1 &&
      (target.outbox.length > MAX_OUTBOX * 0.9 || target.waiting > bounds.outboxBytes * 0.9)
    ) {
      const event = target.outbox.shift();
      if (event === undefined) {
        break;
      }
      first ??= event;
      target.waiting -= event.held;
      gone += event.gone ?? 1;
    }
    if (first === undefined) {
      return;
    }
    const said = {
      text: `The runner let go of ${gone} ${gone === 1 ? "event" : "events"} of this session unsent: more waited for the console than the runner keeps.`,
      pictures: [],
    };
    const held = heldBytes(said);
    target.outbox.unshift({
      n: first.n,
      kind: "status",
      at: first.at,
      ...said,
      data: { let_go: gone },
      held,
      gone,
    });
    target.waiting += held;
    target.outbox.forEach((event, index) => {
      event.n = first.n + index;
    });
    target.n = first.n + target.outbox.length - 1;
    sayOnce(
      `outbox ${target.id}`,
      `events of session ${target.id} are let go unsent: more waits for the console than the runner keeps`,
    );
  };

  /** Reads the values of the account's store where the store changed, for what a session is handed and for what is taken out of events. */
  const readSecrets = async (): Promise<void> => {
    try {
      const listed = await client.secrets(abort.signal);
      const stamp = JSON.stringify(listed.items.map((item) => [item.name, item.setAt]));
      if (stamp === secretsStamp) {
        return;
      }
      const values = new Map<string, string>();
      for (const item of listed.items) {
        values.set(item.name, (await client.secret(item.name, abort.signal)).value);
      }
      secretValues = values;
      secretsStamp = stamp;
      redact = redactorOf(values.values());
    } catch (error) {
      if (!stopped) {
        log(`the account's secrets could not be read (${codeOf(error)})`);
      }
    }
  };

  const codeOf = (error: unknown): string =>
    error instanceof ApiError ? error.code : error instanceof Error ? error.name : "error";

  /**
   * Sends what the product did, a batch at a time, the pictures first. What the console has
   * already is left there. Nothing is sent while the console holds the session to its hour
   * (ADR-0132), but at the session's end, which is `last`.
   */
  const flush = async (target: OpenSession, last = false): Promise<void> => {
    if (flushing) {
      return;
    }
    if (!last && target.hold !== undefined && options.now() < target.hold.until) {
      return;
    }
    flushing = true;
    const about = `transcript ${target.id}`;
    try {
      // The most events a batch carries: fewer once the console refused one as too large.
      let most = MAX_TRANSCRIPT_BATCH;
      while (target.outbox.length > 0 && !target.refused) {
        trim(target);
        const batch: Outgoing[] = [];
        let bytes = 0;
        for (const event of target.outbox) {
          // Sized as it is sent: what a text grows by when it is spelled as JSON is counted.
          const size = sentBytes(event);
          if (batch.length >= most || (batch.length > 0 && bytes + size > BATCH_ROOM_BYTES)) {
            break;
          }
          batch.push(event);
          bytes += size;
        }
        const events: RestTranscriptEventInput[] = [];
        for (const event of batch) {
          if (event.files === undefined) {
            const files: string[] = [];
            for (const picture of event.pictures) {
              try {
                files.push((await client.uploadTranscriptFile(target.id, picture)).id);
              } catch (error) {
                if (error instanceof ApiError && error.status === 0) {
                  throw error;
                }
                log(`a picture of session ${target.id} was not kept (${codeOf(error)})`);
              }
            }
            event.files = files;
          }
          const files = event.files;
          events.push({
            n: event.n,
            kind: event.kind,
            at: event.at,
            text: event.text,
            data: event.data,
            ...(files.length === 0 ? {} : { files: [...files] }),
          });
        }
        try {
          await client.sendTranscript(target.id, { events });
          for (const event of target.outbox.splice(0, batch.length)) {
            target.waiting -= event.held;
          }
          target.hold = undefined;
          target.unsent = undefined;
          sayOver(about, `the transcript of session ${target.id} is sent again`);
          sayOver(`outbox ${target.id}`);
        } catch (error) {
          const code = codeOf(error);
          if (code === "transcript.gap") {
            // The console is behind what was sent: it says where it stands, and the rest goes on from there.
            const last = (await client.agentSession("me", target.id, abort.signal)).events;
            target.outbox = target.outbox.filter((event) => event.n > last);
            target.outbox.forEach((event, index) => {
              event.n = last + 1 + index;
            });
            target.n = last + target.outbox.length;
            target.waiting = target.outbox.reduce((sum, event) => sum + event.held, 0);
            continue;
          }
          if (code === "request.too_large") {
            // More than the console takes in one request, whatever the runner counted: sent
            // again in halves, and never the same batch twice. One event alone that is still
            // too large is cut, with a word that says so, then sent without its facts, then
            // let go: nothing waits behind it for ever.
            const [only] = batch;
            if (batch.length > 1 || only === undefined) {
              most = Math.max(1, Math.floor(batch.length / 2));
              continue;
            }
            const before = only.held;
            const size = Buffer.byteLength(only.text);
            if (size > LEAST_CUT_BYTES) {
              only.text = boundedText(only.text, Math.floor(size / 2));
            } else if (Object.keys(only.data).length > 0) {
              only.data = {};
            } else {
              target.outbox.shift();
              target.outbox.forEach((event) => {
                event.n -= 1;
              });
              target.n -= 1;
              target.waiting -= before;
              log(
                `an event of session ${target.id} was let go: the console refused it alone as too large`,
              );
              continue;
            }
            only.held = heldBytes(only);
            target.waiting += only.held - before;
            continue;
          }
          if (code === "transcript.too_many") {
            // As many events as the console takes of a session within an hour: what waits is
            // kept, within what the runner keeps, and sent again after a while, longer each
            // time, so that the console is not asked every second for what it will refuse.
            const pause = heldFor(target.hold);
            target.hold = { until: options.now() + pause, pause };
            target.unsent = code;
            // Nothing is kept past the session's end: what is let go then is said there.
            if (!last) {
              sayOnce(
                about,
                `the console takes no more events of session ${target.id} within the hour (${code}); they are kept and sent again later`,
              );
            }
            return;
          }
          if (
            code === "transcript.session_over" ||
            code === "transcript.session_not_found" ||
            code === "transcript.away"
          ) {
            log(`the console takes nothing more of session ${target.id} (${code})`);
            target.refused = true;
            target.outbox = [];
            target.waiting = 0;
            return;
          }
          throw error;
        }
      }
    } catch (error) {
      // Kept, and sent with the next batch. Said once for as long as it lasts, and when it is
      // over; at the session's end there is no next batch, and what is let go is said there.
      target.unsent = codeOf(error);
      if (!stopped && !last) {
        sayOnce(
          about,
          `the transcript of session ${target.id} waits to be sent (${codeOf(error)})`,
        );
      }
    } finally {
      flushing = false;
    }
  };

  /** Reads what the product does: the blocks are numbered and kept as they arrive, its own words go to the queue. */
  const pump = async (target: OpenSession): Promise<void> => {
    try {
      for await (const event of target.driver.events) {
        if (event.type === "event") {
          record(target, event.kind, event.text, event.data, event.pictures);
        } else {
          push({ t: "driver", session: target, event });
        }
      }
    } catch (error) {
      log(`the product's output could not be read (${codeOf(error)})`);
      push({ t: "driver", session: target, event: { type: "ended", how: "crashed" } });
    }
  };

  /** What a session is handed of the account's store: as its environment, and as files under `work/`. */
  const handOver = async (): Promise<{ env: Record<string, string>; written: string[] }> => {
    const env: Record<string, string> = {};
    const written: string[] = [];
    for (const [variable, name] of Object.entries(config.secrets.env)) {
      const value = secretValues.get(name);
      if (value === undefined) {
        log(`runner.json names the secret ${name}, which the account's store does not hold`);
      } else {
        env[variable] = value;
      }
    }
    for (const [path, name] of Object.entries(config.secrets.files)) {
      const value = secretValues.get(name);
      if (value === undefined) {
        log(`runner.json names the secret ${name}, which the account's store does not hold`);
        continue;
      }
      await options.files.write(path, value);
      written.push(path);
    }
    return { env, written };
  };

  /** Begins a session: the product started, and the console told. Nothing where either could not be. */
  const begin = async (): Promise<OpenSession | undefined> => {
    await readSecrets();
    const resume = driver.can.resume ? conversation : undefined;
    let handed: { env: Record<string, string>; written: string[] };
    try {
      handed = await handOver();
    } catch (error) {
      log(`a session's files could not be written (${codeOf(error)})`);
      setState("failed", "start");
      return undefined;
    }
    let created: { id: string };
    try {
      created = await client.beginAgentSession({
        product: productOf(),
        model: settings.model,
        effort: settings.effort,
        resumed: resume !== undefined,
        machine: options.machine,
      });
    } catch (error) {
      const code = codeOf(error);
      log(
        code === "transcript.too_many_sessions"
          ? `the console begins no more sessions of this account within the hour (${code}); tried again after the cool-down`
          : `a session could not be begun at the console (${code})`,
      );
      for (const path of handed.written) {
        await options.files.remove(path).catch(() => undefined);
      }
      return undefined;
    }
    const started: OpenSession = {
      id: created.id,
      mark: makeMark(options.random),
      driver: driver.start({
        cwd: options.cwd,
        env: handed.env,
        model: settings.model,
        effort: settings.effort,
        resume,
        permissions: config.permissions,
        browser: config.browser,
        // Whatever the driver shows a part of is cut once the secrets, as the store has them
        // now, are out of it: no part of one stands where a text was cut.
        cut: (text, most, more) => cutShown(redact, text, most, more),
        cutEnd: (text, most, more) => cutShownEnd(redact, text, most, more),
      }),
      startedAt: options.now(),
      first: true,
      turn: false,
      sent: [],
      handed: [],
      took: false,
      n: 0,
      outbox: [],
      waiting: 0,
      refused: false,
      running: { model: settings.model, effort: settings.effort },
      written: handed.written,
      pumped: Promise.resolve(),
    };
    started.pumped = pump(started);
    session = started;
    renew = false;
    log(
      `session ${started.id} began${resume === undefined ? "" : ", going on with the conversation before"}`,
    );
    push({ t: "heartbeat" });
    return started;
  };

  /** Ends the open session: the product stopped, what is left of it sent, the console told how, its files removed. */
  const end = async (
    how: "stopped" | "restarted" | "reset" | "crashed" | "exited",
    already = false,
  ): Promise<void> => {
    const target = session;
    if (target === undefined) {
      return;
    }
    session = undefined;
    if (!already) {
      await target.driver.stop().catch(() => undefined);
    }
    await target.pumped;
    await hearLast(target);
    // What the product was handed and never took is sent again, by the console where the
    // runner itself ends and by the runner where the product had not started; else it is on
    // the record as never read.
    await leave(target, stopped ? "after" : already || target.took ? undefined : "next");
    record(target, "status", `The session ended: ${how}.`, { ended: how });
    await flush(target, true);
    // What the console did not take by now goes with the session: nothing of it is sent
    // later, and the runner's line says how many, where an earlier one said they were kept.
    const unsent = target.outbox.length;
    if (unsent > 0) {
      const one = unsent === 1;
      log(
        `${unsent} ${one ? "event" : "events"} of session ${target.id} ${one ? "was" : "were"} let go unsent when it ended: ${
          target.unsent === "transcript.too_many"
            ? `the console takes no more of it within the hour (${target.unsent})`
            : `the console did not take ${one ? "it" : "them"} (${target.unsent ?? "error"})`
        }`,
      );
    }
    saidOf.delete(`transcript ${target.id}`);
    saidOf.delete(`outbox ${target.id}`);
    try {
      await client.endAgentSession(target.id, { how });
    } catch (error) {
      log(`the end of session ${target.id} was not told to the console (${codeOf(error)})`);
    }
    for (const path of target.written) {
      await options.files.remove(path).catch(() => undefined);
    }
    log(`session ${target.id} ended: ${how}`);
    await autosave();
    push({ t: "heartbeat" });
  };

  /**
   * The autosave (ADR-0088): the desk committed and pushed at the end of a session, a net under
   * the agent's own commits, where `runner.json` leaves it on and the desk is a repository. A
   * step that does not succeed is said by how git ended, and the runner goes on.
   */
  const autosave = async (): Promise<void> => {
    const git = options.git;
    if (!config.autosave || git === undefined) {
      return;
    }
    try {
      if ((await git(["rev-parse", "--is-inside-work-tree"])) !== 0) {
        return;
      }
      // Everything but `work/`, by name: what a supervisor sent and what the runner keeps
      // there stay on the machine, whatever the desk's own list of what git ignores says.
      await git(["add", "--all", "--", ".", ":(exclude)work"]);
      // Ends in 1 where something is staged, and in 0 where nothing is.
      if ((await git(["diff", "--cached", "--quiet"])) === 1) {
        const committed = await git(["commit", "--quiet", "--message", AUTOSAVE_MESSAGE]);
        if (committed !== 0) {
          log(`the desk was not saved: git commit ended in ${committed}`);
          return;
        }
      }
      const pushed = await git(["push", "--quiet"], {
        token: secretValues.get(GIT_TOKEN_SECRET),
      });
      log(
        pushed === 0
          ? "the desk was saved"
          : `the desk was committed and not pushed: git push ended in ${pushed}`,
      );
    } catch (error) {
      log(`the desk was not saved (${codeOf(error)})`);
    }
  };

  /** Hands the product what is pending, as one message; begins a session where none is open. */
  const deliver = async (priority: "now" | "next"): Promise<void> => {
    deliverAt = undefined;
    // Nothing more is handed over once the runner is to end for an update: what waits is sent
    // again by the console, in order, to the runner started after.
    if (held || updatedTo !== undefined || pending.length === 0) {
      return;
    }
    // An agent that could not go on is tried at once for a supervisor, and after the cool-down for the rest.
    if (waits !== undefined && !pending.some((signal) => signal.source === "person")) {
      if (options.now() < waits.until) {
        scheduleDeliver(waits.until);
        return;
      }
    }
    // A new day or a new week begins a new conversation where `runner.json` says so, when the agent is idle then.
    const anew = pending.some(
      (signal) =>
        signal.kind === "wake" &&
        signal.source === "schedule" &&
        ((config.conversation === "daily" && signal.key === "day") ||
          (config.conversation !== "continuous" && signal.key === "week")),
    );
    if (anew && session?.turn !== true) {
      await end("restarted");
      conversation = undefined;
    }
    const target = session ?? (await begin());
    if (target === undefined) {
      // Tried again when the cool-down ends, or when a supervisor says something.
      waits = cooled(waits);
      scheduleDeliver(waits.until);
      return;
    }
    const batch = pending;
    pending = [];
    // The files a supervisor sent, read from the console and written in the desk, under its
    // ignored work/, for the agent to open; a picture is handed to the product as a picture
    // too, where the product takes one. What could not be handed over is said to the agent in
    // the message, and what a product was not shown as a picture is said on the record.
    const pictures = new Map<number, Picture[]>();
    const attached = new Map<number, Attached[]>();
    const images: Picture[] = [];
    // What the session says of itself where it knows, an agent that said what it takes; else
    // what the driver says of its product.
    const takesPictures = target.driver.images?.() ?? driver.can.images;
    for (const signal of batch) {
      const taken = new Set<string>();
      for (const file of signal.attachments) {
        const picture = PICTURE_TYPES.has(file.contentType);
        let bytes: Uint8Array | undefined;
        try {
          bytes = (await client.readSignalFile(signal.number, file.id, abort.signal)).bytes;
        } catch (error) {
          log(`a file of signal #${signal.number} could not be read (${codeOf(error)})`);
        }
        let path: string | undefined;
        if (bytes !== undefined) {
          const name = deskName(file.name, taken);
          taken.add(name);
          try {
            await options.files.write(`inbox/${signal.number}/${name}`, bytes);
            path = `work/inbox/${signal.number}/${name}`;
          } catch (error) {
            log(`a file of signal #${signal.number} could not be written (${codeOf(error)})`);
          }
        }
        // A product that takes a picture as a file takes it by its path in the desk.
        const shown =
          picture &&
          bytes !== undefined &&
          takesPictures &&
          (driver.can.imageFiles !== true || path !== undefined);
        if (picture && bytes !== undefined) {
          const kept = { name: file.name, contentType: file.contentType, bytes, path };
          pictures.set(signal.number, [...(pictures.get(signal.number) ?? []), kept]);
          if (shown) {
            images.push(kept);
          }
        }
        attached.set(signal.number, [
          ...(attached.get(signal.number) ?? []),
          {
            name: file.name,
            // A picture that could not be written is still handed over where its bytes are taken.
            path: bytes === undefined ? undefined : path,
            contentType: file.contentType,
            size: file.size,
            picture: !picture ? undefined : shown ? "shown" : "unseen",
          },
        ]);
      }
    }
    const composed = composeSignals(batch, {
      mark: target.mark,
      time: options.time,
      attached: (signal) => attached.get(signal.number) ?? [],
    });
    const intro = target.first
      ? introOf(target.mark, resetBy === undefined ? undefined : { by: resetBy })
      : undefined;
    const text = [intro, composed.text].filter((part) => part !== undefined).join("\n\n");
    try {
      await target.driver.send({ text, images, priority });
    } catch (error) {
      // Not handed over: kept, and what the product says of itself decides what is next.
      log(`a message could not be handed to the product (${codeOf(error)})`);
      pending = [...batch, ...pending];
      return;
    }
    if (target.first) {
      target.first = false;
      resetBy = undefined;
    }
    const write = (unread?: boolean, only?: (signal: RestSignal) => boolean): void => {
      for (const signal of batch) {
        if (only !== undefined && !only(signal)) {
          continue;
        }
        const files = attached.get(signal.number) ?? [];
        const named = (which: (file: Attached) => boolean): string | undefined => {
          const names = files.filter(which).map((file) => file.name);
          return names.length === 0 ? undefined : names.join(", ");
        };
        // Beside the pictures: the other files by name, and the pictures the product was not
        // handed as pictures, which whoever sent them is told of on the page.
        const others = named((file) => file.picture === undefined);
        const unseen = named((file) => file.picture === "unseen");
        record(
          target,
          signal.source === "person" ? "person" : "wake",
          signal.text,
          {
            ...signalData(signal),
            ...(others === undefined ? {} : { files: others }),
            ...(unseen === undefined ? {} : { unseen }),
            ...(unread === true ? { unread: true } : {}),
          },
          pictures.get(signal.number),
        );
      }
    };
    // A product that waited for a message takes this one at once, and the record says so here.
    // One at a turn takes it when it comes to it, after the tool call under way or after the
    // turn: the record is written then, where the agent read it, and until then the page shows
    // it as waiting.
    const waited = !target.turn;
    if (waited) {
      write();
    }
    target.handed.push({ written: waited, write, signals: batch });
    target.turn = true;
    // Everything handed over since the agent was last done: what a product that took nothing is sent again.
    target.sent = [...target.sent, ...batch];
    // Handed over, and not delivered until the product says it took it: a product that did
    // not start took nothing, and a runner that ends then is sent it again when it is back.
    for (const signal of batch) {
      owed.add(signal.number);
    }
    await account();
  };

  /** Counts signals as delivered: the product took them, or the record says what became of them. */
  const count = async (signals: readonly RestSignal[]): Promise<void> => {
    for (const signal of signals) {
      owed.delete(signal.number);
      settled = Math.max(settled, signal.number);
    }
    await account();
  };

  /**
   * The product took the oldest message it was handed: on the record now, where it was not
   * written at once, and delivered.
   */
  const take = async (target: OpenSession): Promise<void> => {
    target.took = true;
    const message = target.handed.shift();
    if (message !== undefined) {
      if (!message.written) {
        message.write();
      }
      await count(message.signals);
    }
  };

  /**
   * The agent is done with what it was sent: what the product was handed and did not say it
   * took is taken, on the record where the record does not hold it yet, and delivered.
   */
  const settle = async (target: OpenSession): Promise<void> => {
    target.took = true;
    const counted: RestSignal[] = [];
    for (const message of target.handed.splice(0)) {
      if (!message.written) {
        message.write();
      }
      counted.push(...message.signals);
    }
    await count(counted);
  };

  /**
   * Hears what the product said as its session was ended. Its words wait in the queue behind
   * whatever ended the session, and are let go there once the session is no longer the open
   * one: a message it said it took then is taken, and not sent again, and the conversation it
   * named is the one to go on with, where that message is.
   */
  const hearLast = async (target: OpenSession): Promise<void> => {
    let named = false;
    for (const message of queue) {
      if (message.t !== "driver" || message.session !== target) {
        continue;
      }
      const { event } = message;
      if (event.type === "conversation") {
        conversation = event.id;
        named = true;
      } else if (event.type === "taken") {
        await take(target);
      } else if (event.type === "turn_completed") {
        await settle(target);
        record(target, "status", "The turn completed.", { turn: "completed" });
      }
    }
    if (named) {
      await persist();
    }
  };

  /**
   * What becomes of what the product was handed and never took, as its session ends
   * (ADR-0131). Sent again, it is not delivered, and the record holds nothing more of it than
   * a line that says so: by the console to the runner started `after` this one, where the
   * runner itself ends; by this runner in the `next` session, where the product had taken
   * nothing of this one, and so had not started. Else it is let go: on the record as never
   * read, which delivers it; what the record holds since it was handed over, to a product that
   * waited for a message, is said in a line not to have been taken.
   */
  const leave = async (target: OpenSession, again?: "after" | "next"): Promise<void> => {
    const messages = target.handed.splice(0);
    const signals = messages.flatMap((message) => message.signals);
    if (signals.length === 0) {
      return;
    }
    const numbersOf = (some: readonly RestSignal[]): string =>
      some.map((signal) => `#${signal.number}`).join(", ");
    if (again !== undefined) {
      const numbers = numbersOf(signals);
      record(
        target,
        "status",
        `The session ended before the product took what it was sent: ${numbers}. It is sent again.`,
      );
      log(`${numbers} not taken when session ${target.id} ended: sent again`);
      if (again === "next") {
        for (const signal of signals) {
          // Waits to be handed over again: owed no word of the product's, and not delivered.
          owed.delete(signal.number);
          sentBefore.add(signal.number);
        }
        pending = [...signals, ...pending];
      }
      return;
    }
    const written = messages.filter((message) => message.written).flatMap((one) => one.signals);
    if (written.length > 0) {
      record(
        target,
        "status",
        `The session ended before the product took what it was sent: ${numbersOf(written)}. Whoever sent it says it again where it still matters.`,
      );
    }
    for (const message of messages) {
      if (!message.written) {
        message.write(true);
      }
    }
    // On the record as never read: delivered.
    await count(signals);
  };

  /**
   * What the transcript says of a signal beside its words: its number and kind, where it came
   * from, and who sent it, by the login, with the agent they sent it through. One shape for
   * every signal, so that whoever reads a session reads who stopped it as who told it.
   */
  const signalData = (signal: RestSignal) => ({
    signal: signal.number,
    kind: signal.kind,
    source: signal.source,
    key: signal.key,
    by: signal.by?.login ?? null,
    agent: signal.agent,
  });

  /** The next cool-down: the first, or twice the one before, up to the most. */
  const cooled = (before: typeof waits): { tries: number; until: number } => {
    const tries = (before?.tries ?? 0) + 1;
    const length = Math.min(timing.coolDownMs * 2 ** (tries - 1), timing.maxCoolDownMs);
    return { tries, until: options.now() + length };
  };

  /**
   * Counts what is delivered: signals in order, up to the last one the product took, the record
   * says was never read or let go, or the runner acted on itself, a stop or a choice of model
   * say, and never past one that still waits to be handed to the product or that the product
   * has not said it took.
   */
  const account = async (signal?: RestSignal): Promise<void> => {
    acted = Math.max(acted, signal?.number ?? 0);
    const most = Math.max(settled, acted);
    let least = Number.POSITIVE_INFINITY;
    for (const kept of pending) {
      least = Math.min(least, kept.number);
    }
    for (const number of owed) {
      least = Math.min(least, number);
    }
    const next = Math.min(most, least - 1);
    if (next > delivered) {
      delivered = next;
      await persist();
    }
  };

  /** Stops the turn under way through the driver, and says so where it could not. */
  const stopTurn = async (target: OpenSession): Promise<void> => {
    await target.driver.interrupt().catch((error: unknown) => {
      log(`the turn could not be stopped (${codeOf(error)})`);
    });
  };

  const onSignal = async (signal: RestSignal): Promise<void> => {
    handled = Math.max(handled, signal.number);
    if (
      signal.number <= delivered ||
      owed.has(signal.number) ||
      pending.some((kept) => kept.number === signal.number)
    ) {
      return;
    }
    const by = signal.by?.name ?? signal.by?.login ?? "a supervisor";
    switch (signal.kind) {
      case "stop": {
        held = true;
        if (session !== undefined) {
          // What the product had not taken is on the record before the stop that leaves it
          // unread; what a product that had not started was handed waits for the restart.
          await leave(session, session.took ? undefined : "next");
          record(session, "person", signal.text, signalData(signal));
        }
        await end("stopped");
        await account(signal);
        setState("stopped", "stop");
        return;
      }
      case "restart":
      case "reset": {
        held = false;
        waits = undefined;
        await end(signal.kind === "reset" ? "reset" : "restarted");
        if (signal.kind === "reset") {
          conversation = undefined;
          resetBy = by;
          // What a product was handed and never took is tried once more, in the new
          // conversation: a product that does not start with it again is not sent it a
          // third time, so that no signal stands in the way of every one after it for ever.
          for (const kept of pending) {
            if (sentBefore.has(kept.number)) {
              lastTry.add(kept.number);
            }
          }
        }
        // Its words are the agent's to read, in the first message of the session that follows.
        if (signal.text.trim().length > 0) {
          pending.push(signal);
        } else {
          await account(signal);
        }
        await persist();
        setState("running", signal.kind === "reset" ? "reset" : "resumed");
        if (pending.length > 0) {
          scheduleDeliver();
        }
        return;
      }
      case "set": {
        if (signal.set !== null) {
          settings = signal.set;
        }
        await account(signal);
        if (session !== undefined && !(await session.driver.set(settings))) {
          // Taken when the product starts: the session ends when no turn is under way, and the next has it.
          renew = true;
          if (!session.turn) {
            await end("restarted");
          }
        }
        push({ t: "heartbeat" });
        return;
      }
      case "interrupt": {
        // A turn of the session open when it was sent is stopped first; anything else just reads the words.
        const sent = Date.parse(signal.at);
        const stops = session?.turn === true && !held && sent >= session.startedAt;
        if (signal.text.trim().length === 0 && signal.attachments.length === 0) {
          // No words of its own: the turn is stopped so that what the agent was sent and has
          // not taken is read now. On the record as who stopped the turn, where one was.
          if (session !== undefined && stops) {
            record(session, "person", "", signalData(signal));
          }
          // Nothing is handed over once the runner is to end for an update: the turn is
          // stopped all the same, and what waits is sent again to the runner started after.
          if (pending.length > 0 && updatedTo === undefined) {
            if (stops) {
              await deliver("now");
            } else {
              scheduleDeliver();
            }
          } else if (session !== undefined && stops) {
            await stopTurn(session);
          }
          await account(signal);
          return;
        }
        pending.push(signal);
        if (stops && updatedTo !== undefined && session !== undefined) {
          // Its words are not handed to a runner that is to end: the turn is stopped, the
          // runner ends for the update, and the console sends them again to the one after.
          await stopTurn(session);
        } else if (stops) {
          await deliver("now");
        } else {
          scheduleDeliver();
        }
        return;
      }
      default: {
        pending.push(signal);
        if (waits !== undefined && signal.source === "person") {
          await deliver("next");
        } else {
          scheduleDeliver();
        }
      }
    }
  };

  const onDriver = async (target: OpenSession, event: DriverEvent): Promise<void> => {
    if (target !== session) {
      return;
    }
    switch (event.type) {
      case "running": {
        // What the product does not say of itself stays what the session was started with.
        target.running = {
          model: event.model ?? target.running.model,
          effort: event.effort ?? target.running.effort,
        };
        productVersion = event.version ?? productVersion;
        push({ t: "heartbeat" });
        return;
      }
      case "conversation": {
        conversation = event.id;
        await persist();
        return;
      }
      case "taken": {
        await take(target);
        return;
      }
      case "turn_completed": {
        // The agent is done with everything it was sent: what a product did not say it took is taken.
        await settle(target);
        // The record says where a turn ends, so that whoever reads it live knows the agent is done.
        record(target, "status", "The turn completed.", { turn: "completed" });
        target.turn = false;
        for (const signal of target.sent) {
          sentBefore.delete(signal.number);
          lastTry.delete(signal.number);
        }
        target.sent = [];
        if (waits !== undefined || stands.state !== "running") {
          waits = undefined;
          setState("running", "completed");
        }
        if (renew) {
          await end("restarted");
        }
        if (pending.length > 0) {
          scheduleDeliver();
        }
        return;
      }
      case "cannot_go_on": {
        // Reported, and nothing restarted: a supervisor's signal is tried at once, the rest after the cool-down.
        target.turn = false;
        // A product that did not start, or is not signed in, took nothing: what was sent is tried again.
        if (event.reason === "start" || event.reason === "sign_in") {
          // What a reset gave one more try and the product did not start with again is let
          // go: on the record as never read, with a line that says so, and sent no more.
          const again = target.sent.filter((signal) => !lastTry.has(signal.number));
          const gone = target.sent.filter((signal) => lastTry.has(signal.number));
          if (gone.length > 0) {
            for (const message of target.handed) {
              if (!message.written) {
                message.write(true, (signal) => lastTry.has(signal.number));
              }
            }
            const numbers = gone.map((signal) => `#${signal.number}`).join(", ");
            record(
              target,
              "status",
              `What the agent was sent before the reset was let go, since the product did not start with it again: ${numbers}. Whoever sent it says it again where it still matters.`,
              { let_go: numbers },
            );
            log(
              `${numbers} let go: the product did not start with what it was sent, after a reset too`,
            );
            for (const signal of gone) {
              lastTry.delete(signal.number);
              sentBefore.delete(signal.number);
            }
          }
          for (const signal of again) {
            sentBefore.add(signal.number);
            // Waits to be handed over again: owed no word of the product's, and not delivered.
            owed.delete(signal.number);
          }
          pending = [...again, ...pending];
          // Sent again, and on the record when it is taken then.
          target.handed = [];
          // What was let go is on the record as that, and is delivered: it is sent no more.
          await count(gone);
        }
        target.sent = [];
        waits = cooled(waits);
        setState(event.state, event.reason);
        if (pending.length > 0) {
          scheduleDeliver(waits.until);
        }
        return;
      }
      case "ended": {
        await end(event.how, true);
        if (pending.length > 0 && waits === undefined) {
          scheduleDeliver();
        }
        return;
      }
      default:
    }
  };

  /** The product as the console is told of it: its version as the product said it last, where that is a line the console takes. */
  const productOf = () => {
    const version = productVersion ?? probe.version ?? null;
    return {
      driver: driver.name,
      name: driver.product.name,
      version: lineOf(version),
      tried: driver.product.tried.includes(version ?? ""),
    };
  };

  /** What the product offers to choose from, as far as the console takes it, and what the driver can do. */
  const offersOf = () => ({
    models: offeredOf(probe.models),
    efforts: offeredOf(probe.efforts),
    steer: driver.can.steer,
    images: driver.can.images,
    resume: driver.can.resume,
  });

  /**
   * Says something of the runner's own to the agent, in the open session, under a header that
   * carries the session's mark: read after the tool call under way. The agent has a turn's work
   * in it, so it is counted as a turn, and what the runner does between two turns, an update or
   * a `runner.json` taken, waits for that turn to end. What the product says it took then is
   * this message, which the record holds nothing of, and not the message of a signal that waits
   * behind it. Whether it was said.
   */
  const sayToAgent = async (target: OpenSession, words: string): Promise<boolean> => {
    try {
      await target.driver.send({
        text: `[console ${target.mark} · runner]\n${words}`,
        images: [],
        priority: "next",
      });
      target.turn = true;
      target.handed.push({ written: true, write: () => undefined, signals: [] });
      return true;
    } catch {
      return false;
    }
  };

  /** The wake sources as the console is told of them: each by its name, how it stands, since when and why. */
  const sourcesOf = () =>
    [...sources].map(([name, one]) => {
      const why = lineOf(one.why);
      return {
        name,
        state: one.state,
        since: new Date(one.since).toISOString(),
        ...(why === null ? {} : { why }),
      };
    });

  /** Notes how a wake source stands, and has the console told at once where that is news. */
  const sourceStands = (
    name: string,
    state: "connected" | "waiting" | "failing",
    why?: string,
  ): void => {
    const before = sources.get(name);
    if (before?.state === state && before.why === why) {
      return;
    }
    sources.set(name, { state, since: options.now(), why });
    if (!stopped) {
      push({ t: "heartbeat" });
    }
  };

  const beat = async (): Promise<void> => {
    const now = `${stands.state} ${stands.reason} ${session?.id ?? ""}`;
    said = now;
    try {
      const answer = await client.runnerHeartbeat({
        state: stands.state,
        reason: stands.reason,
        delivered,
        session: session?.id ?? null,
        machine: options.machine,
        runner: options.version,
        product: productOf(),
        offers: offersOf(),
        // What the product says it runs with, where the console takes the name; nothing where
        // it would refuse it, so that one name does not cost the account its heartbeat.
        running: {
          model: choiceOf(session?.running.model),
          effort: choiceOf(session?.running.effort),
        },
        sources: sourcesOf(),
      });
      settings = answer.settings;
      tooOldSaid = false;
      sayOver("heartbeat", "the console takes the heartbeat again");
      // A stop that stands at the console and that this runner did not see: it was sent before
      // the runner started. One still on its way down the stream is acted on when it arrives,
      // with its words.
      if (answer.state === "stopped" && !held && answer.latest <= handled) {
        held = true;
        await end("stopped");
        stands = { state: "stopped", reason: "stop" };
      }
    } catch (error) {
      if (stopped) {
        return;
      }
      if (error instanceof ApiError && error.code === "client.outdated") {
        if (!tooOldSaid) {
          tooOldSaid = true;
          const install = options.updateCommand?.();
          log(
            `the console no longer takes this version of the command: ${error.message}${install === undefined ? "" : ` What installs it: ${install}`}`,
          );
          // The agent is told, once: what installs the version the console takes, which the
          // runner then sees and starts again for; and whom to tell where it cannot.
          if (session !== undefined && !session.first) {
            const target = session;
            const update =
              install === undefined
                ? ""
                : ` Update it: ${install}\nThe runner sees the update and is started again with it by itself, once no turn is under way.`;
            // Not told where it could not be: the runner's own line above says it to whoever
            // reads its output.
            await sayToAgent(
              target,
              `The console no longer takes this version of the command the runner runs from, and hears nothing of this session until it is updated.${update}\nWhere you cannot update it, say so to whom you report to.`,
            );
          }
        }
        return;
      }
      sayOnce("heartbeat", `the console did not take the heartbeat (${codeOf(error)})`);
    }
  };

  /**
   * Looks whether the package the runner runs from was updated (ADR-0101). A version is taken
   * once it was seen twice, a heartbeat's interval apart, so that an install under way has put
   * its last file down by the time the runner is started again.
   */
  const lookForUpdate = async (): Promise<void> => {
    if (options.installed === undefined || updatedTo !== undefined) {
      return;
    }
    const now = await options.installed().catch(() => undefined);
    if (now === undefined || now === options.version) {
      seenVersion = undefined;
      return;
    }
    if (seenVersion !== now) {
      seenVersion = now;
      seenAt = options.now();
      return;
    }
    // A heartbeat is said at every change of state too: two looks a moment apart are one
    // sighting, and the second counts a heartbeat's interval after the first, less what a
    // timer may be early by.
    if (options.now() - seenAt < timing.heartbeatMs - Math.min(1000, timing.heartbeatMs / 2)) {
      return;
    }
    updatedTo = now;
    log(
      `the command the runner runs from is ${now} now, and was ${options.version} when the runner started: the runner ends once no turn is under way, to be started again`,
    );
  };

  /**
   * Looks whether the desk's `runner.json` is another than the one the runner was started with
   * (ADR-0144). How it stands is taken once it was seen the same way twice, a heartbeat's
   * interval apart, so that a file being written is not read halfway. One that reads has the
   * runner end between two turns, for whoever started it to start the next with the file as it
   * is; the look goes on until then, and a file put back, or one that stopped reading, ends
   * nothing. One that does not read changes nothing: the runner goes on with what it has, and
   * the agent, whose file it is, is told what is wrong with it, once for each thing that is,
   * in the session that is open or in the next one.
   */
  const lookForChange = async (): Promise<void> => {
    if (options.reconfigured === undefined) {
      return;
    }
    const now = await options.reconfigured().catch(() => "same" as const);
    if (now === "same") {
      if (reconfigure) {
        log("runner.json is as the runner was started with it again: the runner goes on");
      }
      sighted = undefined;
      reconfigure = false;
      toldOf = undefined;
      sayOver("config", "runner.json is as the runner was started with it again");
      return;
    }
    const same =
      sighted !== undefined &&
      (now === "changed"
        ? sighted.what === "changed"
        : sighted.what !== "changed" && sighted.what.problem === now.problem);
    if (!same) {
      // Another state than the one before: counted from now, and nothing ends for the old one.
      sighted = { what: now, at: options.now() };
      reconfigure = false;
      return;
    }
    const since = sighted?.at ?? options.now();
    if (options.now() - since < timing.heartbeatMs - Math.min(1000, timing.heartbeatMs / 2)) {
      return;
    }
    if (now === "changed") {
      if (!reconfigure) {
        reconfigure = true;
        log(
          "runner.json changed since the runner started: the runner ends once no turn is under way, and starts again with it",
        );
      }
      return;
    }
    sayOnce(
      "config",
      `${now.problem}: the runner goes on with the runner.json it was started with`,
    );
    // Told once it can be: a session that opens later is told then.
    if (toldOf !== now.problem && session !== undefined && !session.first) {
      const told = await sayToAgent(
        session,
        `The desk's runner.json does not read: ${now.problem}. The runner goes on with the one it was started with. Put the file right, and the runner takes it by itself once your turn is over.`,
      );
      if (told) {
        toldOf = now.problem;
      }
    }
  };

  /** Waits so long, or until the runner stops. */
  const pause = (ms: number, signal: AbortSignal = abort.signal): Promise<void> =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  /**
   * Keeps a wake source listening for as long as the runner runs: started again when it ends,
   * soon where it held for a while, and after longer and longer where it keeps ending at once.
   * What it raises goes to the console, and comes back in order on the runner's own stream.
   */
  const keepSource = async (source: WakeSource): Promise<void> => {
    const wakes = options.wakes;
    if (source.run === undefined || wakes === undefined) {
      return;
    }
    const host: WakeHost = {
      secret: async (name) => secretValues.get(name),
      channels: options.config.channels ?? [],
      raise: async (raised) => {
        // The console takes so many wakes a runner raises itself within an hour (ADR-0132):
        // past that, what the sources raise is let go for a while, longer each time, and said
        // once, so that a source that repeats itself costs the console nothing more.
        if (wakesHeld !== undefined && options.now() < wakesHeld.until) {
          return;
        }
        try {
          await client.raiseWake({ source: "messenger", key: raised.key, text: raised.text });
        } catch (error) {
          if (codeOf(error) !== "signal.too_many") {
            throw error;
          }
          const pause = heldFor(wakesHeld);
          wakesHeld = { until: options.now() + pause, pause };
          sayOnce(
            "wakes",
            "the console takes no more wakes of this runner's within the hour (signal.too_many); what its wake sources raise is let go for a while",
          );
          return;
        }
        if (wakesHeld !== undefined) {
          wakesHeld = undefined;
          sayOver("wakes", "the console takes the wakes of this runner's wake sources again");
        }
      },
      log,
      stands: (state, why) => sourceStands(source.name, state, why),
      fetch: wakes.fetch,
      socket: wakes.socket,
      wait: pause,
    };
    sourceStands(source.name, "waiting");
    let wait = timing.reconnectMs;
    while (!stopped) {
      const began = options.now();
      try {
        await source.run(host, abort.signal);
        // Ended with no error, a connection the other side closed say: it listens no more
        // until it says so again. What it said of why it waits stands.
        if (!stopped && sources.get(source.name)?.state === "connected") {
          sourceStands(source.name, "waiting");
        }
      } catch (error) {
        if (!stopped) {
          log(`the wake source ${source.name} ended (${codeOf(error)}); started again`);
          sourceStands(source.name, "failing", codeOf(error));
        }
      }
      wait =
        options.now() - began >= SOURCE_HELD_MS
          ? timing.reconnectMs
          : Math.min(wait * 2, MAX_SOURCE_PAUSE_MS);
      await pause(wait);
    }
  };

  /** Reads the account's signals as they are sent, from the last one received on, for as long as the runner runs. */
  const listen = async (): Promise<void> => {
    while (!stopped) {
      try {
        for await (const signal of client.signalStream(received, abort.signal)) {
          received = Math.max(received, signal.number);
          sayOver("stream");
          push({ t: "signal", signal });
        }
      } catch (error) {
        if (!stopped) {
          sayOnce("stream", `the stream of signals ended (${codeOf(error)}); asked for again`);
        }
      }
      if (!stopped) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timing.reconnectMs);
          abort.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    }
  };

  return {
    stop() {
      if (!stopped) {
        push({ t: "stop" });
      }
    },

    async run() {
      const kept = await options.state.load().catch(() => undefined);
      delivered = kept?.delivered ?? 0;
      conversation = kept?.conversation;
      if (conversation !== undefined && kept?.driver !== undefined && kept.driver !== driver.name) {
        // Another product's conversation is nothing this one can go on with: asked to, it fails
        // at every turn until a supervisor resets it.
        conversation = undefined;
        log(
          `the conversation kept was begun under the driver ${kept.driver}: a new one begins under ${driver.name}`,
        );
      }
      probe = await driver.probe();
      const left =
        probe.models.length +
        probe.efforts.length -
        offeredOf(probe.models).length -
        offeredOf(probe.efforts).length;
      if (left > 0) {
        log(
          `${left} of the models and the levels of effort the product offers are not said to the console: it takes a name of letters, digits and . _ : [ ] - and ${MAX_RUNNER_OFFERS} of each`,
        );
      }
      await readSecrets();
      // The first heartbeat says the runner is there, and learns where the console's record stands.
      try {
        const first = await client.runnerHeartbeat({
          state: "running",
          reason: "started",
          delivered,
          session: null,
          machine: options.machine,
          runner: options.version,
          product: productOf(),
          offers: offersOf(),
          running: { model: null, effort: null },
        });
        settings = first.settings;
        delivered = Math.max(delivered, first.delivered);
        if (first.state === "stopped") {
          held = true;
          stands = { state: "stopped", reason: "stop" };
        }
      } catch (error) {
        log(`the console did not take the first heartbeat (${codeOf(error)}); the runner goes on`);
      }
      received = delivered;
      handled = delivered;
      said = `${stands.state} ${stands.reason} `;
      const listening = listen();
      const sourcing = (options.wakes?.sources ?? []).map((source) => keepSource(source));
      const beating = setInterval(() => push({ t: "heartbeat" }), timing.heartbeatMs);
      const batching = setInterval(() => push({ t: "flush" }), timing.batchMs);
      log(
        `the runner is there: ${driver.product.name} ${probe.version ?? "of a version it did not say"}, signals after #${delivered}`,
      );
      if (probe.version === undefined) {
        // Said before a session fails on it: asked for its version, the product's command did not answer.
        log(
          `the command of ${driver.product.name} did not answer when asked for its version: it is not installed where the runner looks for programs, or does not start there`,
        );
      }
      let how: RunnerEnd = "stopped";
      try {
        for (;;) {
          // An update is taken between two turns, and at once where none is under way; so is
          // a runner.json that changed.
          if ((updatedTo !== undefined || reconfigure) && session?.turn !== true) {
            how = updatedTo !== undefined ? "updated" : "changed";
            if (session !== undefined) {
              record(
                session,
                "status",
                updatedTo !== undefined
                  ? `The command the runner runs from was updated, from ${options.version} to ${updatedTo}: the runner ends, to be started again with it.`
                  : "The desk's runner.json changed: the runner ends, and starts again with it.",
              );
            }
            break;
          }
          const message = await next();
          if (message.t === "stop") {
            break;
          }
          try {
            if (message.t === "signal") {
              await onSignal(message.signal);
            } else if (message.t === "driver") {
              await onDriver(message.session, message.event);
            } else if (message.t === "deliver") {
              // A timer may fire a moment before the clock says it is time.
              if (deliverAt !== undefined && options.now() >= deliverAt - 20) {
                await deliver("next");
              }
            } else if (message.t === "flush") {
              if (session !== undefined) {
                await flush(session);
              }
            } else {
              await lookForUpdate();
              await lookForChange();
              // Said every thirty seconds, and at once when how the agent stands changed.
              const changed = said !== `${stands.state} ${stands.reason} ${session?.id ?? ""}`;
              if (changed || !queue.some((queued) => queued.t === "heartbeat")) {
                await beat();
                await readSecrets();
              }
            }
          } catch (error) {
            log(`the runner could not do what it was about to (${codeOf(error)}); it goes on`);
          }
        }
      } finally {
        stopped = true;
        clearInterval(beating);
        clearInterval(batching);
        for (const timer of timers) {
          clearTimeout(timer);
        }
        // A session ended for an update goes on, in the runner started after, as one a
        // supervisor restarted does: with the same conversation.
        await end(how === "stopped" ? "exited" : "restarted");
        abort.abort();
        await listening;
        await Promise.all(sourcing);
        log(
          how === "updated"
            ? "the runner ended, for the update"
            : how === "changed"
              ? "the runner ended, for its runner.json"
              : "the runner stopped",
        );
      }
      return how;
    },
  };
}
