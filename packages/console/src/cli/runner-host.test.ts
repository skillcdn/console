import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunnerHost } from "./runner-host.js";

// The word to stop, as the runner's host hears it: a signal, or the end of the process that
// keeps the runner running, where the runner was told which that is.

const SIGNALS = ["SIGINT", "SIGTERM"] as const;
type Listener = (...args: unknown[]) => void;

/** Resolves to what was first: the promise, or so long a wait. */
const within = <T>(promise: Promise<T>, ms: number): Promise<T | "still waiting"> =>
  Promise.race([
    promise,
    new Promise<"still waiting">((done) => setTimeout(() => done("still waiting"), ms)),
  ]);

/** A process that ended: started, and waited for. */
const ended = (): Promise<number> =>
  new Promise<number>((done, failed) => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    child.once("error", failed);
    child.once("exit", () => done(child.pid ?? 0));
  });

describe("the runner's host", () => {
  // What a host listens to is taken off again: the test's own process is asked to stop by others.
  let before: Record<(typeof SIGNALS)[number], Listener[]>;
  beforeEach(() => {
    before = {
      SIGINT: process.listeners("SIGINT") as Listener[],
      SIGTERM: process.listeners("SIGTERM") as Listener[],
    };
  });
  afterEach(() => {
    for (const signal of SIGNALS) {
      for (const listener of process.listeners(signal) as Listener[]) {
        if (!before[signal].includes(listener)) {
          process.removeListener(signal, listener);
        }
      }
    }
  });

  it("waits for the word to stop where nothing keeps the runner, or what is named is no process's number", async () => {
    for (const named of [undefined, "", "0", "-4", "12abc", "1e3", " 42", "99999999999"]) {
      const host = createRunnerHost(
        tmpdir(),
        { CONSOLE_RUNNER_KEEPER: named },
        { keeperPauseMs: 5 },
      );
      expect(await within(host.untilStopped(), 40)).toBe("still waiting");
    }
  });

  it("goes on while the process that keeps the runner is there, and stops when it is gone", async () => {
    const kept = createRunnerHost(
      tmpdir(),
      { CONSOLE_RUNNER_KEEPER: String(process.pid) },
      { keeperPauseMs: 5 },
    );
    expect(await within(kept.untilStopped(), 40)).toBe("still waiting");

    const left = createRunnerHost(
      tmpdir(),
      { CONSOLE_RUNNER_KEEPER: String(await ended()) },
      { keeperPauseMs: 5 },
    );
    expect(await within(left.untilStopped(), 2000)).toBeUndefined();
  });
});
