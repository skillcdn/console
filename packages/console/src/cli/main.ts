#!/usr/bin/env node
import { createRequire } from "node:module";
import process from "node:process";
import * as z from "zod/mini";
import { runCli } from "./cli.js";
import { createFileStore, defaultConfigDir } from "./credentials.js";
import { createDirectoryStore } from "./directory.js";
import { readBytesAt, readFileAt, readSecret, readStdin } from "./terminal.js";

// The `console` command: the only place the command reads the process. Everything it does is in
// cli.ts, which takes what it needs and is what the tests run.

/** The version of the package this file runs from: its own manifest, two levels above dist/cli. */
const manifest = z
  .object({ version: z.string() })
  .safeParse(createRequire(import.meta.url)("../../package.json"));

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
  readSecret,
  readFile: readFileAt,
  readBytes: readBytesAt,
  store: createFileStore(defaultConfigDir(process.env)),
  directory: createDirectoryStore(process.cwd()),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  version: manifest.success ? manifest.data.version : undefined,
});
