import process from "node:process";
import { ConfigError, loadConfig } from "./config/config.js";
import { createLogger } from "./logger.js";
import { ROLES, type Role, selectRole } from "./roles.js";

// The one entry point of the image: the first argument selects the role (ADR-0002). Exit
// codes, which the image keeps: 64 for a usage error, 78 for invalid configuration, 70 for an
// internal failure, and 1 where `verify` found a transcript that does not hold.
const EXIT_BROKEN = 1;
const EXIT_USAGE = 64;
const EXIT_CONFIG = 78;
const EXIT_FAILURE = 70;

async function run(role: Role, args: readonly string[]): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_CONFIG;
      return;
    }
    throw error;
  }
  const logger = createLogger({ level: config.logLevel, role });
  try {
    // Each role loads its own dependency graph, so `migrate` does not pay for the HTTP stack.
    if (role === "api") {
      const { runApi } = await import("./roles/api.js");
      await runApi(config, logger);
    } else if (role === "worker") {
      const { runWorker } = await import("./roles/worker.js");
      await runWorker(config, logger);
    } else if (role === "verify") {
      const { runVerify } = await import("./roles/verify.js");
      const verified = await runVerify(config, logger, args);
      if ("usage" in verified) {
        process.stderr.write(`usage: console verify [<month>...]: ${verified.usage}\n`);
        process.exitCode = EXIT_USAGE;
      } else if (verified.unheld > 0) {
        process.exitCode = EXIT_BROKEN;
      }
    } else {
      const { runMigrate } = await import("./roles/migrate.js");
      await runMigrate(config, logger);
    }
  } catch (error) {
    // Settings that only a role can check, such as a directory it is pointed at.
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}
`);
      process.exitCode = EXIT_CONFIG;
      return;
    }
    logger.fatal({ err: error }, "fatal error");
    process.exitCode = EXIT_FAILURE;
  }
}

const selection = selectRole(process.argv.slice(2));
if (selection.ok) {
  await run(selection.role, selection.args);
} else {
  process.stderr.write(`usage: console <${ROLES.join("|")}>\n`);
  process.exitCode = EXIT_USAGE;
}
