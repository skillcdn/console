// A context for a plugin's own tests (docs/specs/plugins.md, "Authoring"): records kept in memory
// with the collection's schema checked as the host checks it, the console refusing what the test
// did not provide, as a console without the capability would, and everything the plugin emitted or
// logged kept for assertions. No network, no database, nothing of a real console.
import type {
  CollectionDefinition,
  LinkTarget,
  OtherPlugin,
  PluginCaller,
  PluginConsole,
  PluginContext,
  PluginFetchInit,
  PluginFetchResponse,
  PluginInfo,
  PluginRecord,
  PluginRecords,
  PluginSql,
  RecordAggregate,
  RecordAggregation,
  RecordFile,
  RecordFiles,
  RecordPage,
  RecordQuery,
  RecordSchema,
  RecordVersion,
  Where,
  WhereScalar,
  WhereValue,
} from "./context.js";
import {
  MAX_PLUGIN_RECORD_BYTES,
  MAX_PLUGIN_RECORD_VERSIONS,
  MAX_PLUGIN_RECORDS,
  PLUGIN_LIST_LIMIT,
} from "./limits.js";
import { PluginRefusal } from "./refusals.js";

export interface TestConsoleOptions {
  readonly workspace?: PluginConsole["workspace"];
  readonly people?: Partial<PluginConsole["people"]>;
  readonly projects?: Partial<PluginConsole["projects"]>;
  readonly tasks?: Partial<PluginConsole["tasks"]>;
  readonly decisions?: Partial<PluginConsole["decisions"]>;
  readonly documents?: Partial<PluginConsole["documents"]>;
  readonly runs?: Partial<PluginConsole["runs"]>;
}

export interface TestContextOptions {
  readonly plugin?: Partial<PluginInfo>;
  readonly caller?: PluginCaller;
  /** The collections, so that writes are checked against their schemas and `where` against their indexes. */
  readonly collections?: readonly CollectionDefinition[];
  /** What the console answers; what is left out is refused as `plugin.forbidden`. */
  readonly console?: TestConsoleOptions;
  readonly sql?: PluginSql;
  readonly fetch?: (url: string, init?: PluginFetchInit) => Promise<PluginFetchResponse>;
  /** The secrets by name; `sign` and `verify` use them, and never hand them over. */
  readonly secrets?: Readonly<Record<string, string>>;
  readonly plugins?: Readonly<Record<string, OtherPlugin>>;
  readonly now?: () => Date;
  readonly language?: string;
}

export interface LoggedLine {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

export interface TestContext extends PluginContext {
  /** What the plugin emitted with `ctx.events.emit`, in order. */
  readonly emitted: readonly { readonly kind: string; readonly data: unknown }[];
  readonly logged: readonly LoggedLine[];
  /** Every record of a collection, archived ones included, for assertions. */
  all(collection: string): readonly PluginRecord[];
  /** The same store, as another caller. */
  as(caller: PluginCaller): TestContext;
}

interface Kept {
  record: PluginRecord;
  versions: RecordVersion[];
  links: LinkTarget[];
  files: RecordFile[];
}

interface Store {
  readonly collections: Map<string, Map<string, Kept>>;
  readonly emitted: { kind: string; data: unknown }[];
  readonly logged: LoggedLine[];
  counter: number;
}

const DEFAULT_CALLER: PluginCaller = {
  kind: "person",
  person: { id: "person-1", login: "tester", name: "Tester", language: "en", admin: false },
  agent: null,
  roles: [],
  run: null,
  project: null,
};

function forbidden(what: string, give: string): never {
  throw new PluginRefusal(
    "plugin.forbidden",
    `${what}: the test context was given no ${give} to answer it`,
  );
}

function scalarOf(value: unknown): WhereScalar | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
    ? value
    : undefined;
}

function compare(a: WhereScalar | undefined, b: WhereScalar | undefined): number {
  if (a === b) {
    return 0;
  }
  if (a === undefined || a === null) {
    return -1;
  }
  if (b === undefined || b === null) {
    return 1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a) < String(b) ? -1 : 1;
}

function fieldOf(record: PluginRecord, field: string): WhereScalar | undefined {
  if (field === "owner" || field === "project" || field === "id") {
    return record[field];
  }
  return scalarOf(record.data[field]);
}

function matches(record: PluginRecord, where: Where): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = fieldOf(record, field);
    return conditionHolds(value, condition);
  });
}

