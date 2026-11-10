import type { Database } from "../db/client.js";
import { drizzleOf } from "../db/client.js";
import { sendSignal } from "../db/queries/agent-runners.js";
import { boardWakesOf, moveWakeCursor, takeWakeCursor } from "../db/queries/board-wakes.js";
import { listAllEventsAfter } from "../db/queries/events.js";
import { readWorkspaceSettings } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";

/** How often the worker reads the feed for the agent accounts (ADR-0085). */
export const BOARD_WAKES_INTERVAL_MS = 5_000;
/** How many events one pass reads, and how many times it reads on while there are more. */
const BATCH = 100;
const MAX_BATCHES = 10;

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

/**
 * The board's wakes (ADR-0085, point 10): the worker reads the feed from where it read it to,
 * and sends each agent account the wakes an event means to it, a signal each on the account's
 * record. One pass at a time, in whatever process: the place in the feed is the pass's lock.
 * An event's wakes are sent before the place moves past it, so that a pass that ends halfway
 * sends an event's wakes again, which an agent reads as one, and never loses one.
 */
export class BoardWakes {
  readonly #database: Database;
  readonly #workspaceId: () => Promise<string>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly database: Database;
    readonly workspaceId: () => Promise<string>;
    readonly clock: Clock;
    readonly logger: Logger;
  }) {
    this.#database = options.database;
    this.#workspaceId = options.workspaceId;
    this.#clock = options.clock;
    this.#logger = options.logger;
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
    return drizzleOf(database).transaction(async (tx) => {
      const now = this.#clock.now();
      const taken = await takeWakeCursor(tx, workspaceId, now);
      if (taken === undefined) {
        return 0;
      }
      const settings = await readWorkspaceSettings(database, workspaceId);
      const today = dayIn(settings.timeZone, now);
      let after = taken;
      let sent = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const events = await listAllEventsAfter(database, workspaceId, after, BATCH);
        for (const event of events) {
          for (const wake of await boardWakesOf(database, event, today)) {
            await sendSignal(database, {
              account: wake.account,
              kind: "wake",
              // Who did what woke it, where the board says: the header names them.
              by:
                wake.source === "board" && event.actor !== undefined
                  ? { id: event.actor.id, agent: event.agent }
                  : undefined,
              source: wake.source,
              key: wake.key,
              text: wake.text,
              set: undefined,
              now,
            });
            sent += 1;
          }
          after = event.id;
        }
        if (events.length < BATCH) {
          break;
        }
      }
      if (after !== taken) {
        await moveWakeCursor(tx, workspaceId, after, now);
      }
      return sent;
    });
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
