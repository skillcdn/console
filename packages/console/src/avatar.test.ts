import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  AVATAR_FLOOR,
  AVATAR_SET_1,
  AVATAR_SETS,
  AVATAR_VEINS,
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

/** An orb of marble before a wall alone, in the first palette: the plainest picture of the set. */
const PLAIN = {
  set: 1,
  palette: 0,
  ground: 1,
  form: 0,
  material: 0,
  accent: 0,
  vein: 0,
} as const;

/** The parts whose choices a set lists, with what the set calls each list. */
const LISTS = [
  ["palette", "palettes"],
  ["ground", "grounds"],
  ["form", "forms"],
  ["material", "materials"],
  ["accent", "accents"],
] as const;

describe("an agent account's avatar (ADR-0084, ADR-0093)", () => {
  it("is drawn from a set that never changes once released", () => {
    // What an avatar looks like is this set for good: a new look is a set with another version,
    // added beside it, and never an edit of this one. The forms and the materials are functions,
    // so the look is held by what they draw: every form in every material, small. If this fails,
    // a released set was changed.
    expect(AVATAR_SET_1.version).toBe(1);
    const look = createHash("sha256");
    look.update(JSON.stringify(AVATAR_SET_1.palettes));
    look.update(JSON.stringify([AVATAR_SET_1.grounds, AVATAR_SET_1.accents]));
    for (let form = 0; form < AVATAR_SET_1.forms.length; form += 1) {
      for (let material = 0; material < AVATAR_SET_1.materials.length; material += 1) {
        look.update(
          avatarPixels(
            {
              set: 1,
              palette: (form + material) % AVATAR_SET_1.palettes.length,
              ground: form % AVATAR_SET_1.grounds.length,
              form,
              material,
              accent: material % AVATAR_SET_1.accents.length,
              vein: form * 16 + material,
            },
            32,
          ),
        );
      }
    }
    expect(look.digest("hex")).toBe(
      "60047211a909b7608c4eb20c3b633b38962f0d807360607b7cd0e1b2c7d7e526",
    );
    expect(AVATAR_SETS.map((set) => set.version)).toEqual([1]);
    // Every part gives a choice, and nothing beside the form is the first of the accents.
    for (const [, list] of LISTS) {
      expect(AVATAR_SET_1[list].length, list).toBeGreaterThan(1);
    }
    expect(AVATAR_SET_1.accents[0]).toBe("none");
    for (const palette of AVATAR_SET_1.palettes) {
      for (const color of Object.values(palette)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    // Every form stands on the floor and within the picture: inside somewhere above the floor,
    // outside at each corner and under the floor.
    for (const [index, form] of AVATAR_SET_1.forms.entries()) {
      let inside = 0;
      for (let y = 0.02; y < 1; y += 0.04) {
        for (let x = 0.02; x < 1; x += 0.04) {
          if (form(x, y) < 0) {
            inside += 1;
            expect(y, `form ${index}`).toBeLessThan(AVATAR_FLOOR + 0.03);
          }
        }
      }
      expect(inside, `form ${index}`).toBeGreaterThan(40);
      for (const [x, y] of [
        [0.01, 0.01],
        [0.99, 0.01],
        [0.01, 0.99],
        [0.99, 0.99],
      ] as const) {
        expect(form(x, y), `form ${index}`).toBeGreaterThan(0);
      }
    }
  });

  it("rolls the same parts from the same seed, each within its set", () => {
    const parts = rollAvatar("seed-7");
    expect(parts).toEqual(rollAvatar("seed-7"));
    expect(parts).toEqual({
      set: 1,
      palette: 9,
      ground: 1,
      form: 10,
      material: 0,
      accent: 0,
      vein: 136,
    });
    const seen = new Set<string>();
    let own = 0;
    let alone = 0;
    for (let index = 0; index < 400; index += 1) {
      const rolled = rollAvatar(`s-${index}`);
      expect(restAvatarPartsSchema.safeParse(rolled).success).toBe(true);
      for (const [part, list] of LISTS) {
        expect(rolled[part], part).toBeLessThan(AVATAR_SET_1[list].length);
      }
      expect(rolled.vein).toBeLessThan(AVATAR_VEINS);
      own += rolled.material === 0 ? 1 : 0;
      alone += rolled.accent === 0 ? 1 : 0;
      seen.add(JSON.stringify(rolled));
    }
    // Seeds differ, and so do the pictures; the set's own material is rolled more often than
    // any other, and a form stands alone a little less than half the time.
    expect(seen.size).toBeGreaterThan(390);
    expect(own).toBeGreaterThan(90);
    expect(own).toBeLessThan(160);
    expect(alone).toBeGreaterThan(140);
    expect(alone).toBeLessThan(220);
    const next = seededNumbers("a");
    const numbers = [next(), next(), next()];
    expect(numbers.every((number) => number >= 0 && number < 1)).toBe(true);
    expect(new Set(numbers).size).toBe(3);
  });

  it("still draws parts a set does not have, and an avatar of a set it does not know", () => {
    // An index past the end counts round it; a version nobody ships is drawn with the newest.
    const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b));
    expect(
      same(
        avatarPixels({ ...PLAIN, form: AVATAR_SET_1.forms.length }, 32),
        avatarPixels(PLAIN, 32),
      ),
    ).toBe(0);
    expect(avatarSetOf({ set: 99 })).toBe(AVATAR_SET_1);
    expect(same(avatarPixels({ ...PLAIN, set: 99 }, 32), avatarPixels(PLAIN, 32))).toBe(0);
    // A console that brings a set of its own draws its avatars with it.
    const own: AvatarSet = {
      ...AVATAR_SET_1,
      version: 1000,
      forms: [(x, y) => Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) - 0.2],
      palettes: [{ wall: "#000000", stone: "#ffffff", vein: "#ffffff", accent: "#ff0000" }],
    };
    expect(avatarSetOf({ set: 1000 }, [AVATAR_SET_1, own])).toBe(own);
    expect(rollAvatar("seed-7", [AVATAR_SET_1, own])).toMatchObject({
      set: 1000,
      form: 0,
      palette: 0,
    });
    const drawn = avatarPixels({ ...PLAIN, set: 1000 }, 32, [AVATAR_SET_1, own]);
    // Its stone in the middle, its wall in a corner.
    expect(drawn[(16 * 32 + 16) * 3]).toBeGreaterThan(230);
    expect(drawn[0]).toBeLessThan(10);
    expect(() => avatarSetOf({ set: 1 }, [])).toThrow("no set");
    // A palette that is not written as colours draws in black, and nothing fails.
    const odd: AvatarSet = {
      ...own,
      palettes: [{ wall: "red", stone: "url(x)", vein: "", accent: "#12" }],
    };
    expect(Math.max(...avatarPixels({ ...PLAIN, set: 1000 }, 16, [odd]))).toBeLessThan(10);
  });

  it("draws as pixels: the wall round the form, the stone within it, an edge smoothed", () => {
    const side = 64;
    const pixels = avatarPixels(PLAIN, side);
    expect(pixels).toHaveLength(side * side * 3);
    const at = (x: number, y: number) => [
      ...pixels.subarray((y * side + x) * 3, (y * side + x) * 3 + 3),
    ];
    // The wall in the corners, a little lighter at the upper left than at the lower right, as
    // the light falls; the pale stone in the middle of the orb.
    expect(at(0, 0)).toEqual([210, 193, 176]);
    expect(at(63, 63)).toEqual([192, 176, 160]);
    expect(at(32, 30)).toEqual([240, 236, 230]);
    // Along a row that crosses the orb: the wall, then the stone, then the wall, and between
    // them a pixel that is neither, where the edge runs through it.
    const reds = Array.from({ length: side }, (_, x) => at(x, 30)[0] ?? 0);
    expect(reds.slice(0, 10).every((red) => red > 200 && red < 210)).toBe(true);
    expect(reds.slice(26, 32).every((red) => red > 240)).toBe(true);
    expect(reds.some((red) => red > 212 && red < 235)).toBe(true);
    // The same parts, the same bytes, however often they are drawn.
    expect(Buffer.compare(Buffer.from(pixels), Buffer.from(avatarPixels(PLAIN, side)))).toBe(0);
    // Another grain is another stone, and the wall is as it was.
    const other = avatarPixels({ ...PLAIN, vein: 1 }, side);
    expect(Buffer.compare(Buffer.from(pixels), Buffer.from(other))).not.toBe(0);
    expect([...other.subarray(0, 3)]).toEqual([210, 193, 176]);
    expect(() => avatarPixels(PLAIN, 8)).toThrow(RangeError);
    expect(() => avatarPixels(PLAIN, MAX_AVATAR_PIXELS + 1)).toThrow(RangeError);
    expect(() => avatarPixels(PLAIN, Number.NaN)).toThrow(RangeError);
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
    // A profile picture of the largest size is a file a profile takes: a stone has a grain, so
    // it packs less than flat colours would, and stays well under what such a form allows.
    const large = pngFile(
      MAX_AVATAR_PIXELS,
      deflateSync(avatarScanlines(rollAvatar("seed-7"), MAX_AVATAR_PIXELS)),
    );
    expect(large.length).toBeLessThan(2_000_000);
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
    expect(avatarDataUrl({ ...PLAIN, vein: 2 }, 48)).not.toBe(address);
    // A picture larger than one block of the stream holds is written in several.
    const large = avatarDataUrl(PLAIN, 224);
    const big = chunksOf(Buffer.from(large.slice("data:image/png;base64,".length), "base64"));
    expect(
      Buffer.compare(
        inflateSync(big[1]?.data ?? new Uint8Array()),
        Buffer.from(avatarScanlines(PLAIN, 224)),
      ),
    ).toBe(0);
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
