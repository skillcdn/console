import { eq } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { packConnects } from "../schema.js";

// A project's pack asking to be connected (ADR-0036): one request at a time per project, kept
// while the person has not approved at the deployment; the secret the console claims with is
// sealed, and the token, once claimed, goes to the project's row and never here.

export interface PackConnectRecord {
  readonly projectId: string;
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

const columns = {
  projectId: packConnects.projectId,
  address: packConnects.address,
  code: packConnects.code,
  url: packConnects.url,
  sealedSecret: packConnects.secret,
  intervalSeconds: packConnects.intervalSeconds,
  startedById: packConnects.startedById,
  expiresAt: packConnects.expiresAt,
  createdAt: packConnects.createdAt,
};

/** Begins a connection for the project, in place of any under way: one at a time. */
export async function startPackConnect(
  database: Database,
  input: Omit<PackConnectRecord, "createdAt"> & { readonly now: Date },
): Promise<PackConnectRecord> {
  const values = {
    projectId: input.projectId,
    address: input.address,
    code: input.code,
    url: input.url,
    secret: input.sealedSecret,
    intervalSeconds: input.intervalSeconds,
    startedById: input.startedById,
    expiresAt: input.expiresAt,
    createdAt: input.now,
  };
  const [row] = await drizzleOf(database)
    .insert(packConnects)
    .values(values)
    .onConflictDoUpdate({ target: [packConnects.projectId], set: values })
    .returning(columns);
  if (row === undefined) {
    throw new Error("pack connect upsert returned no row");
  }
  return row;
}

/** The connection under way for the project, or nothing. */
export async function readPackConnect(
  database: Database,
  projectId: string,
): Promise<PackConnectRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(columns)
    .from(packConnects)
    .where(eq(packConnects.projectId, projectId))
    .limit(1);
  return row;
}

/** Ends the connection under way for the project, if any: claimed, ended at the deployment, or given up. */
export async function endPackConnect(database: Database, projectId: string): Promise<void> {
  await drizzleOf(database).delete(packConnects).where(eq(packConnects.projectId, projectId));
}
