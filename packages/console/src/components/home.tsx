import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  added,
  arranged,
  columnsFor,
  footprintOf,
  HOME_TILE_CELLS,
  type HomeColumns,
  type HomeTile,
  type HomeTileSize,
  type HomeWidgetTile,
  homeTiles,
  homeWith,
  moved,
  type PlacedTile,
  resized,
  rowsOf,
  sizesAt,
} from "../home-tiles.js";
import { useWords } from "../i18n/index.js";
import type { PluginWidgetSizeName } from "../plugin/bridge.js";
import type { RestHome, RestPlugin, RestProject } from "../schemas.js";
import { useAction } from "../use-action.js";
import { DRAG_SLACK, edgeScrollOf, HOLD_MS, HOLD_SLACK } from "./board.js";
import { ProjectMark, ProjectRoleBadge } from "./projects.js";
import { Badge, Button, Callout, cx } from "./ui.js";

// The front page (ADR-0061): one grid of tiles, the projects and the plugins' widgets alike. While
// the person arranges it nothing on it opens: a tile is taken in hand and put down anywhere, as a
// card on the board is, those in the way moving aside as icons do on a phone, and each carries
// the way off the page and the sizes it comes in. Takes its data as props and nothing from the
// network; a widget's frame is the composition's to draw.

/** The rows of room below the last tile while the page is arranged, to put one down in. */
const SPARE_ROWS = 2;

const NONE: readonly string[] = [];

export interface ProjectTileProps {
  readonly project: RestProject;
  readonly size: HomeTileSize;
  /** The way into the project; left out while the page is arranged, when a tile opens nothing. */
  readonly href?: string | undefined;
  readonly onOpen?: ((project: RestProject) => void) | undefined;
}

/** A project on the front page: its mark and its name as an icon; at a larger size, what it is too. */
export function ProjectTile(props: ProjectTileProps) {
  const words = useWords().projects;
  const { project, onOpen } = props;
  const card = props.size !== "icon";
  const inside = (
    <>
      <span className="sc-tile-mark">
        <ProjectMark project={project} size="lg" />
      </span>
      <span className="sc-tile-name">{project.name}</span>
      {card && (
        <span className="sc-tile-meta">
          <code className="sc-project-key">{project.key}</code>
          <ProjectRoleBadge role={project.role} />
          {project.visibility === "private" ? (
            <Badge tone="neutral">{words.private}</Badge>
          ) : (
            <Badge tone="warning">{words.public}</Badge>
          )}
        </span>
      )}
      {card && project.description.length > 0 && (
        <span className="sc-tile-about">{project.description}</span>
      )}
      {project.openDecisions > 0 && (
        <span
          className="sc-nav-count sc-tile-count"
          title={words.decisionsWaiting(project.openDecisions)}
        >
          {project.openDecisions}
          <span className="sc-visually-hidden">
            {" "}
            {words.decisionsWaiting(project.openDecisions)}
          </span>
        </span>
      )}
    </>
  );
  const className = cx("sc-tile-pane", "sc-tile-project", card && "sc-tile-project-card");
  if (props.href === undefined) {
    return <div className={className}>{inside}</div>;
  }
  return (
    <a
      className={className}
      href={props.href}
      onClick={(event) => {
        if (
          onOpen !== undefined &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          onOpen(project);
        }
      }}
    >
      {inside}
    </a>
  );
}

