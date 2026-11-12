// The REST shapes of the plugins' routes (docs/specs/plugins.md, "REST"): what the console
// answers about its plugins and what an administrator sends to enable, configure and grant. In
// the mini build of zod, as every REST schema is, and part of the snapshot the contract is held
// to (ADR-0043). What a plugin's own command or query carries is the plugin's, and not here.
import * as z from "zod/mini";
import {
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_TEAM_KEY_LENGTH,
} from "../limits.js";
import { PLUGIN_STATES } from "../vocabulary.js";
import { ARG_TYPES } from "./args.js";
import {
  MAX_PLUGIN_ARGV_WORD_LENGTH,
  MAX_PLUGIN_ARGV_WORDS,
  MAX_PLUGIN_COMMAND_FILES,
} from "./limits.js";
import {
  PLUGIN_BOARD_NEEDS,
  PLUGIN_KEY_PATTERN,
  PLUGIN_PAGE_LEVELS,
  PLUGIN_SETTING_TYPES,
  PLUGIN_WIDGET_PLACES,
  PLUGIN_WIDGET_SIZE_NAMES,
  PLUGIN_WIDGET_SIZES,
  SETTING_KEY_PATTERN,
} from "./manifest.js";

/** How long a secret an administrator sets for a plugin may be. */
export const MAX_PLUGIN_SECRET_LENGTH = 4096;
/** How many grants one plugin holds. */
export const MAX_PLUGIN_GRANTS = 1000;

const uuid = z.uuid();
const instant = z.iso.datetime();
const pluginKey = z.string().check(z.regex(PLUGIN_KEY_PATTERN));
const settingKey = z.string().check(z.regex(SETTING_KEY_PATTERN));
const projectKey = z.string().check(z.minLength(1), z.maxLength(MAX_PROJECT_KEY_LENGTH));
/** A text per language, as the manifest has it. */
const localized = z.record(z.string(), z.string());

/** An argument of a command or a query, as the console describes it for help and forms. */
export const restPluginArgSchema: z.ZodMiniType<RestPluginArg> = z.object({
  type: z.enum(ARG_TYPES),
  about: z.optional(z.string()),
  optional: z.boolean(),
  positional: z.boolean(),
  secret: z.optional(z.boolean()),
  max: z.optional(z.number()),
  min: z.optional(z.number()),
  integer: z.optional(z.boolean()),
  options: z.optional(z.array(z.string())),
  collection: z.optional(z.string()),
  get of() {
    return z.optional(restPluginArgSchema);
  },
});
export interface RestPluginArg {
  readonly type: (typeof ARG_TYPES)[number];
  readonly about?: string | undefined;
  readonly optional: boolean;
  readonly positional: boolean;
  readonly secret?: boolean | undefined;
  readonly max?: number | undefined;
  readonly min?: number | undefined;
  readonly integer?: boolean | undefined;
  readonly options?: readonly string[] | undefined;
  readonly collection?: string | undefined;
  readonly of?: RestPluginArg | undefined;
}

/** A command or a query of a plugin, as `GET /api/v1/plugins/<key>` lists them. */
export const restPluginOperationSchema = z.object({
  name: z.string(),
  kind: z.enum(["command", "query"]),
  about: z.string(),
  args: z.record(z.string(), restPluginArgSchema),
  /** The roles that may run it, or `null` for every member. */
  roles: z.nullable(z.array(z.string())),
});
export type RestPluginOperation = z.infer<typeof restPluginOperationSchema>;

export const restPluginPageSchema = z.object({
  key: z.string(),
  name: localized,
  level: z.enum(PLUGIN_PAGE_LEVELS),
  wide: z.boolean(),
});
export type RestPluginPage = z.infer<typeof restPluginPageSchema>;

export const restPluginWidgetSchema = z.object({
  key: z.string(),
  name: localized,
  place: z.enum(PLUGIN_WIDGET_PLACES),
  /** The size of before nearest to the one it starts at, for a reader of before. */
  size: z.enum(PLUGIN_WIDGET_SIZES),
  /** The sizes the widget comes in (ADR-0059) and the one it starts at; answered from 0.4.4 and read as optional. */
  sizes: z.optional(z.array(z.enum(PLUGIN_WIDGET_SIZE_NAMES))),
  defaultSize: z.optional(z.enum(PLUGIN_WIDGET_SIZE_NAMES)),
});
export type RestPluginWidget = z.infer<typeof restPluginWidgetSchema>;

