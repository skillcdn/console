import {
  type CategoryColor,
  OPEN_TASK_STATES,
  type RestTaskLink,
  type TaskPriority,
  type TaskState,
} from "@skillcdn/console/api";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import * as z from "zod";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import {
  categories,
  decisions,
  goals,
  people,
  projects,
  runs,
  tasks,
  taskWorkers,
} from "../schema.js";
import { recordLinks } from "./documents.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { owners, type PersonRecord, personColumns, toPerson, workers } from "./people.js";
import { mayWorkIn, visibleTo } from "./projects.js";
import { titleMatches } from "./search.js";

// The work on the board of a project. Every change is one transaction with the event that
// records it, and every read is scoped to the project: a task of another is not found. The
// plan of a task is two days people set; what happened to it is two moments the board keeps
// itself (ADR-0019). A task has one owner and any number of workers (ADR-0037).

export interface TaskRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: TaskState;
  readonly priority: TaskPriority;
  readonly owner: PersonRecord;
  /** The people at work on it, in the order they came to it; none while nobody is. */
  readonly workers: readonly PersonRecord[];
  readonly parentId: string | undefined;
  /** The category the task is sorted into, as the workspace keeps it. */
  readonly category:
    | { readonly key: string; readonly name: string; readonly color: CategoryColor }
    | undefined;
  /** The goal of the project's roadmap the task works towards. */
  readonly goalId: string | undefined;
  /** The plan: the day the work is meant to begin, and the day it is due (`2026-10-20`). */
  readonly startsOn: string | undefined;
  readonly dueOn: string | undefined;
  /** What happened: when the task was first moved past ready, and when it was moved to done. */
  readonly startedAt: Date | undefined;
  readonly doneAt: Date | undefined;
  /** When the task was put away (ADR-0029): out of the listings and the board, open by its number; none while current. */
  readonly archivedAt: Date | undefined;
  readonly links: readonly RestTaskLink[];
  /** How many decisions about the task wait for a person. */
  readonly openDecisions: number;
  /** How many runs are at work on it, or waiting. */
  readonly openRuns: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What is wrong with a task a person asked for. `code` is what the API answers with. */
export class TaskError extends DomainError {
  constructor(
    code:
      | "task.not_found"
      | "task.invalid_worker"
      | "task.invalid_parent"
      | "task.invalid_category"
      | "task.invalid_goal"
      | "task.invalid_dates",
  ) {
    super(code, TASK_ERROR_WORDS[code]);
  }
}

const TASK_ERROR_WORDS = {
  "task.not_found": "the task was not found",
  "task.invalid_worker": "a worker is not a person who may work in the project",
  "task.invalid_parent": "the parent is not a task of the project, or would make a loop",
  "task.invalid_category": "the category is not one of the workspace",
  "task.invalid_goal": "the goal is not one of the project",
  "task.invalid_dates": "the due day is before the start",
} as const;

export interface TaskInput {
  readonly title: string;
  readonly body?: string;
  readonly state?: TaskState;
  readonly priority?: TaskPriority;
  /** The people to be at work on it, in place of those there were; `[]` for nobody. */
  readonly workerIds?: readonly string[];
  readonly parentId?: string | null;
  /** The key of a category of the workspace, or none. */
  readonly category?: string | null;
  readonly goalId?: string | null;
  readonly startsOn?: string | null;
  readonly dueOn?: string | null;
  readonly links?: readonly RestTaskLink[];
}

/** Only what changes; a key that is absent leaves the field as it is. */
export type TaskPatch = Partial<TaskInput>;

/** What the board is narrowed to, as the API takes it. */
export interface TaskFilter {
  readonly state?: TaskState | undefined;
  /** True for the tasks not done or dropped; false for the rest. */
  readonly open?: boolean | undefined;
  /** The key of a category. */
  readonly category?: string | undefined;
  readonly goalId?: string | undefined;
  /** A person among the workers of the tasks. */
  readonly workerId?: string | undefined;
  /** True for the tasks with no worker. */
  readonly unassigned?: boolean | undefined;
  /** A day: the tasks due on it or before it. */
  readonly dueBy?: string | undefined;
  /** Words of the title, each found in it whatever the case; `#12` or `12` finds the task of that number too. */
  readonly query?: string | undefined;
  /** True for the tasks put away alone (ADR-0029); false, or left out, for the current ones. */
  readonly archived?: boolean | undefined;
  readonly limit: number;
  readonly offset?: number | undefined;
}

