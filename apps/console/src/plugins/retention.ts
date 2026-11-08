import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";

// The retention of the plugins' collections (docs/specs/plugins.md, "Records"): on a schedule,
// every enabled plugin's records past the days its collection keeps them are removed, with
// their versions, links and files. Runs in the worker role, or in the api role when it carries
// the worker; every process may run it, since removing twice removes once.

/** What the sweep asks of the registry. */
export interface Sweeping {
  sweepExpired(now: Date): Promise<Record<string, number>>;
}

export class PluginRetention {
  private readonly plugins: Sweeping;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly plugins: Sweeping;
    readonly clock: Clock;
    readonly logger: Logger;
  }) {
    this.plugins = options.plugins;
    this.clock = options.clock;
    this.logger = options.logger;
  }

  /** One pass. Resolves when it is done, or given up on: a failed pass is the next one's work. */
  sweep(): Promise<void> {
    this.running = this.running.then(async () => {
      try {
        await this.plugins.sweepExpired(this.clock.now());
      } catch (error) {
        this.logger.warn(
          { err: error },
          "the plugins' records past their retention were not removed",
        );
      }
    });
    return this.running;
  }

  start(intervalMs: number): void {
    if (this.timer === undefined) {
      this.timer = setInterval(() => void this.sweep(), intervalMs);
      this.timer.unref();
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
