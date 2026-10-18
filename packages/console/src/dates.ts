import type { WeekStart } from "./vocabulary.js";

// Days, as the plan is made in (ADR-0019): `2026-10-20`, read and written as the strings they
// are, so that a deadline is the same day wherever the people are. The browser's own clock says
// which day is today; nothing here looks at it unless asked.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a string is a day as the API spells one. */
export function isDay(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && DAY.test(value);
}

/** A day from a local date: the date the browser's clock shows, not the UTC one. */
export function dayOf(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, by the browser's clock. */
export function today(now: Date = new Date()): string {
  return dayOf(now);
}

/** A local date at noon of the day, so that a daylight-saving change never moves it a day. */
export function dateOf(day: string): Date {
  const match = DAY.exec(day);
  if (match === null) {
    return new Date(Number.NaN);
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

/** The day `count` days after `day`; negative counts go back. */
export function addDays(day: string, count: number): string {
  const date = dateOf(day);
  date.setDate(date.getDate() + count);
  return dayOf(date);
}

/** How many days `to` is after `from`; negative when it is before. */
export function daysBetween(from: string, to: string): number {
  const millis = dateOf(to).getTime() - dateOf(from).getTime();
  return Math.round(millis / 86_400_000);
}

/** The month a day is in: `2026-10`. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Whether a string is a month as the calendar's address spells one. */
export function isMonth(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The month `count` months after `month`; negative counts go back. */
export function addMonths(month: string, count: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + count;
  const date = new Date(year, index, 1, 12);
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The language and region of the device the pages are read on, as the browser says: `ko-KR`,
 * `en-GB`. The fallback where there is no browser to ask. The week begins as this has it
 * where the workspace leaves the choice to the system default (ADR-0035).
 */
export function deviceLanguage(fallback: string): string {
  const browser = (globalThis as { readonly navigator?: { readonly language?: string } }).navigator;
  return browser?.language ?? fallback;
}

/**
 * The weekday a week begins on: as the workspace says (ADR-0035), Monday or Sunday, else as the
 * language and region have it, the device's by {@link deviceLanguage}. 1 for Monday, 7 for Sunday.
 */
export function firstDayOfWeek(language: string, weekStart?: WeekStart | undefined): number {
  if (weekStart === "monday") {
    return 1;
  }
  if (weekStart === "sunday") {
    return 7;
  }
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & {
      readonly weekInfo?: { readonly firstDay: number };
      readonly getWeekInfo?: () => { readonly firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info !== undefined && info.firstDay >= 1 && info.firstDay <= 7) {
      return info.firstDay;
    }
  } catch {
    // A tag the browser does not know: the week begins on Monday.
  }
  return 1;
}

/** One cell of a month's grid: the day, and whether it is of the month shown or a neighbour's. */
export interface GridDay {
  readonly day: string;
  readonly inMonth: boolean;
}

/**
 * The weeks of a month as a calendar shows them: full weeks, beginning on `firstDay` (1 for
 * Monday, 7 for Sunday), with the neighbouring months' days filling the first and the last.
 */
export function monthGrid(month: string, firstDay = 1): GridDay[][] {
  const first = `${month}-01`;
  const start = dateOf(first);
  // getDay: 0 for Sunday; the grid counts Monday as 1 and Sunday as 7.
  const weekday = start.getDay() === 0 ? 7 : start.getDay();
  const back = (weekday - firstDay + 7) % 7;
  let cursor = addDays(first, -back);
  const weeks: GridDay[][] = [];
  do {
    const week: GridDay[] = [];
    for (let column = 0; column < 7; column += 1) {
      week.push({ day: cursor, inMonth: monthOf(cursor) === month });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (monthOf(cursor) === month);
  return weeks;
}

/** The weekdays in the order a week is shown, from `firstDay`, as the grid counts them. */
export function weekdays(firstDay = 1): number[] {
  return Array.from({ length: 7 }, (_, index) => ((firstDay - 1 + index) % 7) + 1);
}

/** The seven days of the week `day` is in, from the day the week begins on (1 for Monday, 7 for Sunday). */
export function weekOf(day: string, firstDay = 1): string[] {
  const date = dateOf(day);
  if (Number.isNaN(date.getTime())) {
    return [];
  }
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  const first = addDays(day, -((weekday - firstDay + 7) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/** A day as people read one in a language: the month and the day, with the year when it is not this year's. */
export function formatDay(day: string, language?: string, now: Date = new Date()): string {
  const date = dateOf(day);
  if (Number.isNaN(date.getTime())) {
    return day;
  }
  return date.toLocaleDateString(language, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** A stretch of days as people read one: from a day to a day, with the year. */
export function formatDays(from: string, to: string, language?: string): string {
  const start = dateOf(from);
  const end = dateOf(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${from} - ${to}`;
  }
  const format = new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return typeof format.formatRange === "function"
    ? format.formatRange(start, end)
    : `${format.format(start)} - ${format.format(end)}`;
}

/** A month as people read one: the month and the year. */
export function formatMonth(month: string, language?: string): string {
  const date = dateOf(`${month}-01`);
  if (Number.isNaN(date.getTime())) {
    return month;
  }
  return date.toLocaleDateString(language, { month: "long", year: "numeric" });
}

/** A weekday as people read one, short, as the grid counts them: 1 for Monday, 7 for Sunday. */
export function formatWeekday(weekday: number, language?: string): string {
  // The week of 2024-01-01 began on a Monday.
  const date = new Date(2024, 0, weekday, 12);
  return date.toLocaleDateString(language, { weekday: "short" });
}
