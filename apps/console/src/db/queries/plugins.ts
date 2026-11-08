import type { PluginCommandOutcome } from "@skillcdn/console/api";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { memberOfProject } from "../../auth/policy.js";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import {
  people,
  pluginGrants,
  pluginInstalls,
  pluginSecrets,
  projects,
  workspaces,
} from "../schema.js";
import { type Actor, recordEvent } from "./events.js";
import type { PersonRecord } from "./people.js";

// What the console keeps of its plugins (docs/specs/plugins.md, "Lifecycle", "Roles and grants",
// "Settings"): the installs an administrator enabled, the grants of their roles, and their
// secrets, sealed. Every change is one transaction with the event that records it, in the board
// project's feed where the plugin has one, the plugin's key on every event.

export type PluginInstallState = "enabled" | "disabled" | "needs_consent";

export interface PluginInstallRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly packageName: string;
  readonly version: string;
  readonly dataVersion: number;
  readonly state: PluginInstallState;
  readonly consent: readonly string[];
  readonly boardProjectId: string | undefined;
  readonly projects: "all" | readonly string[];
  readonly settings: Readonly<Record<string, unknown>>;
  readonly enabledAt: Date | undefined;
  readonly enabledBy: string | undefined;
  readonly disabledAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PluginGrantRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly pluginKey: string;
  readonly role: string;
  readonly person:
    | { readonly id: string; readonly login: string; readonly name: string | undefined }
    | undefined;
  readonly project:
    | { readonly id: string; readonly key: string; readonly name: string }
    | undefined;
  readonly everyone: boolean;
  /** The plugin the role went to (ADR-0072), by key, where it went to one. */
  readonly plugin: string | undefined;
  readonly createdAt: Date;
  readonly createdBy: string | undefined;
}

export interface PluginSecretSummary {
  readonly name: string;
  readonly setAt: Date;
  /** When it expires, or none. */
  readonly expiresAt: Date | undefined;
  /** `administrator`, or the host of the answer it was sealed from. */
  readonly source: string;
}

/** A sealed secret as the console reads it to use it: never for a plugin. */
export interface PluginSecretRow extends PluginSecretSummary {
  readonly sealed: string;
}

/** What is wrong with a change to what the console keeps of a plugin. `code` is what the API answers with. */
export class PluginStoreError extends DomainError {
  constructor(code: "plugin.not_found" | "plugin.conflict" | "plugin.too_many", message: string) {
    super(code, message);
  }
}

const installColumns = {
  id: pluginInstalls.id,
  workspaceId: pluginInstalls.workspaceId,
  key: pluginInstalls.key,
  packageName: pluginInstalls.packageName,
  version: pluginInstalls.version,
  dataVersion: pluginInstalls.dataVersion,
  state: pluginInstalls.state,
  consent: pluginInstalls.consent,
  boardProjectId: pluginInstalls.boardProjectId,
  projects: pluginInstalls.projects,
  settings: pluginInstalls.settings,
  enabledAt: pluginInstalls.enabledAt,
  enabledBy: pluginInstalls.enabledBy,
  disabledAt: pluginInstalls.disabledAt,
  createdAt: pluginInstalls.createdAt,
  updatedAt: pluginInstalls.updatedAt,
};

type InstallRow = {
  [K in keyof typeof installColumns]: (typeof installColumns)[K]["_"]["data"] | null;
} & {
  id: string;
  workspaceId: string;
  key: string;
  packageName: string;
  version: string;
  dataVersion: number;
  state: string;
  createdAt: Date;
  updatedAt: Date;
};

