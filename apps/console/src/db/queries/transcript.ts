import {
  MAX_TRANSCRIPT_FILES_PER_MINUTE,
  type RestAgentSessionInput,
  type RestTranscriptEventInput,
  type SessionEnd,
  TRANSCRIPT_INLINE_BYTES,
  type TranscriptKind,
} from "@skillcdn/console/api";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type BlobStore, isMonth } from "../../ports/blob-store.js";
import { type Database, drizzleOf } from "../client.js";
import { people, transcriptEvents, transcriptFiles, transcriptSessions } from "../schema.js";
import { AGENTS_CHANNEL } from "./agent-runners.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The transcript of an agent account's sessions (ADR-0086): the sessions, a row each, which
// stay; their events, whole blocks numbered per session by the runner, appended and never
// changed but by sealing; and the pictures a session hands in. Everything of a session is kept
// under the month it began in, the events and the pictures in partitions of that month and the
// bytes on the month's shelf of the blob store, so that whoever keeps the database moves a
// month alone. Nothing here is an event of the board's feed: what is appended wakes whoever
// watches that session, on the agent accounts' own channel.

/** Arbitrary constant: serializes the making of a month's partitions. */
const MONTHS_LOCK_KEY = 5_434_086;

/** The tables partitioned by month, as the migration made them. */
const MONTHLY_TABLES = ["events", "files", "blobs"] as const;

/** PostgreSQL's code for a row no partition takes: its month is not with the database. */
const NO_PARTITION = "23514";

const WORDS = {
  "transcript.session_not_found": "the session was not found",
  "transcript.session_over": "the session is over",
  "transcript.out_of_order": "the events of a batch are numbered in order, none twice",
  "transcript.gap": "the events are numbered one after another",
  "transcript.unknown_file": "an event names a picture that was not handed in to its session",
  "transcript.too_fast": "the session hands in pictures faster than it may",
  "transcript.away": "the month the session is kept under is not with the database",
  "transcript.event_not_found": "the event was not found",
} as const;

/** What is wrong with what was asked of a transcript. `code` is what the API answers with. */
export class TranscriptError extends DomainError {
  /** For `transcript.gap`: the number the session takes next. */
  readonly expected: number | undefined;

  constructor(code: keyof typeof WORDS, expected?: number) {
    super(code, WORDS[code]);
    this.expected = expected;
  }
}

export interface SessionRecord {
  readonly id: string;
  readonly personId: string;
  readonly month: string;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
  readonly ended: SessionEnd | undefined;
  readonly product: { driver: string; name: string; version: string | null; tried: boolean };
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly resumed: boolean;
  readonly machine: { name: string; os: string; user: string };
  /** The number of its last event; 0 for none. */
  readonly events: number;
  readonly lastEventAt: Date | undefined;
}

type SessionRow = typeof transcriptSessions.$inferSelect;

const toSession = (row: SessionRow): SessionRecord => ({
  id: row.id,
  personId: row.personId,
  month: row.month,
  startedAt: row.startedAt,
  endedAt: row.endedAt ?? undefined,
  ended: row.ended ?? undefined,
  product: row.product,
  model: row.model ?? undefined,
  effort: row.effort ?? undefined,
  resumed: row.resumed,
  machine: row.machine,
  events: row.events,
  lastEventAt: row.lastEventAt ?? undefined,
});

export interface TranscriptFileRecord {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly sha256: string;
}

export interface TranscriptEventRecord {
  readonly n: number;
  readonly kind: TranscriptKind;
  readonly at: Date;
  /** The whole text, or its beginning where `whole` says how many bytes the whole is. */
  readonly text: string;
  readonly whole: number | undefined;
  readonly data: Record<string, string | number | boolean | null>;
  readonly files: readonly TranscriptFileRecord[];
  readonly sealed:
    | { readonly by: PersonRecord | undefined; readonly at: Date; readonly reason: string }
    | undefined;
}

/** The month a moment is in, as `2026-11`, by the clock everyone shares. */
export const monthOf = (moment: Date): string => moment.toISOString().slice(0, 7);

/** The month after a month. */
export function monthAfter(month: string): string {
  const [year = 0, index = 1] = month.split("-").map(Number);
  return monthOf(new Date(Date.UTC(year, index, 1)));
}

