import type { CollectionDescription } from "@skillcdn/console/plugin";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";

// The retention of the plugins' collections (docs/specs/plugins.md, "Records"): on a schedule,
// every enabled plugin's records past the days its collection keeps them are removed, with
// their versions, links and files. Runs in the worker role, or in the api role when it carries
// the worker; every process may run it, since removing twice removes once. A pass has a minute,
// each collection is swept apart from the others, and what a pass leaves is the next one's.

/** How long one pass sweeps before leaving the rest to the next, an hour later. */
const SWEEP_PASS_MS = 60_000;

/** What the sweep asks of the registry: one pass, until `more` says its time is up. */
export interface Sweeping {
  sweepExpired(now: Date, more?: () => boolean): Promise<Record<string, number>>;
}

/** A collection with a retention, and whose it is. */
export interface SweepTarget {
  readonly plugin: string;
  readonly collection: CollectionDescription;
}

/**
 * One pass over the collections with a retention, each swept on its own: one that fails, a
 * statement that ran out of time or a database that went away, is a line in the log, and the
 * others are swept all the same; the pass ends where `more` says its time is up. Answers how many
 * records went, by plugin.
 */
export async function sweepCollections(
  targets: readonly SweepTarget[],
  sweep: (target: SweepTarget) => Promise<number>,
  options: { readonly logger: Logger; readonly more: () => boolean },
): Promise<Record<string, number>> {
  const swept: Record<string, number> = {};
  for (const target of targets) {
    if (!options.more()) {
      break;
    }
    const where = { plugin: target.plugin, collection: target.collection.name };
    try {
      const removed = await sweep(target);
      if (removed > 0) {
        swept[target.plugin] = (swept[target.plugin] ?? 0) + removed;
        options.logger.info(
          { ...where, removed },
          "plugin records past their retention were removed",
        );
      }
    } catch (error) {
      options.logger.warn(
        { ...where, err: error },
        "a plugin's records past their retention were not removed",
      );
    }
  }
  return swept;
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
      const began = performance.now();
      try {
        await this.plugins.sweepExpired(
          this.clock.now(),
          () => performance.now() - began < SWEEP_PASS_MS,
        );
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
