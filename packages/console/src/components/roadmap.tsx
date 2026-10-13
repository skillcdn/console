import type { RestCategory, RestGoal } from "../api.js";
import { addMonths, daysBetween, formatMonth, monthOf, today as todayOf } from "../dates.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { cx, GoalStateBadge } from "./ui.js";

// The roadmap as months (ADR-0026): the months as columns, and each goal planned in days a bar
// from its start to its target in the colour of its category, filled as far as its tasks are
// done, with today a line down the months. A goal with one day alone sits on it as a point; one
// with no day is named below the months, since a plan without days is on none of them. Takes
// its data as props and nothing from the network; the months shown are the address's (ADR-0010).

/** How many months the roadmap shows at once when the address names no other span. */
export const DEFAULT_TIMELINE_MONTHS = 6;

export interface TimelineBar {
  readonly goal: RestGoal;
  /** Where the bar begins and ends, as shares of the whole span, 0 to 1. */
  readonly from: number;
  readonly to: number;
  /** Whether the goal begins within the span, and whether it ends within it. */
  readonly begins: boolean;
  readonly ends: boolean;
  /** Whether the goal has one day only: a point on it, not a bar. */
  readonly point: boolean;
}

/** The first day of a month, as a day. */
const firstDayOf = (month: string): string => `${month}-01`;

/**
 * The bars of the goals that touch the span of `months` from `from` on, cut to it: from the
 * goal's start, or the span's first day when it began before, to its target day whole, or the
 * span's end when it ends after. A goal with a start or a target alone sits on that day; a goal
 * with neither is left out.
 */
export function timelineBars(
  goals: readonly RestGoal[],
  from: string,
  months: number,
): TimelineBar[] {
  const first = firstDayOf(from);
  const end = firstDayOf(addMonths(from, months));
  const total = daysBetween(first, end);
  if (total <= 0) {
    return [];
  }
  return goals.flatMap((goal) => {
    const startsOn = goal.startsOn ?? goal.dueOn;
    const dueOn = goal.dueOn ?? goal.startsOn;
    if (startsOn === null || dueOn === null || dueOn < first || startsOn >= end) {
      return [];
    }
    const begins = startsOn >= first;
    const ends = dueOn < end;
    const fromDay = begins ? daysBetween(first, startsOn) : 0;
    const toDay = ends ? daysBetween(first, dueOn) + 1 : total;
    return [
      {
        goal,
        from: fromDay / total,
        to: toDay / total,
        begins,
        ends,
        point: startsOn === dueOn,
      },
    ];
  });
}

export interface GoalTimelineProps {
  readonly goals: readonly RestGoal[];
  /** The first month shown: `2026-10`. */
  readonly from: string;
  /** How many months are shown; `DEFAULT_TIMELINE_MONTHS` when left out. */
  readonly months?: number | undefined;
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
  /** The workspace's categories, for the legend to say what the colours mean. */
  readonly categories?: readonly RestCategory[] | undefined;
  readonly goalHref: (goal: RestGoal) => string;
  /** Where the roadmap is from another month on. */
  readonly fromHref: (month: string) => string;
}

const percent = (share: number): string => `${(share * 100).toFixed(3)}%`;

