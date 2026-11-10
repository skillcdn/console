import type {
  AgentState,
  AgentStateReason,
  RestRunnerHeartbeatInput,
  SignalKind,
  SignalSource,
} from "@skillcdn/console/api";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { agentRunners, agentSignalFiles, agentSignals, people } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// What the console knows of an agent account's runner, and what it sends it (ADR-0085): the
// heartbeat, which says how the agent stands; the signals, a record numbered per account; and
// the note of a runner not heard from. A change of state is an event of the workspace's feed;
// a signal is not, and wakes its account's stream alone.

/** The PostgreSQL channel a process listens on to learn that an agent account has something new: its payload is the account's id. */
export const AGENTS_CHANNEL = "console_agents";

/** What the console has of a runner, as its row says. */
export interface RunnerRecord {
  readonly personId: string;
  readonly state: AgentState | undefined;
  readonly reason: string | undefined;
  readonly stateAt: Date | undefined;
  readonly heardAt: Date | undefined;
  readonly delivered: number;
  /** The number of the newest signal of the account; 0 for none. */
  readonly latest: number;
  readonly stopSignal: number | undefined;
  readonly sessionId: string | undefined;
  readonly machine: { name: string; os: string; user: string } | undefined;
  readonly runner: string | undefined;
  readonly product:
    | { driver: string; name: string; version: string | null; tried: boolean }
    | undefined;
  readonly offers:
    | { models: string[]; efforts: string[]; steer: boolean; images: boolean; resume: boolean }
    | undefined;
  readonly running: { model: string | null; effort: string | null } | undefined;
  /** What was chosen for it to run with; none each for the product's own. */
  readonly model: string | undefined;
  readonly effort: string | undefined;
}

type RunnerRow = typeof agentRunners.$inferSelect;

const toRunner = (row: RunnerRow): RunnerRecord => ({
  personId: row.personId,
  state: row.state ?? undefined,
  reason: row.reason ?? undefined,
  stateAt: row.stateAt ?? undefined,
  heardAt: row.heardAt ?? undefined,
  delivered: row.delivered,
  latest: row.nextSignal - 1,
  stopSignal: row.stopSignal ?? undefined,
  sessionId: row.sessionId ?? undefined,
  machine: row.machine ?? undefined,
  runner: row.runner ?? undefined,
  product: row.product ?? undefined,
  offers: row.offers ?? undefined,
  running: row.running ?? undefined,
  model: row.model ?? undefined,
  effort: row.effort ?? undefined,
});

/** A signal as the record keeps it. */
export interface SignalRecord {
  readonly number: number;
  readonly kind: SignalKind;
  readonly by: PersonRecord | undefined;
  readonly agent: string | undefined;
  readonly plugin: string | undefined;
  readonly source: SignalSource;
  readonly key: string | undefined;
  readonly text: string;
  readonly set: { model: string | null; effort: string | null } | undefined;
  /** The pictures sent with it. */
  readonly attachments: readonly SignalFileRecord[];
  readonly at: Date;
}

/** A picture sent with a signal, as it is kept: what it is called, and the hash its bytes are under. */
export interface SignalFileRecord {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly sha256: string;
}

const signalColumns = {
  number: agentSignals.number,
  kind: agentSignals.kind,
  agent: agentSignals.agent,
  plugin: agentSignals.plugin,
  source: agentSignals.source,
  key: agentSignals.key,
  text: agentSignals.text,
  set: agentSignals.set,
  createdAt: agentSignals.createdAt,
  by: personColumns(people),
};

type SignalRow = {
  readonly number: number;
  readonly kind: SignalKind;
  readonly agent: string | null;
  readonly plugin: string | null;
  readonly source: SignalSource;
  readonly key: string | null;
  readonly text: string;
  readonly set: { model: string | null; effort: string | null } | null;
  readonly createdAt: Date;
  readonly by: Parameters<typeof toPerson>[0] | null;
};

const toSignal = (row: SignalRow, attachments: readonly SignalFileRecord[] = []): SignalRecord => ({
  attachments,
  number: row.number,
  kind: row.kind,
  by: row.by === null ? undefined : toPerson(row.by),
  agent: row.agent ?? undefined,
  plugin: row.plugin ?? undefined,
  source: row.source,
  key: row.key ?? undefined,
  text: row.text,
  set: row.set ?? undefined,
  at: row.createdAt,
});

