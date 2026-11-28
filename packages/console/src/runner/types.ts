import type { AgentStateReason, TranscriptKind } from "../vocabulary.js";
import type { WakePart } from "../wake-text.js";

// What the runner's modules are to one another (ADR-0085, docs/specs/runner.md): a driver speaks
// to one product, a wake source raises wakes from outside the console, a service keeps the
// runner running, a boundary keeps one agent apart from another on a machine. The runner knows
// the interfaces and nothing of what is behind them.

/** A fact about a block of a transcript: a word, a number, a yes or no. */
export type Fact = string | number | boolean | null;

/** A picture, as a supervisor sends one with a tell and as a tool returns one. */
export interface Picture {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /**
   * Where the runner wrote it, from the desk, for a picture that came with a signal: what a
   * product that takes a picture as a file is handed. Nothing for a picture a tool returned.
   */
  readonly path?: string | undefined;
}

/**
 * What a driver says while its product runs: a block of the transcript before its number, or
 * one of the driver's own words to the runner.
 */
export type DriverEvent =
  | {
      readonly type: "event";
      readonly kind: TranscriptKind;
      readonly text: string;
      readonly data?: Readonly<Record<string, Fact>> | undefined;
      readonly pictures?: readonly Picture[] | undefined;
    }
  /** What the session runs with, as the product said when it started. */
  | {
      readonly type: "running";
      readonly model: string | null;
      readonly effort: string | null;
      readonly version: string | null;
    }
  /**
   * The id the product resumes the conversation from next time. With `anew`, the product was
   * asked to go on with a conversation and began this one in its place, since it kept the other
   * no more or goes on with none (ADR-0166): the runner then takes the agent's conversation to
   * have begun with the session, which holds nothing it was handed before.
   */
  | { readonly type: "conversation"; readonly id: string; readonly anew?: boolean | undefined }
  /**
   * The product took a message: the oldest it was sent and had not said so of. Said once for
   * every message sent, when the product reads it, so that a message handed over in a turn is
   * on the record where the agent came to it and not where it was written.
   */
  | { readonly type: "taken" }
  /** A turn completed: the agent is done with what it was sent, and waits for more. */
  | { readonly type: "turn_completed" }
  /**
   * The product put the conversation so far in fewer words of its own, as one does whose
   * conversation grew long (ADR-0166): what the agent was handed before, it holds as a summary
   * at best. Said by a driver whose product says so, and never by another.
   */
  | { readonly type: "compacted" }
  /**
   * How many sub-agents are at work in the background of the session, as the product lists
   * them (ADR-0162): said as that changes, from the first that is. A driver whose product lists
   * none says it never, and its sessions are waited for by their turns alone.
   */
  | { readonly type: "background"; readonly agents: number }
  /**
   * The product began a turn, one it starts by itself to hand the agent what a sub-agent in
   * the background did among them. Said once a sub-agent was said to be at work there.
   */
  | { readonly type: "turn_started" }
  /**
   * The agent cannot go on: the model refused, or the product failed; with why, in the
   * heartbeat's words. For a usage limit (`usage_limit`), `until` is when the product says the
   * limit resets, where it says: the runner brings the agent back then by itself.
   */
  | {
      readonly type: "cannot_go_on";
      readonly state: "refused" | "failed";
      readonly reason: AgentStateReason;
      readonly until?: number | undefined;
    }
  /**
   * How much of what the product's subscription allows is used, as the product said it: a
   * window each. Said whenever the product says so, and never by a driver whose product says
   * nothing of it, of which the runner then knows nothing.
   */
  | { readonly type: "usage"; readonly windows: readonly UsageWindow[] }
  /** The product's process is gone: by itself, or mid-turn. Always the last. */
  | { readonly type: "ended"; readonly how: "exited" | "crashed" };

/**
 * A window of what a product's subscription allows, which resets: the short one and the week
 * of Claude Code, say. Everything signed in with the subscription draws on it, a session and
 * each of its sub-agents alike.
 */
