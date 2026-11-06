import { describe, expect, it } from "vitest";
import { ownAnswerOf } from "./dispatcher.js";

describe("the answer to a plugin's own decision", () => {
  it("reaches a hook with board:decisions alone, by the option's label and key, and nothing else does", () => {
    const data = { question: "Leave?", option: "Approve", optionKey: "approve" };
    expect(ownAnswerOf(["board:decisions"], "decision.answered", data, true)).toEqual({
      option: "Approve",
      optionKey: "approve",
    });
    // The person's own answer has a label and no key.
    expect(
      ownAnswerOf(["board:decisions"], "decision.answered", { option: "Neither" }, true),
    ).toEqual({ option: "Neither" });
    // Another plugin's decision, another kind of event, or no board:decisions: nothing.
    expect(ownAnswerOf(["board:decisions"], "decision.answered", data, false)).toEqual({});
    expect(ownAnswerOf(["board:decisions"], "decision.raised", data, true)).toEqual({});
    expect(ownAnswerOf(["board:tasks"], "decision.answered", data, true)).toEqual({});
  });
});
