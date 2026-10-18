#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import { userAgentOf } from "../compat.js";
import { runCli } from "./cli.js";
import { createFileStore, defaultConfigDir } from "./credentials.js";
import { createDirectoryStore } from "./directory.js";
import { detectInstall } from "./install.js";
import { createNoticeStore } from "./notices.js";
import { listenOn } from "./serve.js";
import { readBytesAt, readFileAt, readStdin, writeBytesAt } from "./terminal.js";

// The `console` command: the only place the command reads the process. Everything it does is in
// cli.ts, which takes what it needs and is what the tests run.

/** The package's own directory, two levels above dist/cli: where its manifest and its skills are. */
const packageDir = fileURLToPath(new URL("../../", import.meta.url));
/** The version of the package this file runs from: its own manifest. */
const manifest = z
  .object({ version: z.string() })
  .safeParse(createRequire(import.meta.url)("../../package.json"));
const version = manifest.success ? manifest.data.version : undefined;
/** The console's own skills, shipped with the package beside dist/ (ADR-0015); not there in a checkout before packing. */
const skillsDir = fileURLToPath(new URL("../../skills/", import.meta.url));
const configDir = defaultConfigDir(process.env);

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  fetch: (input, init) => fetch(input, init),
  readStdin,
  hostname: hostname(),
  readFile: readFileAt,
  readBytes: readBytesAt,
  writeBytes: writeBytesAt,
  store: createFileStore(configDir),
  directory: createDirectoryStore(process.cwd()),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  version,
  // The command names itself on every request, and where it runs, so that the console holds it
  // to the versions it takes and the access log says which commands are about (ADR-0025).
  userAgent:
    version === undefined
      ? undefined
      : userAgentOf(version, `cli; node ${process.versions.node}; ${process.platform}`),
  install: detectInstall({
    packageDir,
    cwd: process.cwd(),
    env: process.env,
    exists: existsSync,
  }),
  notices: createNoticeStore(configDir),
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  skillsDir: existsSync(skillsDir) ? skillsDir : undefined,
  listen: listenOn,
});
