import { readFile } from "node:fs/promises";
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
