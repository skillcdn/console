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

/**
 * A secret typed at the terminal, shown as nothing while it is typed; when standard input is
 * not a terminal, its first line.
 */
export async function readSecret(prompt: string): Promise<string> {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    return (await readStdin()).split(/\r?\n/, 1)[0] ?? "";
  }
  stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          done();
          reject(new Error("interrupted"));
          return;
        }
        if (character === "\r" || character === "\n") {
          done();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** A file named on the command line, as text. */
export function readFileAt(path: string): Promise<string> {
  return readFile(path, "utf8");
}
