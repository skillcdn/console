// The manifest of a plugin, `console-plugin.json` (docs/specs/plugins.md, "The manifest"): what the
// plugin is and asks, as data the console reads without running anything. One schema, in the mini
// build of zod so that the settings pages read it too, and the words every key is held to.
import * as z from "zod/mini";
import {
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
} from "../limits.js";
import { hasForbiddenCodePoint } from "../text.js";
import { PLUGIN_WIDGET_SIZE_NAMES, type PluginWidgetSizeName } from "./bridge.js";
import { isPluginCapability } from "./capabilities.js";
import {
  MAX_PLUGIN_AGENT_NOTE_LENGTH,
  MAX_PLUGIN_CAPABILITIES,
  MAX_PLUGIN_DESCRIPTION_LENGTH,
  MAX_PLUGIN_GRANTS_ASKED,
  MAX_PLUGIN_NAME_LENGTH,
  MAX_PLUGIN_OPTIONS,
  MAX_PLUGIN_PAGES,
  MAX_PLUGIN_ROLES,
  MAX_PLUGIN_SETTING_GROUPS,
  MAX_PLUGIN_SETTINGS,
  MAX_PLUGIN_WIDGETS,
} from "./limits.js";

/** A plugin's key, and every key within a plugin: a role's, a page's, a widget's, a setting's, a collection's, a command's. */
export const PLUGIN_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export function isPluginKey(value: string): boolean {
  return PLUGIN_KEY_PATTERN.test(value);
}

/** The majors of the plugin API this package speaks, and the one a new plugin is written against. */
export const PLUGIN_API_MAJORS = [1] as const;
export const CURRENT_PLUGIN_API = 1;

/**
 * Words no plugin's key may be: the console's own paths and the command's own words, so that
 * `/plugins/<key>` and `console plugin <key>` never read as something else.
 */
export const RESERVED_PLUGIN_KEYS: readonly string[] = [
  "api",
  "auth",
  "plugins",
  "plugin",
  "settings",
  "people",
  "person",
  "projects",
  "project",
  "work",
  "decisions",
  "decision",
  "agents",
  "categories",
  "category",
  "pages",
  "connect",
  "docs",
  "doc",
  "tasks",
  "task",
  "runs",
  "run",
  "skills",
  "skill",
  "members",
  "member",
  "rules",
  "goals",
  "goal",
  "feed",
  "files",
  "file",
  "events",
  "frame",
  "web",
  "console",
  "skillcdn",
  "runtime",
  "new",
  "me",
  "help",
  "records",
  "enable",
  "disable",
  "grant",
  "revoke",
  "secret",
  "export",
  "purge",
];

/** Words a page's key may not be: the routes beside the pages under a plugin's path. */
export const RESERVED_PAGE_KEYS: readonly string[] = ["frame", "web", "x"];

/** Words an argument may not be named: the flags `console plugin <key> <command>` keeps for itself. */
export const RESERVED_ARG_NAMES: readonly string[] = [
  "json",
  "url",
  "account",
  "project",
  "file",
  "run",
];

/** Words a command's or a query's name may not be: the subcommands of `console plugin <key>`. */
export const RESERVED_COMMAND_NAMES: readonly string[] = [
  "help",
  "records",
  "skills",
  "skill",
  "enable",
  "disable",
  "settings",
  "secret",
  "grant",
  "revoke",
];

/** The groups of tabs the console knows; a plugin may declare another, with a name. */
export const PLUGIN_MENU_GROUPS = [
  "people",
  "customers",
  "money",
  "operations",
  "marketing",
  "engineering",
  "reports",
] as const;

export type PluginMenuGroup = (typeof PLUGIN_MENU_GROUPS)[number];

export const PLUGIN_SETTING_TYPES = [
  "text",
  "markdown",
  "number",
  "boolean",
  "enum",
  "day",
  "time",
  "person",
  "project",
  "secret",
  "list",
] as const;

