// An agent account's avatar (ADR-0084, ADR-0097): a small planet, flat and of two tones. A body,
// what lies on its surface, the ramp of colours both are drawn in, and one thing beside it or
// nothing, on a ground that is nearly white with a few faint squares strewn over it. Its parts are
// a few numbers, each a place in a set, and this module draws the picture from them wherever it
// is shown and writes it out as a picture file where one is needed. Nothing drawn is kept: a
// person object carries the parts, some seventy bytes, and whoever shows the picture draws it.
//
// A set is data: outlines in a square of a hundred units a side, each filled in two tones, the
// lighter left of a line down it and the darker right. The module fills them itself, by how much
// of each pixel an outline covers, with no renderer of anyone else's, in the browser and in the
// command alike, and the same parts give the same pixels on every machine: nothing here is
// computed with a function a runtime may round its own way (no sine of the runtime's, no
// exponential), only with sums, products and square roots. The sine a curve is laid out with is
// a series written here.
//
// A released set never changes: a new look is a new version, and an avatar keeps the version it
// was made with. What is added to this file is a set, never a change to one.

import type { RestAvatarParts } from "./schemas.js";

/** A colour: red, green and blue, each from 0 to 255. */
export type AvatarColor = readonly [number, number, number];

/** A corner of an outline: across and down, in the picture's own units, from its top left. */
export type AvatarPoint = readonly [number, number];

/** A closed outline, its corners in turn. A curve is as many short sides as it takes. */
export type AvatarOutline = readonly AvatarPoint[];

/** A ramp: the tones of one colour from the lightest to the darkest, each as `#rrggbb`. */
export interface AvatarRamp {
  readonly tones: readonly string[];
  /** The place in the set of the ramp that goes with this one: what stands beside a body of it is drawn in that. */
  readonly partner: number;
}

/**
 * One thing drawn: outlines filled together, in two tones of a ramp, the lighter left of the
 * line at `split` and the next darker right of it. Outlines that run the same way round add up
 * to one shape, and one that runs the other way round cuts a hole in what it lies in, as the
 * inner oval of a ring does.
 */
export interface AvatarShape {
  readonly outlines: readonly AvatarOutline[];
  /** The place in the ramp of the tone left of the line; right of it, the next. */
  readonly tone: number;
  /** Two colours of the shape's own in place of the ramp's, left and right, each as `#rrggbb`. */
  readonly colors?: readonly [string, string] | undefined;
  /** Where the two tones meet, across; the middle where left out. */
  readonly split?: number | undefined;
  /** How much of the shape covers what is behind it, from 0 to 1; all of it where left out. */
  readonly opacity?: number | undefined;
  /** A line of the ground's colour round the shape, this wide, half of it outside: the shape stands off what it lies over. */
  readonly gap?: number | undefined;
}

/** Shapes drawn together: turned about the middle of the picture, and cut to its upper or its lower half where it says so. */
export interface AvatarLayer {
  readonly shapes: readonly AvatarShape[];
  /** Degrees the shapes are turned by, clockwise as the picture is looked at. */
  readonly turn?: number | undefined;
  /** The half of the picture the shapes are kept to, as they lie before they are turned. */
  readonly half?: "upper" | "lower" | undefined;
}

/** A body: its outlines, filled as a shape's are, and what is drawn behind it in its own ramp, an atmosphere say. */
export interface AvatarBody {
  readonly outlines: readonly AvatarOutline[];
  readonly behind?: readonly AvatarShape[] | undefined;
}

/** A surface: the tone the whole body has, and what lies on it, cut to the body. */
export interface AvatarSurface {
  readonly tone: number;
  readonly shapes: readonly AvatarShape[];
}

/** What stands beside a body, in the ramp that goes with the body's: what of it is behind the body, and what before it. */
export interface AvatarAccent {
  readonly behind: readonly AvatarLayer[];
  readonly before: readonly AvatarLayer[];
}

/**
 * A set: its version, and the choices of each part. The first accent is nothing, by convention,
 * and is rolled more often than any other.
 */
export interface AvatarSet {
  readonly version: number;
  /** The colours the picture is filled with behind everything, each as `#rrggbb`. */
  readonly grounds: readonly string[];
  /** The colours of the faint squares strewn over the ground. */
  readonly confetti: readonly string[];
  readonly ramps: readonly AvatarRamp[];
  readonly bodies: readonly AvatarBody[];
  readonly surfaces: readonly AvatarSurface[];
  readonly accents: readonly AvatarAccent[];
  /**
   * How much larger than its outlines are written a planet is drawn, at every size and never past
   * what stands beside it leaves room for; as written where the set says nothing (ADR-0099).
   */
  readonly fill?: number | undefined;
}

/** The side of the square a set's outlines are written in. */
export const AVATAR_BOX = 100;
/** The largest picture file the module writes, in pixels a side (ADR-0084). */
export const MAX_AVATAR_PIXELS = 1024;
/**
 * Under this many pixels a side a picture has no squares on its ground: they would be specks. A
 * page draws a picture at about twice the size it shows it, so this is a picture shown under 48
 * pixels.
 */
export const AVATAR_PLAIN_UNDER = 96;
/**
 * Under this many pixels a side, a picture shown in a line of text or among a task's workers,
 * the planet is drawn closer: as large as what stands beside it leaves room for, up to
 * `AVATAR_CLOSE_MOST` times what its set writes, or what the set's own `fill` says where that is
 * more (ADR-0099).
 */
export const AVATAR_CLOSE_UNDER = 64;
export const AVATAR_CLOSE_MOST = 1.1;
/** The most a set may ask its planet to be drawn larger by. */
export const AVATAR_FILL_MOST = 1.5;

// Numbers

const clamp = (value: number, low = 0, high = 1): number => Math.min(Math.max(value, low), high);
const length = (x: number, y: number): number => Math.sqrt(x * x + y * y);
/** A number that is one, or nothing a drawing can use. */
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The sine of an angle in degrees, by its series: sums and products alone, so that every machine
 * lays a curve out through the same points. Good to the last place a number keeps.
 */
function sine(degrees: number): number {
  let turn = degrees % 360;
  if (turn > 180) {
    turn -= 360;
  } else if (turn < -180) {
    turn += 360;
  }
  // The sine of what is left of a half turn is the same: the series is asked of a quarter turn at most.
  if (turn > 90) {
    turn = 180 - turn;
  } else if (turn < -90) {
    turn = -180 - turn;
  }
  const x = (turn * Math.PI) / 180;
  const s = x * x;
  let sum = 1;
  for (let term = 20; term >= 2; term -= 2) {
    sum = 1 - (s / (term * (term + 1))) * sum;
  }
  return x * sum;
}
const cosine = (degrees: number): number => sine(degrees + 90);

// Colours

const BLACK: AvatarColor = [0, 0, 0];

