import process from "node:process";
import { BROWSER_ADMIN, startBrowserConsole } from "./browser-console.js";
import { builtPluginAt, type PreviewArguments, parsePreviewArguments } from "./preview-plugins.js";

// The console on this machine for a person to look at the plugins' pages: the default UI, the
// example plugin enabled, the fixtures leave and gate installed for the settings pages to have
// a plugin to enable with its capabilities, board project, secrets and roles, and the built
// plugins of other checkouts named with --plugin <dir>, installed and not enabled, so that a
// plugin is looked at here without a provider; the fixture's people signing in from the
// browser at the addresses printed, and a database of its own that goes when this ends.
// `pnpm dev:plugins`, which builds first; `--port <n>` for another port. Not compiled.

const DEFAULT_PORT = 11200;

const stop = (message: string): never => {
  process.stderr.write(`${message}\n`);
  return process.exit(2);
};
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

let wanted: PreviewArguments;
try {
  wanted = parsePreviewArguments(process.argv.slice(2));
} catch (error) {
  wanted = stop(reasonOf(error));
}
const plugins: { readonly name: string; readonly dir: string }[] = [];
for (const dir of wanted.pluginDirs) {
  try {
    plugins.push(await builtPluginAt(dir, process.cwd()));
  } catch (error) {
    stop(reasonOf(error));
  }
}

const started = await startBrowserConsole({
  port: wanted.port ?? DEFAULT_PORT,
  databaseUrl: process.env.TEST_DATABASE_URL,
  env: process.env,
  plugins,
});
const lines = [
  `The console, with the example plugin enabled and the fixtures leave and gate installed: ${started.origin}`,
  `  sign in as ${BROWSER_ADMIN}, an administrator: ${started.signInUrl(BROWSER_ADMIN)}`,
  `  as a member: ${started.signInUrl("bob")} or ${started.signInUrl("carol")}`,
  ...plugins.map(
    (plugin) =>
      `  installed and not enabled, for ${BROWSER_ADMIN} to enable on the settings page: ${plugin.name} from ${plugin.dir}`,
  ),
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