/** How far up a chain of parents is looked at before a loop is assumed. */
const MAX_PARENT_DEPTH = 50;

/** The states past `ready`: a task in one of them has been started. */
const STARTED_STATES: readonly TaskState[] = ["in_progress", "in_review", "done"];

const openDecisionsOf = sql<number>`(select count(*) from ${decisions} where ${decisions.taskId} = ${tasks.id} and ${decisions.answeredAt} is null)`;
const openRunsOf = sql<number>`(select count(*) from ${runs} where ${runs.taskId} = ${tasks.id} and ${runs.status} in ('running', 'waiting'))`;

/** A worker as the database hands one back inside the task's row: the person's columns, as JSON. */
const workerRow = z.object({
  id: z.string(),
  workspaceId: z.string(),
  host: z.string(),
  hostAccountId: z.string(),
  login: z.string(),
  name: z.nullable(z.string()),
  avatarUrl: z.nullable(z.string()),
  role: z.string(),
  status: z.string(),
  source: z.string(),
  deactivatedAt: z.nullable(z.string()),
});
const workerRows = z.array(workerRow);

/** The workers of a task, read back from the JSON the row carries them in. */
function toWorkers(value: unknown): PersonRecord[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return workerRows.parse(parsed ?? []).map((row) =>
    toPerson({
      ...row,
      deactivatedAt: row.deactivatedAt === null ? null : new Date(row.deactivatedAt),
    }),
  );
}

/**
 * The workers of the task being read, in the order they came to it, as one JSON array: a page of
 * tasks stays one query, however many people are on each.
 */
const workersOf = sql<unknown>`(select coalesce(json_agg(json_build_object('id', ${people.id}, 'workspaceId', ${people.workspaceId}, 'host', ${people.host}, 'hostAccountId', ${people.hostAccountId}, 'login', ${people.login}, 'name', ${people.name}, 'avatarUrl', ${people.avatarUrl}, 'role', ${people.role}, 'status', ${people.status}, 'source', ${people.source}, 'deactivatedAt', ${people.deactivatedAt}) order by ${taskWorkers.addedAt}, ${people.login}), '[]'::json) from ${taskWorkers} join ${people} on ${people.id} = ${taskWorkers.personId} where ${taskWorkers.taskId} = ${tasks.id})`;

const taskColumns = {
  id: tasks.id,
  workspaceId: tasks.workspaceId,
  projectId: tasks.projectId,
  number: tasks.number,
  title: tasks.title,
  body: tasks.body,
  state: tasks.state,
  priority: tasks.priority,
  parentId: tasks.parentId,
  goalId: tasks.goalId,
  startsOn: tasks.startsOn,
  dueOn: tasks.dueOn,
  startedAt: tasks.startedAt,
  doneAt: tasks.doneAt,
  archivedAt: tasks.archivedAt,
  links: tasks.links,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  owner: personColumns(owners),
  workers: workersOf.mapWith(toWorkers),
  categoryKey: categories.key,
  categoryName: categories.name,
  categoryColor: categories.color,
  openDecisions: openDecisionsOf.mapWith(Number),
  openRuns: openRunsOf.mapWith(Number),
};

type Handle = Transaction | ReturnType<typeof drizzleOf>;
type TaskRow = Awaited<ReturnType<typeof selectTasks>>[number];

/** For this file only: the select every read of a task shares. */
function selectTasks(handle: Handle) {
  return handle
    .select(taskColumns)
    .from(tasks)
    .innerJoin(owners, eq(owners.id, tasks.ownerId))
    .leftJoin(categories, eq(categories.id, tasks.categoryId));
}

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    number: row.number,
    title: row.title,
    body: row.body,
    state: row.state,
    priority: row.priority,
    owner: toPerson(row.owner),
    workers: row.workers,
    parentId: row.parentId ?? undefined,
    category:
      row.categoryKey === null || row.categoryName === null || row.categoryColor === null
        ? undefined
        : { key: row.categoryKey, name: row.categoryName, color: row.categoryColor },
    goalId: row.goalId ?? undefined,
    startsOn: row.startsOn ?? undefined,
    dueOn: row.dueOn ?? undefined,
    startedAt: row.startedAt ?? undefined,
    doneAt: row.doneAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    links: row.links,
    openDecisions: row.openDecisions,
    openRuns: row.openRuns,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readTask(
  handle: Handle,
  scope: Scope,
  taskId: string,
): Promise<TaskRecord | undefined> {
  const [row] = await selectTasks(handle)
    .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.id, taskId)))
    .limit(1);
  return row === undefined ? undefined : toTask(row);
}