/** A plugin as a member may know of it: what it is, how it stands, and what the member may do with it. */
export const restPluginSchema = z.object({
  key: z.string(),
  name: localized,
  description: localized,
  /** The sentence agents read with the rules, or `null` for the description. */
  agentNote: z.nullable(localized),
  version: z.string(),
  /**
   * The consoles the plugin declares it runs on, a semver range of the console's version, or
   * `null` where the manifest names none; a console outside it fails the plugin with the reason
   * in `problems`. Answered from 0.4.4 and read as optional, so that a console built on this
   * package still reads an older console's answer.
   */
  console: z.optional(z.nullable(z.string())),
  state: z.enum(PLUGIN_STATES),
  /** Why the plugin failed, or waits for consent; empty otherwise. */
  problems: z.array(z.string()),
  /** The asker's roles in the plugin; every role for an administrator. */
  roles: z.array(z.string()),
  /** The roles the plugin declares, by key, with their names. */
  declaredRoles: z.array(
    z.object({
      key: z.string(),
      name: localized,
      description: localized,
      /** What the role follows, held with no grant: `reports`, whoever manages someone (ADR-0068); answered from 0.4.5 and read as optional. */
      follows: z.optional(z.nullable(z.literal("reports"))),
    }),
  ),
  /** The role every member holds without a grant, or `null` where the manifest names none. */
  defaultRole: z.nullable(z.string()),
  menu: z.nullable(z.object({ group: z.string(), order: z.int(), name: z.nullable(localized) })),
  /** The pages and widgets the asker may see. */
  pages: z.array(restPluginPageSchema),
  widgets: z.array(restPluginWidgetSchema),
  /** The board project, or `null` for none. */
  board: z.nullable(z.object({ key: z.string(), name: z.string() })),
  boardNeeds: z.enum(PLUGIN_BOARD_NEEDS),
  /** What the plugin asks, and what was consented to; `consent` is `null` to a member. */
  capabilities: z.array(z.string()),
  /** What it can go without (ADR-0060), an administrator's to turn on; a console older than them names none. */
  optionalCapabilities: z.optional(z.array(z.string())),
  consent: z.nullable(z.array(z.string())),
  /** The projects the plugin is on: all, their keys, or `null` to a member. */
  projects: z.nullable(z.union([z.literal("all"), z.array(z.string())])),
  requires: z.record(z.string(), z.string()),
  dataVersion: z.int(),
  enabledAt: z.nullable(instant),
});
export type RestPlugin = z.infer<typeof restPluginSchema>;

export const restPluginsSchema = z.object({
  items: z.array(restPluginSchema),
  /** Whether this deployment can give a plugin a schema of its own (`storage:sql`). */
  sql: z.boolean(),
});
export type RestPlugins = z.infer<typeof restPluginsSchema>;

/** A setting as the pages draw its form: the manifest's declaration, and whether and what it holds. */
export const restPluginSettingSchema = z.object({
  key: z.string(),
  type: z.enum(PLUGIN_SETTING_TYPES),
  name: localized,
  description: z.nullable(localized),
  required: z.boolean(),
  default: z.nullable(z.unknown()),
  min: z.nullable(z.number()),
  max: z.nullable(z.number()),
  options: z.nullable(z.array(z.object({ value: z.string(), name: localized }))),
  of: z.nullable(z.string()),
  /** The group the setting is shown under, or `null` for above every group; answered from 0.4.4 and read as optional. */
  group: z.optional(z.nullable(z.string())),
  /** Whether a value is set; a secret's value is never here. */
  set: z.boolean(),
  value: z.nullable(z.unknown()),
  /** When a secret was set, or `null`. */
  setAt: z.nullable(instant),
  /** When a secret expires, or `null` (ADR-0070); answered from 0.4.5 and read as optional. */
  expiresAt: z.optional(z.nullable(instant)),
  /** `administrator` for a secret an administrator set, the host of the answer it was sealed from otherwise, `null` while unset. */
  source: z.optional(z.nullable(z.string())),
  /** The hosts a secret is pinned to, or `null` for any the plugin reaches. */
  hosts: z.optional(z.nullable(z.array(z.string()))),
  /** `verify` for a secret that verifies and signs nothing, or `null`. */
  use: z.optional(z.nullable(z.literal("verify"))),
});
export type RestPluginSetting = z.infer<typeof restPluginSettingSchema>;

