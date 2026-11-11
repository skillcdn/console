// An agent account's avatar (ADR-0084, ADR-0093): a small still life, one form cut from a
// material and set on a quiet ground, with something small beside it or nothing. Its parts are a
// few numbers, each a place in a set, and this module draws the picture from them wherever it is
// shown and writes it out as a picture file where one is needed. Nothing drawn is kept: a person
// object carries the parts, some seventy bytes, and whoever shows the picture draws it.
//
// The picture is a function of a point: what colour the still life has there. A form is a
// distance to its outline, a material the colour of a stone at a point, and the grain of the
// stone comes from numbers a seed gives. So the module draws by itself, with no renderer of
// anyone else's, in the browser and in the command alike, and the same parts give the same
// pixels on every machine: nothing here is computed with a function a runtime may round its own
// way (no sine, no exponential), only with sums, products and square roots.
//
// A released set never changes: a new look is a new version, and an avatar keeps the version it
// was made with. What is added to this file is a set, never a change to one.

import type { RestAvatarParts } from "./schemas.js";

/** A colour: red, green and blue, each from 0 to 255. */
export type AvatarColor = readonly [number, number, number];

/** One palette, each colour as `#rrggbb`. */
export interface AvatarPalette {
  /** What stands behind the form, and under it a shade darker or lighter. */
  readonly wall: string;
  /** The body of the material the form is cut from. */
  readonly stone: string;
  /** What runs through the stone: its veins, its chips, its layers. */
  readonly vein: string;
  /** The colour of what stands beside the form, and of a chip here and there. */
  readonly accent: string;
}

/** A palette as the drawing takes it: its colours as numbers. */
export interface AvatarColors {
  readonly wall: AvatarColor;
  readonly stone: AvatarColor;
  readonly vein: AvatarColor;
  readonly accent: AvatarColor;
}

/**
 * A form: how far a point of the picture is from its outline, negative inside. The picture is a
 * square of side 1, the origin at the top left, and a form stands on the floor at `AVATAR_FLOOR`.
 */
export type AvatarForm = (x: number, y: number) => number;

/**
 * A material: given the seed of its grain and the palette, the colour of the stone at a point.
 * The seed is a whole number; the same seed gives the same stone.
 */
export type AvatarMaterial = (
  seed: number,
  colors: AvatarColors,
) => (x: number, y: number) => AvatarColor;

/** What the form stands before: a wall and a floor, a wall alone, a pale disc on the wall, or a niche in it. */
export type AvatarGround = "floor" | "plain" | "disc" | "niche";

/** What stands beside the form: nothing, a ball behind it, a bar, a small disc up on the wall, or a pebble before it. */
export type AvatarAccent = "none" | "ball" | "bar" | "sun" | "pebble";

/**
 * A set: its version, its palettes, and the choices of each part. The first accent is none, by
 * convention, and the first material is the set's own, rolled more often than the others.
 */
export interface AvatarSet {
  readonly version: number;
  readonly palettes: readonly AvatarPalette[];
  readonly grounds: readonly AvatarGround[];
  readonly forms: readonly AvatarForm[];
  readonly materials: readonly AvatarMaterial[];
  readonly accents: readonly AvatarAccent[];
}

/** How far down the picture the floor is, on which every form stands. */
export const AVATAR_FLOOR = 0.78;
/** The largest picture file the module writes, in pixels a side (ADR-0084). */
export const MAX_AVATAR_PIXELS = 1024;

// Numbers

const clamp = (value: number, low = 0, high = 1): number => Math.min(Math.max(value, low), high);
const mix = (from: number, to: number, by: number): number => from + (to - from) * by;
/** From 0 at `from` to 1 at `to`, eased at both ends; `from` may be the larger. */
function smooth(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}
const fract = (value: number): number => value - Math.floor(value);
const length = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** A number from 0 up to but not 1 for a cell of a grid and a seed: the same three, the same number. */
function hash(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Noise that runs smoothly from one cell of the grid to the next, from 0 to 1. */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Noise of several sizes laid over one another, each half as strong and twice as fine. */
function clouds(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let strength = 0.5;
  let total = 0;
  let px = x;
  let py = y;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += strength * noise(px, py, seed + octave * 17);
    total += strength;
    px = px * 2.03 + 11.7;
    py = py * 2.03 + 5.3;
    strength *= 0.5;
  }
  return sum / total;
}