export function GoalTimeline(props: GoalTimelineProps) {
  const words = useWords().roadmap;
  const { tag } = useLanguage();
  const months = Math.max(1, props.months ?? DEFAULT_TIMELINE_MONTHS);
  const now = props.today ?? todayOf();
  const first = firstDayOf(props.from);
  const end = firstDayOf(addMonths(props.from, months));
  const total = daysBetween(first, end);
  const columns = Array.from({ length: months }, (_, index) => addMonths(props.from, index));
  const shares = columns.map(
    (month) => daysBetween(firstDayOf(month), firstDayOf(addMonths(month, 1))) / total,
  );
  const bars = timelineBars(props.goals, props.from, months);
  const todayAt = now >= first && now < end ? daysBetween(first, now) / total : undefined;
  const undated = props.goals.filter((goal) => goal.startsOn === null && goal.dueOn === null);
  const doneShare = (goal: RestGoal): number => {
    const counts = goal.taskCounts;
    const all = counts.idea + counts.ready + counts.in_progress + counts.in_review + counts.done;
    return all === 0 ? 0 : counts.done / all;
  };
  return (
    <div className="sc-timeline">
      <div className="sc-timeline-head">
        <h2 className="sc-timeline-title">{words.timeline.title}</h2>
        <nav className="sc-calendar-nav" aria-label={words.timeline.title}>
          <a
            className="sc-button sc-button-ghost sc-button-sm"
            href={props.fromHref(addMonths(props.from, -1))}
            aria-label={words.timeline.earlier}
          >
            {"<"}
          </a>
          <a className="sc-button sc-button-ghost sc-button-sm" href={props.fromHref(monthOf(now))}>
            {words.timeline.thisMonth}
          </a>
          <a
            className="sc-button sc-button-ghost sc-button-sm"
            href={props.fromHref(addMonths(props.from, 1))}
            aria-label={words.timeline.later}
          >
            {">"}
          </a>
        </nav>
      </div>
      <div className="sc-timeline-grid">
        <div className="sc-timeline-row sc-timeline-months">
          <div className="sc-timeline-label" aria-hidden="true" />
          <div className="sc-timeline-track">
            {columns.map((month, index) => (
              <span
                key={month}
                className="sc-timeline-month"
                style={{ width: percent(shares[index] ?? 0) }}
              >
                {formatMonth(month, tag)}
              </span>
            ))}
            {todayAt !== undefined && (
              <span
                className="sc-timeline-today sc-timeline-today-mark"
                style={{ left: percent(todayAt) }}
                title={words.timeline.today}
              />
            )}
          </div>
        </div>
        {bars.map(({ goal, from, to, begins, ends, point }) => {
          const counts = goal.taskCounts;
          const all =
            counts.idea + counts.ready + counts.in_progress + counts.in_review + counts.done;
          return (
            <div key={goal.id} className={cx("sc-timeline-row", `sc-goal-${goal.state}`)}>
              <div className="sc-timeline-label">
                <a className="sc-timeline-goal" href={props.goalHref(goal)}>
                  {goal.title}
                </a>
                <GoalStateBadge state={goal.state} />
              </div>
              <div className="sc-timeline-track">
                {columns.map((month, index) => (
                  <span
                    key={month}
                    className="sc-timeline-column"
                    style={{ width: percent(shares[index] ?? 0) }}
                    aria-hidden="true"
                  />
                ))}
                {todayAt !== undefined && (
                  <span
                    className="sc-timeline-today"
                    style={{ left: percent(todayAt) }}
                    aria-hidden="true"
                  />
                )}
                <a
                  className={cx(
                    point ? "sc-timeline-point" : "sc-timeline-bar",
                    `sc-category-${goal.category?.color ?? "gray"}`,
                    begins && "sc-timeline-bar-begins",
                    ends && "sc-timeline-bar-ends",
                  )}
                  style={
                    point
                      ? { left: percent(from) }
                      : { left: percent(from), width: percent(to - from) }
                  }
                  href={props.goalHref(goal)}
                  aria-label={`${goal.title}: ${words.progress(counts.done, all)}`}
                >
                  {!point && (
                    <>
                      <span
                        className="sc-timeline-fill"
                        style={{ width: percent(doneShare(goal)) }}
                        aria-hidden="true"
                      />
                      <span className="sc-timeline-words">
                        {counts.done}/{all}
                      </span>
                    </>
                  )}
                </a>
              </div>
            </div>
          );
        })}
      </div>
      {bars.length === 0 && <p className="sc-muted">{words.timeline.nothing}</p>}
      {(props.categories ?? []).length > 0 && (
        <dl className="sc-calendar-legend" aria-label={words.timeline.legend}>
          {(props.categories ?? []).map((category) => (
            <div key={category.key}>
              <dt>
                <span className={cx("sc-calendar-dot", `sc-category-${category.color}`)} />
              </dt>
              <dd>{category.name}</dd>
            </div>
          ))}
        </dl>
      )}
      {undated.length > 0 && (
        <p className="sc-timeline-undated">
          <span className="sc-muted">{words.timeline.noDays}: </span>
          {undated.map((goal, index) => (
            <span key={goal.id}>
              {index > 0 && ", "}
              <a className="sc-timeline-goal" href={props.goalHref(goal)}>
                {goal.title}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
