import { MAX_HOME_ROW, MAX_HOME_TILES } from "./limits.js";
import type { PluginWidgetSizeName } from "./plugin/bridge.js";
import { PLUGIN_WIDGET_SIZE_CELLS, widgetSizesOf } from "./plugin/manifest.js";
import type {
  RestHome,
  RestHomeTile,
  RestPlugin,
  RestPluginWidget,
  RestProject,
} from "./schemas.js";

// The front page as a person arranges it (ADR-0061): one grid of square cells, on which the
// projects and the plugins' widgets are tiles alike, each at a place of its own. What there is
// comes from what the person may see; where each stands comes from what they kept, one layout
// for each width of the grid. Someone who has arranged nothing sees the page composed edge to
// edge, and a width nobody arranged when another was is closed up from the sizes the tiles come
// in (ADR-0082); on one they arranged, what is new takes the first room. What they took off stays
// off, and what they may no longer see waits out of sight for its place. Pure functions, so that the
// page and the tests read the same arrangement.

/** The grid's columns at each width: wide, a laptop's, a tablet's, a phone's. */
export const HOME_COLUMNS = [12, 8, 6, 4] as const;
export type HomeColumns = (typeof HOME_COLUMNS)[number];

/** The width in pixels from which the grid has so many columns, so that a cell stays of a size to read. */
const COLUMNS_FROM: readonly (readonly [number, HomeColumns])[] = [
  [1520, 12],
  [900, 8],
  [560, 6],
];

/** The columns of the grid at a width in pixels. */
export function columnsFor(width: number): HomeColumns {
  return COLUMNS_FROM.find(([from]) => width >= from)?.[1] ?? 4;
}

export type HomeTileSize = RestHomeTile["size"];

/** The cells a tile takes at each size: an icon one, the widgets' family as the phones have it. */
export const HOME_TILE_CELLS: Readonly<
  Record<HomeTileSize, { readonly columns: number; readonly rows: number }>
> = { icon: { columns: 1, rows: 1 }, ...PLUGIN_WIDGET_SIZE_CELLS };

/** A project on the page: an icon, or a card with what it is. */
export interface HomeProjectTile {
  readonly kind: "project";
  readonly id: string;
  readonly project: RestProject;
  readonly sizes: readonly HomeTileSize[];
  readonly defaultSize: HomeTileSize;
}

/** A plugin's widget on the page. */
export interface HomeWidgetTile {
  readonly kind: "widget";
  readonly id: string;
  readonly plugin: RestPlugin;
  readonly widget: RestPluginWidget;
  readonly sizes: readonly PluginWidgetSizeName[];
  readonly defaultSize: PluginWidgetSizeName;
}

export type HomeTile = HomeProjectTile | HomeWidgetTile;

/** A tile where it stands. */
export interface PlacedTile {
  readonly tile: HomeTile;
  readonly x: number;
  readonly y: number;
  readonly size: HomeTileSize;
}

/**
 * A project comes as an icon, a card, and at a glance of its board in three shapes (ADR-0105):
 * `medium` 4×2, `large` 4×4 and `wide` 8×2. Not `full`: at 8×4 a glance had more room than it
 * has things to say.
 */
const PROJECT_SIZES: readonly HomeTileSize[] = ["icon", "small", "medium", "large", "wide"];
/** The sizes the projects take together where a width is closed up: the small ones a person kept them at before a glance existed. */
const PROJECT_ALIKE_SIZES: readonly HomeTileSize[] = ["icon", "small"];

/** Whether a project at a size shows a glance of its board: what is at work in it, and its roadmap (ADR-0105). */
export function isGlanceSize(size: HomeTileSize): boolean {
  return size === "medium" || size === "large" || size === "wide";
}

/**
 * The heights a glance is laid out with, in rem, which its stylesheet gives the same parts: a
 * list's heading, a task's row, a goal's row of two lines, the line that says how many more, and
 * the room between two lists, a hairline in it.
 */