/** A direction from a number from 0 to 1: a half turn, as its two parts, with no sine. */
function direction(turn: number): readonly [number, number] {
  const across = 1 - 2 * turn;
  return [across, Math.sqrt(Math.max(0, 1 - across * across))];
}

// Colours

const BLACK: AvatarColor = [0, 0, 0];
const WHITE: AvatarColor = [255, 255, 255];

function blend(from: AvatarColor, to: AvatarColor, by: number): AvatarColor {
  return [mix(from[0], to[0], by), mix(from[1], to[1], by), mix(from[2], to[2], by)];
}
const lit = (color: AvatarColor, by: number): AvatarColor => [
  color[0] * by,
  color[1] * by,
  color[2] * by,
];

/** A colour written `#rrggbb` as its three numbers; black where it is not written so. */
function colorOf(hex: string): AvatarColor {
  const read = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16);
    return Number.isFinite(value) ? value : 0;
  };
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? [read(1), read(3), read(5)] : BLACK;
}

// Forms

const disc = (x: number, y: number, cx: number, cy: number, r: number): number =>
  length(x - cx, y - cy) - r;

/** A rectangle by its centre and half its sides, its corners rounded by `r`. */
function slab(
  x: number,
  y: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  r: number,
): number {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  return length(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

/** A doorway on the floor: half as wide as `hw` each side of the middle, round at the top, which is at `top`. */
function doorway(x: number, y: number, hw: number, top: number, floor = AVATAR_FLOOR): number {
  return Math.min(
    disc(x, y, 0.5, top + hw, hw),
    slab(x, y, 0.5, (top + hw + floor) / 2, hw, (floor - top - hw) / 2, 0),
  );
}

/** A triangle by its three corners. */
function triangle(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const e0x = bx - ax;
  const e0y = by - ay;
  const e1x = cx - bx;
  const e1y = cy - by;
  const e2x = ax - cx;
  const e2y = ay - cy;
  const v0x = x - ax;
  const v0y = y - ay;
  const v1x = x - bx;
  const v1y = y - by;
  const v2x = x - cx;
  const v2y = y - cy;
  const k0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y));
  const k1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y));
  const k2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y));
  const p0x = v0x - e0x * k0;
  const p0y = v0y - e0y * k0;
  const p1x = v1x - e1x * k1;
  const p1y = v1y - e1y * k1;
  const p2x = v2x - e2x * k2;
  const p2y = v2y - e2y * k2;
  const nearest = Math.min(p0x * p0x + p0y * p0y, p1x * p1x + p1y * p1y, p2x * p2x + p2y * p2y);
  const way = e0x * e2y - e0y * e2x < 0 ? -1 : 1;
  const within = Math.min(
    way * (v0x * e0y - v0y * e0x),
    way * (v1x * e1y - v1y * e1x),
    way * (v2x * e2y - v2y * e2x),
  );
  return within > 0 ? -Math.sqrt(nearest) : Math.sqrt(nearest);
}

const F = AVATAR_FLOOR;

/** The forms of the first set: twelve outlines a child could name, each standing on the floor. */
const FORMS_1: readonly AvatarForm[] = [
  // An orb.
  (x, y) => disc(x, y, 0.5, F - 0.3, 0.3),
  // An arch: a doorway, round at the top.
  (x, y) => doorway(x, y, 0.235, 0.17),
  // A dome: half a disc on the floor.
  (x, y) => Math.max(disc(x, y, 0.5, F, 0.36), y - F),
  // A block: a soft square.
  (x, y) => slab(x, y, 0.5, F - 0.265, 0.265, 0.265, 0.07),
  // A pill, standing.
  (x, y) => slab(x, y, 0.5, F - 0.31, 0.19, 0.31, 0.19),
  // A moon: a disc with a bite out of it.
  (x, y) => Math.max(disc(x, y, 0.48, F - 0.3, 0.3), -disc(x, y, 0.64, F - 0.4, 0.24)),
  // A ring.
  (x, y) => Math.abs(disc(x, y, 0.5, F - 0.3, 0.215)) - 0.085,
  // A leaf: where two discs meet.
  (x, y) => Math.max(disc(x, y, 0.31, F - 0.31, 0.37), disc(x, y, 0.69, F - 0.31, 0.37)),
  // A gate: an arch with an arch cut out of it.
  (x, y) =>
    Math.max(
      doorway(x, y, 0.29, 0.18),
      -Math.min(disc(x, y, 0.5, 0.49, 0.125), slab(x, y, 0.5, 0.7, 0.125, 0.21, 0)),
    ),
  // A quarter of a disc.
  (x, y) => Math.max(disc(x, y, 0.23, F, 0.54), Math.max(y - F, 0.23 - x)),
  // A peak.
  (x, y) => triangle(x, y, 0.5, 0.2, 0.79, F - 0.03, 0.21, F - 0.03) - 0.03,
  // A gem: a square on its corner.
  (x, y) => (Math.abs(x - 0.5) + Math.abs(y - (F - 0.32)) - 0.3) * Math.SQRT1_2 - 0.02,
];

