// What an agent account's product last said of what its subscription allows (ADR-0156), as the
// pages and the command read it: which windows still stand, and how a share is said.

/** From this share on, a window is shown as near its limit: the first mark an agent is told at (ADR-0150). */
export const USAGE_NEAR = 0.8;

/** A window as it is answered: its name, how much of it is used, when it resets, and when the product said so. */
export interface UsageReading {
  readonly name: string;
  readonly used: number | null;
  readonly resetsAt: string | null;
  readonly near?: boolean | undefined;
  readonly at: string;
}

/**
 * How long a window that names no reset stands after the product last said it: a day more
 * than the longest window a product is known to keep, a week. A window that resets is let go
 * at its reset; one that names none would stand for good once its product says it no more, as
 * when a plan comes to count something else.
 */
export const USAGE_KEPT_MS = 8 * 24 * 60 * 60 * 1000;

/** How many minutes a window lasts, by the word its driver names it with: none where the word says none. */
const MINUTES: Readonly<Record<string, number>> = { minute: 1, hour: 60, day: 24 * 60 };
const LASTS = /^([0-9]{1,6})-(minute|hour|day)$/;
function minutesOf(word: string): number | undefined {
  if (word === "weekly") {
    return 7 * 24 * 60;
  }
  const [, count, unit] = LASTS.exec(word) ?? [];
  return count === undefined || unit === undefined
    ? undefined
    : Number(count) * (MINUTES[unit] ?? 1);
}

/**
 * Where a window stands among the others, by its name: the plan's own first, the shortest of
 * them before the longer; then the windows of a part of the allowance (`weekly fable`), the
 * shortest first as well; then any other.
 */
function placeOf(name: string): { readonly group: number; readonly minutes: number } {
  const space = name.indexOf(" ");
  const minutes = minutesOf(space < 0 ? name : name.slice(0, space));
  return minutes === undefined ? { group: 2, minutes: 0 } : { group: space < 0 ? 0 : 1, minutes };
}

/** Two windows in the order they are shown in, which their names alone decide. */
function inOrder(a: { readonly name: string }, b: { readonly name: string }): number {
  const [first, second] = [placeOf(a.name), placeOf(b.name)];
  return (
    first.group - second.group ||
    first.minutes - second.minutes ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

/**
 * The windows that still stand at a moment, in the order they are shown in. One whose reset has
 * passed says nothing of the window after it, and an account whose runner is away keeps what it
 * last said: such a window is left out, so that no page shows a share of a window that is over.
 * One that names no reset is left out once it was said longer ago than any window lasts
 * (`USAGE_KEPT_MS`). Which windows there are is the product's to say, and nothing here expects
 * one: a plan with no short window shows the week alone. Their order is by their names, the
 * short window, the week, then the week of a model: a product says a window at a time, and one
 * that reset is said again after those that did not.
 */
export function usageStanding<
  T extends {
    readonly name: string;
    readonly resetsAt: string | null;
    readonly at?: string | undefined;
  },
>(usage: readonly T[] | null | undefined, now: number): readonly T[] {
  return (usage ?? [])
    .filter((window) =>
      window.resetsAt === null
        ? !(window.at !== undefined && now - Date.parse(window.at) > USAGE_KEPT_MS)
        : !(Date.parse(window.resetsAt) <= now),
    )
    .sort(inOrder);
}

/** How far apart two windows may have been said and still be said together: one answer of the product. */
export const USAGE_SAID_TOGETHER_MS = 60_000;

/**
 * When the windows were said, where they were said together: the latest of their moments, all
 * within a minute. Nothing where they were not, or where a moment does not read: the console
 * keeps a window until its reset, so one may be days older than another, and each then says its
 * own moment, since one moment for all would make the old one read as new.
 */
export function usageSaidTogether(usage: readonly { readonly at: string }[]): string | undefined {
  const moments = usage.map((window) => Date.parse(window.at));
  if (moments.length === 0 || moments.some((moment) => !Number.isFinite(moment))) {
    return undefined;
  }
  const latest = Math.max(...moments);
  return latest - Math.min(...moments) <= USAGE_SAID_TOGETHER_MS
    ? usage[moments.indexOf(latest)]?.at
    : undefined;
}

/** A share as a whole number of hundredths, never more than was said: 0.899 is 89. */
export const usedHundredths = (share: number): number =>
  Math.min(100, Math.max(0, Math.floor(share * 100 + 1e-9)));

/** Whether a window is near its limit: by its share, or because the product itself says so. */
export const usageNear = (window: {
  readonly used: number | null;
  readonly near?: boolean | undefined;
}): boolean => window.near === true || (window.used !== null && window.used >= USAGE_NEAR);