export type PluginSettingType = (typeof PLUGIN_SETTING_TYPES)[number];

export const PLUGIN_PAGE_LEVELS = ["workspace", "project"] as const;
export type PluginPageLevel = (typeof PLUGIN_PAGE_LEVELS)[number];

export const PLUGIN_WIDGET_PLACES = ["home:top", "home:bottom"] as const;
export type PluginWidgetPlace = (typeof PLUGIN_WIDGET_PLACES)[number];

/** The sizes of before (ADR-0054), each read as one of the family (ADR-0059): a third as small, a half as medium, the width as wide. */
export const PLUGIN_WIDGET_SIZES = ["third", "half", "full"] as const;
export type PluginWidgetSize = (typeof PLUGIN_WIDGET_SIZES)[number];

export { PLUGIN_WIDGET_SIZE_NAMES, type PluginWidgetSizeName };

const LEGACY_WIDGET_SIZES: Readonly<Record<PluginWidgetSize, PluginWidgetSizeName>> = {
  third: "small",
  half: "medium",
  full: "wide",
};

/** The columns and the rows of the front page's grid of square cells each size takes (ADR-0061). */
export const PLUGIN_WIDGET_SIZE_CELLS: Readonly<
  Record<PluginWidgetSizeName, { readonly columns: number; readonly rows: number }>
> = {
  small: { columns: 2, rows: 2 },
  medium: { columns: 4, rows: 2 },
  large: { columns: 4, rows: 4 },
  wide: { columns: 8, rows: 2 },
  full: { columns: 8, rows: 4 },
};

/** The most cells across a phone's grid has; a widget comes in a size that fits it (ADR-0062). */
const PLUGIN_WIDGET_PHONE_COLUMNS = 4;

/** Whether a size fits a phone's grid. */
const fitsPhone = (size: PluginWidgetSizeName): boolean =>
  PLUGIN_WIDGET_SIZE_CELLS[size].columns <= PLUGIN_WIDGET_PHONE_COLUMNS;

/**
 * The sizes a widget comes in and the one it starts at: `sizes` and `defaultSize` where the
 * manifest declares them, else the one size of before read as one of the family, with a size a
 * phone can hold beside it where that one is too wide.
 */
export function widgetSizesOf(widget: {
  readonly size?: PluginWidgetSize | undefined;
  readonly sizes?: readonly PluginWidgetSizeName[] | undefined;
  readonly defaultSize?: PluginWidgetSizeName | undefined;
}): {
  readonly sizes: readonly PluginWidgetSizeName[];
  readonly defaultSize: PluginWidgetSizeName;
} {
  if (widget.sizes !== undefined && widget.sizes.length > 0) {
    return { sizes: widget.sizes, defaultSize: widget.defaultSize ?? widget.sizes[0] ?? "small" };
  }
  const one = LEGACY_WIDGET_SIZES[widget.size ?? "third"];
  return { sizes: fitsPhone(one) ? [one] : ["medium", one], defaultSize: one };
}

/** The size of before nearest to one of the family, for a reader of before. */
export function legacyWidgetSize(size: PluginWidgetSizeName): PluginWidgetSize {
  return size === "small" ? "third" : size === "medium" || size === "large" ? "half" : "full";
}

export const PLUGIN_BOARD_NEEDS = ["required", "optional", "none"] as const;
export type PluginBoardNeeds = (typeof PLUGIN_BOARD_NEEDS)[number];

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * True for a day as `YYYY-MM-DD` that the calendar has: February 30 and April 31 fit the shape
 * and are no day, and a date made from them comes back as another day.
 */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = DAY.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
