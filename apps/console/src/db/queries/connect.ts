import { and, count, eq, gt, isNull, lte } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf } from "../client.js";
import { connectRequests, workspaces } from "../schema.js";

// An agent asking to connect (ADR-0011): the code a person approves, the hash of the secret the
// command claims the token with, what the agent calls itself, and the approval once given. The
// row goes when the token is claimed or the request expires; the token itself is never here.

export interface ConnectRequestRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  /** What the agent calls itself, and where it runs, as the command said. */
  readonly agent: string;
  /** The person who approved, once one did. */
  readonly approvedById: string | undefined;
  /** What the token is to be called, once approved. */
  readonly name: string | undefined;
  /** How many days the token is to be good for; nothing, once approved, for one that does not expire. */
  readonly tokenDays: number | undefined;
  readonly approvedAt: Date | undefined;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** What is wrong with a connection asked for. `code` is what the API answers with. */
export class ConnectError extends DomainError {
  constructor(code: "connect.not_found" | "connect.approved" | "connect.too_many") {
    super(
      code,
      code === "connect.not_found"
        ? "no connection waits under this code"
        : code === "connect.approved"
          ? "the connection was approved already"
          : "as many agents are asking to connect as the console holds at once",
    );
  }
}

const columns = {
  id: connectRequests.id,
  workspaceId: connectRequests.workspaceId,
  code: connectRequests.code,
  agent: connectRequests.agent,
  approvedById: connectRequests.approvedById,
  name: connectRequests.name,
  tokenDays: connectRequests.tokenDays,
  approvedAt: connectRequests.approvedAt,
  expiresAt: connectRequests.expiresAt,
  createdAt: connectRequests.createdAt,
};

interface Row {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly agent: string;
  readonly approvedById: string | null;
  readonly name: string | null;
  readonly tokenDays: number | null;
  readonly approvedAt: Date | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

const toRecord = (row: Row): ConnectRequestRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  code: row.code,
  agent: row.agent,
  approvedById: row.approvedById ?? undefined,
  name: row.name ?? undefined,
  tokenDays: row.tokenDays ?? undefined,
  approvedAt: row.approvedAt ?? undefined,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
});

/** A request still waiting at `now`: one that has not expired. */
const live = (now: Date) => gt(connectRequests.expiresAt, now);

/**
 * Writes a request down, unless the workspace holds as many live ones as it may. The count and
 * the insert happen under the lock on the workspace's row, so that two asked at once cannot
 * both be the last one allowed. A code taken by a live request fails the insert.
 */
export async function createConnectRequest(
  database: Database,
  request: {
    readonly workspaceId: string;
    readonly code: string;
    readonly secretHash: string;
    readonly agent: string;
    readonly expiresAt: Date;
    readonly now: Date;
    /** How many requests may wait at once in the workspace, this one included. */
    readonly limit: number;
  },
): Promise<ConnectRequestRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, request.workspaceId))
      .for("update");
    if (workspace === undefined) {
      throw new Error("the workspace was not found");
    }
    const [held] = await tx
      .select({ count: count() })
      .from(connectRequests)
      .where(and(eq(connectRequests.workspaceId, request.workspaceId), live(request.now)));
    if ((held?.count ?? 0) >= request.limit) {
      throw new ConnectError("connect.too_many");
    }
    // A code is unique among the live requests; one that expired makes way for it.
    await tx
      .delete(connectRequests)
      .where(
        and(
          eq(connectRequests.workspaceId, request.workspaceId),
          eq(connectRequests.code, request.code),
          lte(connectRequests.expiresAt, request.now),
        ),
      );
    const [row] = await tx
      .insert(connectRequests)
      .values({
        workspaceId: request.workspaceId,
        code: request.code,
        secretHash: request.secretHash,
        agent: request.agent,
        expiresAt: request.expiresAt,
        createdAt: request.now,
      })
      .returning(columns);
    if (row === undefined) {
      throw new Error("connect request insert returned no row");
    }
    return toRecord(row);
  });
}