function toInstall(row: InstallRow): PluginInstallRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.key,
    packageName: row.packageName,
    version: row.version,
    dataVersion: row.dataVersion,
    state: row.state as PluginInstallState,
    consent: (row.consent as string[] | null) ?? [],
    boardProjectId: row.boardProjectId ?? undefined,
    projects: (row.projects as "all" | string[] | null) ?? "all",
    settings: (row.settings as Record<string, unknown> | null) ?? {},
    enabledAt: row.enabledAt ?? undefined,
    enabledBy: row.enabledBy ?? undefined,
    disabledAt: row.disabledAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type Handle = Transaction | ReturnType<typeof drizzleOf>;

async function readInstall(
  handle: Handle,
  workspaceId: string,
  key: string,
): Promise<PluginInstallRecord | undefined> {
  const [row] = await handle
    .select(installColumns)
    .from(pluginInstalls)
    .where(and(eq(pluginInstalls.workspaceId, workspaceId), eq(pluginInstalls.key, key)))
    .limit(1);
  return row === undefined ? undefined : toInstall(row);
}

/** A project by its id, as a plugin's board is named: its key and name, or none. */
export async function findProjectBrief(
  database: Database,
  workspaceId: string,
  projectId: string,
): Promise<{ readonly id: string; readonly key: string; readonly name: string } | undefined> {
  const [row] = await drizzleOf(database)
    .select({ id: projects.id, key: projects.key, name: projects.name })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  return row;
}

/** Every install of the workspace, by key. */
export async function listInstalls(
  database: Database,
  workspaceId: string,
): Promise<PluginInstallRecord[]> {
  const rows = await drizzleOf(database)
    .select(installColumns)
    .from(pluginInstalls)
    .where(eq(pluginInstalls.workspaceId, workspaceId))
    .orderBy(asc(pluginInstalls.key));
  return rows.map(toInstall);
}

export function findInstall(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<PluginInstallRecord | undefined> {
  return readInstall(drizzleOf(database), workspaceId, key);
}

/** The workspace row, locked for the length of the transaction: every change to a plugin's install goes under it. */
async function lockWorkspace(tx: Transaction, workspaceId: string): Promise<void> {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update");
}

export interface EnableInput {
  readonly workspaceId: string;
  readonly key: string;
  readonly packageName: string;
  readonly version: string;
  readonly dataVersion: number;
  readonly consent: readonly string[];
  readonly boardProjectId: string | undefined;
  readonly projects: "all" | readonly string[];
  readonly settings: Readonly<Record<string, unknown>>;
  /** The plugin's name in English, for the event. */
  readonly name: string;
  readonly actor: Actor;
  readonly now: Date;
}

/** Enables a plugin: makes its install, or brings one back, and tells the board project. */
export async function enableInstall(
  database: Database,
  input: EnableInput,
): Promise<PluginInstallRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const values = {
      workspaceId: input.workspaceId,
      key: input.key,
      packageName: input.packageName,
      version: input.version,
      dataVersion: input.dataVersion,
      state: "enabled",
      consent: [...input.consent],
      boardProjectId: input.boardProjectId ?? null,
      projects: input.projects === "all" ? ("all" as const) : [...input.projects],
      settings: { ...input.settings },
      enabledAt: input.now,
      enabledBy: input.actor.id,
      disabledAt: null,
      updatedAt: input.now,
    };
    const [row] = await tx
      .insert(pluginInstalls)
      .values({ ...values, createdAt: input.now })
      .onConflictDoUpdate({ target: [pluginInstalls.workspaceId, pluginInstalls.key], set: values })
      .returning(installColumns);
    if (row === undefined) {
      throw new Error("plugin install upsert returned no row");
    }
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.boardProjectId,
      kind: "plugin.enabled",
      actor: input.actor,
      plugin: input.key,
      data: { key: input.key, name: input.name, capabilities: [...input.consent] },
      now: input.now,
    });
    return toInstall(row);
  });
}

