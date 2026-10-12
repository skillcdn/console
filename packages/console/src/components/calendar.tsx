import type { ReactNode, SyntheticEvent } from "react";
import { OPEN_TASK_STATES, type RestCategory, type RestPerson, type RestTask } from "../api.js";
import {
  addDays,
  addMonths,
  daysBetween,
  firstDayOfWeek,
  formatDays,
  formatMonth,
  formatWeekday,
  type GridDay,
  monthGrid,
  monthOf,
  today as todayOf,
  weekdays,
  weekOf,
} from "../dates.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { cx, PersonChip, personName } from "./ui.js";

// The calendar of a project (ADR-0019): the month as a grid, or one week on its own. A task
// planned from a start to a due day lies across its days as a bar, in a lane of its own within
// each week so that the bars of one week never cross; a task with a due day alone sits on it as
// a dot, and one with a start alone is marked on that day. Who has what says whether the work
// is on its days. Takes its data as props and nothing from the network; the month or the week
// shown is the address's (ADR-0010).

const isOpen = (task: RestTask): boolean => OPEN_TASK_STATES.includes(task.state);

/** Whether a task lies across days: a start and a due day, and the due day after the start. */
const spans = (task: RestTask): boolean =>
  task.startsOn !== null && task.dueOn !== null && task.startsOn < task.dueOn;

export interface CalendarProps {
  readonly tasks: readonly RestTask[];
  /** The month shown: `2026-10`. */
  readonly month: string;
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
  /** The workspace's categories, for the legend to say what the colours mean. */
  readonly categories?: readonly RestCategory[] | undefined;
  readonly taskHref: (task: RestTask) => string;
  /** Where the calendar is on another month. */
  readonly monthHref: (month: string) => string;
}

/** One task's stretch across one week: which columns it covers, and in which lane it lies. */
export interface WeekSegment {
  readonly task: RestTask;
  /** The first and the last column (0 to 6) the task covers in this week. */
  readonly from: number;
  readonly to: number;
  readonly lane: number;
  /** Whether the task begins in this week, and whether it ends in it. */
  readonly begins: boolean;
  readonly ends: boolean;
}

/**
 * The bars of one week: every task lying across days that touches the week, cut to it, each
 * in the first lane where it crosses nothing that was laid before it. The longest and earliest
 * go first, so that the lanes stay few.
 */
export function weekSegments(week: readonly GridDay[], tasks: readonly RestTask[]): WeekSegment[] {
  const first = week[0]?.day;
  const last = week[week.length - 1]?.day;
  if (first === undefined || last === undefined) {
    return [];
  }
  const cut = tasks
    .filter(spans)
    .flatMap((task) => {
      const startsOn = task.startsOn ?? first;
      const dueOn = task.dueOn ?? last;
      if (dueOn < first || startsOn > last) {
        return [];
      }
      const from = startsOn < first ? 0 : daysBetween(first, startsOn);
      const to = dueOn > last ? week.length - 1 : daysBetween(first, dueOn);
      return [{ task, from, to, begins: startsOn >= first, ends: dueOn <= last }];
    })
    .sort(
      (a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || a.task.number - b.task.number,
    );
  const ends: number[] = [];
  return cut.map((segment) => {
    let lane = ends.findIndex((end) => end < segment.from);
    if (lane === -1) {
      lane = ends.length;
      ends.push(segment.to);
    } else {
      ends[lane] = segment.to;
    }
    return { ...segment, lane };
  });
}

function push(map: Map<string, RestTask[]>, day: string, task: RestTask): void {
  const list = map.get(day);
  if (list === undefined) {
    map.set(day, [task]);
  } else {
    list.push(task);
  }
}

/** The tasks that sit on one day each: due on it, or beginning on it with no due day yet. */
function onDays(tasks: readonly RestTask[]): {
  readonly due: ReadonlyMap<string, readonly RestTask[]>;
  readonly starting: ReadonlyMap<string, readonly RestTask[]>;
} {
  const due = new Map<string, RestTask[]>();
  const starting = new Map<string, RestTask[]>();
  for (const task of tasks) {
    if (spans(task)) {
      continue;
    }
    if (task.dueOn !== null) {
      push(due, task.dueOn, task);
    } else if (task.startsOn !== null) {
      push(starting, task.startsOn, task);
    }
  }
  // Within a day, what is still open comes first; the rest reads as what was.
  for (const list of due.values()) {
    list.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.number - b.number);
  }
  return { due, starting };
}

