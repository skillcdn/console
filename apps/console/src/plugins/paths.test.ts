import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowedReadRoots } from "./paths.js";

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "console-paths-"));
  made.push(dir);
  return dir;
}

describe("allowedReadRoots", () => {
  it("lets the host read the plugins' directory, a plugin linked in from elsewhere and the console's code, each once", async () => {
    const plugins = await directory();
    const checkout = await directory();
    // The plugins' directory comes again as a plugin's own, as it does for every plugin installed
    // into it; a checkout linked in from elsewhere is a root of its own.
    const roots = await allowedReadRoots(plugins, [checkout, plugins]);
    expect(roots).toContain(await realpath(plugins));
    expect(roots).toContain(await realpath(checkout));
    expect(new Set(roots).size).toBe(roots.length);
    expect(roots.some((root) => root.endsWith("console"))).toBe(true);
  });
});
