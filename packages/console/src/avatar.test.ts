import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  AVATAR_PARTS,
  AVATAR_SET_1,
  AVATAR_SETS,
  type AvatarSet,
  avatarPixels,
  avatarScanlines,
  avatarSetOf,
  avatarShapes,
  avatarSvg,
  MAX_AVATAR_PIXELS,
  pngFile,
  rollAvatar,
  seededNumbers,
} from "./avatar.js";
import { restAvatarPartsSchema } from "./schemas.js";

const PLAIN = {
  set: 1,
  background: 0,
  head: 1,
  ears: 0,
  eyes: 0,
  mouth: 1,
  marks: 0,
  accessory: 0,
  palette: 0,
} as const;

describe("an agent account's avatar (ADR-0084)", () => {
  it("is drawn from a set that never changes once released", () => {
    // What an avatar looks like is this set for good: a new look is a set with another version,
    // added beside it, and never an edit of this one. If this fails, a released set was changed.
    expect(AVATAR_SET_1.version).toBe(1);
    expect(createHash("sha256").update(JSON.stringify(AVATAR_SET_1)).digest("hex")).toBe(
      "fae7f140d66d69855b32fe5bc923d955a8570fe62928c53c394e7c0e93c31ee0",
    );
    expect(AVATAR_SETS.map((set) => set.version)).toEqual([1]);
    // Every part gives a choice, and a part that may be left out has none first.
    for (const part of AVATAR_PARTS) {
      expect(AVATAR_SET_1[part].length, part).toBeGreaterThan(1);
    }
    for (const part of ["ears", "marks", "accessory"] as const) {
      expect(AVATAR_SET_1[part][0]).toEqual([]);
    }
    // Every shape lies on the square, and every colour is one a stylesheet could not be told by.
    for (const palette of AVATAR_SET_1.palettes) {
      for (const color of Object.values(palette)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("rolls the same parts from the same seed, each within its set", () => {
    const parts = rollAvatar("seed-7");
    expect(parts).toEqual(rollAvatar("seed-7"));
    expect(parts).toEqual({
      set: 1,
      background: 3,
      head: 2,
      ears: 1,
      eyes: 0,
      mouth: 3,
      marks: 0,
      accessory: 2,
      palette: 6,
    });
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const rolled = rollAvatar(`s-${index}`);
      expect(restAvatarPartsSchema.safeParse(rolled).success).toBe(true);
      for (const part of AVATAR_PARTS) {
        expect(rolled[part]).toBeLessThan(AVATAR_SET_1[part].length);
      }
      expect(rolled.palette).toBeLessThan(AVATAR_SET_1.palettes.length);
      seen.add(JSON.stringify(rolled));
    }
    // Seeds differ, and so do the faces.
    expect(seen.size).toBeGreaterThan(150);
    const next = seededNumbers("a");
    const numbers = [next(), next(), next()];
    expect(numbers.every((number) => number >= 0 && number < 1)).toBe(true);
    expect(new Set(numbers).size).toBe(3);
  });

  it("draws as SVG of numbers and the palette's colours alone", () => {
    expect(avatarSvg(PLAIN, { size: 64 })).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="64" height="64">' +
        '<rect x="0" y="0" width="100" height="100" rx="0" fill="#e4e7ff"/>' +
        '<ellipse cx="50" cy="56" rx="28" ry="28" fill="#5b64e8"/>' +
        '<ellipse cx="40" cy="52" rx="4" ry="4" fill="#1b1e4b"/>' +
        '<ellipse cx="60" cy="52" rx="4" ry="4" fill="#1b1e4b"/>' +
        '<rect x="42" y="66.5" width="16" height="3.2" rx="1.6" fill="#1b1e4b"/></svg>',
    );
    // From the back to the front: the background first, an accessory last.
    const full = avatarShapes({ ...PLAIN, ears: 2, marks: 1, accessory: 1 });
    expect(full[0]).toMatchObject({ kind: "rect", fill: "bg", color: "#e4e7ff" });
    expect(full.at(-1)).toMatchObject({ kind: "ellipse", fill: "shade" });
    for (const svg of [avatarSvg(rollAvatar("x")), avatarSvg(rollAvatar("y"), { size: 24 })]) {
      expect(svg).toMatch(/^<svg [^<]*>(?:<(?:rect|ellipse|polygon) [^<]*\/>)+<\/svg>$/);
      expect(svg).not.toMatch(/script|style|href|on[a-z]+=/i);
    }
  });

  it("still draws parts a set does not have, and an avatar of a set it does not know", () => {
    // An index past the end counts round it; a version nobody ships is drawn with the newest.
    expect(avatarShapes({ ...PLAIN, head: 1 + AVATAR_SET_1.head.length })).toEqual(
      avatarShapes(PLAIN),
    );
    expect(avatarSetOf({ set: 99 })).toBe(AVATAR_SET_1);
    expect(avatarSvg({ ...PLAIN, set: 99 })).toBe(avatarSvg(PLAIN));
    // A console that brings shapes of its own draws its avatars with them.
    const own: AvatarSet = { ...AVATAR_SET_1, version: 1000, head: [AVATAR_SET_1.head[0] ?? []] };
    expect(avatarSetOf({ set: 1000 }, [AVATAR_SET_1, own])).toBe(own);
    expect(rollAvatar("seed-7", [AVATAR_SET_1, own])).toMatchObject({ set: 1000, head: 0 });
    expect(() => avatarSetOf({ set: 1 }, [])).toThrow("no set");
  });

  it("draws as pixels the same picture: the colours where the shapes are, an edge smoothed", () => {
    const side = 64;
    const pixels = avatarPixels(PLAIN, side);
    expect(pixels).toHaveLength(side * side * 3);
    const at = (x: number, y: number) => [
      ...pixels.subarray((y * side + x) * 3, (y * side + x) * 3 + 3),
    ];
    // The background in a corner, the head, an eye and the mouth where each is.
    expect(at(0, 0)).toEqual([0xe4, 0xe7, 0xff]);
    expect(at(32, 25)).toEqual([0x5b, 0x64, 0xe8]);
    expect(at(25, 33)).toEqual([0x1b, 0x1e, 0x4b]);
    expect(at(32, 43)).toEqual([0x1b, 0x1e, 0x4b]);
    // Along a row that crosses the head, a pixel on its edge is between the two colours, neither
    // the one nor the other: how much of it the head covers.
    const reds = Array.from({ length: side }, (_, x) => at(x, 23)[0] ?? 0);
    expect(reds.every((red) => red >= 0x5b && red <= 0xe4)).toBe(true);
    expect(reds.some((red) => red > 0x5b && red < 0xe4)).toBe(true);
    expect(() => avatarPixels(PLAIN, 8)).toThrow(RangeError);
    expect(() => avatarPixels(PLAIN, MAX_AVATAR_PIXELS + 1)).toThrow(RangeError);
    expect(() => avatarPixels(PLAIN, Number.NaN)).toThrow(RangeError);
  });

  it("is written as a PNG file a reader takes: its signature, its size, its rows and their checksums", () => {
    const side = 128;
    const lines = avatarScanlines(PLAIN, side);
    expect(lines).toHaveLength(side * (side * 3 + 1));
    const file = pngFile(side, deflateSync(lines));
    expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    // The chunks in turn: each with a checksum of its name and bytes that a reader verifies.
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
    expect([...rows.subarray(1, 4)]).toEqual([0xe4, 0xe7, 0xff]);
    // A profile picture of the largest size is a small file: flat colours compress.
    const large = pngFile(
      MAX_AVATAR_PIXELS,
      deflateSync(avatarScanlines(rollAvatar("seed-7"), MAX_AVATAR_PIXELS)),
    );
    expect(large.length).toBeLessThan(100_000);
  });
});

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