export const GLANCE_REM = { heading: 1.5, task: 2.25, goal: 3, more: 1.5, between: 1.5 } as const;

/** The room a glance's lists are taken to have before it is laid out, in rem, by the size of the tile. */
export const GLANCE_ROOM_GUESS: Partial<Record<HomeTileSize, number>> = {
  medium: 6,
  large: 20,
  wide: 12,
};

/** A list of a glance: the rows it could show, how many there are in all, and the height of a row, in rem. */
export interface GlanceList {
  readonly rows: number;
  readonly total: number;
  readonly row: number;
}

/** The height a list takes with so many rows shown: nothing with none, the line of how many more while some are left out. */
function listHeight(shown: number, list: GlanceList): number {
  return shown === 0
    ? 0
    : GLANCE_REM.heading + shown * list.row + (shown < list.total ? GLANCE_REM.more : 0);
}

/**
 * The rows of a glance's lists, one under the other, that a room holds, each row whole (ADR-0105):
 * the steps give rows in turn, each step a list and the rows it may have by then, so that the
 * lists that matter most are seen first and the others as the room allows. A list with no rows to
 * show takes no room.
 */
export function glanceFit(
  room: number,
  lists: readonly GlanceList[],
  steps: readonly (readonly [number, number])[],
): number[] {
  const shown = lists.map(() => 0);
  const height = (counts: readonly number[]): number => {
    const used = lists.map((list, at) => listHeight(counts[at] ?? 0, list));
    const showing = used.filter((value) => value > 0).length;
    return (
      used.reduce((sum, value) => sum + value, 0) + Math.max(0, showing - 1) * GLANCE_REM.between
    );
  };
  for (const [at, upTo] of steps) {
    const list = lists[at];
    if (list === undefined) {
      continue;
    }
    const limit = Math.min(upTo, list.rows);
    while ((shown[at] ?? 0) < limit) {
      const next = shown.map((count, index) => (index === at ? count + 1 : count));
      if (height(next) > room) {
        break;
      }
      shown[at] = (shown[at] ?? 0) + 1;
    }
  }
  return shown;
}

/**
 * Every tile the person may see: the widgets of the plugins that are on, which they hold a role
 * for, and the projects, those a manifest places at the top first and those at the bottom last.
 * An administrator reads every plugin installed, and one that is off has no frame to show.
 */
export function homeTiles(
  plugins: readonly RestPlugin[],
  projects: readonly RestProject[],
): HomeTile[] {
  const widgets = plugins
    .filter((plugin) => plugin.state === "enabled")
    .flatMap((plugin) =>
      plugin.widgets.map((widget): HomeWidgetTile => {
        const { sizes, defaultSize } = widgetSizesOf(widget);
        return {
          kind: "widget",
          id: `widget:${plugin.key}:${widget.key}`,
          plugin,
          widget,
          sizes,
          defaultSize,
        };
      }),
    );
  return [
    ...widgets.filter((tile) => tile.widget.place === "home:top"),
    ...projects.map(
      (project): HomeProjectTile => ({
        kind: "project",
        id: `project:${project.id}`,
        project,
        sizes: PROJECT_SIZES,
        defaultSize: "icon",
      }),
    ),
    ...widgets.filter((tile) => tile.widget.place !== "home:top"),
  ];
}

interface Footprint {
  readonly w: number;
  readonly h: number;
}

interface Place {
  readonly x: number;
  readonly y: number;
}

/**
 * The sizes a tile may have on a grid of so many columns: those that fit it. A widget always has
 * one (ADR-0062); only a console older than the rule can answer one that has none, and then it
 * keeps what it has, drawn as wide as the grid.
 */
export function sizesAt(tile: HomeTile, columns: number): readonly HomeTileSize[] {
  const fitting = (tile.sizes as readonly HomeTileSize[]).filter(
    (size) => HOME_TILE_CELLS[size].columns <= columns,
  );
  return fitting.length > 0 ? fitting : tile.sizes;
}