const NUL = String.fromCodePoint(0);
const REPLACEMENT = String.fromCodePoint(0xfffd);

/**
 * A text as the database keeps one: what the product said, with the two things no text column
 * takes replaced, a NUL and half of a surrogate pair. Everything else stays, control characters
 * among it: it is data, shown as text.
 */
const kept = (text: string): string => text.toWellFormed().replaceAll(NUL, REPLACEMENT);

/** The beginning of a text that fits in `bytes` of UTF-8, cut between characters. */
function beginningOf(encoded: Buffer, bytes: number): string {
  let end = Math.min(bytes, encoded.byteLength);
  // A byte that continues a character is not where one begins.
  while (end > 0 && end < encoded.byteLength && ((encoded[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return encoded.subarray(0, end).toString("utf8");
}

const codeOf = (error: unknown): unknown => {
  for (let at: unknown = error, depth = 0; depth < 4; depth += 1) {
    if (typeof at !== "object" || at === null) {
      return undefined;
    }
    if ("code" in at && typeof at.code === "string") {
      return at.code;
    }
    at = "cause" in at ? at.cause : undefined;
  }
  return undefined;
};

/** The months whose partitions this process has seen made, by database: asked once each. */
const made = new WeakMap<Database, Set<string>>();

/**
 * Makes the partitions of the months named where they are not there: of the events, of the
 * pictures, and of the bytes the database's own store keeps. Under a lock, since two processes
 * begin a month at the same moment. A month whose table is there and detached is left as its
 * operator left it.
 */
export async function ensureMonths(database: Database, months: readonly string[]): Promise<void> {
  const seen = made.get(database) ?? new Set<string>();
  made.set(database, seen);
  const missing = months.filter((month) => !seen.has(month));
  if (missing.length === 0) {
    return;
  }
  for (const month of missing) {
    if (!isMonth(month)) {
      throw new Error("a partition of the transcript is named by a month");
    }
  }
  await drizzleOf(database).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${MONTHS_LOCK_KEY})`);
    for (const month of missing) {
      const suffix = month.replace("-", "_");
      for (const table of MONTHLY_TABLES) {
        // The names are a constant and a month checked above, never input.
        await tx.execute(
          sql.raw(
            `create table if not exists "transcript"."${table}_${suffix}" partition of "transcript"."${table}" for values in ('${month}')`,
          ),
        );
      }
    }
  });
  for (const month of missing) {
    seen.add(month);
  }
}

/** The months whose events are with the database now: attached to the events' table, whatever they are called. */
export async function attachedMonths(database: Database): Promise<Set<string>> {
  const found = await drizzleOf(database).execute<{ bound: string | null }>(sql`
    select pg_get_expr(child.relpartbound, child.oid) as bound
    from pg_inherits
    join pg_class child on child.oid = pg_inherits.inhrelid
    join pg_class parent on parent.oid = pg_inherits.inhparent
    join pg_namespace on pg_namespace.oid = parent.relnamespace
    where pg_namespace.nspname = 'transcript' and parent.relname = 'events'`);
  const months = new Set<string>();
  for (const row of found.rows) {
    for (const match of (row.bound ?? "").matchAll(/'([0-9]{4}-[0-9]{2})'/g)) {
      if (match[1] !== undefined) {
        months.add(match[1]);
      }
    }
  }
  return months;
}

/**
 * Begins a session of the account, and ends the one that was open as taken over, as a run takes
 * over a run: one main session per account at a time (ADR-0085). The session, and the ids of
 * those it took over, whose watchers are to be woken.
 */
export async function beginSession(
  database: Database,
  input: {
    readonly account: PersonRecord;
    readonly session: RestAgentSessionInput;
    readonly now: Date;
  },
): Promise<{ readonly session: SessionRecord; readonly tookOver: readonly string[] }> {
  const { account, session, now } = input;
  const month = monthOf(now);
  await ensureMonths(database, [month]);
  return drizzleOf(database).transaction(async (tx) => {
    // Two beginnings at once are one after the other: each sees the other's session.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`transcript:${account.id}`}))`);
    const open = await tx
      .select({ id: transcriptSessions.id })
      .from(transcriptSessions)
      .where(and(eq(transcriptSessions.personId, account.id), isNull(transcriptSessions.endedAt)))
      .for("update");
    for (const previous of open) {
      await tx
        .update(transcriptSessions)
        .set({ endedAt: now, ended: "taken_over" })
        .where(eq(transcriptSessions.id, previous.id));
      await tx.execute(sql`select pg_notify(${AGENTS_CHANNEL}, ${previous.id})`);
    }
    const [row] = await tx
      .insert(transcriptSessions)
      .values({
        workspaceId: account.workspaceId,
        personId: account.id,
        month,
        startedAt: now,
        product: session.product,
        model: session.model,
        effort: session.effort,
        resumed: session.resumed,
        machine: session.machine,
      })
      .returning();
    if (row === undefined) {
      throw new Error("session insert returned no row");
    }
    return { session: toSession(row), tookOver: open.map((previous) => previous.id) };
  });
}

