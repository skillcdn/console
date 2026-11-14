import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The stylesheet is part of the package's surface: a custom console re-skins it through the
// tokens, so a rule that reads a token nobody defines, or spells out a value a token holds,
// is a place where re-skinning silently stops working.
// console.css names the files in the order they are read; the build joins them (ADR-0106), and
// so does this, to read the stylesheet as a console loads it.
const read = (name: string): string => readFileSync(new URL(name, import.meta.url), "utf8");
const css = read("./console.css")
  .replace(/@import "(\.\/[\w/-]+\.css)";/g, (_line, name: string) => read(name))
  .replace(/\/\*[\s\S]*?\*\//g, "");

// Set by the components on an element's style, not in the stylesheet: a glance's heights are
// the ones its rows are fitted by (`GLANCE_REM`, ADR-0105).
const SET_INLINE = new Set([
  "--sc-span",
  "--sc-glance-heading",
  "--sc-glance-task",
  "--sc-glance-goal",
  "--sc-glance-more",
  "--sc-glance-between",
]);

describe("console.css", () => {
  it("draws a select's chevron itself, inset from the edge", () => {
    const rule = css.match(/select\.sc-input\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("appearance: none");
    expect(rule).toMatch(/background-position:[^;]*right var\(--sc-space-3\) center/);
  });

  it("is every file its manifest names, joined", () => {
    expect(css).not.toContain("@import");
    expect(css).toMatch(/\.sc-button\s*\{/);
    expect(css).toMatch(/\.sc-tile\s*\{/);
  });

  it("is light by default (ADR-0040)", () => {
    expect(css).toMatch(/:root\s*\{\s*color-scheme:\s*light;/);
  });

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
