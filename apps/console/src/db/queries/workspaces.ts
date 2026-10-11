import { sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { workspaces } from "../schema.js";
import { seedCategories } from "./categories.js";

/** The one board of this deployment, until a second workspace is needed. */
export const DEFAULT_WORKSPACE_KEY = "default";

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
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