/** The size a tile starts at on a grid of so many columns: its own where that fits, else the largest that does. */
export function startingSizeAt(tile: HomeTile, columns: number): HomeTileSize {
  const fitting = sizesAt(tile, columns);
  if (fitting.includes(tile.defaultSize)) {
    return tile.defaultSize;
  }
  const area = (size: HomeTileSize) => HOME_TILE_CELLS[size].columns * HOME_TILE_CELLS[size].rows;
  return [...fitting].sort((a, b) => area(b) - area(a))[0] ?? tile.defaultSize;
}

/** The cells a size takes on a grid of so many columns: never wider than the grid. */
export function footprintOf(size: HomeTileSize, columns: number): Footprint {
  const cells = HOME_TILE_CELLS[size];
  return { w: Math.min(cells.columns, columns), h: cells.rows };
}

const inReadingOrder = <T extends Place>(tiles: readonly T[]): T[] =>
  [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);

/** The cells taken, each as one number. */
function occupied(placed: readonly PlacedTile[], columns: number): Set<number> {
  const taken = new Set<number>();
  for (const tile of placed) {
    occupy(taken, tile, footprintOf(tile.size, columns), columns);
  }
  return taken;
}

function occupy(taken: Set<number>, place: Place, shape: Footprint, columns: number): void {
  for (let row = 0; row < shape.h; row += 1) {
    for (let column = 0; column < shape.w; column += 1) {
      taken.add((place.y + row) * columns + place.x + column);
    }
  }
}

function fits(
  taken: ReadonlySet<number>,
  place: Place,
  shape: Footprint,
  columns: number,
): boolean {
  if (place.x < 0 || place.y < 0 || place.x + shape.w > columns) {
    return false;
  }
  for (let row = 0; row < shape.h; row += 1) {
    for (let column = 0; column < shape.w; column += 1) {
      if (taken.has((place.y + row) * columns + place.x + column)) {
        return false;
      }
    }
  }
  return true;
}

/** The first room for the shape, reading the grid from the top. Below everything there is always some. */
function firstRoom(taken: ReadonlySet<number>, shape: Footprint, columns: number): Place {
  for (let y = 0; ; y += 1) {
    for (let x = 0; x + shape.w <= columns; x += 1) {
      if (fits(taken, { x, y }, shape, columns)) {
        return { x, y };
      }
    }
  }
}

/** The room for the shape nearest a place. */
function nearestRoom(
  taken: ReadonlySet<number>,
  shape: Footprint,
  near: Place,
  columns: number,
): Place {
  const bottom = Math.max(0, ...[...taken].map((cell) => Math.floor(cell / columns) + 1));
  let best = firstRoom(taken, shape, columns);
  let distance = (best.x - near.x) ** 2 + (best.y - near.y) ** 2;
  for (let y = 0; y <= Math.max(bottom, near.y); y += 1) {
    for (let x = 0; x + shape.w <= columns; x += 1) {
      const away = (x - near.x) ** 2 + (y - near.y) ** 2;
      if (away < distance && fits(taken, { x, y }, shape, columns)) {
        best = { x, y };
        distance = away;
      }
    }
  }
  return best;
}

/** What a layout starts from at a width: what was kept for it, or the same order from another. */
function keptAt(
  home: RestHome | null | undefined,
  columns: HomeColumns,
): { readonly entries: readonly RestHomeTile[]; readonly placed: boolean } {
  const own = home?.layouts[columns];
  if (own !== undefined) {
    return { entries: own, placed: true };
  }
  for (const other of HOME_COLUMNS) {
    const entries = home?.layouts[other];
    if (entries !== undefined) {
      return { entries: inReadingOrder(entries), placed: false };
    }
  }
  return { entries: [], placed: false };
}

/** A tile waiting for a place on a width nobody arranged, and the size it would rather have. */
interface Wanted {
  readonly tile: HomeTile;
  readonly size: HomeTileSize;
}

/** The size combinations tried at most, so that a page of many widgets is still laid out at once. */
const MOST_COMBINATIONS = 4096;

