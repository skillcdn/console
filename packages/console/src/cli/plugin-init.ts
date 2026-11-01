// `console-plugin init` (docs/specs/plugins.md, "Authoring"): writes a plugin from the template
// the package ships, the words `__key__`, `__name__` and `__console__` in the template's files and
// their names replaced. `examples/plugin-hello` in the console's repository is what it writes for
// the key `hello`, and a test holds the two equal.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface InitOptions {
  readonly key: string;
  /** The plugin's name for people, in English. */
  readonly name: string;
  /** What the plugin's devDependency on `@skillcdn/console` says: `^<version>` of the command, unless said. */
  readonly consoleDependency: string;
}

/** The words the template uses, and what each becomes. */
export function substitutions(options: InitOptions): readonly [string, string][] {
  return [
    ["__key__", options.key],
    ["__name__", options.name],
    ["__console__", options.consoleDependency],
  ];
}

export function substitute(text: string, options: InitOptions): string {
  let result = text;
  for (const [word, value] of substitutions(options)) {
    result = result.replaceAll(word, value);
  }
  return result;
}

/** A name for people from a key: `leave-requests` is "Leave Requests". */
export function nameFromKey(key: string): string {
  return key
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

/** The files of the template, as paths relative to it with forward slashes. */
export async function templateFiles(templateDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const path of walk(templateDir)) {
    files.push(relative(templateDir, path).split(sep).join("/"));
  }
  return files.sort();
}

/**
 * Writes the template into `targetDir`, which must not exist or be an empty directory, and
 * answers the files written, relative to it.
 */
export async function writePluginFromTemplate(
  templateDir: string,
  targetDir: string,
  options: InitOptions,
): Promise<string[]> {
  const found = await stat(targetDir).catch(() => null);
  if (found !== null) {
    if (!found.isDirectory()) {
      throw new Error(`${targetDir} exists and is not a directory`);
    }
    if ((await readdir(targetDir)).length > 0) {
      throw new Error(`${targetDir} is not empty`);
    }
  }
  const written: string[] = [];
  for (const file of await templateFiles(templateDir)) {
    const target = substitute(file, options);
    const text = await readFile(join(templateDir, file), "utf8");
    const path = join(targetDir, ...target.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, substitute(text, options), "utf8");
    written.push(target);
  }
  return written;
}
