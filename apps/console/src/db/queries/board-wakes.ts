import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import {
  agentRunners,
  agentSecrets,
  agentWakeCursors,
  decisions,
  people,
  projects,
  tasks,
  taskWorkers,
} from "../schema.js";
import { listWaitingDecisionsFor } from "./decisions.js";
import type { EventRecord } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";
import { listTasksOf } from "./tasks.js";

// The board's wake rules (ADR-0085, point 10): what an event of the feed means to the agent
// accounts it concerns. Read by the worker from a cursor over the feed, as the plugins' hooks
// are; each wake becomes a signal on the account's record. What an agent itself does on the
// board wakes it for nothing, and a task planned for a later day wakes nobody.

/** A wake the board raises for one agent account. */
export interface BoardWake {
  readonly account: PersonRecord;
  /** Where the wake comes from: the console itself for its own housekeeping, the board for everything else. */
  readonly source: "board" | "console";
  /** What it is about, by which wakes of one thing are told apart: `ops#412`, `decision:<id>`, `services`. */
  readonly key: string;
  readonly text: string;
}

/** A line of the board inside a sentence of the console's: on one line, and bounded. */
const said = (text: string, most = 200): string => {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > most ? `${line.slice(0, most - 1)}…` : line;
};

/** The agent accounts among some members: those that are in, and not the one who did the thing. */
async function agentsAmong(
  database: Database,
  workspaceId: string,
  ids: readonly string[],
  except: string | undefined,
): Promise<PersonRecord[]> {
  const wanted = [...new Set(ids)].filter((id) => id !== except);
  if (wanted.length === 0) {
    return [];
  }
  const rows = await drizzleOf(database)
    .select(personColumns(people))
    .from(people)
    .where(
      and(
        eq(people.workspaceId, workspaceId),
        eq(people.kind, "agent"),
        eq(people.status, "active"),
        inArray(people.id, wanted),
      ),
    );
  return rows.map(toPerson);
}

/** Every agent account of the workspace that is in, and was there when the thing happened. */
async function everyAgent(
  database: Database,
  workspaceId: string,
  since: Date,
): Promise<PersonRecord[]> {
  const rows = await drizzleOf(database)
    .select(personColumns(people))
    .from(people)
    .where(
      and(
        eq(people.workspaceId, workspaceId),
        eq(people.kind, "agent"),
        eq(people.status, "active"),
        lte(people.createdAt, since),
      ),
    );
  return rows.map(toPerson);
}

/** What a task's event wakes: by the task as it stands now, which is what the agent will find. */
async function taskWakes(
  database: Database,
  event: EventRecord,
  today: string,
): Promise<BoardWake[]> {
  if (event.taskId === undefined) {
    return [];
  }
  const [task] = await drizzleOf(database)
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      state: tasks.state,
      dueOn: tasks.dueOn,
      ownerId: tasks.ownerId,
      project: projects.key,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.id, event.taskId),
        eq(tasks.workspaceId, event.workspaceId),
        isNull(tasks.archivedAt),
      ),
    )
    .limit(1);
  if (task === undefined) {
    return [];
  }
  const workers = (
    await drizzleOf(database)
      .select({ personId: taskWorkers.personId })
      .from(taskWorkers)
      .where(eq(taskWorkers.taskId, task.id))
  ).map((row) => row.personId);
  const actor = event.actor?.id;
  const key = `${task.project}#${task.number}`;
  const read = `console task ${task.number} --project ${task.project}`;
  const named = `#${task.number} "${said(task.title)}" in ${task.project}`;
  const wake = (accounts: readonly PersonRecord[], text: string): BoardWake[] =>
    accounts.map((account) => ({ account, source: "board", key, text }));

  if (event.kind === "task.commented") {
    // A comment on a task it owns or works on, whatever the task's state and its day.
    const concerned = await agentsAmong(
      database,
      event.workspaceId,
      [task.ownerId, ...workers],
      actor,
    );
    return wake(concerned, `A comment on ${named}. Read it: ${read}`);
  }
  // Everything else is about work to begin: a ready task that is not planned for a later day.
  const due = task.dueOn === null || task.dueOn <= today;
  if (task.state !== "ready" || !due) {
    return [];
  }
  const fields = event.data.fields ?? [];
  const concerned =
    event.kind === "task.created" || (event.kind === "task.moved" && event.data.to === "ready")
      ? workers
      : event.kind === "task.updated"
        ? [
            // Made a worker of it: those the change added, and nobody who was at it already.
            ...(fields.includes("workers") ? (event.data.workersAdded ?? []) : []),
            // Its day moved to today or before, or taken away: everyone at work on it.
            ...(fields.includes("dueOn") ? workers : []),
          ].filter((id) => workers.includes(id))
        : [];
  return wake(
    await agentsAmong(database, event.workspaceId, concerned, actor),
    `${named} is ready, and you are at work on it. Read it: ${read}`,
  );
}

