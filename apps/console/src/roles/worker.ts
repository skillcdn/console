import { systemClock } from "../adapters/system-clock.js";
import type { Config } from "../config/config.js";
import { createDatabase } from "../db/client.js";
import { Janitor } from "../jobs/janitor.js";
import type { Logger } from "../logger.js";
import { APP_NAME } from "../version.js";
import { shutdownSignal, workspaceResolver } from "./api.js";

/** How often what time has ended is removed. */
const JANITOR_INTERVAL_MS = 15 * 60_000;

/**
 * The `worker` role: the schedules, and later the job queue. Today that is one schedule, the
 * sweep of what time has ended. Any number may run; each is interruptible: a pass that a
 * signal cuts short is the next one's work. Resolves when the process has shut down cleanly.
 */
export async function runWorker(config: Config, logger: Logger): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    maxConnections: 2,
    applicationName: `${APP_NAME}-worker`,
  });
  const workspace = workspaceResolver(database, systemClock, config.workspace.name);
  const janitor = new Janitor({ database, clock: systemClock, logger });
  try {
    const found = await workspace();
    logger.info({ workspace: found.id }, "worker running");
  } catch (error) {
    // The database may not be there yet when the container starts; the sweep retries anyway.
    logger.warn({ err: error }, "the workspace could not be found at start");
  }
  await janitor.sweep();
  janitor.start(JANITOR_INTERVAL_MS);

  const signal = await shutdownSignal();
  logger.info({ signal }, "shutting down");
  await janitor.close();
  await database.close();
  logger.info("shutdown complete");
}
