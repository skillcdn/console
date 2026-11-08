import { describe, expect, it } from "vitest";
import {
  contentFor,
  hookEventId,
  isPeopleEvent,
  lifecycleOf,
  ownAnswerOf,
  retryAfterOf,
} from "./dispatcher.js";

describe("what a failed hook asks of the next try", () => {
  it("waits retryAfterMs from the refusal's data, within an hour, and nothing otherwise", () => {
    expect(retryAfterOf({ data: { retryAfterMs: 30_000 } })).toBe(30_000);
    expect(retryAfterOf({ data: { retryAfterMs: 90 * 60_000 } })).toBe(60 * 60_000);
    expect(retryAfterOf({ data: { retryAfterMs: 0.4 } })).toBe(1);
    expect(retryAfterOf({ data: { retryAfterMs: -1 } })).toBeUndefined();
    expect(retryAfterOf({ data: { retryAfterMs: "soon" } })).toBeUndefined();
    expect(retryAfterOf({ data: "nothing" })).toBeUndefined();
    expect(retryAfterOf({})).toBeUndefined();
  });
});

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
    // A plugin's lifecycle reaches whoever may call it (ADR-0072), by the key the event names.
    expect(lifecycleOf({ kind: "plugin.enabled", data: { key: "hr" } })).toBe("hr");
    expect(lifecycleOf({ kind: "plugin.upgraded", data: { key: "hr" } })).toBe("hr");
    expect(lifecycleOf({ kind: "plugin.configured", data: { key: "hr" } })).toBeUndefined();
    expect(lifecycleOf({ kind: "plugin.enabled", data: {} })).toBeUndefined();
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
