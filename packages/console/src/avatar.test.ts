import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  AVATAR_BOX,
  AVATAR_CLOSE_MOST,
  AVATAR_CLOSE_UNDER,
  AVATAR_FILL_MOST,
  AVATAR_PLAIN_UNDER,
  AVATAR_SET_1,
  AVATAR_SETS,
  AVATAR_VEINS,
  type AvatarOutline,
  type AvatarSet,
  avatarDataUrl,
  avatarPixels,
  avatarScanlines,
  avatarSetOf,
  MAX_AVATAR_PIXELS,
  pngFile,
  rollAvatar,
  seededNumbers,
} from "./avatar.js";
import { restAvatarPartsSchema } from "./schemas.js";

/** A disc with straight bands, in the first ramp, with nothing beside it: the plainest picture of the set. */
const PLAIN = {
  set: 1,
  palette: 0,
  ground: 0,
  form: 0,
  material: 0,
  accent: 0,
  vein: 0,
} as const;

/** The parts whose choices a set lists, with what the set calls each list. */
const LISTS = [
  ["palette", "ramps"],
  ["ground", "grounds"],
  ["form", "bodies"],
  ["material", "surfaces"],
  ["accent", "accents"],
] as const;

/** The ground of the first set, and the first two tones of its first ramp. */
const GROUND = [81, 82, 92];
const LIGHT = [255, 214, 67];
const DARK = [255, 176, 82];

/** A square, its corners in turn the way the set's outlines run. */
const square = (left: number, top: number, right: number, bottom: number): AvatarOutline => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
];

/** A set of one's own with one of everything: a white square body on a black ground, nothing on it and nothing beside it. */
const OWN: AvatarSet = {
  version: 1000,
  grounds: ["#000000"],
  confetti: [],
  ramps: [{ tones: ["#ffffff", "#808080"], partner: 0 }],
  bodies: [{ outlines: [square(25, 25, 75, 75)] }],
  surfaces: [{ tone: 0, shapes: [] }],
  accents: [{ behind: [], before: [] }],
};
const OWN_PARTS = { ...PLAIN, set: 1000 } as const;