/**
 * Ends a session of the account, as its runner says it ended. One that ended already stays as
 * it ended: an end sent twice changes nothing. Nothing for a session that is not the account's.
 */
export async function endSession(
  database: Database,
  input: {
    readonly account: PersonRecord;
    readonly sessionId: string;
    readonly how: Exclude<SessionEnd, "taken_over">;
    readonly now: Date;
  },
): Promise<SessionRecord | undefined> {
  const { account, sessionId, how, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .update(transcriptSessions)
      .set({ endedAt: now, ended: how })
      .where(
        and(
          eq(transcriptSessions.id, sessionId),
          eq(transcriptSessions.personId, account.id),
          isNull(transcriptSessions.endedAt),
        ),
      )
      .returning();
    if (row !== undefined) {
      await tx.execute(sql`select pg_notify(${AGENTS_CHANNEL}, ${sessionId})`);
      return toSession(row);
    }
    const [ended] = await tx
      .select()
      .from(transcriptSessions)
      .where(and(eq(transcriptSessions.id, sessionId), eq(transcriptSessions.personId, account.id)))
      .limit(1);
    return ended === undefined ? undefined : toSession(ended);
  });
}

/** One session of an account, or nothing: of that account, never another's. */
export async function findSession(
  database: Database,
  personId: string,
  sessionId: string,
): Promise<SessionRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select()
    .from(transcriptSessions)
    .where(and(eq(transcriptSessions.id, sessionId), eq(transcriptSessions.personId, personId)))
    .limit(1);
  return row === undefined ? undefined : toSession(row);
}

/** The account's open session, or nothing: what a run begun now is begun in. */
export async function openSessionOf(
  database: Database,
  personId: string,
): Promise<SessionRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select()
    .from(transcriptSessions)
    .where(and(eq(transcriptSessions.personId, personId), isNull(transcriptSessions.endedAt)))
    .limit(1);
  return row === undefined ? undefined : toSession(row);
}

/** The account's sessions, the newest first: a page of them, from before a moment on. */
export async function listSessions(
  database: Database,
  personId: string,
  page: { readonly before: Date | undefined; readonly limit: number },
): Promise<{ readonly items: SessionRecord[]; readonly more: boolean }> {
  const rows = await drizzleOf(database)
    .select()
    .from(transcriptSessions)
    .where(
      and(
        eq(transcriptSessions.personId, personId),
        page.before === undefined ? undefined : lt(transcriptSessions.startedAt, page.before),
      ),
    )
    .orderBy(desc(transcriptSessions.startedAt), desc(transcriptSessions.id))
    .limit(page.limit + 1);
  return { items: rows.slice(0, page.limit).map(toSession), more: rows.length > page.limit };
}

/**
 * Keeps a picture a session's runner hands in, on the month's shelf, and answers what an event
 * names it by. Of an open session of the account; at a bounded rate.
 */
