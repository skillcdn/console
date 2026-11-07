// The hardening of a thread that runs plugin code (docs/specs/plugins.md, "The host"): the
// built-ins the host refuses, the globals it removes, and a scan of a bundle's text for the same,
// so that `console-plugin check` says before the host does. Defence in depth: the permission model
// of the host process is the first line; this is the second.

/** The built-in modules a plugin's thread may not load, with or without the `node:` prefix. */
export const FORBIDDEN_BUILTINS: readonly string[] = [
  "net",
  "http",
  "https",
  "http2",
  "tls",
  "dgram",
  "dns",
  "dns/promises",
  // The same network, under the names Node keeps for compatibility.
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "_tls_common",
  "_tls_wrap",
  "child_process",
  "cluster",
  "worker_threads",
  "vm",
  "inspector",
  "inspector/promises",
  "repl",
  "wasi",
  "v8",
];

/** The globals a plugin's thread does without: the network, and the way under the module system. */
export const REMOVED_GLOBALS: readonly string[] = ["fetch", "WebSocket", "EventSource"];

/** True when a module specifier names a built-in the host refuses. */
export function isForbiddenBuiltin(specifier: string): boolean {
  return FORBIDDEN_BUILTINS.includes(
    specifier.startsWith("node:") ? specifier.slice(5) : specifier,
  );
}

const IMPORT_OR_REQUIRE =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bprocess\.getBuiltinModule\s*\(\s*)["'`](node:)?([a-z_/]+)["'`]/g;

/** The built-ins a bundle's text imports or requires that the host refuses, each once, as written. */
export function forbiddenImportsIn(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(IMPORT_OR_REQUIRE)) {
    const specifier = `${match[1] ?? ""}${match[2] ?? ""}`;
    if (isForbiddenBuiltin(specifier)) {
      found.add(specifier);
    }
  }
  return [...found];
}

const GLOBAL_USES = /\b(fetch|WebSocket|EventSource|process\.binding|process\.dlopen)\s*\(/g;

/** The removed globals a bundle's text calls, each once; a plugin that calls them fails at runtime. */
export function removedGlobalsIn(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(GLOBAL_USES)) {
    if (match[1] !== undefined) {
      found.add(match[1]);
    }
  }
  return [...found];
}

/** What the thread looks like after hardening, for a test to assert on. */
export interface HardenedThread {
  readonly removed: readonly string[];
}

/** What a plugin is told of a built-in it may not have, by whichever way it asked. */
function refusedBuiltin(specifier: string): Error {
  const error = new Error(
    `the host refuses ${specifier}: a plugin reaches the console through ctx alone`,
  );
  (error as { code?: string }).code = "ERR_PLUGIN_FORBIDDEN_BUILTIN";
  return error;
}

/** The module hook: refuses the forbidden built-ins and lets everything else resolve as it would. */
export function forbiddingResolve<C, R>(
  specifier: string,
  context: C,
  nextResolve: (specifier: string, context: C) => R,
): R {
  if (isForbiddenBuiltin(specifier)) {
    throw refusedBuiltin(specifier);
  }
  return nextResolve(specifier, context);
}

/**
 * Hardens the current thread: refuses the forbidden built-ins through the module hooks and through
 * `process.getBuiltinModule`, which goes round them, removes the globals, empties the environment,
 * and blocks `process.binding`. Call it in a worker thread before importing plugin code; it reaches
 * nothing outside that thread.
 */
export function hardenThread(
  moduleApi: Pick<typeof import("node:module"), "registerHooks">,
): HardenedThread {
  moduleApi.registerHooks({ resolve: forbiddingResolve });
  const removed: string[] = [];
  const global = globalThis as Record<string, unknown>;
  for (const name of REMOVED_GLOBALS) {
    if (name in global) {
      Object.defineProperty(global, name, {
        value: undefined,
        writable: false,
        configurable: false,
      });
      removed.push(name);
    }
  }
  const proc = global.process as Record<string, unknown> | undefined;
  if (proc !== undefined) {
    const refuse = () => {
      throw new Error("the host refuses process.binding");
    };
    for (const name of ["binding", "_linkedBinding", "dlopen"]) {
      Object.defineProperty(proc, name, { value: refuse, writable: false, configurable: false });
    }
    const getBuiltinModule = proc.getBuiltinModule;
    if (typeof getBuiltinModule === "function") {
      Object.defineProperty(proc, "getBuiltinModule", {
        value: (specifier: string): unknown => {
          if (isForbiddenBuiltin(specifier)) {
            throw refusedBuiltin(specifier);
          }
          return getBuiltinModule.call(proc, specifier);
        },
        writable: false,
        configurable: false,
      });
    }
    const env = proc.env as Record<string, unknown> | undefined;
    if (env !== undefined) {
      for (const key of Object.keys(env)) {
        delete env[key];
      }
    }
  }
  return { removed };
}
