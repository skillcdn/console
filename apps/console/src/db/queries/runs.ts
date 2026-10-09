import type { RunEnding, RunStatus } from "@skillcdn/console/api";
import { and, asc, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { artifacts, decisions, people, reports, runs, tasks } from "../schema.js";
import { recordEvent } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";
import { updateTaskIn } from "./tasks.js";

// One agent at work on one task for one person: started when the agent takes the task, grown
// by what it reports and hands in, waiting while a decision it raised waits, and over when the
// agent says so or a person gives up on it. Every change is one transaction with its event.

export interface ReportRecord {
  readonly id: string;
  readonly body: string;
  readonly createdAt: Date;
}

export interface ArtifactRecord {
  readonly id: string;
  readonly url: string;
  readonly label: string | undefined;
  readonly createdAt: Date;
}

export interface RunRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly taskId: string;
  /** The task's number, as people say it. */
  readonly taskNumber: number;
  /** The person the agent acts for. */
  readonly person: PersonRecord;
  /** The token the agent presented, while it exists. */
  readonly tokenId: string | undefined;
  /** What the agent calls itself. */
  readonly agent: string;
  readonly status: RunStatus;
  readonly summary: string | undefined;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
  readonly reports: readonly ReportRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  /** The decision the run waits for, while one does. */
  readonly waitingFor: string | undefined;
}

/** What is wrong with a run an agent or a person asked for. `code` is what the API answers with. */
export class RunError extends DomainError {
  constructor(
    code:
      | "run.not_found"
      | "run.task_not_found"
      | "run.task_closed"
      | "run.task_taken"
      | "run.not_yours"
      | "run.over"
      | "run.too_many_reports"
      | "run.too_many_artifacts",
  ) {
    super(code, RUN_ERROR_WORDS[code]);
  }
}

const RUN_ERROR_WORDS = {
  "run.not_found": "the run was not found",
  "run.task_not_found": "the task is not one of the workspace",
  "run.task_closed": "the task is done or dropped",
  "run.task_taken": "an agent is at work on the task already",
  "run.not_yours": "the run is another person's",
  "run.over": "the run is over",
  "run.too_many_reports": "the run carries as many reports as one may",
  "run.too_many_artifacts": "the run carries as many artifacts as one may",
} as const;

/** The statuses of a run that is not over. */
export const OPEN_RUN_STATUSES: readonly RunStatus[] = ["running", "waiting"];
/** How many characters of a report the feed shows. */
const EXCERPT_LENGTH = 140;

const runners = alias(people, "runners");

const waitingForOf = sql<
  string | null
>`(select ${decisions.id} from ${decisions} where ${decisions.runId} = ${runs.id} and ${decisions.answeredAt} is null order by ${decisions.createdAt} desc limit 1)`;

const runColumns = {
  id: runs.id,
  workspaceId: runs.workspaceId,
  taskId: runs.taskId,
  taskNumber: tasks.number,
  tokenId: runs.tokenId,
  agent: runs.agent,
  status: runs.status,
  summary: runs.summary,
  startedAt: runs.startedAt,
  endedAt: runs.endedAt,
  person: personColumns(runners),
  waitingFor: waitingForOf,
};

type Handle = Transaction | ReturnType<typeof drizzleOf>;
type RunRow = Awaited<ReturnType<typeof selectRuns>>[number];

function selectRuns(handle: Handle) {
  return handle
    .select(runColumns)
    .from(runs)
    .innerJoin(runners, eq(runners.id, runs.personId))
    .innerJoin(tasks, eq(tasks.id, runs.taskId));
}

/** The rows as records, with what each run reported and handed in, oldest first. */
async function attach(handle: Handle, rows: readonly RunRow[]): Promise<RunRecord[]> {
  const ids = rows.map((row) => row.id);
  const [reported, handedIn] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          handle
            .select({
              id: reports.id,
              runId: reports.runId,
              body: reports.body,
              createdAt: reports.createdAt,
            })
            .from(reports)
            .where(inArray(reports.runId, ids))
            .orderBy(asc(reports.createdAt), asc(reports.id)),
          handle
            .select({
              id: artifacts.id,
              runId: artifacts.runId,
              url: artifacts.url,
              label: artifacts.label,
              createdAt: artifacts.createdAt,
            })
            .from(artifacts)
            .where(inArray(artifacts.runId, ids))
            .orderBy(asc(artifacts.createdAt), asc(artifacts.id)),
        ]);
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    taskNumber: row.taskNumber,
    person: toPerson(row.person),
    tokenId: row.tokenId ?? undefined,
    agent: row.agent,
    status: row.status,
    summary: row.summary ?? undefined,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    reports: reported
      .filter((report) => report.runId === row.id)
      .map((report) => ({ id: report.id, body: report.body, createdAt: report.createdAt })),
    artifacts: handedIn
      .filter((artifact) => artifact.runId === row.id)
      .map((artifact) => ({
        id: artifact.id,
        url: artifact.url,
        label: artifact.label ?? undefined,
        createdAt: artifact.createdAt,
      })),
    waitingFor: row.waitingFor ?? undefined,
  }));
}