// Materials

/** How near a point is to a vein, from 0 to 1 on it: lines across the stone, pushed about by clouds. */
function veins(
  x: number,
  y: number,
  seed: number,
  frequency: number,
  wander: number,
  along: readonly [number, number],
): number {
  const px = x + (clouds(x * 2.2, y * 2.2, seed, 4) - 0.5) * wander;
  const py = y + (clouds(x * 2.2 + 31.4, y * 2.2 + 7.9, seed + 3, 4) - 0.5) * wander;
  return 1 - Math.abs(2 * fract((px * along[0] + py * along[1]) * frequency) - 1);
}

/** Marble: a cloudy body, a few sharp veins of uneven width, and fainter ones across them. */
const marble: AvatarMaterial = (seed, colors) => {
  const first = direction(hash(1, 2, seed));
  const second = direction(hash(2, 1, seed));
  const cloudy = blend(colors.stone, colors.vein, 0.34);
  return (x, y) => {
    const body = blend(
      colors.stone,
      cloudy,
      smooth(0.35, 0.8, clouds(x * 2.6, y * 2.6, seed + 40, 4)),
    );
    const width = 0.9 + 0.09 * clouds(x * 5, y * 5, seed + 9, 2);
    const strong = smooth(width, 1, veins(x, y, seed, 1.7, 0.55, first));
    const faint = smooth(0.955, 1, veins(x + 3.1, y + 1.7, seed + 21, 3.1, 0.4, second));
    return blend(body, colors.vein, clamp(strong * 0.9 + faint * 0.45));
  };
};

/** Terrazzo: chips of four tones, each with corners, set in the stone. */
const terrazzo: AvatarMaterial = (seed, colors) => {
  const shade = blend(colors.stone, BLACK, 0.35);
  const tones = (pick: number): AvatarColor =>
    pick < 0.42 ? colors.vein : pick < 0.72 ? colors.accent : pick < 0.9 ? shade : colors.wall;
  return (x, y) => {
    const gx = x * 7.5;
    const gy = y * 7.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    let nearest = 9;
    let pick = 0;
    for (let j = -1; j <= 1; j += 1) {
      for (let i = -1; i <= 1; i += 1) {
        const cellX = ix + i;
        const cellY = iy + j;
        const dx = gx - (cellX + 0.15 + 0.7 * hash(cellX, cellY, seed));
        const dy = gy - (cellY + 0.15 + 0.7 * hash(cellX, cellY, seed + 1));
        // A chip with corners: the distance in a frame turned and squeezed.
        const turned = direction(hash(cellX, cellY, seed + 3));
        const ux = Math.abs(dx * turned[0] + dy * turned[1]);
        const uy = Math.abs(dy * turned[0] - dx * turned[1]);
        const distance =
          (ux * 0.8 + uy * 1.25 + Math.max(ux, uy) * 0.4) / 1.4 -
          (0.16 + 0.3 * hash(cellX, cellY, seed + 2));
        if (distance < nearest) {
          nearest = distance;
          pick = hash(cellX, cellY, seed + 4);
        }
      }
    }
    const body = blend(colors.stone, colors.vein, 0.08 + 0.06 * clouds(x * 9, y * 9, seed + 8, 2));
    return blend(tones(pick), body, smooth(-0.02, 0.02, nearest));
  };
};

