// The server module of a plugin (docs/specs/plugins.md, "The server module"): `definePlugin` and
// the definers of its parts. Every definer yields a plain object the host can describe to the
// console beside the functions it runs: the console parses command lines, writes help and draws
// forms from the description, never from the code. What is not a definition the console can hold
// is refused here, when the module loads, with every problem named.
import type { ArgDefinitions, ArgDescription, ArgsOf } from "./args.js";
import type {
  CollectionDefinition,
  EndpointRequest,
  EndpointResponse,
  PluginContext,
  PluginHookEvent,
  RecordSchema,
} from "./context.js";
import { PluginDefinitionError } from "./definition-error.js";
import {
  MAX_PLUGIN_ABOUT_LENGTH,
  MAX_PLUGIN_COLLECTIONS,
  MAX_PLUGIN_ENDPOINTS,
  MAX_PLUGIN_INDEXES,
  MAX_PLUGIN_OPERATIONS,
  MIN_PLUGIN_JOB_INTERVAL_MS,
} from "./limits.js";
import {
  CURRENT_PLUGIN_API,
  PLUGIN_KEY_PATTERN,
  RESERVED_ARG_NAMES,
  RESERVED_COMMAND_NAMES,
} from "./manifest.js";

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HOOK_KIND =
  /^(?:console:[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*|plugin:[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{1,31})$/;
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DURATION = /^P(?!$)(?:(\d+)W)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const HEADER_NAME = /^[a-z0-9-]{1,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The milliseconds an ISO 8601 duration such as `P1D`, `PT30M` or `P1W` stands for; nothing for what is not one. */
export function durationMs(iso: string): number | undefined {
  const match = DURATION.exec(iso);
  if (match === null) {
    return undefined;
  }
  const [, weeks, days, hours, minutes, seconds] = match;
  return (
    Number(weeks ?? 0) * 7 * DAY_MS +
    Number(days ?? 0) * DAY_MS +
    Number(hours ?? 0) * 60 * 60 * 1000 +
    Number(minutes ?? 0) * 60 * 1000 +
    Number(seconds ?? 0) * 1000
  );
}

function isKey(value: unknown): value is string {
  return typeof value === "string" && PLUGIN_KEY_PATTERN.test(value);
}

function aboutProblem(what: string, about: unknown): string | undefined {
  if (
    typeof about !== "string" ||
    about.length === 0 ||
    about.length > MAX_PLUGIN_ABOUT_LENGTH ||
    /[\r\n]/.test(about)
  ) {
    return `${what} needs about, one line of 1 to ${MAX_PLUGIN_ABOUT_LENGTH} characters`;
  }
  return undefined;
}

function rolesProblem(what: string, roles: unknown): string | undefined {
  if (roles === undefined) {
    return undefined;
  }
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every(isKey)) {
    return `${what} names roles that are not keys, or none at all; leave roles out for every member`;
  }
  return undefined;
}

function fail(problems: readonly (string | undefined)[]): void {
  const found = problems.filter((problem): problem is string => problem !== undefined);
  if (found.length > 0) {
    throw new PluginDefinitionError(found);
  }
}

export interface CollectionInput<S extends RecordSchema> {
  /** A zod schema of the record's data, or any schema that follows Standard Schema. Checked on every write. */
  readonly schema: S;
  /** The fields `where` and `order` may name, and `aggregate` groups by; up to eight. */
  readonly indexes?: readonly string[];
  /** The fields searched as words. */
  readonly search?: readonly string[];
  /** The field that holds a person's id, by which `readOwn` roles read their own records. */
  readonly owner?: string;
  /** Whether a record is linked to a project: never, where the caller says, or always. */
  readonly project?: "none" | "optional" | "required";
  /** The roles that read the collection through the console's routes and the bridge. */
  readonly read?: readonly string[];
  /** The roles that read their own records in it. */
  readonly readOwn?: readonly string[];
  /** A version kept per write; on unless said otherwise. */
  readonly history?: boolean;
}

/** A collection of records the console keeps for the plugin, by name. */
export function defineCollection<S extends RecordSchema>(
  name: string,
  input: CollectionInput<S>,
): CollectionDefinition<S> {
  const problems: (string | undefined)[] = [];
  if (!isKey(name)) {
    problems.push(`the collection "${String(name)}" is not named as a key`);
  }
  if (
    typeof input?.schema !== "object" ||
    input.schema === null ||
    !("~standard" in input.schema)
  ) {
    problems.push(`the collection ${name} has no schema, or one that is not a zod schema`);
  }
  const indexes = input.indexes ?? [];
  if (indexes.length > MAX_PLUGIN_INDEXES) {
    problems.push(
      `the collection ${name} indexes ${indexes.length} fields; ${MAX_PLUGIN_INDEXES} at most`,
    );
  }
  for (const field of [
    ...indexes,
    ...(input.search ?? []),
    ...(input.owner === undefined ? [] : [input.owner]),
  ]) {
    if (!FIELD.test(field)) {
      problems.push(`the collection ${name} names the field "${field}", which is not a field name`);
    }
  }
  if (new Set(indexes).size !== indexes.length) {
    problems.push(`the collection ${name} indexes a field twice`);
  }
  if (input.owner !== undefined && !indexes.includes(input.owner)) {
    problems.push(
      `the collection ${name} has the owner field ${input.owner}, which must be indexed`,
    );
  }
  if (input.project !== undefined && !["none", "optional", "required"].includes(input.project)) {
    problems.push(
      `the collection ${name} has project "${String(input.project)}"; none, optional or required`,
    );
  }
  problems.push(rolesProblem(`the collection ${name}'s read`, input.read));
  problems.push(rolesProblem(`the collection ${name}'s readOwn`, input.readOwn));
  if (input.readOwn !== undefined && input.owner === undefined) {
    problems.push(`the collection ${name} has readOwn roles and no owner field`);
  }
  fail(problems);
  return Object.freeze({
    name,
    schema: input.schema,
    indexes: Object.freeze([...indexes]),
    search: Object.freeze([...(input.search ?? [])]),
    owner: input.owner ?? null,
    project: input.project ?? "none",
    read: Object.freeze([...(input.read ?? [])]),
    readOwn: Object.freeze([...(input.readOwn ?? [])]),
    history: input.history ?? true,
  });
}

/** What a command answers: what it prints, what `--json` prints, and the decision the caller waits for, if any. */
export interface CommandResult {
  readonly text: string;
  readonly data?: unknown;
  readonly waiting?: string;
}

export interface CommandInput<A extends ArgDefinitions> {
  readonly about: string;
  readonly args?: A;
  /** The roles that may run it, any of them; left out, every member may. */
  readonly roles?: readonly string[];
  run(ctx: PluginContext, args: ArgsOf<A>): Promise<CommandResult>;
}

export interface CommandDefinition<A extends ArgDefinitions = ArgDefinitions> {
  readonly kind: "command";
  readonly about: string;
  readonly args: A;
  readonly roles: readonly string[] | null;
  run(ctx: PluginContext, args: ArgsOf<A>): Promise<CommandResult>;
}

/** A file a query answers with, in place of JSON. */
export interface QueryFile {
  readonly file: { readonly name: string; readonly type: string; readonly bytes: Uint8Array };
}

export function isQueryFile(value: unknown): value is QueryFile {
  if (typeof value !== "object" || value === null || !("file" in value)) {
    return false;
  }
  const file = (value as { file: unknown }).file;
  return (
    typeof file === "object" &&
    file !== null &&
    typeof (file as { name?: unknown }).name === "string" &&
    typeof (file as { type?: unknown }).type === "string" &&
    (file as { bytes?: unknown }).bytes instanceof Uint8Array
  );
}

export interface QueryInput<A extends ArgDefinitions> {
  readonly about: string;
  readonly args?: A;
  readonly roles?: readonly string[];
  /** JSON, or a `QueryFile` for an export. */
  run(ctx: PluginContext, args: ArgsOf<A>): Promise<unknown>;
}

export interface QueryDefinition<A extends ArgDefinitions = ArgDefinitions> {
  readonly kind: "query";
  readonly about: string;
  readonly args: A;
  readonly roles: readonly string[] | null;
  run(ctx: PluginContext, args: ArgsOf<A>): Promise<unknown>;
}

function argsProblems(what: string, args: unknown): string[] {
  if (args === undefined) {
    return [];
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return [`${what} has args that are not named definers`];
  }
  const problems: string[] = [];
  let positionalOptional = false;
  for (const [name, definition] of Object.entries(args as Record<string, ArgDescription>)) {
    if (!isKey(name)) {
      problems.push(`${what} has the argument "${name}", which is not named as a key`);
    } else if (RESERVED_ARG_NAMES.includes(name)) {
      problems.push(
        `${what} has the argument "${name}", a flag the command keeps for itself (${RESERVED_ARG_NAMES.join(", ")})`,
      );
    }
    if (
      typeof definition !== "object" ||
      definition === null ||
      typeof definition.type !== "string"
    ) {
      problems.push(`${what}'s argument ${name} is not from arg.*`);
      continue;
    }
    if (definition.positional) {
      if (positionalOptional && !definition.optional) {
        problems.push(
          `${what}'s argument ${name} is positional and required after an optional one`,
        );
      }
      positionalOptional = positionalOptional || definition.optional;
    }
  }
  return problems;
}

function operation<A extends ArgDefinitions>(
  kind: "command" | "query",
  input: CommandInput<A> | QueryInput<A>,
): { about: string; args: A; roles: readonly string[] | null } {
  const what = `a ${kind}`;
  fail([
    aboutProblem(what, input?.about),
    ...argsProblems(what, input?.args),
    rolesProblem(what, input?.roles),
    typeof input?.run === "function" ? undefined : `${what} needs run, an async function`,
  ]);
  return {
    about: input.about,
    args: Object.freeze({ ...(input.args ?? ({} as A)) }),
    roles: input.roles === undefined ? null : Object.freeze([...input.roles]),
  };
}

/** Plugin code that writes, run as the person who asked. */
export function defineCommand<A extends ArgDefinitions = Record<never, never>>(
  input: CommandInput<A>,
): CommandDefinition<A> {
  const common = operation("command", input);
  return Object.freeze({ kind: "command", ...common, run: input.run });
}

/** Plugin code that reads, run as the person who asked. */
export function defineQuery<A extends ArgDefinitions = Record<never, never>>(
  input: QueryInput<A>,
): QueryDefinition<A> {
  const common = operation("query", input);
  return Object.freeze({ kind: "query", ...common, run: input.run });
}

export type EndpointAuth = "person" | "webhook";

export interface EndpointInput {
  /** `person`: a session or a token, with `roles`; `webhook`: nobody, the plugin verifies the signature with `secret`. */
  readonly auth: EndpointAuth;
  readonly roles?: readonly string[];
  /** The `secret` setting a webhook's signature is verified with, through `ctx.secrets.verify`. */
  readonly secret?: string;
  /** The methods accepted; `POST` alone when left out. */
  readonly methods?: readonly string[];
  /** The request headers handed to `run` beside `content-type`, in lowercase. */
  readonly headers?: readonly string[];
  run(ctx: PluginContext, request: EndpointRequest): Promise<EndpointResponse>;
}

export interface EndpointDefinition {
  readonly kind: "endpoint";
  readonly auth: EndpointAuth;
  readonly roles: readonly string[] | null;
  readonly secret: string | null;
  readonly methods: readonly string[];
  readonly headers: readonly string[];
  run(ctx: PluginContext, request: EndpointRequest): Promise<EndpointResponse>;
}

/** An inbound request the plugin accepts under `/api/v1/plugins/<key>/x/<name>`, with the `endpoints` capability. */
export function defineEndpoint(input: EndpointInput): EndpointDefinition {
  const problems: (string | undefined)[] = [];
  if (input?.auth !== "person" && input?.auth !== "webhook") {
    problems.push("an endpoint's auth is person or webhook");
  }
  problems.push(rolesProblem("an endpoint", input?.roles));
  if (input?.auth === "webhook" && input.roles !== undefined) {
    problems.push("a webhook endpoint names no roles: nobody is signed in");
  }
  if (input?.secret !== undefined && (!isKey(input.secret) || input.auth !== "webhook")) {
    problems.push("an endpoint's secret names a secret setting, for a webhook alone");
  }
  const methods = input?.methods ?? ["POST"];
  if (
    methods.length === 0 ||
    !methods.every((method) => (HTTP_METHODS as readonly string[]).includes(method))
  ) {
    problems.push(`an endpoint's methods are among ${HTTP_METHODS.join(", ")}`);
  }
  const headers = input?.headers ?? [];
  if (headers.length > 10 || !headers.every((header) => HEADER_NAME.test(header))) {
    problems.push("an endpoint names up to ten request headers, in lowercase");
  }
  if (typeof input?.run !== "function") {
    problems.push("an endpoint needs run, an async function");
  }
  fail(problems);
  return Object.freeze({
    kind: "endpoint",
    auth: input.auth,
    roles: input.roles === undefined ? null : Object.freeze([...input.roles]),
    secret: input.secret ?? null,
    methods: Object.freeze([...methods]),
    headers: Object.freeze([...headers]),
    run: input.run,
  });
}

export type HookHandler = (ctx: PluginContext, event: PluginHookEvent) => Promise<void>;

export interface JobDefinition {
  readonly about: string;
  /** An ISO 8601 duration, five minutes or more. */
  readonly every: string;
  /** A time of day, `HH:MM` in the workspace's time zone, for a daily or longer `every`. */
  readonly at?: string;
  run(ctx: PluginContext): Promise<void>;
}

export interface UpgradeDefinition {
  /** The `dataVersion` this upgrade brings the records to. */
  readonly to: number;
  readonly about: string;
  run(ctx: PluginContext): Promise<void>;
}

export interface ApiDefinition<S extends RecordSchema = RecordSchema> {
  readonly about: string;
  /** The schema of what a caller sends. */
  readonly input: S;
  run(ctx: PluginContext, input: unknown): Promise<unknown>;
}

export type Lifecycle = (ctx: PluginContext) => Promise<void>;

export interface PluginParts {
  readonly collections?: readonly CollectionDefinition[];
  readonly commands?: Readonly<Record<string, CommandDefinition>>;
  readonly queries?: Readonly<Record<string, QueryDefinition>>;
  readonly endpoints?: Readonly<Record<string, EndpointDefinition>>;
  /** Hooks: `"console:<kind>"` with `events:console`, `"plugin:<key>:<kind>"` with `events:plugins`. */
  readonly on?: Readonly<Record<string, HookHandler>>;
  readonly jobs?: Readonly<Record<string, JobDefinition>>;
  readonly upgrades?: readonly UpgradeDefinition[];
  /** What other plugins may call with `plugins:<key>`. */
  readonly api?: Readonly<Record<string, ApiDefinition>>;
  readonly onEnable?: Lifecycle;
  readonly onDisable?: Lifecycle;
}

/** The default export of a plugin's server module. */
export interface PluginDefinition {
  readonly pluginApi: number;
  readonly collections: readonly CollectionDefinition[];
  readonly commands: Readonly<Record<string, CommandDefinition>>;
  readonly queries: Readonly<Record<string, QueryDefinition>>;
  readonly endpoints: Readonly<Record<string, EndpointDefinition>>;
  readonly on: Readonly<Record<string, HookHandler>>;
  readonly jobs: Readonly<Record<string, JobDefinition>>;
  readonly upgrades: readonly UpgradeDefinition[];
  readonly api: Readonly<Record<string, ApiDefinition>>;
  readonly onEnable: Lifecycle | null;
  readonly onDisable: Lifecycle | null;
}

function namedProblems(
  what: string,
  record: Readonly<Record<string, unknown>> | undefined,
  kind?: string,
): string[] {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(record ?? {})) {
    if (!isKey(name)) {
      problems.push(`the ${what} "${name}" is not named as a key`);
    }
    if (
      kind !== undefined &&
      (typeof value !== "object" || value === null || (value as { kind?: unknown }).kind !== kind)
    ) {
      problems.push(
        `the ${what} ${name} is not from define${kind[0]?.toUpperCase()}${kind.slice(1)}`,
      );
    }
  }
  return problems;
}

/** The whole of a plugin's server module, checked once when it loads. */
export function definePlugin(parts: PluginParts): PluginDefinition {
  const problems: (string | undefined)[] = [];
  const collections = parts.collections ?? [];
  if (!Array.isArray(collections)) {
    problems.push("collections is a list of defineCollection");
  } else {
    if (collections.length > MAX_PLUGIN_COLLECTIONS) {
      problems.push(`${collections.length} collections; ${MAX_PLUGIN_COLLECTIONS} at most`);
    }
    const names = collections.map((collection) => collection?.name);
    if (new Set(names).size !== names.length) {
      problems.push("two collections have one name");
    }
    for (const collection of collections) {
      if (typeof collection?.name !== "string" || !("schema" in collection)) {
        problems.push("a collection is not from defineCollection");
      }
    }
  }
  problems.push(...namedProblems("command", parts.commands, "command"));
  problems.push(...namedProblems("query", parts.queries, "query"));
  problems.push(...namedProblems("endpoint", parts.endpoints, "endpoint"));
  problems.push(...namedProblems("job", parts.jobs));
  problems.push(...namedProblems("api call", parts.api));
  const operations = [...Object.keys(parts.commands ?? {}), ...Object.keys(parts.queries ?? {})];
  if (operations.length > MAX_PLUGIN_OPERATIONS) {
    problems.push(`${operations.length} commands and queries; ${MAX_PLUGIN_OPERATIONS} at most`);
  }
  if (new Set(operations).size !== operations.length) {
    problems.push("a command and a query have one name");
  }
  for (const name of operations) {
    if (RESERVED_COMMAND_NAMES.includes(name)) {
      problems.push(
        `${name} is a subcommand of console plugin <key>, and not a name for a command or a query`,
      );
    }
  }
  if (Object.keys(parts.endpoints ?? {}).length > MAX_PLUGIN_ENDPOINTS) {
    problems.push(`more than ${MAX_PLUGIN_ENDPOINTS} endpoints`);
  }
  for (const [kind, handler] of Object.entries(parts.on ?? {})) {
    if (!HOOK_KIND.test(kind)) {
      problems.push(`the hook "${kind}" is neither console:<kind> nor plugin:<key>:<kind>`);
    }
    if (typeof handler !== "function") {
      problems.push(`the hook ${kind} is not a function`);
    }
  }
  for (const [name, job] of Object.entries(parts.jobs ?? {})) {
    problems.push(aboutProblem(`the job ${name}`, job?.about));
    const every = typeof job?.every === "string" ? durationMs(job.every) : undefined;
    if (every === undefined || every < MIN_PLUGIN_JOB_INTERVAL_MS) {
      problems.push(
        `the job ${name} runs every "${String(job?.every)}", which is not an ISO 8601 duration of five minutes or more`,
      );
    } else if (job.at !== undefined && (!TIME_OF_DAY.test(job.at) || every < DAY_MS)) {
      problems.push(
        `the job ${name} has at, which is HH:MM for a job that runs daily or less often`,
      );
    }
    if (typeof job?.run !== "function") {
      problems.push(`the job ${name} needs run, an async function`);
    }
  }
  const upgrades = parts.upgrades ?? [];
  let last = 1;
  for (const upgrade of upgrades) {
    if (!Number.isInteger(upgrade?.to) || upgrade.to !== last + 1) {
      problems.push(
        `the upgrades go up one dataVersion at a time from 2: "${String(upgrade?.to)}" after ${last} does not`,
      );
    } else {
      last = upgrade.to;
    }
    problems.push(aboutProblem(`the upgrade to ${String(upgrade?.to)}`, upgrade?.about));
    if (typeof upgrade?.run !== "function") {
      problems.push(`the upgrade to ${String(upgrade?.to)} needs run, an async function`);
    }
  }
  for (const [name, call] of Object.entries(parts.api ?? {})) {
    problems.push(aboutProblem(`the api call ${name}`, call?.about));
    if (typeof call?.input !== "object" || call.input === null || !("~standard" in call.input)) {
      problems.push(`the api call ${name} needs input, a zod schema`);
    }
    if (typeof call?.run !== "function") {
      problems.push(`the api call ${name} needs run, an async function`);
    }
  }
  for (const [name, hook] of [
    ["onEnable", parts.onEnable],
    ["onDisable", parts.onDisable],
  ] as const) {
    if (hook !== undefined && typeof hook !== "function") {
      problems.push(`${name} is not a function`);
    }
  }
  fail(problems);
  return Object.freeze({
    pluginApi: CURRENT_PLUGIN_API,
    collections: Object.freeze([...collections]),
    commands: Object.freeze({ ...(parts.commands ?? {}) }),
    queries: Object.freeze({ ...(parts.queries ?? {}) }),
    endpoints: Object.freeze({ ...(parts.endpoints ?? {}) }),
    on: Object.freeze({ ...(parts.on ?? {}) }),
    jobs: Object.freeze({ ...(parts.jobs ?? {}) }),
    upgrades: Object.freeze([...upgrades]),
    api: Object.freeze({ ...(parts.api ?? {}) }),
    onEnable: parts.onEnable ?? null,
    onDisable: parts.onDisable ?? null,
  });
}

/** True for what `definePlugin` yields, whichever copy of this package built it. */
export function isPluginDefinition(value: unknown): value is PluginDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<PluginDefinition>;
  return (
    typeof candidate.pluginApi === "number" &&
    Array.isArray(candidate.collections) &&
    typeof candidate.commands === "object" &&
    candidate.commands !== null &&
    typeof candidate.queries === "object" &&
    candidate.queries !== null &&
    typeof candidate.endpoints === "object" &&
    candidate.endpoints !== null &&
    typeof candidate.on === "object" &&
    candidate.on !== null &&
    typeof candidate.jobs === "object" &&
    candidate.jobs !== null &&
    Array.isArray(candidate.upgrades) &&
    typeof candidate.api === "object" &&
    candidate.api !== null
  );
}

