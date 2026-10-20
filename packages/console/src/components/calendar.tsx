import { type CSSProperties, type ReactNode, type SyntheticEvent, useState } from "react";
import {
  OPEN_TASK_STATES,
  type RestCategory,
  type RestGoal,
  type RestPerson,
  type RestTask,
  type WeekStart,
} from "../api.js";
import {
  addDays,
  addMonths,
  daysBetween,
  deviceLanguage,
  firstDayOfWeek,
  formatDay,
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
import { CategoryBadge, cx, PersonChip, personName, StateBadge, Time, Workers } from "./ui.js";

// The calendar of a project (ADR-0019): the month as a grid, or one week on its own. A task
// planned from a start to a due day lies across its days as a bar, in a lane of its own within
// each week so that the bars of one week never cross; a task with one day alone, a due day or
// a start, sits on that day as a dot. On a project's calendar the person who has a task stands
// before its title, since the days hold several people's work. Who has what says whether the
// work is on its days. The task under the pointer is shown in full within its item, with the
// facts its own page lists, above or below it where there is more room. Takes its data as props
// and nothing from the network; the month or the week shown is the address's (ADR-0010).

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
  /** The project's goals, so that the task under the pointer is shown with its goal's title, and, given `goalHref`, so that each goal marks its target day. */
  readonly goals?: readonly RestGoal[] | undefined;
  readonly taskHref: (task: RestTask) => string;
  /** Where a goal's page is: given, the goals mark their target days on the month (ADR-0026). */
  readonly goalHref?: ((goal: RestGoal) => string) | undefined;
  /** Where the calendar is on another month. */
  readonly monthHref: (month: string) => string;
  /** The day the weeks begin on, as the workspace says (ADR-0035); the language's when left out. */
  readonly weekStart?: WeekStart | undefined;
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

/** The tasks that sit on one day each, by day: due on it, or beginning on it with no due day yet. */
function onDays(tasks: readonly RestTask[]): ReadonlyMap<string, readonly RestTask[]> {
  const on = new Map<string, RestTask[]>();
  for (const task of tasks) {
    if (spans(task)) {
      continue;
    }
    const day = task.dueOn ?? task.startsOn;
    if (day !== null) {
      push(on, day, task);
    }
  }
  // Within a day, what is still open comes first; the rest reads as what was.
  for (const list of on.values()) {
    list.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.number - b.number);
  }
  return on;
}

/** How a task reads: struck through once it is over, and marked once its due day is past. */
const tone = (task: RestTask, now: string): string =>
  cx(
    !isOpen(task) && "sc-calendar-over",
    isOpen(task) && task.dueOn !== null && task.dueOn < now && "sc-calendar-late",
  );

/** Where the card of the item under the pointer goes: the side with more room, kept within the window. */
export interface TipPlace {
  readonly side: "above" | "below";
  /** How far the card moves from the item's left edge, in pixels, to stay within the window: zero or less. */
  readonly shift: number;
}

/** What the card may grow to, in pixels: 20rem at the usual root size, as the style says. */
const TIP_WIDTH = 320;
/** What stays between the card and the window's edge, in pixels. */
const TIP_MARGIN = 8;

/**
 * Places the card beside an item, from the item's box and the window's size, both in pixels from
 * the window's top left corner: above the item where the room above is at least the room below,
 * else below it, and moved left where it would otherwise leave the window on the right.
 */
export function placeTip(
  item: { readonly top: number; readonly bottom: number; readonly left: number },
  window: { readonly width: number; readonly height: number },
): TipPlace {
  const side = item.top >= window.height - item.bottom ? "above" : "below";
  const left = Math.max(TIP_MARGIN, Math.min(item.left, window.width - TIP_WIDTH - TIP_MARGIN));
  return { side, shift: Math.min(0, left - item.left) };
}

/** The item the pointer is on: a task on a day, since a bar has an item on each of its days, and where its card goes. */
interface Pointed {
  readonly task: RestTask;
  readonly day: string;
  readonly place: TipPlace;
}

