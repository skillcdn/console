import type { PeopleVisibility, WeekStart } from "@skillcdn/console/api";
import { eq, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { workspaces } from "../schema.js";
import { seedCategories } from "./categories.js";
import { type Actor, recordEvent } from "./events.js";

/** The one board of this deployment, until a second workspace is needed. */
export const DEFAULT_WORKSPACE_KEY = "default";

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
}

/**
 * What an administrator keeps on the Settings page (ADR-0035), as the row has it: read on every
 * request that depends on it, never kept, so that a change holds from the next request on.
 */
export interface WorkspaceSettings {
  /** Who sees whom on the People page: everyone, or those one shares a project with. */
  readonly peopleVisibility: PeopleVisibility;
  /** The day the calendars begin a week on: as the language has it, Monday or Sunday. */
  readonly weekStart: WeekStart;
  /** The workspace's time zone, an IANA name, which the command prints moments in; null for none. */
  readonly timeZone: string | null;
  /**
   * When the SkillCDN token the organization's pack is read with was set (ADR-0036); null for
   * none. The token itself is {@link readWorkspacePackToken}'s to read, where it is needed.
   */
  readonly packTokenSetAt: Date | null;
}

/** What a workspace is set to until an administrator says otherwise. */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  peopleVisibility: "everyone",
  weekStart: "auto",
  timeZone: null,
  packTokenSetAt: null,
};

/** The settings an administrator changes on the form; the token has routes of its own. */
const PATCHABLE = ["peopleVisibility", "weekStart", "timeZone"] as const;
export type WorkspaceSettingsPatch = Partial<Pick<WorkspaceSettings, (typeof PATCHABLE)[number]>>;

const settingsColumns = {
  peopleVisibility: workspaces.peopleVisibility,
  weekStart: workspaces.weekStart,
  timeZone: workspaces.timeZone,
  packTokenSetAt: workspaces.packTokenSetAt,
};

/** The SkillCDN token the organization's pack is read with (ADR-0036), sealed, and when it was set. */
export interface WorkspacePackToken {
  readonly sealed: string;
  readonly setAt: Date;
}

/** The token as the row holds it, for a read of the organization's pack; nothing where none is held. */
export async function readWorkspacePackToken(
  database: Database,
  workspaceId: string,
): Promise<WorkspacePackToken | undefined> {
  const [row] = await drizzleOf(database)
    .select({ sealed: workspaces.packToken, setAt: workspaces.packTokenSetAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.sealed != null && row.setAt != null
    ? { sealed: row.sealed, setAt: row.setAt }
    : undefined;
}

/**
 * Keeps the token, sealed, or takes it away with nothing, and tells the board which field
 * changed and never the token; taking away what is not there writes nothing. Answers the
 * settings as they stand.
 */
export async function setWorkspacePackToken(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    /** The token, sealed with the console's secret; nothing to take it away. */
    readonly sealed: string | undefined;
    readonly now: Date;
  },
): Promise<WorkspaceSettings> {
  const { workspaceId, actor, sealed, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select(settingsColumns)
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    if (current === undefined) {
      throw new Error("the workspace was not found");
    }
    if (current.packTokenSetAt === null && sealed === undefined) {
      return current;
    }
    const setAt = sealed === undefined ? null : now;
    await tx
      .update(workspaces)
      .set({ packToken: sealed ?? null, packTokenSetAt: setAt, updatedAt: now })
      .where(eq(workspaces.id, workspaceId));
    await recordEvent(tx, {
      workspaceId,
      kind: "workspace.updated",
      actor,
      data: { fields: ["packToken"] },
      now,
    });
    return { ...current, packTokenSetAt: setAt };
  });
}

/**
 * The workspace the deployment runs, made at boot by whichever role comes first and renamed by
 * configuration since. Several replicas starting together all upsert the same row. A workspace
 * made here starts with its categories (ADR-0019); the ones the migration found were seeded then.
 */
export async function ensureWorkspace(
  database: Database,
  workspace: { readonly name: string; readonly now: Date },
): Promise<WorkspaceRecord> {
  const handle = drizzleOf(database);
  const [row] = await handle
    .insert(workspaces)
    .values({ key: DEFAULT_WORKSPACE_KEY, name: workspace.name, updatedAt: workspace.now })
    .onConflictDoUpdate({
      target: [workspaces.key],
      set: { name: workspace.name, updatedAt: workspace.now },
    })
    .returning({
      id: workspaces.id,
      name: workspaces.name,
      // A row an upsert inserted has no transaction that ever updated it.
      inserted: sql<boolean>`(xmax = 0)`,
    });
  if (row === undefined) {
    throw new Error("workspace upsert returned no row");
  }
  if (row.inserted) {
    await seedCategories(handle, row.id, workspace.now);
  }
  return { id: row.id, name: row.name };
}

/** When the organization at the git host was last read whole, or nothing (ADR-0022). */
export async function membersSyncedAt(
  database: Database,
  workspaceId: string,
): Promise<Date | undefined> {
  const [row] = await drizzleOf(database)
    .select({ syncedAt: workspaces.membersSyncedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.syncedAt ?? undefined;
}

/** The settings as the row has them now; the defaults for a row that is not there, which a person signed in never meets. */
export async function readWorkspaceSettings(
  database: Database,
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const [row] = await drizzleOf(database)
    .select(settingsColumns)
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? DEFAULT_WORKSPACE_SETTINGS;
}

/**
 * Changes the settings an administrator keeps, and tells the board which; what is already so
 * writes nothing.
 */
export async function updateWorkspaceSettings(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly patch: WorkspaceSettingsPatch;
    readonly now: Date;
  },
): Promise<WorkspaceSettings> {
  const { workspaceId, actor, patch, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select(settingsColumns)
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    if (current === undefined) {
      throw new Error("the workspace was not found");
    }
    const next: WorkspaceSettings = {
      peopleVisibility: patch.peopleVisibility ?? current.peopleVisibility,
      weekStart: patch.weekStart ?? current.weekStart,
      timeZone: patch.timeZone === undefined ? current.timeZone : patch.timeZone,
      packTokenSetAt: current.packTokenSetAt,
    };
    const fields = PATCHABLE.filter((field) => next[field] !== current[field]);
    if (fields.length === 0) {
      return next;
    }
    await tx
      .update(workspaces)
      .set({
        peopleVisibility: next.peopleVisibility,
        weekStart: next.weekStart,
        timeZone: next.timeZone,
        updatedAt: now,
      })
      .where(eq(workspaces.id, workspaceId));
    await recordEvent(tx, {
      workspaceId,
      kind: "workspace.updated",
      actor,
      data: { fields },
      now,
    });
    return next;
  });
}
