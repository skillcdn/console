import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EVIL_PLUGIN_DIR, HELLO_PLUGIN_DIR, writePluginsDir } from "../testing/plugins.js";
import { discoverPlugins } from "./discovery.js";

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "console-discovery-"));
  made.push(dir);
  return dir;
}

/** A made-up plugin: its manifest and its package, and a server module that is never loaded here. */
async function fakePlugin(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  pkg: Record<string, unknown> = {},
): Promise<void> {
  const dir = join(root, "node_modules", ...name.split("/"));
  await mkdir(join(dir, "dist", "server"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", ...pkg }),
  );
  await writeFile(
    join(dir, "console-plugin.json"),
    typeof manifest.raw === "string" ? manifest.raw : JSON.stringify(manifest),
  );
  await writeFile(join(dir, "dist", "server", "index.js"), "export default {};\n");
}

async function pluginsDir(names: readonly string[]): Promise<string> {
  const root = await scratch();
  await mkdir(join(root, "node_modules"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "plugins",
      private: true,
      dependencies: Object.fromEntries(names.map((name) => [name, "*"])),
    }),
  );
  return root;
}

const manifestOf = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  name: { en: key },
  description: { en: `The ${key} plugin.` },
  pluginApi: 1,
  server: "dist/server/index.js",
  ...extra,
});

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("discoverPlugins", () => {
  it("reads the plugins the image installed, from the fixtures", async () => {
    const root = await writePluginsDir(await scratch(), [
      { name: "console-plugin-hello", dir: HELLO_PLUGIN_DIR },
      { name: "console-plugin-evil", dir: EVIL_PLUGIN_DIR },
    ]);
    const found = await discoverPlugins(root);
    expect(found.failed).toEqual([]);
    expect(found.plugins.map((plugin) => [plugin.key, plugin.packageName])).toEqual([
      ["hello", "console-plugin-hello"],
      ["evil", "console-plugin-evil"],
    ]);
    expect(found.plugins[0]?.manifest.pages.map((page) => page.key)).toEqual(["greetings"]);
    expect(found.plugins[0]?.version).toBe("0.1.0");
  });

  it("fails a plugin whose manifest the console cannot read, and keeps the rest", async () => {
    const root = await pluginsDir(["good", "bad", "broken", "missing", "@scope/old"]);
    await fakePlugin(root, "good", manifestOf("good"));
    await fakePlugin(root, "bad", manifestOf("settings"));
    await fakePlugin(root, "broken", { raw: "{ not json" });
    await fakePlugin(root, "@scope/old", manifestOf("old", { pluginApi: 7 }));
    const found = await discoverPlugins(root);
    expect(found.plugins.map((plugin) => plugin.key)).toEqual(["good"]);
    const problems = Object.fromEntries(
      found.failed.map((plugin) => [plugin.key, plugin.problems[0] ?? ""]),
    );
    expect(Object.keys(problems)).toEqual(["broken", "missing", "old", "settings"]);
    expect(problems.broken).toMatch(/^console-plugin\.json could not be read: /);
    expect(problems.missing).toMatch(/^the package is not installed: /);
    expect(problems.old).toMatch(
      /^the plugin was written against plugin API 7; this console serves 1/,
    );
    expect(problems.settings).toMatch(/^console-plugin\.json: key: is a word the console reserves/);
  });

  it("holds a plugin to the consoles it declares, against the console's own version", async () => {
    const root = await pluginsDir(["fits", "older", "newer", "any"]);
    await fakePlugin(root, "fits", manifestOf("fits", { console: ">=0.4.3 <0.6" }));
    await fakePlugin(root, "older", manifestOf("older", { console: ">=0.4.5 <0.6" }));
    await fakePlugin(root, "newer", manifestOf("newer", { console: "^0.3.0" }));
    await fakePlugin(root, "any", manifestOf("any"));
    const found = await discoverPlugins(root, { consoleVersion: "0.4.4" });
    expect(found.plugins.map((plugin) => plugin.key)).toEqual(["fits", "any"]);
    expect(found.failed.map((plugin) => `${plugin.key}: ${plugin.problems[0]}`)).toEqual([
      "newer: the plugin is built for a console ^0.3.0; this console is 0.4.4",
      "older: the plugin is built for a console >=0.4.5 <0.6; this console is 0.4.4",
    ]);
    // The default is the console's own version, which the fixtures are written for.
    expect((await discoverPlugins(root)).plugins.map((plugin) => plugin.key)).toContain("any");
  });

  it("fails two plugins that share a key, so that neither answers for the other", async () => {
    const root = await pluginsDir(["one", "two"]);
    await fakePlugin(root, "one", manifestOf("same"));
    await fakePlugin(root, "two", manifestOf("same"));
    const found = await discoverPlugins(root);
    expect(found.plugins).toEqual([]);
    expect(found.failed.map((plugin) => `${plugin.packageName}: ${plugin.problems[0]}`)).toEqual([
      "one: the key same is also the key of two",
      "two: the key same is also the key of one",
    ]);
  });

  it("orders a plugin after what it requires, and fails one whose requirement is missing or failed", async () => {
    const root = await pluginsDir(["crm", "leave", "finance", "orphan", "loop-a", "loop-b"]);
    await fakePlugin(root, "crm", manifestOf("crm"));
    await fakePlugin(root, "leave", manifestOf("leave", { requires: { crm: "^1.0.0" } }));
    await fakePlugin(
      root,
      "finance",
      manifestOf("finance", { requires: { leave: "*", crm: "*" } }),
    );
    await fakePlugin(root, "orphan", manifestOf("orphan", { requires: { nothing: "*" } }));
    await fakePlugin(root, "loop-a", manifestOf("loop-a", { requires: { "loop-b": "*" } }));
    await fakePlugin(root, "loop-b", manifestOf("loop-b", { requires: { "loop-a": "*" } }));
    const found = await discoverPlugins(root);
    expect(found.plugins.map((plugin) => plugin.key)).toEqual(["crm", "leave", "finance"]);
    expect(found.failed.map((plugin) => `${plugin.key}: ${plugin.problems[0]}`)).toEqual([
      "loop-a: requires loop-a through a cycle",
      "loop-b: requires loop-a, which failed",
      "orphan: requires nothing, which is not installed",
    ]);
  });

  it("refuses a directory without a package manifest", async () => {
    const root = await scratch();
    await expect(discoverPlugins(root)).rejects.toThrow();
  });
});
