// Loads a plugin's server module in a hardened worker thread and answers its description, or why
// it did not load. What `console-plugin check` does to a package; the host does the same before
// keeping the thread. Node only.
import { Worker } from "node:worker_threads";
import type { PluginDescription } from "./define.js";
import { DEFAULT_PLUGIN_MEMORY_MB } from "./limits.js";

export type ServerLoad =
  | { readonly ok: true; readonly description: PluginDescription }
  | { readonly ok: false; readonly error: string; readonly problems: readonly string[] };

export interface LoadOptions {
  /** How long the module gets to load; ten seconds unless said. */
  readonly timeoutMs?: number;
  /** The memory the thread may hold, in megabytes. */
  readonly memoryMb?: number;
}

const DEFAULT_LOAD_MS = 10_000;

/** The description of the server module at `file`, loaded in a thread of its own under the host's hardening. */
export function loadServerModule(file: string, options: LoadOptions = {}): Promise<ServerLoad> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOAD_MS;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (load: ServerLoad) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(load);
      }
    };
    const worker = new Worker(new URL("./load-worker.js", import.meta.url), {
      workerData: { file },
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: options.memoryMb ?? DEFAULT_PLUGIN_MEMORY_MB },
      stdout: true,
      stderr: true,
    });
    // What the module prints while loading goes nowhere: the check speaks for itself.
    worker.stdout.resume();
    worker.stderr.resume();
    const timer = setTimeout(() => {
      settle({
        ok: false,
        error: `the server module did not load within ${timeoutMs} ms`,
        problems: [],
      });
      void worker.terminate();
    }, timeoutMs);
    worker.on(
      "message",
      (outcome: {
        ok: boolean;
        description?: PluginDescription;
        error?: string;
        problems?: readonly string[];
      }) => {
        if (outcome.ok && outcome.description !== undefined) {
          settle({ ok: true, description: outcome.description });
        } else {
          settle({
            ok: false,
            error: outcome.error ?? "the server module did not load",
            problems: outcome.problems ?? [],
          });
        }
        void worker.terminate();
      },
    );
    worker.on("error", (error) => {
      settle({ ok: false, error: error.message, problems: [] });
    });
    worker.on("exit", (code) => {
      settle({
        ok: false,
        error: `the server module's thread ended with ${code} before describing it`,
        problems: [],
      });
    });
  });
}
