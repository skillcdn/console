import { ApiError, type ConsoleClient } from "../client.js";
import {
  MAX_TRANSCRIPT_ATTACHMENTS,
  MAX_TRANSCRIPT_BATCH,
  MAX_TRANSCRIPT_BATCH_BYTES,
  MAX_TRANSCRIPT_FACT_LENGTH,
  MAX_TRANSCRIPT_FACT_NAME_LENGTH,
  MAX_TRANSCRIPT_FACTS,
  MAX_TRANSCRIPT_TEXT_BYTES,
} from "../limits.js";
import type { RestSignal, RestTranscriptEventInput } from "../schemas.js";
import type { AgentStateReason, TranscriptKind } from "../vocabulary.js";
import type { RunnerConfig } from "./config.js";
import { composeSignals, GROUP_WINDOW_MS, introOf, makeMark } from "./message.js";
import { redactorOf } from "./redact.js";
import type { Driver, DriverEvent, DriverSession, Fact, Picture, Probe } from "./types.js";

// The runner (ADR-0085, docs/specs/runner.md): one process per agent account on its machine. It
// keeps one session of the agent's product at a time, feeds it what the console sends, reports
// what the product does, and says every thirty seconds that it is there. It restarts nothing by
// itself: an agent that cannot go on waits, and a supervisor's signal is what is tried next.
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
/** How many events wait to be sent before the oldest are let go: a console away for hours is not kept up with in memory. */
const MAX_OUTBOX = 20_000;
/** Room left in a batch for what wraps its events. */
const BATCH_ROOM_BYTES = MAX_TRANSCRIPT_BATCH_BYTES - 64 * 1024;

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
>;

/** What the runner keeps between its own restarts. No secret is in it. */
export interface RunnerState {
  /** The number of the last signal handed to the product. */
  readonly delivered: number;
  /** The conversation the next session goes on with, where the product resumes one. */
  readonly conversation: string | undefined;
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
  readonly now: () => number;
  readonly random: () => number;
  /** A moment as a header says it: the hour and the minute in the workspace's zone. */
  readonly time: (iso: string) => string;
  /** A session's files under the desk's ignored `work/`: written for their owner alone, removed at its end. */
  readonly files: {
    write(path: string, text: string): Promise<void>;
    remove(path: string): Promise<void>;
  };
  readonly state: {
    load(): Promise<RunnerState | undefined>;
    save(state: RunnerState): Promise<void>;
  };
  /** A line for whoever reads the runner's own output: ids, numbers and codes, never what a signal or an event says. */
  readonly log: (line: string) => void;
  /** The durations, for a test to shorten. */
  readonly timing?: Partial<{
    heartbeatMs: number;
    batchMs: number;
    groupWindowMs: number;
    coolDownMs: number;
    maxCoolDownMs: number;
    reconnectMs: number;
  }>;
}

export interface Runner {
  /** Runs until stopped: resolves when the open session is ended and nothing is left to send. */
  run(): Promise<void>;
  /** Stops the runner: the session open is ended as exited. */
  stop(): void;
}

interface Outgoing {
  n: number;
  readonly kind: TranscriptKind;
  readonly at: string;
  readonly text: string;
  readonly data: Record<string, Fact>;
  readonly pictures: readonly Picture[];
  /** The ids its pictures were kept under, once they were handed in: a batch sent again hands none in twice. */
  files?: readonly string[];
}

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
  /** The number of the last event of it. */
  n: number;
  /** What the product did and the console has not been sent yet. */
  outbox: Outgoing[];
  /** Whether the console takes nothing more of it: over there, or its month away. */
  refused: boolean;
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

/** A text within `bytes` of UTF-8, cut between characters, with a word that says it was cut. */
function boundedText(text: string, bytes: number): string {
  if (text.length * 3 <= bytes) {
    return text;
  }
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= bytes) {
    return text;
  }
  const note = `\n[cut by the runner: ${encoded.byteLength} bytes in all]`;
  let end = bytes - Buffer.byteLength(note);
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return `${encoded.subarray(0, end).toString("utf8")}${note}`;
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

