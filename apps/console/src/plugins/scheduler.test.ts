import { describe, expect, it } from "vitest";
import { nextRunAfter } from "./scheduler.js";

describe("nextRunAfter", () => {
  it("adds the period where no time of day is named", () => {
    const from = new Date("2026-11-02T09:00:00.000Z");
    expect(nextRunAfter(from, "PT5M", null, "UTC")).toEqual(new Date("2026-11-02T09:05:00.000Z"));
    expect(nextRunAfter(from, "P1D", null, "Asia/Seoul")).toEqual(
      new Date("2026-11-03T09:00:00.000Z"),
    );
    expect(nextRunAfter(from, "nonsense", null, "UTC")).toBeUndefined();
  });

  it("finds the next time of day in the workspace's zone, stepping by whole days", () => {
    // 09:00Z is 18:00 in Seoul: 02:00 Seoul time comes next the following day, at 17:00Z.
    const from = new Date("2026-11-02T09:00:00.000Z");
    expect(nextRunAfter(from, "P1D", "02:00", "Asia/Seoul")).toEqual(
      new Date("2026-11-02T17:00:00.000Z"),
    );
    // 20:00 Seoul time is later the same day, at 11:00Z.
    expect(nextRunAfter(from, "P1D", "20:00", "Asia/Seoul")).toEqual(
      new Date("2026-11-02T11:00:00.000Z"),
    );
    // A weekly job at 06:00 UTC, seen after today's 06:00: one period on, at 06:00, then every seven days.
    expect(nextRunAfter(from, "P7D", "06:00", "UTC")).toEqual(new Date("2026-11-09T06:00:00.000Z"));
    expect(nextRunAfter(new Date("2026-11-03T06:00:00.000Z"), "P7D", "06:00", "UTC")).toEqual(
      new Date("2026-11-10T06:00:00.000Z"),
    );
    // A zone the runtime does not know is read as UTC.
    expect(nextRunAfter(from, "P1D", "10:00", "Nowhere/Land")).toEqual(
      new Date("2026-11-02T10:00:00.000Z"),
    );
  });
});
