import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("puts a file in place of the one there whole or not at all: written beside it first, and nothing of that left behind", async () => {
    const desk = await mkdtemp(join(tmpdir(), "console-runner-host-"));
    try {
      const host = createRunnerHost(desk, {});
      // The first, its folder made on the way, and the next in its place.
      await host.replacePrivate("work/runner-state.json", '{"delivered":1}\n');
      expect(await readFile(join(desk, "work/runner-state.json"), "utf8")).toBe(
        '{"delivered":1}\n',
      );
      await host.replacePrivate("work/runner-state.json", '{"delivered":2}\n');
      expect(await readFile(join(desk, "work/runner-state.json"), "utf8")).toBe(
        '{"delivered":2}\n',
      );
      // Nothing beside it is left: what was written first was put in its place.
      expect(await readdir(join(desk, "work"))).toEqual(["runner-state.json"]);
      // Its owner's alone to read, where the system says so of a file.
      if (process.platform !== "win32") {
        expect((await stat(join(desk, "work/runner-state.json"))).mode & 0o777).toBe(0o600);
      }
      // Many at once leave one of them whole, and never a mix of two.
      const texts = Array.from({ length: 12 }, (_, index) => `${String(index).repeat(20_000)}\n`);
      await Promise.all(texts.map((text) => host.replacePrivate("work/runner-state.json", text)));
      expect(texts).toContain(await readFile(join(desk, "work/runner-state.json"), "utf8"));
      expect(await readdir(join(desk, "work"))).toEqual(["runner-state.json"]);
      // Where it cannot be put in place, a folder standing there say, the write fails, what
      // stood there stands, and nothing written beside it is left.
      await mkdir(join(desk, "work/runner-kept-slack.json"));
      await writeFile(join(desk, "work/runner-kept-slack.json/inside"), "kept");
      await expect(host.replacePrivate("work/runner-kept-slack.json", "[]\n")).rejects.toThrow();
      expect(await readFile(join(desk, "work/runner-kept-slack.json/inside"), "utf8")).toBe("kept");
      expect((await readdir(join(desk, "work"))).sort()).toEqual([
        "runner-kept-slack.json",
        "runner-state.json",
      ]);
      // Nothing outside the desk, as with every file of the runner's.
      await expect(host.replacePrivate("../outside.json", "{}")).rejects.toThrow("under its desk");
    } finally {
      await rm(desk, { recursive: true, force: true });
    }
  });
});
