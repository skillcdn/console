import type { RestTaskLink, TaskPriority, TaskState } from "@skillcdn/console/api";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { decisions, people, projects, runs, tasks } from "../schema.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { assignees, owners, type PersonRecord, personColumns, toPerson } from "./people.js";
import { mayWorkIn } from "./projects.js";

// The work on the board of a project. Every change is one transaction with the event that
// records it, and every read is scoped to the project: a task of another is not found.

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
  constructor(code: "task.not_found" | "task.invalid_assignee" | "task.invalid_parent") {
    super(
      code,
      code === "task.not_found"
        ? "the task was not found"
        : code === "task.invalid_assignee"
          ? "the assignee is not a person of the project"
          : "the parent is not a task of the project, or would make a loop",
    );
  }
}

export interface TaskInput {
  readonly title: string;
  readonly body?: string;
  readonly state?: TaskState;
  readonly priority?: TaskPriority;
  readonly assigneeId?: string | null;
  readonly parentId?: string | null;
  readonly links?: readonly RestTaskLink[];
}

/** Only what changes; a key that is absent leaves the field as it is. */
export type TaskPatch = Partial<TaskInput>;

/** How far up a chain of parents is looked at before a loop is assumed. */
const MAX_PARENT_DEPTH = 50;

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
  links: tasks.links,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  owner: personColumns(owners),
  assignee: personColumns(assignees),
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
    .leftJoin(assignees, eq(assignees.id, tasks.assigneeId));
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
        state: task.state ?? "idea",
        priority: task.priority ?? "normal",
        ownerId: actor.id,
        assigneeId: task.assigneeId ?? null,
        parentId: task.parentId ?? null,
        links: [...(task.links ?? [])],
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: tasks.id });
    if (inserted === undefined) {
      throw new Error("task insert returned no row");
    }
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

  const changed: string[] = [];
  const next = {
    title: patch.title ?? current.title,
    body: patch.body ?? current.body,
    state: patch.state ?? current.state,
    priority: patch.priority ?? current.priority,
    assigneeId: patch.assigneeId === undefined ? current.assigneeId : patch.assigneeId,
    parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
    links: patch.links === undefined ? current.links : [...patch.links],
  };
  for (const field of ["title", "body", "priority", "assigneeId", "parentId"] as const) {
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
  await tx
    .update(tasks)
    .set({ ...next, updatedAt: now })
    .where(eq(tasks.id, taskId));
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

/** The board of the project, newest first, or one state of it. */
export async function listTasks(
  database: Database,
  scope: Scope,
  filter: { readonly state?: TaskState | undefined; readonly limit: number },
): Promise<TaskRecord[]> {
  const rows = await selectTasks(drizzleOf(database))
    .where(
      and(
        eq(tasks.projectId, scope.projectId),
        filter.state === undefined ? undefined : eq(tasks.state, filter.state),
      ),
    )
    .orderBy(desc(tasks.number))
    .limit(filter.limit);
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
