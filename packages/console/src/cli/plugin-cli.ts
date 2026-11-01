// The `console-plugin` command (docs/specs/plugins.md, "Authoring"): what a plugin's author runs.
// `init` writes a plugin from the template; `check` reads one as the console would. Everything it
// touches comes through `io`, so that the tests run it with no process of its own.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ServerLoad } from "../plugin/load.js";
import { isPluginKey, RESERVED_PLUGIN_KEYS } from "../plugin/manifest.js";
import { checkPlugin } from "./plugin-check.js";
import { nameFromKey, writePluginFromTemplate } from "./plugin-init.js";

export interface PluginCliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  readonly cwd: string;
  /** The template the package ships, `template/plugin` beside `dist/`. */
  readonly templateDir: string;
  readonly version: string | undefined;
  /** Loads a server module in a hardened thread and describes it. */
  loadServer(file: string): Promise<ServerLoad>;
}

/** The exit codes: done; refused or failed; not understood. */
export const PLUGIN_EXIT = { ok: 0, failed: 1, usage: 2 } as const;

export const PLUGIN_USAGE = `console-plugin: writes and checks a plugin of the SkillCDN Console.

  console-plugin init <dir> --key <key> [--name <name>] [--console <dependency>]
      Writes a plugin into <dir>, which must not exist or be empty, from the template this
      package ships: the manifest, a server module with one collection, one command and one
      query, the source of a web bundle with one page and one widget, one skill with its
      manifest, tests, and the build. <key> is the plugin's key, lowercase letters, digits and
      hyphens; --name its name for people, from the key unless said; --console what the
      plugin's devDependency on @skillcdn/console says, ^<this version> unless said.

  console-plugin check [<dir>]
      Reads the plugin in <dir>, the working directory unless said, as a console would, built:
      the manifest, package.json (a permissive license, no install scripts, files that ship
      what runs), the server module loaded under the host's hardening and held to the manifest,
      the web bundle self-contained and its classes prefixed, the skills, the migrations.
      Exits 0 with a summary, 1 with every problem found.

  console-plugin help | --version

The contract is docs/specs/plugins.md of the console's repository, shipped with this package.
`;

function wordsOf(items: readonly string[], prefix: string): string {
  return items.map((item) => `  ${prefix}: ${item}\n`).join("");
}

export async function runPluginCli(argv: readonly string[], io: PluginCliIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.stdout(PLUGIN_USAGE);
    return PLUGIN_EXIT.ok;
  }
  if (command === "--version" || command === "version") {
    io.stdout(`${io.version ?? "unknown"}\n`);
    return PLUGIN_EXIT.ok;
  }
  if (command === "init") {
    return init(rest, io);
  }
  if (command === "check") {
    return check(rest, io);
  }
  io.stderr(`console-plugin: ${command} is not a command; console-plugin help lists them\n`);
  return PLUGIN_EXIT.usage;
}

async function init(args: readonly string[], io: PluginCliIo): Promise<number> {
  let values: { key?: string; name?: string; console?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...args],
      options: { key: { type: "string" }, name: { type: "string" }, console: { type: "string" } },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    io.stderr(`console-plugin init: ${error instanceof Error ? error.message : String(error)}\n`);
    return PLUGIN_EXIT.usage;
  }
  const [dir, ...extra] = positionals;
  const key = values.key;
  if (dir === undefined || extra.length > 0 || key === undefined) {
    io.stderr(
      "usage: console-plugin init <dir> --key <key> [--name <name>] [--console <dependency>]\n",
    );
    return PLUGIN_EXIT.usage;
  }
  if (!isPluginKey(key)) {
    io.stderr(
      `console-plugin init: ${key} is not a key: lowercase letters, digits and hyphens, 2 to 32 long, starting with a letter\n`,
    );
    return PLUGIN_EXIT.usage;
  }
  if (RESERVED_PLUGIN_KEYS.includes(key)) {
    io.stderr(`console-plugin init: ${key} is a word the console reserves; choose another key\n`);
    return PLUGIN_EXIT.usage;
  }
  const name = values.name ?? nameFromKey(key);
  if (name.length === 0 || name.length > 40 || /[\r\n]/.test(name)) {
    io.stderr("console-plugin init: --name is one line of up to 40 characters\n");
    return PLUGIN_EXIT.usage;
  }
  const consoleDependency = values.console ?? (io.version === undefined ? "*" : `^${io.version}`);
  const target = resolve(io.cwd, dir);
  try {
    const written = await writePluginFromTemplate(io.templateDir, target, {
      key,
      name,
      consoleDependency,
    });
    io.stdout(`Wrote the plugin ${key} into ${target}: ${written.length} files.\n`);
    io.stdout(
      `Next: cd ${dir}, install the dependencies (npm install), build (npm run build), run the tests (npm test), and check it as a console would (npm run check). The contract is docs/specs/plugins.md in node_modules/@skillcdn/console/.\n`,
    );
    return PLUGIN_EXIT.ok;
  } catch (error) {
    io.stderr(`console-plugin init: ${error instanceof Error ? error.message : String(error)}\n`);
    return PLUGIN_EXIT.failed;
  }
}

async function check(args: readonly string[], io: PluginCliIo): Promise<number> {
  const [dir, ...extra] = args;
  if (extra.length > 0 || dir?.startsWith("-")) {
    io.stderr("usage: console-plugin check [<dir>]\n");
    return PLUGIN_EXIT.usage;
  }
  const root = resolve(io.cwd, dir ?? ".");
  const report = await checkPlugin(root, (file) => io.loadServer(file));
  io.stdout(`console-plugin check ${root}\n`);
  io.stdout(wordsOf(report.errors, "error"));
  io.stdout(wordsOf(report.warnings, "warning"));
  if (report.ok) {
    io.stdout(
      `ok: ${report.summary ?? "a plugin"}${report.warnings.length > 0 ? `; ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}` : ""}\n`,
    );
    return PLUGIN_EXIT.ok;
  }
  io.stdout(
    `${report.errors.length} problem${report.errors.length === 1 ? "" : "s"}${report.summary === null ? "" : ` in ${report.summary}`}\n`,
  );
  return PLUGIN_EXIT.failed;
}
