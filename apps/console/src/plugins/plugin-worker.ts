// The thread a plugin runs in (docs/specs/plugins.md, "The host"): hardened, then the server
// module imported and described, then calls run as the host sends them, every call on `ctx` a
// message to the host and on to the parent. Nothing of the console is reachable from here: no
// database, no configuration, an empty environment, and the network refused at the module
// system. Compiled to dist/plugins/plugin-worker.js and started by the host alone.
import * as moduleApi from "node:module";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import {
  type CollectionDefinition,
  describePlugin,
  type EndpointRequest,
  hardenThread,
  isPluginDefinition,
  isPluginError,
  isPluginRefusal,
  isQueryFile,
  type OtherPlugin,
  ownRefusalCode,
  type PluginContext,
  type PluginDefinition,
  PluginDefinitionError,
  type PluginFetchInit,
  type PluginFetchResponse,
  type PluginHookEvent,
  type PluginRecords,
  PluginRefusal,
  type PluginSqlClient,
  type RecordSchema,
} from "@skillcdn/console/plugin";
import type { FromWorker, PluginCall, ToWorker, WireError } from "./protocol.js";
import { tooLarge } from "./protocol.js";

const { key, server } = workerData as { key: string; server: string };
const port = ((): NonNullable<typeof parentPort> => {
  if (parentPort === null) {
    throw new Error("the plugin worker runs in a worker thread");
  }
  return parentPort;
})();

const post = (message: FromWorker) => port.postMessage(message);

/** The calls on `ctx` waiting for the parent's answer, by id. */
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
/** The calls running, by id, with what ends them. */
const running = new Map<string, AbortController>();
let counter = 0;

