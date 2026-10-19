import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The stylesheet is part of the package's surface: a custom console re-skins it through the
// tokens, so a rule that reads a token nobody defines, or spells out a value a token holds,
// is a place where re-skinning silently stops working.
const css = readFileSync(new URL("./console.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

// Set by the components on an element's style, not in the stylesheet.
const SET_INLINE = new Set(["--sc-span"]);

describe("console.css", () => {
  it("reads only the custom properties it defines", () => {
    const defined = new Set([...css.matchAll(/(--sc-[\w-]+)\s*:/g)].map((match) => match[1] ?? ""));
    const read = new Set(
      [...css.matchAll(/var\(\s*(--sc-[\w-]+)/g)].map((match) => match[1] ?? ""),
    );
    const undefinedReads = [...read].filter((name) => !defined.has(name) && !SET_INLINE.has(name));
    expect(undefinedReads).toEqual([]);
  });

  it("draws every focus ring with the focus ring token", () => {
    const outlines = [...css.matchAll(/(?<![\w-])outline\s*:\s*([^;]+);/g)].map((match) =>
      match[1]?.trim(),
    );
    const handDrawn = outlines.filter(
      (value) => value !== "none" && value !== "var(--sc-focus-ring)",
    );
    expect(handDrawn).toEqual([]);
  });
});
