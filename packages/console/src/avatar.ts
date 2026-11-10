// An agent account's avatar (ADR-0084): flat parts, each an index into a set of shapes, drawn
// by this module where the picture is shown and written out as a picture file where one is
// needed. Nothing drawn is kept: a person object carries the parts, some ninety bytes, and
// whoever shows the picture draws it from them.
//
// The shapes are of three simple kinds, an ellipse, a rounded rectangle and a polygon, each
// filled with one colour of a palette, so that the module draws them itself, as SVG and as
// pixels, with no renderer of anyone else's. Runs in the browser and in the command alike; the
// one thing it leaves to its caller is the compression a PNG file wants, which a runtime has.
//
// A released set never changes: a new look is a new version, and an avatar keeps the version it
// was made with. What is added to this file is a set, never a change to one.

import type { RestAvatarParts } from "./schemas.js";

/** The colours a shape may be filled with, by what they are for; a palette gives each its value. */
export type AvatarFill = "bg" | "alt" | "body" | "shade" | "ink" | "light" | "accent";

/** One palette: a colour per fill, as `#rrggbb`. */
export type AvatarPalette = Readonly<Record<AvatarFill, string>>;

/**
 * A shape on a square of 100 by 100, the origin at the top left: an ellipse by its centre and
 * radii, a rectangle by its corner, its size and the radius of its corners, or a polygon by its
 * points, `x, y` in turn.
 */
export type AvatarShape =
  | {
      readonly kind: "ellipse";
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly fill: AvatarFill;
    }
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly r: number;
      readonly fill: AvatarFill;
    }
  | { readonly kind: "polygon"; readonly points: readonly number[]; readonly fill: AvatarFill };

/** A choice of a part: the shapes it is drawn with, in order; none for a part left out. */
export type AvatarChoice = readonly AvatarShape[];

/**
 * A set of shapes: its version, its palettes, and the choices of each part. Drawn from the back
 * to the front: background, ears, head, marks, eyes, mouth, accessory. The first choice of
 * `ears`, `marks` and `accessory` is none, by convention.
 */
export interface AvatarSet {
  readonly version: number;
  readonly palettes: readonly AvatarPalette[];
  readonly background: readonly AvatarChoice[];
  readonly head: readonly AvatarChoice[];
  readonly ears: readonly AvatarChoice[];
  readonly eyes: readonly AvatarChoice[];
  readonly mouth: readonly AvatarChoice[];
  readonly marks: readonly AvatarChoice[];
  readonly accessory: readonly AvatarChoice[];
}

/** The side of the square the shapes are laid out on. */
export const AVATAR_BOX = 100;
/** The largest picture file the module writes, in pixels a side (ADR-0084). */
export const MAX_AVATAR_PIXELS = 1024;

const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: AvatarFill,
): AvatarShape => ({
  kind: "ellipse",
  cx,
  cy,
  rx,
  ry,
  fill,
});
const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: AvatarFill,
): AvatarShape => ({ kind: "rect", x, y, w, h, r, fill });
const polygon = (points: readonly number[], fill: AvatarFill): AvatarShape => ({
  kind: "polygon",
  points,
  fill,
});

/** A coordinate as a set keeps one: to a hundredth, so that a set reads the same wherever it was built. */
const fixed = (value: number): number => Math.round(value * 100) / 100;

/**
 * A band along an arc, as a polygon: from `from` to `to` degrees, clockwise from three o'clock
 * as the screen has it (`y` downwards), between two radii; with an inner radius of 0, a slice.
 */
function arc(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  from: number,
  to: number,
  fill: AvatarFill,
): AvatarShape {
  const steps = 16;
  const points: number[] = [];
  const at = (radius: number, step: number) => {
    const angle = ((from + ((to - from) * step) / steps) * Math.PI) / 180;
    points.push(fixed(cx + radius * Math.cos(angle)), fixed(cy + radius * Math.sin(angle)));
  };
  for (let step = 0; step <= steps; step += 1) {
    at(outer, step);
  }
  if (inner > 0) {
    for (let step = steps; step >= 0; step -= 1) {
      at(inner, step);
    }
  }
  return polygon(points, fill);
}