/** A colour written `#rrggbb` as its three numbers; black where it is not written so. */
function colorOf(hex: unknown): AvatarColor {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return BLACK;
  }
  const read = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return [read(1), read(3), read(5)];
}

// Outlines: what the first set is written with. Every one runs the same way round, so that
// outlines laid over one another add up to one shape; `hole` turns one the other way.

/** How many sides a curve of this radius is drawn with: enough that the largest picture shows none. */
function sidesOf(radius: number): number {
  return 4 * Math.ceil(clamp(radius * 4, 48, 192) / 4);
}

/** An oval by its middle and its two radii. */
function oval(cx: number, cy: number, rx: number, ry: number): AvatarOutline {
  const sides = sidesOf(Math.max(rx, ry));
  const points: AvatarPoint[] = [];
  for (let side = 0; side < sides; side += 1) {
    const at = (360 * side) / sides;
    points.push([cx + rx * cosine(at), cy + ry * sine(at)]);
  }
  return points;
}
const disc = (cx: number, cy: number, radius: number): AvatarOutline =>
  oval(cx, cy, radius, radius);

/** A rectangle by its top left and its sides, its corners rounded by `radius`, which is half a side at most. */
function slab(x: number, y: number, w: number, h: number, radius: number): AvatarOutline {
  const r = Math.min(radius, w / 2, h / 2);
  const steps = sidesOf(r) / 4;
  const points: AvatarPoint[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let step = 0; step <= steps; step += 1) {
      const at = from + (90 * step) / steps;
      points.push([cx + r * cosine(at), cy + r * sine(at)]);
    }
  };
  corner(x + w - r, y + r, -90);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, 90);
  corner(x + r, y + r, 180);
  return points;
}

/** An outline run the other way round: a hole in the outline it lies in. */
const hole = (outline: AvatarOutline): AvatarOutline => [...outline].reverse();

/** A place written with two digits after the point, as the set was drawn. */
const two = (value: number): number => Math.round(value * 100) / 100;

/** How a band's edge runs: straight where it has no height, else a wave of this height, or a zigzag. */
interface Edge {
  readonly height?: number;
  readonly shift?: number;
}

/**
 * A band across the whole picture, from `top` down to `bottom`, each edge straight, a wave or a
 * zigzag `length` long from crest to crest. An edge is a line through points a step apart, two
 * units for a wave and half its length for a zigzag, as the set was drawn.
 */
function band(
  top: number,
  bottom: number,
  upper: Edge = {},
  lower: Edge = {},
  wave: { readonly length?: number; readonly zigzag?: boolean } = {},
): AvatarOutline {
  const long = wave.length ?? 26;
  const zigzag = wave.zigzag === true;
  const lift = (x: number, shift: number): number => {
    const t = (x + shift) / long;
    return zigzag ? 2 * Math.abs(2 * (t - Math.floor(t + 0.5))) - 1 : sine(360 * t);
  };
  const step = zigzag ? long / 2 : 2;
  const points: AvatarPoint[] = [];
  for (let x = -4; x <= 104; x += step) {
    points.push([two(x), two(top + (upper.height ?? 0) * lift(x, upper.shift ?? 0))]);
  }
  for (let x = 104; x >= -4; x -= step) {
    points.push([two(x), two(bottom + (lower.height ?? 0) * lift(x, lower.shift ?? 0))]);
  }
  return points;
}

/** A band that runs from the upper right to the lower left, between two lines `from` and `to` along the edges. */
const slant = (from: number, to: number): AvatarOutline => [
  [from + 10, -10],
  [to + 10, -10],
  [-10, to + 10],
  [-10, from + 10],
];

/** A star of four points, its sides drawn in towards its middle. */
function sparkle(x: number, y: number, size: number): AvatarOutline {
  const pull = size * 0.16;
  const tips: readonly AvatarPoint[] = [
    [x, y - size],
    [x + size, y],
    [x, y + size],
    [x - size, y],
  ];
  const pulls: readonly AvatarPoint[] = [
    [x + pull, y - pull],
    [x + pull, y + pull],
    [x - pull, y + pull],
    [x - pull, y - pull],
  ];
  const steps = 16;
  const points: AvatarPoint[] = [];
  for (let side = 0; side < 4; side += 1) {
    const from = tips[side] ?? [x, y];
    const by = pulls[side] ?? [x, y];
    const to = tips[(side + 1) % 4] ?? [x, y];
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      points.push([a * from[0] + b * by[0] + c * to[0], a * from[1] + b * by[1] + c * to[1]]);
    }
  }
  return points;
}

// The first set

const ramp = (tones: string, partner: number): AvatarRamp => ({ tones: tones.split(" "), partner });
const of = (outline: AvatarOutline, tone: number): AvatarShape => ({ outlines: [outline], tone });

/** The rim of the lumpy body: where each bump sits, in degrees round the middle, and its radius. */
const BUMPS: readonly AvatarPoint[] = [
  [-78, 5.2],
  [-30, 4.4],
  [12, 5],
  [58, 4.2],
  [104, 5.4],
  [150, 4.6],
  [196, 5],
  [240, 4.2],
];

/** A ring: an oval with an oval cut out of it. */
const RING: readonly AvatarOutline[] = [oval(50, 50, 40, 11), hole(oval(50, 50, 32, 8))];
/** The line of an orbit: an oval with one a little smaller cut out of it. */
const ORBIT: readonly AvatarOutline[] = [oval(50, 50, 42.4, 13.4), hole(oval(50, 50, 39.6, 10.9))];
/** The white of a polar cap, and its shade. */
const ICE: readonly [string, string] = ["#ffffff", "#ebe4f1"];

/**
 * The first set: four bodies, ten surfaces and eighteen ramps of five tones, each with the ramp
 * that goes with it, on one ground, with one of five things beside the body or none.
 */
