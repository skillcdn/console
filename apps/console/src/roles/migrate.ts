import { systemClock } from "../adapters/system-clock.js";
import type { Config } from "../config/config.js";
import { createDatabase } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots, HOST_ENTRY } from "../plugins/paths.js";
import { runPluginUpgrades } from "../plugins/upgrades.js";
import { APP_NAME } from "../version.js";

/**
 * Applies pending migrations, then the upgrades of the plugins' records where the image carries
 * plugins (docs/specs/plugins.md, "Lifecycle"), then exits. Run once, before a new version rolls out.
 */
export async function runMigrate(config: Config, logger: Logger): Promise<void> {
  const { latest } = await migrateDatabase(config.database.url, { ca: config.database.ca });
  logger.info({ latest }, "migrations applied");
  if (config.plugins.dir !== undefined) {
    await upgradePlugins(config, config.plugins.dir, logger);
  }
}

/** The plugins' upgrades, in a host of this role's own, which ends with it. */
async function upgradePlugins(config: Config, dir: string, logger: Logger): Promise<void> {
  const database = createDatabase({
    connectionString: config.database.url,
    ca: config.database.ca,
    maxConnections: 2,
    applicationName: `${APP_NAME}-migrate`,
  });
  try {
    const discovery = await discoverPlugins(dir);
    const workspace = await ensureWorkspace(database, {
      name: config.workspace.name,
      now: systemClock.now(),
    });
    const host = new PluginHost({
      entry: HOST_ENTRY,
      allowRead: await allowedReadRoots(dir),
      env: config.plugins.hostEnv,
      logger,
      // An upgrade works on the records alone, which come with the record store; until then it
      // reaches nothing.
      onContext: () => Promise.reject(new Error("ctx is not available during an upgrade yet")),
    });
    await host.start();
    try {
      const steps = await runPluginUpgrades({
        database,
        workspace,
        host,
        discovery,
        memoryMb: config.plugins.memoryMb,
        clock: systemClock,
        logger,
      });
      logger.info(
        { steps, plugins: discovery.plugins.map((plugin) => plugin.key) },
        "plugin upgrades applied",
      );
    } finally {
      await host.stop();
    }
  } finally {
    await database.close();
  }
}