/** How a task reads on a day: struck through once it is over, and marked once it is late. */
const tone = (task: RestTask, day: string, now: string): string =>
  cx(!isOpen(task) && "sc-calendar-over", isOpen(task) && day < now && "sc-calendar-late");

interface WeekRowProps {
  readonly week: readonly GridDay[];
  readonly segments: readonly WeekSegment[];
  readonly due: ReadonlyMap<string, readonly RestTask[]>;
  readonly starting: ReadonlyMap<string, readonly RestTask[]>;
  readonly now: string;
  readonly taskHref: (task: RestTask) => string;
  /** What stands before a task's title where the tasks are of several projects: the project's mark. */
  readonly markOf?: ((task: RestTask) => ReactNode) | undefined;
}

/**
 * Marks an item whose title its line cut short, or which shows none (a bar on its later days),
 * so that the tip it carries in `data-tip` is shown at once while the pointer is on it. Measured
 * as the pointer arrives, since only the browser knows where the line ended.
 */
function reveal(event: SyntheticEvent<HTMLElement>): void {
  const item = event.currentTarget;
  const title = item.querySelector(".sc-calendar-task-title");
  item.toggleAttribute("data-clipped", title === null || title.scrollWidth > title.clientWidth);
}

/** One week as a row of cells: the bars across the days in their lanes, then the tasks on each day. */
function WeekRow(props: WeekRowProps) {
  const words = useWords().calendar;
  const { week, segments, now } = props;
  const lanes = segments.reduce((most, segment) => Math.max(most, segment.lane + 1), 0);
  return (
    <tr>
      {week.map((cell, column) => (
        <td
          key={cell.day}
          className={cx(
            "sc-calendar-cell",
            !cell.inMonth && "sc-calendar-cell-outside",
            cell.day === now && "sc-calendar-cell-today",
          )}
        >
          <span className="sc-calendar-day">{Number(cell.day.slice(8))}</span>
          {Array.from({ length: lanes }, (_, lane) => {
            const segment = segments.find(
              (candidate) =>
                candidate.lane === lane && candidate.from <= column && column <= candidate.to,
            );
            if (segment === undefined) {
              // The lane is someone else's on this day: the bars below keep their height.
              // biome-ignore lint/suspicious/noArrayIndexKey: an empty lane is nothing but its position, and the lanes of a week never reorder
              return <span key={lane} className="sc-calendar-lane" aria-hidden="true" />;
            }
            const { task } = segment;
            return (
              <a
                key={task.id}
                className={cx(
                  "sc-calendar-bar",
                  `sc-category-${task.category?.color ?? "gray"}`,
                  segment.from === column && segment.begins && "sc-calendar-bar-begins",
                  segment.to === column && segment.ends && "sc-calendar-bar-ends",
                  tone(task, task.dueOn ?? cell.day, now),
                  "sc-tip",
                )}
                href={props.taskHref(task)}
                data-tip={`#${task.number} ${task.title}`}
                onMouseEnter={reveal}
                onFocus={reveal}
              >
                {segment.from === column && (
                  <>
                    {props.markOf?.(task)}
                    <span className="sc-calendar-task-title">{task.title}</span>
                  </>
                )}
              </a>
            );
          })}
          {(props.due.get(cell.day) ?? []).map((task) => {
            const mark = props.markOf?.(task);
            return (
              <a
                key={task.id}
                className={cx("sc-calendar-task", tone(task, cell.day, now), "sc-tip")}
                href={props.taskHref(task)}
                data-tip={`#${task.number} ${task.title}`}
                onMouseEnter={reveal}
                onFocus={reveal}
              >
                {mark === undefined || mark === null ? (
                  <span
                    className={cx(
                      "sc-calendar-dot",
                      `sc-category-${task.category?.color ?? "gray"}`,
                    )}
                  />
                ) : (
                  mark
                )}
                <span className="sc-calendar-task-title">{task.title}</span>
              </a>
            );
          })}
          {(props.starting.get(cell.day) ?? []).map((task) => (
            <a
              key={task.id}
              className="sc-calendar-task sc-calendar-task-start sc-tip"
              href={props.taskHref(task)}
              data-tip={`#${task.number} ${task.title}: ${words.startsOnly}`}
              onMouseEnter={reveal}
              onFocus={reveal}
            >
              {props.markOf?.(task)}
              <span className="sc-calendar-task-title">{task.title}</span>
            </a>
          ))}
        </td>
      ))}
    </tr>
  );
}