/** A time of day as `HH:MM`, read in the workspace's time zone. */
export const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** A path within the package: relative, forward slashes, never climbing out. */
const PACKAGE_PATH = /^(?!\/)(?!\.\.(?:\/|$))(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
/** A semver range as npm spells one, loosely: the console compares versions, the registry resolves. */
const SEMVER_RANGE = /^[\sA-Za-z0-9.^~<>=|*x-]{1,100}$/;

const key = z
  .string()
  .check(
    z.regex(
      PLUGIN_KEY_PATTERN,
      "is lowercase letters, digits and hyphens, 2 to 32 long, starting with a letter",
    ),
  );

const line = (max: number) =>
  z.string().check(
    z.minLength(1),
    z.maxLength(max),
    z.refine((value) => !hasForbiddenCodePoint(value), "must not contain control characters"),
  );

const packagePath = z
  .string()
  .check(
    z.maxLength(200),
    z.regex(PACKAGE_PATH, "is a path within the package, with forward slashes"),
  );

/** A text per language, `en` always among them. */
export type Localized = Readonly<Record<string, string>>;

const localized = (max: number) =>
  z
    .record(z.string().check(z.regex(LANGUAGE_TAG, "is a language tag")), line(max))
    .check(z.refine((texts) => typeof texts.en === "string", "needs an English text under en"));

const roleList = z.array(key).check(z.maxLength(MAX_PLUGIN_ROLES));

const settingOption = z.strictObject({
  value: line(64),
  name: localized(MAX_PLUGIN_NAME_LENGTH),
});

const settingItemType = z.enum(
  PLUGIN_SETTING_TYPES.filter((type) => type !== "secret" && type !== "list"),
);

/** A setting's key, as code and `--set` name it: a lowercase letter, then letters and digits. */
export const SETTING_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;

const settingKey = z
  .string()
  .check(
    z.regex(
      SETTING_KEY_PATTERN,
      "is a lowercase letter followed by letters and digits, up to 32 long",
    ),
  );

const pluginSettingSchema = z
  .strictObject({
    key: settingKey,
    type: z.enum(PLUGIN_SETTING_TYPES),
    name: localized(MAX_PLUGIN_NAME_LENGTH),
    description: z.optional(localized(MAX_PLUGIN_DESCRIPTION_LENGTH)),
    required: z.optional(z.boolean()),
    default: z.optional(z.unknown()),
    min: z.optional(z.number()),
    max: z.optional(z.number()),
    options: z.optional(
      z.array(settingOption).check(z.minLength(1), z.maxLength(MAX_PLUGIN_OPTIONS)),
    ),
    of: z.optional(settingItemType),
    /** The group of `settingGroups` the setting is shown under; left out, above every group. */
    group: z.optional(key),
    /** For a `secret`: the hosts it may be put into a request to (`slack.com`, `*.example.com`), and no other; any host the plugin may reach when left out. */
    hosts: z.optional(z.array(z.string().check(z.maxLength(300))).check(z.maxLength(20))),
    /** For a `secret`: `verify`, a secret that verifies signatures and signs nothing, so that a request cannot be forged with it. */
    use: z.optional(z.literal("verify")),
  })
  .check(
    z.superRefine((setting, ctx) => {
      for (const problem of settingProblems(setting)) {
        ctx.addIssue({ code: "custom", message: problem, input: setting });
      }
    }),
  );

export type PluginSetting = z.infer<typeof pluginSettingSchema>;

/** A group the settings form is divided into: a panel with a name and, where given, a word under it. */
const pluginSettingGroupSchema = z.strictObject({
  key,
  name: localized(MAX_PLUGIN_NAME_LENGTH),
  description: z.optional(localized(MAX_PLUGIN_DESCRIPTION_LENGTH)),
});

export type PluginSettingGroup = z.infer<typeof pluginSettingGroupSchema>;

/** True when `value` is what a setting of `type` holds, `options` being the values of an `enum`. */
function fitsSettingType(
  type: Exclude<PluginSettingType, "secret" | "list">,
  value: unknown,
  options: readonly string[] | undefined,
): boolean {
  switch (type) {
    case "text":
    case "markdown":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && (options ?? []).includes(value);
    case "day":
      return isCalendarDay(value);
    case "time":
      return typeof value === "string" && TIME_OF_DAY.test(value);
    case "person":
    case "project":
      return false;
    default:
      return false;
  }
}

function settingProblems(setting: {
  type: PluginSettingType;
  default?: unknown;
  min?: number;
  max?: number;
  options?: readonly { value: string }[];
  of?: Exclude<PluginSettingType, "secret" | "list">;
  hosts?: readonly string[];
  use?: "verify";
}): string[] {
  const problems: string[] = [];
  if (setting.type !== "secret" && (setting.hosts !== undefined || setting.use !== undefined)) {
    problems.push(`only a secret takes hosts or use`);
  }
  for (const host of setting.hosts ?? []) {
    if (!isPluginCapability(`outbound:${host}`) || host === "webrtc") {
      problems.push(`the host "${host}" is not a host as outbound:<host> names one`);
    }
  }
  const bounded =
    setting.type === "number" ||
    setting.type === "text" ||
    setting.type === "markdown" ||
    setting.type === "list";
  if (!bounded && (setting.min !== undefined || setting.max !== undefined)) {
    problems.push(`a ${setting.type} setting takes no min or max`);
  }
  if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) {
    problems.push("min is above max");
  }
  const enumerated = setting.type === "enum" || (setting.type === "list" && setting.of === "enum");
  if (enumerated && setting.options === undefined) {
    problems.push("an enum needs options");
  }
  if (!enumerated && setting.options !== undefined) {
    problems.push("only an enum takes options");
  }
  if (setting.type === "list" && setting.of === undefined) {
    problems.push("a list needs of, the type of its items");
  }
  if (setting.type !== "list" && setting.of !== undefined) {
    problems.push("only a list takes of");
  }
  if (setting.default !== undefined) {
    const values = setting.options?.map((option) => option.value);
    if (setting.type === "secret" || setting.type === "person" || setting.type === "project") {
      problems.push(`a ${setting.type} setting takes no default`);
    } else if (setting.type === "list") {
      const of = setting.of;
      if (
        of !== undefined &&
        !(
          Array.isArray(setting.default) &&
          setting.default.every((item) => fitsSettingType(of, item, values))
        )
      ) {
        problems.push(`the default is not a list of ${of}`);
      }
    } else if (!fitsSettingType(setting.type, setting.default, values)) {
      problems.push(`the default is not a ${setting.type}`);
    }
  }
  return problems;
}

