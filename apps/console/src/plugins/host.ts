// The parent's side of the plugin host (docs/specs/plugins.md, "The host"): spawns the child
// process under Node's permission model with the environment the configuration allows it,
// loads plugins into it, carries calls to it and their answers back, decides every call on `ctx`
// through the handler it is given, and starts the host again when it dies, failing what was in
// flight as unavailable. One per api or worker role.
import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { isPluginRefusal, PLUGIN_LOG_LINES_PER_MINUTE } from "@skillcdn/console/plugin";
import type { Logger } from "../logger.js";
import type {
  CallResult,
  FromHost,
  HostPlugin,
  LoadReply,
  PluginCall,
  ToHost,
  WireError,
} from "./protocol.js";
import { UNAVAILABLE } from "./protocol.js";

/** A call on `ctx`, as the handler decides it: which plugin, in which call, asks what. */
export interface ContextCall {
  readonly plugin: string;
  /** The call the plugin was running: its caller, its info, its language. */
  readonly call: PluginCall;
  readonly member: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Decides and performs a call on `ctx`; throws a `PluginRefusal` to refuse. */
export type ContextHandler = (call: ContextCall) => Promise<unknown>;

export interface PluginHostOptions {
  /** The compiled host, `dist/plugins/plugin-host.js`. */
  readonly entry: string;
  /** The directories the host may read: the plugins, and the console's own code. */
  readonly allowRead: readonly string[];
  /** The environment the host gets: nothing but what Node needs on this platform. */
  readonly env: Readonly<Record<string, string>>;
  readonly execPath?: string | undefined;
  readonly logger: Logger;
  readonly onContext: ContextHandler;
  /** A plugin's thread ended, or its module loaded again after the host came back. */
  readonly onThreadEnded?: ((plugin: string, reason: string) => void) | undefined;
  readonly onReloaded?: ((plugin: string, reply: LoadReply) => void) | undefined;
}

/** How long the host gets to say it is ready. */
const READY_MS = 15_000;
/** How long a load waits for the host's reply, over the host's own bound. */
const LOAD_REPLY_MS = 15_000;
const RESTART_MS_AT_LEAST = 1_000;
const RESTART_MS_AT_MOST = 30_000;

interface Pending<T> {
  readonly resolve: (value: T) => void;
  readonly timer: NodeJS.Timeout | undefined;
}

/** Lines a plugin may log a minute; what is over is dropped, said once a minute. */
class LogGate {
  private readonly minutes = new Map<string, { minute: number; lines: number; warned: boolean }>();

  /** Whether the line may be written; false when the plugin is over its bound this minute. */
  admit(plugin: string, now: number): "write" | "drop" | "warn" {
    const minute = Math.floor(now / 60_000);
    let state = this.minutes.get(plugin);
    if (state === undefined || state.minute !== minute) {
      state = { minute, lines: 0, warned: false };
      this.minutes.set(plugin, state);
    }
    state.lines += 1;
    if (state.lines <= PLUGIN_LOG_LINES_PER_MINUTE) {
      return "write";
    }
    if (!state.warned) {
      state.warned = true;
      return "warn";
    }
    return "drop";
  }
}

export class PluginHost {
  private readonly options: PluginHostOptions;
  private child: ChildProcess | undefined;
  private ready: Promise<void> | undefined;
  private stopping = false;
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | undefined;
  private counter = 0;
  private readonly calls = new Map<
    string,
    { plugin: string; call: PluginCall; pending: Pending<CallResult> }
  >();
  private readonly loads = new Map<string, Pending<LoadReply>>();
  /** The plugins the host holds, loaded again when the host comes back. */
  private readonly plugins = new Map<string, HostPlugin>();
  private readonly logGate = new LogGate();

  constructor(options: PluginHostOptions) {
    this.options = options;
  }

  /** Spawns the host and waits for it to be ready. */
  start(): Promise<void> {
    if (this.ready === undefined) {
      this.ready = this.spawn();
    }
    return this.ready;
  }

