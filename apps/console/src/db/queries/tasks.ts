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
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { categories, decisions, goals, people, projects, runs, tasks } from "../schema.js";
import { recordLinks } from "./documents.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { assignees, owners, type PersonRecord, personColumns, toPerson } from "./people.js";
import { mayWorkIn, visibleTo } from "./projects.js";

// The work on the board of a project. Every change is one transaction with the event that
// records it, and every read is scoped to the project: a task of another is not found. The
// plan of a task is two days people set; what happened to it is two moments the board keeps
// itself (ADR-0019).

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
  readonly assignee: PersonRecord | undefined;
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
      | "task.invalid_assignee"
      | "task.invalid_parent"
      | "task.invalid_category"
      | "task.invalid_goal"
      | "task.invalid_dates"
      | "task.open",
  ) {
    super(code, TASK_ERROR_WORDS[code]);
  }
}

const TASK_ERROR_WORDS = {
  "task.not_found": "the task was not found",
  "task.invalid_assignee": "the assignee is not a person of the project",
  "task.invalid_parent": "the parent is not a task of the project, or would make a loop",
  "task.invalid_category": "the category is not one of the workspace",
  "task.invalid_goal": "the goal is not one of the project",
  "task.invalid_dates": "the due day is before the start",
  "task.open": "an open task is not put away; one done or dropped is",
} as const;

export interface TaskInput {
  readonly title: string;
  readonly body?: string;
  readonly state?: TaskState;
  readonly priority?: TaskPriority;
  readonly assigneeId?: string | null;
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
  readonly assigneeId?: string | undefined;
  /** A day: the tasks due on it or before it. */
  readonly dueBy?: string | undefined;
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
  assignee: personColumns(assignees),
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
    .leftJoin(assignees, eq(assignees.id, tasks.assigneeId))
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
    assignee: row.assignee === null ? undefined : toPerson(row.assignee),
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

/** The assignee must be a person of the workspace who may work in the project. */
async function checkAssignee(
  tx: Transaction,
  scope: Scope,
  assigneeId: string | null | undefined,
): Promise<void> {
  if (assigneeId === undefined || assigneeId === null) {
    return;
  }
  const [row] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.workspaceId, scope.workspaceId),
        eq(people.id, assigneeId),
        mayWorkIn(scope.projectId, assigneeId),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new TaskError("task.invalid_assignee");
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
    await checkAssignee(tx, scope, task.assigneeId);
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
        assigneeId: task.assigneeId ?? null,
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
      assigneeId: tasks.assigneeId,
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
  await checkAssignee(tx, scope, patch.assigneeId);
  await checkParent(tx, scope, taskId, patch.parentId);
  const categoryId = await categoryIdOf(tx, scope, patch.category);
  await checkGoal(tx, scope, patch.goalId);

  const changed: string[] = [];
  const next = {
    title: patch.title ?? current.title,
    body: patch.body ?? current.body,
    state: patch.state ?? current.state,
    priority: patch.priority ?? current.priority,
    assigneeId: patch.assigneeId === undefined ? current.assigneeId : patch.assigneeId,
    parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
    categoryId: categoryId === undefined ? current.categoryId : categoryId,
    goalId: patch.goalId === undefined ? current.goalId : patch.goalId,
    startsOn: patch.startsOn === undefined ? current.startsOn : patch.startsOn,
    dueOn: patch.dueOn === undefined ? current.dueOn : patch.dueOn,
    links: patch.links === undefined ? current.links : [...patch.links],
  };
  checkDates(next.startsOn, next.dueOn);
  for (const field of ["title", "body", "priority", "assigneeId", "parentId"] as const) {
    if (next[field] !== current[field]) {
      changed.push(field);
    }
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
    filter.assigneeId === undefined ? undefined : eq(tasks.assigneeId, filter.assigneeId),
    filter.dueBy === undefined ? undefined : lte(tasks.dueOn, filter.dueBy),
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
 * What is on a person's plate: the open tasks assigned to `assignee`, within the projects
 * `viewer` may see and no other, the sooner due first and those with no day last. The viewer
 * is the person themselves on their own page, and whoever oversees them on theirs.
 */
export async function listTasksAssignedTo(
  database: Database,
  workspaceId: string,
  assignee: { readonly id: string },
  viewer: PersonRecord,
  limit: number,
): Promise<TaskRecord[]> {
  const rows = await selectTasks(drizzleOf(database))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.assigneeId, assignee.id),
        inArray(tasks.state, [...OPEN_TASK_STATES]),
        visibleTo(viewer),
      ),
    )
    .orderBy(sql`${tasks.dueOn} asc nulls last`, desc(tasks.number))
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

/** The states a task is put away in: what is over. */
const CLOSED_STATES: readonly TaskState[] = ["done", "dropped"];
/** How many tasks one pass of the console's own archiving puts away: enough, in a short transaction. */
const ARCHIVE_PASS_LIMIT = 500;

/**
 * Puts a task away (ADR-0029): a moment the board keeps, not a state. Only a task done or
 * dropped goes (`task.open`); one put away already stays as it is, and nothing is written.
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
      .select({
        number: tasks.number,
        title: tasks.title,
        state: tasks.state,
        archivedAt: tasks.archivedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.id, taskId)))
      .for("update");
    if (current === undefined) {
      throw new TaskError("task.not_found");
    }
    if (!CLOSED_STATES.includes(current.state)) {
      throw new TaskError("task.open");
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
