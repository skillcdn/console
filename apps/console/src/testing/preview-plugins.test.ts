import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { builtPluginAt, parsePreviewArguments } from "./preview-plugins.js";

const made: string[] = [];
const scratch = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "console-preview-"));
  made.push(dir);
  return dir;
};
afterAll(async () => {
  for (const dir of made) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("what dev:plugins is told", () => {
  it("takes a port once and a plugin's directory as often as given, and refuses the rest", () => {
    const bare = { port: undefined, pluginDirs: [], publicUrl: undefined, keep: false };
    expect(parsePreviewArguments([])).toEqual(bare);
    expect(
      parsePreviewArguments(["--plugin", "../plugins/hr", "--port", "11201", "--plugin", "x"]),
    ).toEqual({ ...bare, port: 11201, pluginDirs: ["../plugins/hr", "x"] });
    expect(() => parsePreviewArguments(["--port", "many"])).toThrow(/--port takes a port number/);
    expect(() => parsePreviewArguments(["--plugin"])).toThrow(/--plugin takes the directory/);
    expect(() => parsePreviewArguments(["--plugin", "--port"])).toThrow(/--plugin takes/);
    expect(() => parsePreviewArguments(["--verbose"])).toThrow(/is not understood/);
  });

  it("takes the address the console is reached at from outside, an origin and nothing more, and whether to keep the database", () => {
    expect(
      parsePreviewArguments(["--public-url", "https://preview.example.com/", "--keep"]),
    ).toMatchObject({ publicUrl: "https://preview.example.com", keep: true });
    expect(parsePreviewArguments(["--public-url", "http://10.0.0.5:8080"])).toMatchObject({
      publicUrl: "http://10.0.0.5:8080",
      keep: false,
    });
    for (const wrong of [
      "preview.example.com",
      "ftp://preview.example.com",
      "https://preview.example.com/console",
      "https://preview.example.com/?x=1",
      "https://user:pass@preview.example.com",
    ]) {
      expect(() => parsePreviewArguments(["--public-url", wrong])).toThrow(/--public-url takes/);
    }
    expect(() => parsePreviewArguments(["--public-url"])).toThrow(/--public-url takes/);
  });

  it("passes over the -- that pnpm hands on with the flags that followed it", () => {
    expect(parsePreviewArguments(["--", "--plugin", "../plugins/hr"])).toMatchObject({
      port: undefined,
      pluginDirs: ["../plugins/hr"],
    });
    expect(parsePreviewArguments(["--port", "11201", "--", "--plugin", "x"])).toMatchObject({
      port: 11201,
      pluginDirs: ["x"],
    });
    expect(() => parsePreviewArguments(["--plugin", "--"])).toThrow(/--plugin takes/);
  });

  it("installs a built plugin by its package's name, and says why one cannot be", async () => {
    const dir = await scratch();
    await expect(builtPluginAt("nothing", dir)).rejects.toThrow(/is not a directory/);
    const plugin = join(dir, "hr");
    await mkdir(plugin);
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/has no package.json/);
    await writeFile(join(plugin, "package.json"), "{");
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/is not JSON/);
    await writeFile(join(plugin, "package.json"), JSON.stringify({ version: "1.0.0" }));
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/names no package/);
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify({ name: "@acme/console-plugin-hr", version: "1.0.0" }),
    );
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/has no console-plugin.json/);
    await writeFile(join(plugin, "console-plugin.json"), "{}");
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/has no dist\/: build the plugin first/);
    await mkdir(join(plugin, "dist"));
    expect(await builtPluginAt("hr", dir)).toEqual({
      name: "@acme/console-plugin-hr",
      dir: plugin,
    });
  });
});