/** The ids of the people at work on a task, in the order they came to it. */
export async function workerIdsOf(handle: Handle, taskId: string): Promise<string[]> {
  const rows = await handle
    .select({ personId: taskWorkers.personId })
    .from(taskWorkers)
    .innerJoin(people, eq(people.id, taskWorkers.personId))
    .where(eq(taskWorkers.taskId, taskId))
    .orderBy(taskWorkers.addedAt, people.login);
  return rows.map((row) => row.personId);
}

/** Each id once, in the order first given. */
const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/**
 * Everyone put on a task must be a person of the workspace who may work in the project. Only
 * the newcomers are asked: a person already on the task stays what they are, deactivated or
 * not, since they are a fact of the task.
 */
async function checkWorkers(
  tx: Transaction,
  scope: Scope,
  newcomers: readonly string[],
): Promise<void> {
  if (newcomers.length === 0) {
    return;
  }
  const rows = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(
      and(
        eq(workers.workspaceId, scope.workspaceId),
        inArray(workers.id, [...newcomers]),
        mayWorkIn(scope.projectId, workers.id),
      ),
    );
  if (rows.length !== newcomers.length) {
    throw new TaskError("task.invalid_worker");
  }
}

/** Puts the newcomers on the task, and takes off those who are no longer named; the rest keep their place. */
async function setWorkers(
  tx: Transaction,
  taskId: string,
  current: readonly string[],
  next: readonly string[],
  now: Date,
): Promise<void> {
  const gone = current.filter((id) => !next.includes(id));
  const added = next.filter((id) => !current.includes(id));
  if (gone.length > 0) {
    await tx
      .delete(taskWorkers)
      .where(and(eq(taskWorkers.taskId, taskId), inArray(taskWorkers.personId, gone)));
  }
  if (added.length > 0) {
    await tx
      .insert(taskWorkers)
      .values(added.map((personId) => ({ taskId, personId, addedAt: now })));
  }
}

/**
 * The parent must be a task of this project, and not the task itself or one of its own
 * descendants: a chain of parents has to end somewhere.
 */
async function checkParent(
  tx: Transaction,
  scope: Scope,
  taskId: string | undefined,
  parentId: string | null | undefined,
): Promise<void> {
  if (parentId === undefined || parentId === null) {
    return;
  }
  let current: string | undefined = parentId;
  for (let depth = 0; depth < MAX_PARENT_DEPTH && current !== undefined; depth += 1) {
    if (current === taskId) {
      throw new TaskError("task.invalid_parent");
    }
    const [row] = await tx
      .select({ parentId: tasks.parentId })
      .from(tasks)
      .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.id, current)))
      .limit(1);
    if (row === undefined) {
      throw new TaskError("task.invalid_parent");
    }
    current = row.parentId ?? undefined;
  }
  if (current !== undefined) {
    throw new TaskError("task.invalid_parent");
  }
}

/** The category, named by its key, must be one of the workspace: its id, or `null` for none, or as it was. */
async function categoryIdOf(
  tx: Transaction,
  scope: Scope,
  key: string | null | undefined,
): Promise<string | null | undefined> {
  if (key === undefined || key === null) {
    return key;
  }
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.workspaceId, scope.workspaceId), eq(categories.key, key)))
    .limit(1);
  if (row === undefined) {
    throw new TaskError("task.invalid_category");
  }
  return row.id;
}

/** The goal must be one of the project. */
async function checkGoal(
  tx: Transaction,
  scope: Scope,
  goalId: string | null | undefined,
): Promise<void> {
  if (goalId === undefined || goalId === null) {
    return;
  }
  const [row] = await tx
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.projectId, scope.projectId), eq(goals.id, goalId)))
    .limit(1);
  if (row === undefined) {
    throw new TaskError("task.invalid_goal");
  }
}

