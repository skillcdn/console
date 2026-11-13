import type { Config } from "../config/config.js";
import { createDatabase } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import type { Logger } from "../logger.js";
import { APP_NAME, APP_VERSION } from "../version.js";
import { blobStoreOf, buildPlugins } from "./api.js";

/**
 * Applies pending migrations, then the upgrades of the plugins' records where the image carries
 * plugins (docs/specs/plugins.md, "Lifecycle"), then exits. Run once, before a new version rolls out.
 */
export async function runMigrate(
  config: Config,
  logger: Logger,
  /** The compiled plugin host; another where the role runs from its sources, as its tests do. */
  hostEntry?: string,
): Promise<void> {
  const { latest } = await migrateDatabase(config.database.url, { ca: config.database.ca });
  logger.info({ latest }, "migrations applied");
  if (config.plugins.dir !== undefined) {
    await upgradePlugins(config, logger, hostEntry);
  }
}

/**
 * The plugins' upgrades, in a host of this role's own, which ends with it. The plugins are wired
 * as the api role wires them, so that an upgrade reaches through `ctx` what a job reaches, its
 * records first; none of them is started, and nothing but the upgrades runs.
 */
async function upgradePlugins(
  config: Config,
  logger: Logger,
  hostEntry: string | undefined,
): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    ca: config.database.ca,
    maxConnections: 2,
    applicationName: `${APP_NAME}-migrate`,
  });
  try {
    const blobs = await blobStoreOf(config, database, logger, `${APP_NAME}/${APP_VERSION}`);
    // The role is given no name for the board (deploy/README.md): it finds the workspace and
    // leaves its name alone.
    const { plugins, host, discovery } = await buildPlugins(
      config,
      database,
      blobs,
      logger,
      hostEntry,
      false,
    );
    await host.start();
    try {
      const { steps, failed } = await plugins.upgrade();
      // One line whoever rolls a version out reads: how many steps ran, and how many plugins
      // are left behind their code, by name. The console's own migrations went through either
      // way, and the roles start on them.
      const said = {
        steps,
        failed: failed.length,
        plugins: discovery.plugins.map((plugin) => plugin.key),
      };
      if (failed.length === 0) {
        logger.info(said, "plugin upgrades applied");
      } else {
        logger.error({ ...said, behind: failed }, "plugin upgrades applied");
      }
    } finally {
      await plugins.stop();
    }
  } finally {
    await database.close();
  }
}
