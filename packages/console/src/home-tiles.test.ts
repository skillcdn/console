import { describe, expect, it } from "vitest";
import {
  added,
  arranged,
  columnsFor,
  footprintOf,
  type HomeColumns,
  homeTiles,
  homeWith,
  moved,
  type PlacedTile,
  resized,
  rowsOf,
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
    expect(tiles[2]?.sizes).toEqual(["icon", "small"]);
    expect(tiles[2]?.defaultSize).toBe("icon");
    // The one size of before reads as one of the family.
    expect(tiles[3]?.sizes).toEqual(["wide"]);
    for (const state of ["installed", "disabled", "needs_consent", "failed"]) {
      expect(homeTiles([{ ...hr, state } as RestPlugin], [])).toEqual([]);
    }
  });

  it("stands everything at the first room for someone who has arranged nothing", () => {
    const placed = arranged(homeTiles([hr, hello], [project(1), project(2), project(3)]), null, 8);
    expect(places(placed)).toEqual({
      [BALANCE]: [0, 0, "small"],
      [TODAY]: [2, 0, "medium"],
      [P1]: [6, 0, "icon"],
      [P2]: [7, 0, "icon"],
      [P3]: [6, 1, "icon"],
      "widget:hello:latest": [0, 2, "wide"],
    });
    expect(rowsOf(placed, 8)).toBe(4);
    expect(rowsOf([], 8)).toBe(0);
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

  it("reads a width nobody arranged in the same order from the top, and keeps each width to itself", () => {
    const tiles = homeTiles([hr], [project(1)]);
    const wide = layout(8, [
      { tile: P1, x: 6, y: 4, size: "icon" },
      { tile: TODAY, x: 3, y: 2, size: "large" },
      { tile: BALANCE, x: 0, y: 0, size: "small" },
    ]);
    const narrow = arranged(tiles, wide, 4);
    expect(places(narrow)).toEqual({
      [BALANCE]: [0, 0, "small"],
      [TODAY]: [0, 2, "large"],
      [P1]: [2, 0, "icon"],
    });
    expect(holdsTogether(narrow, 4)).toBe(true);
    // Arranged on the phone, the phone has its own; the laptop's stands.
    const kept = homeWith(wide, moved(narrow, P1, 3, 1, 4), [], 4);
    expect(places(arranged(tiles, kept, 4))[P1]).toEqual([3, 1, "icon"]);
    expect(kept.layouts[8]).toEqual(wide.layouts[8]);
    expect(places(arranged(tiles, kept, 8))[P1]).toEqual([6, 4, "icon"]);
  });
});

describe("moving a tile (ADR-0061)", () => {
  const row = homeTiles([], [project(1), project(2), project(3)]);
  const standing = arranged(row, null, 8);

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
  const placed = arranged(tiles, null, 8);

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