/** The pixels of a picture, asked by place. */
function reader(pixels: Uint8Array, side: number): (x: number, y: number) => number[] {
  return (x, y) => [...pixels.subarray((y * side + x) * 3, (y * side + x) * 3 + 3)];
}

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe("an agent account's avatar (ADR-0084, ADR-0097)", () => {
  it("is drawn from a set that never changes once released", () => {
    // What an avatar looks like is this set for good: a new look is a set with another version,
    // added beside it, and never an edit of this one. The set is data, every corner of every
    // outline, so its look is held by a digest of it; and how the module fills it, by a digest
    // of what it draws: every body with every surface, every ramp, every accent, small and
    // large. If the first fails, a released set was changed; if the second alone, the drawing.
    expect(AVATAR_SET_1.version).toBe(1);
    expect(createHash("sha256").update(JSON.stringify(AVATAR_SET_1)).digest("hex")).toBe(
      "9edb9f0eb3335173eef706ef4f9ce45af76411dd173165f9996e4948be7c1dcf",
    );
    const look = createHash("sha256");
    for (let form = 0; form < AVATAR_SET_1.bodies.length; form += 1) {
      for (let material = 0; material < AVATAR_SET_1.surfaces.length; material += 1) {
        look.update(
          avatarPixels(
            {
              set: 1,
              palette: (form * 5 + material) % AVATAR_SET_1.ramps.length,
              ground: 0,
              form,
              material,
              accent: (form + material) % AVATAR_SET_1.accents.length,
              vein: form * 16 + material,
            },
            form % 2 === 0 ? 32 : 112,
          ),
        );
      }
    }
    for (let palette = 0; palette < AVATAR_SET_1.ramps.length; palette += 1) {
      look.update(avatarPixels({ ...PLAIN, palette, accent: palette % 6, vein: palette }, 48));
    }
    expect(look.digest("hex")).toBe(
      "b292262f908910baf9326d67d9e53c09edfd69be874956b02e9505e34bc50e64",
    );
    expect(AVATAR_SETS.map((set) => set.version)).toEqual([1]);
    // Four bodies, ten surfaces, eighteen ramps of five tones and five things beside the body
    // or nothing, which is the first of the accents; one ground.
    expect(AVATAR_SET_1.bodies).toHaveLength(4);
    expect(AVATAR_SET_1.surfaces).toHaveLength(10);
    expect(AVATAR_SET_1.ramps).toHaveLength(18);
    expect(AVATAR_SET_1.accents).toHaveLength(6);
    expect(AVATAR_SET_1.accents[0]).toEqual({ behind: [], before: [] });
    expect(AVATAR_SET_1.grounds).toEqual(["#51525c"]);
    for (const ramp of AVATAR_SET_1.ramps) {
      expect(ramp.tones).toHaveLength(5);
      for (const tone of ramp.tones) {
        expect(tone).toMatch(/^#[0-9a-f]{6}$/);
      }
      // The ramp that goes with it is another of the set.
      expect(AVATAR_SET_1.ramps[ramp.partner]).toBeDefined();
      expect(AVATAR_SET_1.ramps[ramp.partner]).not.toBe(ramp);
    }
    for (const color of AVATAR_SET_1.confetti) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Every body lies about the middle of the picture and well within it, and what stands
    // beside it stays in the picture too.
    const middle = AVATAR_BOX / 2;
    // A curve is laid out by a sine of the module's own: the corners of the first body are all
    // 27 from the middle, and those at each quarter of the way round are where a disc has them.
    const round = AVATAR_SET_1.bodies[0]?.outlines[0] ?? [];
    expect(round.length % 4).toBe(0);
    for (const [x, y] of round) {
      expect(Math.hypot(x - middle, y - middle)).toBeCloseTo(27, 9);
    }
    for (const [quarter, [x, y]] of [
      [0, [77, 50]],
      [1, [50, 77]],
      [2, [23, 50]],
      [3, [50, 23]],
    ] as const) {
      const corner = round[(quarter * round.length) / 4] ?? [0, 0];
      expect(corner[0]).toBeCloseTo(x, 9);
      expect(corner[1]).toBeCloseTo(y, 9);
    }
    // And between them where the runtime's own sine has them, to the last places.
    for (const [index, [x, y]] of round.entries()) {
      const turn = (2 * Math.PI * index) / round.length;
      expect(x).toBeCloseTo(middle + 27 * Math.cos(turn), 9);
      expect(y).toBeCloseTo(middle + 27 * Math.sin(turn), 9);
    }
    for (const [index, body] of AVATAR_SET_1.bodies.entries()) {
      const far = Math.max(
        ...body.outlines
          .flat()
          .map(([x, y]) => Math.max(Math.abs(x - middle), Math.abs(y - middle))),
      );
      expect(far, `body ${index}`).toBeGreaterThan(20);
      expect(far, `body ${index}`).toBeLessThan(32);
    }
    for (const [index, accent] of AVATAR_SET_1.accents.entries()) {
      for (const layer of [...accent.behind, ...accent.before]) {
        for (const shape of layer.shapes) {
          for (const [x, y] of shape.outlines.flat()) {
            expect(Math.hypot(x - middle, y - middle), `accent ${index}`).toBeLessThan(46);
          }
        }
      }
    }
  });

  it("rolls the same parts from the same seed, each within its set", () => {
    const parts = rollAvatar("seed-7");
    expect(parts).toEqual(rollAvatar("seed-7"));
    expect(parts).toEqual({
      set: 1,
      palette: 14,
      ground: 0,
      form: 3,
      material: 0,
      accent: 0,
      vein: 136,
    });
    const seen = new Set<string>();
    let alone = 0;
    const surfaces = new Set<number>();
    for (let index = 0; index < 400; index += 1) {
      const rolled = rollAvatar(`s-${index}`);
      expect(restAvatarPartsSchema.safeParse(rolled).success).toBe(true);
      for (const [part, list] of LISTS) {
        expect(rolled[part], part).toBeLessThan(AVATAR_SET_1[list].length);
      }
      expect(rolled.vein).toBeLessThan(AVATAR_VEINS);
      alone += rolled.accent === 0 ? 1 : 0;
      surfaces.add(rolled.material);
      seen.add(JSON.stringify(rolled));
    }
    // Seeds differ, and so do the pictures; every surface is rolled, and a body stands alone a
    // little less than half the time.
    expect(seen.size).toBeGreaterThan(390);
    expect(surfaces.size).toBe(AVATAR_SET_1.surfaces.length);
    expect(alone).toBeGreaterThan(140);
    expect(alone).toBeLessThan(220);
    const next = seededNumbers("a");
    const numbers = [next(), next(), next()];
    expect(numbers.every((number) => number >= 0 && number < 1)).toBe(true);
    expect(new Set(numbers).size).toBe(3);
  });

  it("still draws parts a set does not have, and an avatar of a set it does not know", () => {
    // An index past the end counts round it; a version nobody ships is drawn with the newest.
    expect(
      same(
        avatarPixels({ ...PLAIN, form: AVATAR_SET_1.bodies.length }, 32),
        avatarPixels(PLAIN, 32),
      ),
    ).toBe(true);
    expect(
      same(
        avatarPixels({ ...PLAIN, palette: 255, material: 255, accent: 255, ground: 255 }, 32),
        avatarPixels({ ...PLAIN, palette: 255 % 18, material: 255 % 10, accent: 255 % 6 }, 32),
      ),
    ).toBe(true);
    expect(avatarSetOf({ set: 99 })).toBe(AVATAR_SET_1);
    expect(same(avatarPixels({ ...PLAIN, set: 99 }, 32), avatarPixels(PLAIN, 32))).toBe(true);
    // A console that brings a set of its own draws its avatars with it.
    expect(avatarSetOf({ set: 1000 }, [AVATAR_SET_1, OWN])).toBe(OWN);
    expect(rollAvatar("seed-7", [AVATAR_SET_1, OWN])).toMatchObject({
      set: 1000,
      form: 0,
      palette: 0,
      material: 0,
      accent: 0,
      ground: 0,
    });
    const at = reader(avatarPixels(OWN_PARTS, 64, [AVATAR_SET_1, OWN]), 64);
    // Its lighter tone left of the middle, its darker right of it, its ground in a corner.
    expect(at(24, 32)).toEqual([255, 255, 255]);
    expect(at(40, 32)).toEqual([128, 128, 128]);
    expect(at(0, 0)).toEqual([0, 0, 0]);
    expect(() => avatarSetOf({ set: 1 }, [])).toThrow("no set");
  });

  it("draws whatever a set of one's own holds, and fails on none of it", () => {
    const draw = (set: unknown, size = 64): Uint8Array =>
      avatarPixels(OWN_PARTS, size, [set as AvatarSet]);
    // A set with nothing in it is its ground, the package's where it names none.
    const nothing = draw({ version: 1000 });
    expect([...nothing.subarray(0, 3)]).toEqual(GROUND);
    expect(new Set(nothing).size).toBeLessThanOrEqual(3);
    expect(new Set(draw({ ...OWN, grounds: [], ramps: [], bodies: [], accents: [] }))).toEqual(
      new Set(GROUND),
    );
    // Colours that are not written as colours draw in black; a ramp with no tones too.
    const odd = draw({
      ...OWN,
      grounds: ["red"],
      ramps: [{ tones: ["url(x)", 7, ""], partner: 99 }],
      confetti: ["#12", null],
    });
    expect(Math.max(...odd)).toBe(0);
    expect(
      Math.max(...draw({ ...OWN, grounds: ["#000000"], ramps: [{ tones: [], partner: 0 }] })),
    ).toBe(0);
    // Outlines that are no outlines are left out, and a place that is no number with them:
    // what is left of the body is drawn.
    const broken = draw({
      ...OWN,
      bodies: [
        {
          outlines: [
            "a path",
            null,
            [[1, 2]],
            [
              [25, 25],
              [Number.NaN, 0],
              [75, 25],
              ["x", "y"],
              [75, 75],
              [Number.POSITIVE_INFINITY, 75],
              [25, 75],
              [50],
            ],
          ],
          behind: "nothing",
        },
      ],
      surfaces: [{ tone: "light", shapes: [{ outlines: 5, tone: Number.NaN }, null] }],
      accents: [
        { behind: null, before: [{ shapes: [{ outlines: [[[0, 0]]], tone: -4, gap: -1 }] }] },
      ],
    });
    expect(reader(broken, 64)(24, 32)).toEqual([255, 255, 255]);
    expect(reader(broken, 64)(2, 2)).toEqual([0, 0, 0]);
    // Places far outside the picture are brought back; a line round a shape is no wider than
    // the picture, and a turn of any size is a turn.
    const far = draw({
      ...OWN,
      bodies: [{ outlines: [square(-1e308, -1e308, 1e308, 1e308)] }],
      accents: [
        {
          behind: [
            {
              turn: 1e9,
              shapes: [{ outlines: [square(-1e12, 40, 1e12, 60)], tone: 0, gap: 1e9 }],
            },
          ],
          before: [],
        },
      ],
    });
    expect(reader(far, 64)(2, 2)).toEqual([255, 255, 255]);
    expect(reader(far, 64)(60, 60)).toEqual([128, 128, 128]);
    // An outline of more corners than a picture is drawn from is left out, whatever its size,
    // and what the picture still has corners for is drawn.
    const scribble: [number, number][] = [];
    for (let corner = 0; corner < 60_000; corner += 1) {
      scribble.push([(100 * corner) / 60_000, corner % 2 === 0 ? 0 : 100]);
    }
    const long = draw(
      { ...OWN, bodies: [{ outlines: [scribble, square(25, 25, 75, 75)] }] },
      MAX_AVATAR_PIXELS,
    );
    expect(long).toHaveLength(MAX_AVATAR_PIXELS * MAX_AVATAR_PIXELS * 3);
    expect(reader(long, MAX_AVATAR_PIXELS)(400, 512)).toEqual([255, 255, 255]);
    expect(reader(long, MAX_AVATAR_PIXELS)(100, 512)).toEqual([0, 0, 0]);
    // Parts that are no places of a set draw as its first choices.
    const loose = avatarPixels(
      {
        set: 1000,
        palette: -3,
        ground: 1e9,
        form: Number.NaN,
        material: 2.7,
        accent: -0,
        vein: -1,
      },
      64,
      [OWN],
    );
    expect(same(loose, draw(OWN))).toBe(true);
  });

  it("draws as pixels: the ground round the body, its two tones meeting down the middle, an edge smoothed", () => {
    const side = 64;
    const pixels = avatarPixels(PLAIN, side);
    expect(pixels).toHaveLength(side * side * 3);
    const at = reader(pixels, side);
    // The ground in the corners; between two bands, the ramp's first tone left of the middle
    // and its second right of it; in a band, its second and its third.
    expect(at(0, 0)).toEqual(GROUND);
    expect(at(63, 63)).toEqual(GROUND);
    expect(at(31, 32)).toEqual(LIGHT);
    expect(at(32, 32)).toEqual(DARK);
    expect(at(24, 26)).toEqual(DARK);
    expect(at(40, 26)).toEqual([255, 138, 91]);
    // Along a row that crosses the body: the ground, then the body, then the ground, and
    // between them a pixel that is neither, where the edge runs through it. The ground and the
    // body part most in red; the two halves of the body, in blue.
    const row = Array.from({ length: side }, (_, x) => at(x, 32));
    const reds = row.map((pixel) => pixel[0] ?? 0);
    const blues = row.map((pixel) => pixel[2] ?? 0);
    expect(reds.slice(0, 12).every((red) => red === GROUND[0])).toBe(true);
    expect(blues.slice(20, 31).every((blue) => blue === 67)).toBe(true);
    expect(blues.slice(33, 44).every((blue) => blue === 82)).toBe(true);
    expect(reds.slice(52).every((red) => red === GROUND[0])).toBe(true);
    expect(reds.some((red) => red > 80 && red < 245)).toBe(true);
    // The same parts, the same bytes, however often they are drawn.
    expect(same(pixels, avatarPixels(PLAIN, side))).toBe(true);
    expect(() => avatarPixels(PLAIN, 8)).toThrow(RangeError);
    expect(() => avatarPixels(PLAIN, MAX_AVATAR_PIXELS + 1)).toThrow(RangeError);
    expect(() => avatarPixels(PLAIN, Number.NaN)).toThrow(RangeError);
  });

  it("fills an outline by how much of each pixel it covers, and two tones without a line between them", () => {
    const draw = (set: AvatarSet, size = 64) => reader(avatarPixels(OWN_PARTS, size, [set]), size);
    // A body whose edges run along the pixels' edges fills them whole; one whose edge runs
    // through the middle of a pixel fills it by half.
    const whole = draw(OWN);
    expect(whole(15, 32)).toEqual([0, 0, 0]);
    expect(whole(16, 32)).toEqual([255, 255, 255]);
    expect(whole(47, 32)).toEqual([128, 128, 128]);
    expect(whole(48, 32)).toEqual([0, 0, 0]);
    const half = draw({ ...OWN, bodies: [{ outlines: [square(25, 25, 75.78125, 75)] }] });
    expect(half(48, 32)).toEqual([64, 64, 64]);
    // Where the two tones meet in the middle of a pixel, the pixel is half of each and nothing
    // of the ground behind.
    const met = draw({
      ...OWN,
      surfaces: [
        { tone: 0, shapes: [{ outlines: [square(0, 0, 100, 100)], tone: 0, split: 50.78125 }] },
      ],
    });
    expect(met(31, 32)).toEqual([255, 255, 255]);
    expect(met(32, 32)).toEqual([192, 192, 192]);
    expect(met(33, 32)).toEqual([128, 128, 128]);
    // Outlines that run the same way round add up; one that runs the other way cuts a hole.
    const added = draw({
      ...OWN,
      bodies: [{ outlines: [square(25, 25, 60, 60), square(40, 40, 75, 75)] }],
    });
    expect(added(30, 30)).toEqual([255, 255, 255]);
    expect(added(31, 29)).toEqual([255, 255, 255]);
    expect(added(20, 40)).toEqual([0, 0, 0]);
    const holed = draw({
      ...OWN,
      bodies: [{ outlines: [square(25, 25, 75, 75), [...square(40, 40, 60, 60)].reverse()] }],
    });
    expect(holed(20, 20)).toEqual([255, 255, 255]);
    expect(holed(30, 32)).toEqual([0, 0, 0]);
    expect(holed(44, 44)).toEqual([128, 128, 128]);
    // What lies on a body is cut to it, in the body's ramp; what stands beside it is not, and
    // is drawn in the ramp that goes with the body's.
    const beside: AvatarSet = {
      ...OWN,
      ramps: [
        { tones: ["#ffffff", "#808080"], partner: 1 },
        { tones: ["#ff0000", "#00ff00"], partner: 0 },
      ],
      surfaces: [{ tone: 0, shapes: [{ outlines: [square(0, 40, 100, 60)], tone: 1 }] }],
      accents: [
        { behind: [], before: [{ shapes: [{ outlines: [square(0, 0, 100, 12.5)], tone: 0 }] }] },
      ],
    };
    const cut = draw(beside);
    expect(cut(20, 32)).toEqual([128, 128, 128]);
    expect(cut(8, 32)).toEqual([0, 0, 0]);
    expect(cut(8, 4)).toEqual([255, 0, 0]);
    expect(cut(56, 4)).toEqual([0, 255, 0]);
    // A layer is turned about the middle, and kept to a half of the picture as it lay before:
    // a bar across the top, turned a quarter, stands down the right; kept to the upper half and
    // turned half round, it lies along the foot; kept to the lower half, nothing of it is left.
    const bar = (layer: object): AvatarSet => ({
      ...beside,
      accents: [
        {
          behind: [],
          before: [
            { ...layer, shapes: [{ outlines: [square(12.5, 0, 87.5, 12.5)], tone: 0, split: 0 }] },
          ],
        },
      ],
    });
    const turned = draw(bar({ turn: 90 }));
    expect(turned(60, 32)).toEqual([0, 255, 0]);
    expect(turned(32, 4)).toEqual([0, 0, 0]);
    const kept = draw(bar({ half: "upper", turn: 180 }));
    expect(kept(32, 60)).toEqual([0, 255, 0]);
    expect(draw(bar({ half: "lower" }))(32, 4)).toEqual([0, 0, 0]);
    // A shape that lets what is behind it through is mixed with it, and one with a gap has a
    // line of the ground round it over what it lies on.
    const faint = draw({
      ...OWN,
      bodies: [
        {
          outlines: [square(25, 25, 75, 75)],
          behind: [{ outlines: [square(0, 0, 100, 100)], tone: 0, opacity: 0.5, split: 0 }],
        },
      ],
    });
    expect(faint(4, 4)).toEqual([64, 64, 64]);
    const apart = draw({
      ...beside,
      accents: [
        {
          behind: [],
          before: [
            {
              shapes: [
                { outlines: [square(37.5, 37.5, 62.5, 62.5)], tone: 0, gap: 12.5, split: 0 },
              ],
            },
          ],
        },
      ],
    });
    expect(apart(32, 32)).toEqual([0, 255, 0]);
    expect(apart(22, 32)).toEqual([0, 0, 0]);
    expect(apart(18, 32)).toEqual([128, 128, 128]);
  });

  it("strews faint squares over the ground of a large picture, and draws the planet of a small one closer", () => {
    // The squares are the seed's: another seed, other squares, and the planet as it was.
    const large = avatarPixels(PLAIN, AVATAR_PLAIN_UNDER);
    const other = avatarPixels({ ...PLAIN, vein: 1 }, AVATAR_PLAIN_UNDER);
    expect(same(large, other)).toBe(false);
    const middle = (pixels: Uint8Array): number[] =>
      reader(pixels, AVATAR_PLAIN_UNDER)(AVATAR_PLAIN_UNDER / 2 - 1, AVATAR_PLAIN_UNDER / 2);
    expect(middle(large)).toEqual(LIGHT);
    expect(middle(other)).toEqual(LIGHT);
    const ground = (pixels: Uint8Array): number => {
      let count = 0;
      for (let at = 0; at < pixels.length; at += 3) {
        count +=
          pixels[at] === GROUND[0] && pixels[at + 1] === GROUND[1] && pixels[at + 2] === GROUND[2]
            ? 1
            : 0;
      }
      return count / (pixels.length / 3);
    };
    // Six to eight squares, each 3.4 of a hundred a side, clear of the planet.
    const squares = ground(avatarPixels(PLAIN, AVATAR_PLAIN_UNDER - 1)) - ground(large);
    expect(squares).toBeGreaterThan(6 * 0.034 * 0.034 * 0.6);
    expect(squares).toBeLessThan(8 * 0.034 * 0.034 * 2);
    // Under that size the ground is plain: the seed changes nothing.
    expect(
      same(avatarPixels(PLAIN, AVATAR_PLAIN_UNDER - 1), avatarPixels({ ...PLAIN, vein: 1 }, 95)),
    ).toBe(true);
    // A picture as small as a chip's has its planet drawn closer: a body with nothing beside
    // it as much as it may be, one with a ring only as far as the ring leaves room.
    const disc = (size: number, accent = 0): number =>
      1 - ground(avatarPixels({ ...PLAIN, accent }, size));
    // What is counted is every pixel the body touches, so a little over its area.
    const full = Math.PI * 0.27 * 0.27;
    // The first set asks for its planet a twentieth larger than it is written, at every size.
    const fill = AVATAR_SET_1.fill ?? 1;
    expect(fill).toBe(1.05);
    const filled = full * fill * fill;
    expect(disc(AVATAR_CLOSE_UNDER)).toBeGreaterThan(filled);
    expect(disc(AVATAR_CLOSE_UNDER)).toBeLessThan(filled * 1.12);
    expect(disc(AVATAR_PLAIN_UNDER - 1)).toBeGreaterThan(filled);
    expect(disc(AVATAR_PLAIN_UNDER - 1)).toBeLessThan(filled * 1.08);
    const close = disc(AVATAR_CLOSE_UNDER - 1);
    expect(close).toBeGreaterThan(full * AVATAR_CLOSE_MOST * AVATAR_CLOSE_MOST);
    expect(close).toBeLessThan(full * AVATAR_CLOSE_MOST * AVATAR_CLOSE_MOST * 1.12);
    const ringed = disc(AVATAR_CLOSE_UNDER - 1, 1) - disc(AVATAR_CLOSE_UNDER, 1);
    expect(ringed).toBeGreaterThan(0.01);
    expect(ringed).toBeLessThan(close - full);
    // A set that says nothing is drawn as written, and closer when small; one that asks for
    // more than a set may, or for nothing a drawing can use, is held to what one may.
    const own = (set: unknown, size: number): number => {
      const pixels = avatarPixels(OWN_PARTS, size, [set as AvatarSet]);
      let lit = 0;
      for (let at = 0; at < pixels.length; at += 3) {
        lit += pixels[at] === 0 ? 0 : 1;
      }
      return lit / (pixels.length / 3);
    };
    expect(own(OWN, 200)).toBeCloseTo(0.25, 9);
    expect(own({ ...OWN, fill: 1.2 }, 200)).toBeCloseTo(0.25 * 1.2 * 1.2, 9);
    expect(own({ ...OWN, fill: 0.5 }, 200)).toBeCloseTo(0.25, 9);
    expect(own({ ...OWN, fill: "2" }, 200)).toBeCloseTo(0.25, 9);
    expect(own({ ...OWN, fill: Number.POSITIVE_INFINITY }, 200)).toBeCloseTo(0.25, 9);
    expect(own({ ...OWN, fill: 99 }, 200)).toBeCloseTo(
      0.25 * AVATAR_FILL_MOST * AVATAR_FILL_MOST,
      9,
    );
    // Whatever a set asks, nothing is drawn past the room the picture has.
    expect(
      own({ ...OWN, fill: 99, bodies: [{ outlines: [square(10, 10, 90, 90)] }] }, 200),
    ).toBeCloseTo(0.94 * 0.94, 9);
    // Nothing of a picture drawn closer leaves it: the ring's ends stay clear of the edge.
    const small = reader(avatarPixels({ ...PLAIN, accent: 1 }, 48), 48);
    for (let y = 0; y < 48; y += 1) {
      expect(small(0, y)).toEqual(GROUND);
      expect(small(47, y)).toEqual(GROUND);
    }
  });

  it("is written as a PNG file a reader takes: its signature, its size, its rows and their checksums", () => {
    const side = 128;
    const lines = avatarScanlines(PLAIN, side);
    expect(lines).toHaveLength(side * (side * 3 + 1));
    const file = pngFile(side, deflateSync(lines));
    const chunks = chunksOf(file);
    expect(chunks.map((one) => one.name)).toEqual(["IHDR", "IDAT", "IEND"]);
    const header = chunks[0]?.data ?? new Uint8Array();
    const head = new DataView(header.buffer, header.byteOffset, header.byteLength);
    expect([head.getUint32(0), head.getUint32(4)]).toEqual([side, side]);
    // Eight bits a sample, red, green and blue, nothing interlaced.
    expect([...header.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
    // What the file holds is the rows it was given: a row's filter byte, then its pixels.
    const rows = inflateSync(chunks[1]?.data ?? new Uint8Array());
    expect(Buffer.compare(rows, Buffer.from(lines))).toBe(0);
    expect(rows[0]).toBe(0);
    // A profile picture of the largest size is a small file: flat tones pack well.
    const large = pngFile(
      MAX_AVATAR_PIXELS,
      deflateSync(avatarScanlines(rollAvatar("seed-7"), MAX_AVATAR_PIXELS)),
    );
    expect(large.length).toBeLessThan(150_000);
  });

  it("is the address of a picture a page shows at once: a whole PNG, drawn once", () => {
    const address = avatarDataUrl(PLAIN, 48);
    expect(address.startsWith("data:image/png;base64,")).toBe(true);
    expect(address).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
    const file = Buffer.from(address.slice("data:image/png;base64,".length), "base64");
    const chunks = chunksOf(file);
    expect(chunks.map((one) => one.name)).toEqual(["IHDR", "IDAT", "IEND"]);
    // Packed in no way, and still a stream any reader unpacks to the rows.
    const rows = inflateSync(chunks[1]?.data ?? new Uint8Array());
    expect(Buffer.compare(rows, Buffer.from(avatarScanlines(PLAIN, 48)))).toBe(0);
    // Asked again, the same text is handed back, not drawn again.
    expect(avatarDataUrl({ ...PLAIN }, 48)).toBe(address);
    expect(avatarDataUrl(PLAIN, 32)).not.toBe(address);
    expect(avatarDataUrl({ ...PLAIN, palette: 2 }, 48)).not.toBe(address);
    // A picture larger than one block of the stream holds is written in several.
    const large = avatarDataUrl(PLAIN, 224);
    const big = chunksOf(Buffer.from(large.slice("data:image/png;base64,".length), "base64"));
    expect(
      Buffer.compare(
        inflateSync(big[1]?.data ?? new Uint8Array()),
        Buffer.from(avatarScanlines(PLAIN, 224)),
      ),
    ).toBe(0);
    expect(avatarDataUrl({ ...PLAIN, vein: 2 }, 224)).not.toBe(large);
    expect(() => avatarDataUrl(PLAIN, 4)).toThrow(RangeError);
  });
});

/** The chunks of a PNG file in turn, each checked against the checksum a reader verifies. */
function chunksOf(file: Uint8Array): { name: string; data: Uint8Array }[] {
  expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const chunks: { name: string; data: Uint8Array }[] = [];
  for (let offset = 8; offset < file.length; ) {
    const length = view.getUint32(offset);
    const name = String.fromCodePoint(...file.subarray(offset + 4, offset + 8));
    const data = file.subarray(offset + 8, offset + 8 + length);
    expect(view.getUint32(offset + 8 + length), name).toBe(
      crc(file.subarray(offset + 4, offset + 8 + length)),
    );
    chunks.push({ name, data });
    offset += 12 + length;
  }
  return chunks;
}

/** The checksum of a chunk, as a reader of PNG files computes it. */
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
