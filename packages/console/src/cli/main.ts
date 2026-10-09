#!/usr/bin/env node
import process from "node:process";
import { runCli } from "./cli.js";
import { createFileStore, defaultConfigDir } from "./credentials.js";
import { readFileAt, readSecret, readStdin } from "./terminal.js";

// The `console` command: the only place the command reads the process. Everything it does is in
// cli.ts, which takes what it needs and is what the tests run.

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
  store: createFileStore(defaultConfigDir(process.env)),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});
