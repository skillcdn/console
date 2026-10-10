import { describe, expect, it } from "vitest";
import { EVENT_KINDS, RUN_STATUSES, TASK_PRIORITIES, TASK_STATES } from "./vocabulary.js";

describe("the vocabulary", () => {
  it("names the states a task moves through, ending in done or dropped", () => {
    expect(TASK_STATES.slice(-2)).toEqual(["done", "dropped"]);
    expect(new Set(TASK_STATES).size).toBe(TASK_STATES.length);
  });

  it("names what a run is doing, with one state for waiting on a person", () => {
    expect(RUN_STATUSES).toContain("waiting");
    expect(new Set(RUN_STATUSES).size).toBe(RUN_STATUSES.length);
  });

  it("names the priorities in rising order, and every kind of event once", () => {
    expect(TASK_PRIORITIES[0]).toBe("low");
    expect(TASK_PRIORITIES.at(-1)).toBe("urgent");
    expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length);
    for (const kind of EVENT_KINDS) {
      expect(kind).toMatch(/^(person|project|task|decision|run|document)\.[a-z_]+$/);
    }
  });
});