/** The account's row, made when there was none, and held for the change that follows. */
async function lockedRunner(tx: Transaction, personId: string, now: Date): Promise<RunnerRow> {
  await tx.insert(agentRunners).values({ personId, updatedAt: now }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(agentRunners)
    .where(eq(agentRunners.personId, personId))
    .for("update");
  if (row === undefined) {
    throw new Error("agent runner row was not made");
  }
  return row;
}

/** Tells the workspace's feed that an agent account stands otherwise now. */
async function tellState(
  tx: Transaction,
  change: {
    readonly account: PersonRecord;
    readonly actor: Actor | undefined;
    readonly state: AgentState;
    readonly was: AgentState | null;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<void> {
  await recordEvent(tx, {
    workspaceId: change.account.workspaceId,
    kind: "agent.state_changed",
    actor: change.actor,
    data: {
      login: change.account.login,
      ...(change.account.handle === undefined ? {} : { handle: change.account.handle }),
      state: change.state,
      was: change.was,
      detail: change.reason,
    },
    now: change.now,
  });
}

export async function findRunner(
  database: Database,
  personId: string,
): Promise<RunnerRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select()
    .from(agentRunners)
    .where(eq(agentRunners.personId, personId))
    .limit(1);
  return row === undefined ? undefined : toRunner(row);
}

/** The runners of several accounts at once, by account: what a listing of agents reads. */
export async function runnersOf(
  database: Database,
  personIds: readonly string[],
): Promise<Map<string, RunnerRecord>> {
  if (personIds.length === 0) {
    return new Map();
  }
  const rows = await drizzleOf(database)
    .select()
    .from(agentRunners)
    .where(inArray(agentRunners.personId, [...personIds]));
  return new Map(rows.map((row) => [row.personId, toRunner(row)]));
}

/**
 * Notes a heartbeat: when the runner was heard from, what it said of itself, and how its agent
 * stands. While a supervisor's `stop` stands the agent is `stopped` whatever the runner says,
 * since the runner may not have received it yet. A change of state is told to the workspace,
 * by the account, whose runner reported it.
 */
export async function recordHeartbeat(
  database: Database,
  input: {
    readonly account: PersonRecord;
    readonly heartbeat: RestRunnerHeartbeatInput;
    readonly now: Date;
  },
): Promise<RunnerRecord> {
  const { account, heartbeat, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const before = await lockedRunner(tx, account.id, now);
    const stopped = before.stopSignal !== null;
    const state: AgentState = stopped ? "stopped" : heartbeat.state;
    const reason: AgentStateReason = stopped ? "stop" : heartbeat.reason;
    const changed = before.state !== state;
    const [row] = await tx
      .update(agentRunners)
      .set({
        heardAt: now,
        delivered: Math.max(before.delivered, heartbeat.delivered),
        sessionId: heartbeat.session,
        machine: heartbeat.machine,
        runner: heartbeat.runner,
        product: heartbeat.product,
        offers: heartbeat.offers,
        running: heartbeat.running,
        ...(changed ? { state, reason, stateAt: now } : { reason }),
        updatedAt: now,
      })
      .where(eq(agentRunners.personId, account.id))
      .returning();
    if (row === undefined) {
      throw new Error("agent runner update returned no row");
    }
    if (changed) {
      await tellState(tx, {
        account,
        actor: { id: account.id },
        state,
        was: before.state,
        reason,
        now,
      });
    }
    return toRunner(row);
  });
}

/**
 * Sends a signal: the next number of the account's record, with who sent it. A `stop` stands
 * from then on, and the agent is `stopped` at once, by whoever sent it; a `restart` or a `reset`
 * takes the stop away, and the agent is as its runner next says. A `set` keeps the choice with
 * the account. The account's stream is woken, in every process, through the database's own
 * channel.
 */
export async function sendSignal(
  database: Database,
  input: {
    readonly account: PersonRecord;
    readonly kind: SignalKind;
    /** Who sends it; nobody for the console itself. */
    readonly by: Actor | undefined;
    readonly source: SignalSource;
    readonly key: string | undefined;
    readonly text: string;
    /** For `set`: what to change, a field left out staying as it is, `null` for the product's own. */
    readonly set:
      | { model?: string | null | undefined; effort?: string | null | undefined }
      | undefined;
    /** The pictures sent with it, their bytes kept already. */
    readonly files?: readonly Omit<SignalFileRecord, "id">[] | undefined;
    readonly now: Date;
  },
): Promise<SignalRecord> {
  const { account, kind, by, now } = input;
  const number = await drizzleOf(database).transaction(async (tx) => {
    const before = await lockedRunner(tx, account.id, now);
    const next = before.nextSignal;
    const chosen =
      kind === "set" && input.set !== undefined
        ? {
            model: input.set.model === undefined ? before.model : input.set.model,
            effort: input.set.effort === undefined ? before.effort : input.set.effort,
          }
        : undefined;
    await tx.insert(agentSignals).values({
      personId: account.id,
      number: next,
      kind,
      byId: by?.id ?? null,
      agent: by?.agent ?? null,
      plugin: by?.plugin ?? null,
      source: input.source,
      key: input.key ?? null,
      text: input.text,
      set: chosen ?? null,
      createdAt: now,
    });
    if (input.files !== undefined && input.files.length > 0) {
      await tx.insert(agentSignalFiles).values(
        input.files.map((file) => ({
          personId: account.id,
          number: next,
          name: file.name,
          size: file.size,
          contentType: file.contentType,
          sha256: file.sha256,
          createdAt: now,
        })),
      );
    }
    const stops = kind === "stop";
    const starts = kind === "restart" || kind === "reset";
    const becomesStopped = stops && before.state !== "stopped";
    await tx
      .update(agentRunners)
      .set({
        nextSignal: next + 1,
        ...(stops ? { stopSignal: next } : {}),
        ...(starts ? { stopSignal: null } : {}),
        ...(becomesStopped ? { state: "stopped", reason: "stop", stateAt: now } : {}),
        ...(chosen === undefined ? {} : { model: chosen.model, effort: chosen.effort }),
        updatedAt: now,
      })
      .where(eq(agentRunners.personId, account.id));
    if (becomesStopped) {
      await tellState(tx, {
        account,
        actor: by,
        state: "stopped",
        was: before.state,
        reason: "stop",
        now,
      });
    }
    await tx.execute(sql`select pg_notify(${AGENTS_CHANNEL}, ${account.id})`);
    return next;
  });
  const [signal] = await listSignalsAfter(database, account.id, number - 1, 1);
  if (signal === undefined) {
    throw new Error("the signal written was not found");
  }
  return signal;
}

/** The signals of an account after a number, in order: what its runner's stream sends next. */
export async function listSignalsAfter(
  database: Database,
  personId: string,
  after: number,
  limit: number,
): Promise<SignalRecord[]> {
  const rows = await drizzleOf(database)
    .select(signalColumns)
    .from(agentSignals)
    .leftJoin(people, eq(people.id, agentSignals.byId))
    .where(and(eq(agentSignals.personId, personId), gt(agentSignals.number, after)))
    .orderBy(asc(agentSignals.number))
    .limit(limit);
  return withFiles(database, personId, rows);
}

/** The signals of some rows, each with the pictures sent with it. */
async function withFiles(
  database: Database,
  personId: string,
  rows: readonly SignalRow[],
): Promise<SignalRecord[]> {
  if (rows.length === 0) {
    return [];
  }
  const files = await drizzleOf(database)
    .select()
    .from(agentSignalFiles)
    .where(
      and(
        eq(agentSignalFiles.personId, personId),
        inArray(
          agentSignalFiles.number,
          rows.map((row) => row.number),
        ),
      ),
    )
    .orderBy(asc(agentSignalFiles.id));
  return rows.map((row) =>
    toSignal(
      row,
      files
        .filter((file) => file.number === row.number)
        .map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          contentType: file.contentType,
          sha256: file.sha256,
        })),
    ),
  );
}

