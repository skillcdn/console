import { MAX_OWN_WAKES_PER_HOUR } from "@skillcdn/console/api";
import type { Database } from "../db/client.js";
import { drizzleOf } from "../db/client.js";
import { RunnerError, sendSignal } from "../db/queries/agent-runners.js";
import { lapseSecretOffers } from "../db/queries/agent-secret-offers.js";
import { dueOwnWakes, OwnWakeGone, takeOwnWake } from "../db/queries/agent-wakes.js";
import {
  accountsToBrief,
  type BoardTelling,
  boardTellingsOf,
  boardWakesOf,
  moveWakeCursor,
  noteBriefed,
  noteSecretWarned,
  plateOf,
  secretsEnding,
  takeWakeCursor,
} from "../db/queries/board-wakes.js";
import { settledEnd, unsettledFor } from "../db/queries/event-order.js";
import { type EventRecord, listAllEventsAfter } from "../db/queries/events.js";
import { makeNotification } from "../db/queries/notifications.js";
import { readWorkspaceSettings } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import {
  briefingOf,
  briefingsDue,
  clockIn,
  dayAfter,
  OWN_WAKE_WORDS,
  secretWake,
  WRAP_BRIEFING,
} from "./briefings.js";

/** How often the worker reads the feed for the agent accounts (ADR-0085). */
export const BOARD_WAKES_INTERVAL_MS = 5_000;
/** How many events one pass reads, and how many times it reads on while there are more. */
const BATCH = 100;
const MAX_BATCHES = 10;
/** How many days before a secret's day its account is told of it. */
export const SECRET_WARNING_DAYS = 30;
/**
 * How many passes in a row may fail at one event before it is passed over: a minute of them,
 * which a database that was away for a moment does not fill and a wake that can never be sent
 * always does.
 */
export const WAKE_TRIES = 12;
/**
 * For how long the feed may stand unsettled before the job says so in the log, and how long it
 * waits before it says so again: a writer that is stuck is ended by the server within thirty
 * seconds, so longer than that is writers that overlap without a gap, or something worse.
 */
export const UNSETTLED_WARNING_MS = 30_000;
const UNSETTLED_WARNING_EVERY_MS = 60_000;

