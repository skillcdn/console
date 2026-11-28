import {
  BOARD_PARTS_FROM,
  compareVersions,
  type NotificationKind,
  notificationKindFor,
  notificationSettingsOf,
  parseVersion,
  type TaskFollowState,
  wakeTextOf,
} from "@skillcdn/console/api";
import { and, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { decisionReachableBy } from "../../auth/policy.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import {
  agentRunners,
  agentSecrets,
  agentWakeCursors,
  comments,
  decisions,
  people,
  projects,
  tasks,
  taskWorkers,
} from "../schema.js";
import { listWaitingDecisionsFor } from "./decisions.js";
import type { EventRecord } from "./events.js";
import { followsOfTask, type MemberToTell, membersToTell } from "./notifications.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";
import { excerptOf } from "./runs.js";
import { listTasksOf } from "./tasks.js";

// Whom the board tells of what happens on it (ADR-0157, and ADR-0085, point 10, for the wakes):
// what an event of the feed means to the members it concerns, a person and an agent account by
// the same rules. Read by the worker from a cursor over the feed, as the plugins' hooks are.
// Each becomes a notification, which the member reads in the console, and for an agent account
// a signal on its record, which is how it learns of anything. What a member does themselves
// tells them nothing, and a task planned for a later day is ready to begin for nobody.

/** A wake the console raises for one agent account of its own accord: housekeeping, and no notification. */
export interface BoardWake {
  readonly account: PersonRecord;
  readonly source: "console";
  /** What it is about, by which wakes of one thing are told apart: `services`. */
  readonly key: string;
  readonly text: string;
}

/** What an event means to one member: the notification to make, and the words an agent account is woken with. */
export interface BoardTelling {
  readonly person: PersonRecord;
  /** Why they are told. */
  readonly kind: NotificationKind;
  /** Whether they are told because they follow the task, whatever their settings say. */
  readonly followed: boolean;
  /** What it is about, by which wakes of one thing are told apart: `ops#412`, `decision:<id>`, `agent:<handle>`. */
  readonly key: string;
  /** What an agent account is told, in a line with the command that reads the thing. */
  readonly text: string;
  readonly projectId: string | undefined;
  readonly taskId: string | undefined;
  readonly decisionId: string | undefined;
  /** The agent account it is about, for one of how an account stands. */
  readonly aboutId: string | undefined;
}

/** A line of the board inside a sentence of the console's: on one line, and bounded. */
const said = (text: string, most = 200): string => {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > most ? `${line.slice(0, most - 1)}…` : line;
};

/**
 * The most of a comment a wake carries (ADR-0166): what most comments are within, so that the
 * agent reads what was said where it is woken, and the rest of a long one on the board.
 */
export const MAX_WAKE_COMMENT = 2000;

/**
 * The words of the comment an event says was written (ADR-0166), or nothing. The event names
 * no comment: it is the one its author wrote on that task at that moment, and of those, where
 * a clock gave several the same moment, the one whose first words the event keeps. A comment
 * of files alone has no words to carry.
 */
async function commentOf(
  database: Database,
  event: EventRecord,
  taskId: string,
): Promise<string | undefined> {
  if (event.actor === undefined) {
    return undefined;
  }
  const written = await drizzleOf(database)
    .select({ body: comments.body })
    .from(comments)
    .where(
      and(
        eq(comments.taskId, taskId),
        eq(comments.authorId, event.actor.id),
        eq(comments.createdAt, event.createdAt),
      ),
    )
    .orderBy(desc(comments.id))
    .limit(20);
  const body = written
    .find((comment) => excerptOf(comment.body) === (event.data.excerpt ?? ""))
    ?.body.trim();
  return body === undefined || body.length === 0 ? undefined : body;
}

/**
 * A wake for a comment as the one text a signal carries (ADR-0166): the console's own lines
 * apart from what the comment says, written as a wake source writes what someone said at a
 * messenger, so that the agent reads the console's lines under its session's mark and the
 * comment in a block, as its writer's words and never the console's. So much of it, and where
 * it is longer the first line says so, since a line after the words would read as theirs.
 */
