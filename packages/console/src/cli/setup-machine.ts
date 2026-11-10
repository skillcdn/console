import { spawn } from "node:child_process";
import { access, chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";

// What `console agent setup` needs of the machine it makes an agent's (ADR-0088): where the OS
// account's files are, files to write, a few programs to run, and the browser. The command takes
// it as it takes everything else, so that the tests hand it one that touches nothing.

/** How a program ended, with the end of what it said. */
export interface Ran {
  /** Its exit code; `null` where it never started or was ended. */
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

export interface SetupMachine {
  /** The operating system, as the runtime names it: `darwin`, `linux`, `win32`. */
  readonly platform: string;
  /** The OS account the command runs in, its home directory, and its number where the system has one. */
  readonly user: string;
  readonly home: string;
  readonly uid: number | undefined;
  /** How this command is started: the runtime and the command's own file, absolute; nothing when unknown. */
  readonly self: readonly string[] | undefined;
  /** Where programs are looked for, as the command was started. */
  readonly searchPath: string | undefined;
  /** A path of this machine put together: absolute as it is, else under the first part. */
  path(...parts: readonly string[]): string;
  exists(path: string): Promise<boolean>;
  /** A file as text; nothing where there is none, or it does not read. */
  read(path: string): Promise<string | undefined>;
  /** Whether a directory holds anything; false for one that is not there. */
  holds(path: string): Promise<boolean>;
  /** Writes a whole file in a mode, its folders made on the way. */
  write(path: string, text: string, mode: number): Promise<void>;
  /** Runs a program to its end, with what is added to the environment; never a shell. */
  run(
    command: string,
    args: readonly string[],
    options?: { readonly env?: Readonly<Record<string, string>> | undefined },
  ): Promise<Ran>;
  /** Opens an address in the machine's browser; whether it seems to have. */
  open(url: string): Promise<boolean>;
}

/** The most of a program's words that is kept: its end. */
const MAX_OUTPUT = 16 * 1024;
/** How long a program is given before it is ended: a clone over a slow line, not a prompt nobody answers. */
const RUN_TIMEOUT_MS = 180_000;

/** What opens an address in the browser, by platform; never through a shell, which would read the address. */
const OPENERS: Readonly<Record<string, readonly string[]>> = {
  darwin: ["open"],
  linux: ["xdg-open"],
  win32: ["rundll32", "url.dll,FileProtocolHandler"],
};

export function createSetupMachine(
  env: Readonly<Record<string, string | undefined>>,
  script: string | undefined,
): SetupMachine {
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    user = "";
  }
  const run: SetupMachine["run"] = (command, args, options) =>
    new Promise<Ran>((done) => {
      let out = "";
      let err = "";
      const keep = (kept: string, chunk: Buffer): string =>
        `${kept}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT);
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, [...args], {
          env: { ...env, ...options?.env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        done({ code: null, out, err: error instanceof Error ? error.message : "did not start" });
        return;
      }
      const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
      child.stdout?.on("data", (chunk: Buffer) => {
        out = keep(out, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        err = keep(err, chunk);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        done({ code: null, out, err: error.message });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        done({ code, out, err });
      });
    });
  return {
    platform: process.platform,
    user: user.length === 0 ? "unknown" : user,
    home: homedir(),
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    self: script === undefined ? undefined : [process.execPath, resolve(script)],
    searchPath: env.PATH,
    path: (...parts) => {
      const [first = "", ...rest] = parts;
      return resolve(isAbsolute(first) ? first : resolve(first), ...rest);
    },
    async exists(path) {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    async read(path) {
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
      }
    },
    async holds(path) {
      try {
        return (await readdir(path)).length > 0;
      } catch {
        return false;
      }
    },
    async write(path, text, mode) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, { mode });
      // A file that was there keeps the mode it had: say it again.
      await chmod(path, mode);
    },
    run,
    async open(url) {
      const opener = OPENERS[process.platform];
      const [command, ...before] = opener ?? [];
      if (command === undefined) {
        return false;
      }
      return (await run(command, [...before, url])).code === 0;
    },
  };
}