/** A command or a query as the console describes it: enough to parse words, write help and draw a form. */
export interface OperationDescription {
  readonly about: string;
  readonly args: Readonly<Record<string, ArgDescription>>;
  readonly roles: readonly string[] | null;
}

export interface CollectionDescription {
  readonly name: string;
  readonly indexes: readonly string[];
  readonly search: readonly string[];
  readonly owner: string | null;
  readonly project: "none" | "optional" | "required";
  readonly read: readonly string[];
  readonly readOwn: readonly string[];
  readonly history: boolean;
}

export interface EndpointDescription {
  readonly auth: EndpointAuth;
  readonly roles: readonly string[] | null;
  readonly secret: string | null;
  readonly methods: readonly string[];
  readonly headers: readonly string[];
}

/** The server module as data: what crosses from the plugin's thread to the console, as JSON. */
export interface PluginDescription {
  readonly pluginApi: number;
  readonly collections: readonly CollectionDescription[];
  readonly commands: Readonly<Record<string, OperationDescription>>;
  readonly queries: Readonly<Record<string, OperationDescription>>;
  readonly endpoints: Readonly<Record<string, EndpointDescription>>;
  readonly hooks: readonly string[];
  readonly jobs: Readonly<
    Record<string, { readonly about: string; readonly every: string; readonly at: string | null }>
  >;
  readonly upgrades: readonly { readonly to: number; readonly about: string }[];
  readonly api: Readonly<Record<string, { readonly about: string }>>;
  readonly onEnable: boolean;
  readonly onDisable: boolean;
}