export function Calendar(props: CalendarProps) {
  const words = useWords().calendar;
  const { tag } = useLanguage();
  const now = props.today ?? todayOf();
  const firstDay = firstDayOfWeek(tag);
  const weeks = monthGrid(props.month, firstDay);
  const { due, starting } = onDays(props.tasks);
  const inMonth = (day: string) => monthOf(day) === props.month;
  const monthWeeks = weeks.map((week) => ({ week, segments: weekSegments(week, props.tasks) }));
  const nothing =
    [...due.keys()].every((day) => !inMonth(day)) &&
    [...starting.keys()].every((day) => !inMonth(day)) &&
    monthWeeks.every(({ week, segments }) =>
      segments.every(
        (segment) => !week.slice(segment.from, segment.to + 1).some((cell) => cell.inMonth),
      ),
    );
  return (
    <div className="sc-calendar">
      <div className="sc-calendar-head">
        <h2 className="sc-calendar-month">{formatMonth(props.month, tag)}</h2>
        <nav className="sc-calendar-nav" aria-label={words.grid}>
          <a
            className="sc-button sc-button-ghost sc-button-sm"
            href={props.monthHref(addMonths(props.month, -1))}
            aria-label={words.previous}
          >
            {"<"}
          </a>
          <a
            className="sc-button sc-button-ghost sc-button-sm"
            href={props.monthHref(monthOf(now))}
          >
            {words.thisMonth}
          </a>
          <a
            className="sc-button sc-button-ghost sc-button-sm"
            href={props.monthHref(addMonths(props.month, 1))}
            aria-label={words.next}
          >
            {">"}
          </a>
        </nav>
      </div>
      <table className="sc-calendar-grid" aria-label={words.grid}>
        <thead>
          <tr>
            {weekdays(firstDay).map((weekday) => (
              <th key={weekday} scope="col">
                {formatWeekday(weekday, tag)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks.map(({ week, segments }) => (
            <WeekRow
              key={week[0]?.day}
              week={week}
              segments={segments}
              due={due}
              starting={starting}
              now={now}
              taskHref={props.taskHref}
            />
          ))}
        </tbody>
      </table>
      {(props.categories ?? []).length > 0 && (
        <dl className="sc-calendar-legend" aria-label={words.legend.title}>
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
      {nothing && <p className="sc-muted">{words.nothingDue}</p>}
    </div>
  );
}

export interface WeekProps {
  readonly tasks: readonly RestTask[];
  /** A day of the week shown; today's week when left out. */
  readonly day?: string | undefined;
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
  readonly taskHref: (task: RestTask) => string;
  /** Where the week of a day is shown. */
  readonly weekHref: (day: string) => string;
  /** What stands before a task's title where the tasks are of several projects: the project's mark. */
  readonly markOf?: ((task: RestTask) => ReactNode) | undefined;
}

/** One week on its own: the days as columns, the tasks on them, and the weeks around a step away. */
export function Week(props: WeekProps) {
  const words = useWords().calendar.week;
  const { tag } = useLanguage();
  const now = props.today ?? todayOf();
  const firstDay = firstDayOfWeek(tag);
  const days = weekOf(props.day ?? now, firstDay);
  const first = days[0] ?? now;
  const last = days[days.length - 1] ?? now;
  const week: GridDay[] = days.map((day) => ({ day, inMonth: true }));
  const { due, starting } = onDays(props.tasks);
  const segments = weekSegments(week, props.tasks);
  const nothing = segments.length === 0 && days.every((day) => !due.has(day) && !starting.has(day));
  return (
    <div className="sc-calendar sc-week">
      <div className="sc-calendar-head">
        <h2 className="sc-calendar-month">{formatDays(first, last, tag)}</h2>
        <nav className="sc-calendar-nav" aria-label={words.title}>
          <a
            className="sc-button sc-button-ghost sc-button-sm"
            href={props.weekHref(addDays(first, -7))}
            aria-label={words.previous}
          >
            {"<"}
          </a>
          <a className="sc-button sc-button-ghost sc-button-sm" href={props.weekHref(now)}>
            {words.thisWeek}
          </a>
          <a
            className="sc-button sc-button-ghost sc-button-sm"
            href={props.weekHref(addDays(first, 7))}
            aria-label={words.next}
          >
            {">"}
          </a>
        </nav>
      </div>
      <table className="sc-calendar-grid" aria-label={words.title}>
        <thead>
          <tr>
            {weekdays(firstDay).map((weekday) => (
              <th key={weekday} scope="col">
                {formatWeekday(weekday, tag)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <WeekRow
            week={week}
            segments={segments}
            due={due}
            starting={starting}
            now={now}
            taskHref={props.taskHref}
            markOf={props.markOf}
          />
        </tbody>
      </table>
      {nothing && <p className="sc-muted">{words.nothing}</p>}
    </div>
  );
}

/** One person's share of the open work, as the table of who has what says it. */
export interface WorkloadRow {
  /** The person, or nobody for the tasks assigned to no one. */
  readonly person: RestPerson | undefined;
  readonly open: number;
  readonly inProgress: number;
  /** Open, and due within the next seven days from today. */
  readonly dueSoon: number;
  /** Open, and past its day. */
  readonly overdue: number;
}

/** Who has what, from the open tasks: by login, with the unassigned last. */
export function workloadOf(tasks: readonly RestTask[], today: string): WorkloadRow[] {
  const rows = new Map<string, { person: RestPerson | undefined; tasks: RestTask[] }>();
  for (const task of tasks.filter(isOpen)) {
    const key = task.assignee?.id ?? "";
    const row = rows.get(key);
    if (row === undefined) {
      rows.set(key, { person: task.assignee ?? undefined, tasks: [task] });
    } else {
      row.tasks.push(task);
    }
  }
  const count = (list: readonly RestTask[]): Omit<WorkloadRow, "person"> => ({
    open: list.length,
    inProgress: list.filter((task) => task.state === "in_progress" || task.state === "in_review")
      .length,
    dueSoon: list.filter((task) => {
      if (task.dueOn === null) {
        return false;
      }
      const days = daysBetween(today, task.dueOn);
      return days >= 0 && days <= 7;
    }).length,
    overdue: list.filter((task) => task.dueOn !== null && task.dueOn < today).length,
  });
  return [...rows.values()]
    .map((row) => ({ person: row.person, ...count(row.tasks) }))
    .sort((a, b) => {
      if (a.person === undefined) {
        return 1;
      }
      if (b.person === undefined) {
        return -1;
      }
      return personName(a.person).localeCompare(personName(b.person));
    });
}

export interface WorkloadProps {
  readonly tasks: readonly RestTask[];
  readonly today?: string | undefined;
  /** Where the board is, narrowed to one person's tasks, or to the unassigned. */
  readonly personHref?: ((person: RestPerson | undefined) => string) | undefined;
}

/** Who has what: a row per person, and what of theirs is late or due soon. */
export function Workload(props: WorkloadProps) {
  const words = useWords().calendar.workload;
  const rows = workloadOf(props.tasks, props.today ?? todayOf());
  if (rows.length === 0) {
    return null;
  }
  return (
    <table className="sc-workload" aria-label={words.title}>
      <thead>
        <tr>
          <th scope="col">{words.person}</th>
          <th scope="col">{words.open}</th>
          <th scope="col">{words.inProgress}</th>
          <th scope="col">{words.dueSoon}</th>
          <th scope="col">{words.overdue}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const href = props.personHref?.(row.person);
          const who =
            row.person === undefined ? (
              <span className="sc-muted">{words.unassigned}</span>
            ) : (
              <PersonChip person={row.person} />
            );
          return (
            <tr key={row.person?.id ?? ""}>
              <th scope="row">{href === undefined ? who : <a href={href}>{who}</a>}</th>
              <td>{row.open}</td>
              <td>{row.inProgress}</td>
              <td className={cx(row.dueSoon > 0 && "sc-workload-soon")}>{row.dueSoon}</td>
              <td className={cx(row.overdue > 0 && "sc-workload-late")}>{row.overdue}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