/** A plan whose due day comes before its start is no plan. Days compare as the strings they are. */
function checkDates(startsOn: string | null, dueOn: string | null): void {
  if (startsOn !== null && dueOn !== null && dueOn < startsOn) {
    throw new TaskError("task.invalid_dates");
  }
}

/** Writes a task down, numbered after the project's last, owned by whoever wrote it, and tells the board. */
export async function createTask(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly task: TaskInput;
    readonly now: Date;
  },
): Promise<TaskRecord> {
  const { scope, actor, task, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const workerIds = unique(task.workerIds ?? []);
    await checkWorkers(tx, scope, workerIds);
    await checkParent(tx, scope, undefined, task.parentId);
    const categoryId = await categoryIdOf(tx, scope, task.category);
    await checkGoal(tx, scope, task.goalId);
    checkDates(task.startsOn ?? null, task.dueOn ?? null);
    const state = task.state ?? "idea";
    // The counter is bumped under the row lock the update takes, so two tasks written at once
    // get two numbers.
    const [counter] = await tx
      .update(projects)
      .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
      .where(eq(projects.id, scope.projectId))
      .returning({ number: sql<number>`${projects.nextTaskNumber} - 1`.mapWith(Number) });
    if (counter === undefined) {
      throw new Error("the project was not found");
    }
    const [inserted] = await tx
      .insert(tasks)
      .values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        number: counter.number,
        title: task.title,
        body: task.body ?? "",
        state,
        priority: task.priority ?? "normal",
        ownerId: actor.id,
        parentId: task.parentId ?? null,
        categoryId: categoryId ?? null,
        goalId: task.goalId ?? null,
        startsOn: task.startsOn ?? null,
        dueOn: task.dueOn ?? null,
        // A task written past ready has been started; one written done is done now.
        startedAt: STARTED_STATES.includes(state) ? now : null,
        doneAt: state === "done" ? now : null,
        links: [...(task.links ?? [])],
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: tasks.id });
    if (inserted === undefined) {
      throw new Error("task insert returned no row");
    }
    await setWorkers(tx, inserted.id, [], workerIds, now);
    await recordLinks(tx, scope, { kind: "task", id: inserted.id }, [task.body ?? ""], now);
    await recordEvent(tx, {
      ...scope,
      kind: "task.created",
      actor,
      taskId: inserted.id,
      data: { number: counter.number, title: task.title },
      now,
    });
    const written = await readTask(tx, scope, inserted.id);
    if (written === undefined) {
      throw new Error("the task written was not found");
    }
    return written;
  });
}

/**
 * Changes what the patch names and tells the board what changed: a move from one state to
 * another is an event of its own, the rest is one event naming the fields. A patch that changes
 * nothing is no event. Rejects with a {@link TaskError} for a task that is not there.
 */
export async function updateTask(database: Database, input: TaskUpdate): Promise<TaskRecord> {
  return drizzleOf(database).transaction((tx) => updateTaskIn(tx, input));
}

export interface TaskUpdate {
  readonly scope: Scope;
  readonly actor: Actor;
  readonly taskId: string;
  readonly patch: TaskPatch;
  readonly now: Date;
}