/** Whether one score comes before another, read from its first number. */
function lessThan(score: readonly number[], than: readonly number[]): boolean {
  const at = score.findIndex((value, index) => value !== than[index]);
  return at >= 0 && (score[at] ?? 0) < (than[at] ?? 0);
}

/** The tiles in order, each at its size, at the first room reading from the top. */
function packed(
  wanted: readonly Wanted[],
  sizes: readonly HomeTileSize[],
  columns: number,
): PlacedTile[] {
  const taken = new Set<number>();
  return wanted.map(({ tile }, at) => {
    const size = sizes[at] ?? startingSizeAt(tile, columns);
    const shape = footprintOf(size, columns);
    const place = firstRoom(taken, shape, columns);
    occupy(taken, place, shape, columns);
    return { tile, size, ...place };
  });
}

/**
 * A width nobody arranged, closed up (ADR-0082): the same order, each tile at one of the sizes it
 * comes in here, chosen so that the fewest cells stand empty within the page, then so that the
 * fewest tiles leave the size they would rather have, then so that the page is the shortest. The
 * projects take one size together, so that they line up as a row of the same tiles; a widget
 * takes any of its own. A page that cannot close leaves the fewest cells empty it can.
 */
function closedUp(wanted: readonly Wanted[], columns: number): PlacedTile[] {
  const projects = wanted.flatMap((entry, at) => (entry.tile.kind === "project" ? [at] : []));
  // The choices: for each widget its sizes, the one it would rather have first; for the projects
  // together, each its own, then each of the sizes a project comes in, all alike.
  const choices: { readonly at: readonly number[]; readonly options: HomeTileSize[][] }[] = [];
  if (projects.length > 0) {
    const own = projects.map((at) => wanted[at]?.size ?? "icon");
    const alike = PROJECT_ALIKE_SIZES.filter(
      (size) => HOME_TILE_CELLS[size].columns <= columns,
    ).map((size) => projects.map(() => size));
    const options = [own, ...alike].filter(
      (option, index, all) => all.findIndex((other) => other.join() === option.join()) === index,
    );
    choices.push({ at: projects, options });
  }
  let combinations = choices[0]?.options.length ?? 1;
  wanted.forEach((entry, at) => {
    if (entry.tile.kind !== "widget") {
      return;
    }
    const others = sizesAt(entry.tile, columns).filter((size) => size !== entry.size);
    const all = [entry.size, ...others];
    // Past what can be tried at once, a widget keeps the size it would rather have.
    const options = combinations * all.length <= MOST_COMBINATIONS ? all : [entry.size];
    combinations *= options.length;
    choices.push({ at: [at], options: options.map((size) => [size]) });
  });

  const preferred = wanted.map((entry) => entry.size);
  let best: { readonly placed: PlacedTile[]; readonly score: readonly number[] } | undefined;
  const trying = (index: number, sizes: HomeTileSize[], changed: number): void => {
    const choice = choices[index];
    if (choice === undefined) {
      const placed = packed(wanted, sizes, columns);
      const rows = rowsOf(placed, columns);
      const filled = placed.reduce((cells, { size }) => {
        const { w, h } = footprintOf(size, columns);
        return cells + w * h;
      }, 0);
      const score = [rows * columns - filled, changed, rows];
      if (best === undefined || lessThan(score, best.score)) {
        best = { placed, score };
      }
      return;
    }
    choice.options.forEach((option) => {
      const next = [...sizes];
      choice.at.forEach((at, nth) => {
        next[at] = option[nth] ?? (preferred[at] as HomeTileSize);
      });
      const differs = choice.at.some((at) => next[at] !== preferred[at]) ? 1 : 0;
      trying(index + 1, next, changed + differs);
    });
  };
  trying(0, [...preferred], 0);
  return best?.placed ?? packed(wanted, preferred, columns);
}