/** A grant of a role: to a person, to the members of a project, or to everyone. */
export const restPluginGrantSchema = z.object({
  id: uuid,
  role: z.string(),
  person: z.nullable(z.object({ id: uuid, login: z.string(), name: z.nullable(z.string()) })),
  project: z.nullable(z.object({ key: z.string(), name: z.string() })),
  everyone: z.boolean(),
  /** The plugin the role went to (ADR-0072), by key, or `null`; answered from 0.4.5 and read as optional. */
  plugin: z.optional(z.nullable(z.string())),
  /** The team the role went to (ADR-0073), whose members hold it, or `null`; answered from 0.4.5 and read as optional. */
  team: z.optional(z.nullable(z.object({ key: z.string(), name: z.string() }))),
  createdAt: instant,
});
export type RestPluginGrant = z.infer<typeof restPluginGrantSchema>;

export const restPluginGrantsSchema = z.object({ items: z.array(restPluginGrantSchema) });
export type RestPluginGrants = z.infer<typeof restPluginGrantsSchema>;

/** One plugin whole, for `GET /api/v1/plugins/<key>`: the listing's fields, and what agents and administrators need. */
export const restPluginDetailSchema = z.extend(restPluginSchema, {
  operations: z.array(restPluginOperationSchema),
  /** Where the plugin's skills are read, or `null` for none. */
  skills: z.nullable(z.string()),
  /** The board project the manifest proposes, for an administrator who makes it; `null` where it proposes none. */
  boardDefaults: z.nullable(z.object({ key: z.string(), name: localized, description: localized })),
  settings: z.array(restPluginSettingSchema),
  /** The groups the settings form is divided into, in the manifest's order; answered from 0.4.4 and read as optional. */
  settingGroups: z.optional(
    z.array(z.object({ key: z.string(), name: localized, description: z.nullable(localized) })),
  ),
  /** The grants, to an administrator; `null` to a member. */
  grants: z.nullable(z.array(restPluginGrantSchema)),
  /** The plugin's own events are at this path. */
  events: z.string(),
  /**
   * Whether the plugin reads a time of day (a job at a time, a `time` setting) while the
   * workspace has no time zone, so that its times run on UTC with nobody having said so: the
   * pages and the command tell an administrator to set one. Answered from 0.4.5 and read as optional.
   */
  needsTimeZone: z.optional(z.boolean()),
  /** The collections the plugin keeps for a while only, each with its days, so that an administrator reads what it forgets; answered from 0.4.5 and read as optional. */
  keeps: z.optional(z.array(z.object({ collection: z.string(), days: z.int() }))),
  /**
   * What the manifest asks of other plugins (ADR-0072): a role of a plugin, why, and how it
   * stands: granted, not yet, or the plugin is not enabled. Answered from 0.4.5 and read as optional.
   */
  asks: z.optional(
    z.array(
      z.object({
        plugin: z.string(),
        role: z.string(),
        why: localized,
        state: z.enum(["granted", "ungranted", "unavailable"]),
      }),
    ),
  ),
});
export type RestPluginDetail = z.infer<typeof restPluginDetailSchema>;