/** {@link updateTask} inside a transaction of the caller's: a change that is part of a larger one. */
export async function updateTaskIn(tx: Transaction, input: TaskUpdate): Promise<TaskRecord> {
  const { scope, actor, taskId, patch, now } = input;
  const [current] = await tx
    .select({
      title: tasks.title,
      body: tasks.body,
      state: tasks.state,
      priority: tasks.priority,
      parentId: tasks.parentId,
      categoryId: tasks.categoryId,
      goalId: tasks.goalId,
      startsOn: tasks.startsOn,
      dueOn: tasks.dueOn,
      startedAt: tasks.startedAt,
      doneAt: tasks.doneAt,
      links: tasks.links,
      number: tasks.number,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.id, taskId)))
    .for("update");
  if (current === undefined) {
    throw new TaskError("task.not_found");
  }
  const currentWorkers = await workerIdsOf(tx, taskId);
  const nextWorkers = patch.workerIds === undefined ? currentWorkers : unique(patch.workerIds);
  await checkWorkers(
    tx,
    scope,
    nextWorkers.filter((id) => !currentWorkers.includes(id)),
  );
  await checkParent(tx, scope, taskId, patch.parentId);
  const categoryId = await categoryIdOf(tx, scope, patch.category);
  await checkGoal(tx, scope, patch.goalId);

  const changed: string[] = [];
  const next = {
    title: patch.title ?? current.title,
    body: patch.body ?? current.body,
    state: patch.state ?? current.state,
    priority: patch.priority ?? current.priority,
    parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
    categoryId: categoryId === undefined ? current.categoryId : categoryId,
    goalId: patch.goalId === undefined ? current.goalId : patch.goalId,
    startsOn: patch.startsOn === undefined ? current.startsOn : patch.startsOn,
    dueOn: patch.dueOn === undefined ? current.dueOn : patch.dueOn,
    links: patch.links === undefined ? current.links : [...patch.links],
  };
  checkDates(next.startsOn, next.dueOn);
  for (const field of ["title", "body", "priority", "parentId"] as const) {
    if (next[field] !== current[field]) {
      changed.push(field);
    }
  }
  // The workers are a set: the same people in another order are the same workers.
  const workersChanged =
    nextWorkers.length !== currentWorkers.length ||
    nextWorkers.some((id) => !currentWorkers.includes(id));
  if (workersChanged) {
    changed.push("workers");
  }
  // Named on the wire as the API takes them, so that a feed says what a person changed.
  if (next.categoryId !== current.categoryId) {
    changed.push("category");
  }
  for (const field of ["goalId", "startsOn", "dueOn"] as const) {
    if (next[field] !== current[field]) {
      changed.push(field);
    }
  }
  if (JSON.stringify(next.links) !== JSON.stringify(current.links)) {
    changed.push("links");
  }
  const moved = next.state !== current.state;
  if (changed.length === 0 && !moved) {
    const unchanged = await readTask(tx, scope, taskId);
    if (unchanged === undefined) {
      throw new TaskError("task.not_found");
    }
    return unchanged;
  }
  // What happened, kept by the board: the first move past ready is the start, a move to done
  // is the end, and a move back out of done takes the end away again.
  const startedAt = current.startedAt ?? (STARTED_STATES.includes(next.state) ? now : null);
  const doneAt = next.state === "done" ? (current.state === "done" ? current.doneAt : now) : null;
  await tx
    .update(tasks)
    .set({ ...next, startedAt, doneAt, updatedAt: now })
    .where(eq(tasks.id, taskId));
  if (workersChanged) {
    await setWorkers(tx, taskId, currentWorkers, nextWorkers, now);
  }
  if (changed.includes("body")) {
    await recordLinks(tx, scope, { kind: "task", id: taskId }, [next.body], now);
  }
  if (moved) {
    await recordEvent(tx, {
      ...scope,
      kind: "task.moved",
      actor,
      taskId,
      data: { number: current.number, title: next.title, from: current.state, to: next.state },
      now,
    });
  }
  if (changed.length > 0) {
    await recordEvent(tx, {
      ...scope,
      kind: "task.updated",
      actor,
      taskId,
      data: { number: current.number, title: next.title, fields: changed },
      now,
    });
  }
  const written = await readTask(tx, scope, taskId);
  if (written === undefined) {
    throw new TaskError("task.not_found");
  }
  return written;
}

/** A task by the number people say out loud, within the project. */
export async function findTaskByNumber(
  database: Database,
  scope: Scope,
  number: number,
): Promise<TaskRecord | undefined> {
  const [row] = await selectTasks(drizzleOf(database))
    .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.number, number)))
    .limit(1);
  return row === undefined ? undefined : toTask(row);
}

export function getTask(
  database: Database,
  scope: Scope,
  taskId: string,
): Promise<TaskRecord | undefined> {
  return readTask(drizzleOf(database), scope, taskId);
}

/** On the task being read: whether `personId` is among its workers. */
const hasWorker = (personId: string): SQL =>
  sql`exists (select 1 from ${taskWorkers} where ${taskWorkers.taskId} = ${tasks.id} and ${taskWorkers.personId} = ${personId})`;

/** On the task being read: whether nobody is at work on it. */
const hasNoWorker: SQL = sql`not exists (select 1 from ${taskWorkers} where ${taskWorkers.taskId} = ${tasks.id})`;

/** A task's number as a query names one: `12` or `#12`; nothing for any other text. */
const NUMBER_QUERY = /^#?(\d{1,9})$/;