const pluginPageSchema = z.strictObject({
  key: key.check(
    z.refine((value) => !RESERVED_PAGE_KEYS.includes(value), "is a word the routes reserve"),
  ),
  name: localized(MAX_PLUGIN_NAME_LENGTH),
  level: z.enum(PLUGIN_PAGE_LEVELS),
  roles: z.optional(roleList),
  wide: z.optional(z.boolean()),
});

export type PluginPage = z.infer<typeof pluginPageSchema>;

const pluginWidgetSchema = z
  .strictObject({
    key,
    name: localized(MAX_PLUGIN_NAME_LENGTH),
    place: z.enum(PLUGIN_WIDGET_PLACES),
    /** The one size of before; `sizes` says it better. */
    size: z.optional(z.enum(PLUGIN_WIDGET_SIZES)),
    /** The sizes the widget comes in (ADR-0059), each once; the person picks among them. */
    sizes: z.optional(
      z.array(z.enum(PLUGIN_WIDGET_SIZE_NAMES)).check(z.minLength(1), z.maxLength(5)),
    ),
    /** The size it starts at, one of `sizes`; the first of them when left out. */
    defaultSize: z.optional(z.enum(PLUGIN_WIDGET_SIZE_NAMES)),
    roles: z.optional(roleList),
  })
  .check(
    z.superRefine((widget, ctx) => {
      if (widget.size === undefined && widget.sizes === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "needs sizes, the sizes it comes in",
          input: widget,
        });
      }
      if (widget.sizes !== undefined && new Set(widget.sizes).size !== widget.sizes.length) {
        ctx.addIssue({ code: "custom", message: "sizes names a size twice", input: widget });
      }
      if (widget.sizes !== undefined && !widget.sizes.some(fitsPhone)) {
        ctx.addIssue({
          code: "custom",
          message: "sizes needs small, medium or large: a phone's grid is four cells across",
          input: widget,
        });
      }
      if (widget.defaultSize !== undefined && !(widget.sizes ?? []).includes(widget.defaultSize)) {
        ctx.addIssue({
          code: "custom",
          message: "defaultSize is not one of sizes",
          input: widget,
        });
      }
    }),
  );