/** Disables a plugin: its install stays with everything in it, and nothing of it runs. */
export async function disableInstall(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly actor: Actor;
    readonly now: Date;
  },
): Promise<PluginInstallRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const [row] = await tx
      .update(pluginInstalls)
      .set({ state: "disabled", disabledAt: input.now, updatedAt: input.now })
      .where(
        and(eq(pluginInstalls.workspaceId, input.workspaceId), eq(pluginInstalls.key, input.key)),
      )
      .returning(installColumns);
    if (row === undefined) {
      throw new PluginStoreError("plugin.not_found", "the plugin is not enabled");
    }
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: row.boardProjectId ?? undefined,
      kind: "plugin.disabled",
      actor: input.actor,
      plugin: input.key,
      data: { key: input.key },
      now: input.now,
    });
    return toInstall(row);
  });
}

/** Writes the settings as they are now, and tells the board which changed. */
export async function updateInstallSettings(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly settings: Readonly<Record<string, unknown>>;
    readonly fields: readonly string[];
    readonly actor: Actor;
    readonly now: Date;
  },
): Promise<PluginInstallRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const [row] = await tx
      .update(pluginInstalls)
      .set({ settings: { ...input.settings }, updatedAt: input.now })
      .where(
        and(eq(pluginInstalls.workspaceId, input.workspaceId), eq(pluginInstalls.key, input.key)),
      )
      .returning(installColumns);
    if (row === undefined) {
      throw new PluginStoreError("plugin.not_found", "the plugin has no install");
    }
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: row.boardProjectId ?? undefined,
      kind: "plugin.configured",
      actor: input.actor,
      plugin: input.key,
      data: { key: input.key, fields: [...input.fields] },
      now: input.now,
    });
    return toInstall(row);
  });
}

/** Writes what the install holds now, an optional capability turned on or off, and tells the board. */
export async function updateInstallConsent(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly consent: readonly string[];
    readonly actor: Actor;
    readonly now: Date;
  },
): Promise<PluginInstallRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const [row] = await tx
      .update(pluginInstalls)
      .set({ consent: [...input.consent], updatedAt: input.now })
      .where(
        and(eq(pluginInstalls.workspaceId, input.workspaceId), eq(pluginInstalls.key, input.key)),
      )
      .returning(installColumns);
    if (row === undefined) {
      throw new PluginStoreError("plugin.not_found", "the plugin has no install");
    }
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: row.boardProjectId ?? undefined,
      kind: "plugin.configured",
      actor: input.actor,
      plugin: input.key,
      data: { key: input.key, capabilities: [...input.consent] },
      now: input.now,
    });
    return toInstall(row);
  });
}

/** Changes how an install stands without anyone doing it: a new version waiting for consent, or back. */
export async function setInstallState(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly state: PluginInstallState;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database)
    .update(pluginInstalls)
    .set({ state: input.state, updatedAt: input.now })
    .where(
      and(eq(pluginInstalls.workspaceId, input.workspaceId), eq(pluginInstalls.key, input.key)),
    );
}

/** Records that the migrate role brought the plugin's records to a version, and tells the board. */
export async function upgradeInstall(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly version: string;
    readonly dataVersion: number;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .update(pluginInstalls)
      .set({ version: input.version, dataVersion: input.dataVersion, updatedAt: input.now })
      .where(
        and(eq(pluginInstalls.workspaceId, input.workspaceId), eq(pluginInstalls.key, input.key)),
      )
      .returning(installColumns);
    if (row === undefined) {
      return;
    }
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: row.boardProjectId ?? undefined,
      kind: "plugin.upgraded",
      actor: undefined,
      plugin: input.key,
      data: { key: input.key, version: input.dataVersion },
      now: input.now,
    });
  });
}

/** A plugin failed in a way a person should see: the event says what went wrong. */
export async function recordPluginFailure(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly projectId?: string | undefined;
    readonly problem: string;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database).transaction(async (tx) => {
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: "plugin.failed",
      actor: undefined,
      plugin: input.key,
      data: { key: input.key, problem: input.problem.slice(0, 500) },
      now: input.now,
    });
  });
}

