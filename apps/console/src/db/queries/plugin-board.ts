import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { pluginCursors, pluginEvents, pluginJobs, pluginLinks, projects } from "../schema.js";

// What a plugin leaves on the board and in the stream of events (ADR-0052, docs/specs/plugins.md,
// "The board" and "Events, hooks and jobs"): the mark on an item a plugin made, the events a
// plugin emits, where each plugin's hooks are in the two streams, and when each job last ran.

/** The kinds of item a plugin makes on the board, and is held to its own of. */
export type PluginItemKind = "task" | "decision" | "document";

/** Writes that the plugin made the item: the link the pages and the feed say "through <plugin>" by. */
export async function markPluginItem(
  handle: Transaction | ReturnType<typeof drizzleOf>,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly kind: PluginItemKind;
    readonly id: string;
  },
): Promise<void> {
  await handle.insert(pluginLinks).values({
    workspaceId: input.workspaceId,
    pluginKey: input.key,
    recordId: null,
    targetKind: input.kind,
    targetId: input.id,
  });
}

/** Whether the plugin made the item: what it may change, close, comment on or take the answer of. */
export async function isPluginItem(
  database: Database,
  workspaceId: string,
  key: string,
  kind: PluginItemKind,
  id: string,
): Promise<boolean> {
  const [row] = await drizzleOf(database)
    .select({ id: pluginLinks.id })
    .from(pluginLinks)
    .where(
      and(
        eq(pluginLinks.workspaceId, workspaceId),
        eq(pluginLinks.pluginKey, key),
        eq(pluginLinks.targetKind, kind),
        eq(pluginLinks.targetId, id),
        isNull(pluginLinks.recordId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The plugins that made items among the ids given, by kind: for a hook's delivery of an event about an item. */
export async function pluginsOfItems(
  database: Database,
  workspaceId: string,
  items: readonly { readonly kind: PluginItemKind; readonly id: string }[],
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const item of items) {
    const rows = await drizzleOf(database)
      .select({ key: pluginLinks.pluginKey })
      .from(pluginLinks)
      .where(
        and(
          eq(pluginLinks.workspaceId, workspaceId),
          eq(pluginLinks.targetKind, item.kind),
          eq(pluginLinks.targetId, item.id),
          isNull(pluginLinks.recordId),
        ),
      );
    for (const row of rows) {
      keys.add(row.key);
    }
  }
  return keys;
}

/** A project by its key, as the board knows it, whoever asks: for a console caller's reach into the plugin's projects. */
export async function findProjectByKey(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<
  | {
      readonly id: string;
      readonly key: string;
      readonly name: string;
      readonly visibility: "workspace" | "private";
      readonly createdAt: Date;
    }
  | undefined
> {
  const [row] = await drizzleOf(database)
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      visibility: projects.visibility,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.key, key)))
    .limit(1);
  return row;
}

export interface PluginEventRecord {
  readonly id: number;
  readonly plugin: string;
  readonly kind: string;
  readonly data: unknown;
  readonly createdAt: Date;
}

/** Keeps an event a plugin emitted, and answers its number in the stream. */
export async function emitPluginEvent(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly kind: string;
    readonly data: unknown;
    readonly now: Date;
  },
): Promise<number> {
  const [row] = await drizzleOf(database)
    .insert(pluginEvents)
    .values({
      workspaceId: input.workspaceId,
      pluginKey: input.key,
      kind: input.kind,
      data: input.data ?? null,
      createdAt: input.now,
    })
    .returning({ id: pluginEvents.id });
  if (row === undefined) {
    throw new Error("plugin event insert returned no row");
  }
  return row.id;
}

/** The plugins' events after number `after`, oldest first: what the dispatcher delivers. */
export async function listPluginEventsAfter(
  database: Database,
  workspaceId: string,
  after: number,
  limit: number,
): Promise<PluginEventRecord[]> {
  const rows = await drizzleOf(database)
    .select()
    .from(pluginEvents)
    .where(and(eq(pluginEvents.workspaceId, workspaceId), gt(pluginEvents.id, after)))
    .orderBy(asc(pluginEvents.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    plugin: row.pluginKey,
    kind: row.kind,
    data: row.data,
    createdAt: row.createdAt,
  }));
}

/** One plugin's events after number `after`, oldest first, a page at a time: what its frames and `GET .../plugin-events` read. */
export async function listPluginEventsOf(
  database: Database,
  workspaceId: string,
  key: string,
  page: { readonly after: number; readonly limit: number },
): Promise<{ readonly items: PluginEventRecord[]; readonly more: boolean }> {
  const rows = await drizzleOf(database)
    .select()
    .from(pluginEvents)
    .where(
      and(
        eq(pluginEvents.workspaceId, workspaceId),
        eq(pluginEvents.pluginKey, key),
        gt(pluginEvents.id, page.after),
      ),
    )
    .orderBy(asc(pluginEvents.id))
    .limit(page.limit + 1);
  return {
    items: rows.slice(0, page.limit).map((row) => ({
      id: row.id,
      plugin: row.pluginKey,
      kind: row.kind,
      data: row.data,
      createdAt: row.createdAt,
    })),
    more: rows.length > page.limit,
  };
}

/**
 * Removes the plugins' events past their time, and the oldest of a plugin beyond what it keeps
 * (docs/specs/plugins.md, "Limits and refusals"). Answers how many went.
 */
export async function sweepPluginEvents(
  database: Database,
  input: { readonly before: Date; readonly keep: number },
): Promise<number> {
  const handle = drizzleOf(database);
  const old = await handle
    .delete(pluginEvents)
    .where(lt(pluginEvents.createdAt, input.before))
    .returning({ id: pluginEvents.id });
  const over = await handle.execute<{ id: number }>(sql`
    delete from ${pluginEvents} where id in (
      select id from (
        select id, row_number() over (partition by workspace_id, plugin_key order by id desc) as n
        from ${pluginEvents}
      ) ranked where ranked.n > ${input.keep}
    ) returning id`);
  return old.length + over.rows.length;
}

