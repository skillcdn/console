// What plugin code is handed (docs/specs/plugins.md, "The context"): every call on `ctx` is a
// message to the console, which decides it by the capabilities consented to and, for a person's
// call, by the person's roles and the console's own policy. These are the types; the host builds
// the object in the plugin's thread, and `@skillcdn/console/plugin/testing` builds one in memory.
import type { TaskFilter } from "../client.js";
import type {
  RestComment,
  RestDecision,
  RestDocument,
  RestDocumentSummary,
  RestMember,
  RestPerson,
  RestProject,
  RestRun,
  RestTask,
  RestTaskInput,
  RestTaskPatch,
} from "../schemas.js";
import type { Translations } from "../translations.js";
import type { WeekStart } from "../vocabulary.js";
import type { PluginFileHandle } from "./args.js";

/** A schema as the Standard Schema interface spells one: what every build of zod implements, so that a plugin's own copy validates its records. */
export interface RecordSchema<T = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => RecordSchemaResult<T> | Promise<RecordSchemaResult<T>>;
    readonly types?: { readonly input: unknown; readonly output: T } | undefined;
  };
}

export type RecordSchemaResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | {
      readonly issues: readonly {
        readonly message: string;
        readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
      }[];
    };

/** The data a record of a collection holds, from its schema. */
export type RecordData<S> = S extends RecordSchema<infer T> ? T : never;

/** A collection as `defineCollection` yields it: the name, the schema, and what the console indexes and who reads. */
export interface CollectionDefinition<S extends RecordSchema = RecordSchema> {
  readonly name: string;
  readonly schema: S;
  readonly indexes: readonly string[];
  readonly search: readonly string[];
  readonly owner: string | null;
  readonly project: "none" | "optional" | "required";
  readonly read: readonly string[];
  readonly readOwn: readonly string[];
  readonly history: boolean;
}

export interface PluginRecord<T = Record<string, unknown>> {
  readonly id: string;
  readonly collection: string;
  /** The id of the project the record is linked to, or none. */
  readonly project: string | null;
  /** The id of the person the record is about, where the collection has an `owner`. */
  readonly owner: string | null;
  readonly data: T;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The person who caused the write, or none for the console. */
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly archivedAt: string | null;
}

export interface RecordVersion<T = Record<string, unknown>> {
  readonly version: number;
  readonly data: T;
  readonly at: string;
  readonly by: string | null;
}

export type WhereScalar = string | number | boolean | null;

/** One condition on an indexed field: equal, one of, within bounds, or present at all. */
export type WhereValue =
  | WhereScalar
  | { readonly in: readonly WhereScalar[] }
  | {
      readonly gte?: WhereScalar;
      readonly gt?: WhereScalar;
      readonly lte?: WhereScalar;
      readonly lt?: WhereScalar;
    }
  | { readonly exists: boolean };

export type Where = Readonly<Record<string, WhereValue>>;

export interface RecordOrder {
  readonly field: string;
  readonly descending?: boolean;
}

export interface RecordQuery {
  readonly where?: Where;
  readonly order?: RecordOrder;
  /** Up to the list bound; the bound when left out. */
  readonly limit?: number;
  /** The cursor the last page answered with. */
  readonly after?: string;
  /** The key of a project the records are linked to. */
  readonly project?: string;
  /** Archived records too; left out, they are not listed. */
  readonly archived?: boolean;
}

export interface RecordPage<T> {
  readonly items: readonly PluginRecord<T>[];
  /** The cursor for the next page, or none when this was the last. */
  readonly after: string | null;
}

export interface RecordAggregation {
  readonly where?: Where;
  /** Up to two indexed fields. */
  readonly groupBy?: readonly string[];
  readonly count?: boolean;
  readonly sum?: readonly string[];
  readonly min?: readonly string[];
  readonly max?: readonly string[];
}

export interface RecordAggregate {
  readonly group: Readonly<Record<string, WhereScalar>>;
  readonly count?: number;
  readonly sum?: Readonly<Record<string, number>>;
  readonly min?: Readonly<Record<string, WhereScalar>>;
  readonly max?: Readonly<Record<string, WhereScalar>>;
}

/** What a record may be linked to: an item of the board, a project, or a record of any plugin. */
export type LinkTarget =
  | { readonly kind: "task" | "decision" | "document" | "run" | "project"; readonly id: string }
  | {
      readonly kind: "record";
      readonly plugin?: string;
      readonly collection: string;
      readonly id: string;
    };

