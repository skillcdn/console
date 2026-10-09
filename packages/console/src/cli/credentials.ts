import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as z from "zod/mini";

// Where the command keeps what `login` was given: the console's address and the token, in the
// person's own configuration directory, readable by them alone where the system can say so.
// The token is a secret the person made; the file is the one place it rests.

export interface Credentials {
  /** The origin of the console, without a path. */
  readonly url: string;
  /** A token made on the console's Tokens page. */
  readonly token: string;
}

export interface CredentialStore {
  load(): Promise<Credentials | undefined>;
  /** Keeps the credentials and answers where. */
  save(credentials: Credentials): Promise<string>;
  clear(): Promise<void>;
}

const credentialsSchema = z.object({
  url: z.string().check(z.minLength(1)),
  token: z.string().check(z.minLength(1)),
});

const FILE_NAME = "credentials.json";

/** The directory the file lives in: under `XDG_CONFIG_HOME`, or `~/.config`. */
export function defaultConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  const base = env.XDG_CONFIG_HOME;
  return join(
    base === undefined || base.length === 0 ? join(homedir(), ".config") : base,
    "skillcdn-console",
  );
}

export function createFileStore(directory: string): CredentialStore {
  const path = join(directory, FILE_NAME);
  return {
    async load() {
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch {
        return undefined;
      }
      try {
        const parsed = credentialsSchema.safeParse(JSON.parse(content));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    async save(credentials) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
      // The mode above applies to a file made now; one that was there keeps its own, so it is set again.
      await chmod(path, 0o600).catch(() => undefined);
      return path;
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}
