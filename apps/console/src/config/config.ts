import { readFileSync } from "node:fs";
import { hasForbiddenCodePoint } from "@skillcdn/console/api";
import * as z from "zod";
import { type Cidr, parseCidr } from "../http/client-address.js";

// The only module that reads the environment. Contract: .env.example and deploy/README.md.

/** Variables that may arrive as `NAME_FILE`, so that container secret mounts work. */
const SECRET_NAMES = ["DATABASE_URL"] as const;

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

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: integer(11190, 1, 65_535),
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
});

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
  };
}
