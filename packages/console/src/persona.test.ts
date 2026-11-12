import { describe, expect, it } from "vitest";
import { rollAvatar } from "./avatar.js";
import { PERSONA_NAMES, proposeAgents } from "./persona.js";
import { isHandle, RESERVED_HANDLES } from "./schemas.js";

/** Syllables of Hangul, first to last: how a name reads in the Korean pack. */
const HANGUL = new RegExp(`^[${String.fromCodePoint(0xac00)}-${String.fromCodePoint(0xd7a3)}]+$`);

describe("the persona proposed for an agent account (ADR-0084)", () => {
  it("ships names that each give a handle of its own, spelled in every language the console speaks", () => {
    const handles = PERSONA_NAMES.map((name) => name.handle);
    expect(new Set(handles).size).toBe(handles.length);
    for (const name of PERSONA_NAMES) {
      expect(isHandle(name.handle), name.handle).toBe(true);
      expect(RESERVED_HANDLES).not.toContain(name.handle);
      expect(name.names.en, name.handle).toMatch(/^[A-Z][a-z]+$/);
      expect(name.names.ko, name.handle).toMatch(HANGUL);
      // A name is short enough to call an account by: the handle is the English name as it is
      // written, of six letters at most, and the Korean spelling two or three syllables.
      expect(name.names.en?.toLowerCase(), name.handle).toBe(name.handle);
      expect(name.handle.length, name.handle).toBeLessThanOrEqual(6);
      expect([...(name.names.ko ?? "")].length, name.handle).toBeGreaterThanOrEqual(2);
      expect([...(name.names.ko ?? "")].length, name.handle).toBeLessThanOrEqual(3);
    }
    expect(PERSONA_NAMES).toHaveLength(40);
  });

  it("proposes the same name and avatar from the same seed, and no name twice in one asking", () => {
    const seeds = ["a1", "b2", "c3", "d4", "e5", "f6"];
    const proposed = proposeAgents(seeds);
    expect(proposed).toEqual(proposeAgents(seeds));
    expect(proposed.map((one) => one.seed)).toEqual(seeds);
    expect(new Set(proposed.map((one) => one.name)).size).toBe(seeds.length);
    for (const one of proposed) {
      expect(one.avatarParts).toEqual(rollAvatar(one.seed));
      expect(PERSONA_NAMES.find((name) => name.handle === one.handle)?.names.en).toBe(one.name);
    }
    // More seeds than names: every name once before any comes again.
    const many = proposeAgents(Array.from({ length: PERSONA_NAMES.length }, (_, i) => `s${i}`));
    expect(new Set(many.map((one) => one.handle)).size).toBe(PERSONA_NAMES.length);
  });

  it("names in the language asked for, English where it has none, and gives a handle nobody has", () => {
    const [english] = proposeAgents(["a1"]);
    const [korean] = proposeAgents(["a1"], { lang: "ko-KR" });
    const [other] = proposeAgents(["a1"], { lang: "fr" });
    expect(korean?.name).toMatch(HANGUL);
    expect(korean?.handle).toBe(english?.handle);
    expect(other?.name).toBe(english?.name);
    const handle = english?.handle ?? "";
    const [second] = proposeAgents(["a1"], { taken: [handle] });
    expect(second?.handle).toBe(`${handle}-2`);
    const [third] = proposeAgents(["a1"], { taken: [handle, `${handle}-2`] });
    expect(third?.handle).toBe(`${handle}-3`);
    // Two of one asking never share a handle either, whatever was taken.
    const pair = proposeAgents(["a1", "a1"], { names: [{ handle: "ada", names: { en: "Ada" } }] });
    expect(pair.map((one) => one.handle)).toEqual(["ada", "ada-2"]);
    expect(pair.map((one) => one.name)).toEqual(["Ada", "Ada"]);
  });
});
