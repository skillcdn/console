import { eq } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { packConnects, workspacePackConnects } from "../schema.js";

// A pack asking to be connected (ADR-0036): one request at a time per holder, a project or the
// workspace, kept while the person has not approved at the deployment; the secret the console
// claims with is sealed, and the token, once claimed, goes to the holder's row and never here.

/** Whose token a connection is for: a project's, or the workspace's, for the organization's pack. */
export type PackHolder = { readonly project: string } | { readonly workspace: string };

export interface PackConnectRecord {
  readonly holder: PackHolder;
  /** The address asked to connect, canonical. */
  readonly address: string;
  readonly code: string;
  readonly url: string;
  /** The deployment's secret, sealed with the console's. */
  readonly sealedSecret: string;
  readonly intervalSeconds: number;
  readonly startedById: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

const projectColumns = {
  id: packConnects.projectId,
  address: packConnects.address,
  code: packConnects.code,
  url: packConnects.url,
  sealedSecret: packConnects.secret,
  intervalSeconds: packConnects.intervalSeconds,
  startedById: packConnects.startedById,
  expiresAt: packConnects.expiresAt,
  createdAt: packConnects.createdAt,
};

const workspaceColumns = {
  id: workspacePackConnects.workspaceId,
  address: workspacePackConnects.address,
  code: workspacePackConnects.code,
  url: workspacePackConnects.url,
  sealedSecret: workspacePackConnects.secret,
  intervalSeconds: workspacePackConnects.intervalSeconds,
  startedById: workspacePackConnects.startedById,
  expiresAt: workspacePackConnects.expiresAt,
  createdAt: workspacePackConnects.createdAt,
};

type Row = Omit<PackConnectRecord, "holder"> & { readonly id: string };

const recordOf = (holder: PackHolder, { id: _id, ...row }: Row): PackConnectRecord => ({
  holder,
  ...row,
});

/** Begins a connection for the holder, in place of any under way: one at a time. */
export async function startPackConnect(
  database: Database,
  input: Omit<PackConnectRecord, "createdAt"> & { readonly now: Date },
): Promise<PackConnectRecord> {
  const values = {
    address: input.address,
    code: input.code,
    url: input.url,
    secret: input.sealedSecret,
    intervalSeconds: input.intervalSeconds,
    startedById: input.startedById,
    expiresAt: input.expiresAt,
    createdAt: input.now,
  };
  const handle = drizzleOf(database);
  const row =
    "project" in input.holder
      ? (
          await handle
            .insert(packConnects)
            .values({ projectId: input.holder.project, ...values })
            .onConflictDoUpdate({ target: [packConnects.projectId], set: values })
            .returning(projectColumns)
        )[0]
      : (
          await handle
            .insert(workspacePackConnects)
            .values({ workspaceId: input.holder.workspace, ...values })
            .onConflictDoUpdate({ target: [workspacePackConnects.workspaceId], set: values })
            .returning(workspaceColumns)
        )[0];
  if (row === undefined) {
    throw new Error("pack connect upsert returned no row");
  }
  return recordOf(input.holder, row);
}

/** The connection under way for the holder, or nothing. */
export async function readPackConnect(
  database: Database,
  holder: PackHolder,
): Promise<PackConnectRecord | undefined> {
  const handle = drizzleOf(database);
  const [row] =
    "project" in holder
      ? await handle
          .select(projectColumns)
          .from(packConnects)
          .where(eq(packConnects.projectId, holder.project))
          .limit(1)
      : await handle
          .select(workspaceColumns)
          .from(workspacePackConnects)
          .where(eq(workspacePackConnects.workspaceId, holder.workspace))
          .limit(1);
  return row === undefined ? undefined : recordOf(holder, row);
}

/** Ends the connection under way for the holder, if any: claimed, ended at the deployment, or given up. */
export async function endPackConnect(database: Database, holder: PackHolder): Promise<void> {
  const handle = drizzleOf(database);
  if ("project" in holder) {
    await handle.delete(packConnects).where(eq(packConnects.projectId, holder.project));
  } else {
    await handle
      .delete(workspacePackConnects)
      .where(eq(workspacePackConnects.workspaceId, holder.workspace));
  }
}
