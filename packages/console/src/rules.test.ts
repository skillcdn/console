import { describe, expect, it } from "vitest";
import { isDocumentPath } from "./documents.js";
import { MAX_RULES_LENGTH } from "./limits.js";
import { isReferenceRules, PROJECT_RULES_TEMPLATE, REFERENCE_RULES, RULES_PATH } from "./rules.js";

/** Printable ASCII and the newline: English, with nothing invisible in it. */
const PLAIN = /^[\x20-\x7e\n]*$/;

describe("the console's own rules", () => {
  it("fit what a rules page may hold, carry nothing invisible, and are known as themselves", () => {
    expect(REFERENCE_RULES.length).toBeLessThan(MAX_RULES_LENGTH / 2);
    expect(REFERENCE_RULES).toMatch(PLAIN);
    expect(PROJECT_RULES_TEMPLATE).toMatch(PLAIN);
    expect(REFERENCE_RULES.startsWith("# Rules for agents on this board\n")).toBe(true);
    expect(isReferenceRules(REFERENCE_RULES)).toBe(true);
    expect(isReferenceRules(`${REFERENCE_RULES}\n\n`)).toBe(true);
    expect(isReferenceRules(`${REFERENCE_RULES}\nOne more.`)).toBe(false);
    expect(isDocumentPath(RULES_PATH)).toBe(true);
  });

  it("name what an agent runs and reads by name, so that a rename is caught here", () => {
    for (const named of [
      "console rules",
      "console rules write --workspace",
      "console skills",
      "console task <number>",
      "console docs",
      "console ask",
      "working-the-board",
      "load_skill",
      "SKILLCDN.md",
    ]) {
      expect(REFERENCE_RULES).toContain(named);
    }
    // The template is headings alone: nothing an agent could mistake for a rule.
    expect(PROJECT_RULES_TEMPLATE.split("\n").filter((line) => /^[^#\s]/.test(line))).toEqual([
      "Adds to the workspace's rules, for the agents at work here.",
    ]);
  });
});
