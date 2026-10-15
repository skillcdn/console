import type { Database } from "../db/client.js";
import { archiveStaleTasks } from "../db/queries/tasks.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";

const DAY_MS = 86_400_000;

/**
 * Puts away what has been done or dropped for long enough (ADR-0029): a task closed and not
 * touched for `afterDays` goes to the archive, out of the board, the lists and the calendar, and
 * stays open by its number. Nothing is deleted, and a person brings a task back from the archive
 * at any time. Every process may run it: archiving twice archives once. The worker runs it on a
 * schedule, and so does the `api` role when told to carry the worker's work itself.
 */
export class Archivist {
  readonly #database: Database;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #afterDays: number;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly database: Database;
    readonly clock: Clock;
    readonly logger: Logger;
    /** How many days after a task was done or dropped it is put away. */
    readonly afterDays: number;
  }) {
    this.#database = options.database;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#afterDays = options.afterDays;
  }

  /** One pass. Resolves when it is done, or given up on: a failed pass is the next one's work. */
  sweep(): Promise<void> {
    this.#running = this.#running.then(async () => {
      try {
        const now = this.#clock.now();
        const before = new Date(now.getTime() - this.#afterDays * DAY_MS);
        const archived = await archiveStaleTasks(this.#database, { before, now });
        if (archived > 0) {
          this.#logger.info({ archived, afterDays: this.#afterDays }, "closed tasks were put away");
        }
      } catch (error) {
        this.#logger.warn({ err: error }, "closed tasks were not put away");
      }
    });
    return this.#running;
  }

  start(intervalMs: number): void {
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