export const AVATAR_SET_1: AvatarSet = {
  version: 1,
  // The set is drawn with air round its planet; on a page a tile reads better a little fuller.
  fill: 1.05,
  grounds: ["#fdfcff"],
  confetti: ["#ffd643", "#ffb052", "#7fa8ff", "#6f74e8", "#d0cde4", "#ebe4f1"],
  ramps: [
    // Sunset, butter, gold, peach, terracotta, rose.
    ramp("#ffd643 #ffb052 #ff8a5b #ff3d5a #d6264a", 7),
    ramp("#fff4d6 #ffe08a #ffc25c #ff9f4a #f07a3a", 9),
    ramp("#fff0b3 #ffd95a #f5b82e #d6911b #a86a10", 10),
    ramp("#ffe3d3 #ffc4a8 #ff9f80 #f2735a #d9533f", 13),
    ramp("#ffd2b8 #ffa77a #ff8a5b #e8613f #c24e33", 12),
    ramp("#ffd6e4 #ffb3c7 #ff8fb3 #ff5c8a #d6336c", 11),
    // Berry, violet, lavender, indigo, navy, ocean.
    ramp("#ffd0f0 #f59ad8 #e05fbf #b83a9e #8c2479", 1),
    ramp("#eadcff #cdb0ff #a77cf5 #8556de #6638bd", 1),
    ramp("#fff3f2 #ebe4f1 #d0cde4 #a4a7cc #8a8db8", 0),
    ramp("#9cb8ff #6f8cf5 #4f5fe0 #3a3fb8 #2a2f99", 1),
    ramp("#a9b6d9 #7286bd #4d5f9c #36457a #25315c", 2),
    ramp("#c7e2ff #9cc4ff #7fa8ff #6f74e8 #5257c9", 0),
    // Aqua, teal, mint, leaf, stone, graphite.
    ramp("#d8fbff #a6f0ff #5fd0f0 #2aa7d6 #1b7bb3", 5),
    ramp("#bff5ec #7fe3d3 #3fc4b3 #1f9a8d #127066", 3),
    ramp("#5ef0b8 #22e3a5 #1cb2b2 #137f80 #0e5f60", 0),
    ramp("#d9f7a0 #a8e070 #6cc46a #3f9e58 #2a7a45", 7),
    ramp("#f6f1ea #e9e1d4 #d4c8b6 #b8a993 #998a74", 14),
    ramp("#f2f3f5 #d9dce2 #b4b9c4 #8a909e #5f6573", 0),
  ],
  bodies: [
    // A disc.
    { outlines: [disc(50, 50, 27)] },
    // A smaller disc.
    { outlines: [disc(50, 50, 24)] },
    // A lumpy one: a disc with small round bumps on its rim.
    {
      outlines: [
        disc(50, 50, 24.5),
        ...BUMPS.map(([at, radius]) => disc(50 + 23.5 * cosine(at), 50 + 23.5 * sine(at), radius)),
      ],
    },
    // One with an atmosphere: a disc, and a faint larger one behind it.
    {
      outlines: [disc(50, 50, 24.5)],
      behind: [{ outlines: [disc(50, 50, 29)], tone: 0, opacity: 0.2 }],
    },
  ],
  surfaces: [
    // Straight bands.
    {
      tone: 0,
      shapes: [
        of(band(-10, 30.7), 1),
        of(band(38.4, 46.1), 1),
        of(band(53.9, 61.6), 1),
        of(band(69.3, 110), 1),
      ],
    },
    // Wavy bands.
    {
      tone: 1,
      shapes: [
        of(band(-10, 31.5), 2),
        of(band(40.5, 54, { height: 2.4, shift: 6 }), 0),
        of(band(67, 110, { height: 2.4, shift: 19 }), 2),
      ],
    },
    // Zigzag bands.
    {
      tone: 1,
      shapes: [
        of(band(-10, 33, {}, { height: 3 }, { length: 13, zigzag: true }), 2),
        of(band(44, 56, { height: 3 }, { height: 3 }, { length: 13, zigzag: true }), 0),
        of(band(67, 110, { height: 3 }, {}, { length: 13, zigzag: true }), 2),
      ],
    },
    // Tilted bands.
    { tone: 1, shapes: [of(slant(68, 80), 2), of(slant(92, 104), 0), of(slant(116, 128), 2)] },
    // The eye of a storm.
    {
      tone: 0,
      shapes: [
        of(band(-10, 31), 1),
        of(band(69, 110), 1),
        of(band(46.5, 53.5), 1),
        of(oval(50, 50, 15.5, 9.5), 1),
        of(oval(50, 50, 8.5, 5), 0),
      ],
    },
    // A great spot.
    {
      tone: 1,
      shapes: [
        of(band(-10, 34, {}, { height: 1.8, shift: 4 }), 2),
        of(band(43, 49), 0),
        of(band(64, 110, { height: 1.8, shift: 9 }), 2),
        of(slab(53, 51.5, 14, 8, 4), 2),
      ],
    },
    // Continents.
    {
      tone: 0,
      shapes: [
        of(slab(38, 31, 70, 12, 6), 1),
        of(slab(-20, 47, 74, 11, 5.5), 1),
        of(band(67, 110), 1),
      ],
    },
    // Craters.
    {
      tone: 1,
      shapes: [
        of(disc(38, 40, 6.2), 2),
        of(disc(38, 40, 3), 3),
        of(disc(63, 45, 4.6), 2),
        of(disc(42, 63, 5.2), 2),
        of(slab(53, 31, 3.4, 3.4, 0.4), 2),
        of(slab(30, 54, 3, 3, 0.4), 2),
        of(slab(58, 57, 3, 3, 0.4), 2),
        of(disc(50, 80, 7.5), 2),
      ],
    },
    // Polar caps.
    {
      tone: 1,
      shapes: [
        { outlines: [band(-10, 32, {}, { height: 1.6, shift: 4 })], tone: 0, colors: ICE },
        { outlines: [band(70, 110, { height: 1.6, shift: 12 })], tone: 0, colors: ICE },
        of(disc(40, 52, 4.4), 2),
        of(slab(54, 47, 16, 3.4, 1.7), 2),
      ],
    },
    // Day and night.
    { tone: 0, shapes: [of(disc(64, 40, 27), 1), of(disc(70, 34, 10), 2)] },
  ],
  accents: [
    { behind: [], before: [] },
    // A ring: all of it behind the body, and its lower half before it.
    {
      behind: [{ turn: -14, shapes: [{ outlines: RING, tone: 1 }] }],
      before: [{ turn: -14, half: "lower", shapes: [{ outlines: RING, tone: 1 }] }],
    },
    // An orbit: a faint line round the body, and a small moon on it.
    {
      behind: [
        {
          turn: -18,
          half: "upper",
          shapes: [{ outlines: ORBIT, tone: 1, opacity: 0.55 }],
        },
      ],
      before: [
        {
          turn: -18,
          half: "lower",
          shapes: [{ outlines: ORBIT, tone: 1, opacity: 0.55 }],
        },
        {
          turn: -18,
          shapes: [{ outlines: [disc(89.5, 54.4, 3.6)], tone: 1, split: 89.5, gap: 2 }],
        },
      ],
    },
    // A moon.
    {
      behind: [],
      before: [{ shapes: [{ outlines: [disc(74.5, 27.5, 9.4)], tone: 1, split: 74.5, gap: 3 }] }],
    },
    // Two moons.
    {
      behind: [],
      before: [
        {
          shapes: [
            { outlines: [disc(75, 26, 7.6)], tone: 1, split: 75, gap: 2.8 },
            { outlines: [disc(24, 75, 5.2)], tone: 0, split: 24, gap: 2.4 },
          ],
        },
      ],
    },
    // A sparkle, and a smaller one.
    {
      behind: [],
      before: [
        {
          shapes: [
            { outlines: [sparkle(76, 23, 9)], tone: 0, split: 76, gap: 2.4 },
            { outlines: [sparkle(85, 36, 4)], tone: 1, split: 85 },
          ],
        },
      ],
    },
  ],
};

