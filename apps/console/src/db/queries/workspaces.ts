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
}

/** What a workspace is set to until an administrator says otherwise. */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  peopleVisibility: "everyone",
  weekStart: "auto",
  timeZone: null,
};

export type WorkspaceSettingsPatch = Partial<WorkspaceSettings>;

const settingsColumns = {
  peopleVisibility: workspaces.peopleVisibility,
  weekStart: workspaces.weekStart,
  timeZone: workspaces.timeZone,
};

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
    };
    const fields = (Object.keys(next) as (keyof WorkspaceSettings)[]).filter(
      (field) => next[field] !== current[field],
    );
    if (fields.length === 0) {
      return next;
    }
    await tx
      .update(workspaces)
      .set({ ...next, updatedAt: now })
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