async function readRun(
  handle: Handle,
  workspaceId: string,
  runId: string,
): Promise<RunRecord | undefined> {
  const rows = await selectRuns(handle)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)))
    .limit(1);
  return (await attach(handle, rows))[0];
}

/** The first words of a report, for the feed: one line, bounded. */
export function excerptOf(body: string): string {
  const line = body
    .split("\n")
    .map((part) => part.replace(/^[#>*\-\s]+/, "").trim())
    .find((part) => part.length > 0);
  if (line === undefined) {
    return "";
  }
  const words = line.replaceAll(/\s+/g, " ");
  return words.length > EXCERPT_LENGTH ? `${words.slice(0, EXCERPT_LENGTH - 1)}…` : words;
}

/**
 * A run that is the actor's and not over, with the task it is on, locked for the change that
 * follows. A run that is another person's is `run.not_yours`, even to look at: an agent works
 * on its own runs, and a person on their own, unless `anyone` says an administrator asks.
 */
async function lockRun(
  tx: Transaction,
  workspaceId: string,
  runId: string,
  actorId: string,
  anyone = false,
) {
  const [run] = await tx
    .select({
      id: runs.id,
      taskId: runs.taskId,
      personId: runs.personId,
      agent: runs.agent,
      status: runs.status,
    })
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)))
    .for("update");
  if (run === undefined) {
    throw new RunError("run.not_found");
  }
  if (run.personId !== actorId && !anyone) {
    throw new RunError("run.not_yours");
  }
  if (!OPEN_RUN_STATUSES.includes(run.status)) {
    throw new RunError("run.over");
  }
  const [task] = await tx
    .select({ number: tasks.number, title: tasks.title, state: tasks.state })
    .from(tasks)
    .where(eq(tasks.id, run.taskId))
    .limit(1);
  if (task === undefined) {
    throw new RunError("run.task_not_found");
  }
  return { ...run, task };
}

/**
 * An agent takes a task for its person: the run begins, the task is at work and the person's,
 * and the board is told. A task that is done or dropped, or that an agent is at work on
 * already, cannot be taken.
 */
export async function startRun(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly tokenId: string | undefined;
    readonly taskId: string;
    readonly agent: string;
    readonly now: Date;
  },
): Promise<RunRecord> {
  const { workspaceId, actorId, tokenId, taskId, agent, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [task] = await tx
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, state: tasks.state })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId)))
      .for("update");
    if (task === undefined) {
      throw new RunError("run.task_not_found");
    }
    if (task.state === "done" || task.state === "dropped") {
      throw new RunError("run.task_closed");
    }
    const [busy] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.taskId, taskId), inArray(runs.status, [...OPEN_RUN_STATUSES])))
      .limit(1);
    if (busy !== undefined) {
      throw new RunError("run.task_taken");
    }
    const [inserted] = await tx
      .insert(runs)
      .values({
        workspaceId,
        taskId,
        personId: actorId,
        tokenId: tokenId ?? null,
        agent,
        status: "running",
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: runs.id });
    if (inserted === undefined) {
      throw new Error("run insert returned no row");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "run.started",
      actorId,
      taskId,
      runId: inserted.id,
      data: { number: task.number, title: task.title, agent },
      now,
    });
    await updateTaskIn(tx, {
      workspaceId,
      actorId,
      taskId,
      patch: { state: "in_progress", assigneeId: actorId },
      now,
    });
    const written = await readRun(tx, workspaceId, inserted.id);
    if (written === undefined) {
      throw new Error("the run written was not found");
    }
    return written;
  });
}

