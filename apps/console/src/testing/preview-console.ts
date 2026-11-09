import process from "node:process";
import { BROWSER_ADMIN, startBrowserConsole } from "./browser-console.js";
import { builtPluginAt, type PreviewArguments, parsePreviewArguments } from "./preview-plugins.js";

// The console on this machine for a person to look at the plugins' pages: the default UI, the
// example plugin enabled, the fixtures leave and gate installed for the settings pages to have
// a plugin to enable with its capabilities, board project, secrets and roles, and the built
// plugins of other checkouts named with --plugin <dir>, installed and not enabled, so that a
// plugin is looked at here without a provider; the plugins' hooks and jobs running in this
// process, so that a decision answered reaches the plugin and a job runs at its time; the
// fixture's people signing in from the browser at the addresses printed, and a database of its
// own that goes when this ends, unless --keep says to keep it for the next run.
// `pnpm dev:plugins`, which builds first; `--port <n>` for another port; `--public-url <origin>`
// for the address a tunnel reaches it at, so that a plugin receiving requests from outside is
// tried here. Not compiled.

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

let started: Awaited<ReturnType<typeof startBrowserConsole>>;
try {
  started = await startBrowserConsole({
    port: wanted.port ?? DEFAULT_PORT,
    databaseUrl: process.env.TEST_DATABASE_URL,
    env: process.env,
    plugins,
    publicUrl: wanted.publicUrl,
    keep: wanted.keep,
  });
} catch (error) {
  started = stop(reasonOf(error));
}
const lines = [
  `The console, with the example plugin enabled and the fixtures leave and gate installed: ${started.publicUrl}`,
  ...(wanted.publicUrl === undefined
    ? []
    : [
        `  listening on ${started.origin}, reached from outside at ${started.publicUrl}: the sign-in addresses below carry a secret of this run, since whoever reaches one signs in as that person, and what is typed into a plugin's page passes through the tunnel's provider.`,
      ]),
  `  sign in as ${BROWSER_ADMIN}, an administrator: ${started.signInUrl(BROWSER_ADMIN)}`,
  `  as a member: ${started.signInUrl("bob")} or ${started.signInUrl("carol")}`,
  ...plugins.map(
    (plugin) =>
      `  installed and not enabled, for ${BROWSER_ADMIN} to enable on the settings page: ${plugin.name} from ${plugin.dir}`,
  ),
  "  The plugins' hooks run here within seconds of an event, and their jobs on their schedule, as on a deployment.",
  wanted.keep
    ? "  Ctrl-C ends it; the database console_preview is kept, and --keep starts from it next time."
    : "  Ctrl-C ends it and drops its database.",
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
