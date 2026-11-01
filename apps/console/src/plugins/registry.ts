// The plugins of a console (docs/specs/plugins.md): what is installed, what an administrator
// enabled and consented to, what each person may do with each, and the one way plugin code is
// called and answered. The registry holds the host, decides every call on `ctx` by the
// capabilities consented to and the caller's roles, and leaves the record: an event for every
// administrative act and every command, a log line for the rest.
import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type {
  PluginState,
  RestPlugin,
  RestPluginDetail,
  RestPluginEnableInput,
  RestPluginGrant,
  RestPluginOperation,
  RestPluginSetting,
  RestPlugins,
} from "@skillcdn/console/api";
import {
  type ArgDescription,
  argsProblem,
  type CollectionDescription,
  type LinkTarget,
  outboundAllows,
  PLUGIN_COMMAND_MS,
  PLUGIN_LIFECYCLE_MS,
  PLUGIN_QUERY_MS,
  type PluginCaller,
  type PluginDescription,
  type PluginFileHandle,
  type PluginInfo,
  type PluginManifest,
  type PluginRecord,
  PluginRefusal,
  type PluginSetting,
  type RecordAggregation,
  type RecordPage,
  type RecordQuery,
  type RecordVersion,
} from "@skillcdn/console/plugin";
import { configuresPlugins } from "../auth/policy.js";
import type { Secrets } from "../auth/secrets.js";
import type { Database } from "../db/client.js";
import { type Actor, type EventRecord, listEventsOfPlugin } from "../db/queries/events.js";
import type { PersonRecord } from "../db/queries/people.js";
import {
  addGrant,
  disableInstall,
  enableInstall,
  findInstall,
  findProjectBrief,
  grantedRoles,
  listGrants,
  listInstalls,
  listSecrets,
  type PluginGrantRecord,
  type PluginInstallRecord,
  purgeInstall,
  readSecret,
  recordPluginCommand,
  recordPluginFailure,
  removeGrant,
  removeSecret,
  setInstallState,
  setSecret,
  updateInstallSettings,
} from "../db/queries/plugins.js";
import { createProject, findProjectFor, type ProjectView } from "../db/queries/projects.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import type { Discovery } from "./discovery.js";
import type { ContextCall, PluginHost } from "./host.js";
import type { CallResult, PluginCall } from "./protocol.js";
import type { RecordScope, RecordStore, Visibility, Writer } from "./records.js";
import { mayUse, rolesHeld } from "./roles.js";

/** A plugin as the registry knows it at runtime: the package read, and the module loaded or not. */
interface Entry {
  readonly key: string;
  readonly packageName: string;
  readonly version: string;
  readonly dir: string | undefined;
  readonly manifest: PluginManifest | undefined;
  description: PluginDescription | undefined;
  /** Why the plugin cannot run: the package did not read, or the module did not load. */
  problems: string[];
}

export interface PluginsOptions {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  /** The host plugin code runs in; none where the deployment has no plugins directory. */
  readonly host: PluginHost | undefined;
  readonly discovery: Discovery;
  /** The memory a plugin's thread may hold, in megabytes. */
  readonly memoryMb: number;
  /** Seals the secrets; none where the deployment keeps no secret, and then no plugin secret can be set. */
  readonly secrets: Secrets | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Whether a plugin may have a schema of its own (`storage:sql`); not yet. */
  readonly sqlAvailable?: boolean | undefined;
  /** Where the plugins' records live; none, and every record is unavailable, where left out. */
  readonly records?: RecordStore | undefined;
  /** How long plugin code gets, in milliseconds; the package's bounds when left out, shorter in tests. */
  readonly timeouts?:
    | { readonly command?: number; readonly query?: number; readonly lifecycle?: number }
    | undefined;
}

/** Who asks for something administrative: the person, and how the change is attributed. */
export interface Administrator {
  readonly person: PersonRecord;
  readonly actor: Actor;
}

/** Who runs a command or a query: the person, with what, where. */
export interface Invoker {
  readonly person: PersonRecord;
  readonly actor: Actor;
  /** The agent's name, where a token acts. */
  readonly agent: string | undefined;
  /** The caller's open run in the board project, where there is one. */
  readonly run: { readonly id: string; readonly taskNumber: number | null } | undefined;
  /** The project the call is on, where it is. */
  readonly project: ProjectView | undefined;
  readonly language: string;
}

export interface Invocation {
  readonly kind: "command" | "query";
  readonly text: string;
  readonly data: unknown;
  readonly waiting: string | null;
}

const EMPTY_DISCOVERY: Discovery = { plugins: [], failed: [] };
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** The arguments as the event keeps them: a secret one as `[hidden]`. */
function hiddenArgs(
  args: Readonly<Record<string, ArgDescription>>,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      args[name]?.secret === true ? "[hidden]" : value,
    ]),
  );
}

/** The problem with a value for a setting, or nothing; secrets are set through their own route. */
export function settingProblem(setting: PluginSetting, value: unknown): string | undefined {
  const name = setting.key;
  if (value === null || value === undefined) {
    return undefined;
  }
  const fits = (type: string, candidate: unknown): string | undefined => {
    switch (type) {
      case "text":
      case "markdown":
        if (typeof candidate !== "string") {
          return `${name} is text`;
        }
        if (setting.max !== undefined && candidate.length > setting.max) {
          return `${name} is over ${setting.max} characters`;
        }
        if (setting.min !== undefined && candidate.length < setting.min) {
          return `${name} is under ${setting.min} characters`;
        }
        return type === "text" && /[\r\n]/.test(candidate) ? `${name} is one line` : undefined;
      case "number":
        if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
          return `${name} is a number`;
        }
        if (setting.min !== undefined && candidate < setting.min) {
          return `${name} is below ${setting.min}`;
        }
        return setting.max !== undefined && candidate > setting.max
          ? `${name} is above ${setting.max}`
          : undefined;
      case "boolean":
        return typeof candidate === "boolean" ? undefined : `${name} is true or false`;
      case "enum":
        return typeof candidate === "string" &&
          (setting.options ?? []).some((option) => option.value === candidate)
          ? undefined
          : `${name} is one of ${(setting.options ?? []).map((option) => option.value).join(", ")}`;
      case "day":
        return typeof candidate === "string" && DAY.test(candidate)
          ? undefined
          : `${name} is a day as YYYY-MM-DD`;
      case "person":
      case "project":
        return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 254
          ? undefined
          : `${name} is not valid`;
      default:
        return `${name} has a type the console does not know`;
    }
  };
  if (setting.type === "secret") {
    return `${name} is a secret, set with its own route`;
  }
  if (setting.type === "list") {
    if (!Array.isArray(value)) {
      return `${name} is a list`;
    }
    if (setting.max !== undefined && value.length > setting.max) {
      return `${name} has more than ${setting.max} items`;
    }
    for (const item of value) {
      const problem = fits(setting.of ?? "text", item);
      if (problem !== undefined) {
        return problem;
      }
    }
    return undefined;
  }
  return fits(setting.type, value);
}

