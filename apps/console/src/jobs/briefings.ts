// The briefings of an agent account (ADR-0085, point 11): wakes from the schedule, which the
// worker raises at the hours the account keeps, in the workspace's time zone. A `day` briefing
// at the day's start, a `week` briefing in its place on the week's first day, and a `wrap` at
// the day's end where the account has one. What is here is the words and the hours; the pass
// that sends them is the board's wakes'.

import { DEFAULT_DAY_START } from "@skillcdn/console/api";

/** How many tasks a briefing names of a kind, before it says how many more there are. */
const NAMED = 5;

/** The hour and the minute it is in a time zone, as `HH:MM`; in UTC where the zone is none or unknown. */
export function clockIn(zone: string | null | undefined, now: Date): string {
  const said = (timeZone: string): string => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: string) => parts.find((one) => one.type === type)?.value ?? "00";
    return `${part("hour")}:${part("minute")}`;
  };
  if (zone !== null && zone !== undefined) {
    try {
      return said(zone);
    } catch {
      // A zone this runtime does not know: the hour everyone shares.
    }
  }
  return said("UTC");
}

/** A day so many days after another, as the board writes days. */
export function dayAfter(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Whether a day is the first of its week: Sunday where the workspace says so, Monday otherwise. */
export function beginsWeek(day: string, weekStart: string): boolean {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday === (weekStart === "sunday" ? 0 : 1);
}

/** The day's name, for a briefing to say which day it is of. */
const weekdayOf = (day: string): string =>
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    new Date(`${day}T00:00:00.000Z`).getUTCDay()
  ] ?? "";

/** A task as a briefing names one. */
export interface BriefedTask {
  readonly project: string;
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly dueOn: string | undefined;
}

/** What a briefing is made from: the account's open tasks, and how many decisions wait for it. */
export interface BriefingInput {
  readonly today: string;
  /** The open tasks the account is at work on. */
  readonly tasks: readonly BriefedTask[];
  /** The decisions addressed to it that nobody has answered. */
  readonly decisions: number;
}

const inline = (text: string): string => {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/** A few tasks by name and the count of the rest: a briefing is bounded, and says where the rest is. */
function named(tasks: readonly BriefedTask[]): string {
  if (tasks.length === 0) {
    return "none";
  }
  const first = tasks
    .slice(0, NAMED)
    .map((task) => `#${task.number} "${inline(task.title)}" in ${task.project}`);
  const more = tasks.length - first.length;
  return `${tasks.length} (${first.join("; ")}${more > 0 ? `; and ${more} more` : ""})`;
}

/**
 * The words of a `day` briefing, and of a `week` briefing, which adds the week: the tasks
 * planned for today, those carried over, those ready with no day, the decisions that wait, and
 * the command that reads the whole plate. A task's title on one line; nothing else of the board.
 */
export function briefingOf(kind: "day" | "week", input: BriefingInput): string {
  const { today, tasks } = input;
  const planned = tasks.filter((task) => task.dueOn === today);
  const carried = tasks.filter((task) => task.dueOn !== undefined && task.dueOn < today);
  const unplanned = tasks.filter((task) => task.dueOn === undefined && task.state !== "idea");
  const weekEnd = dayAfter(today, 6);
  const later = tasks.filter(
    (task) => task.dueOn !== undefined && task.dueOn > today && task.dueOn <= weekEnd,
  );
  return [
    `Your ${kind === "week" ? "week's" : "day's"} briefing, ${weekdayOf(today)} ${today}.`,
    `Planned for today: ${named(planned)}.`,
    `Carried over from before today: ${named(carried)}.`,
    `Open with no day: ${named(unplanned)}.`,
    ...(kind === "week" ? [`Planned for the six days after today: ${named(later)}.`] : []),
    `Decisions waiting for you: ${input.decisions}.`,
    "Your whole plate, with the decisions: console work",
  ].join("\n");
}

/** The words of a `wrap`: the day's end. */
export const WRAP_BRIEFING =
  "Your day ends. Report on the runs you have open, write down what should be kept where it is kept, and commit and push your desk.";

/** What a wake says of a secret whose day comes within a month. */
export function secretWake(name: string, expiresOn: string): string {
  return `Your secret ${name} ends on ${expiresOn}. Renew what it holds where it was made, and set it again with its new day: console secret ${name} --set --expires <day>`;
}

/** Which briefings are due for an account at this hour of this day, given what it was sent already. */
export function briefingsDue(input: {
  readonly today: string;
  /** The hour and the minute it is, `HH:MM`. */
  readonly clock: string;
  readonly weekStart: string;
  readonly dayStart: string | undefined;
  readonly dayEnd: string | undefined;
  readonly briefedOn: string | undefined;
  readonly wrappedOn: string | undefined;
}): readonly ("day" | "week" | "wrap")[] {
  const due: ("day" | "week" | "wrap")[] = [];
  if (input.clock >= (input.dayStart ?? DEFAULT_DAY_START) && input.briefedOn !== input.today) {
    due.push(beginsWeek(input.today, input.weekStart) ? "week" : "day");
  }
  if (
    input.dayEnd !== undefined &&
    input.clock >= input.dayEnd &&
    input.wrappedOn !== input.today
  ) {
    due.push("wrap");
  }
  return due;
}