function commentWake(named: string, read: string, body: string): string {
  const cut =
    body.length > MAX_WAKE_COMMENT
      ? `, cut here after ${MAX_WAKE_COMMENT} of its ${body.length} characters`
      : "";
  const end = body.charCodeAt(MAX_WAKE_COMMENT - 1);
  // Never half of a character that takes two.
  const most = end >= 0xd800 && end <= 0xdbff ? MAX_WAKE_COMMENT - 1 : MAX_WAKE_COMMENT;
  return wakeTextOf([
    { says: `A comment on ${named}${cut}` },
    { words: cut === "" ? body : `${body.slice(0, most)}…` },
    {
      says: `The task, with ${cut === "" ? "the rest of what was said on it" : "the comment whole"}: ${read}`,
    },
  ]);
}

/**
 * Those of some members whose runner reads a wake of the board's in parts (ADR-0166): the
 * agent accounts whose runner last said a version from the one that does on. A runner of
 * before prints a wake's whole text under its header, which carries its session's mark, as the
 * console's own words, so what a member wrote is never sent it so: nor an account no runner was
 * heard from, nor one whose runner said what reads as no version.
 */
async function readingInParts(
  database: Database,
  members: readonly MemberToTell[],
): Promise<ReadonlySet<string>> {
  const accounts = members
    .filter((member) => member.person.kind === "agent")
    .map((member) => member.person.id);
  const from = parseVersion(BOARD_PARTS_FROM);
  if (accounts.length === 0 || from === undefined) {
    return new Set();
  }
  const runners = await drizzleOf(database)
    .select({ personId: agentRunners.personId, runner: agentRunners.runner })
    .from(agentRunners)
    .where(inArray(agentRunners.personId, accounts));
  return new Set(
    runners
      .filter((row) => {
        const version = parseVersion(row.runner);
        return version !== undefined && compareVersions(version, from) >= 0;
      })
      .map((row) => row.personId),
  );
}

/**
 * A title of the board inside a sentence of the console's own, between the quotes it stands in:
 * on one line, bounded, and with nothing in it that ends the quote or a header's bracket, so
 * that what follows it in the sentence is never the title's to say.
 */
const titled = (title: string): string =>
  said(title).replaceAll('"', "'").replaceAll("[", "(").replaceAll("]", ")");

/** The fields of a task whose change its people are told of: what it says and when it is planned. */
const TOLD_OF_FIELDS: readonly string[] = ["title", "body", "startsOn", "dueOn"];

/** What a member is to an event by the kinds it may be told to them under, the one that says most first. */
class Concerned {
  readonly #kinds = new Map<string, NotificationKind[]>();

  add(ids: readonly (string | undefined)[], kind: NotificationKind): void {
    for (const id of ids) {
      if (id === undefined) {
        continue;
      }
      const kinds = this.#kinds.get(id) ?? [];
      if (!kinds.includes(kind)) {
        kinds.push(kind);
      }
      this.#kinds.set(id, kinds);
    }
  }

