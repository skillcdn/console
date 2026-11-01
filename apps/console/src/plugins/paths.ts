// Where the plugin host may read (docs/specs/plugins.md, "The host"): the plugins, and the
// console's own code the host and its threads import, resolved to the real paths the permission
// model compares against, since a package manager lays dependencies out through links.
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/** The compiled host, beside this module. */
export const HOST_ENTRY = fileURLToPath(new URL("./plugin-host.js", import.meta.url));

/** The root of the app: two levels above dist/plugins, where its node_modules are. */
const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The directories the host may read: the plugins, each plugin's own directory where it is linked
 * into the plugins' directory from elsewhere (a checkout, while a plugin is written), the app with
 * its dependencies, and the package the host imports from with that package's own dependency,
 * which a package manager may keep outside both. Nothing else: not the home directory, not the
 * system, not the console's configuration.
 */
export async function allowedReadRoots(
  pluginsDir: string,
  pluginDirs: readonly string[] = [],
): Promise<string[]> {
  const roots = [
    pluginsDir,
    ...pluginDirs,
    APP_ROOT,
    dirname(require.resolve("@skillcdn/console/package.json")),
    dirname(require.resolve("zod/package.json")),
  ];
  const resolved = await Promise.all(roots.map((root) => realpath(root)));
  return [...new Set(resolved)];
}