/**
 * The page as it stands on the grid: what the person kept for this width where they stand; for
 * someone who has arranged nothing, the composed page on the cells nearest it; for a width nobody
 * arranged when another was, the order kept there, closed up so that no cell stands empty where
 * the sizes the tiles come in allow it (ADR-0082). A tile they may no longer
 * see stays out, a size it no longer comes in, or that is too wide for this grid, becomes the one
 * it starts at here, and a tile on another's cells moves to the nearest room. What they have not
 * seen yet takes the first room of a width they arranged, a plugin's widgets as soon as it is on;
 * what they took off stays off.
 */
export function arranged(
  tiles: readonly HomeTile[],
  home: RestHome | null | undefined,
  columns: HomeColumns,
): PlacedTile[] {
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  const hidden = new Set(home?.hidden ?? []);
  const { entries, placed: keepsPlaces } = keptAt(home, columns);
  if (nobodyArranged(home)) {
    // Arranging starts from the page as it was composed, each widget on the cells nearest it, the
    // projects one to a cell from the corner of theirs, in their order.
    const boxes = composed(tiles, home, columns);
    const projects = boxes.filter(({ tile }) => tile.kind === "project");
    const left = Math.round(Math.min(...projects.map((box) => box.x)));
    const top = Math.round(Math.min(...projects.map((box) => box.y)));
    const across = Math.max(
      1,
      Math.round(Math.max(...projects.map((box) => box.x + box.w))) - left,
    );
    const taken = new Set<number>();
    return boxes.map(({ tile, size, x, y }) => {
      const shape = footprintOf(size, columns);
      const nth = projects.findIndex((box) => box.tile.id === tile.id);
      const near =
        nth < 0
          ? { x: Math.round(x), y: Math.round(y) }
          : { x: left + (nth % across), y: top + Math.floor(nth / across) };
      const place = fits(taken, near, shape, columns)
        ? near
        : nearestRoom(taken, shape, near, columns);
      occupy(taken, place, shape, columns);
      return { tile, size, ...place };
    });
  }
  if (!keepsPlaces) {
    const wanted: Wanted[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const tile = byId.get(entry.tile);
      if (tile !== undefined && !hidden.has(tile.id) && !seen.has(tile.id)) {
        const size = sizesAt(tile, columns).includes(entry.size)
          ? entry.size
          : startingSizeAt(tile, columns);
        wanted.push({ tile, size });
        seen.add(tile.id);
      }
    }
    for (const tile of tiles) {
      if (!hidden.has(tile.id) && !seen.has(tile.id)) {
        wanted.push({ tile, size: startingSizeAt(tile, columns) });
      }
    }
    return closedUp(wanted, columns);
  }
  const taken = new Set<number>();
  const placed: PlacedTile[] = [];
  const seen = new Set<string>();
  const put = (tile: HomeTile, size: HomeTileSize, wanted: Place | undefined) => {
    const shape = footprintOf(size, columns);
    const place =
      wanted === undefined
        ? firstRoom(taken, shape, columns)
        : fits(taken, wanted, shape, columns)
          ? wanted
          : nearestRoom(taken, shape, wanted, columns);
    occupy(taken, place, shape, columns);
    placed.push({ tile, size, ...place });
    seen.add(tile.id);
  };
  for (const entry of entries) {
    const tile = byId.get(entry.tile);
    if (tile !== undefined && !hidden.has(tile.id) && !seen.has(tile.id)) {
      const size = sizesAt(tile, columns).includes(entry.size)
        ? entry.size
        : startingSizeAt(tile, columns);
      put(tile, size, { x: entry.x, y: entry.y });
    }
  }
  for (const tile of tiles) {
    if (!hidden.has(tile.id) && !seen.has(tile.id)) {
      put(tile, startingSizeAt(tile, columns), undefined);
    }
  }
  return placed;
}

/** How many rows the page takes. */
export function rowsOf(placed: readonly PlacedTile[], columns: number): number {
  return Math.max(0, ...placed.map((tile) => tile.y + footprintOf(tile.size, columns).h));
}

/** Whether the person has arranged no width of the page, whatever they took off it. */
export function nobodyArranged(home: RestHome | null | undefined): boolean {
  return home === null || home === undefined || Object.keys(home.layouts).length === 0;
}