/** Every command a plugin ran leaves an event: who, which, with what, and how it ended. */
export async function recordPluginCommand(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly projectId: string | undefined;
    readonly actor: Actor;
    readonly runId?: string | undefined;
    readonly command: string;
    readonly outcome: PluginCommandOutcome;
    readonly code?: string | undefined;
    readonly durationMs: number;
    readonly args: Readonly<Record<string, unknown>>;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database).transaction(async (tx) => {
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: "plugin.command",
      actor: input.actor,
      runId: input.runId,
      plugin: input.key,
      data: {
        key: input.key,
        command: input.command,
        outcome: input.outcome,
        ...(input.code === undefined ? {} : { code: input.code }),
        durationMs: Math.round(input.durationMs),
        args: { ...input.args },
      },
      now: input.now,
    });
  });
}

const grantColumns = {
  id: pluginGrants.id,
  workspaceId: pluginGrants.workspaceId,
  pluginKey: pluginGrants.pluginKey,
  role: pluginGrants.role,
  personId: pluginGrants.personId,
  personLogin: people.login,
  personName: people.name,
  projectId: pluginGrants.projectId,
  projectKey: projects.key,
  projectName: projects.name,
  everyone: pluginGrants.everyone,
  granteePluginKey: pluginGrants.granteePluginKey,
  createdAt: pluginGrants.createdAt,
  createdBy: pluginGrants.createdBy,
};

function toGrant(row: {
  id: string;
  workspaceId: string;
  pluginKey: string;
  role: string;
  personId: string | null;
  personLogin: string | null;
  personName: string | null;
  projectId: string | null;
  projectKey: string | null;
  projectName: string | null;
  everyone: boolean;
  granteePluginKey: string | null;
  createdAt: Date;
  createdBy: string | null;
}): PluginGrantRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    pluginKey: row.pluginKey,
    role: row.role,
    person:
      row.personId === null
        ? undefined
        : { id: row.personId, login: row.personLogin ?? "", name: row.personName ?? undefined },
    project:
      row.projectId === null
        ? undefined
        : { id: row.projectId, key: row.projectKey ?? "", name: row.projectName ?? "" },
    everyone: row.everyone,
    plugin: row.granteePluginKey ?? undefined,
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? undefined,
  };
}

function selectGrants(handle: Handle) {
  return handle
    .select(grantColumns)
    .from(pluginGrants)
    .leftJoin(people, eq(people.id, pluginGrants.personId))
    .leftJoin(projects, eq(projects.id, pluginGrants.projectId));
}