/** The item under the pointer, measured as the pointer arrives, since only the browser knows where it is. */
function usePointed(): [
  Pointed | null,
  (task: RestTask, day: string, item: HTMLElement) => void,
  () => void,
] {
  const [pointed, setPointed] = useState<Pointed | null>(null);
  const point = (task: RestTask, day: string, item: HTMLElement): void =>
    setPointed({
      task,
      day,
      place: placeTip(item.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    });
  const leave = (): void => setPointed(null);
  return [pointed, point, leave];
}

export interface TaskTipProps {
  readonly task: RestTask;
  /** The project's goals, so that the task's goal is named by its title; without them the row is left out. */
  readonly goals?: readonly RestGoal[] | undefined;
  readonly place: TipPlace;
}

/**
 * The task under the pointer in full: its number and its title, then the facts its own page lists
 * beside the text, those that are set. Lies within the item it belongs to, above or below it, and
 * out of the accessible tree: the item's text is the title, and the facts are on the task's page.
 */
export function TaskTip(props: TaskTipProps) {
  const words = useWords();
  const { tag } = useLanguage();
  const { task, place } = props;
  const goal = props.goals?.find((candidate) => candidate.id === task.goalId);
  const day = (value: string): string => formatDay(value, tag);
  return (
    <div
      className={cx(
        "sc-task-tip",
        place.side === "above" ? "sc-task-tip-above" : "sc-task-tip-below",
      )}
      style={{ left: place.shift }}
      aria-hidden="true"
    >
      <p className="sc-task-tip-title">
        #{task.number} {task.title}
      </p>
      <dl className="sc-task-tip-facts">
        <div>
          <dt>{words.task.state}</dt>
          <dd>
            <StateBadge state={task.state} />
          </dd>
        </div>
        <div>
          <dt>{words.task.form.priority}</dt>
          <dd>{words.vocabulary.priority[task.priority]}</dd>
        </div>
        {task.category !== null && (
          <div>
            <dt>{words.task.category}</dt>
            <dd>
              <CategoryBadge category={task.category} />
            </dd>
          </div>
        )}
        {goal !== undefined && (
          <div>
            <dt>{words.task.goal}</dt>
            <dd>{goal.title}</dd>
          </div>
        )}
        <div>
          <dt>{words.task.owner}</dt>
          <dd>
            <PersonChip person={task.owner} />
          </dd>
        </div>
        <div>
          <dt>{words.task.workers}</dt>
          <dd>
            {task.workers.length === 0 ? (
              <span className="sc-muted">{words.common.nobody}</span>
            ) : (
              <ul className="sc-worker-list">
                {task.workers.map((worker) => (
                  <li key={worker.id}>
                    <PersonChip person={worker} />
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {(task.startsOn !== null || task.dueOn !== null) && (
          <div>
            <dt>{words.task.plan}</dt>
            <dd>
              {words.task.planned(
                task.startsOn === null ? undefined : day(task.startsOn),
                task.dueOn === null ? undefined : day(task.dueOn),
              )}
            </dd>
          </div>
        )}
        {task.startedAt !== null && (
          <div>
            <dt>{words.task.started}</dt>
            <dd>
              <Time iso={task.startedAt} />
            </dd>
          </div>
        )}
        {task.doneAt !== null && (
          <div>
            <dt>{words.task.done}</dt>
            <dd>
              <Time iso={task.doneAt} />
            </dd>
          </div>
        )}
        <div>
          <dt>{words.task.written}</dt>
          <dd>
            <Time iso={task.createdAt} />
          </dd>
        </div>
        <div>
          <dt>{words.task.changed}</dt>
          <dd>
            <Time iso={task.updatedAt} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

interface WeekRowProps {
  readonly week: readonly GridDay[];
  readonly segments: readonly WeekSegment[];
  /** The tasks on one day each, by day. */
  readonly on: ReadonlyMap<string, readonly RestTask[]>;
  readonly now: string;
  readonly taskHref: (task: RestTask) => string;
  /** What stands before a task's title where the tasks are of several projects: the project's mark. */
  readonly markOf?: ((task: RestTask) => ReactNode) | undefined;
  /** Whether the person who has a task stands before its title, where the days hold several people's work. */
  readonly people?: boolean | undefined;
  /** The item under the pointer, shown in full within that item, or none. */
  readonly pointed: Pointed | null;
  /** The project's goals, so that the item under the pointer names its goal; none across projects. */
  readonly goals?: readonly RestGoal[] | undefined;
  /** The goals whose target day is each day, where the goals mark the month. */
  readonly goalsOn?: ReadonlyMap<string, readonly RestGoal[]> | undefined;
  readonly goalHref?: ((goal: RestGoal) => string) | undefined;
  /** The pointer, or the focus, arrived on a task's item on a day. */
  readonly onPoint: (task: RestTask, day: string, item: HTMLElement) => void;
  /** It left. */
  readonly onLeave: () => void;
}

/** The goals that aim at each day, by day: those with a target day, still planned or worked towards. */
function goalsOnDays(goals: readonly RestGoal[]): ReadonlyMap<string, readonly RestGoal[]> {
  const on = new Map<string, RestGoal[]>();
  for (const goal of goals) {
    if (goal.dueOn === null || goal.state === "dropped") {
      continue;
    }
    const list = on.get(goal.dueOn);
    if (list === undefined) {
      on.set(goal.dueOn, [goal]);
    } else {
      list.push(goal);
    }
  }
  return on;
}

/** How many days a bar has in the week, for its title to run along: a custom property the stylesheet reads. */
const spanStyle = (span: number): CSSProperties => ({ "--sc-span": span }) as CSSProperties;

/** How many of a day's own tasks a cell shows before the way to the rest. */
export const DAY_SHOWN = 3;

/** One week as a row of cells: the bars across the days in their lanes, then the tasks on each day. */
function WeekRow(props: WeekRowProps) {
  const { week, segments, now } = props;
  const words = useWords().calendar;
  // The days a person opened in this week, each showing all of its tasks.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (day: string) =>
    setOpened((before) => {
      const after = new Set(before);
      if (after.has(day)) {
        after.delete(day);
      } else {
        after.add(day);
      }
      return after;
    });
  const pointing = (task: RestTask, day: string) => ({
    onMouseEnter: (event: SyntheticEvent<HTMLElement>) =>
      props.onPoint(task, day, event.currentTarget),
    onMouseLeave: props.onLeave,
    onFocus: (event: SyntheticEvent<HTMLElement>) => props.onPoint(task, day, event.currentTarget),
    onBlur: props.onLeave,
  });
  const tipIn = (task: RestTask, day: string): ReactNode =>
    props.pointed !== null && props.pointed.task.id === task.id && props.pointed.day === day ? (
      <TaskTip task={task} goals={props.goals} place={props.pointed.place} />
    ) : null;
  const who = (task: RestTask): ReactNode =>
    props.people === true ? <Workers workers={task.workers} size="xs" shown={2} /> : null;
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
          {props.goalHref !== undefined &&
            (props.goalsOn?.get(cell.day) ?? []).map((goal) => (
              <a
                key={goal.id}
                className={cx(
                  "sc-calendar-goal",
                  `sc-category-${goal.category?.color ?? "gray"}`,
                  goal.state === "done" && "sc-calendar-over",
                )}
                href={props.goalHref?.(goal)}
              >
                <span className="sc-calendar-flag" aria-hidden="true" />
                <span className="sc-calendar-task-title">{goal.title}</span>
              </a>
            ))}
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
            // The first piece carries the title; with more days in the week, the title runs along
            // the bar as far as they reach, over the pieces after it, instead of stopping at the
            // first day's edge.
            const span = segment.to - segment.from + 1;
            const spanning = segment.from === column && span > 1;
            // Every piece of the task under the pointer lights together, in every week it crosses.
            const pointed = props.pointed !== null && props.pointed.task.id === task.id;
            return (
              <a
                key={task.id}
                className={cx(
                  "sc-calendar-bar",
                  `sc-category-${task.category?.color ?? "gray"}`,
                  segment.from === column && segment.begins && "sc-calendar-bar-begins",
                  segment.to === column && segment.ends && "sc-calendar-bar-ends",
                  spanning && "sc-calendar-bar-spanning",
                  pointed && "sc-calendar-bar-pointed",
                  tone(task, now),
                )}
                style={spanning ? spanStyle(span) : undefined}
                href={props.taskHref(task)}
                {...pointing(task, cell.day)}
              >
                {segment.from === column && (
                  <>
                    {props.markOf?.(task)}
                    {who(task)}
                    <span
                      className={cx(
                        "sc-calendar-task-title",
                        spanning && "sc-calendar-task-title-spanning",
                      )}
                    >
                      {task.title}
                    </span>
                  </>
                )}
                {tipIn(task, cell.day)}
              </a>
            );
          })}
          {(() => {
            const all = props.on.get(cell.day) ?? [];
            const open = opened.has(cell.day);
            const shown = open || all.length <= DAY_SHOWN + 1 ? all : all.slice(0, DAY_SHOWN);
            return (
              <>
                {shown.map((task) => {
                  const mark = props.markOf?.(task);
                  return (
                    <a
                      key={task.id}
                      className={cx("sc-calendar-task", tone(task, now))}
                      href={props.taskHref(task)}
                      {...pointing(task, cell.day)}
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
                      {who(task)}
                      <span className="sc-calendar-task-title">{task.title}</span>
                      {tipIn(task, cell.day)}
                    </a>
                  );
                })}
                {all.length > DAY_SHOWN + 1 && (
                  <button
                    type="button"
                    className="sc-calendar-more"
                    aria-expanded={open}
                    onClick={() => toggle(cell.day)}
                  >
                    {open ? words.fewer : words.more(all.length - DAY_SHOWN)}
                  </button>
                )}
              </>
            );
          })()}
        </td>
      ))}
    </tr>
  );
}

export function Calendar(props: CalendarProps) {
  const words = useWords().calendar;
  const { tag } = useLanguage();
  const [pointed, point, leave] = usePointed();
  const now = props.today ?? todayOf();
  const firstDay = firstDayOfWeek(deviceLanguage(tag), props.weekStart);
  const weeks = monthGrid(props.month, firstDay);
  const on = onDays(props.tasks);
  const goalsOn = props.goalHref === undefined ? undefined : goalsOnDays(props.goals ?? []);
  const inMonth = (day: string) => monthOf(day) === props.month;
  const monthWeeks = weeks.map((week) => ({ week, segments: weekSegments(week, props.tasks) }));
  const nothing =
    [...on.keys()].every((day) => !inMonth(day)) &&
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
              on={on}
              now={now}
              taskHref={props.taskHref}
              pointed={pointed}
              goals={props.goals}
              goalsOn={goalsOn}
              goalHref={props.goalHref}
              onPoint={point}
              onLeave={leave}
              people
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
  /** The day the week begins on, as the workspace says (ADR-0035); the language's when left out. */
  readonly weekStart?: WeekStart | undefined;
}

/** One week on its own: the days as columns, the tasks on them, and the weeks around a step away. */
export function Week(props: WeekProps) {
  const words = useWords().calendar.week;
  const { tag } = useLanguage();
  const [pointed, point, leave] = usePointed();
  const now = props.today ?? todayOf();
  const firstDay = firstDayOfWeek(deviceLanguage(tag), props.weekStart);
  const days = weekOf(props.day ?? now, firstDay);
  const first = days[0] ?? now;
  const last = days[days.length - 1] ?? now;
  const week: GridDay[] = days.map((day) => ({ day, inMonth: true }));
  const on = onDays(props.tasks);
  const segments = weekSegments(week, props.tasks);
  const nothing = segments.length === 0 && days.every((day) => !on.has(day));
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
            on={on}
            now={now}
            taskHref={props.taskHref}
            markOf={props.markOf}
            pointed={pointed}
            onPoint={point}
            onLeave={leave}
          />
        </tbody>
      </table>
      {nothing && <p className="sc-muted">{words.nothing}</p>}
    </div>
  );
}