/** The live request under a code, for the person who approves it. */
export async function findConnectRequest(
  database: Database,
  workspaceId: string,
  code: string,
  now: Date,
): Promise<ConnectRequestRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(columns)
    .from(connectRequests)
    .where(
      and(eq(connectRequests.workspaceId, workspaceId), eq(connectRequests.code, code), live(now)),
    )
    .limit(1);
  return row === undefined ? undefined : toRecord(row);
}

/**
 * Notes the approval on the live request under the code: who, what the token is to be called,
 * and for how many days. Nothing for a code no live request has; a request approved already
 * stays as it was and says so.
 */
export async function approveConnectRequest(
  database: Database,
  approval: {
    readonly workspaceId: string;
    readonly code: string;
    readonly personId: string;
    readonly name: string;
    /** Nothing for a token that does not expire. */
    readonly tokenDays: number | undefined;
    readonly now: Date;
  },
): Promise<ConnectRequestRecord | undefined> {
  return drizzleOf(database).transaction(async (tx) => {
    const [found] = await tx
      .select(columns)
      .from(connectRequests)
      .where(
        and(
          eq(connectRequests.workspaceId, approval.workspaceId),
          eq(connectRequests.code, approval.code),
          live(approval.now),
        ),
      )
      .for("update");
    if (found === undefined) {
      return undefined;
    }
    if (found.approvedAt !== null) {
      throw new ConnectError("connect.approved");
    }
    const [row] = await tx
      .update(connectRequests)
      .set({
        approvedById: approval.personId,
        name: approval.name,
        tokenDays: approval.tokenDays ?? null,
        approvedAt: approval.now,
      })
      .where(eq(connectRequests.id, found.id))
      .returning(columns);
    return row === undefined ? undefined : toRecord(row);
  });
}

/** Takes the live request under a code away: the person said no. True when there was one. */
export async function deleteConnectRequest(
  database: Database,
  workspaceId: string,
  code: string,
  now: Date,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(connectRequests)
    .where(
      and(eq(connectRequests.workspaceId, workspaceId), eq(connectRequests.code, code), live(now)),
    )
    .returning({ id: connectRequests.id });
  return rows.length > 0;
}

/** What the command gets when it claims with its secret's hash: wait, the approval once, or nothing. */
export type Claim =
  | { readonly status: "pending"; readonly expiresAt: Date }
  | {
      readonly status: "approved";
      readonly personId: string;
      readonly name: string;
      readonly tokenDays: number | undefined;
    };

/**
 * The approval under a secret, handed over once: the request's row goes with it, so that a
 * second claim finds nothing. A request not yet approved says to wait.
 */
export async function claimConnectRequest(
  database: Database,
  secretHash: string,
  now: Date,
): Promise<Claim | undefined> {
  return drizzleOf(database).transaction(async (tx) => {
    const [found] = await tx
      .select(columns)
      .from(connectRequests)
      .where(and(eq(connectRequests.secretHash, secretHash), live(now)))
      .for("update");
    if (found === undefined) {
      return undefined;
    }
    if (found.approvedAt === null || found.approvedById === null || found.name === null) {
      return { status: "pending", expiresAt: found.expiresAt };
    }
    await tx.delete(connectRequests).where(eq(connectRequests.id, found.id));
    return {
      status: "approved",
      personId: found.approvedById,
      name: found.name,
      tokenDays: found.tokenDays ?? undefined,
    };
  });
}

/** Removes what time has ended; every read checks the time itself, so this only keeps the table small. */
export async function deleteExpiredConnectRequests(database: Database, now: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(connectRequests)
    .where(lte(connectRequests.expiresAt, now))
    .returning({ id: connectRequests.id });
  return rows.length;
}

/** Whether any request waits in the workspace: for a test, or a page, to know. */
export async function countConnectRequests(
  database: Database,
  workspaceId: string,
  now: Date,
): Promise<number> {
  const [held] = await drizzleOf(database)
    .select({ count: count() })
    .from(connectRequests)
    .where(
      and(
        eq(connectRequests.workspaceId, workspaceId),
        live(now),
        isNull(connectRequests.approvedAt),
      ),
    );
  return held?.count ?? 0;
}
