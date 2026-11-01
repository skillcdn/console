import type { Clock } from "../ports/clock.js";

// A bound on how often something happens a minute, by key (docs/specs/plugins.md, "Limits and
// refusals"): the webhook requests a plugin takes. A fixed window of one minute per key, in
// memory, for the one api role a deployment runs; a deployment with several shares nothing here
// and bounds each on its own, which is more than the bound and never less.

export interface RateLimiter {
  /** Whether one more may happen now for `key`; counts it when it may. */
  take(key: string): boolean;
}

export function createRateLimiter(options: {
  readonly perMinute: number;
  readonly clock: Clock;
}): RateLimiter {
  const windows = new Map<string, { readonly minute: number; count: number }>();
  return {
    take(key) {
      const minute = Math.floor(options.clock.now().getTime() / 60_000);
      const current = windows.get(key);
      if (current === undefined || current.minute !== minute) {
        windows.set(key, { minute, count: 1 });
        // Windows that are over go, so that keys seen once do not stay for ever.
        for (const [other, window] of windows) {
          if (window.minute !== minute) {
            windows.delete(other);
          }
        }
        return options.perMinute >= 1;
      }
      if (current.count >= options.perMinute) {
        return false;
      }
      current.count += 1;
      return true;
    },
  };
}
