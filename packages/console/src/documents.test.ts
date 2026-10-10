import { describe, expect, it } from "vitest";
import {
  documentPathsIn,
  folderOf,
  foldersAbove,
  isDocumentPath,
  isFolderPath,
  nameOf,
} from "./documents.js";
import { MAX_DOCUMENT_PATH_LENGTH, MAX_DOCUMENT_SEGMENT_LENGTH } from "./limits.js";

describe("a document's path", () => {
  it("is segments of lowercase letters, digits and hyphens, separated by slashes, bounded", () => {
    for (const path of ["readme", "guides/onboarding", "a/b/c-d/e1", "2026/q4"]) {
      expect(isDocumentPath(path), path).toBe(true);
    }
    for (const path of [
      "",
      "/guides",
      "guides/",
      "Guides",
      "a//b",
      "a_b",
      "-a",
      "a-",
      "a/b.md",
      "a b",
      "a/../b",
      "../a",
      `a${String.fromCodePoint(0x200b)}`,
    ]) {
      expect(isDocumentPath(path), path).toBe(false);
    }
    expect(isDocumentPath("a".repeat(MAX_DOCUMENT_PATH_LENGTH))).toBe(false);
    expect(isDocumentPath(`${"a".repeat(MAX_DOCUMENT_SEGMENT_LENGTH)}/b`)).toBe(true);
    expect(isDocumentPath(`${"a".repeat(MAX_DOCUMENT_SEGMENT_LENGTH + 1)}/b`)).toBe(false);
    expect(isFolderPath("")).toBe(true);
    expect(isFolderPath("guides")).toBe(true);
    expect(isFolderPath("/")).toBe(false);
  });

  it("knows its folder, its name and the folders above it", () => {
    expect(folderOf("guides/onboarding")).toBe("guides");
    expect(folderOf("readme")).toBe("");
    expect(nameOf("guides/onboarding")).toBe("onboarding");
    expect(nameOf("readme")).toBe("readme");
    expect(foldersAbove("guides/setup/git")).toEqual(["guides", "guides/setup"]);
    expect(foldersAbove("readme")).toEqual([]);
  });
});

describe("the links a text makes", () => {
  it("finds the pages a Markdown text links to, each once, by path, without pictures or the web", () => {
    const text = [
      'See [onboarding](guides/onboarding) and [again](guides/onboarding#setup "the setup").',
      "Also [the web](https://example.com/guides/x), ![a picture](img/pic), <guides/not-a-link>,",
      "[ref][1] and [two]( guides/two ) and [three](<guides/three>).",
      "",
      "[1]: guides/one",
      "[4]: <guides/four> 'a title'",
      "   [5]: /not/a/page",
    ].join("\n");
    expect(documentPathsIn(text)).toEqual([
      "guides/four",
      "guides/onboarding",
      "guides/one",
      "guides/three",
      "guides/two",
    ]);
  });

  it("finds nothing in text without links, refuses what is not a path, and stays quick on hostile input", () => {
    expect(documentPathsIn("")).toEqual([]);
    expect(documentPathsIn("guides/onboarding alone is words")).toEqual([]);
    expect(documentPathsIn("[x](a//b) [y](/root) [z](Guides/x) [w](a b)")).toEqual([]);
    const hostile = `${"[".repeat(5000)}${"(".repeat(5000)}${"a/".repeat(2000)}`;
    const started = Date.now();
    expect(documentPathsIn(hostile)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