function describeArg(description: ArgDescription): ArgDescription {
  const copy: Record<string, unknown> = {
    type: description.type,
    optional: description.optional,
    positional: description.positional,
  };
  for (const field of [
    "about",
    "secret",
    "max",
    "min",
    "integer",
    "options",
    "collection",
  ] as const) {
    if (description[field] !== undefined) {
      copy[field] = description[field];
    }
  }
  if (description.of !== undefined) {
    copy.of = describeArg(description.of);
  }
  return copy as unknown as ArgDescription;
}

function describeOperation(operation: CommandDefinition | QueryDefinition): OperationDescription {
  return {
    about: operation.about,
    args: Object.fromEntries(
      Object.entries(operation.args).map(([name, definition]) => [name, describeArg(definition)]),
    ),
    roles: operation.roles,
  };
}

/** The definition as JSON, functions and schemas left behind. */
export function describePlugin(definition: PluginDefinition): PluginDescription {
  return {
    pluginApi: definition.pluginApi,
    collections: definition.collections.map((collection) => ({
      name: collection.name,
      indexes: [...collection.indexes],
      search: [...collection.search],
      owner: collection.owner,
      project: collection.project,
      read: [...collection.read],
      readOwn: [...collection.readOwn],
      history: collection.history,
    })),
    commands: Object.fromEntries(
      Object.entries(definition.commands).map(([name, command]) => [
        name,
        describeOperation(command),
      ]),
    ),
    queries: Object.fromEntries(
      Object.entries(definition.queries).map(([name, query]) => [name, describeOperation(query)]),
    ),
    endpoints: Object.fromEntries(
      Object.entries(definition.endpoints).map(([name, endpoint]) => [
        name,
        {
          auth: endpoint.auth,
          roles: endpoint.roles,
          secret: endpoint.secret,
          methods: [...endpoint.methods],
          headers: [...endpoint.headers],
        },
      ]),
    ),
    hooks: Object.keys(definition.on),
    jobs: Object.fromEntries(
      Object.entries(definition.jobs).map(([name, job]) => [
        name,
        { about: job.about, every: job.every, at: job.at ?? null },
      ]),
    ),
    upgrades: definition.upgrades.map((upgrade) => ({ to: upgrade.to, about: upgrade.about })),
    api: Object.fromEntries(
      Object.entries(definition.api).map(([name, call]) => [name, { about: call.about }]),
    ),
    onEnable: definition.onEnable !== null,
    onDisable: definition.onDisable !== null,
  };
}