function conditionHolds(value: WhereScalar | undefined, condition: WhereValue): boolean {
  if (condition === null || typeof condition !== "object") {
    return value === condition;
  }
  if ("in" in condition && Array.isArray(condition.in)) {
    return condition.in.includes(value as WhereScalar);
  }
  if ("exists" in condition && typeof condition.exists === "boolean") {
    return (value !== undefined && value !== null) === condition.exists;
  }
  const bounds = condition as {
    gte?: WhereScalar;
    gt?: WhereScalar;
    lte?: WhereScalar;
    lt?: WhereScalar;
  };
  if (value === undefined || value === null) {
    return false;
  }
  if (bounds.gte !== undefined && compare(value, bounds.gte) < 0) {
    return false;
  }
  if (bounds.gt !== undefined && compare(value, bounds.gt) <= 0) {
    return false;
  }
  if (bounds.lte !== undefined && compare(value, bounds.lte) > 0) {
    return false;
  }
  if (bounds.lt !== undefined && compare(value, bounds.lt) >= 0) {
    return false;
  }
  return true;
}

async function validated<T>(
  collection: CollectionDefinition | undefined,
  name: string,
  data: unknown,
): Promise<T> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new PluginRefusal("plugin.invalid_args", `${name}: a record's data is an object`);
  }
  if (JSON.stringify(data).length > MAX_PLUGIN_RECORD_BYTES) {
    throw new PluginRefusal(
      "plugin.invalid_args",
      `${name}: a record is ${MAX_PLUGIN_RECORD_BYTES} bytes at most`,
    );
  }
  if (collection === undefined) {
    return data as T;
  }
  const result = await (collection.schema as RecordSchema<T>)["~standard"].validate(data);
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
}

