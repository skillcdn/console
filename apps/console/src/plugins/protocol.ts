// What passes between the console, its plugin host and the threads plugins run in
// (docs/specs/plugins.md, "The host"): plain messages, JSON-sized, with files as handles. The
// parent decides every call on `ctx`; the host and the threads carry messages and nothing else.
import type { PluginCaller, PluginDescription, PluginInfo } from "@skillcdn/console/plugin";

/** The bytes one message may hold: `MAX_PLUGIN_MESSAGE_BYTES` of the package, measured as JSON. */
export const MESSAGE_BYTES_AT_MOST = 4 * 1024 * 1024;

/** A refusal or a failure as it crosses: the console's code, a message a person may read. */
export interface WireError {
  readonly code: string;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * The kinds of function a plugin defines that the console calls, and `validate`, which is the
 * console's own: the thread checks a record's data against a collection's schema, for a write the
 * parent merged.
 */
export const CALL_KINDS = [
  "command",
  "query",
  "endpoint",
  "hook",
  "job",
  "upgrade",
  "api",
  "enable",
  "disable",
  "validate",
] as const;

export type CallKind = (typeof CALL_KINDS)[number];

/** One call into a plugin: which function, with what, as whom, and how long it gets. */
export interface PluginCall {
  readonly kind: CallKind;
  /** The command, query, endpoint, hook kind, job or api name; the `to` of an upgrade as text; none for enable and disable. */
  readonly name?: string | undefined;
  /** The arguments: a command's or a query's args, an endpoint's request, a hook's event, an api call's input. */
  readonly payload: unknown;
  readonly info: PluginInfo;
  readonly caller: PluginCaller;
  readonly language: string;
  readonly timeoutMs: number;
}

export type CallResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: WireError };

/** A plugin as the host is told to load it. */
export interface HostPlugin {
  readonly key: string;
  /** The server module, an absolute path. */
  readonly server: string;
  readonly version: string;
  /** The memory the thread may hold, in megabytes. */
  readonly memoryMb: number;
}

export type ToHost =
  | { readonly t: "load"; readonly plugin: HostPlugin }
  | { readonly t: "unload"; readonly plugin: string }
  | { readonly t: "call"; readonly id: string; readonly plugin: string; readonly call: PluginCall }
  | {
      readonly t: "ctx-result";
      readonly id: string;
      readonly ok: boolean;
      readonly value?: unknown;
      readonly error?: WireError;
    };

export type LoadReply =
  | { readonly ok: true; readonly description: PluginDescription }
  | { readonly ok: false; readonly error: string; readonly problems: readonly string[] };

export type FromHost =
  | { readonly t: "ready" }
  | { readonly t: "loaded"; readonly plugin: string; readonly reply: LoadReply }
  | { readonly t: "result"; readonly id: string; readonly result: CallResult }
  | {
      readonly t: "ctx";
      readonly id: string;
      readonly plugin: string;
      /** The call the plugin was running when it asked, by which the parent knows the caller. */
      readonly callId: string;
      readonly member: string;
      readonly method: string;
      readonly args: readonly unknown[];
    }
  | {
      readonly t: "log";
      readonly plugin: string;
      readonly level: "info" | "warn" | "error";
      readonly message: string;
      readonly fields?: Readonly<Record<string, unknown>> | undefined;
    }
  | {
      readonly t: "thread";
      readonly plugin: string;
      readonly event: "ended";
      readonly reason: string;
    };

/** From the host to a plugin's thread. */
export type ToWorker =
  | { readonly t: "call"; readonly id: string; readonly call: PluginCall }
  | { readonly t: "abort"; readonly id: string }
  | {
      readonly t: "ctx-result";
      readonly id: string;
      readonly ok: boolean;
      readonly value?: unknown;
      readonly error?: WireError;
    };

/** From a plugin's thread to the host. */
export type FromWorker =
  | { readonly t: "loaded"; readonly reply: LoadReply }
  | { readonly t: "result"; readonly id: string; readonly result: CallResult }
  | {
      readonly t: "ctx";
      readonly id: string;
      readonly callId: string;
      readonly member: string;
      readonly method: string;
      readonly args: readonly unknown[];
    }
  | {
      readonly t: "log";
      readonly level: "info" | "warn" | "error";
      readonly message: string;
      readonly fields?: Readonly<Record<string, unknown>> | undefined;
    };

/** The bytes a value takes as JSON, or `undefined` for what JSON cannot carry. */
export function measure(value: unknown): number | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? 0 : Buffer.byteLength(text, "utf8");
  } catch {
    return undefined;
  }
}

/** The refusal for a value over the bound, or nothing. */
export function tooLarge(value: unknown, what: string): WireError | undefined {
  const bytes = measure(value);
  if (bytes === undefined) {
    return { code: "plugin.failed", message: `${what} cannot be carried as JSON` };
  }
  if (bytes > MESSAGE_BYTES_AT_MOST) {
    return { code: "plugin.too_many", message: `${what} is over ${MESSAGE_BYTES_AT_MOST} bytes` };
  }
  return undefined;
}

export const UNAVAILABLE: WireError = {
  code: "plugin.unavailable",
  message: "the plugin is not available right now",
};

export const TIMEOUT: WireError = {
  code: "plugin.timeout",
  message: "the plugin's code ran past its time",
};
