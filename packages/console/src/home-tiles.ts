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
// for each width of the grid. What is new takes the first room, what they took off stays off,
// and what they may no longer see waits out of sight for its place. Pure functions, so that the
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

const PROJECT_SIZES: readonly HomeTileSize[] = ["icon", "small"];

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

/**
 * The page as it stands: what the person kept for this width where they stand, or, kept for
 * another width, the same order packed from the top; a tile they may no longer see stays out, a
 * size it no longer comes in, or that is too wide for this grid, becomes the one it starts at
 * here, and a tile on another's cells moves to the nearest room. What they have not seen yet takes the first room, a plugin's widgets as soon
 * as it is on; what they took off stays off.
 */
export function arranged(
  tiles: readonly HomeTile[],
  home: RestHome | null | undefined,
  columns: HomeColumns,
): PlacedTile[] {
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  const hidden = new Set(home?.hidden ?? []);
  const { entries, placed: keepsPlaces } = keptAt(home, columns);
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
      put(tile, size, keepsPlaces ? { x: entry.x, y: entry.y } : undefined);
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
