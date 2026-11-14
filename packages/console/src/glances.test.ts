import { describe, expect, it } from "vitest";
import { createGlanceReader, GLANCE_RETRY_MAX_MS, GLANCE_RETRY_MS } from "./glances.js";

interface Project {
  readonly id: string;
  readonly key: string;
}
const ledger: Project = { id: "p1", key: "ledger" };
const studio: Project = { id: "p2", key: "studio" };

/** A reader over reads a test settles by hand, and a clock it turns by hand. */
function reading(again?: (failure: unknown) => boolean) {
  const asked: { readonly key: string; answer(glance: string): void; fail(why: unknown): void }[] =
    [];
  const stored: [string, string][] = [];
  const timers: { readonly ms: number; run: () => void; off: boolean }[] = [];
  const reader = createGlanceReader<Project, string>({
    read: (project) =>
      new Promise<string>((resolve, reject) => {
        asked.push({ key: project.key, answer: resolve, fail: reject });
      }),
    store: (id, glance) => stored.push([id, glance]),
    again,
    later: (run, ms) => {
      const timer = { ms, run, off: false };
      timers.push(timer);
      return () => {
        timer.off = true;
      };
    },
  });
  /** Lets what was settled be heard. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** Turns the clock past every wait that was not called off. */
  const pass = () => {
    for (const timer of timers.splice(0)) {
      if (!timer.off) {
        timer.run();
      }
    }
  };
  return { reader, asked, stored, timers, settle, pass };
}

describe("the glances a front page reads (ADR-0107)", () => {
  it("reads each project once, however often it is asked for", async () => {
    const { reader, asked, stored, settle } = reading();
    reader.want([ledger, studio]);
    reader.want([ledger, studio]);
    reader.want([studio, ledger]);
    expect(asked.map((one) => one.key)).toEqual(["ledger", "studio"]);
    asked[0]?.answer("ledger's");
    await settle();
    expect(stored).toEqual([["p1", "ledger's"]]);
    // A project shown at a glance later is read then, and the others not again.
    const late: Project = { id: "p3", key: "ops" };
    reader.want([ledger, studio, late]);
    expect(asked.map((one) => one.key)).toEqual(["ledger", "studio", "ops"]);
  });

  it("reads every project shown again at a new reading, and none that is no longer shown", async () => {
    const { reader, asked } = reading();
    reader.want([ledger, studio]);
    reader.renew();
    expect(asked.map((one) => one.key)).toEqual(["ledger", "studio", "ledger", "studio"]);
    // No tile is at a glance any more: nothing is read at the next reading.
    reader.want([]);
    reader.renew();
    expect(asked).toHaveLength(4);
  });

  it("drops an answer that comes after a newer reading was asked for", async () => {
    const { reader, asked, stored, settle } = reading();
    reader.want([ledger]);
    reader.renew();
    // The newer one answers first, the older one after it.
    asked[1]?.answer("new");
    await settle();
    asked[0]?.answer("old");
    await settle();
    expect(stored).toEqual([["p1", "new"]]);
  });

  it("tries a read that failed again, a little later each time, until it answers", async () => {
    const { reader, asked, stored, timers, settle, pass } = reading();
    reader.want([ledger]);
    asked[0]?.fail(new Error("502"));
    await settle();
    expect(asked).toHaveLength(1);
    expect(timers.map((timer) => timer.ms)).toEqual([GLANCE_RETRY_MS]);
    pass();
    expect(asked).toHaveLength(2);
    asked[1]?.fail(new Error("502"));
    await settle();
    expect(timers.map((timer) => timer.ms)).toEqual([GLANCE_RETRY_MS * 2]);
    pass();
    asked[2]?.answer("at last");
    await settle();
    expect(stored).toEqual([["p1", "at last"]]);
    expect(timers).toHaveLength(0);
  });

  it("never waits longer than the longest wait", async () => {
    const { reader, asked, timers, settle, pass } = reading();
    reader.want([ledger]);
    const waits: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      asked[attempt]?.fail(new Error("502"));
      await settle();
      waits.push(timers[0]?.ms ?? -1);
      pass();
    }
    expect(Math.max(...waits)).toBe(GLANCE_RETRY_MAX_MS);
    expect(waits.at(-1)).toBe(GLANCE_RETRY_MAX_MS);
  });

  it("does not try again what the console refused, nor a project no longer shown; either is read when shown anew", async () => {
    const refused = reading((failure) => failure !== "refused");
    refused.reader.want([ledger]);
    refused.asked[0]?.fail("refused");
    await refused.settle();
    expect(refused.timers).toHaveLength(0);
    // The page shows it at a glance again: asked once more.
    refused.reader.want([ledger]);
    expect(refused.asked).toHaveLength(2);

    const gone = reading();
    gone.reader.want([ledger]);
    gone.reader.want([]);
    gone.asked[0]?.fail(new Error("502"));
    await gone.settle();
    expect(gone.timers).toHaveLength(0);
    gone.reader.want([ledger]);
    expect(gone.asked).toHaveLength(2);
  });

  it("calls a waiting try off at a new reading, which asks by itself", async () => {
    const { reader, asked, timers, settle, pass } = reading();
    reader.want([ledger]);
    asked[0]?.fail(new Error("502"));
    await settle();
    reader.renew();
    expect(asked).toHaveLength(2);
    expect(timers.every((timer) => timer.off)).toBe(true);
    pass();
    expect(asked).toHaveLength(2);
  });

  it("stores nothing and tries nothing once it is ended", async () => {
    const { reader, asked, stored, timers, settle } = reading();
    reader.want([ledger, studio]);
    reader.stop();
    asked[0]?.answer("late");
    asked[1]?.fail(new Error("502"));
    await settle();
    expect(stored).toEqual([]);
    expect(timers).toHaveLength(0);
    reader.want([ledger]);
    reader.renew();
    expect(asked).toHaveLength(2);
  });
});
