import { describe, expect, it } from "vitest";
import { reasonMoment } from "./agent-state.js";

describe("the moment of the reason an agent account stands for", () => {
  const SINCE = "2026-11-23T08:41:00.000Z";

  it("is its own where the reason was said under a state that stayed", () => {
    expect(reasonMoment({ since: SINCE, reasonAt: "2026-11-25T14:12:00.000Z" })).toBe(
      "2026-11-25T14:12:00.000Z",
    );
    // A minute apart is another moment, as the pages show moments to the minute.
    expect(reasonMoment({ since: SINCE, reasonAt: "2026-11-23T08:42:00.000Z" })).toBe(
      "2026-11-23T08:42:00.000Z",
    );
  });

  it("is none where the reason came with its state, the clocks of two machines apart", () => {
    expect(reasonMoment({ since: SINCE, reasonAt: SINCE })).toBeUndefined();
    expect(reasonMoment({ since: SINCE, reasonAt: "2026-11-23T08:41:59.999Z" })).toBeUndefined();
    expect(reasonMoment({ since: SINCE, reasonAt: "2026-11-23T08:40:30.000Z" })).toBeUndefined();
  });

  it("is none where the console keeps no moment for it, or said one that is none", () => {
    expect(reasonMoment({ since: SINCE })).toBeUndefined();
    expect(reasonMoment({ since: SINCE, reasonAt: null })).toBeUndefined();
    expect(reasonMoment({ since: SINCE, reasonAt: "not a moment" })).toBeUndefined();
    expect(reasonMoment({ since: "not a moment", reasonAt: SINCE })).toBeUndefined();
  });
});
