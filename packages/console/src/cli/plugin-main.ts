#!/usr/bin/env node
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import { loadServerModule } from "../plugin/load.js";
import { runPluginCli } from "./plugin-cli.js";

// The `console-plugin` command, the package's second bin: the only place it reads the process.
// Everything it does is in plugin-cli.ts, which takes what it needs and is what the tests run.

/** The package's own directory, two levels above dist/cli: where the template is. */
const packageDir = fileURLToPath(new URL("../../", import.meta.url));
const manifest = z
  .object({ version: z.string() })
  .safeParse(createRequire(import.meta.url)("../../package.json"));

process.exitCode = await runPluginCli(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  cwd: process.cwd(),
  templateDir: join(packageDir, "template", "plugin"),
  version: manifest.success ? manifest.data.version : undefined,
  loadServer: (file) => loadServerModule(file),
});
