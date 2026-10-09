import type { EventKind, RestEventData } from "@skillcdn/console/api";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { events } from "../schema.js";
import { actors, type PersonRecord, personColumns, toPerson } from "./people.js";

// Everything that happened to the board, written in the same transaction as the change it
// records, and told to every process of the deployment through the database itself.

/** The PostgreSQL channel a process listens on to learn that the feed has grown. */
export const EVENTS_CHANNEL = "console_events";

export interface EventRecord {
  readonly id: number;
  readonly workspaceId: string;
  readonly kind: EventKind;
  readonly actor: PersonRecord | undefined;
  readonly taskId: string | undefined;
  readonly decisionId: string | undefined;
  readonly data: RestEventData;
  readonly createdAt: Date;
}

/**
 * Appends an event, inside the transaction that makes the change, so that nothing is recorded
 * that did not happen and nothing happens unrecorded; and nudges whoever listens, which the
 * database delivers when the transaction commits and not before.
 */
export async function recordEvent(
  tx: Transaction,
  event: {
    readonly workspaceId: string;
    readonly kind: EventKind;
    readonly actorId: string | undefined;
    readonly taskId?: string | undefined;
    readonly decisionId?: string | undefined;
    readonly data: RestEventData;
    readonly now: Date;
  },
): Promise<number> {
  const [row] = await tx
    .insert(events)
    .values({
      workspaceId: event.workspaceId,
      kind: event.kind,
      actorId: event.actorId ?? null,
      taskId: event.taskId ?? null,
      decisionId: event.decisionId ?? null,
      data: event.data,
      createdAt: event.now,
    })
    .returning({ id: events.id });
  if (row === undefined) {
    throw new Error("event insert returned no row");
  }
  // The payload says nothing: a listener asks for what is after the last number it saw.
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, '')`);
  return row.id;
}

/**
 * What happened after event number `after`, oldest first, at most `limit` of it, and whether
 * there is more. `0` is the beginning.
 */
export async function listEventsAfter(
  database: Database,
  workspaceId: string,
  after: number,
  limit: number,
): Promise<{ readonly items: EventRecord[]; readonly more: boolean }> {
  const rows = await drizzleOf(database)
    .select({
      id: events.id,
      workspaceId: events.workspaceId,
      kind: events.kind,
      taskId: events.taskId,
      decisionId: events.decisionId,
      data: events.data,
      createdAt: events.createdAt,
      actor: personColumns(actors),
    })
    .from(events)
    .leftJoin(actors, eq(actors.id, events.actorId))
    .where(and(eq(events.workspaceId, workspaceId), gt(events.id, after)))
    .orderBy(asc(events.id))
    .limit(limit + 1);
  const more = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      kind: row.kind as EventKind,
      actor: row.actor === null ? undefined : toPerson(row.actor),
      taskId: row.taskId ?? undefined,
      decisionId: row.decisionId ?? undefined,
      data: row.data,
      createdAt: row.createdAt,
    })),
    more,
  };
}

/** The number of the newest event, or `0` when nothing has happened yet. */
export async function latestEventId(database: Database, workspaceId: string): Promise<number> {
  const [row] = await drizzleOf(database)
    .select({ latest: sql<number | null>`max(${events.id})`.mapWith(Number) })
    .from(events)
    .where(eq(events.workspaceId, workspaceId));
  return row?.latest ?? 0;
}