/** Whether a version is within a range as npm spells the common ones: `*`, exact, `^`, `~`, `>=`. */
export function satisfiesRange(version: string, range: string): boolean {
  const parse = (text: string): [number, number, number] | undefined => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const compare = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const have = parse(version);
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "" || trimmed === "x" || trimmed === "latest") {
    return true;
  }
  if (have === undefined) {
    return false;
  }
  return trimmed.split(/\s*\|\|\s*/).some((alternative) =>
    alternative.split(/\s+/).every((part) => {
      const operator = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(part);
      const wanted = parse(operator?.[2] ?? "");
      if (wanted === undefined) {
        return false;
      }
      switch (operator?.[1]) {
        case "^":
          return (
            compare(have, wanted) >= 0 &&
            (wanted[0] === 0 ? have[0] === 0 && have[1] === wanted[1] : have[0] === wanted[0])
          );
        case "~":
          return compare(have, wanted) >= 0 && have[0] === wanted[0] && have[1] === wanted[1];
        case ">=":
          return compare(have, wanted) >= 0;
        case ">":
          return compare(have, wanted) > 0;
        case "<=":
          return compare(have, wanted) <= 0;
        case "<":
          return compare(have, wanted) < 0;
        default:
          return compare(have, wanted) === 0;
      }
    }),
  );
}

export class Plugins {
  private readonly options: PluginsOptions;
  private readonly entries = new Map<string, Entry>();
  private started = false;

  constructor(options: PluginsOptions) {
    this.options = options;
  }

  /** A console without plugins: nothing installed, no host, every plugin not found. */
  static none(
    database: Database,
    workspace: () => Promise<WorkspaceRecord>,
    clock: Clock,
    logger: Logger,
  ): Plugins {
    return new Plugins({
      database,
      workspace,
      host: undefined,
      discovery: EMPTY_DISCOVERY,
      memoryMb: 0,
      secrets: undefined,
      clock,
      logger,
    });
  }

  /** The handler every call on `ctx` goes through: who may, and what the console does. */
  readonly contextHandler = (call: ContextCall): Promise<unknown> => this.context(call);

  /**
   * Reads the plugins into the host and takes stock: what loaded, what failed, which installs
   * wait for consent to what a new version asks. The console serves while this runs.
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    const { discovery, host, logger } = this.options;
    for (const failed of discovery.failed) {
      this.entries.set(failed.key, {
        key: failed.key,
        packageName: failed.packageName,
        version: failed.version ?? "0.0.0",
        dir: failed.dir,
        manifest: undefined,
        description: undefined,
        problems: [...failed.problems],
      });
      logger.warn({ plugin: failed.key, problems: failed.problems }, "a plugin failed to read");
    }
    for (const plugin of discovery.plugins) {
      const entry: Entry = {
        key: plugin.key,
        packageName: plugin.packageName,
        version: plugin.version,
        dir: plugin.dir,
        manifest: plugin.manifest,
        description: undefined,
        problems: [],
      };
      this.entries.set(plugin.key, entry);
      if (host === undefined) {
        entry.problems.push("the console has no plugin host");
        continue;
      }
      const reply = await host.load({
        key: plugin.key,
        server: join(plugin.dir, plugin.manifest.server),
        version: plugin.version,
        memoryMb: this.options.memoryMb,
      });
      if (reply.ok) {
        entry.description = reply.description;
        if (reply.description.pluginApi !== plugin.manifest.pluginApi) {
          entry.problems.push(
            `the server module was built against plugin API ${reply.description.pluginApi}; the manifest says ${plugin.manifest.pluginApi}`,
          );
        }
        logger.info({ plugin: plugin.key, version: plugin.version }, "plugin loaded");
      } else {
        entry.problems.push(`the server module did not load: ${reply.error}`, ...reply.problems);
        logger.warn(
          { plugin: plugin.key, error: reply.error, problems: reply.problems },
          "a plugin failed to load",
        );
      }
    }
    // The installs: a new version that asks more than was consented to waits; a plugin that
    // failed while enabled is said so on the board.
    let workspace: WorkspaceRecord;
    try {
      workspace = await this.options.workspace();
    } catch (error) {
      logger.warn(
        { err: error },
        "the plugins' installs could not be read at start; they are read with the first request",
      );
      return;
    }
    const now = this.options.clock.now();
    for (const install of await listInstalls(this.options.database, workspace.id)) {
      const entry = this.entries.get(install.key);
      if (entry === undefined) {
        continue;
      }
      if (entry.manifest !== undefined && install.state === "enabled") {
        const unconsented = entry.manifest.capabilities.filter(
          (capability) => !install.consent.includes(capability),
        );
        if (unconsented.length > 0) {
          await setInstallState(this.options.database, {
            workspaceId: workspace.id,
            key: install.key,
            state: "needs_consent",
            now,
          });
          logger.warn(
            { plugin: install.key, capabilities: unconsented },
            "the plugin's new version asks capabilities not consented to; it waits",
          );
        }
      }
      if (entry.problems.length > 0 && install.state === "enabled") {
        await recordPluginFailure(this.options.database, {
          workspaceId: workspace.id,
          key: install.key,
          projectId: install.boardProjectId,
          problem: entry.problems.join("; "),
          now,
        });
      }
    }
  }

  async stop(): Promise<void> {
    await this.options.host?.stop();
  }

  /** Whether this console has any plugin at all. */
  get any(): boolean {
    return this.entries.size > 0;
  }