export async function addTranscriptFile(
  database: Database,
  blobs: BlobStore,
  input: {
    readonly account: PersonRecord;
    readonly sessionId: string;
    readonly name: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
    readonly now: Date;
  },
): Promise<TranscriptFileRecord> {
  const { account, sessionId, now } = input;
  const session = await findSession(database, account.id, sessionId);
  if (session === undefined) {
    throw new TranscriptError("transcript.session_not_found");
  }
  if (session.endedAt !== undefined) {
    throw new TranscriptError("transcript.session_over");
  }
  const handle = drizzleOf(database);
  const [recent] = await handle
    .select({ count: count() })
    .from(transcriptFiles)
    .where(
      and(
        eq(transcriptFiles.month, session.month),
        eq(transcriptFiles.sessionId, sessionId),
        gt(transcriptFiles.createdAt, new Date(now.getTime() - 60_000)),
      ),
    );
  if ((recent?.count ?? 0) >= MAX_TRANSCRIPT_FILES_PER_MINUTE) {
    throw new TranscriptError("transcript.too_fast");
  }
  try {
    const stored = await blobs.put(input.bytes, now, { transcript: session.month });
    const [row] = await handle
      .insert(transcriptFiles)
      .values({
        month: session.month,
        id: sql`uuidv7()`,
        sessionId,
        personId: account.id,
        name: input.name,
        size: stored.size,
        contentType: input.contentType,
        sha256: stored.sha256,
        createdAt: now,
      })
      .returning();
    if (row === undefined) {
      throw new Error("transcript file insert returned no row");
    }
    return {
      id: row.id,
      name: row.name,
      size: row.size,
      contentType: row.contentType,
      sha256: row.sha256,
    };
  } catch (error) {
    throw codeOf(error) === NO_PARTITION ? new TranscriptError("transcript.away") : error;
  }
}

/** One picture of a session, by the id its upload answered, or nothing. */
export async function findTranscriptFile(
  database: Database,
  session: SessionRecord,
  fileId: string,
): Promise<TranscriptFileRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select()
    .from(transcriptFiles)
    .where(
      and(
        eq(transcriptFiles.month, session.month),
        eq(transcriptFiles.id, fileId),
        eq(transcriptFiles.sessionId, session.id),
      ),
    )
    .limit(1);
  return row === undefined
    ? undefined
    : {
        id: row.id,
        name: row.name,
        size: row.size,
        contentType: row.contentType,
        sha256: row.sha256,
      };
}

/**
 * Appends a batch of a session's events, in order, and answers the number of its last event
 * now. An event whose number the session has already is left as it is, so that a batch sent
 * twice changes nothing; one that would leave a gap is refused with the number expected, so that
 * whoever reads from a number on misses nothing. The beginning of a long text stays in the row
 * and the whole goes to the month's shelf. Whoever watches the session is woken.
 */
