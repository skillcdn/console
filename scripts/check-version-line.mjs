// The version of @skillcdn/console is SkillCDN's line with a patch of its own (ADR-0034): its
// major and minor are those of the one version of the main repository's packages, as the
// manifests declare it and the lockfile resolves it, and the lines are adopted in order, one
// `minor` changeset each, so a package one line behind is allowed while that changeset is
// pending. Part of `pnpm check`. Reads the manifests, the lockfile and the pending changesets;
// no network.
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";

const PACKAGE = "packages/console/package.json";
/** Every manifest that may declare a package of the main repository. */
const MANIFESTS = ["package.json", "apps/console/package.json", "packages/console/package.json"];
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const LOCKFILE = "pnpm-lock.yaml";
const CHANGESETS = ".changeset";
const SCOPE = "@skillcdn/";
/** The package itself, which the app takes from the workspace; it is not one of them. */
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

function partsOf(line) {
  const [major, minor] = line.split(".").map(Number);
  return { major, minor };
}

/** The highest bump the pending changesets ask of the package, or nothing. */
function pendingBump() {
  const rank = { patch: 1, minor: 2, major: 3 };
  let highest;
  for (const name of readdirSync(CHANGESETS)) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(`${CHANGESETS}/${name}`, "utf8"));
    const bump =
      front === null
        ? undefined
        : /^"@skillcdn\/console":\s*(major|minor|patch)\s*$/m.exec(front[1])?.[1];
    if (bump !== undefined && (highest === undefined || rank[bump] > rank[highest])) {
      highest = bump;
    }
  }
  return highest;
}

const { version } = read(PACKAGE);
if (version === UNRELEASED) {
  process.stdout.write(`version line: ${PACKAGE} is ${UNRELEASED}, not released yet\n`);
  process.exit(0);
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
    `version line: no manifest declares a ${SCOPE}* package, which the console is built on\n`,
  );
  process.exit(1);
}
const problems = [];
const lines = [...new Set(declared.map((found) => found.line))].sort();
if (lines.length > 1) {
  const list = declared.map((found) => `${found.path}: ${found.name} ${found.spec}`).join("; ");
  problems.push(
    `the manifests name more than one line of SkillCDN (${list}); they move together, with ${MOVE}`,
  );
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
  problems.push(
    `${LOCKFILE} resolves the packages to more than one version (${list}); they move together, with ${MOVE}`,
  );
} else if (versions.length === 1 && line !== undefined && lineOf(versions[0]) !== line) {
  problems.push(
    `${LOCKFILE} resolves the packages to ${versions[0]} (line ${lineOf(versions[0])}), but the manifests name the line ${line}`,
  );
}

// The package's own line: the manifests' line, or one behind it while the changeset that adopts
// the next line is pending.
const own = lineOf(version);
let adopting;
if (own !== undefined && line !== undefined && own !== line) {
  const bump = pendingBump();
  const from = partsOf(own);
  const to = partsOf(line);
  const nextMinor = from.major === to.major && from.minor + 1 === to.minor && bump === "minor";
  const nextMajor = from.major + 1 === to.major && bump === "major";
  if (nextMinor || nextMajor) {
    adopting = bump;
  } else {
    problems.push(
      `${PACKAGE} is ${version} (line ${own}), but the manifests name the line ${line}; a line is adopted in order, with a \`minor\` changeset pending (${bump === undefined ? "none is" : `a ${bump} is`})`,
    );
  }
}

if (problems.length > 0) {
  process.stderr.write("the package's version does not follow SkillCDN's line (ADR-0034):\n");
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.exit(1);
}
process.stdout.write(
  `version line: ${PACKAGE} ${version} on SkillCDN ${line}${adopting === undefined ? "" : ` (adopting it: a ${adopting} changeset is pending)`}, as ${declared
    .map((found) => `${found.name} ${found.spec}`)
    .join(", ")} declare it, resolved to ${versions.join(", ") || "nothing yet"}\n`,
);
