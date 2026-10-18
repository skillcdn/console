import { createRequire } from "node:module";
import * as z from "zod";

/** What the process calls itself: in `pg_stat_activity`, and in the user agent sent to the git host, the bucket and the SkillCDN deployment. */
export const APP_NAME = "console";

/** `major.minor` of a version, or of the lowest version a range admits (`^0.3.0`, `~0.3.0`, `>=0.3.0 <0.5`); nothing for any other text. */
export function skillcdnLineOf(range: string): string | undefined {
  const match = /(\d+)\.(\d+)\.\d+/.exec(range);
  return match === null ? undefined : `${match[1]}.${match[2]}`;
}

// The console's version is the package's: the image is built from a commit of the repository,
// and the package at that commit is what the command is held to (ADR-0025). Which SkillCDN the
// console is built on is the line of @skillcdn/core the package declares, one version for every
// package of the main repository (ADR-0033). Both are read once from the package's manifest; an
// image without them is packaged wrong, and says so before it answers.
const manifest = z
  .object({ version: z.string(), dependencies: z.object({ "@skillcdn/core": z.string() }) })
  .safeParse(createRequire(import.meta.url)("@skillcdn/console/package.json"));
if (!manifest.success) {
  throw new Error("the version of @skillcdn/console could not be read from its manifest");
}
const line = skillcdnLineOf(manifest.data.dependencies["@skillcdn/core"]);
if (line === undefined) {
  throw new Error(
    "the line of @skillcdn/core could not be read from the manifest of @skillcdn/console",
  );
}
export const APP_VERSION: string = manifest.data.version;
/** The SkillCDN line the console is built on, `0.3`. */
export const APP_SKILLCDN: string = line;
