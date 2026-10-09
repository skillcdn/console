import type { EventKind, RestEventData } from "@skillcdn/console/api";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { events } from "../schema.js";
import { actors, type PersonRecord, personColumns, toPerson } from "./people.js";

// Everything that happened to the board, written in the same transaction as the change it
// records, and told to every process of the deployment through the database itself.

/** The PostgreSQL channel a process listens on to learn that the feed has grown. */
export const EVENTS_CHANNEL = "console_events";

/** Who makes a change: a person, and the agent they act as when they act with a token. */
export interface Actor {
  readonly id: string;
  /** What the agent calls itself, when the person acts through one; nothing when they act themselves. */
  readonly agent?: string | undefined;
}

/** Where a change on the board belongs: the workspace, and the project within it. */
export interface Scope {
  readonly workspaceId: string;
  readonly projectId: string;
}

/**
 * What a read of the feed is narrowed to: the events of one project, or the workspace's own
 * (`projectId: null`, the ones about no project); and, within a project, those about one
 * task, one run or one decision.
 */
export interface EventScope {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly decisionId?: string | undefined;
}

export interface EventRecord {
  readonly id: number;
  readonly workspaceId: string;
  readonly projectId: string | undefined;
  readonly kind: EventKind;
  readonly actor: PersonRecord | undefined;
  /** The agent the actor acted as, when they did through one. */
  readonly agent: string | undefined;
  readonly taskId: string | undefined;
  readonly decisionId: string | undefined;
  readonly runId: string | undefined;
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
    /** The project it happened in; left out for what happened to the workspace itself. */
    readonly projectId?: string | undefined;
    readonly kind: EventKind;
    /** Who did it; nobody for the console itself. */
    readonly actor: Actor | undefined;
    readonly taskId?: string | undefined;
    readonly decisionId?: string | undefined;
    readonly runId?: string | undefined;
    readonly data: RestEventData;
    readonly now: Date;
  },
): Promise<number> {
  const [row] = await tx
    .insert(events)
    .values({
      workspaceId: event.workspaceId,
      projectId: event.projectId ?? null,
      kind: event.kind,
      actorId: event.actor?.id ?? null,
      agent: event.actor?.agent ?? null,
      taskId: event.taskId ?? null,
      decisionId: event.decisionId ?? null,
      runId: event.runId ?? null,
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
 * What happened within `scope` after event number `after`, oldest first, at most `limit` of
 * it, and whether there is more. `0` is the beginning.
 */
export async function listEventsAfter(
  database: Database,
  scope: EventScope,
  after: number,
  limit: number,
): Promise<{ readonly items: EventRecord[]; readonly more: boolean }> {
  const rows = await drizzleOf(database)
    .select({
      id: events.id,
      workspaceId: events.workspaceId,
      projectId: events.projectId,
      kind: events.kind,
      agent: events.agent,
      taskId: events.taskId,
      decisionId: events.decisionId,
      runId: events.runId,
      data: events.data,
      createdAt: events.createdAt,
      actor: personColumns(actors),
    })
    .from(events)
    .leftJoin(actors, eq(actors.id, events.actorId))
    .where(
      and(
        eq(events.workspaceId, scope.workspaceId),
        scope.projectId === null ? isNull(events.projectId) : eq(events.projectId, scope.projectId),
        scope.taskId === undefined ? undefined : eq(events.taskId, scope.taskId),
        scope.runId === undefined ? undefined : eq(events.runId, scope.runId),
        scope.decisionId === undefined ? undefined : eq(events.decisionId, scope.decisionId),
        gt(events.id, after),
      ),
    )
    .orderBy(asc(events.id))
    .limit(limit + 1);
  const more = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId ?? undefined,
      kind: row.kind as EventKind,
      actor: row.actor === null ? undefined : toPerson(row.actor),
      agent: row.agent ?? undefined,
      taskId: row.taskId ?? undefined,
      decisionId: row.decisionId ?? undefined,
      runId: row.runId ?? undefined,
      data: row.data,
      createdAt: row.createdAt,
    })),
    more,
  };
}

/** The number of the newest event of the workspace, or `0` when nothing has happened yet. */
export async function latestEventId(database: Database, workspaceId: string): Promise<number> {
  const [row] = await drizzleOf(database)
    .select({ latest: sql<number | null>`max(${events.id})`.mapWith(Number) })
    .from(events)
    .where(eq(events.workspaceId, workspaceId));
  return row?.latest ?? 0;
}
