import {
  type CategoryColor,
  type GoalState,
  MAX_GOALS_PER_PROJECT,
  OPEN_GOAL_STATES,
  type RestTaskCounts,
} from "@skillcdn/console/api";
import { and, asc, count, eq, inArray, notInArray, type SQL, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { categories, goals, projects, tasks } from "../schema.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { type PersonRecord, personColumns, raisers, toPerson } from "./people.js";
import { titleMatches } from "./search.js";

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
  constructor(
    code: "goal.not_found" | "goal.invalid_category" | "goal.invalid_dates" | "goal.too_many",
  ) {
    super(code, GOAL_ERROR_WORDS[code]);
  }
}

const GOAL_ERROR_WORDS = {
  "goal.not_found": "the goal was not found",
  "goal.invalid_category": "the category is not one of the workspace",
  "goal.invalid_dates": "the target day is before the start",
  "goal.too_many": "the project holds as many goals as one may",
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

/** What the roadmap is narrowed by, and which page of it, as the API takes it. */
export interface GoalFilter {
  readonly state?: GoalState | undefined;
  /** True for the goals planned or active; false for the reached and the dropped. */
  readonly open?: boolean | undefined;
  /** The key of a category. */
  readonly category?: string | undefined;
  /** Words of the title, each found in it whatever the case. */
  readonly query?: string | undefined;
  readonly limit: number;
  readonly offset?: number | undefined;
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

/** That order, for the database to sort a page by; the states are the package's literals, never input. */
const stateRank = sql`case ${goals.state} ${sql.raw(
  Object.entries(STATE_RANK)
    .map(([state, rank]) => `when '${state}' then ${rank}`)
    .join(" "),
)} else 9 end`;

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

/**
 * A page of the roadmap, or of what the filter keeps of it: the active goals first, then the
 * planned, the reached and the dropped; the sooner due first within each, then the older; and
 * whether there is more after the page.
 */
export async function listGoals(
  database: Database,
  scope: Scope,
  filter: GoalFilter,
): Promise<{ readonly items: GoalRecord[]; readonly more: boolean }> {
  const conditions = [
    eq(goals.projectId, scope.projectId),
    filter.state === undefined ? undefined : eq(goals.state, filter.state),
    filter.open === undefined
      ? undefined
      : filter.open
        ? inArray(goals.state, [...OPEN_GOAL_STATES])
        : notInArray(goals.state, [...OPEN_GOAL_STATES]),
    filter.category === undefined ? undefined : eq(categories.key, filter.category),
    filter.query === undefined ? undefined : titleMatches(goals.title, filter.query),
  ].filter((condition): condition is SQL => condition !== undefined);
  const rows = await selectGoals(drizzleOf(database))
    .where(and(...conditions))
    .orderBy(stateRank, sql`${goals.dueOn} asc nulls last`, asc(goals.createdAt))
    .limit(filter.limit + 1)
    .offset(filter.offset ?? 0);
  return { items: rows.slice(0, filter.limit).map(toGoal), more: rows.length > filter.limit };
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
    /** How many goals the project may hold, this one included; the package's bound when left out. */
    readonly limit?: number | undefined;
    readonly now: Date;
  },
): Promise<GoalRecord> {
  const { scope, actor, goal, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    // Counted under the lock on the project's row, so that two set at once cannot both be the last one allowed.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, scope.projectId))
      .for("update");
    const [held] = await tx
      .select({ count: count() })
      .from(goals)
      .where(eq(goals.projectId, scope.projectId));
    if ((held?.count ?? 0) >= (input.limit ?? MAX_GOALS_PER_PROJECT)) {
      throw new GoalError("goal.too_many");
    }
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