/** Strata: layers laid down one on another, a little wavy, of three tones and now and then the accent. */
const strata: AvatarMaterial = (seed, colors) => {
  const middle = blend(colors.stone, colors.vein, 0.55);
  const tone = (layer: number): AvatarColor => {
    const pick = hash(layer, 7, seed);
    return pick < 0.34
      ? colors.stone
      : pick < 0.67
        ? middle
        : pick < 0.9
          ? colors.vein
          : colors.accent;
  };
  return (x, y) => {
    const t = (y + (clouds(x * 1.6, y * 1.6, seed, 3) - 0.5) * 0.22 + x * 0.12) * 7;
    const layer = Math.floor(t);
    return blend(tone(layer), tone(layer + 1), smooth(0.94, 1, t - layer));
  };
};

/** Speckle: a fine stone, small grains of three tones in a body that drifts. */
const speckle: AvatarMaterial = (seed, colors) => {
  const dark = blend(colors.stone, BLACK, 0.4);
  const warm = blend(colors.stone, colors.accent, 0.6);
  return (x, y) => {
    let color = blend(
      colors.stone,
      colors.vein,
      0.08 + 0.2 * clouds(x * 3.2, y * 3.2, seed + 2, 3),
    );
    const gx = x * 15;
    const gy = y * 15;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    for (let j = -1; j <= 1; j += 1) {
      for (let i = -1; i <= 1; i += 1) {
        const cellX = ix + i;
        const cellY = iy + j;
        const pick = hash(cellX, cellY, seed + 4);
        if (pick > 0.62) {
          continue;
        }
        const distance =
          length(
            gx - (cellX + hash(cellX, cellY, seed)),
            (gy - (cellY + hash(cellX, cellY, seed + 1))) * 1.3,
          ) -
          (0.1 + 0.2 * hash(cellX, cellY, seed + 2));
        const grain = pick < 0.3 ? colors.vein : pick < 0.5 ? dark : warm;
        color = blend(grain, color, smooth(-0.04, 0.06, distance));
      }
    }
    return color;
  };
};

/** Glaze: smooth, the stone running into a lighter tone of itself across the form. */
const glaze: AvatarMaterial = (seed, colors) => {
  const along = direction(hash(3, 4, seed));
  const way = hash(4, 3, seed) < 0.5 ? -1 : 1;
  const run = blend(colors.stone, colors.vein, 0.5);
  return (x, y) => {
    const t =
      0.5 +
      ((x - 0.5) * along[0] + (y - 0.5) * along[1] * way) * 1.5 +
      (clouds(x * 1.8, y * 1.8, seed, 3) - 0.5) * 0.5;
    return blend(colors.stone, run, smooth(0.25, 0.9, t));
  };
};

/** Onyx: bands round a point under the floor, as a stone cut across its rings shows them. */
const onyx: AvatarMaterial = (seed, colors) => {
  const middle = blend(colors.stone, colors.vein, 0.5);
  const centre = 0.2 + 0.6 * hash(5, 6, seed);
  const tone = (band: number): AvatarColor => {
    const pick = hash(band, 3, seed);
    return pick < 0.45 ? colors.stone : pick < 0.8 ? middle : colors.vein;
  };
  return (x, y) => {
    const t =
      (length(x - centre, y - 0.95) + (clouds(x * 2.4, y * 2.4, seed, 3) - 0.5) * 0.16) * 11;
    const band = Math.floor(t);
    return blend(tone(band), tone(band + 1), smooth(0.8, 1, t - band));
  };
};

const palette = (wall: string, stone: string, vein: string, accent: string): AvatarPalette => ({
  wall,
  stone,
  vein,
  accent,
});

/**
 * The first set: twelve forms, six materials and twelve palettes named after stones, on four
 * grounds, with one of four small things beside the form or none.
 */