/** The agent says how its work goes. */
export async function addReport(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly runId: string;
    readonly body: string;
    readonly limit: number;
    readonly now: Date;
  },
): Promise<RunRecord> {
  const { workspaceId, actorId, runId, body, limit, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const run = await lockRun(tx, workspaceId, runId, actorId);
    const [held] = await tx
      .select({ count: count() })
      .from(reports)
      .where(eq(reports.runId, runId));
    if ((held?.count ?? 0) >= limit) {
      throw new RunError("run.too_many_reports");
    }
    await tx.insert(reports).values({ runId, body, createdAt: now });
    await tx.update(runs).set({ updatedAt: now }).where(eq(runs.id, runId));
    await recordEvent(tx, {
      workspaceId,
      kind: "run.reported",
      actorId,
      taskId: run.taskId,
      runId,
      data: {
        number: run.task.number,
        title: run.task.title,
        agent: run.agent,
        excerpt: excerptOf(body),
      },
      now,
    });
    const written = await readRun(tx, workspaceId, runId);
    if (written === undefined) {
      throw new RunError("run.not_found");
    }
    return written;
  });
}

/** The agent hands in a link: a branch, a pull request, a page. */
export async function addArtifact(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly runId: string;
    readonly url: string;
    readonly label: string | undefined;
    readonly limit: number;
    readonly now: Date;
  },
): Promise<RunRecord> {
  const { workspaceId, actorId, runId, url, label, limit, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const run = await lockRun(tx, workspaceId, runId, actorId);
    const [held] = await tx
      .select({ count: count() })
      .from(artifacts)
      .where(eq(artifacts.runId, runId));
    if ((held?.count ?? 0) >= limit) {
      throw new RunError("run.too_many_artifacts");
    }
    await tx.insert(artifacts).values({ runId, url, label: label ?? null, createdAt: now });
    await tx.update(runs).set({ updatedAt: now }).where(eq(runs.id, runId));
    await recordEvent(tx, {
      workspaceId,
      kind: "run.handed_in",
      actorId,
      taskId: run.taskId,
      runId,
      data: {
        number: run.task.number,
        title: run.task.title,
        agent: run.agent,
        label: label ?? excerptOf(url),
      },
      now,
    });
    const written = await readRun(tx, workspaceId, runId);
    if (written === undefined) {
      throw new RunError("run.not_found");
    }
    return written;
  });
}

/**
 * The run is over: the agent finished, failed, or a person gave up on it. A finished run puts
 * a task at work up for review; the rest leave the task as it is. The agent's own run, or any
 * run for `anyone`, which is an administrator.
 */
export async function endRun(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly runId: string;
    readonly status: RunEnding;
    readonly summary: string | undefined;
    readonly anyone?: boolean | undefined;
    readonly now: Date;
  },
): Promise<RunRecord> {
  const { workspaceId, actorId, runId, status, summary, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const run = await lockRun(tx, workspaceId, runId, actorId, input.anyone === true);
    await tx
      .update(runs)
      .set({ status, summary: summary ?? null, endedAt: now, updatedAt: now })
      .where(eq(runs.id, runId));
    await recordEvent(tx, {
      workspaceId,
      kind: "run.ended",
      actorId,
      taskId: run.taskId,
      runId,
      data: { number: run.task.number, title: run.task.title, agent: run.agent, status },
      now,
    });
    if (status === "finished" && run.task.state === "in_progress") {
      await updateTaskIn(tx, {
        workspaceId,
        actorId,
        taskId: run.taskId,
        patch: { state: "in_review" },
        now,
      });
    }
    const written = await readRun(tx, workspaceId, runId);
    if (written === undefined) {
      throw new RunError("run.not_found");
    }
    return written;
  });
}

export function getRun(
  database: Database,
  workspaceId: string,
  runId: string,
): Promise<RunRecord | undefined> {
  return readRun(drizzleOf(database), workspaceId, runId);
}

/**
 * The runs, newest first: all of them, those on one task, those that are open or over, those
 * for one person, those begun with one token (which is one agent's own).
 */
export async function listRuns(
  database: Database,
  workspaceId: string,
  filter: {
    readonly taskId?: string | undefined;
    readonly open?: boolean | undefined;
    readonly personId?: string | undefined;
    readonly tokenId?: string | undefined;
    readonly limit: number;
  },
): Promise<RunRecord[]> {
  const handle = drizzleOf(database);
  const rows = await selectRuns(handle)
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        filter.taskId === undefined ? undefined : eq(runs.taskId, filter.taskId),
        filter.open === undefined
          ? undefined
          : filter.open
            ? inArray(runs.status, [...OPEN_RUN_STATUSES])
            : notInArray(runs.status, [...OPEN_RUN_STATUSES]),
        filter.personId === undefined ? undefined : eq(runs.personId, filter.personId),
        filter.tokenId === undefined ? undefined : eq(runs.tokenId, filter.tokenId),
      ),
    )
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(filter.limit);
  return attach(handle, rows);
}
