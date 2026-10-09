import { readFileSync } from "node:fs";
import { hasForbiddenCodePoint } from "@skillcdn/console/api";
import * as z from "zod";
import { domainOf } from "../auth/membership.js";
import { type Cidr, parseCidr } from "../http/client-address.js";

// The only module that reads the environment. Contract: .env.example and deploy/README.md.

/** Variables that may arrive as `NAME_FILE`, so that container secret mounts work. */
const SECRET_NAMES = [
  "DATABASE_URL",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_SECRET",
] as const;
/** What signing in needs of itself, whichever providers there are. */
const SIGN_IN_NAMES = ["PUBLIC_URL", "AUTH_SECRET"] as const;
/** What each provider needs: both, or neither. */
const PROVIDER_NAMES = {
  gh: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
} as const;
/** Shorter than this, a secret is guessable enough to be a mistake. */
const MIN_SECRET_LENGTH = 32;

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const flag = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((value) => value === "true");

const headerName = (fallback: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "must be a header name")
    .default(fallback)
    .transform((value) => value.toLowerCase());

const origin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    // Checks run even when an earlier one failed. What is not a URL was reported already.
    if (!URL.canParse(value)) {
      return true;
    }
    const url = new URL(value);
    return url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "";
  }, "must be an origin such as https://console.example.com, without a path")
  .transform((value) => new URL(value).origin);

/** A domain name, as a Workspace is known by: lowercase, without a dot at either end. */
const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
    "must be a domain such as example.com",
  );

/** A comma-separated list of networks in CIDR notation; a bare address means just that address. */
const cidrList = z
  .string()
  .default("")
  .transform((value, context) => {
    const networks: Cidr[] = [];
    for (const entry of value.split(",").filter((part) => part.trim().length > 0)) {
      const parsed = parseCidr(entry);
      if (parsed === undefined) {
        context.addIssue({
          code: "custom",
          message: "must be a list of addresses or CIDR networks",
        });
        return z.NEVER;
      }
      networks.push(parsed);
    }
    return networks;
  });