export interface UsageWindow {
  /** What the window is called, in a few plain words of the driver's for the product's own. */
  readonly name: string;
  /** How much of it is used, from 0 to 1; nothing where the product does not say. */
  readonly used: number | undefined;
  /** When it resets, in milliseconds since the epoch; nothing where the product does not say. */
  readonly resetsAt: number | undefined;
  /** Whether the product itself says the window is near its limit, whatever the share used. */
  readonly near?: boolean | undefined;
  /**
   * Whether the window is of a part of the allowance and not of the plan whole, one model's
   * week say: the agent is told of it in words of its own, since its limit is that part's,
   * and what it does about it is its own to decide.
   */
  readonly part?: boolean | undefined;
  /**
   * Whether the window is of a quota kept apart from the one the session draws on, another
   * model's say, as the Codex driver reads a bucket other than the plan's: said on to the
   * console as every window is, and told to the agent at no share of it, since nothing here
   * knows that the session's requests are counted on it.
   */
  readonly apart?: boolean | undefined;
}

/** A message for the agent: `now` stops the turn first, `next` goes after the tool call under way. */
export interface DriverMessage {
  readonly text: string;
  readonly images: readonly Picture[];
  readonly priority: "now" | "next";
}

/** One process of the product. */
export interface DriverSession {
  send(message: DriverMessage): Promise<void>;
  /** Stops the turn under way, and nothing else. */
  interrupt(): Promise<void>;
  /** The model and the effort, where the product takes them in a running session; false where it does not. */
  set(choice: {
    readonly model?: string | null | undefined;
    readonly effort?: string | null | undefined;
  }): Promise<boolean>;
  /** Ends the process: asked first, then made to. */
  stop(): Promise<void>;
  /**
   * Whether this session's product takes a picture, where that is known only of a session: an
   * agent says what it takes when it starts. Nothing while it is not known, and left out by a
   * driver whose product always answers as `can.images` says.
   */
  images?(): boolean | undefined;
  /** What the product does, as whole blocks, until it ends. Read once. */
  readonly events: AsyncIterable<DriverEvent>;
}

export interface StartOptions {
  /** The desk: the directory the product works in. */
  readonly cwd: string;
  /** What is added to the product's environment: the secrets `runner.json` maps to variables. */
  readonly env: Readonly<Record<string, string>>;
  readonly model: string | null;
  readonly effort: string | null;
  /** The conversation to go on with, or nothing for a new one. */
  readonly resume: string | undefined;
  /**
   * The permission mode the product is started in, in the product's own word, as `runner.json`
   * names it; the driver's own for a run nobody attends where nothing names one.
   */
  readonly permissions?: string | undefined;
  /**
   * The agent's browser, as `runner.json` names it; a driver that starts its product with none
   * takes nothing of it.
   */
  readonly browser?: string | undefined;
  /**
   * What cuts a text to what the transcript shows of it. A driver cuts whatever it shows a
   * part of through this, and never by itself first; left out, a text is cut as it is.
   */
  readonly cut?: Cut | undefined;
  /**
   * What keeps the end of a text to what the transcript shows of it, the secrets out first: the
   * end of what the product wrote on its standard error, which says why it ended. A driver shows
   * that through this (`errorsShown`); left out, a text is cut as it is.
   */
  readonly cutEnd?: Cut | undefined;
}

/**
 * A text within `most` characters as the transcript shows it, ended by the mark of a cut where
 * it was longer: the account's secrets are taken out first and the text is cut after, so that
 * no part of one stands at the cut. `more` says that the text is itself the beginning of a
 * longer one, which the driver kept to a bound: its last characters may begin a secret, and
 * are not shown.
 */
export type Cut = (text: string, most: number, more?: boolean) => string;

/** A text cut as it is, with the mark of a cut: what a driver cuts with where it was handed nothing to cut with. */
export const plainCut: Cut = (text, most) =>
  text.length > most ? `${text.slice(0, most)}…` : text;

/** The end of a text kept as it is, begun by the mark of a cut: what a driver keeps the end of a text with where it was handed nothing to. */
export const plainCutEnd: Cut = (text, most, more = false) =>
  text.length > most || more ? `…${text.slice(Math.max(0, text.length - most))}` : text;

/** How much of the end of what a product wrote on its standard error an event shows. */
export const MAX_ERRORS_SHOWN = 4000;

