import { describe, expect, it } from "vitest";
import {
  added,
  arranged,
  COMPOSED_HOME,
  type ComposedTile,
  columnsFor,
  composed,
  composedRows,
  footprintOf,
  GLANCE_REM,
  glanceFit,
  glanceProjects,
  type HomeColumns,
  type HomeTile,
  type HomeTileSize,
  homeTiles,
  homeWith,
  isGlanceSize,
  moved,
  nobodyArranged,
  type PlacedTile,
  resized,
  rowsOf,
  sizesAt,
  standsComposed,
  startingSizeAt,
  waitToGiveWay,
} from "./home-tiles.js";
import type { RestHome, RestPlugin, RestProject } from "./schemas.js";

const plugin = (key: string, widgets: RestPlugin["widgets"], state = "enabled"): RestPlugin =>
  ({
    key,
    name: { en: key },
    description: { en: "" },
    agentNote: null,
    version: "1.0.0",
    state,
    problems: [],
    roles: [],
    declaredRoles: [],
    defaultRole: null,
    menu: null,
    pages: [],
    widgets,
    board: null,
    boardNeeds: "none",
    capabilities: [],
    consent: null,
    projects: null,
    requires: {},
    dataVersion: 1,
    enabledAt: null,
  }) as RestPlugin;

const project = (at: number): RestProject =>
  ({
    id: `0199c4d8-0000-7000-8000-00000000000${at}`,
    key: `p${at}`,
    name: `Project ${at}`,
  }) as RestProject;

const hr = plugin("hr", [
  {
    key: "balance",
    name: { en: "My leave" },
    place: "home:top",
    size: "third",
    sizes: ["small", "medium"],
    defaultSize: "small",
  },
  {
    key: "today",
    name: { en: "Out today" },
    place: "home:top",
    size: "half",
    sizes: ["medium", "large", "wide"],
    defaultSize: "medium",
  },
]);

/** A plugin of before, which names one size, and places its widget below the projects. */
const hello = plugin("hello", [
  { key: "latest", name: { en: "Latest" }, place: "home:bottom", size: "full" },
]);

const P1 = "project:0199c4d8-0000-7000-8000-000000000001";
const P2 = "project:0199c4d8-0000-7000-8000-000000000002";
const P3 = "project:0199c4d8-0000-7000-8000-000000000003";
const BALANCE = "widget:hr:balance";
const TODAY = "widget:hr:today";

/** Where each tile stands, by its id, for a test to read at a glance. */
const places = (placed: readonly PlacedTile[]) =>
  Object.fromEntries(placed.map(({ tile, x, y, size }) => [tile.id, [x, y, size]]));

/** Whether no two tiles share a cell, and each stands within the grid. */
function holdsTogether(placed: readonly PlacedTile[], columns: number): boolean {
  const cells = new Set<string>();
  for (const { x, y, size } of placed) {
    const { w, h } = footprintOf(size, columns);
    if (x < 0 || y < 0 || x + w > columns) {
      return false;
    }
    for (let row = y; row < y + h; row += 1) {
      for (let column = x; column < x + w; column += 1) {
        const cell = `${column},${row}`;
        if (cells.has(cell)) {
          return false;
        }
        cells.add(cell);
      }
    }
  }
  return true;
}

/** Where each composed tile stands and how far it reaches, to two places, and its size. */
const boxesOf = (boxes: readonly ComposedTile[]) =>
  Object.fromEntries(
    boxes.map(({ tile, x, y, w, h, size }) => [
      tile.id,
      [...[x, y, w, h].map((value) => Math.round(value * 100) / 100), size],
    ]),
  );

/**
 * Whether composed boxes cover the page whole, edge to edge, none over another, but for the cells
 * the projects' last row leaves at its end, each project on one whole cell (ADR-0108).
 */
function coversWhole(boxes: readonly ComposedTile[], columns: number): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const projects = boxes.filter(({ tile }) => tile.kind === "project");
  const oneCell = projects.every(
    ({ x, y, w, h }) => Number.isInteger(x) && Number.isInteger(y) && w === 1 && h === 1,
  );
  // The projects' column ends at the page's right edge, beside the lead or across the page.
  const [last] = [...projects].sort((a, b) => b.y - a.y || b.x - a.x);
  const short = last === undefined ? 0 : columns - (last.x + last.w);
  const area = boxes.reduce((sum, { w, h }) => sum + w * h, 0) + short;
  const apart = boxes.every((a, at) =>
    boxes
      .slice(at + 1)
      .every(
        (b) =>
          a.x + a.w <= b.x + 1e-9 ||
          b.x + b.w <= a.x + 1e-9 ||
          a.y + a.h <= b.y + 1e-9 ||
          b.y + b.h <= a.y + 1e-9,
      ),
  );
  const within = boxes.every(({ x, y, w }) => x >= -1e-9 && y >= -1e-9 && x + w <= columns + 1e-9);
  return oneCell && apart && within && near(area, columns * composedRows(boxes));
}

