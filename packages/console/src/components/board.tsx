import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
import { isPlainClick } from "./shell.js";
import {
  Badge,
  Button,
  CategoryBadge,
  cx,
  DueBadge,
  PriorityBadge,
  personName,
  Workers,
} from "./ui.js";

// The board: one column per state, the tasks in it, the sooner due first and the newest after.
// A card says what a person needs at a glance and nothing more: the number and the title, the
// category, what is due, who is on it, and what blocks it. Whether an agent is at it is not
// said, since the board cannot know (ADR-0020); the task's page shows its runs. A card is moved
// to another column by hand: pressed anywhere but on its menu, its title included, then dragged
// whole, with a mouse at once and under a finger once it has rested a moment, so that a finger
// that moves at once scrolls as it always did; a click on the title opens the task as long as the
// card was not dragged. The card's menu holds the rest: the way to the task's form, and the way to
// put the task away (ADR-0029, ADR-0030). The keyboard changes a state on the task's page. The
// board takes its data as props and nothing from the network; what it is told on a click goes
// back up.

export interface BoardProps {
  readonly tasks: readonly RestTask[];
  /** The link to a task's own page, as the composition routes it. */
  readonly taskHref: (task: RestTask) => string;
  readonly onOpen: (task: RestTask) => void;
  /** Called when a person moves a task to another column. Left out, the cards stay where they are. */
  readonly onMove?: ((task: RestTask, state: TaskState) => void) | undefined;
  /** The day to count due days from; the browser's today when left out. */
  readonly today?: string | undefined;
  /** What a column shows when it has nothing; the way to write the first task, for example. */
  readonly empty?: ReactNode;
  /** Where a task is edited, as the composition routes it; given, each card's menu leads there. */
  readonly editHref?: ((task: RestTask) => string) | undefined;
  /** Called when the menu's edit is chosen, to show the form without leaving the page; left out, the link is followed. */
  readonly onEdit?: ((task: RestTask) => void) | undefined;
  /** Called when a task is put away from its card's menu (ADR-0029, ADR-0030). Left out, the menu offers nothing of it. */
  readonly onArchive?: ((task: RestTask) => void) | undefined;
}

/** How far a mouse travels on a card before the press is a drag and not a click. */
const DRAG_SLACK = 4;
/**
 * How long a finger rests on a card before the card comes loose, and how far it may wander
 * meanwhile; a finger that moves sooner is scrolling the page, not moving the card.
 */
const HOLD_MS = 300;
const HOLD_SLACK = 8;
/** How near the pointer comes to the board's edge before the board scrolls to show more columns. */
const EDGE = 48;
const EDGE_STEP = 12;

