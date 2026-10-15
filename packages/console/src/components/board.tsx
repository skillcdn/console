import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import {
  Avatar,
  Badge,
  Button,
  CategoryBadge,
  cx,
  DueBadge,
  PriorityBadge,
  personName,
} from "./ui.js";

// The board: one column per state, the tasks in it, the sooner due first and the newest after.
// A card says what a person needs at a glance and nothing more: the number and the title, the
// category, what is due, who is on it, and what blocks it. Whether an agent is at it is not
// said, since the board cannot know (ADR-0020); the task's page shows its runs. A card is moved
// to another column by its grip, with a mouse or a finger, and by the select on it with the
// keyboard; either way the move goes back up and the board is told. It takes its data as props
// and nothing from the network; what it is told on a click goes back up.

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
  /** Where the tasks put away are (ADR-0029); given, the done and dropped columns lead there. */
  readonly archiveHref?: string | undefined;
}

/** How far a pointer travels on the grip before the card is dragged, and not pressed. */
const DRAG_SLACK = 4;
/** How near the pointer comes to the board's edge before the board scrolls to show more columns. */
const EDGE = 48;
const EDGE_STEP = 12;

/** The state a column stands for, read off its `data-column`; nothing for a value that is not one. */
export function columnStateOf(value: string | null | undefined): TaskState | undefined {
  return TASK_STATES.find((state) => state === value);
}

/** A card on its way to another column. */
interface Drag {
  readonly task: RestTask;
  readonly from: { readonly x: number; readonly y: number };
  readonly x: number;
  readonly y: number;
  /** Whether the pointer has travelled far enough for this to be a drag. */
  readonly moving: boolean;
  /** The column under the pointer, or none. */
  readonly over: TaskState | undefined;
}

export function TaskCard(props: {
  readonly task: RestTask;
  readonly href: string;
  readonly onOpen: (task: RestTask) => void;
  readonly onMove?: ((task: RestTask, state: TaskState) => void) | undefined;
  readonly today?: string | undefined;
  /** Called when the card's grip is pressed, to drag it to another column; left out, the card has no grip. */
  readonly onGrip?: ((task: RestTask, event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  /** Whether the card is on its way to another column. */
  readonly dragging?: boolean | undefined;
}) {
  const words = useWords();
  const { task } = props;
  return (
    <article
      className={cx("sc-card", props.dragging === true && "sc-card-dragging")}
      aria-label={`#${task.number} ${task.title}`}
    >
      {props.onGrip !== undefined && (
        <button
          type="button"
          className="sc-card-grip"
          title={words.board.grip}
          aria-hidden="true"
          tabIndex={-1}
          onPointerDown={(event) => props.onGrip?.(task, event)}
        >
          ⋮⋮
        </button>
      )}
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
  const { onMove } = props;
  const board = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // What the pointer's release reads, so that the move is made outside a state update.
  const current = useRef<Drag | null>(null);
  current.current = drag;

  const grip = useCallback((task: RestTask, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    // The press is the drag's beginning and nothing else: no text is selected on the way.
    event.preventDefault();
    const from = { x: event.clientX, y: event.clientY };
    setDrag({ task, from, x: from.x, y: from.y, moving: false, over: undefined });
  }, []);

  // While a card is held, the pointer is followed over the whole document: the column under it
  // is marked, the board scrolls when the pointer nears its edge, and the release moves the task.
  const held = drag !== null;
  useEffect(() => {
    if (!held) {
      return;
    }
    const follow = (event: PointerEvent) => {
      const { clientX: x, clientY: y } = event;
      const under = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column]");
      setDrag((before) => {
        if (before === null) {
          return before;
        }
        const moving =
          before.moving || Math.hypot(x - before.from.x, y - before.from.y) > DRAG_SLACK;
        return {
          ...before,
          x,
          y,
          moving,
          over: moving ? columnStateOf(under?.dataset.column) : undefined,
        };
      });
      const element = board.current;
      if (element !== null) {
        const rect = element.getBoundingClientRect();
        if (x < rect.left + EDGE) {
          element.scrollLeft -= EDGE_STEP;
        } else if (x > rect.right - EDGE) {
          element.scrollLeft += EDGE_STEP;
        }
      }
    };
    const release = () => {
      const last = current.current;
      if (last?.moving === true && last.over !== undefined && last.over !== last.task.state) {
        onMove?.(last.task, last.over);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [held, onMove]);

  /** The drag under way, once the pointer has travelled; nothing while a card is merely pressed. */
  const dragging = drag?.moving === true ? drag : null;
  return (
    <div ref={board} className={cx("sc-board", dragging !== null && "sc-board-dragging")}>
      {TASK_STATES.map((state) => {
        const tasks = props.tasks.filter((task) => task.state === state).sort(byDue);
        return (
          <section
            key={state}
            className={cx(
              "sc-column",
              `sc-column-${state}`,
              dragging?.over === state && "sc-column-over",
            )}
            aria-label={words.vocabulary.state[state]}
            data-column={state}
          >
            <header className="sc-column-header">
              <h2 className="sc-column-title">{words.vocabulary.state[state]}</h2>
              <span className="sc-column-meta">
                {props.archiveHref !== undefined && (state === "done" || state === "dropped") && (
                  <a className="sc-column-archive" href={props.archiveHref}>
                    {words.board.archive}
                  </a>
                )}
                <span className="sc-column-count">{tasks.length}</span>
              </span>
            </header>
            <div className="sc-column-body">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  href={props.taskHref(task)}
                  onOpen={props.onOpen}
                  onMove={onMove}
                  today={props.today}
                  onGrip={onMove === undefined ? undefined : grip}
                  dragging={dragging?.task.id === task.id}
                />
              ))}
              {tasks.length === 0 && state === "idea" && props.empty}
            </div>
          </section>
        );
      })}
      {dragging !== null && (
        <div
          className="sc-drag-ghost"
          aria-hidden="true"
          style={{ transform: `translate(${dragging.x + 12}px, ${dragging.y + 12}px)` }}
        >
          <span className="sc-card-number">#{dragging.task.number}</span> {dragging.task.title}
        </div>
      )}
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
                {personName(person)}
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
