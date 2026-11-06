// The `console-plugin` command (docs/specs/plugins.md, "Authoring"): what a plugin's author runs.
// `init` writes a plugin from the template; `check` reads one as the console would. Everything it
// touches comes through `io`, so that the tests run it with no process of its own.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ServerLoad } from "../plugin/load.js";
import { isPluginKey, RESERVED_PLUGIN_KEYS } from "../plugin/manifest.js";
import { checkPlugin } from "./plugin-check.js";
import { LANGUAGE_TAG, nameFromKey, PACKAGE_NAME, writePluginFromTemplate } from "./plugin-init.js";

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
      [--package <name>] [--repository <url> [--directory <path>]] [--languages <tags>]
      Writes a plugin into <dir>, which must not exist or be empty, from the template this
      package ships: the manifest, a server module with one collection, one command and one
      query, the source of a web bundle with one page and one widget, one skill with its
      manifest, tests, and the build. <key> is the plugin's key, lowercase letters, digits and
      hyphens; --name its name for people, from the key unless said; --console what the
      plugin's devDependency on @skillcdn/console says, ^<this version> unless said;
      --package the package's name, console-plugin-<key> unless said, a scoped one
      (@scope/console-plugin-<key>) published as public; --repository the https address of
      the repository it lives in, with --directory its path there in a repository of several,
      which fill repository, homepage and bugs and the manifest's store; --languages the
      languages of its words with commas between, en first (en,ko), each language map and
      both manifests' translations given the others as English words to translate, of which
      check warns while they stay English.

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

const INIT_USAGE =
  "usage: console-plugin init <dir> --key <key> [--name <name>] [--console <dependency>] [--package <name>] [--repository <url> [--directory <path>]] [--languages <tags>]\n";

async function init(args: readonly string[], io: PluginCliIo): Promise<number> {
  let values: {
    key?: string;
    name?: string;
    console?: string;
    package?: string;
    repository?: string;
    directory?: string;
    languages?: string;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...args],
      options: {
        key: { type: "string" },
        name: { type: "string" },
        console: { type: "string" },
        package: { type: "string" },
        repository: { type: "string" },
        directory: { type: "string" },
        languages: { type: "string" },
      },
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
    io.stderr(INIT_USAGE);
    return PLUGIN_EXIT.usage;
  }
  const packageName = values.package;
  if (packageName !== undefined && (packageName.length > 214 || !PACKAGE_NAME.test(packageName))) {
    io.stderr(
      `console-plugin init: ${packageName} is not a package name: lowercase letters, digits, hyphens, dots and underscores, with a scope as @scope/name\n`,
    );
    return PLUGIN_EXIT.usage;
  }
  if (values.directory !== undefined && values.repository === undefined) {
    io.stderr("console-plugin init: --directory goes with --repository\n");
    return PLUGIN_EXIT.usage;
  }
  if (values.repository !== undefined && !isRepositoryAddress(values.repository)) {
    io.stderr(
      `console-plugin init: ${values.repository} is not the https address of a repository\n`,
    );
    return PLUGIN_EXIT.usage;
  }
  if (
    values.directory !== undefined &&
    !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(values.directory)
  ) {
    io.stderr(
      "console-plugin init: --directory is a path within the repository, with forward slashes\n",
    );
    return PLUGIN_EXIT.usage;
  }
  const languages = values.languages
    ?.split(",")
    .map((language) => language.trim())
    .filter((language) => language.length > 0);
  if (
    languages !== undefined &&
    (languages.length === 0 || languages.some((language) => !LANGUAGE_TAG.test(language)))
  ) {
    io.stderr(
      "console-plugin init: --languages is a list of language tags with commas between, en first: en,ko\n",
    );
    return PLUGIN_EXIT.usage;
  }
  if (languages !== undefined && languages[0] !== "en") {
    io.stderr(
      "console-plugin init: --languages begins with en, the language the template is written in\n",
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
      packageName,
      repository:
        values.repository === undefined
          ? undefined
          : { url: values.repository, directory: values.directory },
      languages,
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

/** An https address of a repository, as git names it or as a browser opens it. */
function isRepositoryAddress(value: string): boolean {
  const address = value.replace(/^git\+/, "");
  if (!/^https:\/\/\S+$/.test(address)) {
    return false;
  }
  try {
    return new URL(address).hostname.length > 0;
  } catch {
    return false;
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
