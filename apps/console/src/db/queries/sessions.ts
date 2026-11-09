import { and, desc, eq, gt, lte, ne } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { people, sessions } from "../schema.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The browsers people are signed in on. The cookie holds a random token and the database its
// hash, so the `api` role keeps no session of its own and any replica answers any request.

export interface SessionRecord {
  readonly id: string;
  readonly person: PersonRecord;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  /** Where the browser last came from, as the server saw it; null until seen. */
  readonly address: string | null;
}

/** One of a person's sessions as the table has it, for the person's own view of them (board #309). */
export interface SessionRow {
  readonly id: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  /** What the browser called itself when the session began; null for one begun before that was kept. */
  readonly userAgent: string | null;
  readonly address: string | null;
}

export async function createSession(
  database: Database,
  session: {
    readonly personId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
    readonly userAgent: string | null;
    readonly address: string | null;
  },
): Promise<void> {
  await drizzleOf(database).insert(sessions).values({
    personId: session.personId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    lastSeenAt: session.now,
    userAgent: session.userAgent,
    address: session.address,
  });
}

/** The session a token names, with its person, while it has not expired. */
export async function findSession(
  database: Database,
  tokenHash: string,
  now: Date,
): Promise<SessionRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      address: sessions.address,
      ...personColumns(people),
    })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        id: row.sessionId,
        person: toPerson(row),
        expiresAt: row.expiresAt,
        lastSeenAt: row.lastSeenAt,
        address: row.address,
      };
}

/**
 * Notes that a session was used, from where, and moves its end when the caller keeps it alive
 * by use.
 */
export async function touchSession(
  database: Database,
  sessionId: string,
  seen: { readonly now: Date; readonly expiresAt: Date; readonly address: string | null },
): Promise<void> {
  await drizzleOf(database)
    .update(sessions)
    .set({ lastSeenAt: seen.now, expiresAt: seen.expiresAt, address: seen.address })
    .where(eq(sessions.id, sessionId));
}

/** True when the session was there. */
export async function deleteSession(database: Database, tokenHash: string): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** Every session of a person: what signing them out of everything means. */
export async function deleteSessionsOf(database: Database, personId: string): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(eq(sessions.personId, personId))
    .returning({ id: sessions.id });
  return rows.length;
}

/** The live sessions of a person, the last used first (board #309). */
export async function listSessionsOf(
  database: Database,
  personId: string,
  now: Date,
): Promise<SessionRow[]> {
  return drizzleOf(database)
    .select({
      id: sessions.id,
      tokenHash: sessions.tokenHash,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      userAgent: sessions.userAgent,
      address: sessions.address,
    })
    .from(sessions)
    .where(and(eq(sessions.personId, personId), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt));
}

/**
 * Ends one session of a person, by its id: the hash of its token when it was there, so that
 * the caller knows whether it was the one the request came on; nothing for another person's,
 * which is as if it were not there, and nothing for one whose time ended, which ended already
 * and goes with the sweep.
 */
export async function deleteSessionOf(
  database: Database,
  personId: string,
  sessionId: string,
  now: Date,
): Promise<string | undefined> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.personId, personId), gt(sessions.expiresAt, now)),
    )
    .returning({ tokenHash: sessions.tokenHash });
  return rows[0]?.tokenHash;
}

/** Ends every session of a person but the one whose token hashes to `keptTokenHash`; all of them when none is kept. */
export async function deleteOtherSessionsOf(
  database: Database,
  personId: string,
  keptTokenHash: string | undefined,
): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(
      and(
        eq(sessions.personId, personId),
        keptTokenHash === undefined ? undefined : ne(sessions.tokenHash, keptTokenHash),
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

/** Removes what time has ended; every read checks the time itself, so this only keeps the table small. */
export async function deleteExpiredSessions(database: Database, now: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return rows.length;
}