/** The cells left empty within the rows the page takes. */
const emptyCells = (placed: readonly PlacedTile[], columns: number): number =>
  rowsOf(placed, columns) * columns -
  placed.reduce((cells, { size }) => {
    const { w, h } = footprintOf(size, columns);
    return cells + w * h;
  }, 0);

const layout = (columns: HomeColumns, tiles: RestHome["layouts"][8]): RestHome => ({
  hidden: [],
  layouts: { [columns]: tiles },
});

describe("the front page's grid (ADR-0061)", () => {
  it("has as many columns as the width keeps a cell of a size to read", () => {
    expect(columnsFor(320)).toBe(4);
    expect(columnsFor(559)).toBe(4);
    expect(columnsFor(560)).toBe(6);
    expect(columnsFor(899)).toBe(6);
    expect(columnsFor(900)).toBe(8);
    expect(columnsFor(1519)).toBe(8);
    expect(columnsFor(1520)).toBe(12);
    expect(columnsFor(3840)).toBe(12);
  });

  it("gives every size its cells, and no tile more columns than there are", () => {
    expect(footprintOf("icon", 8)).toEqual({ w: 1, h: 1 });
    expect(footprintOf("small", 8)).toEqual({ w: 2, h: 2 });
    expect(footprintOf("medium", 8)).toEqual({ w: 4, h: 2 });
    expect(footprintOf("large", 8)).toEqual({ w: 4, h: 4 });
    expect(footprintOf("wide", 8)).toEqual({ w: 8, h: 2 });
    expect(footprintOf("full", 8)).toEqual({ w: 8, h: 4 });
    expect(footprintOf("full", 4)).toEqual({ w: 4, h: 4 });
    expect(footprintOf("wide", 6)).toEqual({ w: 6, h: 2 });
  });

  it("holds what the person may see: the widgets of the plugins that are on, and the projects", () => {
    const tiles = homeTiles([hr, hello], [project(1)]);
    expect(tiles.map((tile) => tile.id)).toEqual([BALANCE, TODAY, P1, "widget:hello:latest"]);
    // A project at a glance as well, never at the size a glance has more room than words for (ADR-0105).
    expect(tiles[2]?.sizes).toEqual(["icon", "small", "medium", "large", "wide"]);
    expect(tiles[2]?.defaultSize).toBe("icon");
    // The one size of before reads as one of the family.
    expect(tiles[3]?.sizes).toEqual(["medium", "wide"]);
    for (const state of ["installed", "disabled", "needs_consent", "failed"]) {
      expect(homeTiles([{ ...hr, state } as RestPlugin], [])).toEqual([]);
    }
  });

  it("composes the page of someone who has arranged nothing: the first widget leads, the next and the projects beside it, edge to edge (ADR-0082)", () => {
    const tiles = homeTiles([hr, hello], [project(1), project(2), project(3)]);
    const page = composed(tiles, null, 8);
    // The lead half the page wide; beside it the next widget, given the rows the column has
    // over, and the projects in a row, one to a cell; the widget of the bottom across.
    expect(boxesOf(page)).toEqual({
      [BALANCE]: [0, 0, 4, 4, "medium"],
      [TODAY]: [4, 0, 4, 3, "medium"],
      [P1]: [4, 3, 1, 1, "icon"],
      [P2]: [5, 3, 1, 1, "icon"],
      [P3]: [6, 3, 1, 1, "icon"],
      "widget:hello:latest": [0, 4, 8, 2, "wide"],
    });
    expect(composedRows(page)).toBe(6);
    expect(composedRows([])).toBe(0);
    // On six columns or fewer, one under the other, the lead at a size it comes in (ADR-0110).
    expect(boxesOf(composed(tiles, null, 4))).toEqual({
      [BALANCE]: [0, 0, 4, 2, "medium"],
      [TODAY]: [0, 2, 4, 2, "medium"],
      [P1]: [0, 4, 1, 1, "icon"],
      [P2]: [1, 4, 1, 1, "icon"],
      [P3]: [2, 4, 1, 1, "icon"],
      "widget:hello:latest": [0, 5, 4, 2, "medium"],
    });
    // At every width the boxes cover the page whole, none over another, but for the end of the
    // projects' row, each frame told a size its widget comes in there.
    for (const columns of [12, 8, 6, 4] as const) {
      const boxes = composed(tiles, null, columns);
      expect(coversWhole(boxes, columns)).toBe(true);
      for (const { tile, size } of boxes) {
        expect(tile.kind === "project" ? ["icon"] : sizesAt(tile, columns)).toContain(size);
      }
    }
    // What the person took off stays off: the lead left alone, the projects beside it.
    const without = composed(tiles, { hidden: [TODAY], layouts: {} }, 8);
    expect(boxesOf(without)).toEqual({
      [BALANCE]: [0, 0, 4, 2, "medium"],
      [P1]: [4, 0, 1, 1, "icon"],
      [P2]: [5, 0, 1, 1, "icon"],
      [P3]: [6, 0, 1, 1, "icon"],
      "widget:hello:latest": [0, 2, 8, 2, "wide"],
    });
    expect(nobodyArranged({ hidden: [TODAY], layouts: {} })).toBe(true);
    expect(nobodyArranged(layout(8, []))).toBe(false);
  });

  it("draws a project of the composed page on one cell, whatever room its row has, as when a plugin's widgets are gone (ADR-0108)", () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map(project);
    // A plugin that failed, on a console it was not built for, has no widget to show.
    const tiles = homeTiles([{ ...hr, state: "failed" } as RestPlugin], seven);
    expect(tiles.every((tile) => tile.kind === "project")).toBe(true);
    const cells = (boxes: readonly ComposedTile[]) =>
      boxes.map(({ x, y, w, h, size }) => [x, y, w, h, size]);
    // Twelve columns hold the seven in one row, each an icon's one cell, not twelve sevenths.
    expect(cells(composed(tiles, null, 12))).toEqual(seven.map((_, at) => [at, 0, 1, 1, "icon"]));
    // On a phone, rows of four, the last ending short.
    expect(cells(composed(tiles, null, 4))).toEqual(
      seven.map((_, at) => [at % 4, Math.floor(at / 4), 1, 1, "icon"]),
    );
    // One project alone is one cell, never a bar across the page.
    expect(boxesOf(composed(homeTiles([], [project(1)]), null, 12))).toEqual({
      [P1]: [0, 0, 1, 1, "icon"],
    });
    // Arranging starts from the very cells the page showed.
    for (const columns of [12, 8, 6, 4] as const) {
      const shown = composed(tiles, null, columns);
      expect(places(arranged(tiles, null, columns))).toEqual(places(shown));
      expect(coversWhole(shown, columns)).toBe(true);
    }
  });

  it("draws a widget that leads with nothing beside it at a size it comes in, the projects in the cells it leaves (ADR-0110)", () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map(project);
    const solo = plugin("solo", [
      {
        key: "latest",
        name: { en: "Latest" },
        place: "home:top",
        size: "third",
        sizes: ["small", "medium"],
        defaultSize: "small",
      },
    ]);
    const tiles = homeTiles([solo], seven);
    const cells = (columns: HomeColumns) =>
      composed(tiles, null, columns).map(({ x, y, w, h, size }) => [x, y, w, h, size]);
    const icons = (...at: (readonly [number, number])[]) =>
      at.map(([x, y]) => [x, y, 1, 1, "icon"]);
    // Its own medium, four cells by two, not the page's width and four rows; the projects beside
    // it, in rows as long as the columns it leaves, then across the page below it.
    expect(cells(12)).toEqual([
      [0, 0, 4, 2, "medium"],
      ...icons([4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0]),
    ]);
    expect(cells(8)).toEqual([
      [0, 0, 4, 2, "medium"],
      ...icons([4, 0], [5, 0], [6, 0], [7, 0], [4, 1], [5, 1], [6, 1]),
    ]);
    expect(cells(6)).toEqual([
      [0, 0, 4, 2, "medium"],
      ...icons([4, 0], [5, 0], [4, 1], [5, 1], [0, 2], [1, 2], [2, 2]),
    ]);
    // As wide as a phone, nothing beside it: the projects below.
    expect(cells(4)).toEqual([
      [0, 0, 4, 2, "medium"],
      ...icons([0, 2], [1, 2], [2, 2], [3, 2], [0, 3], [1, 3], [2, 3]),
    ]);
    // A lead that comes wider takes the size nearest the page's width.
    const announcements = plugin("news", [
      {
        key: "board",
        name: { en: "Announcements" },
        place: "home:top",
        size: "half",
        sizes: ["small", "medium", "large", "wide"],
        defaultSize: "large",
      },
    ]);
    expect(composed(homeTiles([announcements], seven), null, 12)[0]).toMatchObject({
      x: 0,
      y: 0,
      w: 8,
      h: 2,
      size: "wide",
    });
    // Arranging starts from the very same cells, and the page and its arranging do not differ.
    for (const columns of [12, 8, 6, 4] as const) {
      expect(places(arranged(tiles, null, columns))).toEqual(
        places(composed(tiles, null, columns)),
      );
      for (const { tile, w, h, size } of composed(tiles, null, columns)) {
        expect(footprintOf(size, columns)).toEqual({ w, h });
        expect(tile.kind === "project" ? ["icon"] : sizesAt(tile, columns)).toContain(size);
      }
    }
  });

  it("puts the page back as composed: no width arranged, nothing taken off (ADR-0109)", () => {
    const tiles = homeTiles([hr, hello], [project(1), project(2), project(3)]);
    expect(standsComposed(null)).toBe(true);
    expect(standsComposed(undefined)).toBe(true);
    expect(standsComposed(COMPOSED_HOME)).toBe(true);
    // Something taken off, or a width arranged, is something to put back.
    expect(standsComposed({ hidden: [TODAY], layouts: {} })).toBe(false);
    expect(standsComposed(layout(8, []))).toBe(false);
    expect(nobodyArranged(COMPOSED_HOME)).toBe(true);
    // Put back, the page is the one someone who arranged nothing has, every tile on it.
    const kept: RestHome = {
      hidden: [TODAY],
      layouts: { 8: [{ tile: P1, x: 7, y: 5, size: "small" }] },
    };
    for (const columns of [12, 8, 6, 4] as const) {
      expect(places(arranged(tiles, COMPOSED_HOME, columns))).toEqual(
        places(arranged(tiles, null, columns)),
      );
      expect(composed(tiles, COMPOSED_HOME, columns)).toEqual(composed(tiles, null, columns));
    }
    expect(places(arranged(tiles, kept, 8))).not.toEqual(places(arranged(tiles, COMPOSED_HOME, 8)));
    expect(arranged(tiles, kept, 8).some(({ tile }) => tile.id === TODAY)).toBe(false);
    expect(arranged(tiles, COMPOSED_HOME, 8).some(({ tile }) => tile.id === TODAY)).toBe(true);
  });

  it("starts arranging from the page as composed, each tile on the cells nearest it", () => {
    const tiles = homeTiles([hr, hello], [project(1), project(2), project(3)]);
    expect(places(arranged(tiles, null, 8))).toEqual({
      [BALANCE]: [0, 0, "medium"],
      [TODAY]: [4, 0, "medium"],
      [P1]: [4, 3, "icon"],
      [P2]: [5, 3, "icon"],
      [P3]: [6, 3, "icon"],
      "widget:hello:latest": [0, 4, "wide"],
    });
    for (const columns of [12, 8, 6, 4] as const) {
      expect(holdsTogether(arranged(tiles, null, columns), columns)).toBe(true);
    }
  });

  it("closes up a width nobody arranged when another was, from the sizes the tiles come in (ADR-0082)", () => {
    const tiles = homeTiles([hr, hello], [project(1), project(2), project(3)]);
    const phone = layout(4, [
      { tile: BALANCE, x: 0, y: 0, size: "small" },
      { tile: TODAY, x: 0, y: 2, size: "medium" },
      { tile: P1, x: 0, y: 4, size: "icon" },
      { tile: P2, x: 1, y: 4, size: "icon" },
      { tile: P3, x: 2, y: 4, size: "icon" },
      { tile: "widget:hello:latest", x: 0, y: 5, size: "medium" },
    ]);
    const placed = arranged(tiles, phone, 8);
    // At the phone's sizes the three icons left five cells empty beside the widgets; as cards,
    // alike, the page closes.
    expect(places(placed)).toEqual({
      [BALANCE]: [0, 0, "small"],
      [TODAY]: [2, 0, "medium"],
      [P1]: [6, 0, "small"],
      [P2]: [0, 2, "small"],
      [P3]: [2, 2, "small"],
      "widget:hello:latest": [4, 2, "medium"],
    });
    expect(emptyCells(placed, 8)).toBe(0);
    expect(rowsOf(placed, 8)).toBe(4);
    expect(rowsOf([], 8)).toBe(0);
    // Every width closes, each tile at a size it comes in there, the projects alike.
    for (const columns of [12, 8, 6] as const) {
      const at = arranged(tiles, phone, columns);
      expect(emptyCells(at, columns)).toBe(0);
      expect(holdsTogether(at, columns)).toBe(true);
      for (const { tile, size } of at) {
        expect(sizesAt(tile, columns)).toContain(size);
      }
      const projectSizes = at.filter(({ tile }) => tile.kind === "project").map(({ size }) => size);
      expect(new Set(projectSizes).size).toBe(1);
    }
  });

  it("keeps the sizes the tiles would rather have where the page closes with them, and leaves the fewest cells empty where it cannot", () => {
    // Eight icons fill a row of eight: nothing changes size.
    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map(project);
    const icons = layout(
      4,
      eight.map((one, at) => ({
        tile: `project:${one.id}`,
        x: at % 4,
        y: Math.floor(at / 4),
        size: "icon" as const,
      })),
    );
    const row = arranged(homeTiles([], eight), icons, 8);
    expect(row.every(({ size }) => size === "icon")).toBe(true);
    expect(emptyCells(row, 8)).toBe(0);
    // One project alone on twelve columns cannot close: as an icon it leaves eleven cells of its
    // row, where a card two rows high would leave twenty.
    const alone = arranged(
      homeTiles([], [project(1)]),
      layout(4, [{ tile: P1, x: 3, y: 0, size: "icon" }]),
      12,
    );
    expect(places(alone)).toEqual({ [P1]: [0, 0, "icon"] });
    expect(emptyCells(alone, 12)).toBe(11);
  });

  it("keeps what the person arranged, leaving what is empty empty", () => {
    const tiles = homeTiles([hr], [project(1)]);
    const home = layout(8, [
      { tile: P1, x: 7, y: 3, size: "small" },
      { tile: BALANCE, x: 3, y: 1, size: "medium" },
      { tile: TODAY, x: 0, y: 5, size: "wide" },
    ]);
    expect(places(arranged(tiles, home, 8))).toEqual({
      // Beside the edge, a tile comes back within the grid.
      [P1]: [6, 3, "small"],
      [BALANCE]: [3, 1, "medium"],
      [TODAY]: [0, 5, "wide"],
    });
  });

  it("brings in what is new at the first room, and leaves out what was taken off and what is gone", () => {
    const home: RestHome = {
      hidden: [P2],
      layouts: {
        8: [
          { tile: P1, x: 0, y: 0, size: "icon" },
          { tile: "widget:crm:deals", x: 1, y: 0, size: "small" },
          { tile: "project:0199c4d8-0000-7000-8000-000000000009", x: 3, y: 0, size: "icon" },
        ],
      },
    };
    expect(places(arranged(homeTiles([hr], [project(1), project(2)]), home, 8))).toEqual({
      [P1]: [0, 0, "icon"],
      [BALANCE]: [1, 0, "small"],
      [TODAY]: [3, 0, "medium"],
    });
  });

  it("gives a tile the size it starts at when the one kept is gone, and a tile on another's cells the nearest room", () => {
    const tiles = homeTiles([hr], [project(1)]);
    const home = layout(8, [
      { tile: BALANCE, x: 0, y: 0, size: "full" },
      { tile: P1, x: 1, y: 0, size: "icon" },
      { tile: P1, x: 5, y: 5, size: "icon" },
      { tile: TODAY, x: 0, y: 0, size: "medium" },
    ]);
    const placed = arranged(tiles, home, 8);
    expect(places(placed)).toMatchObject({ [BALANCE]: [0, 0, "small"], [P1]: [2, 0, "icon"] });
    expect(placed).toHaveLength(3);
    expect(holdsTogether(placed, 8)).toBe(true);
  });

  it("reads a width nobody arranged in the same order from the top, closed up, and keeps each width to itself", () => {
    const tiles = homeTiles([hr], [project(1)]);
    const wide = layout(8, [
      { tile: P1, x: 6, y: 4, size: "icon" },
      { tile: TODAY, x: 3, y: 2, size: "large" },
      { tile: BALANCE, x: 0, y: 0, size: "small" },
    ]);
    const narrow = arranged(tiles, wide, 4);
    // The icon beside the small widget would leave three cells empty; as a card it closes the row.
    expect(places(narrow)).toEqual({
      [BALANCE]: [0, 0, "small"],
      [TODAY]: [0, 2, "large"],
      [P1]: [2, 0, "small"],
    });
    expect(holdsTogether(narrow, 4)).toBe(true);
    expect(emptyCells(narrow, 4)).toBe(0);
    // Arranged on the phone, the phone has its own; the laptop's stands.
    const kept = homeWith(wide, moved(narrow, P1, 0, 6, 4), [], 4);
    expect(places(arranged(tiles, kept, 4))[P1]).toEqual([0, 6, "small"]);
    expect(kept.layouts[8]).toEqual(wide.layouts[8]);
    expect(places(arranged(tiles, kept, 8))[P1]).toEqual([6, 4, "icon"]);
  });

  it("gives a tile only the sizes that fit the grid, and the largest of them where its own does not", () => {
    const [balance, today, , latest] = homeTiles([hr, hello], [project(1)]);
    expect(balance && sizesAt(balance, 4)).toEqual(["small", "medium"]);
    expect(today && sizesAt(today, 8)).toEqual(["medium", "large", "wide"]);
    expect(today && sizesAt(today, 6)).toEqual(["medium", "large"]);
    expect(latest && startingSizeAt(latest, 8)).toBe("wide");
    expect(latest && startingSizeAt(latest, 6)).toBe("medium");
    expect(latest && startingSizeAt(latest, 4)).toBe("medium");
    const full = plugin("board", [
      {
        key: "all",
        name: { en: "All" },
        place: "home:top",
        size: "full",
        sizes: ["small", "large", "full"],
        defaultSize: "full",
      },
    ]);
    const [all] = homeTiles([full], []);
    expect(all && startingSizeAt(all, 8)).toBe("full");
    expect(all && startingSizeAt(all, 4)).toBe("large");
  });

  it("never shows a phone a size too wide for it, so that a frame is told what it has", () => {
    const tiles = homeTiles([hello], []);
    const kept = layout(8, [{ tile: "widget:hello:latest", x: 0, y: 0, size: "wide" }]);
    expect(places(arranged(tiles, kept, 8))["widget:hello:latest"]).toEqual([0, 0, "wide"]);
    expect(places(arranged(tiles, kept, 4))["widget:hello:latest"]).toEqual([0, 0, "medium"]);
    expect(places(arranged(tiles, null, 6))["widget:hello:latest"]).toEqual([0, 0, "medium"]);
    const back = added([], tiles[0] as HomeTile, 4);
    expect(back[0]?.size).toBe("medium");
  });

  it("has the tiles in the way give way from the nearest out, within a short wait", () => {
    expect(waitToGiveWay({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(0);
    expect(waitToGiveWay({ x: 4, y: 3 }, { x: 3, y: 3 })).toBe(22);
    expect(waitToGiveWay({ x: 6, y: 7 }, { x: 3, y: 3 })).toBe(110);
    expect(waitToGiveWay({ x: 40, y: 0 }, { x: 0, y: 0 })).toBe(130);
  });

  it("keeps a widget of an older console, with no size that fits, as wide as the grid", () => {
    const old = plugin("old", [
      { key: "strip", name: { en: "Strip" }, place: "home:top", size: "full", sizes: ["wide"] },
    ]);
    const [strip] = homeTiles([old], []);
    expect(strip && sizesAt(strip, 4)).toEqual(["wide"]);
    expect(footprintOf("wide", 4)).toEqual({ w: 4, h: 2 });
  });
});

describe("moving a tile (ADR-0061)", () => {
  const row = homeTiles([], [project(1), project(2), project(3)]);
  const standing = arranged(
    row,
    layout(8, [
      { tile: P1, x: 0, y: 0, size: "icon" },
      { tile: P2, x: 1, y: 0, size: "icon" },
      { tile: P3, x: 2, y: 0, size: "icon" },
    ]),
    8,
  );

  it("stands it where the place is free, up, down, left or right, leaving a gap where the person wants one", () => {
    expect(places(moved(standing, P1, 5, 2, 8))).toMatchObject({
      [P1]: [5, 2, "icon"],
      [P2]: [1, 0, "icon"],
      [P3]: [2, 0, "icon"],
    });
    // Off the grid, the nearest place on it.
    expect(places(moved(standing, P1, 99, 0, 8))[P1]).toEqual([7, 0, "icon"]);
    expect(places(moved(standing, P1, -4, -2, 8))[P1]).toEqual([0, 0, "icon"]);
    // A tile that is not there changes nothing.
    expect(moved(standing, "project:nothing", 1, 1, 8)).toBe(standing);
  });

  it("closes a row up behind it, both ways, as icons do on a phone", () => {
    expect(places(moved(standing, P3, 0, 0, 8))).toMatchObject({
      [P3]: [0, 0, "icon"],
      [P1]: [1, 0, "icon"],
      [P2]: [2, 0, "icon"],
    });
    expect(places(moved(standing, P1, 2, 0, 8))).toMatchObject({
      [P2]: [0, 0, "icon"],
      [P3]: [1, 0, "icon"],
      [P1]: [2, 0, "icon"],
    });
  });

  it("lets the smaller give way and the larger stay", () => {
    const tiles = homeTiles([hr], [project(1), project(2)]);
    const home = layout(8, [
      { tile: TODAY, x: 0, y: 0, size: "medium" },
      { tile: P1, x: 4, y: 0, size: "icon" },
      { tile: P2, x: 5, y: 0, size: "icon" },
      { tile: BALANCE, x: 0, y: 2, size: "small" },
    ]);
    const placed = arranged(tiles, home, 8);
    // A widget laid over the icons: they go to the nearest room.
    const over = moved(placed, TODAY, 4, 0, 8);
    expect(places(over)[TODAY]).toEqual([4, 0, "medium"]);
    expect(places(over)[P1]).toEqual([3, 0, "icon"]);
    expect(places(over)[P2]).toEqual([5, 2, "icon"]);
    expect(holdsTogether(over, 8)).toBe(true);
    // An icon laid on a widget: the widget stays, and the icon lands beside it.
    const on = moved(placed, P1, 1, 1, 8);
    expect(places(on)[TODAY]).toEqual([0, 0, "medium"]);
    expect(places(on)[P1]).toEqual([2, 2, "icon"]);
    expect(holdsTogether(on, 8)).toBe(true);
  });

  it("keeps every tile on cells of its own, wherever a tile is dropped", () => {
    const tiles = homeTiles([hr, hello], [project(1), project(2), project(3)]);
    for (const columns of [12, 8, 6, 4] as const) {
      const placed = arranged(tiles, null, columns);
      for (const tile of placed) {
        for (let y = 0; y < 10; y += 1) {
          for (let x = 0; x < columns; x += 1) {
            expect(holdsTogether(moved(placed, tile.tile.id, x, y, columns), columns)).toBe(true);
          }
        }
      }
    }
  });
});

describe("the other changes to the page (ADR-0061)", () => {
  const tiles = homeTiles([hr], [project(1), project(2)]);
  const placed = arranged(
    tiles,
    layout(8, [
      { tile: BALANCE, x: 0, y: 0, size: "small" },
      { tile: TODAY, x: 2, y: 0, size: "medium" },
      { tile: P1, x: 6, y: 0, size: "icon" },
      { tile: P2, x: 7, y: 0, size: "icon" },
    ]),
    8,
  );

  it("gives a tile another size where it stands, what its cells cover moving aside", () => {
    const larger = resized(placed, BALANCE, "medium", 8);
    expect(places(larger)[BALANCE]).toEqual([0, 0, "medium"]);
    expect(holdsTogether(larger, 8)).toBe(true);
    // Beside the edge, it comes back within the grid.
    const edge = resized(moved(placed, P1, 7, 0, 8), P1, "small", 8);
    expect(places(edge)[P1]).toEqual([6, 0, "small"]);
    expect(holdsTogether(edge, 8)).toBe(true);
    expect(resized(placed, "project:nothing", "small", 8)).toBe(placed);
  });

  it("puts a tile back at the first room, at the size it starts at", () => {
    const without = placed.filter((tile) => tile.tile.id !== BALANCE);
    const tile = tiles.find((candidate) => candidate.id === BALANCE);
    if (tile === undefined) {
      throw new Error("no tile");
    }
    expect(places(added(without, tile, 8))[BALANCE]).toEqual([0, 0, "small"]);
  });

  it("keeps what was changed, and the place of what the person may not see for now", () => {
    const home: RestHome = {
      hidden: [P2],
      layouts: {
        8: [
          { tile: P1, x: 1, y: 1, size: "icon" },
          { tile: "widget:crm:deals", x: 4, y: 4, size: "small" },
          { tile: P2, x: 3, y: 3, size: "icon" },
        ],
        4: [{ tile: P1, x: 0, y: 0, size: "icon" }],
      },
    };
    const shown = arranged(homeTiles([], [project(1)]), home, 8);
    const kept = homeWith(home, moved(shown, P1, 2, 0, 8), [P2], 8);
    expect(kept.hidden).toEqual([P2]);
    expect(kept.layouts[8]).toEqual([
      { tile: P1, x: 2, y: 0, size: "icon" },
      { tile: "widget:crm:deals", x: 4, y: 4, size: "small" },
    ]);
    expect(kept.layouts[4]).toEqual(home.layouts[4]);
    // Once the plugin is back, its widget stands where it stood.
    const back = arranged(
      homeTiles(
        [
          plugin("crm", [
            {
              key: "deals",
              name: { en: "Deals" },
              place: "home:top",
              size: "third",
              sizes: ["small"],
              defaultSize: "small",
            },
          ]),
        ],
        [project(1)],
      ),
      kept,
      8,
    );
    expect(places(back)["widget:crm:deals"]).toEqual([4, 4, "small"]);
  });
});

describe("a project at a glance (ADR-0105)", () => {
  const list = (rows: number, total: number, row: number = GLANCE_REM.task) => ({
    rows,
    total,
    row,
  });
  const STACKED: readonly (readonly [number, number])[] = [
    [0, 2],
    [1, 1],
    [0, Number.POSITIVE_INFINITY],
    [1, Number.POSITIVE_INFINITY],
    [2, Number.POSITIVE_INFINITY],
  ];

  it("is a size of three, and not the largest", () => {
    expect(["medium", "large", "wide"].every((size) => isGlanceSize(size as HomeTileSize))).toBe(
      true,
    );
    expect(["icon", "small", "full"].some((size) => isGlanceSize(size as HomeTileSize))).toBe(
      false,
    );
  });

  it("gives its rows out in order, each whole, and says how many more there are", () => {
    const tasks = list(6, 9);
    const goals = list(3, 3, GLANCE_REM.goal);
    const review = list(2, 2);
    // No room: nothing, not a heading alone.
    expect(glanceFit(1, [tasks, goals, review], STACKED)).toEqual([0, 0, 0]);
    // Room for a heading, two tasks and the line of how many more: the tasks first.
    const two = GLANCE_REM.heading + 2 * GLANCE_REM.task + GLANCE_REM.more;
    expect(glanceFit(two, [tasks, goals, review], STACKED)).toEqual([2, 0, 0]);
    // Then a goal, under a hairline, before more tasks.
    const andGoal =
      two + GLANCE_REM.between + GLANCE_REM.heading + GLANCE_REM.goal + GLANCE_REM.more;
    expect(glanceFit(andGoal, [tasks, goals, review], STACKED)).toEqual([2, 1, 0]);
    // A tall room shows every goal and what waits for review once the tasks are all there.
    expect(glanceFit(60, [tasks, goals, review], STACKED)).toEqual([6, 3, 2]);
    // A list with no rows takes no room.
    expect(glanceFit(60, [tasks, goals, list(0, 0)], STACKED)).toEqual([6, 3, 0]);
  });

  it("holds nothing in a room that is no number", () => {
    const lists = [list(6, 9), list(3, 3, GLANCE_REM.goal)];
    expect(glanceFit(Number.NaN, lists, STACKED)).toEqual([0, 0]);
    expect(glanceFit(Number.POSITIVE_INFINITY, lists, STACKED)).toEqual([0, 0]);
    expect(glanceFit(-3, lists, STACKED)).toEqual([0, 0]);
    expect(glanceFit(10, [], STACKED)).toEqual([]);
  });

  it("names the projects a page shows at a glance, in its order, and none where there is none", () => {
    const tiles = homeTiles([hr], [project(1), project(2), project(3)]);
    const shown = arranged(
      tiles,
      layout(8, [
        { tile: P1, x: 0, y: 0, size: "large" },
        { tile: BALANCE, x: 4, y: 0, size: "medium" },
        { tile: P2, x: 4, y: 2, size: "small" },
        { tile: P3, x: 0, y: 4, size: "wide" },
      ]),
      8,
    );
    // The widget is no project, and a card is no glance.
    expect(glanceProjects(shown).map((one) => one.key)).toEqual(["p1", "p3"]);
    expect(glanceProjects(arranged(tiles, null, 8))).toEqual([]);
    expect(glanceProjects([])).toEqual([]);
  });

  it("reads a project kept at a size it does not come in as an icon", () => {
    const tiles = homeTiles([], [project(1), project(2)]);
    // `full` was drawn for a project once and never kept by a release; a layout that holds it,
    // or a word that is no size at all, must not break the page.
    const kept = {
      hidden: [],
      layouts: {
        8: [
          { tile: P1, x: 0, y: 0, size: "full" },
          { tile: P2, x: 0, y: 4, size: "enormous" },
        ],
      },
    } as unknown as RestHome;
    const shown = arranged(tiles, kept, 8);
    expect(places(shown)[P1]?.[2]).toBe("icon");
    expect(places(shown)[P2]?.[2]).toBe("icon");
    expect(glanceProjects(shown)).toEqual([]);
    expect(holdsTogether(shown, 8)).toBe(true);
  });

  it("drops the line of how many more where the last row fits in its place", () => {
    // Three tasks of three take a heading and three rows, no line of more.
    const room = GLANCE_REM.heading + 3 * GLANCE_REM.task;
    expect(glanceFit(room, [list(3, 3)], [[0, Number.POSITIVE_INFINITY]])).toEqual([3]);
    expect(glanceFit(room, [list(3, 4)], [[0, Number.POSITIVE_INFINITY]])).toEqual([2]);
  });
});