export async function appendEvents(
  database: Database,
  blobs: BlobStore,
  input: {
    readonly account: PersonRecord;
    readonly sessionId: string;
    readonly events: readonly RestTranscriptEventInput[];
    readonly now: Date;
  },
): Promise<{ readonly last: number }> {
  const { account, sessionId, events, now } = input;
  const session = await findSession(database, account.id, sessionId);
  if (session === undefined) {
    throw new TranscriptError("transcript.session_not_found");
  }
  if (session.endedAt !== undefined) {
    throw new TranscriptError("transcript.session_over");
  }
  events.forEach((event, index) => {
    if (index > 0 && event.n <= (events[index - 1]?.n ?? 0)) {
      throw new TranscriptError("transcript.out_of_order");
    }
  });
  const shelf = { transcript: session.month };
  // The long texts are kept before the rows that name them, outside the transaction: bytes
  // kept for a batch that is then refused are bytes nothing names, and cost nothing else.
  const prepared: {
    readonly event: RestTranscriptEventInput;
    readonly text: string;
    readonly textSha256: string | null;
    readonly textSize: number | null;
  }[] = [];
  for (const event of events) {
    if (event.n <= session.events) {
      continue;
    }
    const text = kept(event.text);
    const encoded = Buffer.from(text, "utf8");
    if (encoded.byteLength <= TRANSCRIPT_INLINE_BYTES) {
      prepared.push({ event, text, textSha256: null, textSize: null });
      continue;
    }
    const stored = await blobs.put(encoded, now, shelf);
    prepared.push({
      event,
      text: beginningOf(encoded, TRANSCRIPT_INLINE_BYTES),
      textSha256: stored.sha256,
      textSize: stored.size,
    });
  }
  try {
    return await drizzleOf(database).transaction(async (tx) => {
      const [locked] = await tx
        .select({ events: transcriptSessions.events, endedAt: transcriptSessions.endedAt })
        .from(transcriptSessions)
        .where(eq(transcriptSessions.id, sessionId))
        .for("update");
      if (locked === undefined) {
        throw new TranscriptError("transcript.session_not_found");
      }
      if (locked.endedAt !== null) {
        throw new TranscriptError("transcript.session_over");
      }
      let last = locked.events;
      const fresh = prepared.filter((item) => item.event.n > last);
      const first = fresh[0]?.event.n ?? events[0]?.n ?? last + 1;
      if (first > last + 1) {
        throw new TranscriptError("transcript.gap", last + 1);
      }
      if (fresh.length === 0) {
        return { last };
      }
      // The pictures an event names are this session's own uploads, and nothing else's.
      const named = [...new Set(fresh.flatMap((item) => item.event.files ?? []))];
      const uploads =
        named.length === 0
          ? []
          : await tx
              .select()
              .from(transcriptFiles)
              .where(
                and(
                  eq(transcriptFiles.month, session.month),
                  eq(transcriptFiles.sessionId, sessionId),
                  inArray(transcriptFiles.id, named),
                ),
              );
      const byId = new Map(uploads.map((upload) => [upload.id, upload]));
      const rows = fresh.map((item) => {
        if (item.event.n !== last + 1) {
          throw new TranscriptError("transcript.gap", last + 1);
        }
        last = item.event.n;
        const files = (item.event.files ?? []).map((id) => {
          const upload = byId.get(id);
          if (upload === undefined) {
            throw new TranscriptError("transcript.unknown_file");
          }
          return {
            id: upload.id,
            name: upload.name,
            size: upload.size,
            contentType: upload.contentType,
            sha256: upload.sha256,
          };
        });
        const data: Record<string, string | number | boolean | null> = {};
        for (const [name, fact] of Object.entries(item.event.data ?? {})) {
          data[kept(name)] = typeof fact === "string" ? kept(fact) : fact;
        }
        return {
          month: session.month,
          sessionId,
          n: item.event.n,
          personId: account.id,
          kind: item.event.kind,
          at: new Date(item.event.at),
          receivedAt: now,
          text: item.text,
          textSha256: item.textSha256,
          textSize: item.textSize,
          data,
          files,
        };
      });
      await tx.insert(transcriptEvents).values(rows).onConflictDoNothing();
      await tx
        .update(transcriptSessions)
        .set({ events: last, lastEventAt: now })
        .where(eq(transcriptSessions.id, sessionId));
      await tx.execute(sql`select pg_notify(${AGENTS_CHANNEL}, ${sessionId})`);
      return { last };
    });
  } catch (error) {
    throw codeOf(error) === NO_PARTITION ? new TranscriptError("transcript.away") : error;
  }
}

const eventColumns = {
  n: transcriptEvents.n,
  kind: transcriptEvents.kind,
  at: transcriptEvents.at,
  text: transcriptEvents.text,
  textSha256: transcriptEvents.textSha256,
  textSize: transcriptEvents.textSize,
  data: transcriptEvents.data,
  files: transcriptEvents.files,
  sealedAt: transcriptEvents.sealedAt,
  sealedReason: transcriptEvents.sealedReason,
  sealedBy: personColumns(people),
};

type EventRow = {
  readonly n: number;
  readonly kind: TranscriptKind;
  readonly at: Date;
  readonly text: string;
  readonly textSha256: string | null;
  readonly textSize: number | null;
  readonly data: Record<string, string | number | boolean | null>;
  readonly files: TranscriptFileRecord[];
  readonly sealedAt: Date | null;
  readonly sealedReason: string | null;
  readonly sealedBy: Parameters<typeof toPerson>[0] | null;
};

const toEvent = (row: EventRow): TranscriptEventRecord => ({
  n: row.n,
  kind: row.kind,
  at: row.at,
  text: row.text,
  whole: row.textSize ?? undefined,
  data: row.data,
  files: row.files,
  sealed:
    row.sealedAt === null
      ? undefined
      : {
          by: row.sealedBy === null ? undefined : toPerson(row.sealedBy),
          at: row.sealedAt,
          reason: row.sealedReason ?? "",
        },
});

