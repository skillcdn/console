import type { AgentStateReason, TranscriptKind } from "../vocabulary.js";

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
  /** The id the product resumes the conversation from next time. */
  | { readonly type: "conversation"; readonly id: string }
  /** A turn completed: the agent is done with what it was sent, and waits for more. */
  | { readonly type: "turn_completed" }
  /** The agent cannot go on: the model refused, or the product failed; with why, in the heartbeat's words. */
  | {
      readonly type: "cannot_go_on";
      readonly state: "refused" | "failed";
      readonly reason: AgentStateReason;
    }
  /** The product's process is gone: by itself, or mid-turn. Always the last. */
  | { readonly type: "ended"; readonly how: "exited" | "crashed" };

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
  /** The end of what it wrote on its standard error, bounded. */
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

/** What a wake source is given of the runner and of the machine. */
export interface WakeHost {
  /** A secret of the account's store, by name; nothing where it keeps none. */
  secret(name: string): Promise<string | undefined>;
  /** Raises a wake: the console records it, and it reaches the agent in order, as someone else's words. */
  raise(wake: { readonly key: string; readonly text: string }): Promise<void>;
  /** A line for whoever reads the runner's own output: never what a message says. */
  log(line: string): void;
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
}

/** A module that raises wakes from outside the console. `console`, the console's own stream of signals, is the runner's own. */
export interface WakeSource {
  readonly name: string;
  /**
   * Listens until it ends or the signal does, raising a wake for what is said to the agent. A
   * source that ended is started again by the runner, after a while. `console` has none.
   */
  run?(host: WakeHost, signal: AbortSignal): Promise<void>;
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
