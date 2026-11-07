import { cp, mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Test support for the plugins: a PLUGINS_DIR laid out as the image lays one out, from the
// fixtures, and where the compiled host and the console's own code are. Not compiled.

const require = createRequire(import.meta.url);

/** The example plugin, built by its workspace, as the app's dev dependency resolves it. */
export const HELLO_PLUGIN_DIR = dirname(require.resolve("console-plugin-hello/package.json"));
/** The fixture that tries everything the ceiling refuses. */
export const EVIL_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/plugin-evil/", import.meta.url));
/** The compiled host, which the tests need built: `pnpm turbo run build --filter=@skillcdn/console-app`. */
export const HOST_ENTRY = fileURLToPath(
  new URL("../../dist/plugins/plugin-host.js", import.meta.url),
);

/** What a plugin's package ships, and nothing of its sources or its dependencies. */
const SHIPPED =
  /^(?:console-plugin\.json|package\.json|SKILLCDN\.md|README\.md|dist|server|skills|migrations)(?:[\\/]|$)/;

/**
 * Writes a plugins directory as the image installs one: a package.json naming each plugin as a
 * dependency, and each under node_modules/<name>, copied with what it ships.
 */
export async function writePluginsDir(
  root: string,
  plugins: readonly { readonly name: string; readonly dir: string }[],
): Promise<string> {
  await mkdir(join(root, "node_modules"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "plugins",
        private: true,
        dependencies: Object.fromEntries(plugins.map((plugin) => [plugin.name, "*"])),
      },
      null,
      2,
    ),
  );
  for (const plugin of plugins) {
    const source = await realpath(plugin.dir);
    const target = join(root, "node_modules", ...plugin.name.split("/"));
    await cp(source, target, {
      recursive: true,
      dereference: true,
      filter: (path) => {
        const relative = path.slice(source.length).replace(/^[\\/]/, "");
        return relative.length === 0 || SHIPPED.test(relative);
      },
    });
  }
  return realpath(root);
}

/** The environment the host gets on this platform: what Node needs on Windows, and nothing of the console's. */
export function hostEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of ["SYSTEMROOT", "SystemRoot", "TEMP", "TMP"]) {
    const value = env[name];
    if (value !== undefined) {
      kept[name] = value;
    }
  }
  return kept;
}

/** The fixture with a schema of its own, for the tests of `storage:sql`. */
export const SQL_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/plugin-sql/", import.meta.url));

/** The fixture with arguments of every kind, endpoints and skills, for the tests of the command and the routes. */
export const GATE_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/plugin-gate/", import.meta.url));

/** The fixtures of the board: a plugin with a decision, a hook, a job, an api and outbound requests, and a second one on the same board. */
export const LEAVE_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/plugin-leave/", import.meta.url));
export const AUDIT_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/plugin-audit/", import.meta.url));

/** The fixture whose page may use WebRTC where an administrator turns it on. */
export const CALL_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/plugin-call/", import.meta.url));
