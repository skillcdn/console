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

/**
 * How long a collection keeps a record: `days` after the moment `by` names, `createdAt` or
 * `updatedAt` of the record, or an indexed field of its data that holds a day or an instant as
 * ISO 8601 text; then the console removes the record, with its versions, links and files.
 */
export interface CollectionRetention {
  readonly days: number;
  readonly by: string;
}

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
  /** How long a record is kept, or `null` for as long as the plugin is. */
  readonly retention: CollectionRetention | null;
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
  /** The roles other plugins granted to this one (ADR-0072), by their key, so that a plugin says what it lacks. */
  readonly grants: readonly PluginGrantHeld[];
}

/** A role of another plugin, held by this one. */
export interface PluginGrantHeld {
  readonly plugin: string;
  readonly role: string;
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

/**
 * Another plugin, calling with the roles granted to it (ADR-0072): from its own job, hook or
 * webhook, as itself; or for a person who did something elsewhere, with `for`, and then with the
 * roles the plugin and the person both hold, in the person's language. A plugin that knows only
 * `person` and `console` refuses the kind, which fails safe.
 */
export interface PluginAsCaller {
  readonly kind: "plugin";
  /** The calling plugin's key. */
  readonly plugin: string;
  readonly roles: readonly string[];
  /** The person the plugin acts for, or `null` when it acts as itself; never an administrator by that. */
  readonly for: CallerPerson | null;
  /** The project the call is on, if any: the one the person's own call was on. */
  readonly project: CallerProject | null;
}

export type PluginCaller = PersonCaller | ConsoleCaller | PluginAsCaller;

export interface PluginWorkspace {
  readonly name: string;
  readonly languages: readonly string[];
  /** The zone the workspace's times of day are read in; `UTC` where none is set, as `timeZoneSet` says. */
  readonly timeZone: string;
  /**
   * Whether an administrator set the time zone: `false` where the workspace runs on UTC because
   * nobody said otherwise, so that a plugin that reads a time of day says so, instead of taking
   * UTC for a choice.
   */
  readonly timeZoneSet: boolean;
  /** The day the week begins on (ADR-0035): `auto` leaves it to the language of whoever reads. */
  readonly weekStart: WeekStart;
  /**
   * The console's public origin (`PUBLIC_URL`), for a link to the console in what a plugin
   * writes elsewhere; `null` where the deployment names none.
   */
  readonly url: string | null;
  readonly categories: readonly {
    readonly key: string;
    readonly name: string;
    readonly color: string;
  }[];
}

/** An answer given for a person (ADR-0072): the option by its key or by its label, one of the two, and a note. */
export interface DecisionAnswer {
  readonly optionKey?: string;
  readonly option?: string;
  readonly note?: string;
}

export interface DecisionAsk {
  /** In the language of whoever is to answer, as `people.get` says it (ADR-0065). */
  readonly question: string;
  readonly body?: string;
  /**
   * The options, each a label and optionally a key (spelled as a plugin's key is, each once),
   * which the answered event carries back as `optionKey`, so that the plugin reads the answer
   * without comparing labels.
   */
  readonly options: readonly { readonly label: string; readonly key?: string }[];
  /** Who is to answer: a person who may work in the project; the administrator who enabled the plugin when left out. */
  readonly deciderId?: string;
  /** Several to answer (ADR-0057), in place of `deciderId`: any of them may, and the first answer ends it; up to MAX_DECIDERS. */
  readonly deciderIds?: readonly string[];
  readonly taskId?: string;
  /** The record the decision is for, by which the plugin maps the answer back. */
  readonly about: { readonly collection: string; readonly id: string };
}

/** The console's board, as a plugin reaches it with the `board:*` capabilities, each read the caller's own. */
export interface PluginConsole {
  workspace(): Promise<PluginWorkspace>;
  people: {
    list(options?: { readonly q?: string }): Promise<readonly RestPerson[]>;
    get(id: string): Promise<RestPerson | null>;
    /**
     * The active people a role of the plugin was granted to, by name, through a project or with
     * everyone, and everyone for `defaultRole` (ADR-0063). An administrator holds every role, and
     * is listed only where they were granted it.
     */
    granted(role: string): Promise<readonly RestPerson[]>;
  };
  projects: {
    list(): Promise<readonly RestProject[]>;
    get(key: string): Promise<RestProject | null>;
    members(key: string): Promise<readonly RestMember[]>;
  };
  tasks: {
    list(project: string, filter?: TaskFilter): Promise<readonly RestTask[]>;
    get(project: string, number: number): Promise<RestTask | null>;
    create(project: string, task: RestTaskInput): Promise<RestTask>;
    update(project: string, number: number, patch: RestTaskPatch): Promise<RestTask>;
    comment(project: string, number: number, body: string): Promise<RestComment>;
  };
  decisions: {
    list(project: string): Promise<readonly RestDecision[]>;
    get(id: string): Promise<RestDecision | null>;
    ask(project: string, decision: DecisionAsk): Promise<RestDecision>;
    /**
     * Answers a decision for a person who answered elsewhere (ADR-0072), with `people:act`: the
     * person's own standing decides whether they may, as on the board, and the answer is theirs,
     * through this plugin. A plugin answers no decision itself.
     */
    answer(id: string, answer: DecisionAnswer, as: { readonly for: string }): Promise<RestDecision>;
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

/**
 * Where the console puts a secret into an outbound request: a header, as `Authorization: Bearer`,
 * a query parameter, as basic authentication (`user:password`), or a field of a JSON or a form
 * body.
 */
export type SecretPlacement =
  | `header:${string}`
  | "bearer"
  | `query:${string}`
  | "basic"
  | `body:${string}`;

/** One secret setting and where it goes. */
export interface SecretUse {
  readonly name: string;
  readonly as: SecretPlacement;
}

/**
 * A value of the answer to seal as a secret setting (ADR-0070): the path to it in the answer's
 * JSON (`$.access_token`, `$.credentials.signing_secret`, `$.items.0.token`), and, where it
 * expires, how long it lasts, in seconds or as a path to the seconds (`$.expires_in`). The
 * console seals the value and hands the plugin the answer with `"[sealed]"` in its place.
 */
export type SecretSeal =
  | string
  | { readonly path: string; readonly expiresIn?: number | string | undefined };

export interface PluginFetchInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /** A secret setting, put where `as` says. */
  readonly secret?: SecretUse;
  /** Several, where a request carries more than one: a client secret in the body and a token as a bearer, say. */
  readonly secrets?: readonly SecretUse[];
  /** Values of the answer to seal as secret settings, by the setting's name, never handed to the plugin. */
  readonly seal?: Readonly<Record<string, SecretSeal>>;
}

/** An outbound answer, whole: the host reads it to the bound before handing it over. */
export interface PluginFetchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  text(): string;
  json(): unknown;
}

/** How a secret stands: whether it is set and not expired, when it expires, and where it came from. */
export interface SecretStatus {
  /** Set, and not past its expiry. */
  readonly set: boolean;
  readonly setAt: string | null;
  /** When it expires, or `null` for a secret that does not. */
  readonly expiresAt: string | null;
  /** `administrator` for one an administrator set; the host of the answer it was sealed from otherwise; `null` while unset. */
  readonly source: string | null;
}

export interface PluginSecrets {
  /** Whether the secret is set and not past its expiry. */
  has(name: string): Promise<boolean>;
  /** How the secret stands, for a settings page to say and a job to decide whether to renew it. */
  status(name: string): Promise<SecretStatus>;
  /** Signs with the secret; refused for a secret declared `use: "verify"`, which signs nothing. */
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
  /**
   * The same plugin, called for a person who did something elsewhere (ADR-0072): with the roles
   * this plugin and the person both hold in it, in the person's language, recorded as theirs
   * through this plugin. Needs `people:act`; the person is active, or the call is `plugin.not_found`.
   */
  for(personId: string): OtherPlugin;
}

/** The plugin's own endpoints, as a service elsewhere is told to call them. */
export interface PluginEndpoints {
  /**
   * The full address of an endpoint the plugin defines, under the console's public origin, to
   * register a callback or a webhook with a service elsewhere; `plugin.not_found` for a name the
   * plugin does not define, `plugin.unavailable` where the console has no public address.
   */
  url(name: string): Promise<string>;
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
  readonly endpoints: PluginEndpoints;
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
  /**
   * The event's id, one per event across both streams (`console:<number>` or `plugin:<number>`):
   * delivery is at least once, so a hook that must not act twice keeps the ids it acted on and
   * passes over one it has seen.
   */
  readonly id: string;
  /** Which delivery of the event this is: 1 the first time, more after a failure and its retries. */
  readonly attempt: number;
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
