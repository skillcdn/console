import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGLISH, KOREAN } from "@skillcdn/console";
import { EVENT_KINDS } from "@skillcdn/console/api";
import { describe, expect, it } from "vitest";

// A person reads a failure in their language: the pages look the code up in the pack, the server
// having no packs (ADR-0012). What is held here is that a code cannot be added to the server
// without its words, which would show a person a generic failure.

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Dotted names in the source that are no failure: the plugin host's members, and a file's name. */
const NOT_A_FAILURE = /^(console\.[a-z]+|files\.[a-z]+|package\.json|acme\.test)$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith(".ts") && !/\.(int|browser)?\.?test\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

function dottedNames(): string[] {
  const events = new Set<string>(EVENT_KINDS);
  const names = sourceFiles(SOURCE).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map(
      (match) => match[1] ?? "",
    ),
  );
  return [...new Set(names)].filter((name) => !events.has(name) && !NOT_A_FAILURE.test(name));
}

describe("what the server can answer", () => {
  it("has its words in every language", () => {
    const codes = [...dottedNames(), "internal", "not_found"].sort();
    for (const pack of [ENGLISH, KOREAN]) {
      const words: Readonly<Record<string, string>> = pack.messages.errors;
      expect(codes.filter((code) => words[code] === undefined)).toEqual([]);
    }
  });

  it("reads as a sentence: a capital first, a stop last", () => {
    for (const [code, words] of Object.entries(ENGLISH.messages.errors)) {
      expect(words, code).toMatch(/^[A-Z].*\.$/);
    }
  });
});
