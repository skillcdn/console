// What is installed (docs/specs/plugins.md, "Lifecycle"): the dependencies of `PLUGINS_DIR`'s
// package.json, each a package under its node_modules with a manifest, read as data without
// running anything. A plugin that cannot be read is failed with its reasons, and the console
// boots on; two that share a key fail together, so that neither answers for the other.
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CURRENT_PLUGIN_API,
  PLUGIN_API_MAJORS,
  type PluginManifest,
  parsePluginManifest,
} from "@skillcdn/console/plugin";
import * as z from "zod";

export interface InstalledPlugin {
  readonly key: string;
  /** The package's name on the registry, by which it is installed. */
  readonly packageName: string;
  readonly version: string;
  /** The package's directory, resolved: where the server module, the bundle and the skills are. */
  readonly dir: string;
  readonly manifest: PluginManifest;
}

export interface FailedPlugin {
  /** The key, where the manifest had one; else the package's name. */
  readonly key: string;
  readonly packageName: string;
  readonly version: string | undefined;
  readonly dir: string | undefined;
  readonly problems: readonly string[];
}

export interface Discovery {
  /** The plugins that read, in the order they may be enabled: a plugin after those it requires. */
  readonly plugins: readonly InstalledPlugin[];
  readonly failed: readonly FailedPlugin[];
}

const packageSchema = z.object({
  name: z.string().min(1).max(214).optional(),
  version: z.string().min(1).max(100).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
});

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

/** The dependencies of the directory's package.json: what the image installed. */
export async function installedPackageNames(pluginsDir: string): Promise<string[]> {
  const parsed = packageSchema.safeParse(await readJson(join(pluginsDir, "package.json")));
  if (!parsed.success) {
    throw new Error(`${join(pluginsDir, "package.json")} is not a package manifest`);
  }
  return Object.keys(parsed.data.dependencies ?? {}).filter((name) => PACKAGE_NAME.test(name));
}

/** The plugin at `dir`, read as a console reads one, or its problems. */
export async function readPluginPackage(
  packageName: string,
  dir: string,
): Promise<InstalledPlugin | FailedPlugin> {
  const problems: string[] = [];
  let version: string | undefined;
  try {
    const pkg = packageSchema.safeParse(await readJson(join(dir, "package.json")));
    if (!pkg.success) {
      problems.push("package.json is not a package manifest");
    } else {
      version = pkg.data.version;
      if (version === undefined) {
        problems.push("package.json names no version");
      }
    }
  } catch (error) {
    problems.push(
      `package.json could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let manifestValue: unknown;
  try {
    manifestValue = await readJson(join(dir, "console-plugin.json"));
  } catch (error) {
    problems.push(
      `console-plugin.json could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { key: packageName, packageName, version, dir, problems };
  }
  const parsed = parsePluginManifest(manifestValue);
  if (!parsed.ok) {
    problems.push(...parsed.problems.map((problem) => `console-plugin.json: ${problem}`));
    const key =
      typeof manifestValue === "object" &&
      manifestValue !== null &&
      typeof (manifestValue as { key?: unknown }).key === "string"
        ? (manifestValue as { key: string }).key
        : packageName;
    return { key, packageName, version, dir, problems };
  }
  const manifest = parsed.manifest;
  if (!(PLUGIN_API_MAJORS as readonly number[]).includes(manifest.pluginApi)) {
    problems.push(
      `the plugin was written against plugin API ${manifest.pluginApi}; this console serves ${PLUGIN_API_MAJORS.join(", ")} (currently ${CURRENT_PLUGIN_API})`,
    );
  }
  if (problems.length > 0 || version === undefined) {
    return { key: manifest.key, packageName, version, dir, problems };
  }
  return { key: manifest.key, packageName, version, dir, manifest };
}

/**
 * The plugins the image installed into `pluginsDir`, read and ordered, with those that failed.
 * The order puts a plugin after every plugin it requires; a plugin that requires one that is
 * missing or failed fails with it, and a cycle fails every plugin in it.
 */
export async function discoverPlugins(pluginsDir: string): Promise<Discovery> {
  const root = await realpath(resolve(pluginsDir));
  const names = await installedPackageNames(root);
  const read = await Promise.all(
    names.map(async (name) => {
      const dir = join(root, "node_modules", ...name.split("/"));
      try {
        return await readPluginPackage(name, await realpath(dir));
      } catch (error) {
        return {
          key: name,
          packageName: name,
          version: undefined,
          dir: undefined,
          problems: [
            `the package is not installed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        } satisfies FailedPlugin;
      }
    }),
  );
  const failed: FailedPlugin[] = read.filter(
    (plugin): plugin is FailedPlugin => "problems" in plugin,
  );
  const candidates = read.filter((plugin): plugin is InstalledPlugin => "manifest" in plugin);

  // Two packages with one key: neither answers for the other.
  const byKey = new Map<string, InstalledPlugin[]>();
  for (const plugin of candidates) {
    byKey.set(plugin.key, [...(byKey.get(plugin.key) ?? []), plugin]);
  }
  const unique: InstalledPlugin[] = [];
  for (const [key, plugins] of byKey) {
    if (plugins.length > 1) {
      for (const plugin of plugins) {
        failed.push({
          ...plugin,
          problems: [
            `the key ${key} is also the key of ${plugins
              .filter((other) => other !== plugin)
              .map((other) => other.packageName)
              .join(", ")}`,
          ],
        });
      }
    } else if (plugins[0] !== undefined) {
      unique.push(plugins[0]);
    }
  }

  // What each requires must be there, and read; then a plugin comes after its requirements.
  const available = new Map(unique.map((plugin) => [plugin.key, plugin]));
  const ordered: InstalledPlugin[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const failedKeys = new Set(failed.map((plugin) => plugin.key));
  const fail = (plugin: InstalledPlugin, problem: string) => {
    available.delete(plugin.key);
    failedKeys.add(plugin.key);
    failed.push({ ...plugin, problems: [problem] });
  };
  const place = (plugin: InstalledPlugin): boolean => {
    if (placed.has(plugin.key)) {
      return true;
    }
    if (visiting.has(plugin.key)) {
      fail(plugin, `requires ${plugin.key} through a cycle`);
      return false;
    }
    visiting.add(plugin.key);
    for (const required of Object.keys(plugin.manifest.requires)) {
      const found = available.get(required);
      if (found === undefined) {
        fail(
          plugin,
          failedKeys.has(required)
            ? `requires ${required}, which failed`
            : `requires ${required}, which is not installed`,
        );
        visiting.delete(plugin.key);
        return false;
      }
      if (!place(found)) {
        if (available.has(plugin.key)) {
          fail(plugin, `requires ${required}, which failed`);
        }
        visiting.delete(plugin.key);
        return false;
      }
    }
    visiting.delete(plugin.key);
    placed.add(plugin.key);
    ordered.push(plugin);
    return true;
  };
  for (const plugin of unique) {
    if (available.has(plugin.key)) {
      place(plugin);
    }
  }
  return {
    plugins: ordered,
    failed: failed.sort((a, b) => a.key.localeCompare(b.key)),
  };
}
