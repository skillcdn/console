// The plugin host (docs/specs/plugins.md, "The host"): the child process the api and worker
// roles spawn under Node's permission model with an empty environment, which runs each plugin
// in a worker thread of its own and carries messages between the threads and the parent. It
// holds no database, no configuration and no secret; it decides nothing: a call on `ctx` goes to
// the parent, which decides and answers. Compiled to dist/plugins/plugin-host.js; started by
// `host.ts` alone, over an IPC channel.
import process from "node:process";
import { Worker } from "node:worker_threads";
import type {
  CallResult,
  FromHost,
  FromWorker,
  HostPlugin,
  PluginCall,
  ToHost,
  ToWorker,
} from "./protocol.js";
import { TIMEOUT, tooLarge, UNAVAILABLE } from "./protocol.js";

/** How long a server module gets to load and describe itself. */
const LOAD_MS = 10_000;
/** After a call's time is up and its signal fired, how long the thread gets before it is ended. */
const ABORT_GRACE_MS = 500;

const send = (message: FromHost) => {
  process.send?.(message);
};

interface Running {
  readonly plugin: string;
  readonly timer: NodeJS.Timeout;
  grace?: NodeJS.Timeout;
}

/** One plugin's thread, with what runs in it. */
class PluginThread {
  readonly plugin: HostPlugin;
  private worker: Worker | undefined;
  private loading: Promise<boolean> | undefined;
  /** The calls running in this thread, by id. */
  private readonly calls = new Set<string>();

  constructor(plugin: HostPlugin) {
    this.plugin = plugin;
  }

  /** Starts the thread and waits for the module to describe itself; answers whether it loaded. */
  load(report: boolean): Promise<boolean> {
    if (this.loading !== undefined) {
      return this.loading;
    }
    this.loading = new Promise<boolean>((resolve) => {
      const worker = new Worker(new URL("./plugin-worker.js", import.meta.url), {
        workerData: { key: this.plugin.key, server: this.plugin.server },
        env: {},
        resourceLimits: { maxOldGenerationSizeMb: this.plugin.memoryMb },
        stdout: true,
        stderr: true,
      });
      // What the plugin prints goes nowhere: it has ctx.log.
      worker.stdout.resume();
      worker.stderr.resume();
      this.worker = worker;
      let settled = false;
      const settle = (ok: boolean) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(ok);
        }
      };
      const timer = setTimeout(() => {
        if (report) {
          send({
            t: "loaded",
            plugin: this.plugin.key,
            reply: {
              ok: false,
              error: `the server module did not load within ${LOAD_MS} ms`,
              problems: [],
            },
          });
        }
        this.end("the server module did not load in time");
        settle(false);
      }, LOAD_MS);
      worker.on("message", (message: FromWorker) => {
        switch (message.t) {
          case "loaded":
            if (report) {
              send({ t: "loaded", plugin: this.plugin.key, reply: message.reply });
            }
            if (!message.reply.ok) {
              this.end("the server module did not load");
            }
            settle(message.reply.ok);
            return;
          case "result":
            finish(message.id, message.result);
            return;
          case "ctx":
            send({
              t: "ctx",
              id: message.id,
              plugin: this.plugin.key,
              callId: message.callId,
              member: message.member,
              method: message.method,
              args: message.args,
            });
            return;
          case "log":
            send({
              t: "log",
              plugin: this.plugin.key,
              level: message.level,
              message: message.message,
              fields: message.fields,
            });
            return;
          default:
            return;
        }
      });
      worker.on("error", (error) => {
        const code = (error as { code?: string }).code;
        const reason =
          code === "ERR_WORKER_OUT_OF_MEMORY"
            ? "the thread grew past its memory"
            : `the thread crashed: ${error.message}`;
        if (!settled && report) {
          send({
            t: "loaded",
            plugin: this.plugin.key,
            reply: { ok: false, error: reason, problems: [] },
          });
        }
        this.ended(reason);
        settle(false);
      });
      worker.on("exit", (code) => {
        if (this.worker === worker) {
          this.ended(`the thread ended with ${code}`);
        }
        settle(false);
      });
    });
    return this.loading;
  }

  /** Whether the thread is there to take a call. */
  get alive(): boolean {
    return this.worker !== undefined;
  }

  post(message: ToWorker): void {
    this.worker?.postMessage(message);
  }

  track(id: string): void {
    this.calls.add(id);
  }

  untrack(id: string): void {
    this.calls.delete(id);
  }

  /** Ends the thread: what ran in it fails as unavailable, and the next call starts it afresh. */
  end(reason: string): void {
    const worker = this.worker;
    this.worker = undefined;
    this.loading = undefined;
    void worker?.terminate();
    this.ended(reason);
  }

  private ended(reason: string): void {
    this.worker = undefined;
    this.loading = undefined;
    const failed = [...this.calls];
    this.calls.clear();
    for (const id of failed) {
      finish(id, { ok: false, error: UNAVAILABLE });
    }
    send({ t: "thread", plugin: this.plugin.key, event: "ended", reason });
  }
}

