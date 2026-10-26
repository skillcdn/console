import type { Database } from "../db/client.js";
import { endUnheardRuns } from "../db/queries/runs.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";

const HOUR_MS = 3_600_000;

/**
 * Ends what the console has not heard from for long enough (ADR-0041): a run open, not waiting
 * for an answer, and not heard from for `afterHours` is ended as abandoned, with a word that says
 * so and an event that names no actor. The task stays as it is. Every process may run it: a pass
 * that finds nothing ends nothing. The worker runs it on a schedule, and so does the `api` role
 * when told to carry the worker's work itself.
 */
export class RunCloser {
  readonly #database: Database;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #afterHours: number;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly database: Database;
    readonly clock: Clock;
    readonly logger: Logger;
    /** How many hours a run goes unheard before it is ended. */
    readonly afterHours: number;
  }) {
    this.#database = options.database;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#afterHours = options.afterHours;
  }

  /** One pass. Resolves when it is done, or given up on: a failed pass is the next one's work. */
  sweep(): Promise<void> {
    this.#running = this.#running.then(async () => {
      try {
        const now = this.#clock.now();
        const before = new Date(now.getTime() - this.#afterHours * HOUR_MS);
        const ended = await endUnheardRuns(this.#database, {
          before,
          now,
          summary: `Not heard from for ${this.#afterHours} hours; the console ended the run.`,
        });
        if (ended > 0) {
          this.#logger.info({ ended, afterHours: this.#afterHours }, "quiet runs were ended");
        }
      } catch (error) {
        this.#logger.warn({ err: error }, "quiet runs were not ended");
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