/** What `POST /api/v1/plugins/<key>/enable` is sent. */
export const restPluginEnableInputSchema = z.object({
  /** Every capability the manifest requires, named again, and the optional ones to turn on: consent. */
  consent: z.array(z.string().check(z.maxLength(300))).check(z.maxLength(50)),
  /** The board project: one to make, one that exists, or none. */
  board: z.nullable(
    z.union([
      z.object({
        create: z.object({
          key: z.string().check(z.minLength(1), z.maxLength(MAX_PROJECT_KEY_LENGTH)),
          name: z.string().check(z.minLength(1), z.maxLength(MAX_PROJECT_NAME_LENGTH)),
          description: z.string().check(z.maxLength(MAX_PROJECT_DESCRIPTION_LENGTH)),
        }),
      }),
      z.object({ project: projectKey }),
    ]),
  ),
  /** The projects the plugin is on. */
  projects: z.union([z.literal("all"), z.array(projectKey).check(z.maxLength(500))]),
  /** The settings' values, without secrets. */
  settings: z.optional(z.record(settingKey, z.unknown())),
});
export type RestPluginEnableInput = z.infer<typeof restPluginEnableInputSchema>;

/** What `PATCH /api/v1/plugins/<key>/settings` is sent: the values that change; `null` clears one. */
export const restPluginSettingsPatchSchema = z.object({
  values: z.record(settingKey, z.unknown()),
});
export type RestPluginSettingsPatch = z.infer<typeof restPluginSettingsPatchSchema>;

/** What `PATCH /api/v1/plugins/<key>/consent` is sent: what the plugin holds from now on, those it requires named again. */
export const restPluginConsentPatchSchema = z.object({
  consent: z.array(z.string().check(z.maxLength(300))).check(z.maxLength(50)),
});
export type RestPluginConsentPatch = z.infer<typeof restPluginConsentPatchSchema>;

/** What `PUT /api/v1/plugins/<key>/secrets/<name>` is sent. */
export const restPluginSecretInputSchema = z.object({
  value: z.string().check(z.minLength(1), z.maxLength(MAX_PLUGIN_SECRET_LENGTH)),
});
export type RestPluginSecretInput = z.infer<typeof restPluginSecretInputSchema>;

/** What `POST /api/v1/plugins/<key>/grants` is sent: a role, and exactly one of whom. */
export const restPluginGrantInputSchema = z
  .object({
    role: pluginKey,
    person: z.optional(uuid),
    project: z.optional(projectKey),
    /** A plugin, by key, to hold the role as itself (ADR-0072). */
    plugin: z.optional(pluginKey),
    /** A team, by its key (ADR-0074), whose members hold the role (ADR-0073). */
    team: z.optional(z.string().check(z.minLength(1), z.maxLength(MAX_TEAM_KEY_LENGTH))),
    everyone: z.optional(z.literal(true)),
  })
  .check(
    z.refine(
      (input) =>
        [
          input.person !== undefined,
          input.project !== undefined,
          input.plugin !== undefined,
          input.team !== undefined,
          input.everyone === true,
        ].filter(Boolean).length === 1,
      "names a person, a project, a plugin, a team or everyone, one of the five",
    ),
  );
export type RestPluginGrantInput = z.infer<typeof restPluginGrantInputSchema>;

/** A file a person uploaded for a command (`POST .../files`): the handle a `file` argument takes, good for an hour. */
export const restPluginFileHandleSchema = z.object({
  handle: z.string(),
  name: z.string(),
  type: z.string(),
  bytes: z.int(),
});
export type RestPluginFileHandle = z.infer<typeof restPluginFileHandleSchema>;

/** A handle as a command line names one: what `POST .../files` answered. */
const handle = z.string().check(z.minLength(1), z.maxLength(254));

/**
 * What `POST /api/v1/plugins/<key>/invoke` is sent: the words as typed, the command's or the
 * query's name first, the handles of the files uploaded for it, the project the call is on, and
 * the run it is for where the caller has several open.
 */
export const restPluginInvokeInputSchema = z.object({
  argv: z
    .array(z.string().check(z.maxLength(MAX_PLUGIN_ARGV_WORD_LENGTH)))
    .check(z.minLength(1), z.maxLength(MAX_PLUGIN_ARGV_WORDS)),
  files: z.optional(z.array(handle).check(z.maxLength(MAX_PLUGIN_COMMAND_FILES))),
  project: z.optional(projectKey),
  run: z.optional(uuid),
});
export type RestPluginInvokeInput = z.infer<typeof restPluginInvokeInputSchema>;

