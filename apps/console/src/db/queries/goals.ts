import type { CategoryColor, GoalState, RestTaskCounts } from "@skillcdn/console/api";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { categories, goals, tasks } from "../schema.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { type PersonRecord, personColumns, raisers, toPerson } from "./people.js";

// The roadmap of a project (ADR-0019): its goals, what it works towards and by when. A goal is
// planned in days as a task is, a start and a target, and sorted into a category of the
// workspace (ADR-0026). A goal's progress is never written down: it is read from the tasks
// that work towards it, counted by state, so that it is as current as the board. Every change
// is one transaction with the event that records it, and every read is scoped to the project.

export interface GoalRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly title: string;
  readonly body: string;
  readonly state: GoalState;
  /** The category the goal is sorted into, as the workspace keeps it. */
  readonly category:
    | { readonly key: string; readonly name: string; readonly color: CategoryColor }
    | undefined;
  /** The day the work towards it is meant to begin (`2026-10-01`), or none. */
  readonly startsOn: string | undefined;
  /** The day the goal is meant to be reached by (`2026-12-31`), or none. */
  readonly dueOn: string | undefined;
  readonly createdBy: PersonRecord;
  /** The tasks that work towards it, counted by state. */
  readonly taskCounts: RestTaskCounts;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What is wrong with a goal a person asked for. `code` is what the API answers with. */
export class GoalError extends DomainError {
  constructor(code: "goal.not_found" | "goal.invalid_category" | "goal.invalid_dates") {
    super(code, GOAL_ERROR_WORDS[code]);
  }
}

const GOAL_ERROR_WORDS = {
  "goal.not_found": "the goal was not found",
  "goal.invalid_category": "the category is not one of the workspace",
  "goal.invalid_dates": "the target day is before the start",
} as const;

export interface GoalInput {
  readonly title: string;
  readonly body?: string | undefined;
  readonly state?: GoalState | undefined;
  /** The key of a category of the workspace, or `null` for none. */
  readonly category?: string | null | undefined;
  readonly startsOn?: string | null | undefined;
  readonly dueOn?: string | null | undefined;
}

/** Only what changes; a key that is absent leaves the field as it is. */
export type GoalPatch = Partial<GoalInput>;

/** What the roadmap is narrowed by: the goals in one state, or sorted into one category. */
export interface GoalFilter {
  readonly state?: GoalState | undefined;
  /** The key of a category. */
  readonly category?: string | undefined;
}

type Handle = Transaction | ReturnType<typeof drizzleOf>;

/** How many of the goal's tasks are in one state: the package's literal, never input. */
const countIn = (state: string) =>
  sql<number>`(select count(*) from ${tasks} where ${tasks.goalId} = ${goals.id} and ${tasks.state} = ${sql.raw(`'${state}'`)})`.mapWith(
    Number,
  );

const goalColumns = {
  id: goals.id,
  workspaceId: goals.workspaceId,
  projectId: goals.projectId,
  title: goals.title,
  body: goals.body,
  state: goals.state,
  startsOn: goals.startsOn,
  dueOn: goals.dueOn,
  categoryKey: categories.key,
  categoryName: categories.name,
  categoryColor: categories.color,
  createdAt: goals.createdAt,
  updatedAt: goals.updatedAt,
  createdBy: personColumns(raisers),
  idea: countIn("idea"),
  ready: countIn("ready"),
  inProgress: countIn("in_progress"),
  inReview: countIn("in_review"),
  done: countIn("done"),
  dropped: countIn("dropped"),
};

/** The order a roadmap reads in: what is worked towards, what is next, what was reached, what was let go. */
const STATE_RANK: Readonly<Record<GoalState, number>> = {
  active: 0,
  planned: 1,
  done: 2,
  dropped: 3,
};

type GoalRow = Awaited<ReturnType<typeof selectGoals>>[number];

function selectGoals(handle: Handle) {
  return handle
    .select(goalColumns)
    .from(goals)
    .innerJoin(raisers, eq(raisers.id, goals.createdById))
    .leftJoin(categories, eq(categories.id, goals.categoryId));
}

