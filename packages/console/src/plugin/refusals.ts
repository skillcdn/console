// What a console refuses a plugin, or a call on one, with (docs/specs/plugins.md, "Limits and
// refusals"): the codes, the status each answers with, and the error a plugin's own code throws to
// refuse in its own words, which the console answers as `plugin.<key>.<code>`.

/** The console's refusals about plugins, by code, with the HTTP status each answers with. */
export const PLUGIN_REFUSALS = {
  "plugin.not_found": 404,
  "plugin.disabled": 409,
  "plugin.unavailable": 503,
  "plugin.forbidden": 403,
  "plugin.invalid_args": 400,
  "plugin.timeout": 504,
  "plugin.too_many": 409,
  "plugin.conflict": 409,
  "plugin.needs_consent": 409,
  "plugin.requires": 409,
  "plugin.required_by": 409,
  "plugin.rate_limited": 429,
  /** The plugin's code threw something that is not its own refusal, or answered what cannot be carried; what it said is in the log. */
  "plugin.failed": 500,
} as const;

export type PluginRefusalCode = keyof typeof PLUGIN_REFUSALS;

/** The status a plugin's own refusal answers with. */
export const PLUGIN_OWN_REFUSAL_STATUS = 400;

/** A plugin's own code: lowercase words joined by underscores, as the console's own codes are. */
const OWN_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * What a plugin throws to refuse in its own words: `throw new PluginError("over_limit", "Ten
 * days a year at most.")`. The console answers `plugin.<key>.over_limit` with the message, and
 * the command prints it as any refusal. Anything else thrown is `plugin.failed`, logged, and
 * answered without its message.
 */
export class PluginError extends Error {
  readonly code: string;
  /** What the caller may do with the refusal, as JSON; optional. */
  readonly data: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.name = "PluginError";
    this.code = OWN_CODE.test(code) ? code : "refused";
    this.data = data;
  }
}

export function isPluginError(value: unknown): value is PluginError {
  return (
    value instanceof PluginError ||
    (typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === "PluginError" &&
      typeof (value as { code?: unknown }).code === "string" &&
      typeof (value as { message?: unknown }).message === "string")
  );
}

/** The code the console answers a plugin's own refusal with. */
export function ownRefusalCode(pluginKey: string, code: string): string {
  return `plugin.${pluginKey}.${code}`;
}

/**
 * What a call on `ctx` throws when the console refuses it: the console's code (`plugin.forbidden`
 * for a capability or a role the plugin lacks, `plugin.conflict` for a record that moved on,
 * `plugin.too_many` for a quota reached, ...) and a message a person can read. Plugin code may
 * let it through, and the console answers the caller with it as it is.
 */
export class PluginRefusal extends Error {
  readonly code: string;
  readonly status: number;
  readonly data: unknown;

  constructor(code: PluginRefusalCode | string, message: string, data?: unknown) {
    super(message);
    this.name = "PluginRefusal";
    this.code = code;
    this.status = (PLUGIN_REFUSALS as Record<string, number>)[code] ?? PLUGIN_OWN_REFUSAL_STATUS;
    this.data = data;
  }
}

export function isPluginRefusal(value: unknown): value is PluginRefusal {
  return (
    value instanceof PluginRefusal ||
    (typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === "PluginRefusal" &&
      typeof (value as { code?: unknown }).code === "string")
  );
}