function memoryRecords<T extends Record<string, unknown>>(
  store: Store,
  name: string,
  collection: CollectionDefinition | undefined,
  caller: PluginCaller,
  now: () => Date,
): PluginRecords<T> {
  const kept = (): Map<string, Kept> => {
    let found = store.collections.get(name);
    if (found === undefined) {
      found = new Map();
      store.collections.set(name, found);
    }
    return found;
  };
  const by = caller.kind === "person" ? caller.person.id : null;
  const indexed = (field: string) => {
    if (
      collection !== undefined &&
      !collection.indexes.includes(field) &&
      !["owner", "project", "id"].includes(field)
    ) {
      throw new PluginRefusal(
        "plugin.invalid_args",
        `${name}: ${field} is not an indexed field of the collection`,
      );
    }
  };
  const one = (id: string): Kept => {
    const found = kept().get(id);
    if (found === undefined) {
      throw new PluginRefusal("plugin.not_found", `${name}: no record ${id}`);
    }
    return found;
  };
  const page = (records: PluginRecord<T>[], query: RecordQuery): RecordPage<T> => {
    const limit = Math.min(Math.max(query.limit ?? PLUGIN_LIST_LIMIT, 1), PLUGIN_LIST_LIMIT);
    const field = query.order?.field;
    if (field !== undefined) {
      indexed(field);
    }
    const sorted = [...records].sort((a, b) => {
      const order = field === undefined ? 0 : compare(fieldOf(a, field), fieldOf(b, field));
      const signed = query.order?.descending === true ? -order : order;
      return signed !== 0 ? signed : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const start =
      query.after === undefined ? 0 : sorted.findIndex((record) => record.id === query.after) + 1;
    const items = sorted.slice(start, start + limit);
    const last = items.at(-1);
    return { items, after: start + limit < sorted.length && last !== undefined ? last.id : null };
  };
  const visible = (query: RecordQuery): PluginRecord<T>[] =>
    [...kept().values()]
      .map((entry) => entry.record as PluginRecord<T>)
      .filter((record) => (query.archived === true ? true : record.archivedAt === null))
      .filter((record) => (query.project === undefined ? true : record.project === query.project))
      .filter((record) => {
        for (const field of Object.keys(query.where ?? {})) {
          indexed(field);
        }
        return query.where === undefined ? true : matches(record, query.where);
      });
  const files = (id: string): RecordFiles => ({
    attach: async (handle, options) => {
      const entry = one(id);
      const given =
        typeof handle === "string"
          ? { handle, name: "file", type: "application/octet-stream", bytes: 0 }
          : handle;
      const file: RecordFile = {
        id: `${entry.record.id}-file-${entry.files.length + 1}`,
        name: options?.name ?? given.name,
        type: options?.type ?? given.type,
        bytes: given.bytes,
        sha256: "",
        createdAt: now().toISOString(),
      };
      entry.files.push(file);
      return file;
    },
    list: async () => [...one(id).files],
    remove: async (fileId) => {
      const entry = one(id);
      entry.files = entry.files.filter((file) => file.id !== fileId);
    },
  });
  return {
    async create(data, options) {
      const records = kept();
      if (records.size >= MAX_PLUGIN_RECORDS) {
        throw new PluginRefusal(
          "plugin.too_many",
          `${name}: ${MAX_PLUGIN_RECORDS} records at most`,
        );
      }
      if (collection?.project === "required" && options?.project === undefined) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          `${name}: a record of this collection is linked to a project`,
        );
      }
      const checked = await validated<T>(collection, name, data);
      store.counter += 1;
      const at = now().toISOString();
      const owner =
        options?.owner ??
        (collection?.owner !== null && collection?.owner !== undefined
          ? scalarOf(checked[collection.owner])
          : null);
      const record: PluginRecord<T> = {
        id: `${name}-${String(store.counter).padStart(6, "0")}`,
        collection: name,
        project: options?.project ?? null,
        owner: typeof owner === "string" ? owner : null,
        data: checked,
        version: 1,
        createdAt: at,
        updatedAt: at,
        createdBy: by,
        updatedBy: by,
        archivedAt: null,
      };
      records.set(record.id, { record, versions: [], links: [], files: [] });
      return record;
    },
    async get(id) {
      return (kept().get(id)?.record as PluginRecord<T> | undefined) ?? null;
    },
    async update(id, patch, options) {
      const entry = one(id);
      if (options?.baseVersion !== undefined && options.baseVersion !== entry.record.version) {
        throw new PluginRefusal(
          "plugin.conflict",
          `${name}: the record ${id} is at version ${entry.record.version}, not ${options.baseVersion}`,
        );
      }
      const checked = await validated<T>(collection, name, { ...entry.record.data, ...patch });
      if (collection?.history !== false) {
        entry.versions.push({
          version: entry.record.version,
          data: entry.record.data,
          at: entry.record.updatedAt,
          by: entry.record.updatedBy,
        });
        if (entry.versions.length > MAX_PLUGIN_RECORD_VERSIONS) {
          entry.versions.shift();
        }
      }
      entry.record = {
        ...entry.record,
        data: checked,
        version: entry.record.version + 1,
        updatedAt: now().toISOString(),
        updatedBy: by,
      };
      return entry.record as PluginRecord<T>;
    },
    async archive(id) {
      const entry = one(id);
      entry.record = { ...entry.record, archivedAt: now().toISOString() };
    },
    async restore(id) {
      const entry = one(id);
      entry.record = { ...entry.record, archivedAt: null };
    },
    async list(query = {}) {
      return page(visible(query), query);
    },
    async search(words, options = {}) {
      const needles = words
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 0);
      const fields = collection?.search ?? [];
      const found = visible({ where: options.where, project: options.project }).filter((record) => {
        const text = (fields.length > 0 ? fields : Object.keys(record.data))
          .map((field) => String(record.data[field] ?? ""))
          .join(" ")
          .toLowerCase();
        return needles.every((needle) => text.includes(needle));
      });
      return page(found, { limit: options.limit });
    },
    async aggregate(aggregation) {
      const groupBy = aggregation.groupBy ?? [];
      if (groupBy.length > 2) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          `${name}: aggregate groups by two fields at most`,
        );
      }
      for (const field of groupBy) {
        indexed(field);
      }
      const groups = new Map<
        string,
        RecordAggregate & {
          count: number;
          sum: Record<string, number>;
          min: Record<string, WhereScalar>;
          max: Record<string, WhereScalar>;
        }
      >();
      for (const record of visible({ where: aggregation.where })) {
        const group = Object.fromEntries(
          groupBy.map((field) => [field, fieldOf(record, field) ?? null]),
        );
        const key = JSON.stringify(group);
        let row = groups.get(key);
        if (row === undefined) {
          row = { group, count: 0, sum: {}, min: {}, max: {} };
          groups.set(key, row);
        }
        row.count += 1;
        for (const field of aggregation.sum ?? []) {
          const value = fieldOf(record, field);
          row.sum[field] = (row.sum[field] ?? 0) + (typeof value === "number" ? value : 0);
        }
        for (const field of aggregation.min ?? []) {
          const value = fieldOf(record, field);
          if (
            value !== undefined &&
            value !== null &&
            (row.min[field] === undefined || compare(value, row.min[field]) < 0)
          ) {
            row.min[field] = value;
          }
        }
        for (const field of aggregation.max ?? []) {
          const value = fieldOf(record, field);
          if (
            value !== undefined &&
            value !== null &&
            (row.max[field] === undefined || compare(value, row.max[field]) > 0)
          ) {
            row.max[field] = value;
          }
        }
      }
      return [...groups.values()].map((row) => shape(row, aggregation));
    },
    async versions(id) {
      return [...one(id).versions] as RecordVersion<T>[];
    },
    async link(id, target) {
      const entry = one(id);
      if (!entry.links.some((link) => JSON.stringify(link) === JSON.stringify(target))) {
        entry.links.push(target);
      }
    },
    async unlink(id, target) {
      const entry = one(id);
      entry.links = entry.links.filter((link) => JSON.stringify(link) !== JSON.stringify(target));
    },
    async links(id) {
      return [...one(id).links];
    },
    files,
  };
}