/** The sizes a tile comes in, each a little picture of its shape, the one it has lit. */
function SizeChoice(props: {
  readonly tile: PlacedTile;
  readonly sizes: readonly HomeTileSize[];
  readonly onChoose: (size: HomeTileSize) => void;
}) {
  const words = useWords().home;
  return (
    <fieldset className="sc-tile-sizes" aria-label={words.size}>
      {props.sizes.map((size) => (
        <button
          key={size}
          type="button"
          className={cx("sc-tile-size", size === props.tile.size && "sc-tile-size-on")}
          aria-pressed={size === props.tile.size}
          aria-label={words.sizes[size]}
          title={words.sizes[size]}
          onClick={() => props.onChoose(size)}
        >
          <span
            className="sc-tile-size-glyph"
            style={
              {
                "--sc-tile-w": HOME_TILE_CELLS[size].columns,
                "--sc-tile-h": HOME_TILE_CELLS[size].rows,
              } as CSSProperties
            }
          />
        </button>
      ))}
    </fieldset>
  );
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** A tile in hand. */
interface Drag {
  readonly id: string;
  readonly from: Point;
  readonly x: number;
  readonly y: number;
  /** Where on the tile it was taken hold of, so that it moves whole under the pointer. */
  readonly grip: Point;
  /** Whether it has come loose: the mouse has travelled, or the finger has rested. */
  readonly moving: boolean;
  /** Whether the press is a finger's, which must rest before the tile comes loose. */
  readonly hold: boolean;
  /** Where it is now, in pixels from the corner of the grid. */
  readonly left: number;
  readonly top: number;
  /** The cell it would be put down on. */
  readonly cell: Point;
}

/** How many columns the grid has for the width the page gives it, followed as the width changes. */
function useHomeColumns(): readonly [RefObject<HTMLDivElement | null>, HomeColumns] {
  const element = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<HomeColumns>(8);
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) {
      return;
    }
    const measure = () => setColumns(columnsFor(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [element, columns];
}

export interface HomeGridProps {
  readonly projects: readonly RestProject[];
  readonly plugins: readonly RestPlugin[];
  /** What the person kept of the page, or nothing yet. */
  readonly home: RestHome | null | undefined;
  /** Whether the person is arranging the page. */
  readonly editing: boolean;
  /** Keeps what they arranged; they stay on the page's editing until it is kept. */
  readonly onSave: (home: RestHome) => Promise<unknown>;
  /** The person is done arranging: what they did is kept, or was let go. */
  readonly onDone: () => void;
  readonly projectHref: (project: RestProject) => string;
  readonly onOpen: (project: RestProject) => void;
  /** A name a manifest gives, in the person's language. */
  readonly nameOf: (name: Readonly<Record<string, string>>) => string;
  /** A widget's frame, at the size it has. */
  readonly renderWidget: (tile: HomeWidgetTile, size: PluginWidgetSizeName) => ReactNode;
  /** What stands on the page while it holds nothing. */
  readonly empty?: ReactNode;
}

export function HomeGrid(props: HomeGridProps) {
  const allWords = useWords();
  const words = allWords.home;
  const { editing, home, nameOf } = props;
  const tiles = homeTiles(props.plugins, props.projects);
  const [page, columns] = useHomeColumns();
  const grid = useRef<HTMLUListElement>(null);
  /** What the person has changed since they began: kept when they are done, let go if they cancel. */
  const [draft, setDraft] = useState<RestHome | null>(null);
  const working = draft ?? home;
  const hidden = working?.hidden ?? NONE;
  const placed = arranged(tiles, working, columns);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { busy, error, act } = useAction();
  /** The tile in hand, once it has come loose; nothing while one is merely pressed. */
  const dragging = drag?.moving === true ? drag : null;
  // Those in the way stand aside while the tile is held over their place, and go back when it
  // moves on: each step starts from the page as it was taken up.
  const shown =
    dragging === null
      ? placed
      : moved(placed, dragging.id, dragging.cell.x, dragging.cell.y, columns);
  const change = (next: readonly PlacedTile[], nextHidden: readonly string[] = hidden) =>
    setDraft(homeWith(working, next, nextHidden, columns));

  // What the pointer's handlers read, so that they run outside a state update.
  const current = useRef({ drag, placed, columns, change });
  current.current = { drag, placed, columns, change };
  // Whether the held tile has come loose, kept outside the state so that the touch that follows
  // the hold at once is answered before the state has rendered.
  const loose = useRef(false);

  const press = (tile: PlacedTile, event: ReactPointerEvent<HTMLElement>) => {
    // The tile's own buttons are pressed for themselves; everything else takes hold of it.
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
      id: tile.tile.id,
      from,
      x: from.x,
      y: from.y,
      grip: { x: from.x - rect.left, y: from.y - rect.top },
      moving: false,
      hold,
      left: 0,
      top: 0,
      cell: { x: tile.x, y: tile.y },
    });
  };

  // While a tile is held, the pointer is followed over the whole document: the cell under the
  // tile is worked out, the page scrolls while the pointer is near the window's edge, moving or
  // still, and the release puts the tile down. A finger's hold is timed here, and once the tile
  // has come loose the page no longer scrolls under the finger, as on the board.
  const held = drag !== null;
  useEffect(() => {
    if (!held) {
      return;
    }
    const pointer = { x: current.current.drag?.x ?? 0, y: current.current.drag?.y ?? 0 };
    /** Where the tile is, for the pointer as it is and the grid as it lies on the screen now. */
    const whereFor = (grip: Point): Pick<Drag, "left" | "top" | "cell"> | undefined => {
      const element = grid.current;
      if (element === null) {
        return undefined;
      }
      const rect = element.getBoundingClientRect();
      const gap = Number.parseFloat(window.getComputedStyle(element).rowGap) || 0;
      const width = current.current.columns;
      const step = (rect.width + gap) / width;
      const left = pointer.x - grip.x - rect.left;
      const top = pointer.y - grip.y - rect.top;
      const lowest = rowsOf(current.current.placed, width) + SPARE_ROWS - 1;
      return {
        left,
        top,
        cell: { x: Math.round(left / step), y: Math.min(Math.round(top / step), lowest) },
      };
    };
    let frame = 0;
    let at: number | undefined;
    let rest = 0;
    const carry = (now: number) => {
      frame = window.requestAnimationFrame(carry);
      const elapsed = at === undefined ? 0 : now - at;
      at = now;
      if (!loose.current) {
        return;
      }
      const share = edgeScrollOf(pointer.y, 0, window.innerHeight, elapsed) + rest;
      const whole = Math.trunc(share);
      rest = share - whole;
      if (whole === 0) {
        return;
      }
      const was = window.scrollY;
      window.scrollBy(0, whole);
      if (window.scrollY !== was) {
        setDrag((before) => (before === null ? before : { ...before, ...whereFor(before.grip) }));
      }
    };
    const follow = (event: PointerEvent) => {
      const { clientX: x, clientY: y } = event;
      pointer.x = x;
      pointer.y = y;
      setDrag((before) => {
        if (before === null) {
          return before;
        }
        const travelled = Math.hypot(x - before.from.x, y - before.from.y);
        if (!before.moving) {
          // A finger that wanders before it has rested is scrolling, and lets the tile go; a
          // mouse that has barely moved is still only pressing.
          if (before.hold) {
            return travelled > HOLD_SLACK ? null : { ...before, x, y };
          }
          if (travelled <= DRAG_SLACK) {
            return { ...before, x, y };
          }
          loose.current = true;
        }
        return { ...before, x, y, moving: true, ...whereFor(before.grip) };
      });
    };
    const loosen = () => {
      setDrag((before) => {
        if (before === null || before.moving) {
          return before;
        }
        loose.current = true;
        return { ...before, moving: true, ...whereFor(before.grip) };
      });
    };
    const release = (event: PointerEvent) => {
      const { drag: last, placed: now, columns: width, change: keep } = current.current;
      if (last?.moving === true && event.type === "pointerup") {
        keep(moved(now, last.id, last.cell.x, last.cell.y, width));
      }
      loose.current = false;
      setDrag(null);
    };
    const letGo = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        loose.current = false;
        setDrag(null);
      }
    };
    const block = (event: TouchEvent) => {
      if (loose.current) {
        event.preventDefault();
      }
    };
    const quiet = (event: Event) => event.preventDefault();
    const timer =
      current.current.drag?.hold === true ? window.setTimeout(loosen, HOLD_MS) : undefined;
    frame = window.requestAnimationFrame(carry);
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keydown", letGo);
    document.addEventListener("touchmove", block, { passive: false });
    document.addEventListener("contextmenu", quiet);
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("keydown", letGo);
      document.removeEventListener("touchmove", block);
      document.removeEventListener("contextmenu", quiet);
      loose.current = false;
    };
  }, [held]);

  const remove = (id: string) =>
    change(
      placed.filter((tile) => tile.tile.id !== id),
      [...hidden, id],
    );
  /** The arrow keys move the tile with the focus a cell, as the pointer does; Delete takes it off. */
  const keyed = (tile: PlacedTile, event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    const step: Readonly<Record<string, Point>> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const by = step[event.key];
    if (by !== undefined) {
      event.preventDefault();
      change(moved(placed, tile.tile.id, tile.x + by.x, tile.y + by.y, columns));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(tile.tile.id);
    }
  };
  const done = () => {
    if (draft === null) {
      props.onDone();
      return;
    }
    void act(async () => {
      await props.onSave(draft);
      setDraft(null);
      props.onDone();
    });
  };
  const cancel = () => {
    setDraft(null);
    props.onDone();
  };

  const nameOfTile = (tile: HomeTile): string =>
    tile.kind === "project" ? tile.project.name : nameOf(tile.widget.name);
  // Moved in the page, a frame would load again: the tiles keep the order they came in for as
  // long as the page is open, and each stands where its style says.
  const order = useRef<readonly string[]>(NONE);
  const inOrder = [...shown].sort((a, b) => a.y - b.y || a.x - b.x).map((tile) => tile.tile.id);
  order.current = [
    ...order.current.filter((id) => inOrder.includes(id)),
    ...inOrder.filter((id) => !order.current.includes(id)),
  ];
  const standing = [...shown].sort(
    (a, b) => order.current.indexOf(a.tile.id) - order.current.indexOf(b.tile.id),
  );
  const out = editing
    ? tiles.filter((tile) => !shown.some((candidate) => candidate.tile.id === tile.id))
    : [];
  const slot = dragging === null ? undefined : shown.find((tile) => tile.tile.id === dragging.id);
  const rows = rowsOf(shown, columns) + (editing ? SPARE_ROWS : 0);
  return (
    <div
      ref={page}
      className={cx("sc-home", editing && "sc-home-editing", dragging !== null && "sc-home-held")}
    >
      {editing && (
        <div className="sc-home-bar">
          <p className="sc-home-hint">{words.hint}</p>
          <div className="sc-home-bar-actions">
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>
              {allWords.common.cancel}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={done}>
              {words.done}
            </Button>
          </div>
        </div>
      )}
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {out.length > 0 && (
        <div className="sc-home-tray">
          <span className="sc-field-label">{words.add}</span>
          {out.map((tile) => (
            <button
              key={tile.id}
              type="button"
              className="sc-home-add"
              onClick={() =>
                change(
                  added(placed, tile, columns),
                  hidden.filter((id) => id !== tile.id),
                )
              }
            >
              + {nameOfTile(tile)}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 && !editing && (props.empty ?? null)}
      <ul
        ref={grid}
        className="sc-home-grid"
        aria-label={allWords.projects.list}
        data-columns={columns}
        hidden={shown.length === 0 && !editing}
        style={
          {
            "--sc-home-columns": columns,
            "--sc-home-rows": Math.max(rows, 1),
          } as CSSProperties
        }
      >
        {standing.map((tile) => {
          const { w, h } = footprintOf(tile.size, columns);
          const inHand = dragging?.id === tile.tile.id ? dragging : undefined;
          const name = nameOfTile(tile.tile);
          return (
            <li
              key={tile.tile.id}
              className={cx("sc-tile", inHand !== undefined && "sc-tile-held")}
              data-tile={tile.tile.id}
              style={
                {
                  "--sc-tile-x": tile.x,
                  "--sc-tile-y": tile.y,
                  "--sc-tile-w": w,
                  "--sc-tile-h": h,
                  ...(inHand === undefined
                    ? {}
                    : {
                        "--sc-tile-left": `${inHand.left}px`,
                        "--sc-tile-top": `${inHand.top}px`,
                      }),
                } as CSSProperties
              }
              tabIndex={editing ? 0 : undefined}
              aria-label={editing ? name : undefined}
              onPointerDown={editing ? (event) => press(tile, event) : undefined}
              onKeyDown={editing ? (event) => keyed(tile, event) : undefined}
            >
              {tile.tile.kind === "project" ? (
                <ProjectTile
                  project={tile.tile.project}
                  size={tile.size}
                  href={editing ? undefined : props.projectHref(tile.tile.project)}
                  onOpen={props.onOpen}
                />
              ) : (
                <article className="sc-tile-pane sc-tile-widget">
                  <h2 className="sc-tile-title">{name}</h2>
                  {props.renderWidget(tile.tile, tile.size as PluginWidgetSizeName)}
                </article>
              )}
              {editing && (
                <>
                  <button
                    type="button"
                    className="sc-tile-remove"
                    aria-label={`${words.remove}: ${name}`}
                    title={words.remove}
                    onClick={() => remove(tile.tile.id)}
                  >
                    ×
                  </button>
                  {sizesAt(tile.tile, columns).length > 1 && (
                    <SizeChoice
                      tile={tile}
                      sizes={sizesAt(tile.tile, columns)}
                      onChoose={(size) => change(resized(placed, tile.tile.id, size, columns))}
                    />
                  )}
                </>
              )}
            </li>
          );
        })}
        {slot !== undefined && (
          <li
            className="sc-tile sc-tile-slot"
            aria-hidden="true"
            style={
              {
                "--sc-tile-x": slot.x,
                "--sc-tile-y": slot.y,
                "--sc-tile-w": footprintOf(slot.size, columns).w,
                "--sc-tile-h": footprintOf(slot.size, columns).h,
              } as CSSProperties
            }
          />
        )}
      </ul>
    </div>
  );
}
