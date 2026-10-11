import type { GoalState, RestTaskCounts } from "@skillcdn/console/api";
import { and, eq, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { goals, tasks } from "../schema.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { type PersonRecord, personColumns, raisers, toPerson } from "./people.js";

// The roadmap of a project (ADR-0019): its goals, what it works towards and by when. A goal's
// progress is never written down: it is read from the tasks that work towards it, counted by
// state, so that it is as current as the board. Every change is one transaction with the
// event that records it, and every read is scoped to the project.

export interface GoalRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly title: string;
  readonly body: string;
  readonly state: GoalState;
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
  constructor(code: "goal.not_found") {
    super(code, "the goal was not found");
  }
}

export interface GoalInput {
  readonly title: string;
  readonly body?: string | undefined;
  readonly state?: GoalState | undefined;
  readonly dueOn?: string | null | undefined;
}

/** Only what changes; a key that is absent leaves the field as it is. */
export type GoalPatch = Partial<GoalInput>;

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
  dueOn: goals.dueOn,
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
    .innerJoin(raisers, eq(raisers.id, goals.createdById));
}

function toGoal(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    title: row.title,
    body: row.body,
    state: row.state,
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

/** The roadmap: the active goals first, then the planned, the reached and the dropped; the sooner due first within each, then the older. */
export async function listGoals(
  database: Database,
  scope: Scope,
  limit: number,
): Promise<GoalRecord[]> {
  const rows = await selectGoals(drizzleOf(database))
    .where(eq(goals.projectId, scope.projectId))
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
    const [inserted] = await tx
      .insert(goals)
      .values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        title: goal.title,
        body: goal.body ?? "",
        state: goal.state ?? "planned",
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
      .select({ title: goals.title, body: goals.body, state: goals.state, dueOn: goals.dueOn })
      .from(goals)
      .where(and(eq(goals.projectId, scope.projectId), eq(goals.id, goalId)))
      .for("update");
    if (current === undefined) {
      throw new GoalError("goal.not_found");
    }
    const next = {
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      state: patch.state ?? current.state,
      dueOn: patch.dueOn === undefined ? current.dueOn : patch.dueOn,
    };
    const changed = (["title", "body", "state", "dueOn"] as const).filter(
      (field) => next[field] !== current[field],
    );
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