/**
 * A tile of the composed page: where it stands and how far it reaches, in cells, which need not
 * be whole, and the size its frame is told, the one of its own nearest that shape.
 */
export interface ComposedTile extends PlacedTile {
  readonly w: number;
  readonly h: number;
}

/** The rows a widget beside the lead takes, and those the lead takes at least. */
const SIDE_ROWS = 2;
const LEAD_ROWS = 4;
/** The widgets that stand beside the lead at most; the others stand below, two to a row. */
const MOST_BESIDE = 2;
/** The rows of projects the column beside the lead holds at most; more go below, across the page. */
const MOST_PROJECT_ROWS_BESIDE = 2;

/**
 * Of the sizes a tile comes in on this grid, the one nearest a shape; on a tie the one that fits
 * within it, so that a frame is never told of more room than it has, then its own, then the smaller.
 */
function nearestSize(tile: HomeTile, w: number, h: number, columns: number): HomeTileSize {
  if (tile.kind === "project") {
    return "icon";
  }
  const away = (size: HomeTileSize) => {
    const cells = footprintOf(size, columns);
    return Math.abs(cells.w - w) + Math.abs(cells.h - h);
  };
  const within = (size: HomeTileSize) => {
    const cells = footprintOf(size, columns);
    return cells.w <= w && cells.h <= h;
  };
  const area = (size: HomeTileSize) => HOME_TILE_CELLS[size].columns * HOME_TILE_CELLS[size].rows;
  return [...sizesAt(tile, columns)].sort(
    (a, b) =>
      away(a) - away(b) ||
      Number(within(b)) - Number(within(a)) ||
      Number(b === tile.defaultSize) - Number(a === tile.defaultSize) ||
      area(a) - area(b),
  )[0] as HomeTileSize;
}

/**
 * The page of someone who has arranged nothing, composed (ADR-0082): the first widget leads,
 * half the page wide, and beside it stand the next two widgets and the projects, the column as
 * high as the lead; on a grid of six columns or fewer they stand one under the other. The projects
 * are icons in rows of as many as are alike, each row as wide as its column, so that no row ends
 * short; the other widgets stand below, two to a row. Every edge meets another or the page's.
 */