const palette = (
  bg: string,
  alt: string,
  body: string,
  shade: string,
  ink: string,
  accent: string,
): AvatarPalette => ({ bg, alt, body, shade, ink, light: "#ffffff", accent });

/** The first set: a round-cornered face of a few shapes, friendly at the size of a chip and of a profile picture alike. */
export const AVATAR_SET_1: AvatarSet = {
  version: 1,
  palettes: [
    palette("#e4e7ff", "#c9cfff", "#5b64e8", "#3d45b8", "#1b1e4b", "#ffb84c"),
    palette("#dbf5f0", "#b5eae0", "#1fa890", "#147a69", "#0c3b34", "#ff7a59"),
    palette("#ffe6de", "#ffcfc0", "#f0654a", "#bf4530", "#4a1a10", "#2f6fe0"),
    palette("#fff1cc", "#ffe299", "#e8a013", "#b37808", "#4a3003", "#2e9e6b"),
    palette("#f0e3ff", "#dfc6ff", "#8e4fe0", "#6a33b3", "#2c1250", "#ffc93c"),
    palette("#e2f6dc", "#c4ecb8", "#46a43a", "#2f7a27", "#153a10", "#f25f8b"),
    palette("#e6ebf0", "#cdd6df", "#5a6b7d", "#3e4c5b", "#1a222b", "#36c2ce"),
    palette("#ffe1ee", "#ffc4dc", "#e0508f", "#b03369", "#4a1230", "#3fb6a8"),
    palette("#dcf0ff", "#b9e0ff", "#2f8fe0", "#1d69ad", "#0b2e4d", "#ffa53c"),
    palette("#f5ebdd", "#e8d6bb", "#b5814a", "#8a5e30", "#3a2610", "#5b64e8"),
  ],
  background: [
    [rect(0, 0, 100, 100, 0, "bg")],
    [rect(0, 0, 100, 100, 0, "bg"), ellipse(50, 58, 46, 46, "alt")],
    [rect(0, 0, 100, 100, 0, "bg"), polygon([0, 100, 100, 100, 100, 35, 0, 70], "alt")],
    [rect(0, 0, 100, 100, 0, "bg"), rect(0, 62, 100, 38, 0, "alt")],
  ],
  head: [
    [rect(24, 30, 52, 52, 14, "body")],
    [ellipse(50, 56, 28, 28, "body")],
    [rect(18, 36, 64, 42, 21, "body")],
    [rect(28, 26, 44, 58, 18, "body")],
    [polygon([50, 26, 76, 41, 76, 71, 50, 86, 24, 71, 24, 41], "body")],
    [ellipse(50, 57, 26, 31, "body")],
  ],
  // Behind the head, which hides where each joins it.
  ears: [
    [],
    [ellipse(29, 33, 9, 9, "shade"), ellipse(71, 33, 9, 9, "shade")],
    [rect(48.5, 12, 3, 30, 1.5, "shade"), ellipse(50, 11, 4.5, 4.5, "accent")],
    [rect(12, 50, 20, 12, 3, "shade"), rect(68, 50, 20, 12, 3, "shade")],
    [polygon([24, 44, 28, 16, 44, 34], "shade"), polygon([76, 44, 72, 16, 56, 34], "shade")],
    [
      rect(36, 16, 3, 26, 1.5, "shade"),
      ellipse(37.5, 15, 3.5, 3.5, "accent"),
      rect(61, 16, 3, 26, 1.5, "shade"),
      ellipse(62.5, 15, 3.5, 3.5, "accent"),
    ],
  ],
  eyes: [
    [ellipse(40, 52, 4, 4, "ink"), ellipse(60, 52, 4, 4, "ink")],
    [
      ellipse(39, 52, 7.5, 7.5, "light"),
      ellipse(61, 52, 7.5, 7.5, "light"),
      ellipse(40, 53, 3.5, 3.5, "ink"),
      ellipse(62, 53, 3.5, 3.5, "ink"),
    ],
    [
      rect(30, 45, 40, 13, 6.5, "ink"),
      ellipse(41, 51.5, 2.6, 2.6, "accent"),
      ellipse(59, 51.5, 2.6, 2.6, "accent"),
    ],
    [ellipse(50, 51, 10, 10, "light"), ellipse(50, 52, 4.5, 4.5, "ink")],
    [rect(34, 51, 11, 3.4, 1.7, "ink"), rect(55, 51, 11, 3.4, 1.7, "ink")],
    [rect(35, 47, 9, 9, 2.5, "ink"), rect(56, 47, 9, 9, 2.5, "ink")],
  ],
  mouth: [
    [arc(50, 62, 9, 6.2, 20, 160, "ink")],
    [rect(42, 66.5, 16, 3.2, 1.6, "ink")],
    [ellipse(50, 68, 5.5, 4.5, "ink")],
    [ellipse(50, 68, 2.8, 2.8, "ink")],
    [
      rect(41, 65, 4, 7, 1.5, "ink"),
      rect(48, 65, 4, 7, 1.5, "ink"),
      rect(55, 65, 4, 7, 1.5, "ink"),
    ],
    [arc(50, 64, 8, 0, 0, 180, "ink")],
  ],
  marks: [
    [],
    [ellipse(33, 62, 4, 2.8, "accent"), ellipse(67, 62, 4, 2.8, "accent")],
    [
      ellipse(34, 60, 1, 1, "shade"),
      ellipse(37, 62.5, 1, 1, "shade"),
      ellipse(31, 62.5, 1, 1, "shade"),
      ellipse(66, 60, 1, 1, "shade"),
      ellipse(69, 62.5, 1, 1, "shade"),
      ellipse(63, 62.5, 1, 1, "shade"),
    ],
    [ellipse(50, 39.5, 2.6, 2.6, "accent")],
    [rect(38, 38.5, 24, 3, 1.5, "shade")],
    [ellipse(50, 74.5, 6, 2.6, "shade")],
  ],
  accessory: [
    [],
    [
      polygon([50, 84, 40, 79, 40, 89], "accent"),
      polygon([50, 84, 60, 79, 60, 89], "accent"),
      ellipse(50, 84, 2.6, 2.6, "shade"),
    ],
    [rect(24, 36, 52, 5, 2.5, "accent")],
    [arc(50, 38, 22, 0, 180, 360, "accent"), rect(44, 35, 34, 4.5, 2.2, "shade")],
    [rect(30, 78, 40, 7, 3.5, "accent"), polygon([58, 82, 66, 82, 68, 95, 60, 95], "accent")],
    [
      arc(50, 52, 31, 27.5, 180, 360, "shade"),
      rect(13, 44, 16, 18, 4, "accent"),
      rect(71, 44, 16, 18, 4, "accent"),
    ],
  ],
};