/**
 * What a product wrote on its standard error as an event shows it: its end, within
 * `MAX_ERRORS_SHOWN`, kept through `cutEnd`, so that the secrets are out before it is cut. A
 * text whose beginning the child let go begins with the mark of a cut (`Child.errors`), and its
 * first characters may be the end of a secret: they are not shown.
 */
export function errorsShown(errors: string, cutEnd: Cut): string {
  const text = errors.trim();
  const more = text.startsWith("…");
  return cutEnd(more ? text.slice(1) : text, MAX_ERRORS_SHOWN, more);
}

/**
 * Why a product's process never started, as an event says it: that its command is not there, in
 * words that say where it is looked for, or what the system said of it.
 */
export function notStarted(error: string, command?: string): string {
  return /\bENOENT\b/.test(error)
    ? `The product could not be started: its command${command === undefined ? "" : ` ${command}`} was not found where the runner looks for programs. Install it, or put its folder on the PATH the runner is started with.`
    : `The product could not be started: ${error}`;
}

/** What the installed product is and offers, asked without starting a session. */
export interface Probe {
  readonly version: string | undefined;
  readonly models: readonly string[];
  readonly efforts: readonly string[];
}

/** The module that speaks to one product. */
export interface Driver {
  readonly name: string;
  /** What the product is called, and the versions of it the driver was tried with. */
  readonly product: { readonly name: string; readonly tried: readonly string[] };
  readonly can: {
    /** Whether a message reaches the agent after the tool call under way, and a turn is stopped for one. */
    readonly steer: boolean;
    /** Whether a message carries pictures the product sees. */
    readonly images: boolean;
    /** Whether the product takes a picture as a file in the desk, by its path, where others take its bytes. */
    readonly imageFiles?: boolean | undefined;
    /** Whether a conversation is gone on with from one session to the next. */
    readonly resume: boolean;
    /** Whether the model and the effort are taken in a running session. */
    readonly set: boolean;
    /**
     * Whether a message the driver said was taken stands in the product's conversation from
     * then on, whatever became of the turn: the driver says `taken` when the product says the
     * message back out of its conversation, or began a turn with it. Where it does, what the
     * product took as a usage limit was reached is named to the agent in the same session and
     * not said a second time (ADR-0166). Left out, or false, for a driver that says `taken` when
     * it handed the message over: the runner then says such a message whole again.
     */
    readonly holdsTaken?: boolean | undefined;
  };
  /**
   * The product's permission modes, in its own words: what runs without asking. `unattended` is
   * the one the driver starts the product in where `runner.json` names none, and `least` the
   * one it starts it in where what is named is none of the product's.
   */
  readonly permissions: {
    readonly modes: readonly string[];
    readonly unattended: string;
    readonly least: string;
  };
  probe(): Promise<Probe>;
  start(options: StartOptions): DriverSession;
}

/** A child process as a driver needs one: lines in, lines out, and how it ended. */
export interface Child {
  /** One line on its standard input. */
  write(line: string): Promise<void>;
  /** Closes its standard input: nothing more is coming. */
  end(): void;
  /** Its standard output, a line at a time, until it closes. Read once. */
  readonly lines: AsyncIterable<string>;
  /**
   * The end of what it wrote on its standard error, bounded: where its beginning was let go, it
   * begins with the mark of a cut (`…`), since what it begins with may be the end of a secret.
   */
  errors(): string;
  kill(signal: "SIGINT" | "SIGTERM" | "SIGKILL"): void;
  /** How it ended: its exit code, or the signal that ended it; or why it never started. Never rejects. */
  readonly exited: Promise<{
    readonly code: number | null;
    readonly signal: string | null;
    readonly error?: string | undefined;
  }>;
}

/** Starts a child process. One whose command is not there to start says so when it is asked how it ended. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
) => Child;

/** A socket a wake source listens on: messages of text in, messages of text out. */
export interface WakeSocket {
  /** What arrives, a message at a time, until the socket closes. Read once. */
  readonly messages: AsyncIterable<string>;
  send(text: string): void;
  close(): void;
}

// A part of a wake a source raises (ADR-0163): declared with how the parts are written as a
// signal's text, which the console writes too.
export type { WakePart } from "../wake-text.js";

