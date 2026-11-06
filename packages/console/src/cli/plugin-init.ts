// `console-plugin init` (docs/specs/plugins.md, "Authoring"): writes a plugin from the template
// the package ships, the words `__package__`, `__key__`, `__name__` and `__console__` in the
// template's files and their names replaced; then what the template cannot say in a word, where
// it was asked for: the fields a published or a repository-bound package carries, and the
// languages beyond English. `examples/plugin-hello` in the console's repository is what it writes
// for the key `hello` with nothing else said, and a test holds the two equal.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface InitOptions {
  readonly key: string;
  /** The plugin's name for people, in English. */
  readonly name: string;
  /** What the plugin's devDependency on `@skillcdn/console` says: `^<version>` of the command, unless said. */
  readonly consoleDependency: string;
  /** The package's name: `console-plugin-<key>` unless said. A scoped name is published with `publishConfig.access` `public`. */
  readonly packageName?: string | undefined;
  /** The repository the plugin lives in and, in a repository of several, its directory: `repository`, `homepage`, `bugs` and the manifest's `store`. */
  readonly repository?:
    | { readonly url: string; readonly directory?: string | undefined }
    | undefined;
  /** The languages the plugin's words are in, `en` first; `en` alone unless said. Every language map and both manifests' translations get the others, copied from English for the author to translate. */
  readonly languages?: readonly string[] | undefined;
}

/** A language tag as the manifest's language maps are keyed: `en`, `ko`, `pt-BR`. */
export const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/;

/** A package's name as the registry takes one: lowercase, with a scope as `@scope/name`. */
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** The package's name from the options: what was said, else `console-plugin-<key>`. */
export function packageNameOf(options: InitOptions): string {
  return options.packageName ?? `console-plugin-${options.key}`;
}

/** The words the template uses, and what each becomes. */
export function substitutions(options: InitOptions): readonly [string, string][] {
  return [
    ["__package__", packageNameOf(options)],
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
  await adaptPlugin(targetDir, options);
  return written;
}

/** Whether a value of the manifest is a language map: words per language, `en` among them. */
export function isLanguageMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "en" in value &&
    Object.entries(value).every(
      ([language, words]) => LANGUAGE_TAG.test(language) && typeof words === "string",
    )
  );
}

/** Every language map of the manifest, wherever it is, gets `languages`, each copied from English where it is missing. */
function addLanguages(value: unknown, languages: readonly string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      addLanguages(item, languages);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (isLanguageMap(value)) {
    const english = value.en ?? "";
    for (const language of languages) {
      if (!(language in value)) {
        value[language] = english;
      }
    }
    return;
  }
  for (const inner of Object.values(value)) {
    addLanguages(inner, languages);
  }
}

/** The page of a repository at its host, from the address git names it by. */
function pageOf(url: string): string {
  return url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/**
 * The manifest's front-matter with `translations` for `languages`, each the English words
 * again, inserted before the front-matter's end; under `parent` where the format nests them
 * (`skillcdn.translations` in a skill). The description is the one the front-matter has, as
 * written; the title is the plugin's name.
 */
function withTranslations(
  text: string,
  languages: readonly string[],
  titleKey: "name" | "title",
  title: string,
  parent?: "skillcdn",
): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    return text;
  }
  const described = lines
    .slice(1, end)
    .find((line) => line.startsWith("description:"))
    ?.slice("description:".length)
    .trim();
  const indent = parent === undefined ? "" : "  ";
  const block = [
    ...(parent === undefined ? [] : [`${parent}:`]),
    `${indent}translations:`,
    ...languages.flatMap((language) => [
      `${indent}  ${language}:`,
      `${indent}    ${titleKey}: ${JSON.stringify(title)}`,
      ...(described === undefined ? [] : [`${indent}    description: ${described}`]),
    ]),
  ];
  return [...lines.slice(0, end), ...block, ...lines.slice(end)].join(newline);
}

/**
 * What the template cannot say in a word, where it was asked for: `publishConfig` for a scoped
 * name, `repository`, `homepage` and `bugs` with the manifest's `store` for a repository, and
 * the languages beyond English in every language map and both manifests' translations, each
 * copied from the English words for the author to translate (`console-plugin check` warns of
 * one left as it was). Nothing is rewritten when nothing was asked, so that the example stays
 * what the template says.
 */
async function adaptPlugin(targetDir: string, options: InitOptions): Promise<void> {
  const name = packageNameOf(options);
  const repository = options.repository;
  const languages = (options.languages ?? []).filter((language) => language !== "en");
  if (!name.startsWith("@") && repository === undefined && languages.length === 0) {
    return;
  }
  const packagePath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
  const manifestPath = join(targetDir, "console-plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  if (name.startsWith("@")) {
    pkg.publishConfig = { access: "public" };
  }
  if (repository !== undefined) {
    const page = pageOf(repository.url);
    // The paths a git host has for a directory and for issues are the host's; only the one
    // whose paths are known gets them.
    const atGitHub = new URL(page).hostname === "github.com";
    const homepage =
      repository.directory !== undefined && atGitHub
        ? `${page}/tree/HEAD/${repository.directory}`
        : page;
    pkg.repository = {
      type: "git",
      url: repository.url,
      ...(repository.directory === undefined ? {} : { directory: repository.directory }),
    };
    pkg.homepage = homepage;
    if (atGitHub) {
      pkg.bugs = { url: `${page}/issues` };
    }
    manifest.store = { homepage, repository: page };
  }
  if (languages.length > 0) {
    addLanguages(manifest, languages);
    const skillcdn = join(targetDir, "SKILLCDN.md");
    await writeFile(
      skillcdn,
      withTranslations(await readFile(skillcdn, "utf8"), languages, "name", options.name),
      "utf8",
    );
    const skill = join(targetDir, "skills", options.key, "SKILL.md");
    await writeFile(
      skill,
      withTranslations(await readFile(skill, "utf8"), languages, "title", options.name, "skillcdn"),
      "utf8",
    );
  }
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
