import { describe, expect, it } from "vitest";
import { hasForbiddenCodePoint } from "./text.js";

describe("hasForbiddenCodePoint", () => {
  it("lets ordinary text through, in any script", () => {
    for (const text of ["Ship it", "배포하기", "Déjà vu", "emoji 🚀", ""]) {
      expect(hasForbiddenCodePoint(text), text).toBe(false);
    }
  });

  it("refuses control characters and the ones that hide", () => {
    for (const codePoint of [
      0x00, 0x1b, 0x7f, 0x85, 0x200b, 0x200f, 0x2028, 0x202e, 0x2066, 0xfeff,
    ]) {
      expect(hasForbiddenCodePoint(`a${String.fromCodePoint(codePoint)}b`), String(codePoint)).toBe(
        true,
      );
    }
  });

  it("allows line breaks and tabs only where a body is expected", () => {
    expect(hasForbiddenCodePoint("a\nb")).toBe(true);
    expect(hasForbiddenCodePoint("a\nb", true)).toBe(false);
    expect(hasForbiddenCodePoint("a\tb\r\n", true)).toBe(false);
    expect(hasForbiddenCodePoint(`a${String.fromCodePoint(0x0b)}b`, true)).toBe(true);
  });

  it("refuses malformed UTF-16", () => {
    expect(hasForbiddenCodePoint("\ud800")).toBe(true);
  });
});
