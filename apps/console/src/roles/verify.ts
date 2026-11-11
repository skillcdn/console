import type { Config } from "../config/config.js";
import { createDatabase } from "../db/client.js";
import { checkTranscript } from "../db/queries/transcript-check.js";
import type { Logger } from "../logger.js";
import { isMonth } from "../ports/blob-store.js";
import { APP_NAME } from "../version.js";

/**
 * Checks the transcript's months against the chains their sessions keep (ADR-0090), says what
 * does not hold, and exits: run by whoever brought a month back, or wants to know that the
 * transcript is what it was. Reads and changes nothing. Answers how many sessions do not hold,
 * the months asked for that are away among them; or what was asked in words it does not read,
 * which are months as `2026-11`, or nothing for every month whose events are there.
 */
export async function runVerify(
  config: Config,
  logger: Logger,
  args: readonly string[],
): Promise<{ readonly unheld: number } | { readonly usage: string }> {
  const unread = args.filter((month) => !isMonth(month));
  if (unread.length > 0) {
    return {
      usage: `a month is named as 2026-11: ${unread.join(", ")} ${unread.length === 1 ? "is" : "are"} not`,
    };
  }
  const database = createDatabase({
    connectionString: config.database.url,
    ca: config.database.ca,
    maxConnections: 2,
    applicationName: `${APP_NAME}-verify`,
  });
  try {
    const check = await checkTranscript(database, {
      months: args.length === 0 ? undefined : args,
    });
    for (const one of check.broken) {
      logger.error(one, "transcript session does not hold");
    }
    // One line whoever runs it reads: what was checked, and how much of it does not hold.
    const said = {
      months: check.months,
      away: check.away,
      sessions: check.sessions,
      events: check.events,
      sealed: check.sealed,
      unchained: check.unchained,
      broken: check.broken.length,
    };
    if (check.broken.length === 0 && check.away.length === 0) {
      logger.info(said, "transcript verified");
    } else {
      logger.error(said, "transcript verified");
    }
    return { unheld: check.broken.length + check.away.length };
  } finally {
    await database.close();
  }
}