/** The grants of one plugin, oldest first. */
export async function listGrants(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<PluginGrantRecord[]> {
  const rows = await selectGrants(drizzleOf(database))
    .where(and(eq(pluginGrants.workspaceId, workspaceId), eq(pluginGrants.pluginKey, key)))
    .orderBy(asc(pluginGrants.createdAt), asc(pluginGrants.id));
  return rows.map(toGrant);
}

/** How many grants one plugin may hold. */
export const MAX_GRANTS_PER_PLUGIN = 1000;

export interface GrantInput {
  readonly workspaceId: string;
  readonly key: string;
  readonly role: string;
  readonly personId?: string | undefined;
  readonly projectId?: string | undefined;
  /** A plugin, by key, to hold the role as itself (ADR-0072). */
  readonly grantee?: string | undefined;
  readonly everyone: boolean;
  readonly actor: Actor;
  readonly now: Date;
  /** The board project, for the event. */
  readonly boardProjectId: string | undefined;
}

/** Gives a role to a person, to the members of a project, or to everyone, once; tells the board. */
export async function addGrant(database: Database, input: GrantInput): Promise<PluginGrantRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const same = await tx
      .select({ id: pluginGrants.id })
      .from(pluginGrants)
      .where(
        and(
          eq(pluginGrants.workspaceId, input.workspaceId),
          eq(pluginGrants.pluginKey, input.key),
          eq(pluginGrants.role, input.role),
          input.personId === undefined
            ? sql`${pluginGrants.personId} is null`
            : eq(pluginGrants.personId, input.personId),
          input.projectId === undefined
            ? sql`${pluginGrants.projectId} is null`
            : eq(pluginGrants.projectId, input.projectId),
          input.grantee === undefined
            ? sql`${pluginGrants.granteePluginKey} is null`
            : eq(pluginGrants.granteePluginKey, input.grantee),
          eq(pluginGrants.everyone, input.everyone),
        ),
      )
      .limit(1);
    if (same.length > 0) {
      throw new PluginStoreError("plugin.conflict", "the role is granted so already");
    }
    const counted = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(pluginGrants)
      .where(
        and(eq(pluginGrants.workspaceId, input.workspaceId), eq(pluginGrants.pluginKey, input.key)),
      );
    if ((counted[0]?.count ?? 0) >= MAX_GRANTS_PER_PLUGIN) {
      throw new PluginStoreError(
        "plugin.too_many",
        `the plugin holds ${MAX_GRANTS_PER_PLUGIN} grants already`,
      );
    }
    const [inserted] = await tx
      .insert(pluginGrants)
      .values({
        workspaceId: input.workspaceId,
        pluginKey: input.key,
        role: input.role,
        personId: input.personId ?? null,
        projectId: input.projectId ?? null,
        granteePluginKey: input.grantee ?? null,
        everyone: input.everyone,
        createdAt: input.now,
        createdBy: input.actor.id,
      })
      .returning({ id: pluginGrants.id });
    if (inserted === undefined) {
      throw new Error("plugin grant insert returned no row");
    }
    const [row] = await selectGrants(tx).where(eq(pluginGrants.id, inserted.id)).limit(1);
    if (row === undefined) {
      throw new Error("plugin grant not found after insert");
    }
    const grant = toGrant(row);
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.boardProjectId,
      kind: "plugin.granted",
      actor: input.actor,
      plugin: input.key,
      data: {
        role: grant.role,
        ...(grant.person === undefined ? {} : { login: grant.person.login }),
        ...(grant.project === undefined
          ? {}
          : { key: grant.project.key, name: grant.project.name }),
        ...(grant.plugin === undefined ? {} : { grantee: grant.plugin }),
        everyone: grant.everyone,
      },
      now: input.now,
    });
    return grant;
  });
}

/** Takes a grant back, and tells the board. */
export async function removeGrant(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly grantId: string;
    readonly actor: Actor;
    readonly now: Date;
    readonly boardProjectId: string | undefined;
  },
): Promise<PluginGrantRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const [row] = await selectGrants(tx)
      .where(
        and(
          eq(pluginGrants.id, input.grantId),
          eq(pluginGrants.workspaceId, input.workspaceId),
          eq(pluginGrants.pluginKey, input.key),
        ),
      )
      .limit(1);
    if (row === undefined) {
      throw new PluginStoreError("plugin.not_found", "the grant was not found");
    }
    await tx.delete(pluginGrants).where(eq(pluginGrants.id, input.grantId));
    const grant = toGrant(row);
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.boardProjectId,
      kind: "plugin.revoked",
      actor: input.actor,
      plugin: input.key,
      data: {
        role: grant.role,
        ...(grant.person === undefined ? {} : { login: grant.person.login }),
        ...(grant.project === undefined
          ? {}
          : { key: grant.project.key, name: grant.project.name }),
        ...(grant.plugin === undefined ? {} : { grantee: grant.plugin }),
        everyone: grant.everyone,
      },
      now: input.now,
    });
    return grant;
  });
}

/**
 * The roles granted to a person in a plugin: to them, to everyone, or to the members of a project
 * they are in, decided as membership is everywhere (auth/policy.ts).
 */