/** The sets the package ships, the oldest first; an avatar names the one it was made with. */
export const AVATAR_SETS: readonly AvatarSet[] = [AVATAR_SET_1];

/** The parts of an avatar a set gives a choice of, in the order they are drawn. */
export const AVATAR_PARTS = [
  "background",
  "ears",
  "head",
  "marks",
  "eyes",
  "mouth",
  "accessory",
] as const;
export type AvatarPart = (typeof AVATAR_PARTS)[number];

/** The set an avatar was made with, among `sets`; the newest where they hold none of its version. */
export function avatarSetOf(
  parts: Pick<RestAvatarParts, "set">,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): AvatarSet {
  const found = sets.find((set) => set.version === parts.set) ?? sets[sets.length - 1];
  if (found === undefined) {
    throw new Error("no set of shapes to draw an avatar from");
  }
  return found;
}

/** The choice an index names, counted round the end: an index a set does not have still draws. */
function choiceOf<T>(choices: readonly T[], index: number): T | undefined {
  return choices.length === 0 ? undefined : choices[Math.abs(Math.trunc(index)) % choices.length];
}

/** A shape with its colour, as it is drawn. */
export type DrawnShape = AvatarShape & { readonly color: string };

/** What an avatar is drawn with: its shapes, from the back to the front, each with its colour. */
export function avatarShapes(
  parts: RestAvatarParts,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): DrawnShape[] {
  const set = avatarSetOf(parts, sets);
  const colors = choiceOf(set.palettes, parts.palette);
  if (colors === undefined) {
    return [];
  }
  return AVATAR_PARTS.flatMap((part) =>
    (choiceOf(set[part], parts[part]) ?? []).map((shape) => ({
      ...shape,
      color: colors[shape.fill],
    })),
  );
}