/** What `POST /api/v1/plugins/<key>/commands/<name>` is sent: the arguments as JSON, by name. */
export const restPluginCommandInputSchema = z.object({
  args: z.record(z.string(), z.unknown()),
  project: z.optional(projectKey),
  run: z.optional(uuid),
});
export type RestPluginCommandInput = z.infer<typeof restPluginCommandInputSchema>;

/**
 * What a command or a query answered: `text` is what the command prints, `data` what `--json`
 * prints (a query's whole answer), `waiting` the id of a decision the caller now waits for.
 */
export const restPluginInvocationSchema = z.object({
  kind: z.enum(["command", "query"]),
  text: z.string(),
  data: z.unknown(),
  waiting: z.nullable(z.string()),
  /**
   * The key of the project the decision in `waiting` waits in, the one it was raised in, where
   * the caller reaches it, else `null`; with nothing waiting, the plugin's board project's, or
   * `null`. Answered from 0.4.5 and read as optional.
   */
  project: z.optional(z.nullable(z.string())),
});
export type RestPluginInvocation = z.infer<typeof restPluginInvocationSchema>;

/** A record of a plugin's collection, as `GET .../records/<collection>` lists them. */
export const restPluginRecordSchema = z.object({
  id: uuid,
  collection: z.string(),
  /** The id of the project the record is linked to, or `null`. */
  project: z.nullable(z.string()),
  /** The id of the person the record is about, where the collection has an owner. */
  owner: z.nullable(z.string()),
  data: z.record(z.string(), z.unknown()),
  version: z.int(),
  createdAt: instant,
  updatedAt: instant,
  createdBy: z.nullable(z.string()),
  updatedBy: z.nullable(z.string()),
  archivedAt: z.nullable(instant),
});
export type RestPluginRecord = z.infer<typeof restPluginRecordSchema>;

/** A page of records, and the cursor `after` continues with, or `null` on the last. */
export const restPluginRecordPageSchema = z.object({
  items: z.array(restPluginRecordSchema),
  after: z.nullable(z.string()),
});
export type RestPluginRecordPage = z.infer<typeof restPluginRecordPageSchema>;

/** One version of a record, as it was. */
export const restPluginRecordVersionSchema = z.object({
  version: z.int(),
  data: z.record(z.string(), z.unknown()),
  at: instant,
  by: z.nullable(z.string()),
});
export type RestPluginRecordVersion = z.infer<typeof restPluginRecordVersionSchema>;

/** What `GET .../records/<collection>/<id>[?version=]` answers: the record, or one version of it. */
export const restPluginRecordReadSchema = z.union([
  restPluginRecordSchema,
  restPluginRecordVersionSchema,
]);
export type RestPluginRecordRead = z.infer<typeof restPluginRecordReadSchema>;

export const restPluginRecordVersionsSchema = z.object({
  items: z.array(restPluginRecordVersionSchema),
});
export type RestPluginRecordVersions = z.infer<typeof restPluginRecordVersionsSchema>;

/** An event a plugin emitted (`ctx.events.emit`), as `GET .../plugin-events?after=` lists them for its frames: its number in the stream, its kind, its data, when. */
export const restPluginEventSchema = z.object({
  id: z.int(),
  kind: z.string(),
  data: z.unknown(),
  at: instant,
});
export type RestPluginEvent = z.infer<typeof restPluginEventSchema>;

export const restPluginEventsSchema = z.object({
  items: z.array(restPluginEventSchema),
  more: z.boolean(),
  /**
   * The number of the plugin's newest event, 0 where it has none: where the stream stands, for
   * a frame that reads it from now. Answered from 0.5.0 and read as optional.
   */
  newest: z.optional(z.int().check(z.nonnegative())),
});
export type RestPluginEvents = z.infer<typeof restPluginEventsSchema>;

/** What `POST /api/v1/plugins/<key>/purge` is sent: the key again. */
export const restPluginPurgeInputSchema = z.object({ confirm: pluginKey });
export type RestPluginPurgeInput = z.infer<typeof restPluginPurgeInputSchema>;