  ids(): string[] {
    return [...this.#kinds.keys()];
  }

  of(id: string): readonly NotificationKind[] {
    return this.#kinds.get(id) ?? [];
  }
}

/**
 * Whether an event tells the member who did it: never, but for a person whose own agent did it
 * as them and who chose to be told of that. An agent account is told nothing of what it does.
 */
function tellsItsActor(event: EventRecord, member: MemberToTell): boolean {
  return (
    member.person.kind !== "agent" && event.agent !== undefined && member.chosen?.ownAgents === true
  );
}

/**
 * The tellings of an event for the members it concerns: each told under the first kind they
 * have on, under the first of all where they follow the task, and not at all where they muted
 * it, turned its project off, or did the thing themselves.
 */
function tellingsOf(
  event: EventRecord,
  members: readonly MemberToTell[],
  concerned: Concerned,
  follows: ReadonlyMap<string, TaskFollowState>,
  thing: {
    readonly key: string;
    /** What they are told, by why and by who is told: an account's runner may read less than another's. */
    readonly words: (kind: NotificationKind, member: MemberToTell) => string;
    readonly projectId?: string | undefined;
    readonly taskId?: string | undefined;
    readonly decisionId?: string | undefined;
    readonly aboutId?: string | undefined;
  },
): BoardTelling[] {
  const tellings: BoardTelling[] = [];
  for (const member of members) {
    if (member.person.id === event.actor?.id && !tellsItsActor(event, member)) {
      continue;
    }
    const settings = notificationSettingsOf(
      member.person.kind === "agent" ? "agent" : "person",
      member.chosen,
    );
    const candidates = concerned.of(member.person.id);
    const follow = follows.get(member.person.id);
    const kind = notificationKindFor({ candidates, settings, follow, projectId: thing.projectId });
    if (kind === undefined) {
      continue;
    }
    tellings.push({
      person: member.person,
      kind,
      followed:
        follow === "following" &&
        notificationKindFor({
          candidates,
          settings,
          follow: undefined,
          projectId: thing.projectId,
        }) === undefined,
      key: thing.key,
      text: thing.words(kind, member),
      projectId: thing.projectId,
      taskId: thing.taskId,
      decisionId: thing.decisionId,
      aboutId: thing.aboutId,
    });
  }
  return tellings;
}

/** What a task's event tells: by the task as it stands now, which is what whoever is told will find. */
async function taskTellings(
  database: Database,
  event: EventRecord,
  today: string,
): Promise<BoardTelling[]> {
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
      projectId: tasks.projectId,
      project: projects.key,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.id, event.taskId),
        eq(tasks.workspaceId, event.workspaceId),
        // A task put away says so, and nothing after that.
        event.kind === "task.archived" ? isNotNull(tasks.archivedAt) : isNull(tasks.archivedAt),
      ),
    )
    .limit(1);
  if (task === undefined) {
    return [];
  }
  // A task the console itself gave back, ending a run it had not heard from (ADR-0114), tells
  // nobody: an agent whose run dies in silence would be sent to take it again every twelve hours.
  if (event.kind === "task.moved" && event.actor === undefined && event.plugin === undefined) {
    return [];
  }
  const workers = (
    await drizzleOf(database)
      .select({ personId: taskWorkers.personId })
      .from(taskWorkers)
      .where(eq(taskWorkers.taskId, task.id))
  ).map((row) => row.personId);
  const follows = await followsOfTask(database, task.id);
  const fields = event.data.fields ?? [];
  // Work to begin: a ready task that is not planned for a later day.
  const begins = task.state === "ready" && (task.dueOn === null || task.dueOn <= today);
  const concerned = new Concerned();
  /** What the event is to whoever follows the task and is nothing else to it. */
  let followed: NotificationKind | undefined;
  switch (event.kind) {
    case "task.created":
      if (begins) {
        concerned.add(workers, "ready");
      }
      concerned.add([task.ownerId, ...workers], "assigned");
      break;
    case "task.updated": {
      // Made a worker of it: those the change added, and nobody who was at it already.
      const added = fields.includes("workers")
        ? (event.data.workersAdded ?? []).filter((id) => workers.includes(id))
        : [];
      if (begins) {
        concerned.add(added, "ready");
        // Its day moved to today or before, or taken away: everyone at work on it.
        if (fields.includes("dueOn")) {
          concerned.add(workers, "ready");
        }
      }
      concerned.add(added, "assigned");
      if (fields.some((field) => TOLD_OF_FIELDS.includes(field))) {
        concerned.add([task.ownerId, ...workers], "changed");
      }
      followed = "changed";
      break;
    }
    case "task.moved":
      if (begins && event.data.to === "ready") {
        concerned.add(workers, "ready");
      }
      concerned.add([task.ownerId], "moved");
      followed = "moved";
      break;
    case "task.commented":
      concerned.add([task.ownerId, ...workers], "commented");
      followed = "commented";
      break;
    case "task.archived":
      concerned.add([task.ownerId, ...workers], "archived");
      followed = "archived";
      break;
    default:
      return [];
  }
  if (followed !== undefined) {
    // Whoever follows the task is told of everything that happens on it.
    concerned.add(
      [...follows].filter(([, state]) => state === "following").map(([id]) => id),
      followed,
    );
  }
  const read = `console task ${task.number} --project ${task.project}`;
  const named = `#${task.number} "${titled(task.title)}" in ${task.project}`;
  const changed = fields.length === 0 ? "" : ` (${said(fields.join(", "), 80)})`;
  // What a comment says goes with the wake for it (ADR-0166): read where the agent is woken,
  // it costs no reading of the task whole to learn what was said.
  const comment =
    event.kind === "task.commented" ? await commentOf(database, event, task.id) : undefined;
  const members = await membersToTell(database, event.workspaceId, concerned.ids(), task.projectId);
  // The comment itself goes only to an account whose runner reads it apart from the console's
  // own lines; any other is told that there is one, as before.
  const inParts = comment === undefined ? undefined : await readingInParts(database, members);
  const words = (kind: NotificationKind, member: MemberToTell): string => {
    switch (kind) {
      case "ready":
        return `${named} is ready, and you are at work on it. Read it: ${read}`;
      case "assigned":
        return `${named} was given to you. Read it: ${read}`;
      case "commented":
        return comment !== undefined && inParts?.has(member.person.id) === true
          ? commentWake(named, read, comment)
          : `A comment on ${named}. Read it: ${read}`;
      case "moved":
        return `${named} went from ${event.data.from ?? "one state"} to ${event.data.to ?? "another"}. Read it: ${read}`;
      case "archived":
        return `${named} was put away. Read it: ${read}`;
      default:
        return `${named} changed${changed}. Read it: ${read}`;
    }
  };
  return tellingsOf(event, members, concerned, follows, {
    key: `${task.project}#${task.number}`,
    words,
    projectId: task.projectId,
    taskId: task.id,
  });
}