/** A number as an attribute holds one: to a hundredth, without a trailing zero. */
const attribute = (value: number): string => String(fixed(value));

/**
 * The avatar as an SVG document, `size` pixels a side: numbers and the palette's colours alone,
 * so that nothing a person typed is in it.
 */
export function avatarSvg(
  parts: RestAvatarParts,
  options: { readonly size?: number; readonly sets?: readonly AvatarSet[] } = {},
): string {
  const size = options.size ?? 512;
  const drawn = avatarShapes(parts, options.sets).map((shape) => {
    if (shape.kind === "ellipse") {
      return `<ellipse cx="${attribute(shape.cx)}" cy="${attribute(shape.cy)}" rx="${attribute(shape.rx)}" ry="${attribute(shape.ry)}" fill="${shape.color}"/>`;
    }
    if (shape.kind === "rect") {
      return `<rect x="${attribute(shape.x)}" y="${attribute(shape.y)}" width="${attribute(shape.w)}" height="${attribute(shape.h)}" rx="${attribute(shape.r)}" fill="${shape.color}"/>`;
    }
    return `<polygon points="${shape.points.map(attribute).join(" ")}" fill="${shape.color}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_BOX} ${AVATAR_BOX}" width="${size}" height="${size}">${drawn.join("")}</svg>`;
}

/** Whether a point of the box is inside a shape. */
function inside(shape: AvatarShape, x: number, y: number): boolean {
  if (shape.kind === "ellipse") {
    const dx = (x - shape.cx) / shape.rx;
    const dy = (y - shape.cy) / shape.ry;
    return dx * dx + dy * dy <= 1;
  }
  if (shape.kind === "rect") {
    if (x < shape.x || y < shape.y || x > shape.x + shape.w || y > shape.y + shape.h) {
      return false;
    }
    const r = Math.min(shape.r, shape.w / 2, shape.h / 2);
    // Within a corner's square, the point is in when it is within the corner's circle.
    const cx = Math.min(Math.max(x, shape.x + r), shape.x + shape.w - r);
    const cy = Math.min(Math.max(y, shape.y + r), shape.y + shape.h - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }
  // A polygon by crossings: a ray to the right crosses its outline an odd number of times.
  const { points } = shape;
  let odd = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i] ?? 0;
    const yi = points[i + 1] ?? 0;
    const xj = points[j] ?? 0;
    const yj = points[j + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      odd = !odd;
    }
  }
  return odd;
}

/** The box a shape lies in: left, top, right, bottom. */
function boundsOf(shape: AvatarShape): readonly [number, number, number, number] {
  if (shape.kind === "ellipse") {
    return [shape.cx - shape.rx, shape.cy - shape.ry, shape.cx + shape.rx, shape.cy + shape.ry];
  }
  if (shape.kind === "rect") {
    return [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h];
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < shape.points.length; i += 2) {
    const x = shape.points[i] ?? 0;
    const y = shape.points[i + 1] ?? 0;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}

/** How finely a pixel on an edge is sampled, a side: sixteen samples say how much of it a shape covers. */
const SAMPLES = 4;

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
 * the top. The shapes are painted from the back to the front, each pixel by how much of it the
 * shape covers, so that an edge is smooth.
 */
export function avatarPixels(
  parts: RestAvatarParts,
  size: number,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): Uint8Array {
  const side = pixelsOf(size);
  const scale = AVATAR_BOX / side;
  const pixels = new Uint8Array(side * side * 3).fill(255);
  for (const shape of avatarShapes(parts, sets)) {
    const red = Number.parseInt(shape.color.slice(1, 3), 16);
    const green = Number.parseInt(shape.color.slice(3, 5), 16);
    const blue = Number.parseInt(shape.color.slice(5, 7), 16);
    const [left, top, right, bottom] = boundsOf(shape);
    const fromX = Math.max(0, Math.floor(left / scale));
    const toX = Math.min(side - 1, Math.ceil(right / scale));
    const fromY = Math.max(0, Math.floor(top / scale));
    const toY = Math.min(side - 1, Math.ceil(bottom / scale));
    for (let py = fromY; py <= toY; py += 1) {
      for (let px = fromX; px <= toX; px += 1) {
        const x = px * scale;
        const y = py * scale;
        // A pixel whose corners and centre agree is all in or all out; one on an edge is sampled.
        const corners =
          (inside(shape, x, y) ? 1 : 0) +
          (inside(shape, x + scale, y) ? 1 : 0) +
          (inside(shape, x, y + scale) ? 1 : 0) +
          (inside(shape, x + scale, y + scale) ? 1 : 0) +
          (inside(shape, x + scale / 2, y + scale / 2) ? 1 : 0);
        if (corners === 0) {
          continue;
        }
        let cover = 1;
        if (corners < 5) {
          let hits = 0;
          for (let sy = 0; sy < SAMPLES; sy += 1) {
            for (let sx = 0; sx < SAMPLES; sx += 1) {
              if (
                inside(
                  shape,
                  x + ((sx + 0.5) * scale) / SAMPLES,
                  y + ((sy + 0.5) * scale) / SAMPLES,
                )
              ) {
                hits += 1;
              }
            }
          }
          cover = hits / (SAMPLES * SAMPLES);
        }
        const at = (py * side + px) * 3;
        pixels[at] = Math.round((pixels[at] ?? 0) + (red - (pixels[at] ?? 0)) * cover);
        pixels[at + 1] = Math.round(
          (pixels[at + 1] ?? 0) + (green - (pixels[at + 1] ?? 0)) * cover,
        );
        pixels[at + 2] = Math.round((pixels[at + 2] ?? 0) + (blue - (pixels[at + 2] ?? 0)) * cover);
      }
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

/** Numbers from a seed: the same seed gives the same numbers, each from 0 up to but not 1. */
export function seededNumbers(seed: string): () => number {
  // A hash of the text for a start, then a generator of 32 bits; neither is for secrets.
  let hash = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The parts a seed gives, of the newest of `sets`: the same seed, the same avatar. A part that
 * may be left out is left out about one time in three, so that a face is not always crowded.
 */
export function rollAvatar(
  seed: string,
  sets: readonly AvatarSet[] = AVATAR_SETS,
): RestAvatarParts {
  const set = avatarSetOf({ set: Number.MAX_SAFE_INTEGER }, sets);
  const next = seededNumbers(`avatar:${seed}`);
  const pick = (choices: readonly unknown[]): number =>
    choices.length === 0 ? 0 : Math.floor(next() * choices.length);
  /** One of the choices after the first, which is none; or none. */
  const perhaps = (choices: readonly unknown[]): number =>
    choices.length <= 1 || next() < 1 / 3 ? 0 : 1 + Math.floor(next() * (choices.length - 1));
  return {
    set: set.version,
    background: pick(set.background),
    head: pick(set.head),
    ears: perhaps(set.ears),
    eyes: pick(set.eyes),
    mouth: pick(set.mouth),
    marks: perhaps(set.marks),
    accessory: perhaps(set.accessory),
    palette: pick(set.palettes),
  };
}
