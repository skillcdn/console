import type { RestDecisionOption } from "@skillcdn/console/api";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { decisions, tasks } from "../schema.js";
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
      | "decision.no_such_option",
  ) {
    super(
      code,
      code === "decision.not_found"
        ? "the decision was not found"
        : code === "decision.invalid_task"
          ? "the task is not one of the workspace"
          : code === "decision.answered"
            ? "the decision has been answered"
            : "the option is not one of the decision's",
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
};

type DecisionRow = Awaited<ReturnType<typeof selectDecisions>>[number];

function selectDecisions(handle: Transaction | ReturnType<typeof drizzleOf>) {
  return handle
    .select(decisionColumns)
    .from(decisions)
    .innerJoin(raisers, eq(raisers.id, decisions.raisedById))
    .leftJoin(answerers, eq(answerers.id, decisions.answeredById));
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
 * there is one, must be the workspace's.
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
    };
    readonly now: Date;
  },
): Promise<DecisionRecord> {
  const { workspaceId, actorId, decision, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    let taskId: string | null = null;
    let about: { readonly number: number; readonly title: string } | undefined;
    if (decision.taskId !== undefined && decision.taskId !== null) {
      const [task] = await tx
        .select({ id: tasks.id, number: tasks.number, title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, decision.taskId)))
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
      data: { question: decision.question, ...about },
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
      data: { question: current.question, option: chosen.label },
      now,
    });
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
