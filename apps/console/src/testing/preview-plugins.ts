import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

// What `pnpm dev:plugins` is told on the command line: the port, and the built plugins of other
// checkouts to install beside the fixtures, each a directory laid out as the image lays a plugin
// out (its package.json, its console-plugin.json, its dist/), so that a plugin's pages are looked
// at here without a provider. Not compiled.

export interface PreviewArguments {
  /** `--port <n>`; none for the default. */
  readonly port: number | undefined;
  /** `--plugin <dir>`, as often as given, in order. */
  readonly pluginDirs: readonly string[];
}

/** The arguments as given, or an error saying what was not understood. */
export function parsePreviewArguments(argv: readonly string[]): PreviewArguments {
  let port: number | undefined;
  const pluginDirs: string[] = [];
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    const value = argv[at + 1];
    if (flag === "--port") {
      const parsed = value === undefined ? Number.NaN : Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
        throw new Error(`--port takes a port number, not ${String(value)}`);
      }
      port = parsed;
      at += 1;
    } else if (flag === "--plugin") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--plugin takes the directory of a built plugin");
      }
      pluginDirs.push(value);
      at += 1;
    } else {
      throw new Error(`${String(flag)} is not understood: --port <n>, --plugin <dir>`);
    }
  }
  return { port, pluginDirs };
}

const kindOf = async (path: string): Promise<"file" | "directory" | undefined> => {
  const found = await stat(path).catch(() => undefined);
  return found === undefined ? undefined : found.isDirectory() ? "directory" : "file";
};

/**
 * A built plugin at `dir`, resolved from `cwd`: the name its package.json gives it, by which
 * the plugins directory lists it; or an error saying why it cannot be installed, so that a
 * wrong path or an unbuilt checkout stops the console before it starts.
 */
export async function builtPluginAt(
  dir: string,
  cwd: string,
): Promise<{ readonly name: string; readonly dir: string }> {
  const root = resolve(cwd, dir);
  if ((await kindOf(root)) !== "directory") {
    throw new Error(`${root} is not a directory: --plugin names the directory of a built plugin`);
  }
  const packageText = await readFile(join(root, "package.json"), "utf8").catch(() => undefined);
  if (packageText === undefined) {
    throw new Error(`${root} has no package.json: --plugin names the directory of a built plugin`);
  }
  let name: unknown;
  try {
    name = (JSON.parse(packageText) as { readonly name?: unknown }).name;
  } catch {
    throw new Error(`${root}/package.json is not JSON`);
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${root}/package.json names no package`);
  }
  if ((await kindOf(join(root, "console-plugin.json"))) !== "file") {
    throw new Error(`${root} has no console-plugin.json: not a plugin`);
  }
  if ((await kindOf(join(root, "dist"))) !== "directory") {
    throw new Error(`${root} has no dist/: build the plugin first`);
  }
  return { name, dir: root };
}