/** The sets the package ships, the oldest first; an avatar names the one it was made with. */
export const AVATAR_SETS: readonly AvatarSet[] = [AVATAR_SET_1];

/** The set an avatar was made with, among `sets`; the newest where they hold none of its version. */
export function avatarSetOf(
  parts: Pick<RestAvatarParts, "set">,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): AvatarSet {
  const found = sets.find((set) => set.version === parts.set) ?? sets[sets.length - 1];
  if (found === undefined) {
    throw new Error("no set to draw an avatar from");
  }
  return found;
}

/** What a set holds where it should hold a list: the list, or nothing. */
const listOf = <T>(value: readonly T[] | undefined): readonly T[] =>
  Array.isArray(value) ? value : [];

/** A thing of a set that is one, or nothing: a set of one's own may hold anything. */
const thing = <T extends object>(value: T | undefined): T | undefined =>
  typeof value === "object" && value !== null ? value : undefined;

/** The things of a list of a set; what in it is none is left out. */
const thingsOf = <T extends object>(value: readonly T[] | undefined): readonly T[] =>
  listOf(value).filter((one) => thing(one) !== undefined);

/**
 * The choice an index names, counted round the end: an index a set does not have still draws,
 * and what is no index at all names the first.
 */
function choiceOf<T>(choices: readonly T[] | undefined, index: unknown): T | undefined {
  const list = listOf(choices);
  return list.length === 0
    ? undefined
    : list[finite(index) ? Math.abs(Math.trunc(index)) % list.length : 0];
}

// Filling: how much of each pixel an outline covers.

/** An outline as the filling takes it: across and down in turn, in one list. */
type Path = number[];

/** The most a place may be from the picture, in its own units: what is further is nobody's set, and is brought back. */
const FAR = 1e4;
/**
 * The most corners one picture is drawn from, some ten times what the first set's fullest
 * picture has: an outline that would take it past that is left out, so that a set of one's own
 * with an outline of any length draws in a time that has a bound.
 */
const MOST_CORNERS = 20_000;

/** An outline of a set as a path; what in it is no place of a picture is left out. */
function pathOf(outline: AvatarOutline): Path {
  const path: Path = [];
  if (!Array.isArray(outline)) {
    return path;
  }
  for (const point of outline) {
    const x = Array.isArray(point) ? point[0] : undefined;
    const y = Array.isArray(point) ? point[1] : undefined;
    if (finite(x) && finite(y)) {
      path.push(clamp(x, -FAR, FAR), clamp(y, -FAR, FAR));
    }
  }
  return path;
}

/** What of a path lies where `a * x + b * y` is `c` at most: the path cut along a line. */
function cut(path: Path, a: number, b: number, c: number): Path {
  const out: Path = [];
  const corners = path.length / 2;
  if (corners < 3) {
    return out;
  }
  let px = path[path.length - 2] ?? 0;
  let py = path[path.length - 1] ?? 0;
  let pd = a * px + b * py - c;
  for (let corner = 0; corner < corners; corner += 1) {
    const x = path[corner * 2] ?? 0;
    const y = path[corner * 2 + 1] ?? 0;
    const d = a * x + b * y - c;
    if (d <= 0 !== pd <= 0) {
      const t = pd / (pd - d);
      out.push(px + (x - px) * t, py + (y - py) * t);
    }
    if (d <= 0) {
      out.push(x, y);
    }
    px = x;
    py = y;
    pd = d;
  }
  return out;
}

/** Twice the area a path goes round, its sign saying which way. */
function turnOf(path: Path): number {
  let area = 0;
  const corners = path.length / 2;
  let px = path[path.length - 2] ?? 0;
  let py = path[path.length - 1] ?? 0;
  for (let corner = 0; corner < corners; corner += 1) {
    const x = path[corner * 2] ?? 0;
    const y = path[corner * 2 + 1] ?? 0;
    area += px * y - x * py;
    px = x;
    py = y;
  }
  return area;
}

/** How long a join of two sides may reach past their corner, in line widths, before it is cut off flat. */
const JOIN_LIMIT = 4;

/**
 * The line `width` wide along an outline, as paths that all run one way round: a piece for each
 * side, and at each corner a piece that fills the outer side of the turn, pointed where the
 * turn is gentle and cut off flat where it is sharp.
 */
function lineAlong(path: Path, width: number): Path[] {
  const pieces: Path[] = [];
  const corners = path.length / 2;
  const half = width / 2;
  if (corners < 2 || !(half > 0)) {
    return pieces;
  }
  const piece = (points: Path): void => {
    const turn = turnOf(points);
    if (turn === 0) {
      return;
    }
    if (turn < 0) {
      const back: Path = [];
      for (let at = points.length - 2; at >= 0; at -= 2) {
        back.push(points[at] ?? 0, points[at + 1] ?? 0);
      }
      pieces.push(back);
    } else {
      pieces.push(points);
    }
  };
  /** The sides that have a length, each with the way it runs. */
  const sides: { x: number; y: number; dx: number; dy: number; tx: number; ty: number }[] = [];
  for (let corner = 0; corner < corners; corner += 1) {
    const x = path[corner * 2] ?? 0;
    const y = path[corner * 2 + 1] ?? 0;
    const tx = path[((corner + 1) % corners) * 2] ?? 0;
    const ty = path[((corner + 1) % corners) * 2 + 1] ?? 0;
    const long = length(tx - x, ty - y);
    if (long > 0) {
      sides.push({ x, y, dx: (tx - x) / long, dy: (ty - y) / long, tx, ty });
    }
  }
  for (const [at, side] of sides.entries()) {
    // Across the side, to its left as it runs.
    const nx = -side.dy * half;
    const ny = side.dx * half;
    piece([
      side.x + nx,
      side.y + ny,
      side.tx + nx,
      side.ty + ny,
      side.tx - nx,
      side.ty - ny,
      side.x - nx,
      side.y - ny,
    ]);
    const next = sides[(at + 1) % sides.length];
    if (next === undefined || next === side) {
      continue;
    }
    const cross = side.dx * next.dy - side.dy * next.dx;
    if (cross === 0) {
      continue;
    }
    // The outer side of the turn is the one away from where it turns to.
    const out = cross > 0 ? -1 : 1;
    const ax = side.tx + out * nx;
    const ay = side.ty + out * ny;
    const bx = side.tx + out * -next.dy * half;
    const by = side.ty + out * next.dx * half;
    const along = 1 + side.dx * next.dx + side.dy * next.dy;
    if (along >= 2 / (JOIN_LIMIT * JOIN_LIMIT)) {
      const reach = (out * half) / along;
      piece([
        side.tx,
        side.ty,
        ax,
        ay,
        side.tx + (-side.dy - next.dy) * reach,
        side.ty + (side.dx + next.dx) * reach,
        bx,
        by,
      ]);
    } else {
      piece([side.tx, side.ty, ax, ay, bx, by]);
    }
  }
  return pieces;
}