/** On the task being read: whether the title holds the words of the query, or the number is the query's. */
function matching(query: string): SQL {
  const number = NUMBER_QUERY.exec(query.trim());
  const byTitle = titleMatches(tasks.title, query);
  return number === null ? byTitle : sql`(${byTitle} or ${tasks.number} = ${Number(number[1])})`;
}

/** The conditions a filter adds to a read of the board. */
function narrowing(filter: Omit<TaskFilter, "limit">): (SQL | undefined)[] {
  return [
    filter.state === undefined ? undefined : eq(tasks.state, filter.state),
    filter.open === undefined
      ? undefined
      : filter.open
        ? inArray(tasks.state, [...OPEN_TASK_STATES])
        : notInArray(tasks.state, [...OPEN_TASK_STATES]),
    filter.category === undefined ? undefined : eq(categories.key, filter.category),
    filter.goalId === undefined ? undefined : eq(tasks.goalId, filter.goalId),
    filter.workerId === undefined ? undefined : hasWorker(filter.workerId),
    filter.unassigned === true ? hasNoWorker : undefined,
    filter.dueBy === undefined ? undefined : lte(tasks.dueOn, filter.dueBy),
    filter.query === undefined ? undefined : matching(filter.query),
    // The archive and the board are two listings, never one (ADR-0029).
    filter.archived === true ? isNotNull(tasks.archivedAt) : isNull(tasks.archivedAt),
  ];
}

/** A page of the board of the project, newest first, or of what the filter keeps of it; and whether there is more. */
export async function listTasks(
  database: Database,
  scope: Scope,
  filter: TaskFilter,
): Promise<{ readonly items: TaskRecord[]; readonly more: boolean }> {
  const rows = await selectTasks(drizzleOf(database))
    .where(and(eq(tasks.projectId, scope.projectId), ...narrowing(filter)))
    .orderBy(desc(tasks.number))
    .limit(filter.limit + 1)
    .offset(filter.offset ?? 0);
  return { items: rows.slice(0, filter.limit).map(toTask), more: rows.length > filter.limit };
}

/**
 * What is on a person's plate: the open tasks `worker` is at work on, within the projects
 * `viewer` may see and no other, the sooner due first and those with no day last; a task put
 * away is not on it (ADR-0030). The viewer is the person themselves on their own page, and
 * whoever oversees them on theirs.
 */
export async function listTasksOf(
  database: Database,
  workspaceId: string,
  worker: { readonly id: string },
  viewer: PersonRecord,
  limit: number,
): Promise<TaskRecord[]> {
  const rows = await selectTasks(drizzleOf(database))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        hasWorker(worker.id),
        inArray(tasks.state, [...OPEN_TASK_STATES]),
        isNull(tasks.archivedAt),
        visibleTo(viewer),
      ),
    )
    .orderBy(sql`${tasks.dueOn} asc nulls last`, desc(tasks.number))
    .limit(limit);
  return rows.map(toTask);
}

/**
 * What a person's plate shows of what was: the tasks `worker` was at work on that are done or
 * dropped and not yet put away, within the projects `viewer` may see, the last closed first,
 * so that the week on the plate shows them on their days as a project's calendar does.
 */
export async function listClosedTasksOf(
  database: Database,
  workspaceId: string,
  worker: { readonly id: string },
  viewer: PersonRecord,
  limit: number,
): Promise<TaskRecord[]> {
  const rows = await selectTasks(drizzleOf(database))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        hasWorker(worker.id),
        notInArray(tasks.state, [...OPEN_TASK_STATES]),
        isNull(tasks.archivedAt),
        visibleTo(viewer),
      ),
    )
    // A dropped task has no moment of its own: when it was last changed is when it was dropped.
    .orderBy(sql`coalesce(${tasks.doneAt}, ${tasks.updatedAt}) desc`, desc(tasks.number))
    .limit(limit);
  return rows.map(toTask);
}

/** The tasks that are part of one, oldest first. */
export async function listSubtasks(
  database: Database,
  scope: Scope,
  parentId: string | null,
  limit: number,
): Promise<TaskRecord[]> {
  const rows = await selectTasks(drizzleOf(database))
    .where(
      and(
        eq(tasks.projectId, scope.projectId),
        parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, parentId),
      ),
    )
    .orderBy(tasks.number)
    .limit(limit);
  return rows.map(toTask);
}

