// The console is built on one version of the main repository's packages (ADR-0033): every
// `@skillcdn` package a manifest declares is on one line, at a caret range, and the lockfile
// resolves all of them to one version on that line. The package's own version says nothing of
// it. Part of `pnpm check`. Reads the manifests and the lockfile; no network.
import { readFileSync } from "node:fs";
import process from "node:process";

/** Every manifest that may declare a package of the main repository. */
const MANIFESTS = ["package.json", "apps/console/package.json", "packages/console/package.json"];
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const LOCKFILE = "pnpm-lock.yaml";
const SCOPE = "@skillcdn/";
/** The package itself, which the app takes from the workspace; it is not one of them. */
const SELF = "@skillcdn/console";
/** What moves the packages together, within their ranges. */
const MOVE = 'pnpm -r update "@skillcdn/*"';

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

/** `major.minor` of a version, or of the lowest version a range admits (`^0.3.0`, `~0.3.0`, `>=0.3.0 <0.5`). */
function lineOf(spec) {
  const match = /(\d+)\.(\d+)\.\d+/.exec(spec);
  return match === null ? undefined : `${match[1]}.${match[2]}`;
}

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
    `skillcdn line: no manifest declares a ${SCOPE}* package, which the console is built on\n`,
  );
  process.exit(1);
}
const lines = [...new Set(declared.map((found) => found.line))].sort();
const problems = [];
if (lines.length > 1) {
  const list = declared.map((found) => `${found.path}: ${found.name} ${found.spec}`).join("; ");
  problems.push(`the manifests name more than one line of SkillCDN (${list}); they move together`);
}
const line = lines[0];

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
  problems.push(`${LOCKFILE} resolves the packages to more than one version (${list})`);
} else if (versions.length === 1 && line !== undefined && lineOf(versions[0]) !== line) {
  problems.push(
    `${LOCKFILE} resolves the packages to ${versions[0]} (line ${lineOf(versions[0])}), but the manifests name the line ${line}`,
  );
}

if (problems.length > 0) {
  process.stderr.write("the packages of SkillCDN are not taken at one version (ADR-0033):\n");
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.stderr.write(`move them together: ${MOVE}\n`);
  process.exit(1);
}
process.stdout.write(
  `skillcdn line: ${line}, as ${declared
    .map((found) => `${found.name} ${found.spec}`)
    .join(", ")} declare it, resolved to ${versions.join(", ") || "nothing yet"}\n`,
);