  private spawn(): Promise<void> {
    const { entry, allowRead, env, logger } = this.options;
    const args = [
      "--permission",
      ...allowRead.map((dir) => `--allow-fs-read=${dir}`),
      "--allow-worker",
      "--disable-warning=PERM0006",
      entry,
    ];
    const child = spawn(this.options.execPath ?? process.execPath, args, {
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "advanced",
      windowsHide: true,
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      logger.debug({ host: "stdout" }, chunk.toString("utf8").trimEnd());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logger.warn({ host: "stderr" }, chunk.toString("utf8").trimEnd());
    });
    child.on("message", (message: FromHost) => this.receive(message));
    child.on("error", (error) => {
      logger.error({ err: error }, "the plugin host could not be started");
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`the plugin host did not become ready within ${READY_MS} ms`));
        child.kill();
      }, READY_MS);
      const onMessage = (message: FromHost) => {
        if (message.t === "ready") {
          clearTimeout(timer);
          child.off("message", onMessage);
          resolve();
        }
      };
      child.on("message", onMessage);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("the plugin host ended before it was ready"));
      });
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }
      this.child = undefined;
      this.ready = undefined;
      this.failEverything();
      if (this.stopping) {
        return;
      }
      logger.error(
        { code, signal },
        "the plugin host ended; every plugin is unavailable until it is back",
      );
      const wait = Math.min(RESTART_MS_AT_MOST, RESTART_MS_AT_LEAST * 2 ** this.restarts);
      this.restarts += 1;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined;
        this.start()
          .then(() => {
            this.restarts = 0;
            for (const plugin of this.plugins.values()) {
              this.send({ t: "load", plugin });
            }
          })
          .catch((error: unknown) => {
            logger.error({ err: error }, "the plugin host could not be started again");
          });
      }, wait);
    });
    return ready;
  }

  private send(message: ToHost): boolean {
    const child = this.child;
    if (child === undefined || !child.connected) {
      return false;
    }
    child.send(message);
    return true;
  }

  private failEverything(): void {
    for (const [id, entry] of this.calls) {
      this.calls.delete(id);
      if (entry.pending.timer !== undefined) {
        clearTimeout(entry.pending.timer);
      }
      entry.pending.resolve({ ok: false, error: UNAVAILABLE });
    }
    for (const [key, pending] of this.loads) {
      this.loads.delete(key);
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.resolve({
        ok: false,
        error: "the plugin host ended while the module loaded",
        problems: [],
      });
    }
  }

  private receive(message: FromHost): void {
    const { logger } = this.options;
    switch (message.t) {
      case "ready":
        return;
      case "loaded": {
        const pending = this.loads.get(message.plugin);
        if (pending !== undefined) {
          this.loads.delete(message.plugin);
          if (pending.timer !== undefined) {
            clearTimeout(pending.timer);
          }
          pending.resolve(message.reply);
        } else {
          this.options.onReloaded?.(message.plugin, message.reply);
        }
        return;
      }
      case "result": {
        const entry = this.calls.get(message.id);
        if (entry === undefined) {
          return;
        }
        this.calls.delete(message.id);
        if (entry.pending.timer !== undefined) {
          clearTimeout(entry.pending.timer);
        }
        entry.pending.resolve(message.result);
        return;
      }
      case "ctx": {
        const entry = this.calls.get(message.callId);
        if (entry === undefined || entry.plugin !== message.plugin) {
          this.send({ t: "ctx-result", id: message.id, ok: false, error: UNAVAILABLE });
          return;
        }
        this.options
          .onContext({
            plugin: entry.plugin,
            call: entry.call,
            member: message.member,
            method: message.method,
            args: message.args,
          })
          .then((value) => {
            this.send({ t: "ctx-result", id: message.id, ok: true, value });
          })
          .catch((error: unknown) => {
            const wire: WireError = isPluginRefusal(error)
              ? { code: error.code, message: error.message, data: error.data }
              : { code: "plugin.failed", message: "the console could not perform the call" };
            if (!isPluginRefusal(error)) {
              logger.error(
                {
                  err: error,
                  plugin: entry.plugin,
                  member: message.member,
                  method: message.method,
                },
                "a call on ctx failed",
              );
            }
            this.send({ t: "ctx-result", id: message.id, ok: false, error: wire });
          });
        return;
      }
      case "log": {
        const verdict = this.logGate.admit(message.plugin, Date.now());
        if (verdict === "drop") {
          return;
        }
        if (verdict === "warn") {
          logger.warn(
            { plugin: message.plugin },
            `the plugin logs more than ${PLUGIN_LOG_LINES_PER_MINUTE} lines a minute; the rest of the minute is dropped`,
          );
          return;
        }
        const fields = { plugin: message.plugin, ...(message.fields ?? {}) };
        if (message.level === "error") {
          logger.error(fields, message.message);
        } else if (message.level === "warn") {
          logger.warn(fields, message.message);
        } else {
          logger.info(fields, message.message);
        }
        return;
      }
      case "thread":
        logger.warn({ plugin: message.plugin, reason: message.reason }, "a plugin's thread ended");
        this.options.onThreadEnded?.(message.plugin, message.reason);
        return;
      default:
        return;
    }
  }

  /** Loads a plugin's server module into the host and answers its description, or why not. */
  async load(plugin: HostPlugin): Promise<LoadReply> {
    await this.start();
    this.plugins.set(plugin.key, plugin);
    return new Promise<LoadReply>((resolve) => {
      const timer = setTimeout(() => {
        this.loads.delete(plugin.key);
        resolve({ ok: false, error: "the plugin host did not answer the load", problems: [] });
      }, LOAD_REPLY_MS);
      this.loads.set(plugin.key, { resolve, timer });
      if (!this.send({ t: "load", plugin })) {
        clearTimeout(timer);
        this.loads.delete(plugin.key);
        resolve({ ok: false, error: "the plugin host is not there", problems: [] });
      }
    });
  }

  /** Takes a plugin out of the host; its thread ends. */
  unload(key: string): void {
    this.plugins.delete(key);
    this.send({ t: "unload", plugin: key });
  }

  /** Runs one call in the plugin's thread and answers its result, or the refusal. */
  call(plugin: string, call: PluginCall): Promise<CallResult> {
    if (this.child === undefined || !this.child.connected) {
      return Promise.resolve({ ok: false, error: UNAVAILABLE });
    }
    this.counter += 1;
    const id = `c${this.counter}`;
    return new Promise<CallResult>((resolve) => {
      // The host ends the call at its bound; this is the fence behind it.
      const timer = setTimeout(() => {
        this.calls.delete(id);
        resolve({
          ok: false,
          error: { code: "plugin.timeout", message: "the plugin's code ran past its time" },
        });
      }, call.timeoutMs + 5_000);
      this.calls.set(id, { plugin, call, pending: { resolve, timer } });
      if (!this.send({ t: "call", id, plugin, call })) {
        clearTimeout(timer);
        this.calls.delete(id);
        resolve({ ok: false, error: UNAVAILABLE });
      }
    });
  }

  /** Ends the host and everything in it. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
    }
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    this.failEverything();
    if (child === undefined) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.connected) {
        child.disconnect();
      } else {
        child.kill();
      }
    });
  }
}
