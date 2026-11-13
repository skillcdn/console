import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { isMonth } from "../../ports/blob-store.js";
import { chainNext, chainStart, eventDigest } from "../../transcript-chain.js";
import { type Database, drizzleOf } from "../client.js";
import { transcriptEvents, transcriptSessions } from "../schema.js";
import { attachedMonths } from "./transcript.js";

// The check of a month of the transcript against what its sessions keep (ADR-0090, ADR-0103):
// the head of the chain their events fold to, which of their events were sealed, and how many
// they have. For whoever brought a month back, or wants to know that one still is what it was.
// Read-only.

/** How many events are read at a time. */
const PAGE = 500;

/** Why a session does not hold, in a few words, and at which event. */
export interface BrokenSession {
  readonly session: string;
  readonly month: string;
  readonly at: number;
  readonly why:
    | "an event is missing"
    | "an event has no digest"
    | "an event is not what its digest says"
    | "an event is sealed that the session did not seal"
    | "an event the session sealed holds something"
    | "an event is numbered past the session's last"
    | "the events do not come to the session's head";
}

export interface TranscriptCheck {
  /** The months checked, and those asked for whose events are away. */
  readonly months: readonly string[];
  readonly away: readonly string[];
  readonly sessions: number;
  readonly events: number;
  /** The events that were sealed, each one its session says it sealed: their digests are taken as they are, what they held being gone. */
  readonly sealed: number;
  /** The sessions begun before the chain was kept, which have none to check. */
  readonly unchained: number;
  readonly broken: readonly BrokenSession[];
}

/**
 * Checks the sessions of the months named, or of every month whose events are there: each
 * event against its digest, and the digests, in order and without a gap, against the head the
 * session keeps. An event that is sealed is one its session says it sealed, and one the session
 * sealed is sealed still: what a sealed event held is gone, so nothing else would say that an
 * event was emptied while its month was away. A session that is over has no event past its
 * last; one that is open is checked up to the event its row names.
 */
export async function checkTranscript(
  database: Database,
  input: { readonly months?: readonly string[] | undefined } = {},
): Promise<TranscriptCheck> {
  const handle = drizzleOf(database);
  const attached = await attachedMonths(database);
  const asked = (input.months ?? [...attached]).filter(isMonth).sort();
  const months = asked.filter((month) => attached.has(month));
  const broken: BrokenSession[] = [];
  let sessions = 0;
  let events = 0;
  let sealed = 0;
  let unchained = 0;
  if (months.length === 0) {
    return { months, away: asked, sessions, events, sealed, unchained, broken };
  }
  const rows = await handle
    .select({
      id: transcriptSessions.id,
      month: transcriptSessions.month,
      events: transcriptSessions.events,
      chain: transcriptSessions.chain,
      sealed: transcriptSessions.sealed,
      endedAt: transcriptSessions.endedAt,
    })
    .from(transcriptSessions)
    .where(inArray(transcriptSessions.month, months))
    .orderBy(asc(transcriptSessions.month), asc(transcriptSessions.startedAt));
  for (const session of rows) {
    sessions += 1;
    if (session.chain === null) {
      unchained += 1;
      continue;
    }
    let chain = chainStart(session.id);
    let last = 0;
    let problem: BrokenSession | undefined;
    // What the session says it sealed. Read again before an event is said to be sealed without
    // it: a seal kept after the session's row was read is in the row by then, with its event.
    let noted = new Set(session.sealed);
    const sealedByTheSession = async (n: number): Promise<boolean> => {
      if (!noted.has(n)) {
        const [again] = await handle
          .select({ sealed: transcriptSessions.sealed })
          .from(transcriptSessions)
          .where(eq(transcriptSessions.id, session.id))
          .limit(1);
        noted = new Set(again?.sealed ?? []);
      }
      return noted.has(n);
    };
    const fails = (at: number, why: BrokenSession["why"]): BrokenSession => ({
      session: session.id,
      month: session.month,
      at,
      why,
    });
    while (problem === undefined && last < session.events) {
      const page = await handle
        .select()
        .from(transcriptEvents)
        .where(
          and(
            eq(transcriptEvents.month, session.month),
            eq(transcriptEvents.sessionId, session.id),
            gt(transcriptEvents.n, last),
            lte(transcriptEvents.n, session.events),
          ),
        )
        .orderBy(asc(transcriptEvents.n))
        .limit(PAGE);
      if (page.length === 0) {
        problem = fails(last + 1, "an event is missing");
        break;
      }
      for (const event of page) {
        if (event.n !== last + 1) {
          problem = fails(last + 1, "an event is missing");
          break;
        }
        last = event.n;
        events += 1;
        if (event.digest === null) {
          problem = fails(event.n, "an event has no digest");
          break;
        }
        if (event.sealedAt !== null) {
          // What it held is gone, on the record: its digest is the link, as it was kept, and
          // the session's own word that it sealed the event is what says so.
          if (!(await sealedByTheSession(event.n))) {
            problem = fails(event.n, "an event is sealed that the session did not seal");
            break;
          }
          sealed += 1;
        } else if (session.sealed.includes(event.n)) {
          problem = fails(event.n, "an event the session sealed holds something");
          break;
        } else if (
          eventDigest({
            sessionId: event.sessionId,
            n: event.n,
            kind: event.kind,
            at: event.at,
            text: event.text,
            textSha256: event.textSha256,
            textSize: event.textSize,
            data: event.data,
            files: event.files,
          }) !== event.digest
        ) {
          problem = fails(event.n, "an event is not what its digest says");
          break;
        }
        chain = chainNext(chain, event.digest);
      }
    }
    if (problem === undefined && chain !== session.chain) {
      problem = fails(last, "the events do not come to the session's head");
    }
    if (problem === undefined && session.endedAt !== null) {
      // A session that is over takes nothing more: a row past its last event was put there.
      const [past] = await handle
        .select({ n: transcriptEvents.n })
        .from(transcriptEvents)
        .where(
          and(
            eq(transcriptEvents.month, session.month),
            eq(transcriptEvents.sessionId, session.id),
            gt(transcriptEvents.n, session.events),
          ),
        )
        .orderBy(asc(transcriptEvents.n))
        .limit(1);
      if (past !== undefined) {
        problem = fails(past.n, "an event is numbered past the session's last");
      }
    }
    if (problem !== undefined) {
      broken.push(problem);
    }
  }
  return {
    months,
    away: asked.filter((month) => !attached.has(month)),
    sessions,
    events,
    sealed,
    unchained,
    broken,
  };
}