export function composed(
  tiles: readonly HomeTile[],
  home: RestHome | null | undefined,
  columns: HomeColumns,
): ComposedTile[] {
  const hidden = new Set(home?.hidden ?? []);
  const shown = tiles.filter((tile) => !hidden.has(tile.id));
  const widgets = shown.filter((tile): tile is HomeWidgetTile => tile.kind === "widget");
  const top = widgets.filter((tile) => tile.widget.place === "home:top");
  const bottom = widgets.filter((tile) => tile.widget.place !== "home:top");
  const projects = shown.filter((tile) => tile.kind === "project");
  const boxes: ComposedTile[] = [];
  const put = (tile: HomeTile, x: number, y: number, w: number, h: number) => {
    boxes.push({ tile, size: nearestSize(tile, w, h, columns), x, y, w, h });
  };
  /** The rows the projects take in a column so wide: as many to a row as a cell each allows. */
  const projectRows = (width: number) =>
    projects.length === 0 ? 0 : Math.ceil(projects.length / Math.max(1, Math.floor(width)));
  /** The projects in rows from a place, as many in each as alike, each row filling the width. */
  const putProjects = (x: number, y: number, width: number): number => {
    const rows = projectRows(width);
    let next = 0;
    for (let row = 0; row < rows; row += 1) {
      const count = Math.floor(projects.length / rows) + (row < projects.length % rows ? 1 : 0);
      for (let at = 0; at < count; at += 1) {
        const tile = projects[next];
        if (tile !== undefined) {
          put(tile, x + (at * width) / count, y + row, width / count, 1);
        }
        next += 1;
      }
    }
    return rows;
  };
  /** Widgets two to a row across the page, one alone as wide as the page. */
  const putInPairs = (list: readonly HomeTile[], from: number): number => {
    let y = from;
    for (let at = 0; at < list.length; at += 2) {
      const first = list[at];
      const second = list[at + 1];
      if (first !== undefined && second !== undefined) {
        put(first, 0, y, columns / 2, SIDE_ROWS);
        put(second, columns / 2, y, columns / 2, SIDE_ROWS);
      } else if (first !== undefined) {
        put(first, 0, y, columns, SIDE_ROWS);
      }
      y += SIDE_ROWS;
    }
    return y;
  };

  const [lead, ...others] = top;
  const beside = others.slice(0, MOST_BESIDE);
  let y = 0;
  if (lead !== undefined && beside.length > 0 && columns >= 8) {
    const half = columns / 2;
    const projectsBeside = projectRows(half) <= MOST_PROJECT_ROWS_BESIDE;
    const besideRows = beside.length * SIDE_ROWS + (projectsBeside ? projectRows(half) : 0);
    const height = Math.max(besideRows, LEAD_ROWS);
    // A column shorter than the lead gives its widgets the rows left over, alike.
    const widgetRows = SIDE_ROWS + (height - besideRows) / beside.length;
    put(lead, 0, 0, half, height);
    let at = 0;
    for (const tile of beside) {
      put(tile, half, at, half, widgetRows);
      at += widgetRows;
    }
    if (projectsBeside) {
      putProjects(half, at, half);
    }
    y = height;
    if (!projectsBeside) {
      y += putProjects(0, y, columns);
    }
    y = putInPairs([...others.slice(MOST_BESIDE), ...bottom], y);
  } else {
    if (lead !== undefined) {
      put(lead, 0, 0, columns, LEAD_ROWS);
      y = LEAD_ROWS;
    }
    y = putInPairs(others, y);
    y += putProjects(0, y, columns);
    putInPairs(bottom, y);
  }
  return boxes;
}

/** How many rows the composed page takes, which need not be whole. */
export function composedRows(boxes: readonly ComposedTile[]): number {
  return Math.max(0, ...boxes.map((box) => box.y + box.h));
}

const sameTile = (a: PlacedTile, b: PlacedTile): boolean => a.tile.id === b.tile.id;

const overlapping = (a: PlacedTile, b: PlacedTile, columns: number): boolean => {
  const shapeA = footprintOf(a.size, columns);
  const shapeB = footprintOf(b.size, columns);
  return (
    a.x < b.x + shapeB.w && b.x < a.x + shapeA.w && a.y < b.y + shapeB.h && b.y < a.y + shapeA.h
  );
};

/** The tile where it is to stand, and those on its cells moved to the nearest room. */
function makingRoom(
  others: readonly PlacedTile[],
  at: PlacedTile,
  columns: number,
): readonly PlacedTile[] {
  const inTheWay = others.filter((tile) => overlapping(tile, at, columns));
  const staying = [...others.filter((tile) => !overlapping(tile, at, columns)), at];
  const taken = occupied(staying, columns);
  const moved = inReadingOrder(inTheWay).map((tile) => {
    const shape = footprintOf(tile.size, columns);
    const place = nearestRoom(taken, shape, tile, columns);
    occupy(taken, place, shape, columns);
    return { ...tile, ...place };
  });
  return [...staying, ...moved];
}

/**
 * The page with a tile moved to a place, as a phone's home screen does it. Where the place is
 * free it stands there. On a tile of its own shape, the tiles of that shape between the two
 * places each move one place towards the one it left, so that a row of icons closes up. A smaller
 * tile gives way to the nearest room, and a larger one stays: the tile lands in the room beside it.
 */