  private entryOf(key: string): Entry {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      throw new PluginRefusal("plugin.not_found", "no plugin has this key");
    }
    return entry;
  }

  private stateOf(entry: Entry, install: PluginInstallRecord | undefined): PluginState {
    if (entry.manifest === undefined || entry.description === undefined) {
      return install === undefined && entry.dir === undefined ? "orphaned" : "failed";
    }
    if (install === undefined) {
      return "installed";
    }
    return install.state;
  }

  /** The roles a person holds in a plugin, from the grants and the manifest. */
  async rolesOf(key: string, person: PersonRecord): Promise<string[]> {
    const entry = this.entries.get(key);
    if (entry?.manifest === undefined) {
      return [];
    }
    const workspace = await this.options.workspace();
    const granted = await grantedRoles(this.options.database, workspace.id, key, person);
    return rolesHeld({
      admin: configuresPlugins(person),
      declared: Object.keys(entry.manifest.roles),
      defaultRole: entry.manifest.defaultRole,
      granted,
    });
  }

  private async restOf(
    entry: Entry,
    install: PluginInstallRecord | undefined,
    person: PersonRecord,
  ): Promise<RestPlugin> {
    const workspace = await this.options.workspace();
    const admin = configuresPlugins(person);
    const manifest = entry.manifest;
    const held = manifest === undefined ? [] : await this.rolesOf(entry.key, person);
    const declared = manifest === undefined ? [] : Object.keys(manifest.roles);
    const board =
      install?.boardProjectId === undefined
        ? undefined
        : await findProjectBrief(this.options.database, workspace.id, install.boardProjectId);
    return {
      key: entry.key,
      name: manifest?.name ?? { en: entry.key },
      description: manifest?.description ?? { en: "" },
      agentNote: manifest?.agentNote ?? null,
      version: entry.version,
      state: this.stateOf(entry, install),
      problems: [...entry.problems],
      roles: held,
      declaredRoles: Object.entries(manifest?.roles ?? {}).map(([key, role]) => ({
        key,
        name: role.name,
        description: role.description,
      })),
      menu:
        manifest?.menu === undefined
          ? null
          : {
              group: manifest.menu.group,
              order: manifest.menu.order ?? 100,
              name: manifest.menu.name ?? null,
            },
      pages: (manifest?.pages ?? [])
        .filter((page) => mayUse(page.roles ?? null, held, declared))
        .map((page) => ({
          key: page.key,
          name: page.name,
          level: page.level,
          wide: page.wide ?? false,
        })),
      widgets: (manifest?.widgets ?? [])
        .filter((widget) => mayUse(widget.roles ?? null, held, declared))
        .map((widget) => ({
          key: widget.key,
          name: widget.name,
          place: widget.place,
          size: widget.size,
        })),
      board: board === undefined ? null : { key: board.key, name: board.name },
      boardNeeds: manifest?.board.needs ?? "none",
      capabilities: [...(manifest?.capabilities ?? [])],
      consent: admin ? [...(install?.consent ?? [])] : null,
      projects: admin
        ? install?.projects === "all"
          ? "all"
          : [...(install?.projects ?? [])]
        : null,
      requires: { ...(manifest?.requires ?? {}) },
      dataVersion: install?.dataVersion ?? manifest?.dataVersion ?? 1,
      enabledAt: install?.enabledAt?.toISOString() ?? null,
    };
  }

  /** The plugins a member may know of: every one for an administrator, the enabled ones for a member. */
  async list(person: PersonRecord): Promise<RestPlugins> {
    const workspace = await this.options.workspace();
    const installs = new Map(
      (await listInstalls(this.options.database, workspace.id)).map((install) => [
        install.key,
        install,
      ]),
    );
    const admin = configuresPlugins(person);
    const items: RestPlugin[] = [];
    for (const entry of [...this.entries.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      const install = installs.get(entry.key);
      if (!admin && install?.state !== "enabled") {
        continue;
      }
      items.push(await this.restOf(entry, install, person));
    }
    return { items, sql: this.options.sqlAvailable === true };
  }

  private operationsOf(description: PluginDescription | undefined): RestPluginOperation[] {
    if (description === undefined) {
      return [];
    }
    const of = (kind: "command" | "query", operations: PluginDescription["commands"]) =>
      Object.entries(operations).map(([name, operation]) => ({
        name,
        kind,
        about: operation.about,
        args: { ...operation.args },
        roles: operation.roles === null ? null : [...operation.roles],
      }));
    return [...of("command", description.commands), ...of("query", description.queries)];
  }

  private async settingsOf(
    entry: Entry,
    install: PluginInstallRecord | undefined,
    admin: boolean,
  ): Promise<RestPluginSetting[]> {
    const manifest = entry.manifest;
    if (manifest === undefined) {
      return [];
    }
    const workspace = await this.options.workspace();
    const secrets = new Map(
      (await listSecrets(this.options.database, workspace.id, entry.key)).map((secret) => [
        secret.name,
        secret.setAt,
      ]),
    );
    return manifest.settings.map((setting) => {
      const value = install?.settings[setting.key];
      const secret = setting.type === "secret";
      const setAt = secrets.get(setting.key);
      return {
        key: setting.key,
        type: setting.type,
        name: setting.name,
        description: setting.description ?? null,
        required: setting.required ?? false,
        default: setting.default ?? null,
        min: setting.min ?? null,
        max: setting.max ?? null,
        options: setting.options ?? null,
        of: setting.of ?? null,
        set: secret ? setAt !== undefined : value !== undefined && value !== null,
        value: secret || !admin ? null : (value ?? null),
        setAt: setAt?.toISOString() ?? null,
      };
    });
  }

  private restGrant(grant: PluginGrantRecord): RestPluginGrant {
    return {
      id: grant.id,
      role: grant.role,
      person:
        grant.person === undefined
          ? null
          : { id: grant.person.id, login: grant.person.login, name: grant.person.name ?? null },
      project:
        grant.project === undefined ? null : { key: grant.project.key, name: grant.project.name },
      everyone: grant.everyone,
      createdAt: grant.createdAt.toISOString(),
    };
  }

  /** One plugin whole, or none for a key no plugin has, or one a member may not know of. */
  async get(key: string, person: PersonRecord): Promise<RestPluginDetail | undefined> {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    const admin = configuresPlugins(person);
    if (!admin && install?.state !== "enabled") {
      return undefined;
    }
    const listing = await this.restOf(entry, install, person);
    return {
      ...listing,
      operations: this.operationsOf(entry.description).filter((operation) =>
        admin
          ? true
          : mayUse(
              operation.roles,
              listing.roles,
              listing.declaredRoles.map((role) => role.key),
            ),
      ),
      skills: entry.manifest?.skills === undefined ? null : `/api/v1/plugins/${key}/skills`,
      settings: await this.settingsOf(entry, install, admin),
      grants: admin
        ? (await listGrants(this.options.database, workspace.id, key)).map((grant) =>
            this.restGrant(grant),
          )
        : null,
      events: `/api/v1/plugins/${key}/events`,
    };
  }

  /** The plugin, able to run: read, loaded, and with the key given. */
  private runnable(
    key: string,
  ): Entry & { manifest: PluginManifest; description: PluginDescription } {
    const entry = this.entryOf(key);
    if (entry.manifest === undefined || entry.description === undefined) {
      throw new PluginRefusal(
        "plugin.unavailable",
        `the plugin cannot run: ${entry.problems.join("; ")}`,
      );
    }
    return entry as Entry & { manifest: PluginManifest; description: PluginDescription };
  }

  /** The settings as they stand after `values`, checked against the manifest; `null` clears one. */
  private mergedSettings(
    manifest: PluginManifest,
    current: Readonly<Record<string, unknown>>,
    values: Readonly<Record<string, unknown>>,
  ): { settings: Record<string, unknown>; fields: string[] } {
    const settings: Record<string, unknown> = { ...current };
    const fields: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      const setting = manifest.settings.find((candidate) => candidate.key === key);
      if (setting === undefined) {
        throw new PluginRefusal("plugin.invalid_args", `${key} is not a setting of the plugin`);
      }
      const problem = settingProblem(setting, value);
      if (problem !== undefined) {
        throw new PluginRefusal("plugin.invalid_args", problem);
      }
      if (value === null || value === undefined) {
        delete settings[key];
      } else {
        settings[key] = value;
      }
      fields.push(key);
    }
    return { settings, fields };
  }

  /** What a required setting that is not set, nor defaulted, is called; nothing when all are there. */
  private async missingRequired(
    entry: Entry & { manifest: PluginManifest },
    settings: Readonly<Record<string, unknown>>,
  ): Promise<string | undefined> {
    const workspace = await this.options.workspace();
    const secrets = new Set(
      (await listSecrets(this.options.database, workspace.id, entry.key)).map(
        (secret) => secret.name,
      ),
    );
    for (const setting of entry.manifest.settings) {
      if (setting.required !== true) {
        continue;
      }
      if (
        setting.type === "secret"
          ? !secrets.has(setting.key)
          : settings[setting.key] === undefined && setting.default === undefined
      ) {
        return setting.key;
      }
    }
    return undefined;
  }

  private consoleCaller(entry: Entry & { manifest: PluginManifest }): PluginCaller {
    return { kind: "console", roles: Object.keys(entry.manifest.roles), project: null };
  }

  private async infoOf(entry: Entry, install: PluginInstallRecord): Promise<PluginInfo> {
    const workspace = await this.options.workspace();
    const board =
      install.boardProjectId === undefined
        ? undefined
        : await findProjectBrief(this.options.database, workspace.id, install.boardProjectId);
    const settings: Record<string, unknown> = {};
    for (const setting of entry.manifest?.settings ?? []) {
      if (setting.type === "secret") {
        continue;
      }
      const value = install.settings[setting.key] ?? setting.default;
      if (value !== undefined) {
        settings[setting.key] = value;
      }
    }
    return {
      key: entry.key,
      version: entry.version,
      dataVersion: install.dataVersion,
      settings,
      board: board === undefined ? null : { id: board.id, key: board.key },
      projects: install.projects === "all" ? "all" : [...install.projects],
    };
  }

  private host(): PluginHost {
    const host = this.options.host;
    if (host === undefined) {
      throw new PluginRefusal("plugin.unavailable", "the console has no plugin host");
    }
    return host;
  }

  /** Enables a plugin: consent, the board, the projects, the settings, then `onEnable`. An administrator's. */
  async enable(
    key: string,
    input: RestPluginEnableInput,
    by: Administrator,
  ): Promise<RestPluginDetail> {
    const entry = this.runnable(key);
    const { manifest } = entry;
    const workspace = await this.options.workspace();
    const database = this.options.database;
    const now = this.options.clock.now();
    const missing = manifest.capabilities.filter(
      (capability) => !input.consent.includes(capability),
    );
    if (missing.length > 0) {
      throw new PluginRefusal(
        "plugin.needs_consent",
        `consent names every capability the plugin asks; missing: ${missing.join(", ")}`,
      );
    }
    const unknown = input.consent.filter(
      (capability) => !manifest.capabilities.includes(capability),
    );
    if (unknown.length > 0) {
      throw new PluginRefusal(
        "plugin.invalid_args",
        `consent names ${unknown.join(", ")}, which the plugin does not ask`,
      );
    }
    if (manifest.capabilities.includes("storage:sql") && this.options.sqlAvailable !== true) {
      throw new PluginRefusal(
        "plugin.unavailable",
        "storage:sql is not available in this deployment",
      );
    }
    for (const [required, range] of Object.entries(manifest.requires)) {
      const other = this.entries.get(required);
      const install = await findInstall(database, workspace.id, required);
      if (other === undefined || install?.state !== "enabled") {
        throw new PluginRefusal(
          "plugin.requires",
          `the plugin requires ${required}, which is not enabled`,
        );
      }
      if (!satisfiesRange(other.version, range)) {
        throw new PluginRefusal(
          "plugin.requires",
          `the plugin requires ${required} ${range}; ${other.version} is installed`,
        );
      }
    }
    let boardProjectId: string | undefined;
    if (manifest.board.needs === "none") {
      if (input.board !== null) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          "the plugin puts nothing on a board; board is null",
        );
      }
    } else if (input.board === null) {
      if (manifest.board.needs === "required") {
        throw new PluginRefusal(
          "plugin.invalid_args",
          "the plugin needs a board project: one to make, or one that exists",
        );
      }
    } else if ("create" in input.board) {
      const project = await createProject(database, {
        workspaceId: workspace.id,
        actor: by.actor,
        person: by.person,
        project: { ...input.board.create, visibility: "private" },
        now,
      });
      boardProjectId = project.id;
    } else {
      const project = await findProjectFor(database, workspace.id, input.board.project, by.person);
      if (project === undefined) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          `the project ${input.board.project} was not found`,
        );
      }
      boardProjectId = project.id;
    }
    if (input.projects !== "all") {
      for (const projectKey of input.projects) {
        if ((await findProjectFor(database, workspace.id, projectKey, by.person)) === undefined) {
          throw new PluginRefusal("plugin.invalid_args", `the project ${projectKey} was not found`);
        }
      }
    }
    const current = await findInstall(database, workspace.id, key);
    const { settings } = this.mergedSettings(
      manifest,
      current?.settings ?? {},
      input.settings ?? {},
    );
    const required = await this.missingRequired(entry, settings);
    if (required !== undefined) {
      throw new PluginRefusal("plugin.invalid_args", `the setting ${required} is required`);
    }
    const install = await enableInstall(database, {
      workspaceId: workspace.id,
      key,
      packageName: entry.packageName,
      version: entry.version,
      dataVersion: current?.dataVersion ?? manifest.dataVersion,
      consent: input.consent,
      boardProjectId,
      projects: input.projects,
      settings,
      name: manifest.name.en ?? key,
      actor: by.actor,
      now,
    });
    if (entry.description.onEnable) {
      const result = await this.host().call(key, {
        kind: "enable",
        payload: null,
        info: await this.infoOf(entry, install),
        caller: this.consoleCaller(entry),
        language: "en",
        timeoutMs: this.options.timeouts?.lifecycle ?? PLUGIN_LIFECYCLE_MS,
      });
      if (!result.ok) {
        await disableInstall(database, {
          workspaceId: workspace.id,
          key,
          actor: by.actor,
          now: this.options.clock.now(),
        });
        throw new PluginRefusal(
          result.error.code,
          `the plugin could not be enabled: ${result.error.message}`,
        );
      }
    }
    this.options.logger.info({ person: by.person.id, plugin: key }, "plugin enabled");
    const detail = await this.get(key, by.person);
    if (detail === undefined) {
      throw new Error("the plugin vanished while being enabled");
    }
    return detail;
  }

  /** Disables a plugin: `onDisable` runs, then nothing of it does; its data stays. An administrator's. */
  async disable(key: string, by: Administrator): Promise<RestPluginDetail> {
    const entry = this.entryOf(key);
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    if (install === undefined || install.state === "disabled") {
      throw new PluginRefusal("plugin.disabled", "the plugin is not enabled");
    }
    for (const [required, other] of this.entries) {
      if (required !== key && other.manifest !== undefined && key in other.manifest.requires) {
        const dependent = await findInstall(this.options.database, workspace.id, required);
        if (dependent?.state === "enabled") {
          throw new PluginRefusal(
            "plugin.required_by",
            `the plugin ${required} requires this one; disable it first`,
          );
        }
      }
    }
    if (
      entry.description?.onDisable &&
      this.options.host !== undefined &&
      install.state === "enabled"
    ) {
      const result = await this.options.host.call(key, {
        kind: "disable",
        payload: null,
        info: await this.infoOf(entry, install),
        caller: this.consoleCaller(entry as Entry & { manifest: PluginManifest }),
        language: "en",
        timeoutMs: this.options.timeouts?.lifecycle ?? PLUGIN_LIFECYCLE_MS,
      });
      if (!result.ok) {
        this.options.logger.warn(
          { plugin: key, code: result.error.code },
          "onDisable failed; the plugin is disabled all the same",
        );
      }
    }
    await disableInstall(this.options.database, {
      workspaceId: workspace.id,
      key,
      actor: by.actor,
      now: this.options.clock.now(),
    });
    this.options.logger.info({ person: by.person.id, plugin: key }, "plugin disabled");
    const detail = await this.get(key, by.person);
    if (detail === undefined) {
      throw new Error("the plugin vanished while being disabled");
    }
    return detail;
  }

  /** Changes the settings an administrator may set; `null` clears one. */
  async updateSettings(
    key: string,
    values: Readonly<Record<string, unknown>>,
    by: Administrator,
  ): Promise<RestPluginDetail> {
    const entry = this.entryOf(key);
    if (entry.manifest === undefined) {
      throw new PluginRefusal(
        "plugin.unavailable",
        `the plugin cannot be configured: ${entry.problems.join("; ")}`,
      );
    }
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    if (install === undefined) {
      throw new PluginRefusal(
        "plugin.disabled",
        "the plugin has not been enabled yet; enable it with its settings",
      );
    }
    const { settings, fields } = this.mergedSettings(entry.manifest, install.settings, values);
    if (fields.length > 0) {
      await updateInstallSettings(this.options.database, {
        workspaceId: workspace.id,
        key,
        settings,
        fields,
        actor: by.actor,
        now: this.options.clock.now(),
      });
    }
    const detail = await this.get(key, by.person);
    if (detail === undefined) {
      throw new Error("the plugin vanished while being configured");
    }
    return detail;
  }

  private secretSetting(entry: Entry, name: string): PluginSetting {
    const setting = entry.manifest?.settings.find((candidate) => candidate.key === name);
    if (setting === undefined || setting.type !== "secret") {
      throw new PluginRefusal(
        "plugin.invalid_args",
        `${name} is not a secret setting of the plugin`,
      );
    }
    return setting;
  }

  /** Seals a secret for the plugin; its value is never read back by any route. */
  async setSecret(key: string, name: string, value: string, by: Administrator): Promise<void> {
    const entry = this.entryOf(key);
    this.secretSetting(entry, name);
    const secrets = this.options.secrets;
    if (secrets === undefined) {
      throw new PluginRefusal(
        "plugin.unavailable",
        "this deployment keeps no secret to seal with (AUTH_SECRET)",
      );
    }
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    await setSecret(this.options.database, {
      workspaceId: workspace.id,
      key,
      name,
      sealed: secrets.seal("plugin-secret", value),
      actor: by.actor,
      now: this.options.clock.now(),
      boardProjectId: install?.boardProjectId,
    });
  }

  async removeSecret(key: string, name: string, by: Administrator): Promise<void> {
    const entry = this.entryOf(key);
    this.secretSetting(entry, name);
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    const removed = await removeSecret(this.options.database, {
      workspaceId: workspace.id,
      key,
      name,
      actor: by.actor,
      now: this.options.clock.now(),
      boardProjectId: install?.boardProjectId,
    });
    if (!removed) {
      throw new PluginRefusal("plugin.not_found", `the secret ${name} is not set`);
    }
  }

  async grants(key: string): Promise<RestPluginGrant[]> {
    this.entryOf(key);
    const workspace = await this.options.workspace();
    return (await listGrants(this.options.database, workspace.id, key)).map((grant) =>
      this.restGrant(grant),
    );
  }

  /** Grants a role of the plugin to a person, to a project's members, or to everyone. */
  async grant(
    key: string,
    input: {
      readonly role: string;
      readonly person?: string | undefined;
      readonly project?: string | undefined;
      readonly everyone?: boolean | undefined;
    },
    by: Administrator,
  ): Promise<RestPluginGrant> {
    const entry = this.entryOf(key);
    if (entry.manifest === undefined || !(input.role in entry.manifest.roles)) {
      throw new PluginRefusal("plugin.invalid_args", `${input.role} is not a role of the plugin`);
    }
    const workspace = await this.options.workspace();
    let projectId: string | undefined;
    if (input.project !== undefined) {
      const project = await findProjectFor(
        this.options.database,
        workspace.id,
        input.project,
        by.person,
      );
      if (project === undefined) {
        throw new PluginRefusal(
          "plugin.invalid_args",
          `the project ${input.project} was not found`,
        );
      }
      projectId = project.id;
    }
    const install = await findInstall(this.options.database, workspace.id, key);
    const grant = await addGrant(this.options.database, {
      workspaceId: workspace.id,
      key,
      role: input.role,
      personId: input.person,
      projectId,
      everyone: input.everyone === true,
      actor: by.actor,
      now: this.options.clock.now(),
      boardProjectId: install?.boardProjectId,
    });
    return this.restGrant(grant);
  }

  async revoke(key: string, grantId: string, by: Administrator): Promise<RestPluginGrant> {
    this.entryOf(key);
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    const grant = await removeGrant(this.options.database, {
      workspaceId: workspace.id,
      key,
      grantId,
      actor: by.actor,
      now: this.options.clock.now(),
      boardProjectId: install?.boardProjectId,
    });
    return this.restGrant(grant);
  }

  /** The plugin's events, newest first. */
  async events(
    key: string,
    page: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: EventRecord[]; readonly more: boolean }> {
    this.entryOf(key);
    const workspace = await this.options.workspace();
    return listEventsOfPlugin(this.options.database, workspace.id, key, page);
  }

  /**
   * Runs a command or a query as a person: the plugin enabled, the person in a role it names,
   * the arguments as the definition has them; a command leaves its event however it ends.
   */
  async invoke(
    key: string,
    kind: "command" | "query",
    name: string,
    args: Readonly<Record<string, unknown>>,
    by: Invoker,
  ): Promise<Invocation> {
    const entry = this.runnable(key);
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    if (install?.state !== "enabled") {
      throw new PluginRefusal(
        "plugin.disabled",
        install === undefined
          ? "the plugin is not enabled"
          : `the plugin is ${install.state.replace("_", " ")}`,
      );
    }
    const operation = (kind === "command" ? entry.description.commands : entry.description.queries)[
      name
    ];
    if (operation === undefined) {
      throw new PluginRefusal("plugin.not_found", `the plugin has no ${kind} ${name}`);
    }
    const held = await this.rolesOf(key, by.person);
    if (!mayUse(operation.roles, held, Object.keys(entry.manifest.roles))) {
      throw new PluginRefusal(
        "plugin.forbidden",
        `the ${kind} ${name} needs a role you do not hold in the plugin`,
      );
    }
    const problem = argsProblem(operation.args, args);
    if (problem !== undefined) {
      throw new PluginRefusal("plugin.invalid_args", problem);
    }
    const info = await this.infoOf(entry, install);
    const caller: PluginCaller = {
      kind: "person",
      person: {
        id: by.person.id,
        login: by.person.login,
        name: by.person.name ?? null,
        language: by.language,
        admin: configuresPlugins(by.person),
      },
      agent: by.agent ?? null,
      roles: held,
      run: by.run ?? null,
      project:
        by.project === undefined
          ? null
          : { id: by.project.id, key: by.project.key, name: by.project.name },
    };
    const call: PluginCall = {
      kind,
      name,
      payload: args,
      info,
      caller,
      language: by.language,
      timeoutMs:
        kind === "command"
          ? (this.options.timeouts?.command ?? PLUGIN_COMMAND_MS)
          : (this.options.timeouts?.query ?? PLUGIN_QUERY_MS),
    };
    const startedAt = performance.now();
    const result = await this.host().call(key, call);
    const durationMs = performance.now() - startedAt;
    const outcome = this.outcomeOf(result);
    this.options.logger.info(
      {
        plugin: key,
        kind,
        name,
        person: by.person.id,
        agent: by.agent,
        outcome,
        code: result.ok ? undefined : result.error.code,
        durationMs: Math.round(durationMs),
      },
      "plugin call",
    );
    if (kind === "command") {
      await recordPluginCommand(this.options.database, {
        workspaceId: workspace.id,
        key,
        projectId: install.boardProjectId,
        actor: by.actor,
        runId: by.run?.id,
        command: name,
        outcome,
        code: result.ok ? undefined : result.error.code,
        durationMs,
        args: hiddenArgs(operation.args, args),
        now: this.options.clock.now(),
      });
    }
    if (!result.ok) {
      throw new PluginRefusal(result.error.code, result.error.message, result.error.data);
    }
    if (kind === "query") {
      return { kind, text: "", data: result.value, waiting: null };
    }
    const value = (result.value ?? {}) as { text?: unknown; data?: unknown; waiting?: unknown };
    return {
      kind,
      text: typeof value.text === "string" ? value.text : "",
      data: value.data ?? null,
      waiting: typeof value.waiting === "string" ? value.waiting : null,
    };
  }

  private outcomeOf(result: CallResult): "ok" | "refused" | "waiting" | "failed" {
    if (result.ok) {
      const waiting = (result.value as { waiting?: unknown } | null)?.waiting;
      return typeof waiting === "string" ? "waiting" : "ok";
    }
    return result.error.code === "plugin.failed" ||
      result.error.code === "plugin.timeout" ||
      result.error.code === "plugin.unavailable"
      ? "failed"
      : "refused";
  }

  /** Decides and performs a call on `ctx`: by the capabilities consented to, then by what is built. */
  private async context(call: ContextCall): Promise<unknown> {
    const entry = this.entries.get(call.plugin);
    if (entry?.manifest === undefined) {
      throw new PluginRefusal("plugin.unavailable", "the plugin is not available");
    }
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, call.plugin);
    const consent = install?.consent ?? [];
    const needs = (capability: string) => {
      if (!consent.includes(capability)) {
        throw new PluginRefusal(
          "plugin.forbidden",
          `the plugin has not been given the capability ${capability}`,
        );
      }
    };
    const notYet = (what: string): never => {
      throw new PluginRefusal("plugin.unavailable", `${what} is not available in this console yet`);
    };
    const { member, method, args } = call;
    switch (member) {
      case "secrets":
        return this.secretCall(call.plugin, workspace.id, method, args);
      case "records":
        return this.recordCall(entry, install, call);
      case "events": {
        // A plugin's own events are not kept yet; what it emits is taken, and dropped, so that a
        // plugin that emits runs on. The log says so once per call.
        this.options.logger.debug(
          { plugin: call.plugin, kind: typeof args[0] === "string" ? args[0] : undefined },
          "a plugin emitted an event; events are not kept yet",
        );
        return null;
      }
      case "sql":
        needs("storage:sql");
        return notYet("SQL");
      case "fetch": {
        const url = typeof args[0] === "string" ? args[0] : "";
        let host: string;
        try {
          host = new URL(url).hostname;
        } catch {
          throw new PluginRefusal("plugin.invalid_args", "fetch takes a URL");
        }
        if (!consent.some((capability) => outboundAllows(capability, host))) {
          throw new PluginRefusal(
            "plugin.forbidden",
            `the plugin has no capability outbound:${host}`,
          );
        }
        return notYet("outbound requests");
      }
      case "plugins": {
        const other = typeof args[0] === "string" ? args[0] : "";
        needs(`plugins:${other}`);
        return notYet("calls between plugins");
      }
      case "console.workspace":
        return notYet("the workspace");
      case "console.people":
        needs("people:read");
        return notYet("the people");
      case "console.projects":
        needs("projects:read");
        return notYet("the projects");
      case "console.tasks":
        needs(method === "list" || method === "get" ? "board:read" : "board:tasks");
        return notYet("the board");
      case "console.decisions":
        needs(method === "ask" ? "board:decisions" : "board:read");
        return notYet("the board");
      case "console.documents":
        needs(method === "write" ? "board:documents" : "board:read");
        return notYet("the board");
      case "console.runs":
        needs("board:read");
        return notYet("the board");
      default:
        throw new PluginRefusal("plugin.invalid_args", `${member}.${method} is not a call on ctx`);
    }
  }

  private store(): RecordStore {
    const store = this.options.records;
    if (store === undefined) {
      throw new PluginRefusal("plugin.unavailable", "this console keeps no records for plugins");
    }
    return store;
  }

  private collectionOf(entry: Entry, name: unknown): CollectionDescription {
    const found =
      typeof name === "string"
        ? entry.description?.collections.find((candidate) => candidate.name === name)
        : undefined;
    if (found === undefined) {
      throw new PluginRefusal(
        "plugin.not_found",
        `the plugin defines no collection ${String(name)}`,
      );
    }
    return found;
  }

  /** A plugin's own call on its records: the collection named first, then what the method takes. */
  private async recordCall(
    entry: Entry,
    install: PluginInstallRecord | undefined,
    call: ContextCall,
  ): Promise<unknown> {
    const store = this.store();
    const workspace = await this.options.workspace();
    const [name, ...rest] = call.args;
    const collection = this.collectionOf(entry, name);
    const scope: RecordScope = { workspaceId: workspace.id, plugin: entry.key, collection };
    const caller = call.call.caller;
    const writer: Writer =
      caller.kind === "person"
        ? { personId: caller.person.id, agent: caller.agent ?? undefined }
        : { personId: undefined, agent: undefined };
    const text = (value: unknown, what: string): string => {
      if (typeof value !== "string") {
        throw new PluginRefusal("plugin.invalid_args", `${what} is text`);
      }
      return value;
    };
    const object = (value: unknown): Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const files = () => {
      if (!(install?.consent ?? []).includes("files")) {
        throw new PluginRefusal(
          "plugin.forbidden",
          "the plugin has not been given the capability files",
        );
      }
    };
    switch (call.method) {
      case "create":
        return store.create(
          scope,
          object(rest[0]),
          object(rest[1]) as { project?: string; owner?: string },
          writer,
        );
      case "get":
        return (await store.get(scope, text(rest[0], "id"))) ?? null;
      case "update": {
        const id = text(rest[0], "id");
        const options = object(rest[2]) as { baseVersion?: number };
        const current = await store.get(scope, id);
        if (current === undefined) {
          throw new PluginRefusal("plugin.not_found", `${collection.name}: no record ${id}`);
        }
        if (options.baseVersion !== undefined && options.baseVersion !== current.version) {
          throw new PluginRefusal(
            "plugin.conflict",
            `${collection.name}: the record is at version ${current.version}, not ${options.baseVersion}`,
          );
        }
        // The merged record goes back to the plugin's thread to be checked against the schema.
        const checked = await this.host().call(entry.key, {
          kind: "validate",
          name: collection.name,
          payload: { collection: collection.name, data: { ...current.data, ...object(rest[1]) } },
          info: call.call.info,
          caller,
          language: call.call.language,
          timeoutMs: this.options.timeouts?.query ?? PLUGIN_QUERY_MS,
        });
        if (!checked.ok) {
          throw new PluginRefusal(checked.error.code, checked.error.message, checked.error.data);
        }
        return store.update(
          scope,
          id,
          object(checked.value),
          { baseVersion: current.version },
          writer,
        );
      }
      case "archive":
        await store.archive(scope, text(rest[0], "id"));
        return null;
      case "restore":
        await store.restore(scope, text(rest[0], "id"));
        return null;
      case "list":
        return store.list(scope, object(rest[0]) as RecordQuery);
      case "search":
        return store.search(
          scope,
          text(rest[0], "words"),
          object(rest[1]) as Pick<RecordQuery, "where" | "limit" | "project">,
        );
      case "aggregate":
        return store.aggregate(scope, object(rest[0]) as RecordAggregation);
      case "versions":
        return store.versions(scope, text(rest[0], "id"));
      case "link":
        await store.link(scope, text(rest[0], "id"), rest[1] as LinkTarget);
        return null;
      case "unlink":
        await store.unlink(scope, text(rest[0], "id"), rest[1] as LinkTarget);
        return null;
      case "links":
        return store.links(scope, text(rest[0], "id"));
      case "files.attach":
        files();
        return store.attachFile(
          scope,
          text(rest[0], "id"),
          rest[1] as PluginFileHandle | string,
          object(rest[2]) as { name?: string; type?: string },
          writer,
        );
      case "files.list":
        files();
        return store.listFiles(scope, text(rest[0], "id"));
      case "files.remove":
        files();
        await store.removeFile(scope, text(rest[0], "id"), text(rest[1], "fileId"));
        return null;
      default:
        throw new PluginRefusal("plugin.invalid_args", `records.${call.method} is not a call`);
    }
  }

  /** The plugin, enabled, as a person's read of its records needs it. */
  private async enabledFor(
    key: string,
    person: PersonRecord,
  ): Promise<{
    entry: Entry & { manifest: PluginManifest; description: PluginDescription };
    install: PluginInstallRecord;
  }> {
    const entry = this.runnable(key);
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    if (install?.state !== "enabled") {
      if (configuresPlugins(person)) {
        throw new PluginRefusal("plugin.disabled", "the plugin is not enabled");
      }
      throw new PluginRefusal("plugin.not_found", "no plugin has this key");
    }
    return { entry, install };
  }

  /**
   * What a person may read of a collection through the console's routes: everything, with a
   * `read` role or as an administrator; their own records, with a `readOwn` role; else nothing.
   * Within the projects they may see, always.
   */
  private async visibilityOf(
    entry: Entry & { manifest: PluginManifest },
    collection: CollectionDescription,
    person: PersonRecord,
  ): Promise<Visibility> {
    if (configuresPlugins(person)) {
      return {};
    }
    const held = await this.rolesOf(entry.key, person);
    if (collection.read.some((role) => held.includes(role))) {
      return { person };
    }
    if (collection.readOwn.some((role) => held.includes(role))) {
      return { ownOnly: person.id, person };
    }
    throw new PluginRefusal(
      "plugin.forbidden",
      `reading ${collection.name} needs a role you do not hold in the plugin`,
    );
  }

  /** A page of a collection, as a person may read it. */
  async readRecords(
    key: string,
    collectionName: string,
    query: RecordQuery & { readonly q?: string | undefined },
    person: PersonRecord,
  ): Promise<RecordPage<Record<string, unknown>>> {
    const { entry } = await this.enabledFor(key, person);
    const collection = this.collectionOf(entry, collectionName);
    const visibility = await this.visibilityOf(entry, collection, person);
    const workspace = await this.options.workspace();
    const scope: RecordScope = { workspaceId: workspace.id, plugin: key, collection };
    if (query.q !== undefined) {
      return this.store().search(scope, query.q, query, visibility);
    }
    return this.store().list(scope, query, visibility);
  }

  /** One record, or one version of it, as a person may read it; none when there is none they may. */
  async readRecord(
    key: string,
    collectionName: string,
    id: string,
    version: number | undefined,
    person: PersonRecord,
  ): Promise<PluginRecord | RecordVersion | undefined> {
    const { entry } = await this.enabledFor(key, person);
    const collection = this.collectionOf(entry, collectionName);
    const visibility = await this.visibilityOf(entry, collection, person);
    const workspace = await this.options.workspace();
    const scope: RecordScope = { workspaceId: workspace.id, plugin: key, collection };
    return version === undefined
      ? this.store().get(scope, id, visibility)
      : this.store().version(scope, id, version, visibility);
  }

  async readVersions(
    key: string,
    collectionName: string,
    id: string,
    person: PersonRecord,
  ): Promise<RecordVersion[]> {
    const { entry } = await this.enabledFor(key, person);
    const collection = this.collectionOf(entry, collectionName);
    const visibility = await this.visibilityOf(entry, collection, person);
    const workspace = await this.options.workspace();
    return this.store().versions(
      { workspaceId: workspace.id, plugin: key, collection },
      id,
      visibility,
    );
  }

  /** Keeps a file a person uploads for a command of the plugin, and answers its handle. */
  async upload(
    key: string,
    person: PersonRecord,
    bytes: Uint8Array,
    name: string,
    contentType: string,
  ): Promise<PluginFileHandle> {
    const { entry, install } = await this.enabledFor(key, person);
    if (!install.consent.includes("files")) {
      throw new PluginRefusal(
        "plugin.forbidden",
        "the plugin has not been given the capability files",
      );
    }
    const held = await this.rolesOf(key, person);
    if (!mayUse(null, held, Object.keys(entry.manifest.roles))) {
      throw new PluginRefusal(
        "plugin.forbidden",
        "uploading a file for the plugin needs a role in it",
      );
    }
    const workspace = await this.options.workspace();
    return this.store().upload(workspace.id, key, person.id, bytes, name, contentType);
  }

  /** A file on a record, read under the record's rule: its bytes, name and type, or none. */
  async fileFor(
    key: string,
    fileId: string,
    person: PersonRecord,
  ): Promise<
    { readonly name: string; readonly contentType: string; readonly bytes: Uint8Array } | undefined
  > {
    const { entry } = await this.enabledFor(key, person);
    const workspace = await this.options.workspace();
    const file = await this.store().fileOf(workspace.id, key, fileId);
    if (file === undefined) {
      return undefined;
    }
    const collection = this.collectionOf(entry, file.collection);
    const visibility = await this.visibilityOf(entry, collection, person);
    const record = await this.store().get(
      { workspaceId: workspace.id, plugin: key, collection },
      file.recordId,
      visibility,
    );
    if (record === undefined) {
      return undefined;
    }
    const bytes = await this.store().bytesOf(file.sha256);
    return bytes === undefined
      ? undefined
      : { name: file.name, contentType: file.contentType, bytes };
  }

  /** Everything the console keeps of the plugin, as JSON Lines: the install, the grants, then the records. An administrator's. */
  async *exportLines(key: string): AsyncGenerator<string> {
    this.entryOf(key);
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    if (install !== undefined) {
      yield `${JSON.stringify({ type: "install", key, version: install.version, dataVersion: install.dataVersion, state: install.state, consent: install.consent, projects: install.projects, settings: install.settings, enabledAt: install.enabledAt?.toISOString() ?? null })}\n`;
    }
    for (const grant of await listGrants(this.options.database, workspace.id, key)) {
      yield `${JSON.stringify({ type: "grant", ...this.restGrant(grant) })}\n`;
    }
    if (this.options.records !== undefined) {
      yield* this.options.records.exportLines(workspace.id, key);
    }
  }

  /**
   * Removes everything the console keeps of the plugin: its records with their versions, files
   * and links, its uploads, its grants, its secrets and its install. The plugin must be disabled,
   * and the key named again. What it put on the board stays, marked.
   */
  async purge(key: string, confirm: string, by: Administrator): Promise<void> {
    this.entryOf(key);
    if (confirm !== key) {
      throw new PluginRefusal("plugin.invalid_args", "confirm names the plugin's key again");
    }
    const workspace = await this.options.workspace();
    const install = await findInstall(this.options.database, workspace.id, key);
    if (install?.state === "enabled") {
      throw new PluginRefusal("plugin.conflict", "the plugin is enabled; disable it first");
    }
    const removed = await this.options.records?.purge(workspace.id, key);
    await purgeInstall(this.options.database, {
      workspaceId: workspace.id,
      key,
      boardProjectId: install?.boardProjectId,
      actor: by.actor,
      now: this.options.clock.now(),
    });
    this.options.logger.info({ person: by.person.id, plugin: key, ...removed }, "plugin purged");
  }

  private async secretCall(
    key: string,
    workspaceId: string,
    method: string,
    args: readonly unknown[],
  ): Promise<unknown> {
    const name = typeof args[0] === "string" ? args[0] : "";
    const sealed = await readSecret(this.options.database, workspaceId, key, name);
    if (method === "has") {
      return sealed !== undefined;
    }
    if (method !== "sign" && method !== "verify") {
      throw new PluginRefusal("plugin.invalid_args", `secrets.${method} is not a call`);
    }
    const algorithm = args[method === "sign" ? 2 : 3];
    if (algorithm !== "hmac-sha256") {
      throw new PluginRefusal("plugin.invalid_args", "the algorithm is hmac-sha256");
    }
    const secrets = this.options.secrets;
    const value =
      sealed === undefined || secrets === undefined
        ? undefined
        : secrets.open("plugin-secret", sealed);
    if (value === undefined) {
      if (method === "verify") {
        return false;
      }
      throw new PluginRefusal("plugin.forbidden", `the secret ${name} is not set`);
    }
    const payload = args[1];
    const bytes =
      typeof payload === "string"
        ? Buffer.from(payload, "utf8")
        : payload instanceof Uint8Array
          ? Buffer.from(payload)
          : undefined;
    if (bytes === undefined) {
      throw new PluginRefusal("plugin.invalid_args", "the payload is text or bytes");
    }
    const signature = createHmac("sha256", value).update(bytes).digest("hex");
    if (method === "sign") {
      return signature;
    }
    const given = typeof args[2] === "string" ? args[2].toLowerCase() : "";
    return (
      given.length === signature.length &&
      timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(signature, "utf8"))
    );
  }
}
