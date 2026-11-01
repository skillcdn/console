// The thread a server module is loaded in to be described (docs/specs/plugins.md, "The host" and
// "Authoring"): hardened first, then the module imported and its default export described as
// JSON for the parent. `console-plugin check` runs this; the host loads plugins the same way and
// then keeps the thread. Nothing of the console is reachable from here: no database, no
// configuration, an empty environment.
import * as moduleApi from "node:module";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { describePlugin, isPluginDefinition } from "./define.js";
import { PluginDefinitionError } from "./definition-error.js";
import { hardenThread } from "./sandbox.js";

export interface LoadOutcome {
  readonly ok: boolean;
  readonly description?: unknown;
  readonly error?: string;
  readonly problems?: readonly string[];
}

function errorText(error: unknown): { error: string; problems?: readonly string[] } {
  if (error instanceof PluginDefinitionError) {
    return { error: "the definition is invalid", problems: error.problems };
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { error: typeof code === "string" ? `${code}: ${error.message}` : error.message };
  }
  return { error: String(error) };
}

const { file } = workerData as { file: string };

let outcome: LoadOutcome;
try {
  if (typeof moduleApi.registerHooks !== "function") {
    throw new Error(
      "the host needs Node.js 24 or newer, which has module hooks that run in a thread",
    );
  }
  hardenThread(moduleApi);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (!isPluginDefinition(loaded.default)) {
    outcome = { ok: false, error: "the default export is not what definePlugin({...}) yields" };
  } else {
    outcome = { ok: true, description: describePlugin(loaded.default) };
  }
} catch (error) {
  outcome = { ok: false, ...errorText(error) };
}
parentPort?.postMessage(outcome);