export function moved(
  placed: readonly PlacedTile[],
  id: string,
  x: number,
  y: number,
  columns: number,
): readonly PlacedTile[] {
  const moving = placed.find((tile) => tile.tile.id === id);
  if (moving === undefined) {
    return placed;
  }
  const shape = footprintOf(moving.size, columns);
  const at: PlacedTile = {
    ...moving,
    x: Math.max(0, Math.min(x, columns - shape.w)),
    y: Math.max(0, Math.min(y, MAX_HOME_ROW)),
  };
  const others = placed.filter((tile) => !sameTile(tile, moving));
  const inTheWay = others.filter((tile) => overlapping(tile, at, columns));
  const [first] = inTheWay;
  if (first === undefined) {
    return [...others, at];
  }
  const shapeOf = (tile: PlacedTile) => footprintOf(tile.size, columns);
  const sameShape = (tile: PlacedTile) =>
    shapeOf(tile).w === shape.w && shapeOf(tile).h === shape.h;
  if (inTheWay.length === 1 && first.x === at.x && first.y === at.y && sameShape(first)) {
    const peers = inReadingOrder(placed.filter(sameShape));
    const places = peers.map(({ x: px, y: py }) => ({ x: px, y: py }));
    const order = peers.filter((tile) => !sameTile(tile, moving));
    order.splice(
      peers.findIndex((tile) => sameTile(tile, first)),
      0,
      moving,
    );
    return [
      ...placed.filter((tile) => !sameShape(tile)),
      ...order.map((tile, index) => ({ ...tile, ...places[index] })),
    ];
  }
  const area = (tile: PlacedTile) => shapeOf(tile).w * shapeOf(tile).h;
  if (inTheWay.some((tile) => area(tile) > area(moving))) {
    return [...others, { ...at, ...nearestRoom(occupied(others, columns), shape, at, columns) }];
  }
  return makingRoom(others, at, columns);
}

/** How far apart in time the tiles in the way move, by the cells between them, in milliseconds. */
const WAIT_PER_CELL_MS = 22;
const LONGEST_WAIT_MS = 130;

/**
 * How long a tile waits before it gives way to the tile being put down at `from`: the further off
 * the later, so that the push runs outward from there, as water does.
 */
export function waitToGiveWay(tile: Place, from: Place): number {
  const cells = Math.hypot(tile.x - from.x, tile.y - from.y);
  return Math.min(Math.round(cells * WAIT_PER_CELL_MS), LONGEST_WAIT_MS);
}

/** The page with a tile at another size, where it stands; what its new cells cover moves aside. */
export function resized(
  placed: readonly PlacedTile[],
  id: string,
  size: HomeTileSize,
  columns: number,
): readonly PlacedTile[] {
  const tile = placed.find((candidate) => candidate.tile.id === id);
  if (tile === undefined) {
    return placed;
  }
  const at = { ...tile, size, x: Math.min(tile.x, columns - footprintOf(size, columns).w) };
  return makingRoom(
    placed.filter((candidate) => !sameTile(candidate, tile)),
    at,
    columns,
  );
}

/** The page with a tile back on it, at the first room, at the size it starts at. */
export function added(
  placed: readonly PlacedTile[],
  tile: HomeTile,
  columns: number,
): readonly PlacedTile[] {
  const size = startingSizeAt(tile, columns);
  const room = firstRoom(occupied(placed, columns), footprintOf(size, columns), columns);
  return [...placed, { tile, size, ...room }];
}

/** What is kept of the page: the layout at this width, the others as they were. */
export function homeWith(
  home: RestHome | null | undefined,
  placed: readonly PlacedTile[],
  hidden: readonly string[],
  columns: HomeColumns,
): RestHome {
  const shown = new Set(placed.map((tile) => tile.tile.id));
  // What the person may not see for now keeps its place, for the day it is back.
  const away = (home?.layouts[columns] ?? []).filter(
    (entry) => !shown.has(entry.tile) && !hidden.includes(entry.tile),
  );
  const entries: RestHomeTile[] = inReadingOrder(placed).map(({ tile, x, y, size }) => ({
    tile: tile.id,
    x,
    y,
    size,
  }));
  return {
    hidden: hidden.slice(0, MAX_HOME_TILES),
    layouts: { ...home?.layouts, [columns]: [...entries, ...away].slice(0, MAX_HOME_TILES) },
  };
}