/** The day it is in a time zone, as the board writes a day; in UTC where the zone is none or unknown. */
export function dayIn(zone: string | null | undefined, now: Date): string {
  const parts = (timeZone: string): string => {
    const said = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => said.find((one) => one.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  if (zone !== null && zone !== undefined) {
    try {
      return parts(zone);
    } catch {
      // A zone this runtime does not know: the day everyone shares.
    }
  }
  return parts("UTC");
}

/** A member was told of this event already, by a pass that ended before it kept its place. */
class AlreadyTold extends Error {}

/**
 * Whom the board tells (ADR-0157, and ADR-0085, point 10): the worker reads the feed from where
 * it read it to, and makes each member the notification an event means to them, which for an
 * agent account is a wake too, a signal on the account's record made with its notification or
 * not at all. One pass at a time, in whatever process: the place in the feed is the pass's
 * lock. An event is told before the place moves past it, and the place is kept a batch at a
 * time: a pass that ends halfway reads again the batch it was in and tells nobody of the board
 * twice, since a member is told of an event once, and never loses one. What the console wakes
 * every account for of its own accord, a change of the workspace's services, has no
 * notification to be told once by: a pass that failed in the middle of it sends it again to
 * those it had reached, which an agent reads as one. A pass reads no
 * further than the feed's settled end (ADR-0125): an event numbered before another and
 * committed after it is read when it is there, never passed over. An event whose wakes fail
 * pass after pass is passed over after `WAKE_TRIES` of them, with an error in the log that
 * names it, so that one wake that can never be sent does not hold every wake after it.
 */
export class BoardWakes {
  readonly #database: Database;
  readonly #workspaceId: () => Promise<string>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #tries: number;
  readonly #unsettledWarningMs: number;
  readonly #ownWakesPerHour: number;
  /** When the job last said that the feed stands unsettled, on this process's own clock. */
  #warnedOfUnsettled: number | undefined;
  /** The event the last failed pass stopped at, and how many passes in a row have: kept by this process. */
  #stuck: { readonly event: number; readonly tries: number } | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly database: Database;
    readonly workspaceId: () => Promise<string>;
    readonly clock: Clock;
    readonly logger: Logger;
    /** How many passes in a row may fail at one event before it is passed over; `WAKE_TRIES` when left out. */
    readonly tries?: number | undefined;
    /** For how long the feed may stand unsettled before the job says so; `UNSETTLED_WARNING_MS` when left out. */
    readonly unsettledWarningMs?: number | undefined;
    /** How many wakes an account raises for itself within an hour, those kept for later among them; `MAX_OWN_WAKES_PER_HOUR` when left out. */
    readonly ownWakesPerHour?: number | undefined;
  }) {
    this.#database = options.database;
    this.#workspaceId = options.workspaceId;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#tries = options.tries ?? WAKE_TRIES;
    this.#unsettledWarningMs = options.unsettledWarningMs ?? UNSETTLED_WARNING_MS;
    this.#ownWakesPerHour = options.ownWakesPerHour ?? MAX_OWN_WAKES_PER_HOUR;
  }

  /** One pass. Resolves when it is done, or given up on: a failed pass is the next one's work. */
  sweep(): Promise<void> {
    this.#running = this.#running.then(async () => {
      try {
        const sent = await this.#pass();
        if (sent > 0) {
          this.#logger.info({ sent }, "agent accounts were woken by the board");
        }
      } catch (error) {
        this.#logger.warn({ err: error }, "the board's wakes were not sent");
      }
    });
    return this.#running;
  }

  async #pass(): Promise<number> {
    const database = this.#database;
    const workspaceId = await this.#workspaceId();
    let sent = 0;
    // A batch a transaction: the place is taken, the batch's wakes are sent, and the place is
    // kept before the next batch is read. Where an event's wakes fail, the place is kept at the
    // event before it: what was sent for the events before is not sent again.
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const last = batch === MAX_BATCHES - 1;
      // Asked before the place is taken, on a connection of its own: the lock it asks for is
      // never held by the pass. Nothing where this process never saw the feed settle and a
      // writer is under way: the events are the next pass's, and the schedule is still this one's.
      const through = await settledEnd(database, "console");
      this.#sayUnsettled();
      const read = await drizzleOf(database).transaction(async (tx) => {
        const now = this.#clock.now();
        const taken = await takeWakeCursor(tx, workspaceId, now);
        if (taken === undefined) {
          return undefined;
        }
        const settings = await readWorkspaceSettings(database, workspaceId);
        const today = dayIn(settings.timeZone, now);
        let after = taken;
        let woke = 0;
        let failed: { readonly error: unknown; readonly event: EventRecord } | undefined;
        let passedOver = false;
        const events =
          through === undefined
            ? []
            : await listAllEventsAfter(database, workspaceId, after, BATCH, through);
        let at: EventRecord | undefined;
        try {
          for (const event of events) {
            at = event;
            for (const telling of await boardTellingsOf(database, event, today)) {
              woke += await this.#tell(event, telling, now);
            }
            // What the console says of its own accord: no notification, and nobody's to turn off.
            for (const wake of await boardWakesOf(database, event)) {
              await sendSignal(database, {
                account: wake.account,
                kind: "wake",
                by: undefined,
                source: wake.source,
                key: wake.key,
                text: wake.text,
                set: undefined,
                now,
              });
              woke += 1;
            }
            after = event.id;
          }
        } catch (error) {
          if (at === undefined) {
            throw error;
          }
          failed = { error, event: at };
        }
        if (failed !== undefined) {
          const tries = this.#stuck?.event === failed.event.id ? this.#stuck.tries + 1 : 1;
          this.#stuck = { event: failed.event.id, tries };
          if (tries >= this.#tries) {
            // A wake that fails every time would hold every wake after it for good. It is
            // passed over, and said where the job's failures are said: nothing of the event but
            // its number and its kind, which is all the log may hold of the board.
            this.#logger.error(
              { err: failed.error, event: failed.event.id, kind: failed.event.kind, tries },
              "an event's wakes failed every time and were passed over",
            );
            after = failed.event.id;
            this.#stuck = undefined;
            failed = undefined;
            passedOver = true;
          }
        }
        if (after !== taken) {
          await moveWakeCursor(tx, workspaceId, after, now);
        }
        // Passed over in the middle of a batch: the rest of it is read on from there.
        const more = failed === undefined && (passedOver || events.length === BATCH);
        if (failed === undefined && (!more || last)) {
          // What the schedule sends, under the same lock: one pass at a time notes a day as sent.
          const scheduled = { now, today, clock: clockIn(settings.timeZone, now) };
          woke += await this.#brief(workspaceId, settings.weekStart, scheduled);
          woke += await this.#warn(workspaceId, scheduled);
          // An offered secret whose days ran out (ADR-0169): its value is gone from the row
          // from here on, whoever reads the account's listing or does not. Nobody is woken.
          await lapseSecretOffers(this.#database, workspaceId, now);
          woke += await this.#own(workspaceId, now);
        }
        return { woke, more, failed };
      });
      if (read === undefined) {
        break;
      }
      sent += read.woke;
      if (read.failed !== undefined) {
        // The place is kept: the pass is given up on here, and the next begins at the event that failed.
        throw read.failed.error;
      }
      if (!read.more) {
        break;
      }
    }
    return sent;
  }

  /**
   * Tells one member of an event: their notification, and for an agent account the wake that
   * is how it learns of anything, the two made together or neither. How many were woken.
   */
  async #tell(event: EventRecord, telling: BoardTelling, now: Date): Promise<number> {
    const database = this.#database;
    const make = (tx: Parameters<typeof makeNotification>[0], woken: boolean) =>
      makeNotification(tx, {
        workspaceId: event.workspaceId,
        personId: telling.person.id,
        eventId: event.id,
        kind: telling.kind,
        followed: telling.followed,
        woken,
        projectId: telling.projectId,
        taskId: telling.taskId,
        decisionId: telling.decisionId,
        aboutId: telling.aboutId,
        createdAt: event.createdAt,
      });
    if (telling.person.kind !== "agent") {
      await drizzleOf(database).transaction((tx) => make(tx, false));
      return 0;
    }
    try {
      await sendSignal(database, {
        account: telling.person,
        kind: "wake",
        // Who did what woke it, where the board says: the header names them.
        by: event.actor === undefined ? undefined : { id: event.actor.id, agent: event.agent },
        source: "board",
        key: telling.key,
        text: telling.text,
        set: undefined,
        within: async (tx) => {
          if (!(await make(tx, true))) {
            throw new AlreadyTold();
          }
        },
        now,
      });
      return 1;
    } catch (error) {
      if (error instanceof AlreadyTold) {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Says in the log that the feed has stood unsettled for long: events are committed and no
   * moment comes at which no writer is under way, so the wakes, the hooks and the pages read no
   * further (ADR-0125). Nothing is lost, and it ends with the writers; said so that it does not
   * last unseen, once a minute at most.
   */
  #sayUnsettled(): void {
    const unsettled = unsettledFor(this.#database, "console");
    const now = performance.now();
    if (
      unsettled <= this.#unsettledWarningMs ||
      (this.#warnedOfUnsettled !== undefined &&
        now - this.#warnedOfUnsettled < UNSETTLED_WARNING_EVERY_MS)
    ) {
      return;
    }
    this.#warnedOfUnsettled = now;
    this.#logger.warn(
      { seconds: Math.round(unsettled / 1000) },
      "the feed has not settled: its writers overlap without a gap, or one of them is stuck",
    );
  }

  /**
   * The briefings (ADR-0085, point 11): to each account whose runner was heard from, at the
   * hours it keeps, once a day each. The day is noted before the next account is looked at, so
   * that a pass that ends halfway sends nobody the same briefing twice.
   */
  async #brief(
    workspaceId: string,
    weekStart: string,
    at: { readonly now: Date; readonly today: string; readonly clock: string },
  ): Promise<number> {
    const database = this.#database;
    let sent = 0;
    for (const one of await accountsToBrief(database, workspaceId)) {
      const due = briefingsDue({ ...one, today: at.today, clock: at.clock, weekStart });
      for (const kind of due) {
        const text =
          kind === "wrap"
            ? WRAP_BRIEFING
            : briefingOf(kind, {
                today: at.today,
                ...(await plateOf(database, workspaceId, one.account)),
              });
        await noteBriefed(
          database,
          one.account.id,
          kind === "wrap" ? { wrappedOn: at.today } : { briefedOn: at.today },
        );
        await sendSignal(database, {
          account: one.account,
          kind: "wake",
          by: undefined,
          source: "schedule",
          key: kind,
          text,
          set: undefined,
          now: at.now,
        });
        sent += 1;
      }
    }
    return sent;
  }

  /** A wake from the console a month before a secret's day (ADR-0087), once for a value. */
  async #warn(
    workspaceId: string,
    at: { readonly now: Date; readonly today: string },
  ): Promise<number> {
    const database = this.#database;
    const ending = await secretsEnding(
      database,
      workspaceId,
      dayAfter(at.today, SECRET_WARNING_DAYS),
    );
    for (const secret of ending) {
      await noteSecretWarned(database, secret.account.id, secret.name, at.today);
      await sendSignal(database, {
        account: secret.account,
        kind: "wake",
        by: undefined,
        source: "console",
        key: `secret:${secret.name}`,
        text: secretWake(secret.name, secret.expiresOn),
        set: undefined,
        now: at.now,
      });
    }
    return ending.length;
  }

  /**
   * The wakes agent accounts kept for themselves whose moment has come (ADR-0145): each raised
   * once, as a signal of the account's record sent by the account, and taken in the
   * transaction that raises it. The hour's bound on an account's own wakes holds here as it
   * does for one raised at once: a wake that is due while the hour is full stays kept, and is
   * raised by a later pass, when the hour has room. One that cannot be raised costs no other.
   */
  async #own(workspaceId: string, now: Date): Promise<number> {
    const database = this.#database;
    /** The accounts whose hour is full: nothing more of theirs is tried in this pass. */
    const full = new Set<string>();
    let raised = 0;
    for (const { account, wake } of await dueOwnWakes(database, workspaceId, now)) {
      if (full.has(account.id)) {
        continue;
      }
      try {
        await sendSignal(database, {
          account,
          kind: "wake",
          by: { id: account.id, ...(wake.agent === undefined ? {} : { agent: wake.agent }) },
          source: "person",
          key: wake.key,
          text: wake.text.length === 0 ? OWN_WAKE_WORDS : wake.text,
          set: undefined,
          perHour: this.#ownWakesPerHour,
          within: (tx) => takeOwnWake(tx, account.id, wake),
          now,
        });
        raised += 1;
      } catch (error) {
        if (error instanceof RunnerError) {
          full.add(account.id);
        } else if (!(error instanceof OwnWakeGone)) {
          // Kept as it was, and tried by the next pass: nothing of the wake but that it failed.
          this.#logger.warn({ err: error }, "a wake an account kept for itself was not raised");
        }
      }
    }
    return raised;
  }

  start(intervalMs: number = BOARD_WAKES_INTERVAL_MS): void {
    if (this.#timer === undefined) {
      this.#timer = setInterval(() => void this.sweep(), intervalMs);
      this.#timer.unref();
    }
  }

  /** Stops the timer and waits for a pass that is under way. */
  async close(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }
}
