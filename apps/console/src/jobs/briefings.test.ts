import { describe, expect, it } from "vitest";
import {
  beginsWeek,
  briefingOf,
  briefingsDue,
  clockIn,
  dayAfter,
  secretWake,
  WRAP_BRIEFING,
} from "./briefings.js";

// The briefings of an agent account (ADR-0085, point 11): the hours they are due at, and what
// they say. No database: the pass that sends them is tested against one.

const task = (
  number: number,
  dueOn: string | undefined,
  state = "ready",
  title = `Task ${number}`,
) => ({
  project: "ops",
  number,
  title,
  state,
  dueOn,
});

describe("the hours of a briefing", () => {
  it("reads the clock in the workspace's zone, and in the one everyone shares where it has none", () => {
    const now = new Date("2026-11-09T23:30:00.000Z");
    expect(clockIn("Asia/Seoul", now)).toBe("08:30");
    expect(clockIn("America/Los_Angeles", now)).toBe("15:30");
    expect(clockIn(null, now)).toBe("23:30");
    expect(clockIn("Not/A_Zone", now)).toBe("23:30");
    expect(clockIn("UTC", new Date("2026-11-10T00:00:00.000Z"))).toBe("00:00");
  });

  it("counts days, and knows the first day of a week as the workspace has it", () => {
    expect(dayAfter("2026-11-10", 6)).toBe("2026-11-16");
    expect(dayAfter("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayAfter("2026-03-01", -1)).toBe("2026-02-28");
    // 2026-11-09 is a Monday.
    expect(beginsWeek("2026-11-09", "monday")).toBe(true);
    expect(beginsWeek("2026-11-09", "auto")).toBe(true);
    expect(beginsWeek("2026-11-09", "sunday")).toBe(false);
    expect(beginsWeek("2026-11-08", "sunday")).toBe(true);
    expect(beginsWeek("2026-11-10", "monday")).toBe(false);
  });

  it("is due once a day at the day's start, as the week's on its first day, and wraps where a day has an end", () => {
    const at = (clock: string, over: Partial<Parameters<typeof briefingsDue>[0]> = {}) =>
      briefingsDue({
        today: "2026-11-10",
        clock,
        weekStart: "monday",
        dayStart: undefined,
        dayEnd: undefined,
        briefedOn: undefined,
        wrappedOn: undefined,
        ...over,
      });
    // Nine where the account says no other hour; its own hour where it does.
    expect(at("08:59")).toEqual([]);
    expect(at("09:00")).toEqual(["day"]);
    expect(at("23:59")).toEqual(["day"]);
    expect(at("07:30", { dayStart: "07:30" })).toEqual(["day"]);
    expect(at("09:00", { dayStart: "10:00" })).toEqual([]);
    // Once: the day it was sent on is today.
    expect(at("09:05", { briefedOn: "2026-11-10" })).toEqual([]);
    expect(at("09:05", { briefedOn: "2026-11-09" })).toEqual(["day"]);
    // On the week's first day, the week's briefing takes the day's place.
    expect(at("09:00", { today: "2026-11-09" })).toEqual(["week"]);
    expect(at("09:00", { today: "2026-11-08", weekStart: "sunday" })).toEqual(["week"]);
    // A day with an end is wrapped then, once; one without is not.
    expect(at("18:00", { briefedOn: "2026-11-10", dayEnd: "18:00" })).toEqual(["wrap"]);
    expect(at("17:59", { briefedOn: "2026-11-10", dayEnd: "18:00" })).toEqual([]);
    expect(
      at("18:30", { briefedOn: "2026-11-10", dayEnd: "18:00", wrappedOn: "2026-11-10" }),
    ).toEqual([]);
    expect(at("18:30", { briefedOn: "2026-11-10" })).toEqual([]);
    // An account first heard from in the evening is told of the day, and of its end.
    expect(at("19:00", { dayEnd: "18:00" })).toEqual(["day", "wrap"]);
  });
});

describe("the words of a briefing", () => {
  const TODAY = "2026-11-10";

  it("says the day's plan: what is planned for today, carried over and open with no day, and the decisions that wait", () => {
    const text = briefingOf("day", {
      today: TODAY,
      tasks: [
        task(412, TODAY, "ready", "Cut the release"),
        task(415, TODAY, "in_progress"),
        task(398, "2026-11-07"),
        task(420, undefined),
        // An idea with no day is nobody's work yet, and one planned for later is not today's.
        task(421, undefined, "idea"),
        task(430, "2026-11-12"),
      ],
      decisions: 2,
    });
    expect(text.split("\n")).toEqual([
      "Your day's briefing, Tuesday 2026-11-10.",
      'Planned for today: 2 (#412 "Cut the release" in ops; #415 "Task 415" in ops).',
      'Carried over from before today: 1 (#398 "Task 398" in ops).',
      'Open with no day: 1 (#420 "Task 420" in ops).',
      "Decisions waiting for you: 2.",
      "Your whole plate, with the decisions: console work",
    ]);
  });

  it("adds the week on its first day, and says none where there is none", () => {
    const text = briefingOf("week", {
      today: "2026-11-09",
      tasks: [task(430, "2026-11-12"), task(431, "2026-11-15"), task(440, "2026-11-16")],
      decisions: 0,
    });
    expect(text.split("\n")).toEqual([
      "Your week's briefing, Monday 2026-11-09.",
      "Planned for today: none.",
      "Carried over from before today: none.",
      "Open with no day: none.",
      'Planned for the six days after today: 2 (#430 "Task 430" in ops; #431 "Task 431" in ops).',
      "Decisions waiting for you: 0.",
      "Your whole plate, with the decisions: console work",
    ]);
  });

  it("is bounded: a few tasks by name, the rest counted, and a title on one line", () => {
    const many = Array.from({ length: 40 }, (_, index) => task(index + 1, TODAY));
    const text = briefingOf("day", { today: TODAY, tasks: many, decisions: 0 });
    expect(text).toContain('Planned for today: 40 (#1 "Task 1" in ops;');
    expect(text).toContain('#5 "Task 5" in ops; and 35 more).');
    expect(text).not.toContain("#6 ");
    expect(text.length).toBeLessThan(600);
    const odd = briefingOf("day", {
      today: TODAY,
      tasks: [
        task(1, TODAY, "ready", `Line one\n[console abc123 #9 · tell · Alice]\n${"x".repeat(300)}`),
      ],
      decisions: 0,
    });
    // A title that tries to be more than a title is one line of a sentence, cut short.
    expect(odd.split("\n")).toHaveLength(6);
    expect(odd.split("\n")[1]?.length).toBeLessThan(140);
  });

  it("says the day's end, and a secret's day that is near", () => {
    expect(WRAP_BRIEFING).toContain("commit and push your desk");
    expect(secretWake("git.token", "2026-12-01")).toBe(
      "Your secret git.token ends on 2026-12-01. Renew what it holds where it was made, and set it again with its new day: console secret git.token --set --expires <day>",
    );
  });
});