/** What a manifest must declare for a description to hold: the problems, or none. */
export function descriptionProblems(
  description: PluginDescription,
  manifest: {
    readonly roles: Readonly<Record<string, unknown>>;
    readonly capabilities: readonly string[];
    readonly settings: readonly { readonly key: string; readonly type: string }[];
    readonly dataVersion: number;
  },
): string[] {
  const problems: string[] = [];
  const roles = Object.keys(manifest.roles);
  const collections = new Set(description.collections.map((collection) => collection.name));
  const undeclared = (where: string, named: readonly string[] | null) => {
    for (const role of named ?? []) {
      if (!roles.includes(role)) {
        problems.push(`${where} names the role ${role}, which the manifest does not declare`);
      }
    }
  };
  const needs = (where: string, capability: string) => {
    if (!manifest.capabilities.includes(capability)) {
      problems.push(
        `${where} needs the capability ${capability}, which the manifest does not declare`,
      );
    }
  };
  for (const collection of description.collections) {
    undeclared(`the collection ${collection.name}'s read`, collection.read);
    undeclared(`the collection ${collection.name}'s readOwn`, collection.readOwn);
  }
  const checkArgs = (where: string, args: Readonly<Record<string, ArgDescription>>) => {
    for (const [name, description] of Object.entries(args)) {
      const inner = description.type === "list" ? description.of : description;
      if (
        inner?.type === "record" &&
        inner.collection !== undefined &&
        !collections.has(inner.collection)
      ) {
        problems.push(
          `${where}'s argument ${name} names the collection ${inner.collection}, which is not defined`,
        );
      }
      if (inner?.type === "file") {
        needs(`${where}'s argument ${name}`, "files");
      }
    }
  };
  for (const [name, command] of Object.entries(description.commands)) {
    undeclared(`the command ${name}`, command.roles);
    checkArgs(`the command ${name}`, command.args);
  }
  for (const [name, query] of Object.entries(description.queries)) {
    undeclared(`the query ${name}`, query.roles);
    checkArgs(`the query ${name}`, query.args);
  }
  for (const [name, endpoint] of Object.entries(description.endpoints)) {
    needs(`the endpoint ${name}`, "endpoints");
    undeclared(`the endpoint ${name}`, endpoint.roles);
    if (endpoint.secret !== null) {
      const setting = manifest.settings.find((candidate) => candidate.key === endpoint.secret);
      if (setting === undefined || setting.type !== "secret") {
        problems.push(
          `the endpoint ${name} verifies with the setting ${endpoint.secret}, which is not a secret setting of the manifest`,
        );
      }
    }
  }
  for (const hook of description.hooks) {
    needs(`the hook ${hook}`, hook.startsWith("console:") ? "events:console" : "events:plugins");
  }
  for (const name of Object.keys(description.jobs)) {
    needs(`the job ${name}`, "jobs");
  }
  const reached = description.upgrades.at(-1)?.to ?? 1;
  if (reached !== manifest.dataVersion) {
    problems.push(
      `the manifest's dataVersion is ${manifest.dataVersion} and the upgrades reach ${reached}: an upgrade brings the records to every version after 1`,
    );
  }
  return problems;
}