export async function grantedRoles(
  database: Database,
  workspaceId: string,
  key: string,
  person: PersonRecord,
): Promise<string[]> {
  const rows = await drizzleOf(database)
    .selectDistinct({ role: pluginGrants.role })
    .from(pluginGrants)
    .where(
      and(
        eq(pluginGrants.workspaceId, workspaceId),
        eq(pluginGrants.pluginKey, key),
        or(
          eq(pluginGrants.personId, person.id),
          eq(pluginGrants.everyone, true),
          sql`exists (select 1 from ${projects} where ${projects.id} = ${pluginGrants.projectId} and ${memberOfProject(person.id)})`,
        ),
      ),
    );
  return rows.map((row) => row.role).sort();
}

/**
 * The people a role of a plugin was granted to: by name, with everyone, or as members of a project,
 * decided as membership is everywhere (auth/policy.ts). An administrator's holding every role is
 * no grant.
 */
export async function peopleGranted(
  database: Database,
  workspaceId: string,
  key: string,
  role: string,
): Promise<ReadonlySet<string>> {
  const rows = await drizzleOf(database)
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.workspaceId, workspaceId),
        sql`exists (select 1 from ${pluginGrants} where ${pluginGrants.workspaceId} = ${workspaceId} and ${pluginGrants.pluginKey} = ${key} and ${pluginGrants.role} = ${role} and (${pluginGrants.personId} = ${people.id} or ${pluginGrants.everyone} or exists (select 1 from ${projects} where ${projects.id} = ${pluginGrants.projectId} and ${memberOfProject(people.id)})))`,
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * The roles a plugin was granted in another plugin (ADR-0072): those given to it by key. A grant
 * to everyone is every member's and not a plugin's; the callee's default role is added by the
 * registry, as for a member.
 */
export async function rolesGrantedToPlugin(
  database: Database,
  workspaceId: string,
  key: string,
  grantee: string,
): Promise<string[]> {
  const rows = await drizzleOf(database)
    .selectDistinct({ role: pluginGrants.role })
    .from(pluginGrants)
    .where(
      and(
        eq(pluginGrants.workspaceId, workspaceId),
        eq(pluginGrants.pluginKey, key),
        eq(pluginGrants.granteePluginKey, grantee),
      ),
    );
  return rows.map((row) => row.role).sort();
}

/** Every role a plugin holds in other plugins by a grant to it, for `ctx.plugin.grants`. */
export async function grantsHeldByPlugin(
  database: Database,
  workspaceId: string,
  grantee: string,
): Promise<{ readonly plugin: string; readonly role: string }[]> {
  return drizzleOf(database)
    .select({ plugin: pluginGrants.pluginKey, role: pluginGrants.role })
    .from(pluginGrants)
    .where(
      and(eq(pluginGrants.workspaceId, workspaceId), eq(pluginGrants.granteePluginKey, grantee)),
    )
    .orderBy(asc(pluginGrants.pluginKey), asc(pluginGrants.role));
}

/**
 * Sets a secret, sealed by the caller, in place of what was there: an administrator's, or one
 * the console sealed from an answer a plugin received (ADR-0070), with the host it came from as
 * its source and its expiry where the answer said one. Tells the board which setting and from
 * where, never its value.
 */
export async function setSecret(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly name: string;
    readonly sealed: string;
    readonly actor: Actor;
    readonly now: Date;
    readonly boardProjectId: string | undefined;
    readonly expiresAt?: Date | undefined;
    /** `administrator` when left out. */
    readonly source?: string | undefined;
  },
): Promise<void> {
  const source = input.source ?? "administrator";
  await drizzleOf(database).transaction(async (tx) => {
    await tx
      .insert(pluginSecrets)
      .values({
        workspaceId: input.workspaceId,
        pluginKey: input.key,
        name: input.name,
        sealed: input.sealed,
        setAt: input.now,
        setBy: input.actor.id,
        expiresAt: input.expiresAt ?? null,
        source,
      })
      .onConflictDoUpdate({
        target: [pluginSecrets.workspaceId, pluginSecrets.pluginKey, pluginSecrets.name],
        set: {
          sealed: input.sealed,
          setAt: input.now,
          setBy: input.actor.id,
          expiresAt: input.expiresAt ?? null,
          source,
        },
      });
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.boardProjectId,
      kind: "plugin.configured",
      actor: input.actor,
      plugin: input.key,
      data: { key: input.key, fields: [input.name], source },
      now: input.now,
    });
  });
}

