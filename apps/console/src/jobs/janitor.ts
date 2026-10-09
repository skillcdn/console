import type { Database } from "../db/client.js";
import { deleteExpiredSessions } from "../db/queries/sessions.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";

/**
 * Removes what time has ended: sessions past their end. None of it is needed for correctness,
 * since every read checks the time itself; this only keeps the tables from growing. Every
 * process may run it: deleting twice deletes once. The worker runs it on a schedule, and so
 * does the `api` role when told to carry the worker's work itself.
 */
export class Janitor {
  readonly #database: Database;
  readonly #clock: Clock;
  readonly #logger: Logger;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly database: Database;
    readonly clock: Clock;
    readonly logger: Logger;
  }) {
    this.#database = options.database;
    this.#clock = options.clock;
    this.#logger = options.logger;
  }

  /** One pass. Resolves when it is done, or given up on: a failed pass is the next one's work. */
  sweep(): Promise<void> {
    this.#running = this.#running.then(async () => {
      try {
        const sessions = await deleteExpiredSessions(this.#database, this.#clock.now());
        if (sessions > 0) {
          this.#logger.info({ sessions }, "what time has ended was removed");
        }
      } catch (error) {
        this.#logger.warn({ err: error }, "what time has ended was not removed");
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