/** A comma-separated list of logins at the git host, or of addresses at Google, as each spells one. */
const loginList = z
  .string()
  .default("")
  .transform((value, context) => {
    const logins: string[] = [];
    for (const entry of value.split(",").map((part) => part.trim())) {
      if (entry.length === 0) {
        continue;
      }
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$|^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(entry)) {
        context.addIssue({
          code: "custom",
          message: "must be a list of logins or email addresses",
        });
        return z.NEVER;
      }
      logins.push(entry);
    }
    return logins;
  });

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: integer(11199, 1, 65_535),
  SHUTDOWN_GRACE_SECONDS: integer(20, 1, 600),
  HTTP_KEEP_ALIVE_SECONDS: integer(65, 1, 3600),
  HTTP_REQUEST_TIMEOUT_SECONDS: integer(60, 1, 3600),
  ACCESS_LOG: flag(true),

  TRUSTED_PROXIES: cidrList,
  CLIENT_IP_HEADER: headerName("x-forwarded-for"),
  REQUEST_ID_HEADER: headerName("x-request-id"),

  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
  DATABASE_POOL_MAX: integer(10, 1, 200),

  WORKSPACE_NAME: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !hasForbiddenCodePoint(value), "must not contain control characters")
    .default("Console"),
  WORKER_IN_PROCESS: flag(false),

  PUBLIC_URL: origin.optional(),
  GITHUB_WEB_URL: origin.default("https://github.com"),
  GITHUB_API_URL: z
    .url({ protocol: /^https?$/ })
    .transform((value) => value.replace(/\/+$/, ""))
    .default("https://api.github.com"),
  GITHUB_CLIENT_ID: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/, "must be the app's client id")
    .optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/, "must be the client id")
    .optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_WORKSPACE_DOMAIN: domainName.optional(),
  AUTH_SECRET: z
    .string()
    .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`)
    .optional(),
  MEMBERS: loginList,
  ADMINS: loginList,
  SESSION_TTL_DAYS: integer(30, 1, 365),

  WEB_ROOT: z.string().min(1).optional(),
});

export interface AuthConfig {
  /** The origin people use: where a provider sends them back, and what requests that change something come from. */
  readonly publicUrl: string;
  /** The app the operator registered at the git host; nothing when people do not sign in there. */
  readonly github:
    | {
        readonly clientId: string;
        readonly clientSecret: string;
        /** Where people use the host in a browser. */
        readonly webUrl: string;
        /** Where the host's API is. */
        readonly apiUrl: string;
      }
    | undefined;
  /** The client the operator registered at Google; nothing when people do not sign in there. */
  readonly google:
    | {
        readonly clientId: string;
        readonly clientSecret: string;
        /** The Workspace domain offered at the account picker, and whose accounts are members. */
        readonly domain: string | undefined;
      }
    | undefined;
  /** What travels through a browser between two requests is sealed with. */
  readonly secret: string;
  /** The logins the operator lets in. Empty: nobody, unless a domain is. */
  readonly members: readonly string[];
  /** The logins among them that configure the board, made administrators when they sign in. */
  readonly admins: readonly string[];
  /** The Workspace domains whose accounts are members, as their provider vouches for them. */
  readonly domains: readonly string[];
  /** How long a browser stays signed in without being used. */
  readonly sessionTtlMs: number;
}

export interface Config {
  readonly environment: "development" | "test" | "production";
  readonly logLevel: string;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly shutdownGraceMs: number;
    /** How long an idle connection is kept open. Must outlast the idle timeout of a proxy in front. */
    readonly keepAliveMs: number;
    /** How long a client may take to send one complete request. */
    readonly requestTimeoutMs: number;
    readonly accessLog: boolean;
    /** Peers whose forwarding headers are believed. Empty: nobody's are. */
    readonly trustedProxies: readonly Cidr[];
    /** Lowercase name of the header in which a trusted proxy passes the client address. */
    readonly clientIpHeader: string;
    /** Lowercase name of the header in which a trusted proxy passes its request id. */
    readonly requestIdHeader: string;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly workspace: {
    /** What the board is called, on its pages. */
    readonly name: string;
  };
  readonly worker: {
    /** Whether the `api` role runs the worker's loop as well, for a single-container install. */
    readonly inProcess: boolean;
  };
  /** Signing in through identity providers. Unset: nobody signs in, and the board is nobody's. */
  readonly auth: AuthConfig | undefined;
  readonly web: {
    /** Directory of a build of the default UI to serve. Unset: there is no UI, API only. */
    readonly root: string | undefined;
  };
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export type Environment = Readonly<Record<string, string | undefined>>;

/** Resolves `NAME_FILE` into `NAME` so that container secret mounts work. */
function withSecretFiles(
  environment: Environment,
  readFile: (path: string) => string,
  problems: string[],
): Environment {
  const resolved: Record<string, string | undefined> = { ...environment };
  for (const name of SECRET_NAMES) {
    const file = environment[`${name}_FILE`];
    if (file === undefined || file.length === 0) {
      continue;
    }
    if (environment[name] !== undefined && environment[name] !== "") {
      problems.push(`${name} and ${name}_FILE are both set; use one`);
      continue;
    }
    try {
      resolved[name] = readFile(file).trim();
    } catch {
      // The path is operator input and safe to echo; the content never is.
      problems.push(`${name}_FILE: cannot read ${file}`);
    }
  }
  return resolved;
}

/**
 * What signing in is configured with, or `undefined` when it is not. It takes an origin that
 * does not change with the request (the providers send people back to it, and the pages' own
 * requests come from it), the secret, and at least one provider with its client id and secret.
 * Half of any of that is a mistake, not a setting.
 */
function authOf(
  env: z.infer<typeof environmentSchema>,
  problems: string[],
): AuthConfig | undefined {
  const given = {
    PUBLIC_URL: env.PUBLIC_URL,
    AUTH_SECRET: env.AUTH_SECRET,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    GOOGLE_WORKSPACE_DOMAIN: env.GOOGLE_WORKSPACE_DOMAIN,
  };
  if (Object.values(given).every((value) => value === undefined)) {
    if (env.MEMBERS.length > 0) {
      problems.push("MEMBERS: lists who may sign in, and is read only with signing in configured");
    }
    if (env.ADMINS.length > 0) {
      problems.push("ADMINS: names administrators, and is read only with signing in configured");
    }
    return undefined;
  }
  const before = problems.length;
  const missing = SIGN_IN_NAMES.filter((name) => given[name] === undefined);
  if (missing.length > 0) {
    problems.push(`${missing.join(", ")}: required once signing in is configured`);
  }
  for (const names of Object.values(PROVIDER_NAMES)) {
    if (names.filter((name) => given[name] !== undefined).length === 1) {
      problems.push(`${names.join(", ")}: set both or neither`);
    }
  }
  const github =
    env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined
      ? {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          webUrl: env.GITHUB_WEB_URL,
          apiUrl: env.GITHUB_API_URL,
        }
      : undefined;
  const google =
    env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          domain: env.GOOGLE_WORKSPACE_DOMAIN,
        }
      : undefined;
  if (env.GOOGLE_WORKSPACE_DOMAIN !== undefined && google === undefined) {
    problems.push("GOOGLE_WORKSPACE_DOMAIN: needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  }
  if (github === undefined && google === undefined && problems.length === before) {
    problems.push("GITHUB_CLIENT_ID or GOOGLE_CLIENT_ID: signing in needs a provider");
  }
  if (problems.length > before || env.PUBLIC_URL === undefined || env.AUTH_SECRET === undefined) {
    return undefined;
  }
  const domains = env.GOOGLE_WORKSPACE_DOMAIN === undefined ? [] : [env.GOOGLE_WORKSPACE_DOMAIN];
  // An administrator who cannot sign in is a mistake, not a setting.
  const members = new Set(env.MEMBERS.map((login) => login.toLowerCase()));
  const isMember = (login: string): boolean =>
    members.has(login.toLowerCase()) || domains.includes(domainOf(login) ?? "");
  if (env.ADMINS.some((login) => !isMember(login))) {
    problems.push("ADMINS: every administrator must be a member, by login or by domain");
    return undefined;
  }
  return {
    publicUrl: env.PUBLIC_URL,
    github,
    google,
    secret: env.AUTH_SECRET,
    members: env.MEMBERS,
    admins: env.ADMINS,
    domains,
    sessionTtlMs: env.SESSION_TTL_DAYS * 86_400_000,
  };
}

/**
 * Parses and validates the environment once, at boot. Problems name the variable and the rule,
 * never the value: a connection string or a secret must not end up in a log.
 */
export function loadConfig(
  environment: Environment = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Config {
  const problems: string[] = [];
  const resolved = withSecretFiles(environment, readFile, problems);
  // An empty variable means "not set": compose files and shells produce those easily.
  const present = Object.fromEntries(
    Object.entries(resolved).filter(([, value]) => value !== undefined && value !== ""),
  );
  const parsed = environmentSchema.safeParse(present);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = issue.path.join(".");
      problems.push(
        issue.code === "invalid_type" ? `${name}: required` : `${name}: ${issue.message}`,
      );
    }
  }
  if (!parsed.success || problems.length > 0) {
    throw new ConfigError(problems);
  }
  const env = parsed.data;
  const auth = authOf(env, problems);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return {
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    http: {
      host: env.HOST,
      port: env.PORT,
      shutdownGraceMs: env.SHUTDOWN_GRACE_SECONDS * 1000,
      keepAliveMs: env.HTTP_KEEP_ALIVE_SECONDS * 1000,
      requestTimeoutMs: env.HTTP_REQUEST_TIMEOUT_SECONDS * 1000,
      accessLog: env.ACCESS_LOG,
      trustedProxies: env.TRUSTED_PROXIES,
      clientIpHeader: env.CLIENT_IP_HEADER,
      requestIdHeader: env.REQUEST_ID_HEADER,
    },
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    workspace: { name: env.WORKSPACE_NAME },
    worker: { inProcess: env.WORKER_IN_PROCESS },
    auth,
    web: { root: env.WEB_ROOT },
  };
}
