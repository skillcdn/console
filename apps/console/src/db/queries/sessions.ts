import { and, eq, gt, lte } from "drizzle-orm";
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
}

export async function createSession(
  database: Database,
  session: {
    readonly personId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database).insert(sessions).values({
    personId: session.personId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    lastSeenAt: session.now,
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
      };
}

/** Notes that a session was used, and moves its end when the caller keeps it alive by use. */
export async function touchSession(
  database: Database,
  sessionId: string,
  seen: { readonly now: Date; readonly expiresAt: Date },
): Promise<void> {
  await drizzleOf(database)
    .update(sessions)
    .set({ lastSeenAt: seen.now, expiresAt: seen.expiresAt })
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

/** Removes what time has ended; every read checks the time itself, so this only keeps the table small. */
export async function deleteExpiredSessions(database: Database, now: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return rows.length;
}