/** The state a column stands for, read off its `data-column`; nothing for a value that is not one. */
export function columnStateOf(value: string | null | undefined): TaskState | undefined {
  return TASK_STATES.find((state) => state === value);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** A card on its way to another column. */
interface Drag {
  readonly task: RestTask;
  readonly from: Point;
  readonly x: number;
  readonly y: number;
  /** Where on the card it was taken hold of, so that the card moves whole under the pointer. */
  readonly grip: Point;
  /** How wide the card is where it stands, so that the one in hand is the same. */
  readonly width: number;
  /** Whether the card has come loose: the mouse has travelled, or the finger has rested. */
  readonly moving: boolean;
  /** Whether the press is a finger's, which must rest before the card comes loose. */
  readonly hold: boolean;
  /** The column under the pointer, or none. */
  readonly over: TaskState | undefined;
}

export interface TaskCardProps {
  readonly task: RestTask;
  readonly href: string;
  readonly onOpen: (task: RestTask) => void;
  readonly today?: string | undefined;
  /** Called when the card is pressed anywhere but on its menu, to drag it to another column; left out, the card stays where it is. */
  readonly onPress?: ((task: RestTask, event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  /** Whether the card is on its way to another column: the one left in its place is faded. */
  readonly dragging?: boolean | undefined;
  /** Where the task is edited; given, the card's menu leads there. */
  readonly editHref?: string | undefined;
  /** Called when the menu's edit is chosen, to show the form without leaving the page; left out, the link is followed. */
  readonly onEdit?: ((task: RestTask) => void) | undefined;
  /** Called when the task is put away from the card's menu, whatever its state (ADR-0030). */
  readonly onArchive?: ((task: RestTask) => void) | undefined;
}

export function TaskCard(props: TaskCardProps) {
  const words = useWords();
  const { task, onPress } = props;
  return (
    <article
      className={cx(
        "sc-card",
        onPress !== undefined && "sc-card-movable",
        props.dragging === true && "sc-card-dragging",
      )}
      aria-label={`#${task.number} ${task.title}`}
      onPointerDown={onPress === undefined ? undefined : (event) => onPress(task, event)}
    >
      {(props.editHref !== undefined || props.onArchive !== undefined) && (
        <CardMenu
          task={task}
          editHref={props.editHref}
          onEdit={props.onEdit}
          onArchive={props.onArchive}
        />
      )}
      <a
        className="sc-card-title"
        href={props.href}
        // The card is dragged by our own hand, the title included; the browser's drag of a link is not it.
        draggable={false}
        onClick={(event) => {
          if (isPlainClick(event)) {
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
        <Workers workers={task.workers} size="sm" />
      </div>
    </article>
  );
}

/** Where the menu stands: from the top and the right edge of the window, over everything. */
interface MenuPlace {
  readonly top: number;
  readonly right: number;
}

const MENU_GAP = 4;
const MENU_MARGIN = 8;

/**
 * The card's menu: three dots in its corner, which open the ways a card has beyond being moved,
 * each given by the composition. The menu is rendered over the document, so that no column
 * clips it; a press elsewhere, the escape key, a scroll or a change of the window closes it, and
 * so does the button that opened it.
 */
function CardMenu(props: {
  readonly task: RestTask;
  readonly editHref: string | undefined;
  readonly onEdit: ((task: RestTask) => void) | undefined;
  readonly onArchive: ((task: RestTask) => void) | undefined;
}) {
  const words = useWords();
  const [place, setPlace] = useState<MenuPlace | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = place !== null;
  const close = useCallback(() => setPlace(null), []);
  const toggle = () => {
    const rect = button.current?.getBoundingClientRect();
    if (open || rect === undefined) {
      close();
      return;
    }
    setPlace({
      top: rect.bottom + MENU_GAP,
      right: Math.max(MENU_MARGIN, window.innerWidth - rect.right),
    });
  };
  /** Whether the focus, or a press, is on the menu or on its button: the menu's own. */
  const own = useCallback(
    (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (panel.current?.contains(target) === true || button.current?.contains(target) === true),
    [],
  );
  useEffect(() => {
    if (!open) {
      return;
    }
    // Opened near the bottom of the window, the menu stands above its button instead.
    const shown = panel.current?.getBoundingClientRect();
    const anchor = button.current?.getBoundingClientRect();
    if (
      shown !== undefined &&
      anchor !== undefined &&
      shown.bottom > window.innerHeight - MENU_MARGIN
    ) {
      setPlace((current) =>
        current === null
          ? current
          : { ...current, top: Math.max(MENU_MARGIN, anchor.top - MENU_GAP - shown.height) },
      );
    }
    panel.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      if (!own(event.target)) {
        close();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close, own]);
  // The arrow keys walk the items, around the ends.
  const walk = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const items = [...(panel.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    if (items.length === 0) {
      return;
    }
    const active = document.activeElement;
    const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };
  const { task } = props;
  return (
    <>
      <button
        type="button"
        ref={button}
        className="sc-card-menu-button"
        aria-label={words.board.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="3" r="1.5" fill="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
          <circle cx="8" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {place !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panel}
            className="sc-card-menu"
            role="menu"
            aria-label={`#${task.number} ${task.title}`}
            style={{ top: place.top, right: place.right }}
            onKeyDown={walk}
            // The focus leaving for anywhere but the menu's own button closes it; the button closes it itself.
            onBlur={(event) => {
              if (!own(event.relatedTarget)) {
                close();
              }
            }}
          >
            {props.editHref !== undefined && (
              <a
                role="menuitem"
                className="sc-menu-link"
                href={props.editHref}
                onClick={(event) => {
                  close();
                  if (props.onEdit !== undefined && isPlainClick(event)) {
                    event.preventDefault();
                    props.onEdit(task);
                  }
                }}
              >
                {words.common.edit}
              </a>
            )}
            {props.onArchive !== undefined && (
              <button
                type="button"
                role="menuitem"
                className="sc-menu-link"
                onClick={() => {
                  close();
                  props.onArchive?.(task);
                }}
              >
                {words.task.archive}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
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

const nothing = () => undefined;

export function Board(props: BoardProps) {
  const words = useWords();
  const { onMove } = props;
  const board = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // What the pointer's release reads, so that the move is made outside a state update.
  const current = useRef<Drag | null>(null);
  current.current = drag;
  // Whether the held card has come loose, kept outside the state so that the touch that follows
  // the hold at once is answered before the state has rendered.
  const loose = useRef(false);

  const press = useCallback((task: RestTask, event: ReactPointerEvent<HTMLElement>) => {
    // The card's menu is pressed for itself; everything else on the card takes hold of it.
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button") !== null)
    ) {
      return;
    }
    const hold = event.pointerType !== "mouse";
    if (!hold) {
      // The press is the drag's beginning and nothing else: no text is selected on the way.
      event.preventDefault();
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    setDrag({
      task,
      from,
      x: from.x,
      y: from.y,
      grip: { x: from.x - rect.left, y: from.y - rect.top },
      width: rect.width,
      moving: false,
      hold,
      over: undefined,
    });
  }, []);

  // While a card is held, the pointer is followed over the whole document: the column under it
  // is marked, the board scrolls when the pointer nears its edge, and the release moves the task.
  // A finger's hold is timed here, and once the card has come loose the page no longer scrolls
  // under the finger, nor asks for the menu a long press would otherwise bring up; the click that
  // follows a drag opens nothing.
  const held = drag !== null;
  useEffect(() => {
    if (!held) {
      return;
    }
    const columnUnder = (x: number, y: number) =>
      columnStateOf(
        document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column]")?.dataset.column,
      );
    const follow = (event: PointerEvent) => {
      const { clientX: x, clientY: y } = event;
      setDrag((before) => {
        if (before === null) {
          return before;
        }
        const travelled = Math.hypot(x - before.from.x, y - before.from.y);
        if (!before.moving) {
          // A finger that wanders before it has rested is scrolling, and lets the card go; a
          // mouse that has barely moved is still only pressing.
          if (before.hold) {
            return travelled > HOLD_SLACK ? null : { ...before, x, y };
          }
          if (travelled <= DRAG_SLACK) {
            return { ...before, x, y };
          }
          loose.current = true;
        }
        return { ...before, x, y, moving: true, over: columnUnder(x, y) };
      });
      const element = board.current;
      if (element !== null && loose.current) {
        const rect = element.getBoundingClientRect();
        if (x < rect.left + EDGE) {
          element.scrollLeft -= EDGE_STEP;
        } else if (x > rect.right - EDGE) {
          element.scrollLeft += EDGE_STEP;
        }
      }
    };
    const loosen = () => {
      setDrag((before) => {
        if (before === null || before.moving) {
          return before;
        }
        loose.current = true;
        return { ...before, moving: true, over: columnUnder(before.x, before.y) };
      });
    };
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const release = (event: PointerEvent) => {
      const last = current.current;
      if (loose.current) {
        // The click the browser sends after the pointer is let go would open the title's task:
        // it is swallowed, and the ear for it taken down once that moment has passed.
        window.addEventListener("click", swallow, true);
        window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      }
      if (last?.moving === true && event.type === "pointerup") {
        const over = columnUnder(event.clientX, event.clientY);
        if (over !== undefined && over !== last.task.state) {
          onMove?.(last.task, over);
        }
      }
      loose.current = false;
      setDrag(null);
    };
    const block = (event: TouchEvent) => {
      if (loose.current) {
        event.preventDefault();
      }
    };
    const quiet = (event: Event) => event.preventDefault();
    const timer = current.current?.hold === true ? window.setTimeout(loosen, HOLD_MS) : undefined;
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    document.addEventListener("touchmove", block, { passive: false });
    document.addEventListener("contextmenu", quiet);
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("touchmove", block);
      document.removeEventListener("contextmenu", quiet);
      loose.current = false;
    };
  }, [held, onMove]);

  /** The drag under way, once the card has come loose; nothing while a card is merely pressed. */
  const dragging = drag?.moving === true ? drag : null;
  return (
    <div
      ref={board}
      className={cx(
        "sc-board",
        onMove !== undefined && "sc-board-movable",
        dragging !== null && "sc-board-dragging",
      )}
    >
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
              <span className="sc-column-count">{tasks.length}</span>
            </header>
            <div className="sc-column-body">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  href={props.taskHref(task)}
                  onOpen={props.onOpen}
                  today={props.today}
                  onPress={onMove === undefined ? undefined : press}
                  dragging={dragging?.task.id === task.id}
                  editHref={props.editHref?.(task)}
                  onEdit={props.onEdit}
                  onArchive={props.onArchive}
                />
              ))}
              {tasks.length === 0 && state === "idea" && props.empty}
            </div>
          </section>
        );
      })}
      {dragging !== null && (
        // The card in hand: the whole of it, as wide as where it stands, under the pointer where it was taken hold of.
        <div
          className="sc-drag-ghost"
          aria-hidden="true"
          style={{
            width: dragging.width,
            transform: `translate(${dragging.x - dragging.grip.x}px, ${dragging.y - dragging.grip.y}px)`,
          }}
        >
          <TaskCard
            task={dragging.task}
            href={props.taskHref(dragging.task)}
            onOpen={nothing}
            today={props.today}
            // The menu too, inert under the pointer, so that the card in hand keeps the shape of the one in its place.
            editHref={props.editHref?.(dragging.task)}
            onArchive={props.onArchive}
          />
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
    if (
      filter.person !== undefined &&
      !task.workers.some((worker) => worker.id === filter.person)
    ) {
      return false;
    }
    if (
      filter.mine === true &&
      (me === undefined || !task.workers.some((worker) => worker.id === me.id))
    ) {
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
