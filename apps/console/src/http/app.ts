import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { getSchemaStatus } from "../db/migrate.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { type AppAuth, createAccess, registerAuth } from "./auth.js";
import type { ClientAddressResolver } from "./client-address.js";
import type { LiveFeed } from "./live-feed.js";
import { type AppEnv, requestContext } from "./request-context.js";
import { registerRest } from "./rest.js";

export interface AppDependencies {
  readonly database: Database;
  /**
   * The workspace this deployment runs, found when first needed and kept: the row is made by
   * whichever role boots first, and a request that comes before the database is reachable
   * fails on its own instead of taking the process down.
   */
  readonly workspace: () => Promise<WorkspaceRecord>;
  /** Signing in and what stands on it. Left out, nobody signs in and every request is nobody's. */
  readonly auth: AppAuth | undefined;
  /** The subscribers of the feed in this process. */
  readonly feed: LiveFeed;
  readonly clock: Clock;
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
 * access-log line), the probes a platform watches, signing in and who is signed in, the REST
 * API of the board with its live feed, and what answers when nothing else does. The UI's files
 * register on top.
 */
export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const { database, logger, isShuttingDown, auth, workspace, feed, clock } = dependencies;
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
      await workspace();
    } catch (error) {
      logger.warn({ err: error }, "the workspace could not be found");
      return c.json({ status: "workspace_unavailable" }, 503);
    }
    return c.json({ status: "ready" });
  });

  // Nothing under /api is ever cached: it is one person's, or it changes.
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });

  const access = createAccess(auth);
  registerAuth(app, { auth, access, workspace, logger });
  registerRest(app, { database, workspace, access, feed, clock, logger });

  app.notFound((c) => c.json(errorBody("not_found", "There is nothing at this path."), 404));
  app.onError((error, c) => {
    logger.error({ err: error, requestId: c.get("requestId") }, "unhandled request error");
    return c.json(errorBody("internal", "The request could not be served."), 500);
  });

  return app;
}