const threads = new Map<string, PluginThread>();
const running = new Map<string, Running>();

function finish(id: string, result: CallResult): void {
  const found = running.get(id);
  if (found === undefined) {
    return;
  }
  running.delete(id);
  clearTimeout(found.timer);
  if (found.grace !== undefined) {
    clearTimeout(found.grace);
  }
  threads.get(found.plugin)?.untrack(id);
  const over = result.ok ? tooLarge(result.value, "the answer") : undefined;
  send({ t: "result", id, result: over === undefined ? result : { ok: false, error: over } });
}

async function call(id: string, key: string, call: PluginCall): Promise<void> {
  const thread = threads.get(key);
  if (thread === undefined) {
    send({ t: "result", id, result: { ok: false, error: UNAVAILABLE } });
    return;
  }
  if (!thread.alive && !(await thread.load(false))) {
    send({ t: "result", id, result: { ok: false, error: UNAVAILABLE } });
    return;
  }
  const entry: Running = {
    plugin: key,
    timer: setTimeout(() => {
      // The signal fires first; a plugin that does not stop is ended with its thread.
      thread.post({ t: "abort", id });
      entry.grace = setTimeout(() => {
        if (running.has(id)) {
          finish(id, { ok: false, error: TIMEOUT });
          thread.end("a call ran past its time");
        }
      }, ABORT_GRACE_MS);
    }, call.timeoutMs),
  };
  running.set(id, entry);
  thread.track(id);
  thread.post({ t: "call", id, call });
}

process.on("message", (message: ToHost) => {
  switch (message.t) {
    case "load": {
      threads.get(message.plugin.key)?.end("the plugin is loaded again");
      const thread = new PluginThread(message.plugin);
      threads.set(message.plugin.key, thread);
      void thread.load(true);
      return;
    }
    case "unload":
      threads.get(message.plugin)?.end("the plugin is unloaded");
      threads.delete(message.plugin);
      return;
    case "call":
      void call(message.id, message.plugin, message.call);
      return;
    case "ctx-result": {
      // The id of a call on ctx begins with the id of the call it was made in.
      const callId = message.id.slice(0, message.id.lastIndexOf(":"));
      const found = running.get(callId);
      if (found === undefined) {
        return;
      }
      threads.get(found.plugin)?.post({
        t: "ctx-result",
        id: message.id,
        ok: message.ok,
        value: message.value,
        error: message.error,
      });
      return;
    }
    default:
      return;
  }
});

process.on("disconnect", () => {
  // The parent is gone: nothing here is worth keeping.
  for (const thread of threads.values()) {
    thread.end("the parent is gone");
  }
  process.exit(0);
});

send({ t: "ready" });
