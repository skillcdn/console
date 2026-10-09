import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { getSchemaStatus } from "../db/migrate.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { ClientAddressResolver } from "./client-address.js";
import { type AppEnv, requestContext } from "./request-context.js";

export interface AppDependencies {
  readonly database: Database;
  /**
   * The workspace this deployment runs, found when first needed and kept: the row is made by
   * whichever role boots first, and a request that comes before the database is reachable
   * fails on its own instead of taking the process down.
   */
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly logger: Logger;
  readonly requests: {
    readonly addresses: ClientAddressResolver;
    readonly requestIdHeader: string;
    readonly accessLog: boolean;
    readonly newRequestId: () => string;
    readonly now: () => number;
  };
  /** True once shutdown has begun: readiness fails so that the platform stops sending traffic. */
  readonly isShuttingDown: () => boolean;
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * The HTTP surface of the `api` role: what every request gets (an id, a client address, an
 * access-log line), the probes a platform watches, and what answers when nothing else does.
 * The REST API, signing in and the UI's files register on top of this.
 */
export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const { database, logger, isShuttingDown } = dependencies;
  const app = new Hono<AppEnv>();
  app.use(requestContext({ logger, ...dependencies.requests }));

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/readyz", async (c) => {
    c.header("cache-control", "no-store");
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down" }, 503);
    }
    if (!(await database.ping())) {
      return c.json({ status: "database_unreachable" }, 503);
    }
    const schema = await getSchemaStatus(database);
    if (!schema.current) {
      return c.json({ status: "schema_behind", expected: schema.expected }, 503);
    }
    try {
      await dependencies.workspace();
    } catch (error) {
      logger.warn({ err: error }, "the workspace could not be found");
      return c.json({ status: "workspace_unavailable" }, 503);
    }
    return c.json({ status: "ready" });
  });

  app.notFound((c) => c.json(errorBody("not_found", "There is nothing at this path."), 404));
  app.onError((error, c) => {
    logger.error({ err: error, requestId: c.get("requestId") }, "unhandled request error");
    return c.json(errorBody("internal", "The request could not be served."), 500);
  });

  return app;
}
