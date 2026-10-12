import { describe, expect, it } from "vitest";
import { isDocumentPath } from "./documents.js";
import { MAX_RULES_LENGTH } from "./limits.js";
import {
  fillRules,
  isReferenceRules,
  languageNameOf,
  PROJECT_RULES_TEMPLATE,
  REFERENCE_RULES,
  RULES_LANGUAGE_PLACEHOLDER,
  RULES_PATH,
} from "./rules.js";

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

  it("say the language of the person where they are read, and the task's when they chose none", () => {
    expect(REFERENCE_RULES).toContain(RULES_LANGUAGE_PLACEHOLDER);
    expect(languageNameOf("ko")).toBe("Korean");
    expect(languageNameOf("en")).toBe("English");
    expect(languageNameOf("ko-KR")).toContain("Korean");
    expect(languageNameOf("not a tag")).toBe("not a tag");
    expect(fillRules("Write in {language}; {language} it is.", "ko")).toBe(
      "Write in Korean; Korean it is.",
    );
    expect(fillRules("Write in {language}.", null)).toBe(
      "Write in the language the task is written in.",
    );
    expect(fillRules(REFERENCE_RULES, "ko")).not.toContain(RULES_LANGUAGE_PLACEHOLDER);
    // The page itself keeps the placeholder: filled, it is no longer the console's own.
    expect(isReferenceRules(fillRules(REFERENCE_RULES, "ko"))).toBe(false);
  });
});
