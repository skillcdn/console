import type { CollectionDescription } from "@skillcdn/console/plugin";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { type SweepTarget, sweepCollections } from "./retention.js";

function collection(name: string): CollectionDescription {
  return {
    name,
    indexes: [],
    search: [],
    owner: null,
    project: "none",
    read: [],
    readOwn: [],
    history: false,
    retention: { days: 30, by: "createdAt" },
  };
}

const targets: readonly SweepTarget[] = [
  { plugin: "broken", collection: collection("lines") },
  { plugin: "fine", collection: collection("lines") },
  { plugin: "fine", collection: collection("deliveries") },
];

function capture() {
  const lines: { level: number; msg: string; plugin?: string; collection?: string }[] = [];
  const logger = pino(
    { level: "info" },
    { write: (line: string) => lines.push(JSON.parse(line) as (typeof lines)[number]) },
  );
  return { logger, lines };
}

describe("a pass of the retention sweep", () => {
  it("sweeps each collection apart: one that fails is a line in the log, and the rest are swept", async () => {
    const { logger, lines } = capture();
    const swept = await sweepCollections(
      targets,
      async (target) => {
        if (target.plugin === "broken") {
          throw new Error("canceling statement due to statement timeout");
        }
        return target.collection.name === "lines" ? 3 : 2;
      },
      { logger, more: () => true },
    );
    expect(swept).toEqual({ fine: 5 });
    expect(
      lines.filter((line) => line.level === 40).map((line) => [line.plugin, line.collection]),
    ).toEqual([["broken", "lines"]]);
    expect(
      lines.filter((line) => line.level === 30).map((line) => [line.plugin, line.collection]),
    ).toEqual([
      ["fine", "lines"],
      ["fine", "deliveries"],
    ]);
  });

  it("ends where the pass's time is up, and leaves the rest to the next pass", async () => {
    const { logger } = capture();
    const reached: string[] = [];
    const swept = await sweepCollections(
      targets.slice(1),
      async (target) => {
        reached.push(target.collection.name);
        return 1;
      },
      { logger, more: () => reached.length === 0 },
    );
    expect(reached).toEqual(["lines"]);
    expect(swept).toEqual({ fine: 1 });
  });
});