/** The states the console puts a task away in by itself, and a goal takes along: what is over. */
const CLOSED_STATES: readonly TaskState[] = ["done", "dropped"];
/** How many tasks one pass of the console's own archiving puts away: enough, in a short transaction. */
const ARCHIVE_PASS_LIMIT = 500;

/**
 * Puts a task away (ADR-0029): a moment the board keeps, not a state, from any state by a
 * person's hand (ADR-0030); one put away already stays as it is, and nothing is written.
 */
export async function archiveTask(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly taskId: string;
    readonly now: Date;
  },
): Promise<TaskRecord> {
  const { scope, actor, taskId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select({ number: tasks.number, title: tasks.title, archivedAt: tasks.archivedAt })
      .from(tasks)
      .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.id, taskId)))
      .for("update");
    if (current === undefined) {
      throw new TaskError("task.not_found");
    }
    if (current.archivedAt === null) {
      await tx.update(tasks).set({ archivedAt: now, updatedAt: now }).where(eq(tasks.id, taskId));
      await recordEvent(tx, {
        ...scope,
        kind: "task.archived",
        actor,
        taskId,
        data: { number: current.number, title: current.title },
        now,
      });
    }
    const written = await readTask(tx, scope, taskId);
    if (written === undefined) {
      throw new Error("the task put away was not found");
    }
    return written;
  });
}

/** Brings a task back from the archive; one that is current stays as it is, and nothing is written. */
export async function restoreTask(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly taskId: string;
    readonly now: Date;
  },
): Promise<TaskRecord> {
  const { scope, actor, taskId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select({ number: tasks.number, title: tasks.title, archivedAt: tasks.archivedAt })
      .from(tasks)
      .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.id, taskId)))
      .for("update");
    if (current === undefined) {
      throw new TaskError("task.not_found");
    }
    if (current.archivedAt !== null) {
      await tx.update(tasks).set({ archivedAt: null, updatedAt: now }).where(eq(tasks.id, taskId));
      await recordEvent(tx, {
        ...scope,
        kind: "task.restored",
        actor,
        taskId,
        data: { number: current.number, title: current.title },
        now,
      });
    }
    const written = await readTask(tx, scope, taskId);
    if (written === undefined) {
      throw new Error("the task brought back was not found");
    }
    return written;
  });
}

/**
 * Puts every done or dropped task of a goal away at once, each with its own event, and answers
 * how many went. A goal that is not the project's, or has nothing to put away, is zero.
 */
export async function archiveTasksOfGoal(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly goalId: string;
    readonly now: Date;
  },
): Promise<number> {
  const { scope, actor, goalId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const rows = await tx
      .select({ id: tasks.id, number: tasks.number, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, scope.projectId),
          eq(tasks.goalId, goalId),
          inArray(tasks.state, [...CLOSED_STATES]),
          isNull(tasks.archivedAt),
        ),
      )
      .for("update");
    for (const row of rows) {
      await tx.update(tasks).set({ archivedAt: now, updatedAt: now }).where(eq(tasks.id, row.id));
      await recordEvent(tx, {
        ...scope,
        kind: "task.archived",
        actor,
        taskId: row.id,
        data: { number: row.number, title: row.title },
        now,
      });
    }
    return rows.length;
  });
}

/**
 * What the console puts away by itself (ADR-0029): every task done or dropped and not touched
 * since `before`, across the projects, a bounded number per pass, each with an event that names
 * no actor. Answers how many went.
 */
export async function archiveStaleTasks(
  database: Database,
  input: { readonly before: Date; readonly now: Date },
): Promise<number> {
  const { before, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const rows = await tx
      .select({
        id: tasks.id,
        workspaceId: tasks.workspaceId,
        projectId: tasks.projectId,
        number: tasks.number,
        title: tasks.title,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.state, [...CLOSED_STATES]),
          isNull(tasks.archivedAt),
          lt(tasks.updatedAt, before),
        ),
      )
      .orderBy(tasks.updatedAt)
      .limit(ARCHIVE_PASS_LIMIT)
      .for("update");
    for (const row of rows) {
      await tx.update(tasks).set({ archivedAt: now, updatedAt: now }).where(eq(tasks.id, row.id));
      await recordEvent(tx, {
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        kind: "task.archived",
        actor: undefined,
        taskId: row.id,
        data: { number: row.number, title: row.title },
        now,
      });
    }
    return rows.length;
  });
}
