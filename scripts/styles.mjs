// The console's stylesheet as its sources keep it and as the package ships it (ADR-0106):
// `packages/console/src/styles/console.css` names the files in the order they are read, and
// `assemble` joins them into the one file a console loads. `node ../../scripts/styles.mjs build`
// is the package's build step, run in the package's directory as `pack-files.mjs` is;
// `check-styles.mjs` reads the same files through the same functions.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Where the stylesheet's sources are, from the repository's root. */
export const STYLES_DIR = "packages/console/src/styles";

const IMPORT = /^@import "\.\/([\w/-]+\.css)";$/;

/**
 * The files the manifest names, in its order, each with its text. A line of the manifest is an
 * import of a file beside it, a comment or nothing: a rule written there would be read before
 * every file after it and belong to none.
 */
export function styleFiles(stylesDir) {
  const manifest = readFileSync(resolve(stylesDir, "console.css"), "utf8");
  const files = [];
  for (const line of manifest.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const named = IMPORT.exec(line.trim());
    if (named === null) {
      throw new Error(`console.css holds something other than an import: ${line.trim()}`);
    }
    const name = named[1];
    files.push({ name, text: readFileSync(resolve(stylesDir, name), "utf8") });
  }
  return files;
}

/** The one stylesheet: every file the manifest names, in its order, each under its name. */
export function assemble(stylesDir) {
  const head =
    "/* @skillcdn/console: the console's styles, joined from src/styles in the order console.css there names. */";
  const files = styleFiles(stylesDir).map((file) =>
    [`/* ${file.name} */`, file.text.trimEnd(), ""].join("\n"),
  );
  return [head, "", ...files].join("\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === "build") {
    const out = resolve("dist", "console.css");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, assemble(resolve("src", "styles")));
  } else {
    process.stderr.write("usage: node ../../scripts/styles.mjs build\n");
    process.exitCode = 2;
  }
}