/** Where a plugin's hooks are in the two streams, and how the event at the head has gone so far. */
export interface PluginCursor {
  readonly consoleAfter: number;
  readonly pluginAfter: number;
  readonly attempts: number;
  readonly nextAttemptAt: Date | undefined;
}

export async function readCursor(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<PluginCursor | undefined> {
  const [row] = await drizzleOf(database)
    .select()
    .from(pluginCursors)
    .where(and(eq(pluginCursors.workspaceId, workspaceId), eq(pluginCursors.pluginKey, key)))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        consoleAfter: row.consoleAfter,
        pluginAfter: row.pluginAfter,
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt ?? undefined,
      };
}

export async function writeCursor(
  database: Database,
  input: { readonly workspaceId: string; readonly key: string; readonly now: Date } & PluginCursor,
): Promise<void> {
  await drizzleOf(database)
    .insert(pluginCursors)
    .values({
      workspaceId: input.workspaceId,
      pluginKey: input.key,
      consoleAfter: input.consoleAfter,
      pluginAfter: input.pluginAfter,
      attempts: input.attempts,
      nextAttemptAt: input.nextAttemptAt ?? null,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [pluginCursors.workspaceId, pluginCursors.pluginKey],
      set: {
        consoleAfter: input.consoleAfter,
        pluginAfter: input.pluginAfter,
        attempts: input.attempts,
        nextAttemptAt: input.nextAttemptAt ?? null,
        updatedAt: input.now,
      },
    });
}

/**
 * A cursor begins at the end of the streams, not at their beginning: a plugin enabled today is
 * not told of everything that ever happened, nor one enabled again of what happened while it was
 * disabled. Written at enabling, and by the dispatcher where none is yet.
 */
export async function beginCursor(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly consoleAfter: number;
    readonly pluginAfter: number;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database)
    .insert(pluginCursors)
    .values({
      workspaceId: input.workspaceId,
      pluginKey: input.key,
      consoleAfter: input.consoleAfter,
      pluginAfter: input.pluginAfter,
      attempts: 0,
      nextAttemptAt: null,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [pluginCursors.workspaceId, pluginCursors.pluginKey],
      set: {
        consoleAfter: input.consoleAfter,
        pluginAfter: input.pluginAfter,
        attempts: 0,
        nextAttemptAt: null,
        updatedAt: input.now,
      },
    });
}

export async function deleteCursor(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<void> {
  await drizzleOf(database)
    .delete(pluginCursors)
    .where(and(eq(pluginCursors.workspaceId, workspaceId), eq(pluginCursors.pluginKey, key)));
}

/** A job of a plugin as the scheduler keeps it: when it last ran and how, when it runs next. */
export interface PluginJobRecord {
  readonly name: string;
  readonly lastRunAt: Date | undefined;
  readonly lastOutcome: "ok" | "failed" | undefined;
  readonly nextAt: Date | undefined;
  /** When a failure was last written as an event, so that one is written an hour at most. */
  readonly failedEventAt: Date | undefined;
}

export async function readJobs(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<PluginJobRecord[]> {
  const rows = await drizzleOf(database)
    .select()
    .from(pluginJobs)
    .where(and(eq(pluginJobs.workspaceId, workspaceId), eq(pluginJobs.pluginKey, key)))
    .orderBy(asc(pluginJobs.name));
  return rows.map((row) => ({
    name: row.name,
    lastRunAt: row.lastRunAt ?? undefined,
    lastOutcome: (row.lastOutcome ?? undefined) as PluginJobRecord["lastOutcome"],
    nextAt: row.nextAt ?? undefined,
    failedEventAt: row.failedEventAt ?? undefined,
  }));
}

export async function writeJob(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly key: string;
    readonly now: Date;
  } & PluginJobRecord,
): Promise<void> {
  const values = {
    lastRunAt: input.lastRunAt ?? null,
    lastOutcome: input.lastOutcome ?? null,
    nextAt: input.nextAt ?? null,
    failedEventAt: input.failedEventAt ?? null,
    updatedAt: input.now,
  };
  await drizzleOf(database)
    .insert(pluginJobs)
    .values({ workspaceId: input.workspaceId, pluginKey: input.key, name: input.name, ...values })
    .onConflictDoUpdate({
      target: [pluginJobs.workspaceId, pluginJobs.pluginKey, pluginJobs.name],
      set: values,
    });
}

/** Forgets the plugin's events, cursor and jobs: on purge, with the rest. What it put on the board stays, marked. */
export async function purgePluginStreams(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<void> {
  const handle = drizzleOf(database);
  await handle
    .delete(pluginEvents)
    .where(and(eq(pluginEvents.workspaceId, workspaceId), eq(pluginEvents.pluginKey, key)));
  await handle
    .delete(pluginCursors)
    .where(and(eq(pluginCursors.workspaceId, workspaceId), eq(pluginCursors.pluginKey, key)));
  await handle
    .delete(pluginJobs)
    .where(and(eq(pluginJobs.workspaceId, workspaceId), eq(pluginJobs.pluginKey, key)));
}

/** The newest event of the plugins' stream, or 0: where a new cursor begins. */
export async function latestPluginEventId(
  database: Database,
  workspaceId: string,
): Promise<number> {
  const [row] = await drizzleOf(database)
    .select({ latest: sql<number | null>`max(${pluginEvents.id})`.mapWith(Number) })
    .from(pluginEvents)
    .where(eq(pluginEvents.workspaceId, workspaceId));
  return row?.latest ?? 0;
}
