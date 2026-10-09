import { randomUUID } from "node:crypto";
import process from "node:process";
import type { Hono } from "hono";
import { systemClock } from "../adapters/system-clock.js";
import type { Config } from "../config/config.js";
import { createDatabase, type Database } from "../db/client.js";
import { ensureWorkspace, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { createApp } from "../http/app.js";
import { createClientAddressResolver } from "../http/client-address.js";
import type { AppEnv } from "../http/request-context.js";
import { startServer } from "../http/server.js";
import { Janitor } from "../jobs/janitor.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { APP_NAME } from "../version.js";

/** How often what time has ended is removed, when this process does the worker's work. */
const JANITOR_INTERVAL_MS = 15 * 60_000;

export interface ApiPorts {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly isShuttingDown: () => boolean;
}

export type ApiConfig = Pick<Config, "workspace"> & {
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
export function createApi(config: ApiConfig, ports: ApiPorts): { readonly app: Hono<AppEnv> } {
  const { database, clock, logger } = ports;
  const app = createApp({
    database,
    workspace: workspaceResolver(database, clock, config.workspace.name),
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
  return { app };
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
  let shuttingDown = false;
  const { app } = createApi(config, {
    database,
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
    { host: config.http.host, port: server.port, worker: config.worker.inProcess },
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
