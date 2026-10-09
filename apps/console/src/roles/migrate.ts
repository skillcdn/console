import type { Config } from "../config/config.js";
import { migrateDatabase } from "../db/migrate.js";
import type { Logger } from "../logger.js";

/** Applies pending migrations, then exits. Run once, before a new version rolls out. */
export async function runMigrate(config: Config, logger: Logger): Promise<void> {
  const { latest } = await migrateDatabase(config.database.url);
  logger.info({ latest }, "migrations applied");
}
