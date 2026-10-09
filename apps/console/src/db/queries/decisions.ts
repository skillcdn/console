import type { RestDecisionOption } from "@skillcdn/console/api";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { decisions, runs, tasks } from "../schema.js";
import { recordEvent } from "./events.js";
import { answerers, type PersonRecord, personColumns, raisers, toPerson } from "./people.js";

// The questions that need a person. A decision is raised once and answered once; both are
// one transaction with the event that records them.

export interface DecisionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly taskId: string | undefined;
  readonly question: string;
  readonly body: string;
  readonly options: readonly RestDecisionOption[];
  readonly raisedBy: PersonRecord;
  /** The run that raised it, when an agent asked. */
  readonly run: { readonly id: string; readonly agent: string } | undefined;
  readonly answer:
    | {
        readonly option: string;
        readonly note: string | undefined;
        readonly by: PersonRecord;
        readonly at: Date;
      }
    | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What is wrong with a decision a person asked for. `code` is what the API answers with. */
export class DecisionError extends DomainError {
  constructor(
    code:
      | "decision.not_found"
      | "decision.invalid_task"
      | "decision.answered"
      | "decision.no_such_option"
      | "decision.invalid_run",
  ) {
    super(
      code,
      code === "decision.not_found"
        ? "the decision was not found"
        : code === "decision.invalid_task"
          ? "the task is not one of the workspace"
          : code === "decision.answered"
            ? "the decision has been answered"
            : code === "decision.no_such_option"
              ? "the option is not one of the decision's"
              : "the run is not the asker's, or is over",
    );
  }
}

const decisionColumns = {
  id: decisions.id,
  workspaceId: decisions.workspaceId,
  taskId: decisions.taskId,
  question: decisions.question,
  body: decisions.body,
  options: decisions.options,
  answer: decisions.answer,
  answerNote: decisions.answerNote,
  answeredAt: decisions.answeredAt,
  createdAt: decisions.createdAt,
  updatedAt: decisions.updatedAt,
  raisedBy: personColumns(raisers),
  answeredBy: personColumns(answerers),
  runId: decisions.runId,
  runAgent: runs.agent,
};

type DecisionRow = Awaited<ReturnType<typeof selectDecisions>>[number];

function selectDecisions(handle: Transaction | ReturnType<typeof drizzleOf>) {
  return handle
    .select(decisionColumns)
    .from(decisions)
    .innerJoin(raisers, eq(raisers.id, decisions.raisedById))
    .leftJoin(answerers, eq(answerers.id, decisions.answeredById))
    .leftJoin(runs, eq(runs.id, decisions.runId));
}

function toDecision(row: DecisionRow): DecisionRecord {
  const answered =
    row.answer !== null && row.answeredAt !== null && row.answeredBy !== null
      ? {
          option: row.answer,
          note: row.answerNote ?? undefined,
          by: toPerson(row.answeredBy),
          at: row.answeredAt,
        }
      : undefined;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId ?? undefined,
    question: row.question,
    body: row.body,
    options: row.options,
    raisedBy: toPerson(row.raisedBy),
    run:
      row.runId !== null && row.runAgent !== null
        ? { id: row.runId, agent: row.runAgent }
        : undefined,
    answer: answered,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readDecision(
  handle: Transaction | ReturnType<typeof drizzleOf>,
  workspaceId: string,
  decisionId: string,
): Promise<DecisionRecord | undefined> {
  const [row] = await selectDecisions(handle)
    .where(and(eq(decisions.workspaceId, workspaceId), eq(decisions.id, decisionId)))
    .limit(1);
  return row === undefined ? undefined : toDecision(row);
}

/**
 * Raises a decision, with its options numbered from one, and tells the board. The task, when
 * there is one, must be the workspace's. Raised from a run, which must be the actor's and not
 * over, the decision is about the run's task and the run waits for the answer.
 */
export async function raiseDecision(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly decision: {
      readonly question: string;
      readonly body?: string;
      readonly options: readonly string[];
      readonly taskId?: string | null;
      readonly runId?: string | undefined;
    };
    readonly now: Date;
  },
): Promise<DecisionRecord> {
  const { workspaceId, actorId, decision, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    let runId: string | null = null;
    let agent: string | undefined;
    let taskOfRun: string | undefined;
    if (decision.runId !== undefined) {
      const [run] = await tx
        .select({
          id: runs.id,
          taskId: runs.taskId,
          personId: runs.personId,
          agent: runs.agent,
          status: runs.status,
        })
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, decision.runId)))
        .for("update");
      if (
        run === undefined ||
        run.personId !== actorId ||
        (run.status !== "running" && run.status !== "waiting")
      ) {
        throw new DecisionError("decision.invalid_run");
      }
      runId = run.id;
      agent = run.agent;
      taskOfRun = run.taskId;
      await tx.update(runs).set({ status: "waiting", updatedAt: now }).where(eq(runs.id, run.id));
    }
    let taskId: string | null = null;
    let about: { readonly number: number; readonly title: string } | undefined;
    const wanted = decision.taskId ?? taskOfRun;
    if (wanted !== undefined && wanted !== null) {
      const [task] = await tx
        .select({ id: tasks.id, number: tasks.number, title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, wanted)))
        .limit(1);
      if (task === undefined) {
        throw new DecisionError("decision.invalid_task");
      }
      taskId = task.id;
      about = { number: task.number, title: task.title };
    }
    const options = decision.options.map((label, index) => ({ id: String(index + 1), label }));
    const [inserted] = await tx
      .insert(decisions)
      .values({
        workspaceId,
        taskId,
        runId,
        question: decision.question,
        body: decision.body ?? "",
        options,
        raisedById: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: decisions.id });
    if (inserted === undefined) {
      throw new Error("decision insert returned no row");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "decision.raised",
      actorId,
      taskId: taskId ?? undefined,
      decisionId: inserted.id,
      runId: runId ?? undefined,
      data: { question: decision.question, ...about, ...(agent === undefined ? {} : { agent }) },
      now,
    });
    const written = await readDecision(tx, workspaceId, inserted.id);
    if (written === undefined) {
      throw new Error("the decision written was not found");
    }
    return written;
  });
}

