import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

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