/** What a decision's event wakes: whom it is addressed to when raised, whoever is named anew when it is addressed anew (ADR-0096), and whoever raised it when answered. */
async function decisionWakes(database: Database, event: EventRecord): Promise<BoardWake[]> {
  if (event.decisionId === undefined) {
    return [];
  }
  const [decision] = await drizzleOf(database)
    .select({
      id: decisions.id,
      question: decisions.question,
      raisedById: decisions.raisedById,
      deciderIds: decisions.deciderIds,
    })
    .from(decisions)
    .where(and(eq(decisions.id, event.decisionId), eq(decisions.workspaceId, event.workspaceId)))
    .limit(1);
  if (decision === undefined) {
    return [];
  }
  const key = `decision:${decision.id}`;
  const read = `console decision ${decision.id}`;
  const asked = `"${said(decision.question)}"`;
  if (event.kind === "decision.raised" || event.kind === "decision.addressed") {
    // Raised, it wakes everyone it is for; addressed anew, those the change named and nobody
    // it was for already, and only where they are still among those it is for.
    const named =
      event.kind === "decision.raised"
        ? decision.deciderIds
        : (event.data.decidersAdded ?? []).filter((id) => decision.deciderIds.includes(id));
    return (await agentsAmong(database, event.workspaceId, named, event.actor?.id)).map(
      (account) => ({
        account,
        source: "board",
        key,
        text: `A decision waits for you: ${asked}. Read it and answer: ${read}`,
      }),
    );
  }
  const option = event.data.option === undefined ? "" : `: ${said(event.data.option)}`;
  return (
    await agentsAmong(database, event.workspaceId, [decision.raisedById], event.actor?.id)
  ).map((account) => ({
    account,
    source: "board",
    key,
    text: `The decision you raised is answered, ${asked}${option}. Read it: ${read}`,
  }));
}

/**
 * The wakes an event of the feed raises, each for one agent account. `today` is the day in the
 * workspace's time zone: a task due later than it wakes nobody.
 */
export async function boardWakesOf(
  database: Database,
  event: EventRecord,
  today: string,
): Promise<BoardWake[]> {
  switch (event.kind) {
    case "task.created":
    case "task.moved":
    case "task.updated":
    case "task.commented":
      return taskWakes(database, event, today);
    case "decision.raised":
    case "decision.addressed":
    case "decision.answered":
      return decisionWakes(database, event);
    case "workspace.updated": {
      // The names an agent is called by elsewhere are put together from these (ADR-0089).
      const fields = event.data.fields ?? [];
      if (!["services", "handle", "domain"].some((field) => fields.includes(field))) {
        return [];
      }
      return (await everyAgent(database, event.workspaceId, event.createdAt)).map((account) => ({
        account,
        source: "console",
        key: "services",
        text: "The services your workspace names for its agents changed. Run this in your desk, and put your AGENTS.md right where it says otherwise: console agent setup --refresh",
      }));
    }
    default:
      return [];
  }
}

/** An agent account whose runner was heard from, with the hours it keeps and what it was briefed of last. */
export interface BriefedAccount {
  readonly account: PersonRecord;
  readonly dayStart: string | undefined;
  readonly dayEnd: string | undefined;
  readonly briefedOn: string | undefined;
  readonly wrappedOn: string | undefined;
}

/**
 * The agent accounts a briefing is for (ADR-0085, point 11): those that are in, and whose runner
 * was ever heard from. An account no machine was set up for is briefed of nothing.
 */
export async function accountsToBrief(
  database: Database,
  workspaceId: string,
): Promise<BriefedAccount[]> {
  const rows = await drizzleOf(database)
    .select({
      account: personColumns(people),
      dayStart: agentRunners.dayStart,
      dayEnd: agentRunners.dayEnd,
      briefedOn: agentRunners.briefedOn,
      wrappedOn: agentRunners.wrappedOn,
    })
    .from(agentRunners)
    .innerJoin(people, eq(people.id, agentRunners.personId))
    .where(
      and(
        eq(people.workspaceId, workspaceId),
        eq(people.kind, "agent"),
        eq(people.status, "active"),
        isNotNull(agentRunners.heardAt),
      ),
    );
  return rows.map((row) => ({
    account: toPerson(row.account),
    dayStart: row.dayStart ?? undefined,
    dayEnd: row.dayEnd ?? undefined,
    briefedOn: row.briefedOn ?? undefined,
    wrappedOn: row.wrappedOn ?? undefined,
  }));
}

