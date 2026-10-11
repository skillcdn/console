import type { ReactNode } from "react";
import {
  type RestCategory,
  type RestGoal,
  type RestPerson,
  type RestTask,
  TASK_STATES,
  type TaskState,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import type { BoardFilter } from "../router.js";
import { Avatar, Badge, Button, CategoryBadge, cx, DueBadge, PriorityBadge } from "./ui.js";

// The board: one column per state, the tasks in it, the sooner due first and the newest after.
// A card says what a person needs at a glance and nothing more: the number and the title, the
// category, what is due, who is on it, and what blocks it. Whether an agent is at it is not
// said, since the board cannot know (ADR-0020); the task's page shows its runs. It takes its
// data as props and nothing from the network; what it is told on a click goes back up.

export interface BoardProps {
  readonly tasks: readonly RestTask[];
  /** The link to a task's own page, as the composition routes it. */
  readonly taskHref: (task: RestTask) => string;
  readonly onOpen: (task: RestTask) => void;
  /** Called when a person moves a task to another column. Left out, the board is read-only. */
  readonly onMove?: ((task: RestTask, state: TaskState) => void) | undefined;
  /** The day to count due days from; the browser's today when left out. */
  readonly today?: string | undefined;
  /** What a column shows when it has nothing; the way to write the first task, for example. */
  readonly empty?: ReactNode;
}

export function TaskCard(props: {
  readonly task: RestTask;
  readonly href: string;
  readonly onOpen: (task: RestTask) => void;
  readonly onMove?: ((task: RestTask, state: TaskState) => void) | undefined;
  readonly today?: string | undefined;
}) {
  const words = useWords();
  const { task } = props;
  return (
    <article className="sc-card" aria-label={`#${task.number} ${task.title}`}>
      <a
        className="sc-card-title"
        href={props.href}
        onClick={(event) => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            props.onOpen(task);
          }
        }}
      >
        <span className="sc-card-number">#{task.number}</span> {task.title}
      </a>
      <div className="sc-card-meta">
        {task.category !== null && <CategoryBadge category={task.category} />}
        <PriorityBadge priority={task.priority} />
        {task.dueOn !== null && (
          <DueBadge dueOn={task.dueOn} state={task.state} today={props.today} />
        )}
        {task.openDecisions > 0 && (
          <Badge tone="warning" title={words.board.decisionsTitle}>
            {words.board.decisions(task.openDecisions)}
          </Badge>
        )}
        <span className="sc-card-spacer" />
        {task.assignee !== null && <Avatar person={task.assignee} size="sm" />}
      </div>
      {props.onMove !== undefined && (
        <label className="sc-card-move">
          <span className="sc-visually-hidden">{words.board.moveTo}</span>
          <select
            value={task.state}
            onChange={(event) => props.onMove?.(task, event.target.value as TaskState)}
          >
            {TASK_STATES.map((state) => (
              <option key={state} value={state}>
                {words.vocabulary.state[state]}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}

/** The order a column reads in: what is due soonest first, what has no day after, the newest first among those. */
export function byDue(a: RestTask, b: RestTask): number {
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) {
      return 1;
    }
    if (b.dueOn === null) {
      return -1;
    }
    return a.dueOn.localeCompare(b.dueOn);
  }
  return b.number - a.number;
}

export function Board(props: BoardProps) {
  const words = useWords();
  return (
    <div className="sc-board">
      {TASK_STATES.map((state) => {
        const tasks = props.tasks.filter((task) => task.state === state).sort(byDue);
        return (
          <section
            key={state}
            className={cx("sc-column", `sc-column-${state}`)}
            aria-label={words.vocabulary.state[state]}
          >
            <header className="sc-column-header">
              <h2 className="sc-column-title">{words.vocabulary.state[state]}</h2>
              <span className="sc-column-count">{tasks.length}</span>
            </header>
            <div className="sc-column-body">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  href={props.taskHref(task)}
                  onOpen={props.onOpen}
                  onMove={props.onMove}
                  today={props.today}
                />
              ))}
              {tasks.length === 0 && state === "idea" && props.empty}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** What the filter keeps of the board: a category or none, a goal or none, a person, one's own. */
export function filterTasks(
  tasks: readonly RestTask[],
  filter: BoardFilter,
  me?: RestPerson | undefined,
): RestTask[] {
  return tasks.filter((task) => {
    if (filter.category !== undefined && (task.category?.key ?? "") !== filter.category) {
      return false;
    }
    if (filter.goal !== undefined && (task.goalId ?? "") !== filter.goal) {
      return false;
    }
    if (filter.person !== undefined && task.assignee?.id !== filter.person) {
      return false;
    }
    if (filter.mine === true && (me === undefined || task.assignee?.id !== me.id)) {
      return false;
    }
    return true;
  });
}

export interface BoardFiltersProps {
  readonly filter: BoardFilter;
  readonly categories: readonly RestCategory[];
  readonly goals: readonly RestGoal[];
  readonly people: readonly RestPerson[];
  /** Whoever is looking, for "mine". */
  readonly me?: RestPerson | undefined;
  /** How many tasks the filter keeps, of how many. */
  readonly shown: number;
  readonly total: number;
  /** Called with the filter as it is to be: the composition shows the board at its address. */
  readonly onChange: (filter: BoardFilter) => void;
}

/** The ways to narrow the board, each a change of its address (ADR-0010). */
export function BoardFilters(props: BoardFiltersProps) {
  const words = useWords().board.filters;
  const { filter } = props;
  const narrowed = Object.keys(filter).length > 0;
  const goals = props.goals.filter((goal) => goal.state !== "dropped");
  const change = (patch: BoardFilter, drop?: keyof BoardFilter) => {
    const next: Record<string, unknown> = { ...filter, ...patch };
    if (drop !== undefined) {
      delete next[drop];
    }
    props.onChange(next as BoardFilter);
  };
  return (
    <form
      className="sc-filters"
      aria-label={words.aria}
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="sc-field sc-field-inline">
        <span className="sc-visually-hidden">{words.anyCategory}</span>
        <select
          className="sc-input"
          value={filter.category ?? "*"}
          onChange={(event) =>
            event.target.value === "*"
              ? change({}, "category")
              : change({ category: event.target.value })
          }
        >
          <option value="*">{words.anyCategory}</option>
          <option value="">{words.noCategory}</option>
          {props.categories.map((category) => (
            <option key={category.key} value={category.key}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      {goals.length > 0 && (
        <label className="sc-field sc-field-inline">
          <span className="sc-visually-hidden">{words.anyGoal}</span>
          <select
            className="sc-input"
            value={filter.goal ?? "*"}
            onChange={(event) =>
              event.target.value === "*" ? change({}, "goal") : change({ goal: event.target.value })
            }
          >
            <option value="*">{words.anyGoal}</option>
            <option value="">{words.noGoal}</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="sc-field sc-field-inline">
        <span className="sc-visually-hidden">{words.everyone}</span>
        <select
          className="sc-input"
          value={filter.mine === true ? "mine" : (filter.person ?? "*")}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "*") {
              change({ mine: undefined, person: undefined });
              return;
            }
            if (value === "mine") {
              change({ mine: true, person: undefined });
              return;
            }
            change({ person: value, mine: undefined });
          }}
        >
          <option value="*">{words.everyone}</option>
          {props.me !== undefined && <option value="mine">{words.mine}</option>}
          {props.people
            .filter((person) => person.id !== props.me?.id)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.login}
              </option>
            ))}
        </select>
      </label>
      <span className="sc-filters-count sc-muted">{words.showing(props.shown, props.total)}</span>
      {narrowed && (
        <Button variant="ghost" size="sm" onClick={() => props.onChange({})}>
          {words.clear}
        </Button>
      )}
    </form>
  );
}