function shape(
  row: RecordAggregate & {
    count: number;
    sum: Record<string, number>;
    min: Record<string, WhereScalar>;
    max: Record<string, WhereScalar>;
  },
  aggregation: RecordAggregation,
): RecordAggregate {
  return {
    group: row.group,
    ...(aggregation.count === true ? { count: row.count } : {}),
    ...((aggregation.sum ?? []).length > 0 ? { sum: row.sum } : {}),
    ...((aggregation.min ?? []).length > 0 ? { min: row.min } : {}),
    ...((aggregation.max ?? []).length > 0 ? { max: row.max } : {}),
  };
}

async function hmacSha256(secret: string, payload: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = typeof payload === "string" ? encoder.encode(payload) : payload;
  const signature = await crypto.subtle.sign("HMAC", key, bytes as BufferSource);
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function refusingConsole(given: TestConsoleOptions | undefined): PluginConsole {
  const refuse = (group: string, call: string) => async () =>
    forbidden(`console.${group}.${call}`, `console.${group}.${call}`);
  const fill = <G extends Record<string, (...args: never[]) => unknown>>(
    group: string,
    names: readonly (keyof G & string)[],
    own: Partial<G> | undefined,
  ): G =>
    Object.fromEntries(
      names.map((name) => [name, own?.[name] ?? refuse(group, name)]),
    ) as unknown as G;
  return {
    workspace:
      given?.workspace ?? (async () => forbidden("console.workspace", "console.workspace")),
    people: fill("people", ["list", "get"], given?.people),
    projects: fill("projects", ["list", "get", "members"], given?.projects),
    tasks: fill("tasks", ["list", "get", "create", "update", "comment"], given?.tasks),
    decisions: fill("decisions", ["list", "get", "ask"], given?.decisions),
    documents: fill("documents", ["list", "read", "write"], given?.documents),
    runs: fill("runs", ["list", "get"], given?.runs),
  };
}

function build(store: Store, options: TestContextOptions, caller: PluginCaller): TestContext {
  const now = options.now ?? (() => new Date());
  const collections = new Map(
    (options.collections ?? []).map((collection) => [collection.name, collection]),
  );
  const plugin: PluginInfo = {
    key: "test",
    version: "0.0.0",
    dataVersion: 1,
    settings: {},
    capabilities: [],
    board: null,
    projects: "all",
    ...options.plugin,
  };
  const secrets = options.secrets ?? {};
  const records = ((collection: CollectionDefinition | string) => {
    const name = typeof collection === "string" ? collection : collection.name;
    const definition = typeof collection === "string" ? collections.get(collection) : collection;
    return memoryRecords(store, name, definition, caller, now);
  }) as PluginContext["records"];
  const log =
    (level: LoggedLine["level"]) =>
    (message: string, fields?: Readonly<Record<string, unknown>>) => {
      store.logged.push({ level, message, fields });
    };
  return {
    plugin,
    caller,
    records,
    sql: options.sql ?? {
      query: async () => forbidden("sql.query", "sql"),
      transaction: async () => forbidden("sql.transaction", "sql"),
    },
    console: refusingConsole(options.console),
    events: {
      async emit(kind, data) {
        store.emitted.push({ kind, data });
      },
    },
    fetch: options.fetch ?? (async () => forbidden("fetch", "fetch")),
    secrets: {
      has: async (name) => name in secrets,
      sign: async (name, payload) => {
        const secret = secrets[name];
        if (secret === undefined) {
          throw new PluginRefusal("plugin.forbidden", `the secret ${name} is not set`);
        }
        return hmacSha256(secret, payload);
      },
      verify: async (name, payload, signature) => {
        const secret = secrets[name];
        return (
          secret !== undefined && (await hmacSha256(secret, payload)) === signature.toLowerCase()
        );
      },
    },
    plugins: {
      async get(key) {
        const other = options.plugins?.[key];
        if (other === undefined) {
          forbidden(`plugins.get(${key})`, `plugins.${key}`);
        }
        return other;
      },
    },
    log: { info: log("info"), warn: log("warn"), error: log("error") },
    now,
    language: options.language ?? (caller.kind === "person" ? caller.person.language : "en"),
    signal: new AbortController().signal,
    emitted: store.emitted,
    logged: store.logged,
    all: (collection) =>
      [...(store.collections.get(collection)?.values() ?? [])].map((entry) => entry.record),
    as: (other) => build(store, options, other),
  };
}

/** A context for a plugin's tests: records in memory, the console refusing what is not given. */
export function createTestContext(options: TestContextOptions = {}): TestContext {
  const store: Store = { collections: new Map(), emitted: [], logged: [], counter: 0 };
  return build(store, options, options.caller ?? DEFAULT_CALLER);
}