export interface RecordFile {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface RecordFiles {
  /** A handle a command received or a page uploaded, kept on the record; `files` capability. */
  attach(
    handle: PluginFileHandle | string,
    options?: { readonly name?: string; readonly type?: string },
  ): Promise<RecordFile>;
  list(): Promise<readonly RecordFile[]>;
  remove(fileId: string): Promise<void>;
}

/** A plugin's records of one collection. */
export interface PluginRecords<T = Record<string, unknown>> {
  create(
    data: T,
    options?: { readonly project?: string; readonly owner?: string },
  ): Promise<PluginRecord<T>>;
  /** The record, or none when there is no such record in this collection. */
  get(id: string): Promise<PluginRecord<T> | null>;
  /** The fields given replace those of the record; `baseVersion` refuses with `plugin.conflict` when the record moved on. */
  update(
    id: string,
    patch: Partial<T>,
    options?: { readonly baseVersion?: number },
  ): Promise<PluginRecord<T>>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  list(query?: RecordQuery): Promise<RecordPage<T>>;
  search(
    words: string,
    options?: Pick<RecordQuery, "where" | "limit" | "project">,
  ): Promise<RecordPage<T>>;
  aggregate(aggregation: RecordAggregation): Promise<readonly RecordAggregate[]>;
  versions(id: string): Promise<readonly RecordVersion<T>[]>;
  link(id: string, target: LinkTarget): Promise<void>;
  unlink(id: string, target: LinkTarget): Promise<void>;
  links(id: string): Promise<readonly LinkTarget[]>;
  files(id: string): RecordFiles;
}

export interface PluginInfo {
  readonly key: string;
  readonly version: string;
  readonly dataVersion: number;
  /** The settings as the administrator set them, by key, without the secrets. */
  readonly settings: Readonly<Record<string, unknown>>;
  /**
   * The capabilities the plugin holds: those it requires, and the optional ones an administrator
   * turned on (ADR-0060), so that it offers what it can do. One it does not hold is refused.
   */
  readonly capabilities: readonly string[];
  /** The board project, or none. */
  readonly board: { readonly id: string; readonly key: string } | null;
  /** The projects the plugin is on: all, or their keys. */
  readonly projects: "all" | readonly string[];
}

export interface CallerPerson {
  readonly id: string;
  readonly login: string;
  readonly name: string | null;
  readonly language: string;
  readonly admin: boolean;
}

export interface CallerProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

/** Who a command, a query or a person's endpoint acts as, and with which roles in this plugin. */
export interface PersonCaller {
  readonly kind: "person";
  readonly person: CallerPerson;
  /** The agent's name where a token acts, or none for a person on the pages. */
  readonly agent: string | null;
  readonly roles: readonly string[];
  /** The caller's open run in the board project, if any. */
  readonly run: { readonly id: string; readonly taskNumber: number | null } | null;
  /** The project the call is on, if any. */
  readonly project: CallerProject | null;
}

/** The console itself: a job, a hook, an upgrade or a webhook, with every role. */
export interface ConsoleCaller {
  readonly kind: "console";
  readonly roles: readonly string[];
  readonly project: CallerProject | null;
}

export type PluginCaller = PersonCaller | ConsoleCaller;

export interface PluginWorkspace {
  readonly name: string;
  readonly languages: readonly string[];
  readonly timeZone: string;
  /** The day the week begins on (ADR-0035): `auto` leaves it to the language of whoever reads. */
  readonly weekStart: WeekStart;
  readonly categories: readonly {
    readonly key: string;
    readonly name: string;
    readonly color: string;
  }[];
}

/**
 * A text a plugin writes on the board (ADR-0058): one string, or one per language of the
 * workspace (`{ en, ko }`, at least one of the console's languages among them), which the console
 * keeps whole and shows to each reader in their own.
 */
export type BoardText = string | Translations;

export interface DecisionAsk {
  readonly question: BoardText;
  readonly body?: BoardText;
  /**
   * The options, each a label and optionally a key (spelled as a plugin's key is, each once),
   * which the answered event carries back as `optionKey`, so that the plugin reads the answer
   * without comparing labels.
   */
  readonly options: readonly { readonly label: BoardText; readonly key?: string }[];
  /** Who is to answer: a person who may work in the project; the administrator who enabled the plugin when left out. */
  readonly deciderId?: string;
  /** Several to answer (ADR-0057), in place of `deciderId`: any of them may, and the first answer ends it; up to MAX_DECIDERS. */
  readonly deciderIds?: readonly string[];
  readonly taskId?: string;
  /** The record the decision is for, by which the plugin maps the answer back. */
  readonly about: { readonly collection: string; readonly id: string };
}

/** A task as a plugin writes one: as the API takes it, the title and the body in one language or in several (ADR-0058). */
export type PluginTaskInput = Omit<RestTaskInput, "title" | "body"> & {
  readonly title: BoardText;
  readonly body?: BoardText;
};

/** The console's board, as a plugin reaches it with the `board:*` capabilities, each read the caller's own. */
export interface PluginConsole {
  workspace(): Promise<PluginWorkspace>;
  people: {
    list(options?: { readonly q?: string }): Promise<readonly RestPerson[]>;
    get(id: string): Promise<RestPerson | null>;
  };
  projects: {
    list(): Promise<readonly RestProject[]>;
    get(key: string): Promise<RestProject | null>;
    members(key: string): Promise<readonly RestMember[]>;
  };
  tasks: {
    list(project: string, filter?: TaskFilter): Promise<readonly RestTask[]>;
    get(project: string, number: number): Promise<RestTask | null>;
    create(project: string, task: PluginTaskInput): Promise<RestTask>;
    update(project: string, number: number, patch: RestTaskPatch): Promise<RestTask>;
    comment(project: string, number: number, body: BoardText): Promise<RestComment>;
  };
  decisions: {
    list(project: string): Promise<readonly RestDecision[]>;
    get(id: string): Promise<RestDecision | null>;
    ask(project: string, decision: DecisionAsk): Promise<RestDecision>;
  };
  documents: {
    list(project: string, folder?: string): Promise<readonly RestDocumentSummary[]>;
    read(project: string, path: string): Promise<RestDocument | null>;
    /** Under `plugins/<key>/`; anywhere else is `plugin.forbidden`. */
    write(
      project: string,
      path: string,
      document: { readonly title: string; readonly body: string; readonly baseVersion?: number },
    ): Promise<RestDocument>;
  };
  runs: {
    list(project: string): Promise<readonly RestRun[]>;
    get(id: string): Promise<RestRun | null>;
  };
}

export interface PluginSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface PluginSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<PluginSqlResult<Row>>;
}

