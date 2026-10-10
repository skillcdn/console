// The skills under skills/ are maps of the command and the API (ADR-0015): they name commands,
// routes and files that live elsewhere, and a rename there must not leave a skill pointing at
// nothing. The indexer's own verdict on the format comes from `skillcdn check`, which runs
// before this in `pnpm check`; this checks what only this repository knows:
//   1. every `console <command>` a skill or the manifest names is a command of the command line
//      (the table in packages/console/src/cli/help.ts, plus help and version);
//   2. every `/api/v1/...` path a skill names is in docs/specs/rest.md, spelled as there;
//   3. every link a skill or the manifest makes to a file of the repository resolves;
//   4. a skill's name is its directory's, and its description is within the authoring limit;
//   5. the manifest's document directories and exclusions exist.
// A changed meaning is not caught here: a change to the command or the API updates its spec
// and re-reads the skills that name it (AGENTS.md, documentation protocol).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const read = (file) => readFileSync(path.join(root, file), "utf8");

/** The front-matter as a flat map of its top-level scalar keys, and the lists under `documents` and `exclude`. */
function frontMatter(file, text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (match === null) {
    fail(file, "has no front-matter");
    return { scalars: {}, lists: {} };
  }
  const scalars = {};
  const lists = {};
  let list;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^ {2}- (.+)$/.exec(line);
    if (item !== null && list !== undefined) {
      lists[list].push(item[1].trim());
      continue;
    }
    const key = /^([a-z]+):(?: (.*))?$/.exec(line);
    if (key !== null) {
      list = key[2] === undefined ? key[1] : undefined;
      if (list !== undefined) {
        lists[list] = [];
      } else {
        scalars[key[1]] = key[2].replace(/^"(.*)"$/, "$1");
      }
    } else if (!/^ /.test(line)) {
      list = undefined;
    }
  }
  return { scalars, lists };
}

// 1. The commands the command line has.
const help = read("packages/console/src/cli/help.ts");
const commands = new Set(["help", "version"]);
for (const match of help.matchAll(/^ {2}"?([a-z][a-z-]*)"?: \{$/gm)) {
  commands.add(match[1]);
}
if (commands.size < 10) {
  fail("packages/console/src/cli/help.ts", "the table of commands was not found");
}

// 2. The routes the REST API documents.
const rest = read("docs/specs/rest.md");

const files = ["SKILLCDN.md"];
for (const entry of readdirSync(path.join(root, "skills"), { withFileTypes: true })) {
  if (entry.isDirectory()) {
    files.push(`skills/${entry.name}/SKILL.md`);
  }
}

for (const file of files) {
  if (!existsSync(path.join(root, file))) {
    fail(file, "is missing: a skill directory holds a SKILL.md");
    continue;
  }
  const text = read(file);
  const { scalars, lists } = frontMatter(file, text);

  for (const match of text.matchAll(/`console ([a-z][a-z-]*)/g)) {
    if (!commands.has(match[1])) {
      fail(file, `names \`console ${match[1]}\`, which is not a command of the command line`);
    }
  }
  for (const match of text.matchAll(/`(?:(?:GET|POST|PATCH|PUT|DELETE) )?(\/api\/v1[^`]*)`/g)) {
    if (!rest.includes(match[1])) {
      fail(file, `names \`${match[1]}\`, which docs/specs/rest.md does not spell so`);
    }
  }
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/.test(target) || target.startsWith("#")) {
      continue;
    }
    const bare = target.replace(/#.*$/, "");
    const resolved = bare.startsWith("/")
      ? path.join(root, bare)
      : path.join(root, path.dirname(file), bare);
    if (!existsSync(resolved)) {
      fail(file, `links to ${target}, which does not exist`);
    }
  }

  if (file === "SKILLCDN.md") {
    for (const directory of lists.documents ?? []) {
      const at = path.join(root, directory);
      if (!existsSync(at) || !statSync(at).isDirectory()) {
        fail(file, `declares the document directory ${directory}, which does not exist`);
      }
    }
    for (const excluded of lists.exclude ?? []) {
      if (!existsSync(path.join(root, excluded))) {
        fail(file, `excludes ${excluded}, which does not exist`);
      }
    }
  } else {
    const directory = path.basename(path.dirname(file));
    if (scalars.name !== directory) {
      fail(file, `is named ${scalars.name ?? "(nothing)"}, not ${directory} as its directory is`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scalars.name ?? "")) {
      fail(file, "has a name that is not lowercase words joined by single hyphens");
    }
    const description = scalars.description ?? "";
    if (description.length === 0 || description.length > 1024) {
      fail(file, `has a description of ${description.length} characters; 1 to 1024 are allowed`);
    }
    if (!/^---\r?\n[\s\S]*?\r?\n---\r?\n+# /.test(text)) {
      fail(file, "does not start its body with a level-one heading");
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`skills: ${errors.length} problem${errors.length === 1 ? "" : "s"}\n`);
  for (const error of errors) {
    process.stderr.write(`  ${error}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  `skills: ${files.length - 1} skills and the manifest name ${commands.size} commands' and the API's paths that exist\n`,
);