/** Where a place of a set is in the picture's pixels: turned about the middle, drawn larger about it, and scaled. */
interface Placing {
  readonly cos: number;
  readonly sin: number;
  readonly zoom: number;
  readonly scale: number;
}

function placed(path: Path, placing: Placing): Path {
  const middle = AVATAR_BOX / 2;
  const out: Path = new Array<number>(path.length);
  for (let at = 0; at < path.length; at += 2) {
    const x = (path[at] ?? 0) - middle;
    const y = (path[at + 1] ?? 0) - middle;
    out[at] = (middle + (x * placing.cos - y * placing.sin) * placing.zoom) * placing.scale;
    out[at + 1] = (middle + (x * placing.sin + y * placing.cos) * placing.zoom) * placing.scale;
  }
  return out;
}

/** A part of the picture, in pixels: what is filled is cut to it. */
interface Frame {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The rows and the columns something was filled in, so that only they are gone over. */
interface Reach {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Adds a path to the sums its pixels are covered by: for each row a side crosses, how much of
 * each pixel lies to the right of it, signed by the way the side runs. Summed along a row, they
 * say how much of each pixel the path goes round, and how often.
 */
function trace(sums: Float32Array, stride: number, path: Path, frame: Frame, reach: Reach): void {
  let cutPath = cut(path, -1, 0, -frame.left);
  cutPath = cut(cutPath, 1, 0, frame.right);
  cutPath = cut(cutPath, 0, -1, -frame.top);
  cutPath = cut(cutPath, 0, 1, frame.bottom);
  const corners = cutPath.length / 2;
  if (corners < 3) {
    return;
  }
  let px = cutPath[cutPath.length - 2] ?? 0;
  let py = cutPath[cutPath.length - 1] ?? 0;
  for (let corner = 0; corner < corners; corner += 1) {
    const cx = cutPath[corner * 2] ?? 0;
    const cy = cutPath[corner * 2 + 1] ?? 0;
    let x0 = px;
    let y0 = py;
    let x1 = cx;
    let y1 = cy;
    px = cx;
    py = cy;
    if (y0 === y1) {
      continue;
    }
    let way = 1;
    if (y0 > y1) {
      way = -1;
      [x0, y0, x1, y1] = [x1, y1, x0, y0];
    }
    const slope = (x1 - x0) / (y1 - y0);
    let x = x0;
    const first = Math.floor(y0);
    const last = Math.ceil(y1);
    reach.top = Math.min(reach.top, first);
    reach.bottom = Math.max(reach.bottom, last);
    for (let row = first; row < last; row += 1) {
      const tall = Math.min(row + 1, y1) - Math.max(row, y0);
      const after = x + slope * tall;
      const share = tall * way;
      const from = Math.min(x, after);
      const to = Math.max(x, after);
      const start = Math.floor(from);
      const end = Math.ceil(to);
      const base = row * stride;
      reach.left = Math.min(reach.left, start);
      reach.right = Math.max(reach.right, end + 1);
      if (end <= start + 1) {
        const across = 0.5 * (x + after) - start;
        sums[base + start] = (sums[base + start] ?? 0) + share - share * across;
        sums[base + start + 1] = (sums[base + start + 1] ?? 0) + share * across;
      } else {
        const each = 1 / (to - from);
        const inFirst = from - start;
        const firstArea = 0.5 * each * (1 - inFirst) * (1 - inFirst);
        const inLast = to - end + 1;
        const lastArea = 0.5 * each * inLast * inLast;
        sums[base + start] = (sums[base + start] ?? 0) + share * firstArea;
        if (end === start + 2) {
          sums[base + start + 1] =
            (sums[base + start + 1] ?? 0) + share * (1 - firstArea - lastArea);
        } else {
          const second = each * (1.5 - inFirst);
          sums[base + start + 1] = (sums[base + start + 1] ?? 0) + share * (second - firstArea);
          for (let column = start + 2; column < end - 1; column += 1) {
            sums[base + column] = (sums[base + column] ?? 0) + share * each;
          }
          const before = second + (end - start - 3) * each;
          sums[base + end - 1] = (sums[base + end - 1] ?? 0) + share * (1 - before - lastArea);
        }
        sums[base + end] = (sums[base + end] ?? 0) + share * lastArea;
      }
      x = after;
    }
  }
}

/**
 * How much of a pixel is filled, from how much of it the outlines go round: once is all of it,
 * more is no more, and what an outline goes round the other way is taken off.
 */
const filled = (round: number): number => Math.min(1, Math.abs(round));

/** What a picture is drawn on: its pixels, and the sums a shape is filled through, kept to be used again. */
interface Sheet {
  readonly side: number;
  readonly stride: number;
  /** Red, green and blue of each pixel, row after row. */
  readonly pixels: Float32Array;
  /** The sums of a whole shape, and of what of it lies left of its line. */
  readonly whole: Float32Array;
  readonly left: Float32Array;
}

function sheetOf(side: number): Sheet {
  const stride = side + 2;
  return {
    side,
    stride,
    pixels: new Float32Array(side * side * 3),
    whole: new Float32Array(stride * side),
    left: new Float32Array(stride * side),
  };
}

const emptyReach = (): Reach => ({
  left: Infinity,
  top: Infinity,
  right: -Infinity,
  bottom: -Infinity,
});

/**
 * Fills paths on `target`, in one colour left of a line and another right of it: `leftPaths` is
 * what of the shape lies left. Where `through` is given, only as much of each pixel is filled as
 * it says. Every pixel is given its two colours at once, by how much of it each covers, so that
 * no line of what is behind shows where they meet.
 */
function fill(
  sheet: Sheet,
  target: Float32Array,
  frame: Frame,
  paths: readonly Path[],
  leftPaths: readonly Path[] | undefined,
  leftColor: AvatarColor,
  rightColor: AvatarColor,
  opacity: number,
  through?: Float32Array,
): void {
  const { side, stride, whole, left } = sheet;
  const reach = emptyReach();
  for (const path of paths) {
    trace(whole, stride, path, frame, reach);
  }
  if (leftPaths !== undefined) {
    const unused = emptyReach();
    for (const path of leftPaths) {
      trace(left, stride, path, frame, unused);
    }
  }
  if (reach.top >= reach.bottom) {
    return;
  }
  const firstRow = Math.max(0, reach.top);
  const lastRow = Math.min(side, reach.bottom);
  const firstColumn = Math.max(0, reach.left);
  const lastColumn = Math.min(side + 1, reach.right);
  for (let row = firstRow; row < lastRow; row += 1) {
    let round = 0;
    let roundLeft = 0;
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const at = row * stride + column;
      round += whole[at] ?? 0;
      whole[at] = 0;
      if (leftPaths !== undefined) {
        roundLeft += left[at] ?? 0;
        left[at] = 0;
      }
      if (column >= side) {
        continue;
      }
      const all = filled(round);
      if (all <= 0) {
        continue;
      }
      const cell = row * side + column;
      const share = opacity * (through === undefined ? 1 : (through[cell] ?? 0));
      const onLeft = leftPaths === undefined ? 0 : Math.min(all, filled(roundLeft));
      const a = onLeft * share;
      const b = (all - onLeft) * share;
      const pixel = cell * 3;
      const keep = 1 - a - b;
      target[pixel] = (target[pixel] ?? 0) * keep + leftColor[0] * a + rightColor[0] * b;
      target[pixel + 1] = (target[pixel + 1] ?? 0) * keep + leftColor[1] * a + rightColor[1] * b;
      target[pixel + 2] = (target[pixel + 2] ?? 0) * keep + leftColor[2] * a + rightColor[2] * b;
    }
  }
}

/** How much of each pixel paths cover, written into `mask`, and the pixels they reach. */
function cover(sheet: Sheet, mask: Float32Array, paths: readonly Path[]): Reach {
  const { side, stride, whole } = sheet;
  const reach = emptyReach();
  const frame: Frame = { left: 0, top: 0, right: side, bottom: side };
  for (const path of paths) {
    trace(whole, stride, path, frame, reach);
  }
  if (reach.top >= reach.bottom) {
    return reach;
  }
  const lastColumn = Math.min(side + 1, reach.right);
  for (let row = Math.max(0, reach.top); row < Math.min(side, reach.bottom); row += 1) {
    let round = 0;
    for (let column = Math.max(0, reach.left); column <= lastColumn; column += 1) {
      const at = row * stride + column;
      round += whole[at] ?? 0;
      whole[at] = 0;
      if (column < side) {
        mask[row * side + column] = filled(round);
      }
    }
  }
  return reach;
}

/** The ramp a shape is drawn in when the set has none: greys. */
const NO_RAMP: AvatarRamp = {
  tones: ["#eeeeee", "#cccccc", "#aaaaaa", "#888888", "#666666"],
  partner: 0,
};
const NO_GROUND = "#fdfcff";

/** The two colours of a shape: its own, or two tones of the ramp it is drawn in, the last tone twice where there is none after it. */
function tonesOf(shape: AvatarShape, ramp: AvatarRamp): readonly [AvatarColor, AvatarColor] {
  if (Array.isArray(shape.colors)) {
    return [colorOf(shape.colors[0]), colorOf(shape.colors[1])];
  }
  const tones = Array.isArray(ramp.tones) ? ramp.tones : [];
  const at = finite(shape.tone) ? clamp(Math.trunc(shape.tone), 0, tones.length - 1) : 0;
  return [colorOf(tones[at]), colorOf(tones[Math.min(at + 1, tones.length - 1)])];
}

/** The numbers the squares on the ground are strewn by: the same seed, the same squares. */
function strewn(seed: number): () => number {
  let state = 0;
  for (const letter of String(seed)) {
    state = (state * 31 + letter.charCodeAt(0)) >>> 0;
  }
  state = state || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * The side of a square on the ground, where its middle is taken to be from its corner, how far
 * from the middle of the picture the squares keep, and how far from one another.
 */
const SQUARE = 3.4;
const SQUARE_MIDDLE = 1.8;
const SQUARES_KEEP_OFF = 37;
const SQUARES_APART = 11;

/** The squares on the ground: six to eight, clear of the planet and of one another, each with its colour. */
function squaresOf(
  seed: number,
  colors: readonly string[],
): { x: number; y: number; color: AvatarColor }[] {
  const next = strewn(seed);
  const wanted = 6 + Math.floor(next() * 3);
  const places: AvatarPoint[] = [];
  const middle = AVATAR_BOX / 2;
  for (let tries = 0; places.length < wanted && tries < 400; tries += 1) {
    const x = 5 + next() * 87;
    const y = 5 + next() * 87;
    if (length(x + SQUARE_MIDDLE - middle, y + SQUARE_MIDDLE - middle) < SQUARES_KEEP_OFF) {
      continue;
    }
    if (places.some(([px, py]) => length(px - x, py - y) < SQUARES_APART)) {
      continue;
    }
    places.push([x, y]);
  }
  return places.map(([x, y]) => ({
    x: two(x),
    y: two(y),
    color: colorOf(colors.length === 0 ? undefined : colors[Math.floor(next() * colors.length)]),
  }));
}

/** How wide the line of the ground round a shape is: none where it names none, and no wider than the picture. */
const gapOf = (shape: AvatarShape): number =>
  finite(shape.gap) ? clamp(shape.gap, 0, AVATAR_BOX) : 0;

/** How far a layer's shapes reach from the middle of the picture, across or down, once turned. */
function reachOf(shapes: readonly AvatarShape[], turn: number): number {
  const middle = AVATAR_BOX / 2;
  const cos = cosine(turn);
  const sin = sine(turn);
  let far = 0;
  for (const shape of shapes) {
    const margin = gapOf(shape) / 2;
    for (const outline of listOf(shape.outlines)) {
      const path = pathOf(outline);
      for (let at = 0; at < path.length; at += 2) {
        const x = (path[at] ?? 0) - middle;
        const y = (path[at + 1] ?? 0) - middle;
        far = Math.max(
          far,
          Math.abs(x * cos - y * sin) + margin,
          Math.abs(x * sin + y * cos) + margin,
        );
      }
    }
  }
  return far;
}

/** How much of the picture's half a planet drawn larger may reach, with what stands beside it. */
const CLOSE_REACH = 0.94;

/** The picture an avatar's parts name, `side` pixels a side: red, green and blue of each pixel. */
function drawn(parts: RestAvatarParts, side: number, sets: readonly AvatarSet[]): Float32Array {
  const set = avatarSetOf(parts, sets);
  const own = thing(choiceOf(set.ramps, parts.palette)) ?? NO_RAMP;
  const partner = thing(choiceOf(set.ramps, own.partner)) ?? own;
  const body = thing(choiceOf(set.bodies, parts.form));
  const surface = thing(choiceOf(set.surfaces, parts.material)) ?? { tone: 0, shapes: [] };
  const accent = thing(choiceOf(set.accents, parts.accent)) ?? { behind: [], before: [] };
  const ground = colorOf(choiceOf(set.grounds, parts.ground) ?? NO_GROUND);
  const middle = AVATAR_BOX / 2;
  const scale = side / AVATAR_BOX;

  const sheet = sheetOf(side);
  const { pixels } = sheet;
  for (let at = 0; at < pixels.length; at += 3) {
    pixels[at] = ground[0];
    pixels[at + 1] = ground[1];
    pixels[at + 2] = ground[2];
  }
  const all: Frame = { left: 0, top: 0, right: side, bottom: side };
  let corners = MOST_CORNERS;
  /** An outline as a path, while the picture has corners left for it. */
  const pathIn = (outline: AvatarOutline): Path => {
    const path = pathOf(outline);
    if (path.length / 2 > corners) {
      return [];
    }
    corners -= path.length / 2;
    return path;
  };

  // The squares on the ground, faint, which a small picture has no room for.
  if (side >= AVATAR_PLAIN_UNDER) {
    const flat: Placing = { cos: 1, sin: 0, zoom: 1, scale };
    for (const square of squaresOf(
      Math.abs(Math.trunc(finite(parts.vein) ? parts.vein : 0)),
      listOf(set.confetti),
    )) {
      const path: Path = [
        square.x,
        square.y,
        square.x + SQUARE,
        square.y,
        square.x + SQUARE,
        square.y + SQUARE,
        square.x,
        square.y + SQUARE,
      ];
      fill(sheet, pixels, all, [placed(path, flat)], undefined, square.color, square.color, 0.5);
    }
  }

  // The planet is drawn as much larger as its set asks, and that of a small picture closer
  // still: never past what stands beside it leaves room for.
  const fuller = finite(set.fill) ? clamp(set.fill, 1, AVATAR_FILL_MOST) : 1;
  const most = side < AVATAR_CLOSE_UNDER ? Math.max(fuller, AVATAR_CLOSE_MOST) : fuller;
  let zoom = 1;
  if (most > 1) {
    let far = reachOf(
      [{ outlines: listOf(body?.outlines), tone: 0 }, ...thingsOf(body?.behind)],
      0,
    );
    for (const layer of [...thingsOf(accent.behind), ...thingsOf(accent.before)]) {
      far = Math.max(far, reachOf(thingsOf(layer.shapes), finite(layer.turn) ? layer.turn : 0));
    }
    zoom = far > 0 ? clamp((middle * CLOSE_REACH) / far, 1, most) : 1;
  }

  /** One shape, in its ramp, as its layer is turned and cut. */
  const shapeOn = (
    target: Float32Array,
    frame: Frame,
    shape: AvatarShape,
    inRamp: AvatarRamp,
    layer: { readonly turn?: number | undefined; readonly half?: "upper" | "lower" | undefined },
    through?: Float32Array,
  ): void => {
    const turn = finite(layer.turn) ? layer.turn : 0;
    const placing: Placing = { cos: cosine(turn), sin: sine(turn), zoom, scale };
    const split = finite(shape.split) ? shape.split : middle;
    const opacity = finite(shape.opacity) ? clamp(shape.opacity) : 1;
    const outlines = listOf(shape.outlines).map(pathIn);
    const gap = gapOf(shape);
    if (gap > 0) {
      const line = outlines.flatMap((path) => lineAlong(path, gap));
      fill(
        sheet,
        target,
        frame,
        line.map((path) => placed(path, placing)),
        undefined,
        ground,
        ground,
        1,
        through,
      );
    }
    const kept = outlines.map((path) =>
      layer.half === "upper"
        ? cut(path, 0, 1, middle)
        : layer.half === "lower"
          ? cut(path, 0, -1, -middle)
          : path,
    );
    const [lighter, darker] = tonesOf(shape, inRamp);
    fill(
      sheet,
      target,
      frame,
      kept.map((path) => placed(path, placing)),
      kept.map((path) => placed(cut(path, 1, 0, split), placing)),
      lighter,
      darker,
      opacity,
      through,
    );
  };

  for (const shape of thingsOf(body?.behind)) {
    shapeOn(pixels, all, shape, own, {});
  }
  for (const layer of thingsOf(accent.behind)) {
    for (const shape of thingsOf(layer.shapes)) {
      shapeOn(pixels, all, shape, partner, layer);
    }
  }

  // The body: its surface is drawn whole on a sheet of its own, and put on the picture through
  // the body's outline, so that the body's edge is smoothed once.
  if (body !== undefined) {
    const still: Placing = { cos: 1, sin: 0, zoom, scale };
    const mask = new Float32Array(side * side);
    const reach = cover(
      sheet,
      mask,
      listOf(body.outlines).map((outline) => placed(pathIn(outline), still)),
    );
    if (reach.top < reach.bottom) {
      const within: Frame = {
        left: Math.max(0, reach.left - 1),
        top: Math.max(0, reach.top - 1),
        right: Math.min(side, reach.right + 1),
        bottom: Math.min(side, reach.bottom + 1),
      };
      const skin = new Float32Array(side * side * 3);
      const everywhere: AvatarOutline = [
        [-AVATAR_BOX, -AVATAR_BOX],
        [2 * AVATAR_BOX, -AVATAR_BOX],
        [2 * AVATAR_BOX, 2 * AVATAR_BOX],
        [-AVATAR_BOX, 2 * AVATAR_BOX],
      ];
      shapeOn(
        skin,
        within,
        { outlines: [everywhere], tone: finite(surface.tone) ? surface.tone : 0 },
        own,
        {},
      );
      for (const shape of thingsOf(surface.shapes)) {
        shapeOn(skin, within, shape, own, {});
      }
      for (let row = within.top; row < within.bottom; row += 1) {
        for (let column = within.left; column < within.right; column += 1) {
          const cell = row * side + column;
          const share = mask[cell] ?? 0;
          if (share <= 0) {
            continue;
          }
          const pixel = cell * 3;
          for (let color = 0; color < 3; color += 1) {
            const under = pixels[pixel + color] ?? 0;
            pixels[pixel + color] = under + ((skin[pixel + color] ?? 0) - under) * share;
          }
        }
      }
    }
  }

  for (const layer of thingsOf(accent.before)) {
    for (const shape of thingsOf(layer.shapes)) {
      shapeOn(pixels, all, shape, partner, layer);
    }
  }
  return pixels;
}

/** The size a picture is drawn at: a whole number of pixels, from 16 to the most the module writes. */
function pixelsOf(size: number): number {
  const whole = Math.trunc(size);
  if (!Number.isFinite(whole) || whole < 16 || whole > MAX_AVATAR_PIXELS) {
    throw new RangeError(`an avatar is drawn from 16 to ${MAX_AVATAR_PIXELS} pixels a side`);
  }
  return whole;
}

/**
 * The avatar as pixels, `size` a side: three bytes each, red, green and blue, row after row from
 * the top. The same parts give the same bytes wherever they are drawn.
 */
export function avatarPixels(
  parts: RestAvatarParts,
  size: number,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): Uint8Array {
  const side = pixelsOf(size);
  const colors = drawn(parts, side, sets);
  const pixels = new Uint8Array(side * side * 3);
  for (let at = 0; at < pixels.length; at += 1) {
    // A typed array keeps a byte: what is above 255 or under 0 is brought back first.
    pixels[at] = Math.round(clamp(colors[at] ?? 0, 0, 255));
  }
  return pixels;
}

/**
 * The avatar as the rows a PNG file compresses: each row of pixels after the byte that says it
 * is filtered in no way. What comes back from a zlib deflate of these is `pngFile`'s to wrap.
 */
export function avatarScanlines(
  parts: RestAvatarParts,
  size: number,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): Uint8Array {
  const side = pixelsOf(size);
  const pixels = avatarPixels(parts, side, sets);
  const row = side * 3;
  const lines = new Uint8Array(side * (row + 1));
  for (let y = 0; y < side; y += 1) {
    lines.set(pixels.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  }
  return lines;
}

/** The checksum a PNG file keeps of each of its chunks. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One chunk of a PNG file: its length, its name, its bytes and their checksum. */
function chunk(name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = name.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A PNG file of `size` pixels a side, of eight bits a colour and no transparency, from its rows
 * already compressed: `deflated` is the zlib stream of `avatarScanlines`, which the runtime
 * makes (`deflateSync` of `node:zlib`, a `CompressionStream("deflate")` in a browser).
 */
export function pngFile(size: number, deflated: Uint8Array): Uint8Array {
  const side = pixelsOf(size);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  header[8] = 8; // bits a sample
  header[9] = 2; // red, green and blue
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflated),
    chunk("IEND", new Uint8Array(0)),
  ];
  const file = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

/** The most bytes one block of a zlib stream holds unpacked. */
const STORED_BLOCK = 65_535;

/**
 * Bytes as a zlib stream that packs nothing: each block says its length and holds the bytes as
 * they are. Larger than a packed one, and written here, at once, with no help of a runtime: what
 * a picture shown on a page wants, where waiting for a compressor would leave a gap.
 */
function stored(bytes: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(bytes.length / STORED_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + bytes.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let block = 0; block < blocks; block += 1) {
    const from = block * STORED_BLOCK;
    const held = Math.min(STORED_BLOCK, bytes.length - from);
    out[at] = block === blocks - 1 ? 1 : 0;
    out[at + 1] = held & 0xff;
    out[at + 2] = held >>> 8;
    out[at + 3] = ~held & 0xff;
    out[at + 4] = (~held >>> 8) & 0xff;
    out.set(bytes.subarray(from, from + held), at + 5);
    at += 5 + held;
  }
  // The checksum of a zlib stream, of what it holds unpacked.
  let low = 1;
  let high = 0;
  for (const byte of bytes) {
    low = (low + byte) % 65_521;
    high = (high + low) % 65_521;
  }
  out[at] = high >>> 8;
  out[at + 1] = high & 0xff;
  out[at + 2] = low >>> 8;
  out[at + 3] = low & 0xff;
  return out;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes in base64, as an address of a picture holds them. */
function base64(bytes: Uint8Array): string {
  const out: string[] = [];
  let line = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0;
    const b = bytes[at + 1] ?? 0;
    const c = bytes[at + 2] ?? 0;
    line += BASE64.charAt(a >>> 2) + BASE64.charAt(((a & 3) << 4) | (b >>> 4));
    line += at + 1 < bytes.length ? BASE64.charAt(((b & 15) << 2) | (c >>> 6)) : "=";
    line += at + 2 < bytes.length ? BASE64.charAt(c & 63) : "=";
    if (line.length >= 8192) {
      out.push(line);
      line = "";
    }
  }
  out.push(line);
  return out.join("");
}

/** How many pictures are kept drawn for the pages, the ones asked for longest ago let go first. */
const KEPT_PICTURES = 256;
const kept = new WeakMap<readonly AvatarSet[], Map<string, string>>();

/**
 * The avatar as the address of a picture, `data:image/png;base64,…`, `size` pixels a side: what a
 * page gives an `img`. Drawn at once and kept, so that a picture shown in many places, or shown
 * again, is drawn once. The file inside is a whole PNG, larger than a packed one.
 */
export function avatarDataUrl(
  parts: RestAvatarParts,
  size: number,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): string {
  const side = pixelsOf(size);
  let pictures = kept.get(sets);
  if (pictures === undefined) {
    pictures = new Map();
    kept.set(sets, pictures);
  }
  const key = [
    side,
    parts.set,
    parts.palette,
    parts.ground,
    parts.form,
    parts.material,
    parts.accent,
    parts.vein,
  ].join(".");
  const found = pictures.get(key);
  if (found !== undefined) {
    return found;
  }
  const address = `data:image/png;base64,${base64(pngFile(side, stored(avatarScanlines(parts, side, sets))))}`;
  if (pictures.size >= KEPT_PICTURES) {
    const oldest = pictures.keys().next();
    if (oldest.done !== true) {
      pictures.delete(oldest.value);
    }
  }
  pictures.set(key, address);
  return address;
}

/** Numbers from a seed: the same seed gives the same numbers, each from 0 up to but not 1. */
export function seededNumbers(seed: string): () => number {
  // A hash of the text for a start, then a generator of 32 bits; neither is for secrets.
  let start = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    start = Math.imul(start ^ seed.charCodeAt(i), 3432918353);
    start = (start << 13) | (start >>> 19);
  }
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many ways the squares on a ground may be strewn: the seed of one is a byte. */
export const AVATAR_VEINS = 256;

/**
 * The parts a seed gives, of the newest of `sets`: the same seed, the same avatar. A body, a
 * surface and a ramp are rolled alike; nothing stands beside the body a little less than half
 * the time, and the other accents share the rest.
 */
export function rollAvatar(
  seed: string,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): RestAvatarParts {
  const set = avatarSetOf({ set: Number.MAX_SAFE_INTEGER }, sets);
  const next = seededNumbers(`avatar:${seed}`);
  const pick = (choices: number): number => (choices <= 0 ? 0 : Math.floor(next() * choices));
  /** One of the choices after the first, or the first, which is rolled `often` of the time. */
  const perhaps = (choices: number, often: number): number =>
    choices <= 1 || next() < often ? 0 : 1 + pick(choices - 1);
  return {
    set: set.version,
    palette: pick(listOf(set.ramps).length),
    ground: pick(listOf(set.grounds).length),
    form: pick(listOf(set.bodies).length),
    material: pick(listOf(set.surfaces).length),
    accent: perhaps(listOf(set.accents).length, 0.45),
    vein: pick(AVATAR_VEINS),
  };
}
