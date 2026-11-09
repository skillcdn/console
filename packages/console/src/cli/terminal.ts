import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { secretKeys } from "./keys.js";

// The terminal's side of the command: what is read from it. Nothing here is reached by tests,
// which hand the command readers of their own.

/** All of standard input, once it ends. */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      content += chunk;
    });
    process.stdin.on("end", () => resolve(content));
    process.stdin.on("error", reject);
  });
}

/**
 * A secret typed at the terminal, unseen: the prompt goes to standard error, what is typed is
 * echoed nowhere, Enter ends it, Backspace takes a character back, and Ctrl-C gives the command
 * up as it does elsewhere; what a key that types nothing sends is not taken ({@link secretKeys}). A pipe or a file in place of the terminal is read whole, as
 * {@link readStdin} reads it, so that a script hands the value over as before.
 */
export function readSecret(prompt: string): Promise<string> {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    return readStdin();
  }
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    const keys = secretKeys();
    const finish = (interrupted: boolean): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      if (interrupted) {
        // Raw mode delivers no signal for Ctrl-C: the command ends as any does on one.
        process.kill(process.pid, "SIGINT");
        return;
      }
      resolve(keys.typed);
    };
    const onData = (chunk: string): void => {
      const state = keys.take(chunk);
      if (state !== "reading") {
        finish(state === "interrupted");
      }
    };
    stdin.on("data", onData);
  });
}

/** A file named on the command line, as text. */
export function readFileAt(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** A file named on the command line, as bytes: what is handed in. */
export function readBytesAt(path: string): Promise<Uint8Array> {
  return readFile(path);
}

/**
 * A file read from the console, written at the path, or into it under the file's name when
 * the path is a directory; says where it went, in full.
 */
export async function writeBytesAt(path: string, bytes: Uint8Array, name: string): Promise<string> {
  const target = (await stat(path).catch(() => undefined))?.isDirectory() ? join(path, name) : path;
  await writeFile(target, bytes);
  return resolve(target);
}