export function createRunner(options: RunnerOptions): Runner {
  const { client, driver, config, log } = options;
  const timing = {
    heartbeatMs: HEARTBEAT_MS,
    batchMs: BATCH_MS,
    groupWindowMs: GROUP_WINDOW_MS,
    coolDownMs: COOL_DOWN_MS,
    maxCoolDownMs: MAX_COOL_DOWN_MS,
    reconnectMs: RECONNECT_MS,
    ...options.timing,
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
  let delivered = 0;
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
  let redact: (text: string) => string = (text) => text;
  let tooOldSaid = false;

  const persist = async (): Promise<void> => {
    try {
      await options.state.save({ delivered, conversation });
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
    target.outbox.push({
      n: target.n,
      kind,
      at: new Date(options.now()).toISOString(),
      text: boundedText(redact(text), MAX_TRANSCRIPT_TEXT_BYTES),
      data: boundedFacts(data, redact),
      pictures: pictures.slice(0, MAX_TRANSCRIPT_ATTACHMENTS),
    });
    if (target.outbox.length > MAX_OUTBOX) {
      target.outbox.splice(0, target.outbox.length - MAX_OUTBOX);
    }
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

  /** Sends what the product did, a batch at a time, the pictures first. What the console has already is left there. */
  const flush = async (target: OpenSession): Promise<void> => {
    if (flushing) {
      return;
    }
    flushing = true;
    try {
      while (target.outbox.length > 0 && !target.refused) {
        const batch: Outgoing[] = [];
        let bytes = 0;
        for (const event of target.outbox) {
          const size = Buffer.byteLength(event.text) + 1024;
          if (
            batch.length >= MAX_TRANSCRIPT_BATCH ||
            (batch.length > 0 && bytes + size > BATCH_ROOM_BYTES)
          ) {
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
          target.outbox.splice(0, batch.length);
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
            continue;
          }
          if (
            code === "transcript.session_over" ||
            code === "transcript.session_not_found" ||
            code === "transcript.away"
          ) {
            log(`the console takes nothing more of session ${target.id} (${code})`);
            target.refused = true;
            target.outbox = [];
            return;
          }
          throw error;
        }
      }
    } catch (error) {
      // Kept, and sent with the next batch.
      if (!stopped) {
        log(`the transcript of session ${target.id} waits to be sent (${codeOf(error)})`);
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
        product: {
          driver: driver.name,
          name: driver.product.name,
          version: productVersion ?? probe.version ?? null,
          tried: driver.product.tried.includes(productVersion ?? probe.version ?? ""),
        },
        model: settings.model,
        effort: settings.effort,
        resumed: resume !== undefined,
        machine: options.machine,
      });
    } catch (error) {
      log(`a session could not be begun at the console (${codeOf(error)})`);
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
      }),
      startedAt: options.now(),
      first: true,
      turn: false,
      sent: [],
      n: 0,
      outbox: [],
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
    record(target, "status", `The session ended: ${how}.`, { ended: how });
    await flush(target);
    try {
      await client.endAgentSession(target.id, { how });
    } catch (error) {
      log(`the end of session ${target.id} was not told to the console (${codeOf(error)})`);
    }
    for (const path of target.written) {
      await options.files.remove(path).catch(() => undefined);
    }
    log(`session ${target.id} ended: ${how}`);
    push({ t: "heartbeat" });
  };

  /** Hands the product what is pending, as one message; begins a session where none is open. */
  const deliver = async (priority: "now" | "next"): Promise<void> => {
    deliverAt = undefined;
    if (held || pending.length === 0) {
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
    // The pictures a supervisor sent, read from the console for the product to see.
    const pictures = new Map<number, Picture[]>();
    for (const signal of batch) {
      for (const file of signal.attachments) {
        try {
          const read = await client.readSignalFile(signal.number, file.id, abort.signal);
          pictures.set(signal.number, [
            ...(pictures.get(signal.number) ?? []),
            { name: file.name, contentType: file.contentType, bytes: read.bytes },
          ]);
        } catch (error) {
          log(`a picture of signal #${signal.number} could not be read (${codeOf(error)})`);
        }
      }
    }
    const images = driver.can.images ? [...pictures.values()].flat() : [];
    const composed = composeSignals(batch, { mark: target.mark, time: options.time });
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
    target.turn = true;
    for (const signal of batch) {
      record(
        target,
        signal.source === "person" ? "person" : "wake",
        signal.text,
        {
          signal: signal.number,
          kind: signal.kind,
          source: signal.source,
          key: signal.key,
          by: signal.by?.login ?? null,
          agent: signal.agent,
        },
        pictures.get(signal.number),
      );
    }
    target.sent = batch;
    delivered = Math.max(delivered, ...batch.map((signal) => signal.number));
    await persist();
    await account();
  };

  /** The next cool-down: the first, or twice the one before, up to the most. */
  const cooled = (before: typeof waits): { tries: number; until: number } => {
    const tries = (before?.tries ?? 0) + 1;
    const length = Math.min(timing.coolDownMs * 2 ** (tries - 1), timing.maxCoolDownMs);
    return { tries, until: options.now() + length };
  };

  /**
   * A signal that is the runner's own to act on, a stop or a choice of model say, counts as
   * delivered once nothing received before it still waits to be handed to the product.
   */
  const account = async (signal?: RestSignal): Promise<void> => {
    acted = Math.max(acted, signal?.number ?? 0);
    if (pending.length === 0 && acted > delivered) {
      delivered = acted;
      await persist();
    }
  };

  const onSignal = async (signal: RestSignal): Promise<void> => {
    handled = Math.max(handled, signal.number);
    if (signal.number <= delivered || pending.some((kept) => kept.number === signal.number)) {
      return;
    }
    const by = signal.by?.name ?? signal.by?.login ?? "a supervisor";
    switch (signal.kind) {
      case "stop": {
        held = true;
        if (session !== undefined) {
          record(session, "person", signal.text, { signal: signal.number, kind: "stop", by });
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
        pending.push(signal);
        // A turn of the session open when it was sent is stopped first; anything else just reads the words.
        const sent = Date.parse(signal.at);
        if (session?.turn === true && !held && sent >= session.startedAt) {
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
        target.running = { model: event.model, effort: event.effort };
        productVersion = event.version ?? productVersion;
        push({ t: "heartbeat" });
        return;
      }
      case "conversation": {
        conversation = event.id;
        await persist();
        return;
      }
      case "turn_completed": {
        target.turn = false;
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
          pending = [...target.sent, ...pending];
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
        product: {
          driver: driver.name,
          name: driver.product.name,
          version: productVersion ?? probe.version ?? null,
          tried: driver.product.tried.includes(productVersion ?? probe.version ?? ""),
        },
        offers: {
          models: [...probe.models],
          efforts: [...probe.efforts],
          steer: driver.can.steer,
          images: driver.can.images,
          resume: driver.can.resume,
        },
        running: session?.running ?? { model: null, effort: null },
      });
      settings = answer.settings;
      tooOldSaid = false;
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
          log(`the console no longer takes this version of the command: ${error.message}`);
          // The agent is told, once, so that it tells whoever it reports to.
          if (session !== undefined && !session.first) {
            await session.driver
              .send({
                text: `[console ${session.mark} · runner]\nThe console no longer takes this version of the command the runner runs from, and hears nothing of this session until it is updated. Say so to whom you report to (console manager).`,
                images: [],
                priority: "next",
              })
              .catch(() => undefined);
          }
        }
        return;
      }
      log(`the console did not take the heartbeat (${codeOf(error)})`);
    }
  };

  /** Reads the account's signals as they are sent, from the last one received on, for as long as the runner runs. */
  const listen = async (): Promise<void> => {
    while (!stopped) {
      try {
        for await (const signal of client.signalStream(received, abort.signal)) {
          received = Math.max(received, signal.number);
          push({ t: "signal", signal });
        }
      } catch (error) {
        if (!stopped) {
          log(`the stream of signals ended (${codeOf(error)}); asked for again`);
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
      probe = await driver.probe();
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
          product: {
            driver: driver.name,
            name: driver.product.name,
            version: probe.version ?? null,
            tried: driver.product.tried.includes(probe.version ?? ""),
          },
          offers: {
            models: [...probe.models],
            efforts: [...probe.efforts],
            steer: driver.can.steer,
            images: driver.can.images,
            resume: driver.can.resume,
          },
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
      const beating = setInterval(() => push({ t: "heartbeat" }), timing.heartbeatMs);
      const batching = setInterval(() => push({ t: "flush" }), timing.batchMs);
      log(
        `the runner is there: ${driver.product.name} ${probe.version ?? "of a version it did not say"}, signals after #${delivered}`,
      );
      try {
        for (;;) {
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
        await end("exited");
        abort.abort();
        await listening;
        log("the runner stopped");
      }
    },
  };
}
