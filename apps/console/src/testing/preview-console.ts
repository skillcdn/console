import process from "node:process";
import { BROWSER_ADMIN, startBrowserConsole } from "./browser-console.js";

// The console on this machine for a person to look at the plugins' pages: the default UI, the
// example plugin enabled, the fixture's people signing in from the browser at the addresses
// printed, and a database of its own that goes when this ends. `pnpm dev:plugins`, which builds
// first; `--port <n>` for another port. Not compiled.

const DEFAULT_PORT = 11200;

function portOf(argv: readonly string[]): number {
  const at = argv.indexOf("--port");
  const value = at === -1 ? undefined : argv[at + 1];
  const port = value === undefined ? DEFAULT_PORT : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`--port takes a port number, not ${String(value)}`);
  }
  return port;
}

const started = await startBrowserConsole({
  port: portOf(process.argv.slice(2)),
  databaseUrl: process.env.TEST_DATABASE_URL,
  env: process.env,
});
const lines = [
  `The console, with the example plugin enabled: ${started.origin}`,
  `  sign in as ${BROWSER_ADMIN}, an administrator: ${started.signInUrl(BROWSER_ADMIN)}`,
  `  as a member: ${started.signInUrl("bob")} or ${started.signInUrl("carol")}`,
  "  Ctrl-C ends it and drops its database.",
];
process.stdout.write(`${lines.join("\n")}\n`);

let ending = false;
const end = (): void => {
  if (ending) {
    return;
  }
  ending = true;
  void started.close().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exit(1);
    },
  );
};
process.on("SIGINT", end);
process.on("SIGTERM", end);
