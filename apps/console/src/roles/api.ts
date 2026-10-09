import { randomUUID } from "node:crypto";
import process from "node:process";
import type { Hono } from "hono";
import { createGitHubLogin } from "../adapters/github-login.js";
import { systemClock } from "../adapters/system-clock.js";
import { Login } from "../auth/login.js";
import { Membership } from "../auth/membership.js";
import { createSecrets } from "../auth/secrets.js";
import { Sessions } from "../auth/sessions.js";
import type { AuthConfig, Config } from "../config/config.js";
import { createDatabase, type Database } from "../db/client.js";
import { ensureWorkspace, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { createApp } from "../http/app.js";
import type { AppAuth } from "../http/auth.js";
import { createClientAddressResolver } from "../http/client-address.js";
import type { AppEnv } from "../http/request-context.js";
import { startServer } from "../http/server.js";
import { Janitor } from "../jobs/janitor.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import type { GitHostLogin } from "../ports/git-host-login.js";
import { APP_NAME, APP_VERSION } from "../version.js";

/** How often what time has ended is removed, when this process does the worker's work. */
const JANITOR_INTERVAL_MS = 15 * 60_000;

export interface ApiPorts {
  readonly database: Database;
  /** How people sign in through the git host. Needed, with `auth` configured, for anyone to. */
  readonly login?: GitHostLogin | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly isShuttingDown: () => boolean;
}

export type ApiConfig = Pick<Config, "workspace"> & {
  /** Left out, nobody signs in. What it needs of the git host arrives through the ports. */
  readonly auth?: Omit<AuthConfig, "github"> | undefined;
  /** Left out, no proxy is trusted and every request is logged. */
  readonly http?: Pick<
    Config["http"],
    "trustedProxies" | "clientIpHeader" | "requestIdHeader" | "accessLog"
  >;
};

/**
 * The workspace of this deployment, found once and kept. A failure is not kept: the next
 * request asks again.
 */
export function workspaceResolver(
  database: Database,
  clock: Clock,
  name: string,
): () => Promise<WorkspaceRecord> {
  let found: Promise<WorkspaceRecord> | undefined;
  return () => {
    if (found === undefined) {
      found = ensureWorkspace(database, { name, now: clock.now() }).catch((error: unknown) => {
        found = undefined;
        throw error;
      });
    }
    return found;
  };
}

/** Wires the services of the `api` role to their ports. Tests call this with their own ports. */
export function createApi(
  config: ApiConfig,
  ports: ApiPorts,
): { readonly app: Hono<AppEnv>; readonly auth: AppAuth | undefined } {
  const { database, clock, logger } = ports;
  const workspace = workspaceResolver(database, clock, config.workspace.name);

  // People sign in only where the deployment is configured for it and the git host can be
  // asked who they are. Everything that follows from it hangs off this one value: without it
  // there are no sessions, and the board is nobody's.
  let auth: AppAuth | undefined;
  if (config.auth !== undefined && ports.login !== undefined) {
    const origin = config.auth.publicUrl;
    const secure = origin.startsWith("https://");
    const membership = new Membership(config.auth.members);
    if (membership.size === 0) {
      logger.warn("MEMBERS is empty: signing in is configured, and nobody is let in");
    }
    const sessions = new Sessions({
      database,
      clock,
      logger,
      ttlMs: config.auth.sessionTtlMs,
      secure,
    });
    auth = {
      origin,
      sessions,
      membership,
      login: new Login({
        database,
        workspaceId: async () => (await workspace()).id,
        host: ports.login,
        membership,
        sessions,
        secrets: createSecrets(config.auth.secret),
        clock,
        logger,
        origin,
        secure,
      }),
    };
  }

  const app = createApp({
    database,
    workspace,
    auth,
    logger,
    isShuttingDown: ports.isShuttingDown,
    requests: {
      addresses: createClientAddressResolver({
        trustedProxies: config.http?.trustedProxies ?? [],
        header: config.http?.clientIpHeader ?? "x-forwarded-for",
      }),
      requestIdHeader: config.http?.requestIdHeader ?? "x-request-id",
      accessLog: config.http?.accessLog ?? true,
      newRequestId: randomUUID,
      now: () => performance.now(),
    },
  });
  return { app, auth };
}

/** Resolves on the first of the signals a platform stops a container with. */
export function shutdownSignal(): Promise<string> {
  return new Promise((resolve) => {
    process.once("SIGTERM", () => resolve("SIGTERM"));
    process.once("SIGINT", () => resolve("SIGINT"));
  });
}

/**
 * The composition root of the `api` role: builds the dependency graph, serves HTTP, and owns
 * shutdown. Resolves when the process has shut down cleanly.
 */
export async function runApi(config: Config, logger: Logger): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    maxConnections: config.database.poolMax,
    applicationName: `${APP_NAME}-api`,
  });
  const login =
    config.auth === undefined
      ? undefined
      : createGitHubLogin({
          webUrl: config.auth.github.webUrl,
          apiUrl: config.auth.github.apiUrl,
          clientId: config.auth.github.clientId,
          clientSecret: config.auth.github.clientSecret,
          userAgent: `${APP_NAME}/${APP_VERSION}`,
        });
  let shuttingDown = false;
  const { app } = createApi(config, {
    database,
    login,
    clock: systemClock,
    logger,
    isShuttingDown: () => shuttingDown,
  });
  // A single-container install has no worker; the flag makes this process carry its work.
  const janitor = config.worker.inProcess
    ? new Janitor({ database, clock: systemClock, logger })
    : undefined;
  janitor?.start(JANITOR_INTERVAL_MS);

  const server = await startServer({
    fetch: app.fetch,
    host: config.http.host,
    port: config.http.port,
    keepAliveMs: config.http.keepAliveMs,
    requestTimeoutMs: config.http.requestTimeoutMs,
    logger,
  });
  logger.info(
    {
      host: config.http.host,
      port: server.port,
      worker: config.worker.inProcess,
      signIn: config.auth !== undefined,
    },
    "api listening",
  );

  const signal = await shutdownSignal();
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  // Readiness fails from here on; the listener stops accepting, requests in flight finish.
  await server.close(config.http.shutdownGraceMs);
  await janitor?.close();
  await database.close();
  logger.info("shutdown complete");
}
