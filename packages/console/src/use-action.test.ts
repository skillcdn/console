import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import { en } from "./i18n/en.js";
import { ko } from "./i18n/ko.js";
import { errorWords, wordsForFailure } from "./use-action.js";

const SERVER_WORDS = "the manager is not another active person of the workspace";

describe("what a failure says to a person", () => {
  it("is the code read in their language, never the server's English", () => {
    const failure = new ApiError(400, "person.invalid_manager", SERVER_WORDS);
    expect(errorWords(failure, "fallback", ko)).toBe(ko.errors["person.invalid_manager"]);
    expect(errorWords(failure, "fallback", ko)).not.toContain("manager");
    expect(errorWords(failure, "fallback", en)).toBe(en.errors["person.invalid_manager"]);
    expect(errorWords(failure)).toBe(en.errors["person.invalid_manager"]);
  });

  it("falls back where the pack has no words: a code it does not know, or no answer at all", () => {
    expect(errorWords(new ApiError(400, "plugin.hr.over_limit", "Ten days."), "fallback", ko)).toBe(
      "fallback",
    );
    expect(errorWords(new Error("boom"), "fallback", ko)).toBe("fallback");
    expect(errorWords(undefined, "fallback", ko)).toBe("fallback");
    expect(errorWords(new ApiError(400, "constructor", "no"), "fallback", ko)).toBe("fallback");
  });

  it("leaves a plugin's own refusal to the plugin", () => {
    expect(wordsForFailure(new ApiError(400, "plugin.hr.over_limit", "Ten days."), ko)).toBe(
      undefined,
    );
    expect(wordsForFailure(new ApiError(403, "plugin.forbidden", "no"), ko)).toBe(
      ko.errors["plugin.forbidden"],
    );
  });
});
