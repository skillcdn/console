import { randomInt } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { type as osType, release, userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { createSpawn } from "../runner/process.js";
import type { Spawn, WakeSocket } from "../runner/types.js";

// What `console runner` needs of the machine it runs on (ADR-0085): the desk it was started in,
// processes to start, a few files of its own there, and the word to stop. The command takes it
// as it takes everything else, so that the tests hand it one that touches nothing.

export interface RunnerHost {
  /** The desk: the directory the runner was started in. */
  readonly cwd: string;
  readonly spawn: Spawn;
  /** The operating system as it calls itself, and the OS account the runner runs in. */
  readonly os: string;
  readonly user: string;
  /** A file under the desk, as text; nothing where there is none. */
  readText(path: string): Promise<string | undefined>;
  /** Writes a file under the desk for its owner alone, its folders made on the way. */
  writePrivate(path: string, text: string): Promise<void>;
  /** Removes a file under the desk; one that is not there is removed already. */
  remove(path: string): Promise<void>;
  /** Opens a socket for a wake source: the messages of text it carries, until it closes. */
  socket(url: string): WakeSocket;
  /**
   * Resolves when the process is asked to stop. Asked for by the command that runs a runner, and
   * by no other: listening for the word to stop is what keeps a process from stopping by itself.
   */
  untilStopped(): Promise<void>;
  readonly random: () => number;
}

/** The runner's host on this machine, in `cwd`, with `env` as what a product's process begins from. */
export function createRunnerHost(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): RunnerHost {
  /** A path under the desk, or an error: nothing the runner reads or writes is anywhere else. */
  const under = (path: string): string => {
    const full = resolve(cwd, path);
    const away = relative(cwd, full);
    if (away.length === 0 || away.startsWith("..") || isAbsolute(away)) {
      throw new Error("a file of the runner's is under its desk");
    }
    return full;
  };
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    user = "";
  }
  return {
    cwd,
    spawn: createSpawn(env),
    os: `${osType()} ${release()}`,
    user: user.length === 0 ? "unknown" : user,
    async readText(path) {
      try {
        return await readFile(under(path), "utf8");
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      }
    },
    async writePrivate(path, text) {
      const full = under(path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, text, { mode: 0o600 });
      // A file that was there keeps the mode it had: say it again.
      await chmod(full, 0o600);
    },
    async remove(path) {
      await rm(under(path), { force: true });
    },
    socket(url) {
      const socket = new WebSocket(url);
      const waiting: string[] = [];
      let closed = false;
      let wake: (() => void) | undefined;
      const turn = (): void => {
        wake?.();
        wake = undefined;
      };
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          waiting.push(event.data);
          turn();
        }
      });
      const end = (): void => {
        closed = true;
        turn();
      };
      socket.addEventListener("close", end);
      socket.addEventListener("error", end);
      return {
        messages: (async function* () {
          for (;;) {
            const next = waiting.shift();
            if (next !== undefined) {
              yield next;
            } else if (closed) {
              return;
            } else {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          }
        })(),
        send(text) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(text);
          }
        },
        close() {
          end();
          try {
            socket.close();
          } catch {
            // Closed already, or never opened: there is nothing to close.
          }
        },
      };
    },
    untilStopped: () =>
      new Promise<void>((done) => {
        process.once("SIGINT", () => done());
        process.once("SIGTERM", () => done());
      }),
    // A session's mark is made of these: not to be guessed from outside the machine.
    random: () => randomInt(0, 2 ** 31) / 2 ** 31,
  };
}

/** Where a session's files and the runner's own are kept under the desk: ignored by its repository. */
export const WORK_DIR = "work";
export const workPath = (path: string): string => join(WORK_DIR, path);
