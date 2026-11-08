import { describe, expect, it } from "vitest";
import { contentFor, hookEventId, isPeopleEvent, ownAnswerOf } from "./dispatcher.js";

describe("a hook event's id", () => {
  it("names the stream and the number, so that one id is one event across both streams", () => {
    expect(hookEventId("console", 42)).toBe("console:42");
    expect(hookEventId("plugin", 42)).toBe("plugin:42");
    expect(hookEventId("console", 42)).not.toBe(hookEventId("plugin", 42));
  });
});

describe("the workspace's people events", () => {
  it("reach a plugin that reads the directory, with their content, and no other hook gets content without board:read", () => {
    expect(isPeopleEvent("person.deactivated")).toBe(true);
    expect(isPeopleEvent("person.joined")).toBe(true);
    expect(isPeopleEvent("task.created")).toBe(false);
    expect(contentFor(["people:read:all"], "person.deactivated")).toBe(true);
    expect(contentFor(["people:read:all"], "task.created")).toBe(false);
    expect(contentFor(["people:read"], "person.deactivated")).toBe(false);
    expect(contentFor(["board:read"], "task.created")).toBe(true);
  });
});

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
