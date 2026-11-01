import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate.js";

describe("createRateLimiter", () => {
  it("allows the bound a minute by key, and begins again with the next minute", () => {
    let now = new Date("2026-11-02T09:00:00.000Z");
    const limiter = createRateLimiter({ perMinute: 2, clock: { now: () => now } });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    // Another key has a bound of its own.
    expect(limiter.take("b")).toBe(true);
    now = new Date("2026-11-02T09:00:59.999Z");
    expect(limiter.take("a")).toBe(false);
    now = new Date("2026-11-02T09:01:00.000Z");
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("allows nothing with a bound of zero", () => {
    const limiter = createRateLimiter({ perMinute: 0, clock: { now: () => new Date() } });
    expect(limiter.take("a")).toBe(false);
  });
});