/**
 * A wake as a wake source raises one: `parts` where the source says something itself, who wrote
 * and where say, beside what was written; `text` where all of it is someone else's words.
 */
export type RaisedWake =
  | { readonly key: string; readonly parts: readonly WakePart[] }
  | { readonly key: string; readonly text: string };

/**
 * What a source read of where one of its wakes was raised, for the account's own command
 * (`console agent messages`): the parts to print, as a wake carries them, or why it read
 * nothing, in a short name: `no_token` where the account keeps nothing to read with,
 * `not_a_conversation` and `not_a_moment` where what was named is none, and otherwise the
 * messenger's own word.
 */
export type WakeRead =
  | { readonly ok: true; readonly parts: readonly WakePart[] }
  | { readonly ok: false; readonly why: string };

/** An account at a source's messenger, as a message names whoever wrote it: by the messenger's ids for the workspace and the account. */
export interface WakeAccount {
  readonly workspace: string;
  readonly account: string;
}

/**
 * Who an account at a messenger is to the agent, as the console says it (ADR-0164): `told` where
 * the console is told the accounts of that workspace at all, and the member the account is, by
 * their login, with what kind of member they are and whether they supervise the agent; `null`
 * for an account that is no member's as far as the console is told. `administrator` and `line`
 * say how: an administrator, and where in the agent's reporting line the member stands, its
 * `manager`, anyone further `above`, a `report` of its own or anyone further `below`.
 */
export interface WakeWriter extends WakeAccount {
  readonly told: boolean;
  readonly member: {
    readonly login: string | null;
    readonly kind: "person" | "agent";
    readonly supervisor: boolean;
    readonly administrator?: boolean | undefined;
    readonly line?: "manager" | "above" | "report" | "below" | null | undefined;
  } | null;
}

/** What a wake source is given of the runner and of the machine. */
export interface WakeHost {
  /** A secret of the account's store, by name; nothing where it keeps none. */
  secret(name: string): Promise<string | undefined>;
  /**
   * The channels `runner.json` names as ones the agent listens to, by the ids of the messenger
   * they are of: what a person says in one wakes the agent, named or not.
   */
  readonly channels: readonly string[];
  /**
   * Raises a wake: the console records it, and it reaches the agent in order, the source's own
   * lines under the session's mark and everything else as someone else's words. Answers
   * whether the console took it: a wake raised past what the console takes within an hour is
   * let go, and reaches nobody.
   */
  raise(wake: RaisedWake): Promise<boolean>;
  /**
   * What the source keeps from one run of its own to the next, under names of its own, and from
   * one runner to the one started after it where the machine keeps it (ADR-0166): the ids and
   * the moments of what it brought the agent. Never a secret, and never a word of a message.
   */
  readonly kept: Map<string, string>;
  /**
   * When the conversation the agent goes on with began, in milliseconds since the epoch
   * (ADR-0166): at a reset, with a new day where the desk says so, in a session whose product
   * goes on with none, and when the product put it in fewer words. What the agent was handed
   * before that moment its conversation holds no more, so a source counts nothing from before
   * it as brought. 0 where nothing says when; left out by a host that says nothing of it, which
   * a source reads as 0.
   */
  began?(): number;
  /** A line for whoever reads the runner's own output: never what a message says. */
  log(line: string): void;
  /**
   * Says how the source stands, which the account's page shows (ADR-0144): listening, or not
   * yet, with why in a few words of the source's own. Never what a message says.
   */
  stands(state: "connected" | "waiting", why?: string): void;
  fetch(
    url: string,
    init: {
      readonly method: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly signal: AbortSignal;
    },
  ): Promise<{ json(): Promise<unknown> }>;
  socket(url: string): WakeSocket;
  /** Waits so long, or less where the signal ends the wait. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
  /**
   * Who accounts at the source's messenger are, as the console knows them (ADR-0164), in the
   * order asked: the one way a source learns that an account is a member's, or a supervisor's.
   * It is the console's answer to the account's own sign-in, and nothing a message, a name or
   * the messenger says stands in for it. Left out, or rejecting, where the console says nothing
   * of it, one older than this say: the source then says of an account what the messenger does.
   */
  writers?(accounts: readonly WakeAccount[], signal: AbortSignal): Promise<readonly WakeWriter[]>;
}

