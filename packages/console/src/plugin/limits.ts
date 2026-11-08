// How much a plugin may ask of a console (docs/specs/plugins.md, "Limits and refusals"): the
// bounds the manifest's schema, the definers, the host and the pages hold a plugin to. One source,
// so that `console-plugin check` says before an administrator finds out.

/** A plugin's name in one language, its description, and the sentence agents read with the rules. */
export const MAX_PLUGIN_NAME_LENGTH = 40;
export const MAX_PLUGIN_DESCRIPTION_LENGTH = 200;
export const MAX_PLUGIN_AGENT_NOTE_LENGTH = 200;
/** A plugin's key, a role's, a page's, a widget's, a setting's, a collection's, a command's: `^[a-z][a-z0-9-]{1,31}$`. */
export const MAX_PLUGIN_KEY_LENGTH = 32;
/** How many roles, settings, groups of settings, pages and widgets one manifest declares. */
export const MAX_PLUGIN_ROLES = 10;
export const MAX_PLUGIN_SETTINGS = 50;
export const MAX_PLUGIN_SETTING_GROUPS = 10;
export const MAX_PLUGIN_PAGES = 12;
export const MAX_PLUGIN_WIDGETS = 4;
/** How many capabilities a plugin asks, the optional ones counted. */
export const MAX_PLUGIN_CAPABILITIES = 50;
/** How many collections, commands and queries together, endpoints, and indexes of one collection a server module defines. */
export const MAX_PLUGIN_COLLECTIONS = 50;
export const MAX_PLUGIN_OPERATIONS = 100;
export const MAX_PLUGIN_ENDPOINTS = 20;
export const MAX_PLUGIN_INDEXES = 8;
/** One line about a command, a query, a job or an argument, as help prints it. */
export const MAX_PLUGIN_ABOUT_LENGTH = 200;
/** The options of an `enum` setting or argument. */
export const MAX_PLUGIN_OPTIONS = 50;
/** A record, how many a plugin keeps, and how many versions one record keeps. */
export const MAX_PLUGIN_RECORD_BYTES = 64 * 1024;
export const MAX_PLUGIN_RECORDS = 100_000;
export const MAX_PLUGIN_RECORD_VERSIONS = 100;
/** A message between the host and the parent, a query's answer, an endpoint's answer. */
export const MAX_PLUGIN_MESSAGE_BYTES = 4 * 1024 * 1024;
/** What an endpoint takes in. */
export const MAX_PLUGIN_ENDPOINT_BODY_BYTES = 1024 * 1024;
/** The words of one command line sent to `invoke`, and the characters of one word. */
export const MAX_PLUGIN_ARGV_WORDS = 200;
export const MAX_PLUGIN_ARGV_WORD_LENGTH = 50_000;
/** The files one command takes at once. */
export const MAX_PLUGIN_COMMAND_FILES = 20;
/** An event of the plugin's own, how many are kept, and for how long. */
export const MAX_PLUGIN_EVENT_BYTES = 16 * 1024;
export const PLUGIN_EVENTS_KEPT = 100_000;
export const PLUGIN_EVENT_DAYS = 90;
/** The most days a collection's retention may keep a record: ten years. */
export const MAX_PLUGIN_RETENTION_DAYS = 3650;
/** How many records one page of a list carries at most. */
export const PLUGIN_LIST_LIMIT = 200;
/** How long plugin code may run: a command; a query or an endpoint; a hook; a job; `onEnable`, `onDisable` and an upgrade. */
export const PLUGIN_COMMAND_MS = 30_000;
export const PLUGIN_QUERY_MS = 10_000;
export const PLUGIN_ENDPOINT_MS = 10_000;
export const PLUGIN_HOOK_MS = 30_000;
export const PLUGIN_JOB_MS = 5 * 60_000;
export const PLUGIN_LIFECYCLE_MS = 10 * 60_000;
/** A job runs no more often than this. */
export const MIN_PLUGIN_JOB_INTERVAL_MS = 5 * 60_000;
/** Outbound requests a minute per plugin, the bytes of an answer, and its time. */
export const PLUGIN_OUTBOUND_PER_MINUTE = 60;
export const MAX_PLUGIN_OUTBOUND_BYTES = 10 * 1024 * 1024;
export const PLUGIN_OUTBOUND_MS = 10_000;
/** Webhook requests a minute per plugin. */
export const PLUGIN_WEBHOOKS_PER_MINUTE = 600;
/** Lines `ctx.log` writes a minute. */
export const PLUGIN_LOG_LINES_PER_MINUTE = 100;
/** SQL, with `storage:sql`: a statement's time, a result's rows, the connections of the plugin's role. */
export const PLUGIN_SQL_STATEMENT_MS = 10_000;
export const MAX_PLUGIN_SQL_ROWS = 10_000;
export const PLUGIN_SQL_CONNECTIONS = 4;
/** The memory a plugin's thread may hold, in megabytes, where the deployment says nothing. */
export const DEFAULT_PLUGIN_MEMORY_MB = 256;
/** How tall a widget's frame grew, in pixels, before a widget had sizes of a family (ADR-0059); kept for the readers of before, read by nothing. */
export const MAX_PLUGIN_WIDGET_HEIGHT = 480;
/** How many retries a hook gets before its event is skipped with a `plugin.failed` event. */
export const PLUGIN_HOOK_RETRIES = 5;
