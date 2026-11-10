import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Spawn } from "./types.js";

// A child process on this machine, as a driver needs one: lines in, lines out, and how it
// ended. The only place the runner starts anything.

/** How much of what a process wrote on its standard error is kept: its end. */
const MAX_ERRORS_LENGTH = 4000;

/**
 * What starts child processes with `base` as the environment each begins from, which whoever
 * reads the process's environment hands in: a product reads its own sign-in from there.
 */
export function createSpawn(base: Readonly<Record<string, string | undefined>>): Spawn {
  return (command, args, options) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...base, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let errors = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errors = `${errors}${chunk}`.slice(-MAX_ERRORS_LENGTH);
    });
    const exited = new Promise<{
      code: number | null;
      signal: string | null;
      error?: string | undefined;
    }>((resolve) => {
      // A command that is not there to start says so here, and never closes.
      child.once("error", (error) => resolve({ code: null, signal: null, error: error.message }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    // A pipe that broke is how a process that is gone says so; how it ended says the rest.
    child.stdin.on("error", () => undefined);
    return {
      write: (line) =>
        new Promise<void>((resolve, reject) => {
          if (!child.stdin.writable) {
            reject(new Error("the process takes no more input"));
            return;
          }
          child.stdin.write(`${line}\n`, (error) => {
            if (error === null || error === undefined) {
              resolve();
            } else {
              reject(error);
            }
          });
        }),
      end: () => {
        child.stdin.end();
      },
      lines: createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }),
      errors: () => errors,
      kill: (signal) => {
        child.kill(signal);
      },
      exited,
    };
  };
}