export const AVATAR_SET_1: AvatarSet = {
  version: 1,
  palettes: [
    palette("#c9b8a8", "#f3efe9", "#8f8a86", "#b4543a"),
    palette("#d8d2c8", "#232327", "#e9e3d7", "#c59b3f"),
    palette("#e3e2d6", "#27503f", "#b9d2c1", "#d9a55a"),
    palette("#efe1d5", "#b2533a", "#f1cdb9", "#274456"),
    palette("#e2e3ea", "#263f8f", "#a9b9ea", "#d8b25a"),
    palette("#5f6b55", "#dcc8ab", "#b2946c", "#ecdfc9"),
    palette("#6d3a48", "#ecc3bf", "#fbeae6", "#f3d9a4"),
    palette("#ece7dc", "#7fa58d", "#d6e6d8", "#cf6f52"),
    palette("#e9e3ec", "#5b3d70", "#cbb6dc", "#e0b85c"),
    palette("#2c3654", "#d9a133", "#f4dc9c", "#f0e7d2"),
    palette("#e3e5e6", "#4b5967", "#b3c0cb", "#e88456"),
    palette("#33475b", "#a5d2d2", "#eaf6f4", "#f2c9a0"),
  ],
  grounds: ["floor", "plain", "disc", "niche"],
  forms: FORMS_1,
  materials: [marble, terrazzo, strata, speckle, glaze, onyx],
  accents: ["none", "ball", "bar", "sun", "pebble"],
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

/** The choice an index names, counted round the end: an index a set does not have still draws. */
function choiceOf<T>(choices: readonly T[], index: number): T | undefined {
  return choices.length === 0 ? undefined : choices[Math.abs(Math.trunc(index)) % choices.length];
}

/** The colour of the picture at a point, given how wide a sample is: what a drawing computes once and asks of often. */
type Scene = (x: number, y: number, sample: number) => AvatarColor;

/** How much of a sample a shape covers, from its distance there: an edge is smooth so. */
const cover = (distance: number, sample: number): number => clamp(0.5 - distance / sample);

/** The still life an avatar's parts name, ready to be asked the colour of its points. */
function sceneOf(parts: RestAvatarParts, sets: readonly AvatarSet[]): Scene {
  const set = avatarSetOf(parts, sets);
  const named = choiceOf(set.palettes, parts.palette);
  const colors: AvatarColors = {
    wall: colorOf(named?.wall ?? "#dddddd"),
    stone: colorOf(named?.stone ?? "#888888"),
    vein: colorOf(named?.vein ?? "#bbbbbb"),
    accent: colorOf(named?.accent ?? "#555555"),
  };
  const { wall, accent: accentColor } = colors;
  const form = choiceOf(set.forms, parts.form) ?? (() => 1);
  const stone = (choiceOf(set.materials, parts.material) ?? (() => () => colors.stone))(
    Math.abs(Math.trunc(parts.vein)) * 101 + 7,
    colors,
  );
  const ground = choiceOf(set.grounds, parts.ground) ?? "plain";
  const accent = choiceOf(set.accents, parts.accent) ?? "none";
  // A pale wall has a floor a shade darker and a paler disc; a dark wall, the other way.
  const pale = (wall[0] + wall[1] + wall[2]) / 3 > 140;
  const floor = blend(wall, pale ? BLACK : WHITE, 0.07);
  const glow = blend(wall, WHITE, pale ? 0.45 : 0.1);
  return (x, y, sample) => {
    // The ground.
    let color = wall;
    if (ground === "disc") {
      color = blend(glow, color, 1 - cover(disc(x, y, 0.5, 0.44, 0.38), sample));
    } else if (ground === "niche") {
      color = blend(glow, color, 1 - cover(doorway(x, y, 0.36, 0.08, 1.2), sample));
    }
    if (ground !== "plain") {
      color = blend(color, floor, clamp(0.5 + (y - F) / sample));
    }
    // The light comes from the upper left, a little.
    const light = 1 + 0.05 * (1 - x - y);
    color = lit(color, light);

    const distance = form(x, y);
    // Under the form the floor is in shadow, and behind it the wall, softly.
    const sx = (x - 0.53) / 0.4;
    const sy = (y - (F + 0.015)) / 0.035;
    const under = clamp(1 - (sx * sx + sy * sy) / 1.9);
    color = blend(color, BLACK, 0.3 * under * under);
    color = blend(color, BLACK, 0.1 * smooth(0.03, -0.03, form(x - 0.035, y - 0.02)));

    // What stands beside the form and behind it.
    if (accent === "ball") {
      const at = disc(x, y, 0.84, F - 0.085, 0.085);
      color = blend(
        color,
        lit(accentColor, light * (1 - 0.18 * smooth(-0.1, 0, at))),
        cover(at, sample),
      );
    } else if (accent === "bar") {
      color = blend(
        color,
        lit(accentColor, light),
        cover(slab(x, y, 0.13, F - 0.21, 0.045, 0.21, 0.045), sample),
      );
    } else if (accent === "sun") {
      color = blend(color, lit(accentColor, light), cover(disc(x, y, 0.8, 0.19, 0.075), sample));
    }

    // The form: its stone, a little darker towards the lower right edge and lighter towards the
    // upper left one, as a thing with a thickness is.
    const inside = cover(distance, sample);
    if (inside > 0) {
      const edge = 1 - smooth(0, -0.09, distance);
      const side = (x - 0.5) * 0.7 + (y - 0.45) * 0.7;
      const volume =
        1.04 - 0.16 * edge * smooth(-0.2, 0.3, side) + 0.05 * edge * smooth(0.2, -0.3, side);
      color = blend(color, lit(stone(x, y), volume * light), inside);
    }

    // What stands before it.
    if (accent === "pebble") {
      const at = disc(x, y, 0.2, F - 0.03, 0.075);
      const round = smooth(-0.08, 0, at) * smooth(-0.1, 0.1, x - 0.2 + (y - F + 0.04));
      color = blend(color, lit(accentColor, light * (1 - 0.2 * round)), cover(at, sample));
    }

    // A grain over it all, as paper has.
    const grain = (hash(Math.floor(x * 997), Math.floor(y * 997), 5) - 0.5) * 5;
    return [color[0] + grain, color[1] + grain, color[2] + grain];
  };
}

/** The size a picture is drawn at: a whole number of pixels, from 16 to the most the module writes. */
function pixelsOf(size: number): number {
  const whole = Math.trunc(size);
  if (!Number.isFinite(whole) || whole < 16 || whole > MAX_AVATAR_PIXELS) {
    throw new RangeError(`an avatar is drawn from 16 to ${MAX_AVATAR_PIXELS} pixels a side`);
  }
  return whole;
}

/** From this many pixels a side, a pixel is asked once; under it, four times, so that a small picture is not rough. */
const ONE_SAMPLE_FROM = 96;

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
  const scene = sceneOf(parts, sets);
  const each = side >= ONE_SAMPLE_FROM ? 1 : 2;
  const sample = 1 / (side * each);
  const pixels = new Uint8Array(side * side * 3);
  for (let py = 0; py < side; py += 1) {
    for (let px = 0; px < side; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < each; sy += 1) {
        for (let sx = 0; sx < each; sx += 1) {
          const color = scene(
            (px + (sx + 0.5) / each) / side,
            (py + (sy + 0.5) / each) / side,
            sample,
          );
          red += color[0];
          green += color[1];
          blue += color[2];
        }
      }
      const at = (py * side + px) * 3;
      const samples = each * each;
      // A typed array keeps a byte: what is above 255 or under 0 is brought back first.
      pixels[at] = Math.round(clamp(red / samples, 0, 255));
      pixels[at + 1] = Math.round(clamp(green / samples, 0, 255));
      pixels[at + 2] = Math.round(clamp(blue / samples, 0, 255));
    }
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
  let drawn = kept.get(sets);
  if (drawn === undefined) {
    drawn = new Map();
    kept.set(sets, drawn);
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
  const found = drawn.get(key);
  if (found !== undefined) {
    return found;
  }
  const address = `data:image/png;base64,${base64(pngFile(side, stored(avatarScanlines(parts, side, sets))))}`;
  if (drawn.size >= KEPT_PICTURES) {
    const oldest = drawn.keys().next();
    if (oldest.done !== true) {
      drawn.delete(oldest.value);
    }
  }
  drawn.set(key, address);
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

/** How many grains a stone may have: the seed of one is a byte. */
export const AVATAR_VEINS = 256;

/**
 * The parts a seed gives, of the newest of `sets`: the same seed, the same avatar. The set's own
 * material, its first, is rolled about one time in three and the others share the rest; something
 * stands beside the form a little more than one time in two.
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
    palette: pick(set.palettes.length),
    ground: pick(set.grounds.length),
    form: pick(set.forms.length),
    material: perhaps(set.materials.length, 0.3),
    accent: perhaps(set.accents.length, 0.45),
    vein: pick(AVATAR_VEINS),
  };
}
