// The version of @skillcdn/console follows the line of @skillcdn/core the console is built on
// (ADR-0007): its major and minor are core's, as the workspaces declare the dependency, and its
// patch is the console's own. Part of `pnpm check`. Reads the manifests; no network.
import { readFileSync } from "node:fs";
import process from "node:process";

const PACKAGE = "packages/console/package.json";
/** Where the console declares what it is built on; a workspace without the dependency is skipped. */
const DECLARED_IN = ["apps/console/package.json", "packages/console/package.json"];
const CORE = "@skillcdn/core";
/** The version before the first release, of which no line is asked. */
const UNRELEASED = "0.0.0";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

/** `major.minor` of a version, or of the lowest version a range admits (`^0.1.1`, `~0.1.1`, `>=0.1.1 <0.3`). */
function lineOf(spec) {
  const match = /(\d+)\.(\d+)\.\d+/.exec(spec);
  return match === null ? undefined : `${match[1]}.${match[2]}`;
}

const { version } = read(PACKAGE);
if (version === UNRELEASED) {
  process.stdout.write(`version line: ${PACKAGE} is ${UNRELEASED}, not released yet\n`);
  process.exit(0);
}
const line = lineOf(version);
const declared = DECLARED_IN.flatMap((path) => {
  const manifest = read(path);
  const spec = manifest.dependencies?.[CORE] ?? manifest.peerDependencies?.[CORE];
  return spec === undefined ? [] : [{ path, spec, line: lineOf(spec) }];
});
if (declared.length === 0) {
  process.stderr.write(
    `version line: no workspace declares ${CORE}, which ADR-0007 builds the version on\n`,
  );
  process.exit(1);
}
const problems = declared
  .filter((found) => found.line !== line)
  .map(
    (found) =>
      `${found.path} declares ${CORE} ${found.spec} (line ${found.line}), but ${PACKAGE} is ${version} (line ${line})`,
  );
if (problems.length > 0) {
  process.stderr.write("the package's version does not follow the core line (ADR-0007):\n");
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.exit(1);
}
process.stdout.write(
  `version line: ${PACKAGE} ${version} follows ${CORE} ${declared.map((found) => found.spec).join(", ")}\n`,
);