/** Those of some members a decision still reaches (ADR-0068, ADR-0077): a telling says its question, and its answer. */
async function reachedBy(
  database: Database,
  decisionId: string,
  members: readonly MemberToTell[],
): Promise<MemberToTell[]> {
  const reached: MemberToTell[] = [];
  for (const member of members) {
    const [found] = await drizzleOf(database)
      .select({ id: decisions.id })
      .from(decisions)
      .where(and(eq(decisions.id, decisionId), decisionReachableBy(member.person)))
      .limit(1);
    if (found !== undefined) {
      reached.push(member);
    }
  }
  return reached;
}

/** What a decision's event tells: whom it is addressed to when raised, whoever is named anew when it is addressed anew (ADR-0096), and whoever raised it when answered. */
async function decisionTellings(database: Database, event: EventRecord): Promise<BoardTelling[]> {
  if (event.decisionId === undefined) {
    return [];
  }
  const [decision] = await drizzleOf(database)
    .select({
      id: decisions.id,
      question: decisions.question,
      raisedById: decisions.raisedById,
      deciderIds: decisions.deciderIds,
      projectId: decisions.projectId,
    })
    .from(decisions)
    .where(and(eq(decisions.id, event.decisionId), eq(decisions.workspaceId, event.workspaceId)))
    .limit(1);
  if (decision === undefined) {
    return [];
  }
  const concerned = new Concerned();
  if (event.kind === "decision.answered") {
    concerned.add([decision.raisedById], "answered");
  } else {
    // Raised: whom it is for. Addressed anew: those the change named and nobody it was for
    // already, and only where they are still among those it is for.
    const asked =
      event.kind === "decision.raised"
        ? decision.deciderIds
        : (event.data.decidersAdded ?? []).filter((id) => decision.deciderIds.includes(id));
    concerned.add(asked, "decision");
    // What an agent account asks of its own manager is news of that account too (ADR-0158):
    // a manager who is told of their agent accounts and of no decision learns of it under
    // that kind, since it is how the account tells them of what it will not do by itself. A
    // project they turned off tells them nothing of it, as it tells them nothing else.
    const [raiser] = await drizzleOf(database)
      .select({ kind: people.kind, managerId: people.managerId })
      .from(people)
      .where(eq(people.id, decision.raisedById))
      .limit(1);
    if (raiser?.kind === "agent" && raiser.managerId !== null) {
      concerned.add(
        asked.filter((id) => id === raiser.managerId),
        "agent",
      );
    }
  }
  const read = `console decision ${decision.id}`;
  const asked = `"${said(decision.question)}"`;
  const option = event.data.option === undefined ? "" : `: ${said(event.data.option)}`;
  const members = await reachedBy(
    database,
    decision.id,
    await membersToTell(database, event.workspaceId, concerned.ids()),
  );
  return tellingsOf(event, members, concerned, new Map(), {
    key: `decision:${decision.id}`,
    words: (kind) =>
      kind === "answered"
        ? `The decision you raised is answered, ${asked}${option}. Read it: ${read}`
        : `A decision waits for you: ${asked}. Read it and answer: ${read}`,
    projectId: decision.projectId,
    decisionId: decision.id,
  });
}

