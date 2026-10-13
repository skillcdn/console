import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/mini";

// What the command last said about the versions, kept beside the credentials, so that it says
// it once a day for one pair of versions and not on every command an agent runs. A notice is
// not worth failing a command for: a file that cannot be read or written is as good as none.

export interface VersionNotice {
  /** The version of the command that noticed. */
  readonly command: string;
  /** The version of the console it noticed. */
  readonly console: string;
  readonly shownAt: string;
}

export interface NoticeStore {
  load(): Promise<VersionNotice | undefined>;
  save(notice: VersionNotice): Promise<void>;
}

const noticesSchema = z.object({
  versions: z.optional(z.object({ command: z.string(), console: z.string(), shownAt: z.string() })),
});

const FILE_NAME = "notices.json";

export function createNoticeStore(directory: string): NoticeStore {
  const path = join(directory, FILE_NAME);
  return {
    async load() {
      try {
        const parsed = noticesSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
        return parsed.success ? parsed.data.versions : undefined;
      } catch {
        return undefined;
      }
    },
    async save(notice) {
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(path, `${JSON.stringify({ versions: notice }, null, 2)}\n`);
      } catch {
        // Said this time; said again next time.
      }
    },
  };
}
