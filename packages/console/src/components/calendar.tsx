import { OPEN_TASK_STATES, type RestPerson, type RestTask } from "../api.js";
import {
  addMonths,
  daysBetween,
  firstDayOfWeek,
  formatMonth,
  formatWeekday,
  monthGrid,
  monthOf,
  today as todayOf,
  weekdays,
} from "../dates.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { cx, PersonChip } from "./ui.js";

// The calendar of a project (ADR-0019): the month as a grid, each task on the day it is due
// and, lightly, on the day it starts; and who has what, so that whoever runs the project sees
// at a glance whether the work is on its days. Takes its data as props and nothing from the
// network; the month shown is the address's (ADR-0010).

const isOpen = (task: RestTask): boolean => OPEN_TASK_STATES.includes(task.state);

export interface CalendarProps {
  readonly tasks: readonly RestTask[];
  /** The month shown: `2026-10`. */
  readonly month: string;
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
  readonly taskHref: (task: RestTask) => string;
  /** Where the calendar is on another month. */
  readonly monthHref: (month: string) => string;
}

function push(map: Map<string, RestTask[]>, day: string, task: RestTask): void {
  const list = map.get(day);
  if (list === undefined) {
    map.set(day, [task]);
  } else {
    list.push(task);
  }
}

export function Calendar(props: CalendarProps) {
  const words = useWords().calendar;
  const { tag } = useLanguage();
  const now = props.today ?? todayOf();
  const firstDay = firstDayOfWeek(tag);
  const weeks = monthGrid(props.month, firstDay);
  const due = new Map<string, RestTask[]>();
  const starting = new Map<string, RestTask[]>();
  for (const task of props.tasks) {
    if (task.dueOn !== null) {
      push(due, task.dueOn, task);
    }
    if (task.startsOn !== null && task.startsOn !== task.dueOn) {
      push(starting, task.startsOn, task);
    }
  }
  // Within a day, what is still open comes first; the rest reads as what was.
  for (const list of due.values()) {
    list.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.number - b.number);
  }
  const inMonth = (day: string) => monthOf(day) === props.month;
  const nothing =
    [...due.keys()].every((day) => !inMonth(day)) &&
    [...starting.keys()].every((day) => !inMonth(day));
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
          {weeks.map((week) => (
            <tr key={week[0]?.day}>
              {week.map((cell) => (
                <td
                  key={cell.day}
                  className={cx(
                    "sc-calendar-cell",
                    !cell.inMonth && "sc-calendar-cell-outside",
                    cell.day === now && "sc-calendar-cell-today",
                  )}
                >
                  <span className="sc-calendar-day">{Number(cell.day.slice(8))}</span>
                  {(due.get(cell.day) ?? []).map((task) => (
                    <a
                      key={task.id}
                      className={cx(
                        "sc-calendar-task",
                        !isOpen(task) && "sc-calendar-task-over",
                        isOpen(task) && cell.day < now && "sc-calendar-task-late",
                      )}
                      href={props.taskHref(task)}
                      title={`#${task.number} ${task.title}`}
                    >
                      <span
                        className={cx(
                          "sc-calendar-dot",
                          `sc-category-${task.category?.color ?? "gray"}`,
                        )}
                      />
                      <span className="sc-calendar-task-title">{task.title}</span>
                    </a>
                  ))}
                  {(starting.get(cell.day) ?? []).map((task) => (
                    <a
                      key={task.id}
                      className="sc-calendar-task sc-calendar-task-start"
                      href={props.taskHref(task)}
                      title={`#${task.number} ${task.title}: ${words.starts}`}
                    >
                      <span className="sc-calendar-task-title">{task.title}</span>
                    </a>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {nothing && <p className="sc-muted">{words.nothingDue}</p>}
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
      return a.person.login.localeCompare(b.person.login);
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
