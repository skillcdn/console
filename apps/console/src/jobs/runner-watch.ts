import type { Database } from "../db/client.js";
import { noteUnheardRunners } from "../db/queries/agent-runners.js";
import { ensureMonths, monthAfter, monthOf } from "../db/queries/transcript.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";

/** How long a runner goes unheard before the console says so of its agent (ADR-0085). */
export const RUNNER_UNHEARD_MS = 5 * 60_000;
/** How often the worker looks. */
export const RUNNER_WATCH_INTERVAL_MS = 60_000;

/**
 * What the worker does for the agent accounts on a schedule. It notes those whose runner was
 * last heard from too long ago (ADR-0085): the agent's state becomes `unheard`, and the
 * workspace is told, by nobody, so that whoever manages it hears of it; the runner's next
 * heartbeat says how the agent stands again. And it makes the partitions of the transcript for
 * this month and the next ahead of time (ADR-0086), so that a session that begins as a month
 * turns finds its month there. Every process may run it: a pass that finds nothing does nothing.
 * The worker runs it, and so does the `api` role when told to carry the worker's work itself.
 */
export class RunnerWatch {
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
        const now = this.#clock.now();
        const noted = await noteUnheardRunners(this.#database, {
          before: new Date(now.getTime() - RUNNER_UNHEARD_MS),
          now,
        });
        if (noted > 0) {
          this.#logger.info({ noted }, "runners not heard from were noted");
        }
      } catch (error) {
        this.#logger.warn({ err: error }, "runners not heard from were not noted");
      }
      try {
        const month = monthOf(this.#clock.now());
        await ensureMonths(this.#database, [month, monthAfter(month)]);
      } catch (error) {
        this.#logger.warn({ err: error }, "the transcript's months were not made ahead");
      }
    });
    return this.#running;
  }

  start(intervalMs: number = RUNNER_WATCH_INTERVAL_MS): void {
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
