import { describe, expect, it } from "vitest";
import { RUN_STATUSES, TASK_STATES } from "./index.js";

describe("the vocabulary", () => {
  it("names the states a task moves through, ending in done or dropped", () => {
    expect(TASK_STATES.slice(-2)).toEqual(["done", "dropped"]);
    expect(new Set(TASK_STATES).size).toBe(TASK_STATES.length);
  });

  it("names what a run is doing, with one state for waiting on a person", () => {
    expect(RUN_STATUSES).toContain("waiting");
    expect(new Set(RUN_STATUSES).size).toBe(RUN_STATUSES.length);
  });
});