export async function removeSecret(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly name: string;
    readonly actor: Actor;
    readonly now: Date;
    readonly boardProjectId: string | undefined;
  },
): Promise<boolean> {
  return drizzleOf(database).transaction(async (tx) => {
    const removed = await tx
      .delete(pluginSecrets)
      .where(
        and(
          eq(pluginSecrets.workspaceId, input.workspaceId),
          eq(pluginSecrets.pluginKey, input.key),
          eq(pluginSecrets.name, input.name),
        ),
      )
      .returning({ name: pluginSecrets.name });
    if (removed.length === 0) {
      return false;
    }
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.boardProjectId,
      kind: "plugin.configured",
      actor: input.actor,
      plugin: input.key,
      data: { key: input.key, fields: [input.name] },
      now: input.now,
    });
    return true;
  });
}

/** The sealed secret with how it stands, for the console to open where the plugin names it; never for the plugin. */
export async function readSecret(
  database: Database,
  workspaceId: string,
  key: string,
  name: string,
): Promise<PluginSecretRow | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      name: pluginSecrets.name,
      sealed: pluginSecrets.sealed,
      setAt: pluginSecrets.setAt,
      expiresAt: pluginSecrets.expiresAt,
      source: pluginSecrets.source,
    })
    .from(pluginSecrets)
    .where(
      and(
        eq(pluginSecrets.workspaceId, workspaceId),
        eq(pluginSecrets.pluginKey, key),
        eq(pluginSecrets.name, name),
      ),
    )
    .limit(1);
  return row === undefined ? undefined : { ...row, expiresAt: row.expiresAt ?? undefined };
}

/**
 * Removes what the console keeps of a plugin beside its records: the grants, the secrets and the
 * install, in one transaction with the event, which goes to the board project the install had.
 */
export async function purgeInstall(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly boardProjectId: string | undefined;
    readonly actor: Actor;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    await tx
      .delete(pluginGrants)
      .where(
        and(eq(pluginGrants.workspaceId, input.workspaceId), eq(pluginGrants.pluginKey, input.key)),
      );
    await tx
      .delete(pluginSecrets)
      .where(
        and(
          eq(pluginSecrets.workspaceId, input.workspaceId),
          eq(pluginSecrets.pluginKey, input.key),
        ),
      );
    await tx
      .delete(pluginInstalls)
      .where(
        and(eq(pluginInstalls.workspaceId, input.workspaceId), eq(pluginInstalls.key, input.key)),
      );
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      projectId: input.boardProjectId,
      kind: "plugin.purged",
      actor: input.actor,
      plugin: input.key,
      data: { key: input.key },
      now: input.now,
    });
  });
}

/** Which secrets are set, when, from where and until when: what the pages may show of them. */
export async function listSecrets(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<PluginSecretSummary[]> {
  const rows = await drizzleOf(database)
    .select({
      name: pluginSecrets.name,
      setAt: pluginSecrets.setAt,
      expiresAt: pluginSecrets.expiresAt,
      source: pluginSecrets.source,
    })
    .from(pluginSecrets)
    .where(and(eq(pluginSecrets.workspaceId, workspaceId), eq(pluginSecrets.pluginKey, key)))
    .orderBy(asc(pluginSecrets.name));
  return rows.map((row) => ({ ...row, expiresAt: row.expiresAt ?? undefined }));
}
