import { describe, expect, it } from "vitest";
import { nextRunAfter, nextTimeMoved, timeOfDayIn } from "./scheduler.js";

describe("a job's next time, when the time zone changes", () => {
  it("reads the time of day an instant falls at in a zone", () => {
    expect(timeOfDayIn(new Date("2026-11-02T17:00:00.000Z"), "Asia/Seoul")).toBe("02:00");
    expect(timeOfDayIn(new Date("2026-11-02T17:00:00.000Z"), "UTC")).toBe("17:00");
    expect(timeOfDayIn(new Date("2026-11-02T17:00:00.000Z"), "Nowhere/Land")).toBe("17:00");
  });

  it("moves where the next time written no longer falls at the job's time of day in the zone", () => {
    // Written for UTC at 03:00: in Seoul that is noon, and the job is computed again.
    const written = new Date("2026-11-03T03:00:00.000Z");
    expect(nextTimeMoved(written, "03:00", "UTC")).toBe(false);
    expect(nextTimeMoved(written, "03:00", "Asia/Seoul")).toBe(true);
    // A job with no time of day follows its period and never moves.
    expect(nextTimeMoved(written, null, "Asia/Seoul")).toBe(false);
  });

  it("finds the time of day across a clock change, at the zone's offset on the day itself", () => {
    // New York leaves daylight time on 2026-11-01: 02:00 the day after is 07:00Z, not 06:00Z.
    expect(
      nextRunAfter(new Date("2026-10-31T12:00:00.000Z"), "P1D", "02:00", "America/New_York"),
    ).toEqual(new Date("2026-11-01T07:00:00.000Z"));
  });
});

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