export type PluginWidget = z.infer<typeof pluginWidgetSchema>;

/** Every capability a plugin asks: those it needs, then those it can go without (ADR-0060). */
export function capabilitiesAsked(manifest: {
  readonly capabilities: readonly string[];
  readonly optionalCapabilities?: readonly string[] | undefined;
}): string[] {
  return [...manifest.capabilities, ...(manifest.optionalCapabilities ?? [])];
}

const pluginMenuSchema = z
  .strictObject({
    group: key,
    order: z.optional(z.int().check(z.gte(0), z.lte(1000))),
    name: z.optional(localized(MAX_PLUGIN_NAME_LENGTH)),
  })
  .check(
    z.refine(
      (menu) =>
        (PLUGIN_MENU_GROUPS as readonly string[]).includes(menu.group) || menu.name !== undefined,
      "a group the console does not know needs a name",
    ),
  );

export type PluginMenu = z.infer<typeof pluginMenuSchema>;

const pluginBoardSchema = z
  .strictObject({
    needs: z.enum(PLUGIN_BOARD_NEEDS),
    defaults: z.optional(
      z.strictObject({
        key: z
          .string()
          .check(
            z.maxLength(MAX_PROJECT_KEY_LENGTH),
            z.regex(/^[a-z][a-z0-9-]*$/, "is lowercase letters, digits and hyphens"),
          ),
        name: localized(MAX_PROJECT_NAME_LENGTH),
        description: localized(MAX_PROJECT_DESCRIPTION_LENGTH),
      }),
    ),
  })
  .check(
    z.refine(
      (board) => board.needs !== "none" || board.defaults === undefined,
      "a plugin that needs no board has no defaults for one",
    ),
  );

export type PluginBoard = z.infer<typeof pluginBoardSchema>;

const pluginRoleSchema = z.strictObject({
  name: localized(MAX_PLUGIN_NAME_LENGTH),
  description: localized(MAX_PLUGIN_DESCRIPTION_LENGTH),
  /**
   * A role held by what a person is in the directory, with no grant (ADR-0068): `reports`,
   * whoever someone active reports to, read from the directory on every call.
   */
  follows: z.optional(z.literal("reports")),
});

export type PluginRole = z.infer<typeof pluginRoleSchema>;

const pluginStoreSchema = z.strictObject({
  homepage: z.optional(z.string().check(z.maxLength(2048), z.url({ protocol: /^https$/ }))),
  repository: z.optional(z.string().check(z.maxLength(2048), z.url({ protocol: /^https$/ }))),
  keywords: z.optional(z.array(line(40)).check(z.maxLength(10))),
  icon: z.optional(packagePath),
});

