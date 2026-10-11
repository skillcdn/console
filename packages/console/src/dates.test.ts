import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dateOf,
  dayOf,
  daysBetween,
  firstDayOfWeek,
  formatDay,
  formatMonth,
  isDay,
  isMonth,
  monthGrid,
  monthOf,
  today,
  weekdays,
} from "./dates.js";

describe("days", () => {
  it("are the strings they are, read as local dates and written back the same", () => {
    expect(isDay("2026-10-20")).toBe(true);
    expect(isDay("2026-10-20T00:00:00Z")).toBe(false);
    expect(isDay("20 Oct")).toBe(false);
    expect(isDay(null)).toBe(false);
    expect(dayOf(dateOf("2026-10-20"))).toBe("2026-10-20");
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(today(new Date(2026, 9, 11, 1))).toBe("2026-10-11");
    expect(Number.isNaN(dateOf("not a day").getTime())).toBe(true);
  });

  it("count forward and back, across a month and a year", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-10-20", "2026-10-24")).toBe(4);
    expect(daysBetween("2026-10-24", "2026-10-20")).toBe(-4);
    expect(monthOf("2026-10-20")).toBe("2026-10");
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-10-20")).toBe(false);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("lay a month out in full weeks from the day the week begins on", () => {
    // October 2026 begins on a Thursday.
    const mondays = monthGrid("2026-10", 1);
    expect(mondays[0]?.map((cell) => cell.day)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(mondays[0]?.[2]?.inMonth).toBe(false);
    expect(mondays[0]?.[3]?.inMonth).toBe(true);
    expect(mondays).toHaveLength(5);
    expect(mondays.at(-1)?.at(-1)?.day).toBe("2026-11-01");
    const sundays = monthGrid("2026-10", 7);
    expect(sundays[0]?.[0]?.day).toBe("2026-09-27");
    expect(sundays[0]?.[4]?.day).toBe("2026-10-01");
    expect(weekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdays(7)).toEqual([7, 1, 2, 3, 4, 5, 6]);
    expect([1, 7]).toContain(firstDayOfWeek("en-US"));
    expect(firstDayOfWeek("not a tag at all")).toBe(1);
  });

  it("read as people read them, with the year only when it is another's", () => {
    const now = new Date(2026, 9, 11);
    expect(formatDay("2026-10-20", "en", now)).toBe("Oct 20");
    expect(formatDay("2027-01-05", "en", now)).toBe("Jan 5, 2027");
    expect(formatDay("2026-10-20", "ko", now)).toBe("10월 20일");
    expect(formatDay("nothing", "en", now)).toBe("nothing");
    expect(formatMonth("2026-10", "en")).toBe("October 2026");
    expect(formatMonth("2026-10", "ko")).toBe("2026년 10월");
  });
});
