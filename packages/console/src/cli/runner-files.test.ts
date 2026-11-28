import { describe, expect, it } from "vitest";
import { keptBySourceOf, keptFileOf, MAX_KEPT_NAMES, runnerStateOf } from "./runner-files.js";

// What the runner reads back of its own files under the desk's work/ (ADR-0166): anything may
// stand in a file of the desk, and what is read of one is data, bounded, or nothing.

describe("what a wake source kept, as its file says it", () => {
  it("reads the pairs the runner wrote, the oldest first, and writes them as it reads them", () => {
    const kept = [
      ["brought:D0123ABCD:", "1762800600.000100"],
      ["carried:D0123ABCD:1762800600.000100", "woke"],
      ["judged:G0TEAM:1762800000.000100", "1762800550.000100"],
    ] as const;
    expect(keptBySourceOf(keptFileOf(kept))).toEqual(kept);
    expect(keptFileOf(kept).endsWith("\n")).toBe(true);
    expect(keptBySourceOf("[]")).toEqual([]);
  });

  it("is nothing kept where the file is none, does not read, or holds no list", () => {
    for (const text of [undefined, "", "{", "null", "7", '"kept"', JSON.stringify({ a: 1 })]) {
      expect(keptBySourceOf(text), String(text)).toBeUndefined();
    }
  });

  it("leaves out what is no pair of a name and what stands under it, each within its length", () => {
    const long = "n".repeat(201);
    expect(
      keptBySourceOf(
        JSON.stringify([
          ["a"],
          ["a", 1],
          [1, "a"],
          "odd",
          null,
          [["x"], "v"],
          ["a", "b", "c"],
          ["", "v"],
          [long, "v"],
          ["name", long],
          { 0: "a", 1: "b" },
          ["carried:C0OPS:1762800600.000100", "said"],
        ]),
      ),
    ).toEqual([["carried:C0OPS:1762800600.000100", "said"]]);
    // A name and what stands under it of the longest that is kept are kept.
    const most = "n".repeat(200);
    expect(keptBySourceOf(JSON.stringify([[most, most]]))).toEqual([[most, most]]);
  });

  it("reads and writes no more names than a source keeps: the latest", () => {
    const many = Array.from(
      { length: MAX_KEPT_NAMES + 3000 },
      (_, index) => [`carried:C0OPS:${index}`, "said"] as const,
    );
    const read = keptBySourceOf(JSON.stringify(many));
    expect(read).toHaveLength(MAX_KEPT_NAMES);
    expect(read?.[0]).toEqual([`carried:C0OPS:${3000}`, "said"]);
    expect(read?.at(-1)).toEqual([`carried:C0OPS:${MAX_KEPT_NAMES + 2999}`, "said"]);
    const written = keptBySourceOf(keptFileOf(many));
    expect(written).toHaveLength(MAX_KEPT_NAMES);
    expect(written?.[0]).toEqual([`carried:C0OPS:${3000}`, "said"]);
  });
});

describe("what the runner kept between its own restarts, as its file says it", () => {
  it("reads when the conversation began where the file says a moment, and nothing where it says anything else", () => {
    expect(
      runnerStateOf(
        JSON.stringify({
          delivered: 4,
          conversation: "c-1",
          driver: "claude",
          began: 1_762_800_000_000,
        }),
      ),
    ).toEqual({ delivered: 4, conversation: "c-1", driver: "claude", began: 1_762_800_000_000 });
    for (const began of ["soon", -1, 0, 1.5, 1e300, null, [1_762_800_000_000], {}]) {
      expect(
        runnerStateOf(JSON.stringify({ delivered: 4, began })),
        JSON.stringify(began),
      ).not.toHaveProperty("began");
    }
    // A file written before the runner kept it says none: everything counts as held.
    expect(runnerStateOf(JSON.stringify({ delivered: 4 }))).not.toHaveProperty("began");
  });

  it("is nothing kept where the file is none, does not read, or counts nothing delivered", () => {
    for (const text of [undefined, "", "{", "null", "[]", JSON.stringify({ delivered: "4" })]) {
      expect(runnerStateOf(text), String(text)).toBeUndefined();
    }
    expect(runnerStateOf(JSON.stringify({ delivered: -1 }))).toBeUndefined();
  });
});