/**
 * What an agent account's standing tells: whom it reports to, when it stops, is refused, fails
 * or is not heard from, and when it runs again after.
 */
async function agentTellings(database: Database, event: EventRecord): Promise<BoardTelling[]> {
  const { login, state, was } = event.data;
  if (
    login === undefined ||
    state === undefined ||
    (state === "running" && (was ?? null) === null)
  ) {
    return [];
  }
  const [account] = await drizzleOf(database)
    .select({ id: people.id, handle: people.handle, managerId: people.managerId })
    .from(people)
    .where(
      and(
        eq(people.workspaceId, event.workspaceId),
        eq(people.login, login),
        eq(people.kind, "agent"),
      ),
    )
    .limit(1);
  if (account === undefined || account.managerId === null) {
    return [];
  }
  const concerned = new Concerned();
  concerned.add([account.managerId], "agent");
  const called = account.handle === null ? login : `@${account.handle}`;
  const detail = event.data.detail === undefined ? "" : ` (${said(event.data.detail, 120)})`;
  const stands =
    state === "running"
      ? "runs again"
      : state === "unheard"
        ? "is not heard from"
        : state === "refused"
          ? "was refused"
          : state;
  return tellingsOf(
    event,
    await membersToTell(database, event.workspaceId, concerned.ids()),
    concerned,
    new Map(),
    {
      key: `agent:${account.handle ?? login}`,
      words: () =>
        `The agent account ${called}, which reports to you, ${stands}${detail}. See how it stands: console agent ${account.handle ?? login}`,
      aboutId: account.id,
    },
  );
}

/**
 * Whom an event of the feed is told to, each under the kind that says why. `today` is the day
 * in the workspace's time zone: a task due later than it is ready to begin for nobody.
 */
export async function boardTellingsOf(
  database: Database,
  event: EventRecord,
  today: string,
): Promise<BoardTelling[]> {
  switch (event.kind) {
    case "task.created":
    case "task.moved":
    case "task.updated":
    case "task.commented":
    case "task.archived":
      return taskTellings(database, event, today);
    case "decision.raised":
    case "decision.addressed":
    case "decision.answered":
      return decisionTellings(database, event);
    case "agent.state_changed":
      return agentTellings(database, event);
    default:
      return [];
  }
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

/**
 * The wakes the console raises of its own accord for an event, each for one agent account: its
 * housekeeping, which is no notification and which no setting turns off.
 */
export async function boardWakesOf(database: Database, event: EventRecord): Promise<BoardWake[]> {
  if (event.kind !== "workspace.updated") {
    return [];
  }
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

/**
 * How far the board's pass has read the feed, without taking the place: every event up to it
 * has been told to whom it concerns. Nothing read yet is the beginning.
 */
export async function wakeCursorOf(database: Database, workspaceId: string): Promise<number> {
  const [cursor] = await drizzleOf(database)
    .select({ after: agentWakeCursors.after })
    .from(agentWakeCursors)
    .where(eq(agentWakeCursors.workspaceId, workspaceId))
    .limit(1);
  return cursor?.after ?? 0;
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
