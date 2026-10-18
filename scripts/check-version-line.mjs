// The version of @skillcdn/console follows SkillCDN's (ADR-0032): its major and minor are those of
// the one version the main repository's packages share, as the manifests declare them, and its
// patch is the console's own; the packages are taken at one version, which the lockfile resolves.
// Part of `pnpm check`. Reads the manifests and the lockfile; no network.
import { readFileSync } from "node:fs";
import process from "node:process";

const PACKAGE = "packages/console/package.json";
/** Every manifest that may declare a package of the main repository. */
const MANIFESTS = ["package.json", "apps/console/package.json", "packages/console/package.json"];
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const LOCKFILE = "pnpm-lock.yaml";
const SCOPE = "@skillcdn/";
/** The package itself, which the app takes from the workspace; it declares no line. */
const SELF = "@skillcdn/console";
/** The version before the first release, of which no line is asked. */
const UNRELEASED = "0.0.0";
/** What moves the packages together, within their ranges. */
const MOVE = 'pnpm -r update "@skillcdn/*"';

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

/** `major.minor` of a version, or of the lowest version a range admits (`^0.3.0`, `~0.3.0`, `>=0.3.0 <0.5`). */
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

// What the manifests declare, wherever they declare it.
const declared = MANIFESTS.flatMap((path) => {
  const manifest = read(path);
  return FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([name]) => name.startsWith(SCOPE) && name !== SELF)
      .map(([name, spec]) => ({ path, name, spec, line: lineOf(spec) })),
  );
});
if (declared.length === 0) {
  process.stderr.write(
    `version line: no manifest declares a ${SCOPE}* package, which ADR-0032 builds the version on\n`,
  );
  process.exit(1);
}
const problems = declared
  .filter((found) => found.line !== line)
  .map(
    (found) =>
      `${found.path} declares ${found.name} ${found.spec} (line ${found.line}), but ${PACKAGE} is ${version} (line ${line})`,
  );

// What the lockfile resolved: every `@skillcdn/<name>@<version>` it holds, the nested ones too.
const resolved = new Map();
const lockfile = readFileSync(LOCKFILE, "utf8");
for (const match of lockfile.matchAll(/^ {2}'?(@skillcdn\/[a-z-]+)@(\d+\.\d+\.\d+)/gm)) {
  const [, name, found] = match;
  resolved.set(name, (resolved.get(name) ?? new Set()).add(found));
}
const versions = [...new Set([...resolved.values()].flatMap((set) => [...set]))].sort();
if (versions.length > 1) {
  const list = [...resolved].map(([name, set]) => `${name} ${[...set].join(", ")}`).join("; ");
  problems.push(
    `${LOCKFILE} resolves the packages to more than one version (${list}); they move together, with ${MOVE}`,
  );
} else if (versions.length === 1 && lineOf(versions[0]) !== line) {
  problems.push(
    `${LOCKFILE} resolves the packages to ${versions[0]} (line ${lineOf(versions[0])}), but ${PACKAGE} is ${version} (line ${line})`,
  );
}

if (problems.length > 0) {
  process.stderr.write("the package's version does not follow SkillCDN's (ADR-0032):\n");
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.exit(1);
}
process.stdout.write(
  `version line: ${PACKAGE} ${version} follows SkillCDN ${line}: ${declared
    .map((found) => `${found.name} ${found.spec}`)
    .join(", ")}, resolved to ${versions.join(", ") || "nothing yet"}\n`,
);