/** A call on `ctx`: a message to the host, answered by the parent, or refused as the parent said. */
function rpc(
  callId: string,
  member: string,
  method: string,
  args: readonly unknown[],
): Promise<unknown> {
  const over = tooLarge(args, `the arguments of ctx.${member}.${method}`);
  if (over !== undefined) {
    return Promise.reject(new PluginRefusal(over.code, over.message));
  }
  counter += 1;
  const id = `${callId}:${counter}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ t: "ctx", id, callId, member, method, args });
  });
}

function wireError(error: WireError | undefined): PluginRefusal {
  return new PluginRefusal(
    error?.code ?? "plugin.failed",
    error?.message ?? "the call failed",
    error?.data,
  );
}

function records<T extends Record<string, unknown>>(
  callId: string,
  name: string,
  definition: CollectionDefinition | undefined,
): PluginRecords<T> {
  const call = (method: string, ...args: unknown[]) =>
    rpc(callId, "records", method, [name, ...args]);
  const checked = async (data: unknown): Promise<unknown> => {
    if (definition === undefined) {
      return data;
    }
    const result = await (definition.schema as RecordSchema)["~standard"].validate(data);
    if (result.issues !== undefined) {
      const first = result.issues[0];
      const path = (first?.path ?? [])
        .map((segment) => (typeof segment === "object" ? String(segment.key) : String(segment)))
        .join(".");
      throw new PluginRefusal(
        "plugin.invalid_args",
        `${name}: ${path.length > 0 ? `${path}: ` : ""}${first?.message ?? "does not fit the schema"}`,
      );
    }
    return result.value;
  };
  return {
    create: async (data, options) =>
      (await call("create", await checked(data), options ?? {})) as never,
    get: (id) => call("get", id) as never,
    update: async (id, patch, options) => {
      // The patch is checked against the schema once the parent has merged it; the parent asks
      // this thread to validate the merged record before writing, as `validate` below answers.
      return (await call("update", id, patch, options ?? {})) as never;
    },
    archive: (id) => call("archive", id) as never,
    restore: (id) => call("restore", id) as never,
    list: (query) => call("list", query ?? {}) as never,
    search: (words, options) => call("search", words, options ?? {}) as never,
    aggregate: (aggregation) => call("aggregate", aggregation) as never,
    versions: (id) => call("versions", id) as never,
    link: (id, target) => call("link", id, target) as never,
    unlink: (id, target) => call("unlink", id, target) as never,
    links: (id) => call("links", id) as never,
    files: (id) => ({
      attach: (handle, options) => call("files.attach", id, handle, options ?? {}) as never,
      list: () => call("files.list", id) as never,
      remove: (fileId) => call("files.remove", id, fileId) as never,
    }),
  };
}

function response(raw: unknown): PluginFetchResponse {
  const { status, headers, bytes } = raw as {
    status: number;
    headers: Record<string, string>;
    bytes: Uint8Array;
  };
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const text = () => new TextDecoder().decode(body);
  return { status, headers, bytes: body, text, json: () => JSON.parse(text()) as unknown };
}

/** The context of one call: every member a message, with the call's id so the parent knows the caller. */
function contextOf(
  callId: string,
  definition: PluginDefinition,
  call: PluginCall,
  signal: AbortSignal,
): PluginContext {
  const collections = new Map(
    definition.collections.map((collection) => [collection.name, collection]),
  );
  const group =
    (member: string) =>
    (method: string) =>
    (...args: unknown[]) =>
      rpc(callId, member, method, args);
  const sql = (member: string): PluginSqlClient => ({
    query: (text, params) => group(member)("query")(text, params ?? []) as never,
  });
  return {
    plugin: call.info,
    caller: call.caller,
    records: ((collection: CollectionDefinition | string) =>
      typeof collection === "string"
        ? records(callId, collection, collections.get(collection))
        : records(callId, collection.name, collection)) as PluginContext["records"],
    sql: {
      ...sql("sql"),
      async transaction(work) {
        const tx = (await rpc(callId, "sql", "begin", [])) as string;
        try {
          const value = await work({
            query: (text, params) => rpc(callId, "sql", "query", [text, params ?? [], tx]) as never,
          });
          await rpc(callId, "sql", "commit", [tx]);
          return value;
        } catch (error) {
          await rpc(callId, "sql", "rollback", [tx]).catch(() => undefined);
          throw error;
        }
      },
    },
    console: {
      workspace: group("console.workspace")("get") as never,
      people: {
        list: group("console.people")("list") as never,
        get: group("console.people")("get") as never,
        granted: group("console.people")("granted") as never,
      },
      teams: {
        list: group("console.teams")("list") as never,
        get: group("console.teams")("get") as never,
      },
      projects: {
        list: group("console.projects")("list") as never,
        get: group("console.projects")("get") as never,
        members: group("console.projects")("members") as never,
      },
      tasks: {
        list: group("console.tasks")("list") as never,
        get: group("console.tasks")("get") as never,
        create: group("console.tasks")("create") as never,
        update: group("console.tasks")("update") as never,
        comment: group("console.tasks")("comment") as never,
      },
      decisions: {
        list: group("console.decisions")("list") as never,
        get: group("console.decisions")("get") as never,
        ask: group("console.decisions")("ask") as never,
        answer: group("console.decisions")("answer") as never,
      },
      documents: {
        list: group("console.documents")("list") as never,
        read: group("console.documents")("read") as never,
        write: group("console.documents")("write") as never,
      },
      runs: {
        list: group("console.runs")("list") as never,
        get: group("console.runs")("get") as never,
      },
    },
    events: { emit: group("events")("emit") as never },
    fetch: async (url: string, init?: PluginFetchInit) =>
      response(await rpc(callId, "fetch", "fetch", [url, init ?? {}])),
    secrets: {
      has: group("secrets")("has") as never,
      status: group("secrets")("status") as never,
      sign: group("secrets")("sign") as never,
      verify: group("secrets")("verify") as never,
    },
    endpoints: { url: group("endpoints")("url") as never },
    plugins: {
      async get(other: string) {
        const found = (await rpc(callId, "plugins", "get", [other])) as {
          version: string;
          api: string[];
        };
        // As the caller, or for a person (ADR-0072): the parent decides the roles either way.
        const asCaller = (forId: string | undefined): OtherPlugin => ({
          version: found.version,
          api: Object.fromEntries(
            found.api.map((name) => [
              name,
              (input: unknown) =>
                rpc(
                  callId,
                  "plugins",
                  "call",
                  forId === undefined ? [other, name, input] : [other, name, input, { for: forId }],
                ),
            ]),
          ),
          for: (personId: string) => asCaller(personId),
        });
        return asCaller(undefined);
      },
    },
    log: {
      info: (message, fields) => post({ t: "log", level: "info", message, fields }),
      warn: (message, fields) => post({ t: "log", level: "warn", message, fields }),
      error: (message, fields) => post({ t: "log", level: "error", message, fields }),
    },
    now: () => new Date(),
    language: call.language,
    signal,
  };
}

function errorOf(error: unknown): WireError {
  if (isPluginError(error)) {
    return { code: ownRefusalCode(key, error.code), message: error.message, data: error.data };
  }
  if (isPluginRefusal(error)) {
    return { code: error.code, message: error.message, data: error.data };
  }
  // The message is the plugin's own and may say anything; it goes to the log, never to the caller.
  post({
    t: "log",
    level: "error",
    message: "the plugin's code failed",
    fields: { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
  });
  return { code: "plugin.failed", message: "the plugin's code failed" };
}

/** Finds the function a call names and runs it, or says why it cannot. */
async function perform(
  definition: PluginDefinition,
  callId: string,
  call: PluginCall,
  signal: AbortSignal,
): Promise<unknown> {
  const ctx = contextOf(callId, definition, call, signal);
  const name = call.name ?? "";
  const missing = (what: string) =>
    new PluginRefusal("plugin.not_found", `the plugin defines no ${what} ${name}`);
  switch (call.kind) {
    case "command": {
      const command = definition.commands[name];
      if (command === undefined) {
        throw missing("command");
      }
      return command.run(ctx, call.payload as never);
    }
    case "query": {
      const query = definition.queries[name];
      if (query === undefined) {
        throw missing("query");
      }
      const value = await query.run(ctx, call.payload as never);
      return isQueryFile(value)
        ? { file: { name: value.file.name, type: value.file.type, bytes: value.file.bytes } }
        : value;
    }
    case "endpoint": {
      const endpoint = definition.endpoints[name];
      if (endpoint === undefined) {
        throw missing("endpoint");
      }
      return endpoint.run(ctx, call.payload as EndpointRequest);
    }
    case "hook": {
      const handler = definition.on[name];
      if (handler === undefined) {
        throw missing("hook");
      }
      await handler(ctx, call.payload as PluginHookEvent);
      return null;
    }
    case "job": {
      const job = definition.jobs[name];
      if (job === undefined) {
        throw missing("job");
      }
      await job.run(ctx);
      return null;
    }
    case "upgrade": {
      const upgrade = definition.upgrades.find((candidate) => String(candidate.to) === name);
      if (upgrade === undefined) {
        throw missing("upgrade to");
      }
      await upgrade.run(ctx);
      return null;
    }
    case "api": {
      const api = definition.api[name];
      if (api === undefined) {
        throw missing("api call");
      }
      const result = await (api.input as RecordSchema)["~standard"].validate(call.payload);
      if (result.issues !== undefined) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          `${name}: ${result.issues[0]?.message ?? "the input does not fit"}`,
        );
      }
      return api.run(ctx, result.value);
    }
    case "enable":
      await definition.onEnable?.(ctx);
      return null;
    case "disable":
      await definition.onDisable?.(ctx);
      return null;
    default:
      throw new PluginRefusal("plugin.invalid_args", `${String(call.kind)} is not a kind of call`);
  }
}

/** Validates a record's data against a collection's schema, for the parent before a write it merges. */
async function validate(definition: PluginDefinition, payload: unknown): Promise<unknown> {
  const { collection, data } = payload as { collection: string; data: unknown };
  const found = definition.collections.find((candidate) => candidate.name === collection);
  if (found === undefined) {
    throw new PluginRefusal("plugin.not_found", `the plugin defines no collection ${collection}`);
  }
  const result = await (found.schema as RecordSchema)["~standard"].validate(data);
  if (result.issues !== undefined) {
    const first = result.issues[0];
    throw new PluginRefusal(
      "plugin.invalid_args",
      `${collection}: ${first?.message ?? "does not fit the schema"}`,
    );
  }
  return result.value;
}

async function main(): Promise<void> {
  if (typeof moduleApi.registerHooks !== "function") {
    post({
      t: "loaded",
      reply: { ok: false, error: "the host needs Node.js 24 or newer", problems: [] },
    });
    return;
  }
  hardenThread(moduleApi);
  let definition: PluginDefinition;
  try {
    const loaded = (await import(pathToFileURL(server).href)) as { default?: unknown };
    if (!isPluginDefinition(loaded.default)) {
      post({
        t: "loaded",
        reply: {
          ok: false,
          error: "the default export is not what definePlugin({...}) yields",
          problems: [],
        },
      });
      return;
    }
    definition = loaded.default;
  } catch (error) {
    const reply =
      error instanceof PluginDefinitionError
        ? { ok: false as const, error: "the definition is invalid", problems: error.problems }
        : {
            ok: false as const,
            error:
              error instanceof Error
                ? `${(error as { code?: string }).code ?? error.name}: ${error.message}`
                : String(error),
            problems: [],
          };
    post({ t: "loaded", reply });
    return;
  }
  post({ t: "loaded", reply: { ok: true, description: describePlugin(definition) } });

  port.on("message", (message: ToWorker) => {
    switch (message.t) {
      case "call": {
        const controller = new AbortController();
        running.set(message.id, controller);
        const work =
          message.call.kind === "validate"
            ? validate(definition, message.call.payload)
            : perform(definition, message.id, message.call, controller.signal);
        work
          .then((value) => {
            const over = tooLarge(value, "the answer");
            post({
              t: "result",
              id: message.id,
              result: over === undefined ? { ok: true, value } : { ok: false, error: over },
            });
          })
          .catch((error: unknown) => {
            post({ t: "result", id: message.id, result: { ok: false, error: errorOf(error) } });
          })
          .finally(() => {
            running.delete(message.id);
          });
        return;
      }
      case "abort":
        running.get(message.id)?.abort();
        return;
      case "ctx-result": {
        const waiting = pending.get(message.id);
        if (waiting === undefined) {
          return;
        }
        pending.delete(message.id);
        if (message.ok) {
          waiting.resolve(message.value);
        } else {
          waiting.reject(wireError(message.error));
        }
        return;
      }
      default:
        return;
    }
  });
}

await main();