function toGoal(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    title: row.title,
    body: row.body,
    state: row.state,
    category:
      row.categoryKey === null || row.categoryName === null || row.categoryColor === null
        ? undefined
        : { key: row.categoryKey, name: row.categoryName, color: row.categoryColor },
    startsOn: row.startsOn ?? undefined,
    dueOn: row.dueOn ?? undefined,
    createdBy: toPerson(row.createdBy),
    taskCounts: {
      idea: row.idea,
      ready: row.ready,
      in_progress: row.inProgress,
      in_review: row.inReview,
      done: row.done,
      dropped: row.dropped,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readGoal(
  handle: Handle,
  scope: Scope,
  goalId: string,
): Promise<GoalRecord | undefined> {
  const [row] = await selectGoals(handle)
    .where(and(eq(goals.projectId, scope.projectId), eq(goals.id, goalId)))
    .limit(1);
  return row === undefined ? undefined : toGoal(row);
}

export function getGoal(
  database: Database,
  scope: Scope,
  goalId: string,
): Promise<GoalRecord | undefined> {
  return readGoal(drizzleOf(database), scope, goalId);
}

/** The roadmap, or what the filter keeps of it: the active goals first, then the planned, the reached and the dropped; the sooner due first within each, then the older. */
export async function listGoals(
  database: Database,
  scope: Scope,
  limit: number,
  filter: GoalFilter = {},
): Promise<GoalRecord[]> {
  const conditions = [
    eq(goals.projectId, scope.projectId),
    filter.state === undefined ? undefined : eq(goals.state, filter.state),
    filter.category === undefined ? undefined : eq(categories.key, filter.category),
  ].filter((condition): condition is SQL => condition !== undefined);
  const rows = await selectGoals(drizzleOf(database))
    .where(and(...conditions))
    .limit(limit);
  return rows
    .map(toGoal)
    .sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
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
    throw new GoalError("goal.invalid_category");
  }
  return row.id;
}

/** A plan whose target comes before its start is no plan. Days compare as the strings they are. */
function checkDates(startsOn: string | null, dueOn: string | null): void {
  if (startsOn !== null && dueOn !== null && dueOn < startsOn) {
    throw new GoalError("goal.invalid_dates");
  }
}

/** Sets a goal on the roadmap and tells the board. */
export async function createGoal(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly goal: GoalInput;
    readonly now: Date;
  },
): Promise<GoalRecord> {
  const { scope, actor, goal, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const categoryId = await categoryIdOf(tx, scope, goal.category);
    checkDates(goal.startsOn ?? null, goal.dueOn ?? null);
    const [inserted] = await tx
      .insert(goals)
      .values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        title: goal.title,
        body: goal.body ?? "",
        state: goal.state ?? "planned",
        categoryId: categoryId ?? null,
        startsOn: goal.startsOn ?? null,
        dueOn: goal.dueOn ?? null,
        createdById: actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: goals.id });
    if (inserted === undefined) {
      throw new Error("goal insert returned no row");
    }
    await recordEvent(tx, {
      ...scope,
      kind: "goal.created",
      actor,
      goalId: inserted.id,
      data: { title: goal.title },
      now,
    });
    const written = await readGoal(tx, scope, inserted.id);
    if (written === undefined) {
      throw new Error("the goal written was not found");
    }
    return written;
  });
}

/** Changes what the patch names and tells the board which fields; a patch that changes nothing writes nothing. */
export async function updateGoal(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly goalId: string;
    readonly patch: GoalPatch;
    readonly now: Date;
  },
): Promise<GoalRecord> {
  const { scope, actor, goalId, patch, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select({
        title: goals.title,
        body: goals.body,
        state: goals.state,
        categoryId: goals.categoryId,
        startsOn: goals.startsOn,
        dueOn: goals.dueOn,
      })
      .from(goals)
      .where(and(eq(goals.projectId, scope.projectId), eq(goals.id, goalId)))
      .for("update");
    if (current === undefined) {
      throw new GoalError("goal.not_found");
    }
    const categoryId = await categoryIdOf(tx, scope, patch.category);
    const next = {
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      state: patch.state ?? current.state,
      categoryId: categoryId === undefined ? current.categoryId : categoryId,
      startsOn: patch.startsOn === undefined ? current.startsOn : patch.startsOn,
      dueOn: patch.dueOn === undefined ? current.dueOn : patch.dueOn,
    };
    checkDates(next.startsOn, next.dueOn);
    const changed: string[] = (["title", "body", "state"] as const).filter(
      (field) => next[field] !== current[field],
    );
    if (next.categoryId !== current.categoryId) {
      changed.push("category");
    }
    for (const field of ["startsOn", "dueOn"] as const) {
      if (next[field] !== current[field]) {
        changed.push(field);
      }
    }
    if (changed.length > 0) {
      await tx
        .update(goals)
        .set({ ...next, updatedAt: now })
        .where(eq(goals.id, goalId));
      await recordEvent(tx, {
        ...scope,
        kind: "goal.updated",
        actor,
        goalId,
        data: { title: next.title, fields: changed },
        now,
      });
    }
    const written = await readGoal(tx, scope, goalId);
    if (written === undefined) {
      throw new GoalError("goal.not_found");
    }
    return written;
  });
}
