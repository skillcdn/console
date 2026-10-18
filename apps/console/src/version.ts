import { createRequire } from "node:module";
import * as z from "zod";

/** What the process calls itself: in `pg_stat_activity`, and in the user agent sent to the git host, the bucket and the SkillCDN deployment. */
export const APP_NAME = "console";

// The console's version is the package's: the image is built from a commit of the repository,
// and the package at that commit is what the command is held to (ADR-0025). Read once from the
// package's manifest; an image without it is packaged wrong, and says so before it answers.
const manifest = z
  .object({ version: z.string() })
  .safeParse(createRequire(import.meta.url)("@skillcdn/console/package.json"));
if (!manifest.success) {
  throw new Error("the version of @skillcdn/console could not be read from its manifest");
}
export const APP_VERSION: string = manifest.data.version;
