import { type Database, drizzleOf } from "../client.js";
import { workspaces } from "../schema.js";

/** The one board of this deployment, until a second workspace is needed. */
export const DEFAULT_WORKSPACE_KEY = "default";

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
}

/**
 * The workspace the deployment runs, made at boot by whichever role comes first and renamed by
 * configuration since. Several replicas starting together all upsert the same row.
 */
export async function ensureWorkspace(
  database: Database,
  workspace: { readonly name: string; readonly now: Date },
): Promise<WorkspaceRecord> {
  const [row] = await drizzleOf(database)
    .insert(workspaces)
    .values({ key: DEFAULT_WORKSPACE_KEY, name: workspace.name, updatedAt: workspace.now })
    .onConflictDoUpdate({
      target: [workspaces.key],
      set: { name: workspace.name, updatedAt: workspace.now },
    })
    .returning({ id: workspaces.id, name: workspaces.name });
  if (row === undefined) {
    throw new Error("workspace upsert returned no row");
  }
  return row;
}
