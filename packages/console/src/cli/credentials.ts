import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import * as z from "zod/mini";

// Where the command keeps what `login` was given (ADR-0027): for every console a person signed
// it in to, the console's address, the account there and the token, in the person's own
// configuration directory, readable by them alone where the system can say so. A token is a
// secret the person made; this file is the one place it rests, and a token goes only to the
// console that issued it: the command resolves which console a command talks to first, and then
// looks for a login there, never the other way round.

/** One sign-in: a console, an account there, and the token the console handed over. */
export interface Login {
  /** The origin of the console, without a path. */
  readonly url: string;
  /** The person's login at the console, as the console named them; unknown for a login kept before accounts were. */
  readonly account: string | undefined;
  readonly token: string;
  /** What the token is called at the console, when known. */
  readonly agent: string | undefined;
  /** When the command was signed in, when known. */
  readonly since: string | undefined;
}

/** Everything the command keeps: the logins, and the console a directory that names none works at. */
export interface Credentials {
  readonly default: string | undefined;
  readonly logins: readonly Login[];
}

export const EMPTY_CREDENTIALS: Credentials = { default: undefined, logins: [] };

/** How many consoles one machine may be signed in to: far more than anyone has. */
export const MAX_LOGINS = 100;
/** How large the file may be before it is not read: far above a hundred logins. */
const MAX_FILE_BYTES = 64 * 1024;

export interface CredentialStore {
  /**
   * What is kept, or nothing. A file that is there and cannot be read is a `CredentialsError`,
   * so that the command stops and never writes over what it did not understand.
   */
  load(): Promise<Credentials | undefined>;
  /** Keeps the credentials, whole, and answers where. */
  save(credentials: Credentials): Promise<string>;
  /** Forgets everything kept. */
  clear(): Promise<void>;
}

export class CredentialsError extends Error {
  readonly code: "credentials.malformed" | "credentials.too_large";
  readonly path: string;

  constructor(code: CredentialsError["code"], path: string) {
    super(
      code === "credentials.too_large"
        ? `The credentials file ${path} is larger than the command reads.`
        : `The credentials file ${path} could not be read as one.`,
    );
    this.name = "CredentialsError";
    this.code = code;
    this.path = path;
  }
}

const loginSchema = z.object({
  url: z.string().check(z.minLength(1), z.maxLength(2048)),
  account: z.optional(z.string().check(z.minLength(1), z.maxLength(254))),
  token: z.string().check(z.minLength(1), z.maxLength(1024)),
  agent: z.optional(z.string().check(z.maxLength(200))),
  since: z.optional(z.string().check(z.maxLength(40))),
});
const fileSchema = z.object({
  version: z.literal(2),
  default: z.optional(z.string().check(z.minLength(1), z.maxLength(2048))),
  logins: z.array(loginSchema).check(z.maxLength(MAX_LOGINS)),
});
/** The file as the command kept it before 2026-10: one console, one token. */
const firstFileSchema = z.object({
  url: z.string().check(z.minLength(1)),
  token: z.string().check(z.minLength(1)),
});

/** What a file says, in the current shape; one in the first shape reads as one login, the default. Nothing for anything else. */
export function parseCredentials(json: unknown): Credentials | undefined {
  const current = fileSchema.safeParse(json);
  if (current.success) {
    return {
      default: current.data.default,
      logins: current.data.logins.map((login) => ({
        url: login.url,
        account: login.account,
        token: login.token,
        agent: login.agent,
        since: login.since,
      })),
    };
  }
  const first = firstFileSchema.safeParse(json);
  if (first.success) {
    return {
      default: first.data.url,
      logins: [
        {
          url: first.data.url,
          account: undefined,
          token: first.data.token,
          agent: undefined,
          since: undefined,
        },
      ],
    };
  }
  return undefined;
}

/** The logins at one console. */
export function loginsAt(credentials: Credentials, url: string): readonly Login[] {
  return credentials.logins.filter((login) => login.url === url);
}

/** The consoles signed in to, each once, in the order they were signed in to. */
export function consolesOf(credentials: Credentials): readonly string[] {
  return [...new Set(credentials.logins.map((login) => login.url))];
}

/**
 * With a login kept: in place of the one at the same console for the same account, else added.
 * The first login kept is the default console, and one kept as the default is.
 */
export function withLogin(
  credentials: Credentials,
  login: Login,
  options: { readonly default?: boolean | undefined } = {},
): Credentials {
  const rest = credentials.logins.filter(
    (kept) => !(kept.url === login.url && kept.account === login.account),
  );
  const first = credentials.logins.length === 0 ? login.url : undefined;
  return {
    default: options.default === true ? login.url : (credentials.default ?? first),
    logins: [...rest, login],
  };
}

/**
 * Without the login at a console, for one account or for every account there. The default
 * stays while a login at it remains; else it moves to the one console left, or to none.
 */