/** The manifest as a plugin writes it; `parsePluginManifest` fills what it leaves out. */
export const pluginManifestSchema = z
  .strictObject({
    key: key.check(
      z.refine((value) => !RESERVED_PLUGIN_KEYS.includes(value), "is a word the console reserves"),
    ),
    name: localized(MAX_PLUGIN_NAME_LENGTH),
    description: localized(MAX_PLUGIN_DESCRIPTION_LENGTH),
    agentNote: z.optional(localized(MAX_PLUGIN_AGENT_NOTE_LENGTH)),
    pluginApi: z.int().check(z.positive()),
    /** The consoles the plugin runs on, as a semver range of the console's version; left out, any console that serves `pluginApi`. */
    console: z.optional(z.string().check(z.regex(SEMVER_RANGE, "is a semver range"))),
    server: packagePath,
    web: z.optional(packagePath),
    skills: z.optional(packagePath),
    migrations: z.optional(packagePath),
    capabilities: z._default(
      z.array(z.string().check(z.maxLength(300))).check(z.maxLength(MAX_PLUGIN_CAPABILITIES)),
      [],
    ),
    /** What the plugin can go without (ADR-0060): an administrator turns each on, or leaves it off. */
    optionalCapabilities: z._default(
      z.array(z.string().check(z.maxLength(300))).check(z.maxLength(MAX_PLUGIN_CAPABILITIES)),
      [],
    ),
    roles: z._default(z.record(key, pluginRoleSchema), {}),
    defaultRole: z.optional(key),
    requires: z._default(
      z.record(key, z.string().check(z.regex(SEMVER_RANGE, "is a semver range"))),
      {},
    ),
    /**
     * The roles of other plugins the plugin asks to hold (ADR-0072), by their key, each with why,
     * for the administrator who grants them: shown when enabling and on the plugin's page.
     */
    grants: z._default(
      z.record(
        key,
        z.strictObject({
          roles: z.array(key).check(z.minLength(1), z.maxLength(MAX_PLUGIN_ROLES)),
          why: localized(MAX_PLUGIN_DESCRIPTION_LENGTH),
        }),
      ),
      {},
    ),
    board: z._default(pluginBoardSchema, { needs: "none" }),
    settings: z._default(z.array(pluginSettingSchema).check(z.maxLength(MAX_PLUGIN_SETTINGS)), []),
    settingGroups: z._default(
      z.array(pluginSettingGroupSchema).check(z.maxLength(MAX_PLUGIN_SETTING_GROUPS)),
      [],
    ),
    menu: z.optional(pluginMenuSchema),
    pages: z._default(z.array(pluginPageSchema).check(z.maxLength(MAX_PLUGIN_PAGES)), []),
    widgets: z._default(z.array(pluginWidgetSchema).check(z.maxLength(MAX_PLUGIN_WIDGETS)), []),
    dataVersion: z._default(z.int().check(z.positive()), 1),
    store: z.optional(pluginStoreSchema),
  })
  .check(
    z.superRefine((manifest, ctx) => {
      for (const problem of [
        ...manifestProblems(manifest),
        ...(manifest.key in manifest.grants ? ["grants: a plugin asks nothing of itself"] : []),
      ]) {
        ctx.addIssue({ code: "custom", message: problem, input: manifest });
      }
    }),
  );

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

function duplicates(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const value of keys) {
    if (seen.has(value)) {
      twice.add(value);
    }
    seen.add(value);
  }
  return [...twice];
}