/** SQL on the plugin's own schema and role, with `storage:sql`. */
export interface PluginSql extends PluginSqlClient {
  transaction<T>(work: (tx: PluginSqlClient) => Promise<T>): Promise<T>;
}

/** Where the console puts a secret into an outbound request. */
export type SecretPlacement = `header:${string}` | `query:${string}` | "basic";

export interface PluginFetchInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /** A secret setting, put where `as` says: a header, a query parameter, or as basic authentication (`user:password`). */
  readonly secret?: { readonly name: string; readonly as: SecretPlacement };
}

/** An outbound answer, whole: the host reads it to the bound before handing it over. */
export interface PluginFetchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  text(): string;
  json(): unknown;
}

export interface PluginSecrets {
  has(name: string): Promise<boolean>;
  sign(name: string, payload: string | Uint8Array, algorithm: "hmac-sha256"): Promise<string>;
  verify(
    name: string,
    payload: string | Uint8Array,
    signature: string,
    algorithm: "hmac-sha256",
  ): Promise<boolean>;
}

export interface OtherPlugin {
  readonly version: string;
  readonly api: Readonly<Record<string, (input: unknown) => Promise<unknown>>>;
}

export interface PluginLog {
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

/** Everything a plugin does to the console: one object, handed to every function the plugin defines. */
export interface PluginContext {
  readonly plugin: PluginInfo;
  readonly caller: PluginCaller;
  /** The records of a collection, typed by its definition, or by name. */
  records<S extends RecordSchema>(
    collection: CollectionDefinition<S>,
  ): PluginRecords<RecordData<S>>;
  records(collection: string): PluginRecords<Record<string, unknown>>;
  readonly sql: PluginSql;
  readonly console: PluginConsole;
  readonly events: { emit(kind: string, data: unknown): Promise<void> };
  fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
  readonly secrets: PluginSecrets;
  readonly plugins: { get(key: string): Promise<OtherPlugin> };
  readonly log: PluginLog;
  now(): Date;
  /** The caller's language, `en` for the console. */
  readonly language: string;
  /** Fires when the call's time is up; the thread is ended soon after. */
  readonly signal: AbortSignal;
}

/** An event a hook receives: the console's, of the plugin's board projects, or another plugin's. */
export interface PluginHookEvent {
  readonly source: "console" | "plugin";
  /** `console:<kind>` or `plugin:<key>:<kind>`, as the hook was named. */
  readonly kind: string;
  readonly at: string;
  /** The plugin that emitted or caused it, or none. */
  readonly plugin: string | null;
  readonly project: { readonly id: string; readonly key: string } | null;
  readonly data: unknown;
}

/** What an endpoint receives: the request, bounded, with the headers the definition named. */
export interface EndpointRequest {
  readonly method: string;
  /** What followed the endpoint's name. */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface EndpointResponse {
  readonly status: number;
  readonly headers?: Readonly<
    Partial<Record<"content-type" | "location" | "cache-control", string>>
  >;
  readonly body?: string | Readonly<Record<string, unknown>> | readonly unknown[];
}
