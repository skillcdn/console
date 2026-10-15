import { systemClock } from "../adapters/system-clock.js";
import type { Config } from "../config/config.js";
import { createDatabase } from "../db/client.js";
import { Archivist } from "../jobs/archivist.js";
import { Janitor } from "../jobs/janitor.js";
import { OrganizationSync } from "../jobs/organization-sync.js";
import type { Logger } from "../logger.js";
import { APP_NAME, APP_VERSION } from "../version.js";
import {
  ORGANIZATION_SYNC_INTERVAL_MS,
  organizationOf,
  shutdownSignal,
  workspaceResolver,
} from "./api.js";

/** How often what time has ended is removed. */
const JANITOR_INTERVAL_MS = 15 * 60_000;
/** How often what was done or dropped long enough ago is put away (ADR-0029). */
const ARCHIVE_INTERVAL_MS = 60 * 60_000;

/**
 * The `worker` role: the schedules, and later the job queue. Today that is the sweep of what
 * time has ended, and, where the deployment names an organization at the git host, the reading
 * of it (ADR-0022). Any number may run; each is interruptible: a pass that a signal cuts short
 * is the next one's work. Resolves when the process has shut down cleanly.
 */
export async function runWorker(config: Config, logger: Logger): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    ca: config.database.ca,
    maxConnections: 2,
    applicationName: `${APP_NAME}-worker`,
  });
  const workspace = workspaceResolver(database, systemClock, config.workspace.name);
  const janitor = new Janitor({ database, clock: systemClock, logger });
  const archivist =
    config.worker.archiveAfterDays > 0
      ? new Archivist({
          database,
          clock: systemClock,
          logger,
          afterDays: config.worker.archiveAfterDays,
        })
      : undefined;
  const organization = organizationOf(config, `${APP_NAME}/${APP_VERSION}`);
  const sync =
    organization === undefined
      ? undefined
      : new OrganizationSync({
          database,
          organization,
          workspaceId: async () => (await workspace()).id,
          clock: systemClock,
          logger,
        });
  try {
    const found = await workspace();
    logger.info({ workspace: found.id, organization: organization?.name }, "worker running");
  } catch (error) {
    // The database may not be there yet when the container starts; the sweep retries anyway.
    logger.warn({ err: error }, "the workspace could not be found at start");
  }
  await janitor.sweep();
  janitor.start(JANITOR_INTERVAL_MS);
  if (archivist !== undefined) {
    await archivist.sweep();
    archivist.start(ARCHIVE_INTERVAL_MS);
  }
  if (sync !== undefined) {
    await sync.sync();
    sync.start(ORGANIZATION_SYNC_INTERVAL_MS);
  }

  const signal = await shutdownSignal();
  logger.info({ signal }, "shutting down");
  await janitor.close();
  await archivist?.close();
  await sync?.close();
  await database.close();
  logger.info("shutdown complete");
}