/** One person's share of the open work, as the table of who has what says it. */
export interface WorkloadRow {
  /** The person, or nobody for the tasks with no worker. */
  readonly person: RestPerson | undefined;
  readonly open: number;
  readonly inProgress: number;
  /** Open, and due from today through the last day of this week, as the workspace begins its weeks (ADR-0039). */
  readonly dueThisWeek: number;
  /** Open, and past its day. */
  readonly overdue: number;
}

/**
 * Who has what, from the open tasks: a task counted for each of its workers, by name, and the
 * tasks with none last; this week is the days from today through the week's last day, the week
 * beginning on `firstDay` (1 for Monday, 7 for Sunday).
 */
export function workloadOf(tasks: readonly RestTask[], today: string, firstDay = 1): WorkloadRow[] {
  const weekEnd = weekOf(today, firstDay).at(-1) ?? today;
  const rows = new Map<string, { person: RestPerson | undefined; tasks: RestTask[] }>();
  for (const task of tasks.filter(isOpen)) {
    const workers: readonly (RestPerson | undefined)[] =
      task.workers.length === 0 ? [undefined] : task.workers;
    for (const worker of workers) {
      const key = worker?.id ?? "";
      const row = rows.get(key);
      if (row === undefined) {
        rows.set(key, { person: worker, tasks: [task] });
      } else {
        row.tasks.push(task);
      }
    }
  }
  const count = (list: readonly RestTask[]): Omit<WorkloadRow, "person"> => ({
    open: list.length,
    inProgress: list.filter((task) => task.state === "in_progress" || task.state === "in_review")
      .length,
    dueThisWeek: list.filter(
      (task) => task.dueOn !== null && task.dueOn >= today && task.dueOn <= weekEnd,
    ).length,
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
  /** The day the week begins on, as the workspace says (ADR-0035); the language's when left out. */
  readonly weekStart?: WeekStart | undefined;
  /** Where the board is, narrowed to one person's tasks, or to those with no worker. */
  readonly personHref?: ((person: RestPerson | undefined) => string) | undefined;
}

/** Who has what: a row per person, and what of theirs is late or due this week. */
export function Workload(props: WorkloadProps) {
  const words = useWords().calendar.workload;
  const { tag } = useLanguage();
  const rows = workloadOf(
    props.tasks,
    props.today ?? todayOf(),
    firstDayOfWeek(deviceLanguage(tag), props.weekStart),
  );
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
          <th scope="col">{words.dueThisWeek}</th>
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
              <td className={cx(row.dueThisWeek > 0 && "sc-workload-soon")}>{row.dueThisWeek}</td>
              <td className={cx(row.overdue > 0 && "sc-workload-late")}>{row.overdue}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
