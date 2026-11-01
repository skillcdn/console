// The package as a console reads it: built, then checked with `console-plugin check`, the same
// check a store would run. Fails on anything the console would refuse the plugin for.
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const consoleDir = dirname(
  createRequire(import.meta.url).resolve("@skillcdn/console/package.json"),
);
const consolePlugin = join(consoleDir, "dist", "cli", "plugin-main.js");

describe("the package", () => {
  beforeAll(async () => {
    const { buildPlugin } = (await import(pathToFileURL(join(root, "build.mjs")).href)) as {
      buildPlugin: (root: string) => Promise<void>;
    };
    await buildPlugin(root);
  }, 60_000);

  it("passes console-plugin check", async () => {
    const run = promisify(execFile);
    const { stdout } = await run(process.execPath, [consolePlugin, "check", root]).catch(
      (error: { stdout?: string; stderr?: string }) => {
        throw new Error(`console-plugin check failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`);
      },
    );
    expect(stdout).toMatch(/^ok: /m);
  }, 30_000);
});