/** Notes the day an account was sent its day's briefing, or its wrap. */
export async function noteBriefed(
  database: Database,
  personId: string,
  noted: { readonly briefedOn?: string | undefined; readonly wrappedOn?: string | undefined },
): Promise<void> {
  await drizzleOf(database)
    .update(agentRunners)
    .set({
      ...(noted.briefedOn === undefined ? {} : { briefedOn: noted.briefedOn }),
      ...(noted.wrappedOn === undefined ? {} : { wrappedOn: noted.wrappedOn }),
    })
    .where(eq(agentRunners.personId, personId));
}

/** How many open tasks and waiting decisions a briefing reads at most: it names a few and counts the rest. */
const BRIEFING_LIMIT = 200;

/** What a briefing is made from: the open tasks the account is at work on, as it may see them, and how many decisions wait for it. */
export async function plateOf(
  database: Database,
  workspaceId: string,
  account: PersonRecord,
): Promise<{
  readonly tasks: {
    readonly project: string;
    readonly number: number;
    readonly title: string;
    readonly state: string;
    readonly dueOn: string | undefined;
  }[];
  readonly decisions: number;
}> {
  const [open, waiting, keys] = await Promise.all([
    listTasksOf(database, workspaceId, account, account, BRIEFING_LIMIT),
    listWaitingDecisionsFor(database, workspaceId, account, BRIEFING_LIMIT),
    drizzleOf(database)
      .select({ id: projects.id, key: projects.key })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId)),
  ]);
  const keyOf = new Map(keys.map((project) => [project.id, project.key]));
  return {
    tasks: open.map((task) => ({
      project: keyOf.get(task.projectId) ?? "?",
      number: task.number,
      title: task.title,
      state: task.state,
      dueOn: task.dueOn,
    })),
    decisions: waiting.length,
  };
}

/** The secrets of the workspace's agent accounts whose day comes on or before `by`, and which their account was not told of yet. */
export async function secretsEnding(
  database: Database,
  workspaceId: string,
  by: string,
): Promise<
  { readonly account: PersonRecord; readonly name: string; readonly expiresOn: string }[]
> {
  const rows = await drizzleOf(database)
    .select({
      account: personColumns(people),
      name: agentSecrets.name,
      expiresOn: agentSecrets.expiresOn,
    })
    .from(agentSecrets)
    .innerJoin(people, eq(people.id, agentSecrets.personId))
    .where(
      and(
        eq(people.workspaceId, workspaceId),
        eq(people.kind, "agent"),
        eq(people.status, "active"),
        isNotNull(agentSecrets.expiresOn),
        lte(agentSecrets.expiresOn, by),
        isNull(agentSecrets.warnedOn),
      ),
    );
  return rows.flatMap((row) =>
    row.expiresOn === null
      ? []
      : [{ account: toPerson(row.account), name: row.name, expiresOn: row.expiresOn }],
  );
}

/** Notes that an account was told of a secret's day. */
export async function noteSecretWarned(
  database: Database,
  personId: string,
  name: string,
  day: string,
): Promise<void> {
  await drizzleOf(database)
    .update(agentSecrets)
    .set({ warnedOn: day })
    .where(and(eq(agentSecrets.personId, personId), eq(agentSecrets.name, name)));
}

/**
 * Takes the place the wake rules have read the feed to, for one pass, inside `tx`: the row is
 * the pass's lock, so that two processes never read the same events at once. Nothing where
 * another pass holds it. A workspace the rules never read begins at the feed's beginning: the
 * migration that brought the rules set the place of a workspace that had a history to its end.
 */
export async function takeWakeCursor(
  tx: Transaction,
  workspaceId: string,
  now: Date,
): Promise<number | undefined> {
  await tx
    .insert(agentWakeCursors)
    .values({ workspaceId, after: 0, updatedAt: now })
    .onConflictDoNothing();
  const [cursor] = await tx
    .select({ after: agentWakeCursors.after })
    .from(agentWakeCursors)
    .where(eq(agentWakeCursors.workspaceId, workspaceId))
    .for("update", { skipLocked: true });
  return cursor?.after;
}

/** Moves the place on, inside the pass that took it. */
export async function moveWakeCursor(
  tx: Transaction,
  workspaceId: string,
  after: number,
  now: Date,
): Promise<void> {
  await tx
    .update(agentWakeCursors)
    .set({ after, updatedAt: now })
    .where(eq(agentWakeCursors.workspaceId, workspaceId));
}