/** A module that raises wakes from outside the console. `console`, the console's own stream of signals, is the runner's own. */
export interface WakeSource {
  readonly name: string;
  /**
   * Listens until it ends or the signal does, raising a wake for what is said to the agent. A
   * source that ended is started again by the runner, after a while. `console` has none.
   */
  run?(host: WakeHost, signal: AbortSignal): Promise<void>;
  /**
   * Reads the latest of what was said where a wake of the source's was raised, named as the
   * wake's key names it after the source's own name: for the account's own command, where a wake
   * carried less than the agent needs. Left out by a source that reads nothing.
   */
  read?(
    host: Pick<WakeHost, "secret" | "fetch" | "writers">,
    where: string,
    options: {
      /** How many of the latest messages are asked for, held to the source's own bounds; its own number where none is said. */
      readonly limit?: number | undefined;
      /** The moment of a message, as the messenger spells one: what was written after it alone is read. */
      readonly after?: string | undefined;
      /** The moment the read is asked at, in milliseconds since the epoch: how long ago a message was written is said by it. */
      readonly now: number;
      readonly signal: AbortSignal;
    },
  ): Promise<WakeRead>;
}

/** What a service is told of the runner it keeps running. */
export interface ServiceInput {
  /** The desk, absolute: where the runner is started. */
  readonly desk: string;
  /** The home directory of the OS account the runner runs in, and the account's number where the system has one. */
  readonly home: string;
  readonly uid: number | undefined;
  /** The name of that OS account, for a service that names it: a task of Windows is the machine's, called by whose it is. */
  readonly user?: string | undefined;
  /** What starts the runner: the runtime, the command and its words, absolute where they are files. */
  readonly program: readonly string[];
  /** Where the runner's process, and the product it starts, look for programs. */
  readonly path: string | undefined;
}

/** A command a service has run. */
export interface ServiceCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** What is added to the environment it runs in. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly mayFail?: boolean | undefined;
  /** For one that may fail: what is left to do where it did, in a sentence. */
  readonly otherwise?: string | undefined;
  /**
   * How many times it is tried, a second apart, until it succeeds: for the first command after
   * one the system answers before it has done what was asked. Once where nothing is said.
   */
  readonly tries?: number | undefined;
}

/** What a service writes and runs to keep a runner running. Nothing of it needs an administrator's rights. */
export interface ServicePlan {
  /** Whole files, each with the mode it is written in. */
  readonly files: readonly {
    readonly path: string;
    readonly text: string;
    readonly mode: number;
  }[];
  /**
   * Commands, in order; one that fails where nothing was there before says so. One that may fail
   * and did says what is left to do, where it names it: the setup prints that, and goes on.
   */
  readonly commands: readonly ServiceCommand[];
  /**
   * What has the system read files written again, without ending the runner that may be
   * running under the service: run by a refresh that changed one. None where the system reads
   * a file only when it loads the service.
   */
  readonly reread?: readonly ServiceCommand[] | undefined;
  /** Where the runner's own lines are kept, for whoever looks when it is not heard from. */
  readonly log: string;
  /** What to look at when a command did not succeed, in a sentence. */
  readonly failing: string;
  /** When files written again are read, where the commands are not run: the end of a sentence. */
  readonly reload: string;
}

/**
 * The variable a service's keeper names its own process in, by number, on a system that ends a
 * keeper and leaves what it started: a runner told so looks for that process, and stops when it
 * is gone.
 */
export const KEEPER_VARIABLE = "CONSOLE_RUNNER_KEEPER";

/** A module that keeps the runner running across restarts of the machine. */
export interface Service {
  readonly name: string;
  /** The platforms it keeps a runner running on, as the runtime names them (`darwin`). */
  readonly platforms: readonly string[];
  /** What to write and to run; or why it cannot, in a few words. */
  plan(input: ServiceInput): ServicePlan | { readonly problem: string };
}

/** A module that keeps one agent apart from another on a machine, and says whose the runner is. */
export interface Boundary {
  readonly name: string;
  /** The OS account the runner runs in. */
  user(): string;
}