/**
 * Answers a decision that waits, with one of its options, and tells the board. Rejects with a
 * {@link DecisionError} for a decision that is not there, one answered already, or an option
 * that is not one of its.
 */
export async function answerDecision(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly decisionId: string;
    readonly option: string;
    readonly note: string | undefined;
    readonly now: Date;
  },
): Promise<DecisionRecord> {
  const { workspaceId, actorId, decisionId, option, note, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select({
        question: decisions.question,
        options: decisions.options,
        answeredAt: decisions.answeredAt,
        taskId: decisions.taskId,
        runId: decisions.runId,
      })
      .from(decisions)
      .where(and(eq(decisions.workspaceId, workspaceId), eq(decisions.id, decisionId)))
      .for("update");
    if (current === undefined) {
      throw new DecisionError("decision.not_found");
    }
    if (current.answeredAt !== null) {
      throw new DecisionError("decision.answered");
    }
    const chosen = current.options.find((candidate) => candidate.id === option);
    if (chosen === undefined) {
      throw new DecisionError("decision.no_such_option");
    }
    await tx
      .update(decisions)
      .set({
        answer: chosen.id,
        answerNote: note ?? null,
        answeredById: actorId,
        answeredAt: now,
        updatedAt: now,
      })
      .where(eq(decisions.id, decisionId));
    await recordEvent(tx, {
      workspaceId,
      kind: "decision.answered",
      actorId,
      taskId: current.taskId ?? undefined,
      decisionId,
      runId: current.runId ?? undefined,
      data: { question: current.question, option: chosen.label },
      now,
    });
    if (current.runId !== null) {
      // The run goes on, unless another decision of its still waits.
      await tx
        .update(runs)
        .set({ status: "running", updatedAt: now })
        .where(
          and(
            eq(runs.id, current.runId),
            eq(runs.status, "waiting"),
            sql`not exists (select 1 from ${decisions} where ${decisions.runId} = ${runs.id} and ${decisions.answeredAt} is null)`,
          ),
        );
    }
    const written = await readDecision(tx, workspaceId, decisionId);
    if (written === undefined) {
      throw new DecisionError("decision.not_found");
    }
    return written;
  });
}

export function getDecision(
  database: Database,
  workspaceId: string,
  decisionId: string,
): Promise<DecisionRecord | undefined> {
  return readDecision(drizzleOf(database), workspaceId, decisionId);
}

/** The decisions, the ones that wait first and newest first within each; or only those that wait. */
export async function listDecisions(
  database: Database,
  workspaceId: string,
  filter: {
    readonly open?: boolean | undefined;
    readonly taskId?: string | undefined;
    readonly limit: number;
  },
): Promise<DecisionRecord[]> {
  const rows = await selectDecisions(drizzleOf(database))
    .where(
      and(
        eq(decisions.workspaceId, workspaceId),
        filter.open === true ? isNull(decisions.answeredAt) : undefined,
        filter.taskId === undefined ? undefined : eq(decisions.taskId, filter.taskId),
      ),
    )
    .orderBy(
      asc(sql`(${decisions.answeredAt} is not null)`),
      desc(decisions.createdAt),
      desc(decisions.id),
    )
    .limit(filter.limit);
  return rows.map(toDecision);
}