/** What one field alone cannot say: the manifest's parts against each other. */
function manifestProblems(
  manifest: Omit<PluginManifest, "key" | "name" | "description">,
): string[] {
  const problems: string[] = [];
  const roles = Object.keys(manifest.roles);
  if (roles.length > MAX_PLUGIN_ROLES) {
    problems.push(`declares ${roles.length} roles; ${MAX_PLUGIN_ROLES} at most`);
  }
  const pluginsAsked = Object.keys(manifest.grants);
  if (pluginsAsked.length > MAX_PLUGIN_GRANTS_ASKED) {
    problems.push(
      `asks roles of ${pluginsAsked.length} plugins; ${MAX_PLUGIN_GRANTS_ASKED} at most`,
    );
  }
  if (manifest.defaultRole !== undefined && !roles.includes(manifest.defaultRole)) {
    problems.push(`defaultRole ${manifest.defaultRole} is not a declared role`);
  }
  const asked = capabilitiesAsked(manifest);
  if (asked.length > MAX_PLUGIN_CAPABILITIES) {
    problems.push(`capabilities: at most ${MAX_PLUGIN_CAPABILITIES}, the optional ones counted`);
  }
  if (manifest.optionalCapabilities.includes("storage:sql")) {
    problems.push(
      "optionalCapabilities: storage:sql cannot be optional: its schema is made when the plugin is enabled",
    );
  }
  for (const capability of asked) {
    if (!isPluginCapability(capability)) {
      problems.push(`capabilities: ${capability} is not one the console knows`);
    }
  }
  for (const capability of duplicates(asked)) {
    problems.push(`capabilities: ${capability} is declared twice`);
  }
  const undeclared = (where: string, named: readonly string[] | undefined) => {
    for (const role of named ?? []) {
      if (!roles.includes(role)) {
        problems.push(`${where} names the role ${role}, which is not declared`);
      }
    }
  };
  for (const page of manifest.pages) {
    undeclared(`pages.${page.key}`, page.roles);
  }
  for (const widget of manifest.widgets) {
    undeclared(`widgets.${widget.key}`, widget.roles);
  }
  for (const [what, keys] of [
    ["pages", manifest.pages.map((page) => page.key)],
    ["widgets", manifest.widgets.map((widget) => widget.key)],
    ["settings", manifest.settings.map((setting) => setting.key)],
    ["settingGroups", manifest.settingGroups.map((group) => group.key)],
  ] as const) {
    for (const twice of duplicates(keys)) {
      problems.push(`${what}: ${twice} is declared twice`);
    }
  }
  const groups = manifest.settingGroups.map((group) => group.key);
  for (const setting of manifest.settings) {
    if (setting.group !== undefined && !groups.includes(setting.group)) {
      problems.push(
        `settings.${setting.key} names the group ${setting.group}, which settingGroups does not declare`,
      );
    }
  }
  if ((manifest.pages.length > 0 || manifest.widgets.length > 0) && manifest.web === undefined) {
    problems.push("pages and widgets need web, the directory of the bundle");
  }
  if (manifest.migrations !== undefined && !manifest.capabilities.includes("storage:sql")) {
    problems.push("migrations need the capability storage:sql");
  }
  if (manifest.pages.length > 0 && manifest.menu === undefined) {
    problems.push("pages need menu, the tab they are under");
  }
  return problems;
}

/** The issue in words: the mini build of zod says "Invalid input" for its own checks, so the kind of issue is spelled out here. */
function wordsOf(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "unrecognized_keys":
      return `${issue.keys.join(", ")}: not a field of the manifest`;
    case "invalid_type":
      return issue.input === undefined
        ? "is missing"
        : `is not ${issue.expected === "array" ? "a list" : issue.expected === "object" ? "an object" : `a ${issue.expected}`}`;
    case "too_big":
      return `is over ${issue.maximum}`;
    case "too_small":
      return `is under ${issue.minimum}`;
    case "invalid_value":
      return `is not one of ${issue.values.map(String).join(", ")}`;
    case "invalid_format":
      return issue.message === "Invalid input" ? `is not a valid ${issue.format}` : issue.message;
    default:
      return issue.message;
  }
}

export type ManifestParse =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The manifest from what `console-plugin.json` held, filled in, or every problem with it in words. */
export function parsePluginManifest(value: unknown): ManifestParse {
  const result = pluginManifestSchema.safeParse(value);
  if (result.success) {
    return { ok: true, manifest: result.data };
  }
  return {
    ok: false,
    problems: result.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      const message = wordsOf(issue);
      return path.length === 0 ? message : `${path}: ${message}`;
    }),
  };
}

/** The text in the person's language, else in English, else the first there is. */
export function localizedText(texts: Localized, language: string): string {
  return (
    texts[language] ??
    texts[language.split("-")[0] ?? language] ??
    texts.en ??
    Object.values(texts)[0] ??
    ""
  );
}