/** The events of a session after a number, in order: a page of them, and whether there are more. */
export async function listSessionEvents(
  database: Database,
  session: SessionRecord,
  after: number,
  limit: number,
): Promise<{ readonly items: TranscriptEventRecord[]; readonly more: boolean }> {
  const rows = await drizzleOf(database)
    .select(eventColumns)
    .from(transcriptEvents)
    .leftJoin(people, eq(people.id, transcriptEvents.sealedById))
    .where(
      and(
        eq(transcriptEvents.month, session.month),
        eq(transcriptEvents.sessionId, session.id),
        gt(transcriptEvents.n, after),
      ),
    )
    .orderBy(asc(transcriptEvents.n))
    .limit(limit + 1);
  return { items: rows.slice(0, limit).map(toEvent), more: rows.length > limit };
}

/**
 * The whole text of one event: the row's, or what the month's shelf keeps for one whose row
 * keeps its beginning alone. Nothing for an event that is not there; the text a sealed event has
 * left, which is none.
 */
export async function wholeTextOf(
  database: Database,
  blobs: BlobStore,
  session: SessionRecord,
  n: number,
): Promise<string | undefined> {
  const [row] = await drizzleOf(database)
    .select({ text: transcriptEvents.text, textSha256: transcriptEvents.textSha256 })
    .from(transcriptEvents)
    .where(
      and(
        eq(transcriptEvents.month, session.month),
        eq(transcriptEvents.sessionId, session.id),
        eq(transcriptEvents.n, n),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return undefined;
  }
  if (row.textSha256 === null) {
    return row.text;
  }
  const bytes = await blobs.get(row.textSha256, { transcript: session.month });
  return bytes === undefined ? row.text : Buffer.from(bytes).toString("utf8");
}

/**
 * Seals an event (ADR-0086, point 5): what it held is replaced by who sealed it, when and why,
 * and its long text and its pictures are taken off the month's shelf where nothing else of the
 * month names the same bytes. Its number, its kind and its time stay. An event sealed already
 * stays as it was sealed.
 */
export async function sealEvent(
  database: Database,
  blobs: BlobStore,
  input: {
    readonly session: SessionRecord;
    readonly n: number;
    readonly by: PersonRecord;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<TranscriptEventRecord> {
  const { session, n, by, reason, now } = input;
  const one = and(
    eq(transcriptEvents.month, session.month),
    eq(transcriptEvents.sessionId, session.id),
    eq(transcriptEvents.n, n),
  );
  const hashes = await drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .select({
        textSha256: transcriptEvents.textSha256,
        files: transcriptEvents.files,
        sealedAt: transcriptEvents.sealedAt,
      })
      .from(transcriptEvents)
      .where(one)
      .for("update");
    if (row === undefined) {
      throw new TranscriptError("transcript.event_not_found");
    }
    if (row.sealedAt !== null) {
      return [];
    }
    await tx
      .update(transcriptEvents)
      .set({
        text: "",
        textSha256: null,
        textSize: null,
        data: {},
        files: [],
        sealedAt: now,
        sealedById: by.id,
        sealedReason: reason,
      })
      .where(one);
    if (row.files.length > 0) {
      await tx.delete(transcriptFiles).where(
        and(
          eq(transcriptFiles.month, session.month),
          inArray(
            transcriptFiles.id,
            row.files.map((file) => file.id),
          ),
        ),
      );
    }
    return [
      ...(row.textSha256 === null ? [] : [row.textSha256]),
      ...row.files.map((file) => file.sha256),
    ];
  });
  // The same bytes may be what another event of the month says too: those stay.
  const handle = drizzleOf(database);
  for (const sha256 of new Set(hashes)) {
    const [text] = await handle
      .select({ n: transcriptEvents.n })
      .from(transcriptEvents)
      .where(
        and(eq(transcriptEvents.month, session.month), eq(transcriptEvents.textSha256, sha256)),
      )
      .limit(1);
    const [file] = await handle
      .select({ id: transcriptFiles.id })
      .from(transcriptFiles)
      .where(and(eq(transcriptFiles.month, session.month), eq(transcriptFiles.sha256, sha256)))
      .limit(1);
    if (text === undefined && file === undefined) {
      await blobs.remove(sha256, { transcript: session.month });
    }
  }
  const [sealed] = await handle
    .select(eventColumns)
    .from(transcriptEvents)
    .leftJoin(people, eq(people.id, transcriptEvents.sealedById))
    .where(one)
    .limit(1);
  if (sealed === undefined) {
    throw new TranscriptError("transcript.event_not_found");
  }
  return toEvent(sealed);
}
