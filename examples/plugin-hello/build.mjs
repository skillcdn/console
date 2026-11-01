// Builds the plugin as the console installs it: the server module, one ESM file with everything
// it runs bundled in; the web bundle, self-contained; and its stylesheet beside it, with what it
// imports pulled in. The tests build the same way before checking the package.
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Builds the plugin whose root is `root` into its `dist/`. */
export async function buildPlugin(root) {
  await build({
    entryPoints: [join(root, "src/server/index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile: join(root, "dist/server/index.js"),
    logLevel: "warning",
  });
  await build({
    entryPoints: [join(root, "src/web/index.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    outdir: join(root, "dist/web"),
    logLevel: "warning",
  });
  await build({
    entryPoints: [join(root, "src/web/index.css")],
    bundle: true,
    outfile: join(root, "dist/web/index.css"),
    logLevel: "warning",
  });
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === here) {
  await buildPlugin(dirname(here));
}
