import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as z from "zod/mini";

// What a working directory says about the project it belongs to: `.skillcdn-console.json` in
// it or in a directory above it, as `.nvmrc` and its kind are found. Written by `console use`,
// and meant to be committed in a private repository, so that everyone who works in the
// checkout, and every agent they run in it, is in the same project without saying so; left out
// of a public one, since it may name the organization's console. It names the project, and
// where the checkout is bound to a console other than the default login, that console and the
// account there (ADR-0027). Never a token, a code or anything secret: the token for the console
// it names is looked up in the credentials the command keeps, and a key this file does not
// know is dropped on reading.

/** The file's name, in the working directory or one above it. */
export const DIRECTORY_FILE = ".skillcdn-console.json";

/**
 * The sentence a checkout's agreement carries to send the agents working there to the console:
 * the one the skill working-the-board keeps (references/the-sentence.md) and this repository's
 * own agreement carries. `console use` prints it, since nothing tells an agent to look until the
 * checkout says so, as `skillcdn use` prints the sentence for a pack.
 */
export const THE_SENTENCE =
  "**Bound to a console?** When `.skillcdn-console.json` is in this checkout, or `console whoami` names a project, work the task through that SkillCDN console (`console help` says how).";

/** How large the file may be before it is not read: a few names, never more. */
const MAX_FILE_CHARS = 16 * 1024;

export interface DirectorySettings {
  /** The key of the project the directory's work belongs to. */
  readonly project: string;
  /** The origin of the console the directory is bound to; the default login when left out. */
  readonly url?: string | undefined;
  /** The account at that console, where several are signed in to it. */
  readonly account?: string | undefined;
}

export interface DirectoryStore {
  /** The settings of the working directory, or of the nearest directory above it that has them. */
  load(): Promise<DirectorySettings | undefined>;
  /** Writes the settings into the working directory and answers where. */
  save(settings: DirectorySettings): Promise<string>;
}

const settingsSchema = z.object({
  project: z.string().check(z.minLength(1), z.maxLength(100)),
  url: z.optional(z.string().check(z.minLength(1), z.maxLength(2048))),
  account: z.optional(z.string().check(z.minLength(1), z.maxLength(254))),
});

/** What a file says, with nothing but the three settings kept; nothing for anything else. */
export function parseDirectorySettings(json: unknown): DirectorySettings | undefined {
  const parsed = settingsSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return {
    project: parsed.data.project,
    ...(parsed.data.url === undefined ? {} : { url: parsed.data.url }),
    ...(parsed.data.account === undefined ? {} : { account: parsed.data.account }),
  };
}

export function createDirectoryStore(cwd: string): DirectoryStore {
  return {
    async load() {
      let directory = cwd;
      for (;;) {
        let content: string | undefined;
        try {
          content = await readFile(join(directory, DIRECTORY_FILE), "utf8");
        } catch {
          content = undefined;
        }
        if (content !== undefined) {
          if (content.length > MAX_FILE_CHARS) {
            return undefined;
          }
          try {
            return parseDirectorySettings(JSON.parse(content));
          } catch {
            return undefined;
          }
        }
        const above = dirname(directory);
        if (above === directory) {
          return undefined;
        }
        directory = above;
      }
    },
    async save(settings) {
      const path = join(cwd, DIRECTORY_FILE);
      // The three settings, named one by one: nothing else ever reaches this file.
      const written = {
        project: settings.project,
        ...(settings.url === undefined ? {} : { url: settings.url }),
        ...(settings.account === undefined ? {} : { account: settings.account }),
      };
      await writeFile(path, `${JSON.stringify(written, null, 2)}\n`);
      return path;
    },
  };
}
