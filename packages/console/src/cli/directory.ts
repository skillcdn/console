import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as z from "zod/mini";

// What a working directory says about the project it belongs to: `.skillcdn-console.json` in
// it or in a directory above it, as `.nvmrc` and its kind are found. Written by `console use`,
// and meant to be committed, so that everyone who works in the checkout, and every agent they
// run in it, is in the same project without saying so.

/** The file's name, in the working directory or one above it. */
export const DIRECTORY_FILE = ".skillcdn-console.json";

export interface DirectorySettings {
  /** The key of the project the directory's work belongs to. */
  readonly project: string;
}

export interface DirectoryStore {
  /** The settings of the working directory, or of the nearest directory above it that has them. */
  load(): Promise<DirectorySettings | undefined>;
  /** Writes the settings into the working directory and answers where. */
  save(settings: DirectorySettings): Promise<string>;
}

const settingsSchema = z.object({ project: z.string().check(z.minLength(1)) });

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
          try {
            const parsed = settingsSchema.safeParse(JSON.parse(content));
            return parsed.success ? parsed.data : undefined;
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
      await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
      return path;
    },
  };
}
