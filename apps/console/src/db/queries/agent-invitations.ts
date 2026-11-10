import { and, eq, gt } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { agentInvitations, people } from "../schema.js";
import type { Actor } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The invitation that leads a machine to an agent account (ADR-0088): a code that says which
// account a setup is for and opens its guide, and gives nobody the account. One per account,
// made again in place of the one before; the row holds the code's hash, never the code. It is
// good until its day, or until the account's command has signed in.

export interface InvitationRecord {
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** Who made it, where they are still to be found. */
  readonly by: PersonRecord | undefined;
}

/** Makes the account's invitation, in place of the one there was. */
export async function makeInvitation(
  database: Database,
  input: {
    readonly account: PersonRecord;
    readonly by: Actor;
    readonly codeHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
  },
): Promise<void> {
  const { account, by, codeHash, expiresAt, now } = input;
  const row = {
    codeHash,
    createdById: by.id,
    agent: by.agent ?? null,
    createdAt: now,
    expiresAt,
  };
  await drizzleOf(database)
    .insert(agentInvitations)
    .values({ personId: account.id, ...row })
    .onConflictDoUpdate({ target: agentInvitations.personId, set: row });
}

/** The account's invitation as it stands, or nothing: none was made, or its day has passed. */
export async function findInvitation(
  database: Database,
  personId: string,
  now: Date,
): Promise<InvitationRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      createdAt: agentInvitations.createdAt,
      expiresAt: agentInvitations.expiresAt,
      by: personColumns(people),
    })
    .from(agentInvitations)
    .leftJoin(people, eq(people.id, agentInvitations.createdById))
    .where(and(eq(agentInvitations.personId, personId), gt(agentInvitations.expiresAt, now)))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        by: row.by === null ? undefined : toPerson(row.by),
      };
}

/** Takes the account's invitation away; whether there was one. */
export async function revokeInvitation(database: Database, personId: string): Promise<boolean> {
  const removed = await drizzleOf(database)
    .delete(agentInvitations)
    .where(eq(agentInvitations.personId, personId))
    .returning({ personId: agentInvitations.personId });
  return removed.length > 0;
}

/**
 * The agent account a code is the invitation of, with when it ends, or nothing: no invitation
 * has that code, its day has passed, or its account is out.
 */
export async function accountOfInvitation(
  database: Database,
  workspaceId: string,
  codeHash: string,
  now: Date,
): Promise<{ readonly account: PersonRecord; readonly expiresAt: Date } | undefined> {
  const [row] = await drizzleOf(database)
    .select({ expiresAt: agentInvitations.expiresAt, account: personColumns(people) })
    .from(agentInvitations)
    .innerJoin(people, eq(people.id, agentInvitations.personId))
    .where(
      and(
        eq(agentInvitations.codeHash, codeHash),
        gt(agentInvitations.expiresAt, now),
        eq(people.workspaceId, workspaceId),
        eq(people.kind, "agent"),
        eq(people.status, "active"),
      ),
    )
    .limit(1);
  return row === undefined
    ? undefined
    : { account: toPerson(row.account), expiresAt: row.expiresAt };
}