export function withoutLogin(credentials: Credentials, url: string, account?: string): Credentials {
  const logins = credentials.logins.filter(
    (kept) => !(kept.url === url && (account === undefined || kept.account === account)),
  );
  const consoles = [...new Set(logins.map((kept) => kept.url))];
  const [only] = consoles;
  const fallback = consoles.length === 1 ? only : undefined;
  return {
    default:
      credentials.default !== undefined && consoles.includes(credentials.default)
        ? credentials.default
        : fallback,
    logins,
  };
}

/** Where a command is told which console to talk to, in the order the first one found wins. */
export type AddressSource = "flag" | "environment" | "directory" | "default";

export interface Lookup {
  /** `--url`, as an origin. */
  readonly flagUrl?: string | undefined;
  /** `--account`. */
  readonly flagAccount?: string | undefined;
  /** `CONSOLE_URL`, as an origin, and `CONSOLE_TOKEN`: a pair, for a hook or a job. */
  readonly envUrl?: string | undefined;
  readonly envToken?: string | undefined;
  /** What `.skillcdn-console.json` says of the console and the account, when it does. */
  readonly directoryUrl?: string | undefined;
  readonly directoryAccount?: string | undefined;
  readonly credentials: Credentials | undefined;
}

export type Resolution =
  | {
      readonly ok: true;
      readonly url: string;
      readonly token: string;
      readonly account: string | undefined;
      readonly source: AddressSource;
      /** Where the token came from: the environment's pair, or a login kept here. */
      readonly via: "environment" | "login";
    }
  /** Nothing names a console and nothing is kept. */
  | { readonly ok: false; readonly reason: "nothing" }
  /** One half of the environment's pair is set. */
  | {
      readonly ok: false;
      readonly reason: "environment_half";
      readonly have: "CONSOLE_URL" | "CONSOLE_TOKEN";
    }
  /** A console is named, and nothing here is signed in to it, as that account where one is named. */
  | {
      readonly ok: false;
      readonly reason: "no_login";
      readonly url: string;
      readonly account: string | undefined;
      readonly source: AddressSource;
    }
  /** Several accounts are signed in at the console, and nothing says which. */
  | {
      readonly ok: false;
      readonly reason: "ambiguous";
      readonly url: string;
      readonly accounts: readonly string[];
    };

/**
 * Which console a command talks to, and with what (ADR-0027). The address comes first: the
 * flag, else the environment, else the directory, else the default login. The token is then
 * the one for that address and no other: the environment's token where its address is that
 * one, else the login kept for it, for the account named or the one account there.
 */
export function resolveLogin(lookup: Lookup): Resolution {
  const { envUrl, envToken } = lookup;
  if ((envUrl === undefined) !== (envToken === undefined)) {
    return {
      ok: false,
      reason: "environment_half",
      have: envUrl === undefined ? "CONSOLE_TOKEN" : "CONSOLE_URL",
    };
  }
  const credentials = lookup.credentials ?? EMPTY_CREDENTIALS;
  const consoles = consolesOf(credentials);
  const [source, url]: [AddressSource, string | undefined] =
    lookup.flagUrl !== undefined
      ? ["flag", lookup.flagUrl]
      : envUrl !== undefined
        ? ["environment", envUrl]
        : lookup.directoryUrl !== undefined
          ? ["directory", lookup.directoryUrl]
          : ["default", credentials.default ?? (consoles.length === 1 ? consoles[0] : undefined)];
  if (url === undefined) {
    return { ok: false, reason: "nothing" };
  }
  const account = lookup.flagAccount ?? lookup.directoryAccount;
  if (envUrl !== undefined && envToken !== undefined && envUrl === url) {
    return { ok: true, url, token: envToken, account, source, via: "environment" };
  }
  const at = loginsAt(credentials, url);
  const chosen = account === undefined ? at : at.filter((login) => login.account === account);
  const [login] = chosen;
  if (login === undefined) {
    return { ok: false, reason: "no_login", url, account, source };
  }
  if (chosen.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      url,
      accounts: chosen.map((kept) => kept.account ?? "?"),
    };
  }
  return { ok: true, url, token: login.token, account: login.account, source, via: "login" };
}

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
      let size: number;
      try {
        size = (await stat(path)).size;
      } catch {
        return undefined;
      }
      if (size > MAX_FILE_BYTES) {
        throw new CredentialsError("credentials.too_large", path);
      }
      let json: unknown;
      try {
        json = JSON.parse(await readFile(path, "utf8"));
      } catch {
        throw new CredentialsError("credentials.malformed", path);
      }
      const parsed = parseCredentials(json);
      if (parsed === undefined) {
        throw new CredentialsError("credentials.malformed", path);
      }
      return parsed;
    },
    async save(credentials) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = {
        version: 2,
        default: credentials.default,
        logins: credentials.logins.map((login) => ({
          url: login.url,
          account: login.account,
          token: login.token,
          agent: login.agent,
          since: login.since,
        })),
      };
      // Written beside the file and moved over it in one step, so that a command that stops
      // half-way leaves the file as it was, whole.
      const draft = `${path}.${process.pid}.tmp`;
      await writeFile(draft, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await rename(draft, path);
      // The mode above applies to a file made now; one that was there keeps its own, so it is set again.
      await chmod(path, 0o600).catch(() => undefined);
      return path;
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}