/** One picture of one signal of an account, or nothing: of that signal, never another's. */
export async function findSignalFile(
  database: Database,
  personId: string,
  number: number,
  fileId: string,
): Promise<SignalFileRecord | undefined> {
  const [file] = await drizzleOf(database)
    .select()
    .from(agentSignalFiles)
    .where(
      and(
        eq(agentSignalFiles.id, fileId),
        eq(agentSignalFiles.personId, personId),
        eq(agentSignalFiles.number, number),
      ),
    )
    .limit(1);
  return file === undefined
    ? undefined
    : {
        id: file.id,
        name: file.name,
        size: file.size,
        contentType: file.contentType,
        sha256: file.sha256,
      };
}

/** The account's record of signals, the newest first: a page of it, from before `before` on. */
export async function listSignals(
  database: Database,
  personId: string,
  page: { readonly before: number | undefined; readonly limit: number },
): Promise<{ readonly items: SignalRecord[]; readonly more: boolean }> {
  const rows = await drizzleOf(database)
    .select(signalColumns)
    .from(agentSignals)
    .leftJoin(people, eq(people.id, agentSignals.byId))
    .where(
      and(
        eq(agentSignals.personId, personId),
        page.before === undefined ? undefined : lt(agentSignals.number, page.before),
      ),
    )
    .orderBy(desc(agentSignals.number))
    .limit(page.limit + 1);
  return {
    items: await withFiles(database, personId, rows.slice(0, page.limit)),
    more: rows.length > page.limit,
  };
}

/**
 * Notes the runners not heard from since `before` as `unheard`, and tells the workspace of each,
 * by nobody: what the worker does on a schedule. A runner never heard from is not noted, and
 * one noted already is not noted again. How many were.
 */
export async function noteUnheardRunners(
  database: Database,
  input: { readonly before: Date; readonly now: Date },
): Promise<number> {
  const { before, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const quiet = await tx
      .select({ runner: agentRunners, account: personColumns(people) })
      .from(agentRunners)
      .innerJoin(people, eq(people.id, agentRunners.personId))
      .where(
        and(
          isNotNull(agentRunners.heardAt),
          lt(agentRunners.heardAt, before),
          or(sql`${agentRunners.state} is null`, ne(agentRunners.state, "unheard")),
          eq(people.status, "active"),
        ),
      )
      .for("update", { of: agentRunners });
    for (const { runner, account } of quiet) {
      await tx
        .update(agentRunners)
        .set({ state: "unheard", reason: "no_heartbeat", stateAt: now, updatedAt: now })
        .where(eq(agentRunners.personId, runner.personId));
      await tellState(tx, {
        account: toPerson(account),
        actor: undefined,
        state: "unheard",
        was: runner.state,
        reason: "no_heartbeat",
        now,
      });
    }
    return quiet.length;
  });
}
