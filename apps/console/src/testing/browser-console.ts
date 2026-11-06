import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_ROUTES, pluginPath } from "@skillcdn/console/api";
import { loadWebRoot } from "@skillcdn/console/web";
import { Hono } from "hono";
import { pino } from "pino";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { createSecrets } from "../auth/secrets.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL } from "../db/testing.js";
import type { AppEnv } from "../http/request-context.js";
import { startServer } from "../http/server.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginDispatcher } from "../plugins/dispatcher.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { RecordStore } from "../plugins/records.js";
import { Plugins } from "../plugins/registry.js";
import { PluginScheduler } from "../plugins/scheduler.js";
import { createFixtureProvider, type FixtureProvider } from "./fixture-provider.js";
import { createHarness, type Harness } from "./harness.js";
import {
  GATE_PLUGIN_DIR,
  HELLO_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  LEAVE_PLUGIN_DIR,
  writePluginsDir,
} from "./plugins.js";

// Test support: the console as a real browser meets it, listening on this machine with the
// default UI, the example plugin enabled, two of the fixtures installed and not enabled, the
// built plugins of other checkouts it was given the same way, the plugins' hooks and jobs
// running in this process as WORKER_IN_PROCESS runs them, and the fixture's people, who
// sign in from the browser. For what only a browser enforces of a plugin's frame
// (docs/specs/plugins.md, "The frame"), and for a person to look at the plugins' pages, the
// settings pages included: the fixtures ask capabilities, a board project, secrets and roles,
// which the example does not. Not compiled.

/** The build of the default UI, which `pnpm build` writes. */
const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));

/** The example plugin's package name, as PLUGINS_DIR names it. */
export const HELLO_PLUGIN_NAME = "console-plugin-hello";

/** The administrator among the fixture's people; the git host's other two are members. */
export const BROWSER_ADMIN = "alice";

/**
 * How often the plugins' hooks are dispatched and their jobs looked at here: sooner than a
 * deployment does (roles/api.ts), since nothing else runs on this machine and a plugin's author
 * is waiting to see the round close: the decision answered, the hook run, the record moved.
 */
export const PREVIEW_DISPATCH_INTERVAL_MS = 2_000;
export const PREVIEW_SCHEDULE_INTERVAL_MS = 15_000;

/** Where a browser begins signing in as one of the fixture's people. */
const FIXTURE_SIGN_IN = "/__fixture/sign-in";
/** Where the fixture's host would send the browser back from, answered here. */
const FIXTURE_AUTHORIZE = "/__fixture/authorize";

export interface BrowserConsoleOptions {
  /** The port to listen on; a free one when left out. */
  readonly port?: number | undefined;
  /** The server that makes this console's database, {@link DEV_DATABASE_URL} when left out. */
  readonly databaseUrl?: string | undefined;
  /** The process's environment, for what the plugin host needs of it on this platform. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * Built plugins of other checkouts, each laid out as the image lays a plugin out, installed
   * beside the fixtures under their package's name and not enabled: for a plugin's author to
   * look at its pages here, enabled on the settings page as the administrator.
   */
  readonly plugins?: readonly { readonly name: string; readonly dir: string }[] | undefined;
}

export interface BrowserConsole {
  /** Where it listens, `http://127.0.0.1:<port>`, which is also its PUBLIC_URL. */
  readonly origin: string;
  readonly harness: Harness;
  readonly plugins: Plugins;
  readonly provider: FixtureProvider;
  /**
   * The address a browser opens to sign in as one of the fixture's people: the round trip runs in
   * the browser, and ends on the front page. Without a person, a page that offers each of them.
   */
  signInUrl(person?: string): string;
  /** Stops listening, stops the plugins and drops the database. */
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Starts the console for a browser: a database of its own, the example plugin in a PLUGINS_DIR
 * of its own with its host, the `api` role with the default UI and the fixture provider, and
 * the two routes the browser's sign-in goes through in place of the fixture's host. The example
 * plugin is enabled for every project by the administrator before this answers.
 */
export async function startBrowserConsole(options: BrowserConsoleOptions): Promise<BrowserConsole> {
  const port = options.port ?? (await freePort());
  const origin = `http://127.0.0.1:${port}`;
  const web = await loadWebRoot(WEB_DIST).catch((error: unknown) => {
    throw new Error("the default UI is not built: run `pnpm build` first", { cause: error });
  });
  const testDatabase = await createTestDatabase(options.databaseUrl ?? DEV_DATABASE_URL);
  const root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-browser-")), [
    { name: HELLO_PLUGIN_NAME, dir: HELLO_PLUGIN_DIR },
    { name: "console-plugin-leave", dir: LEAVE_PLUGIN_DIR },
    { name: "console-plugin-gate", dir: GATE_PLUGIN_DIR },
    ...(options.plugins ?? []),
  ]);
  const logger = pino({ level: "warn" }, { write: () => {} });
  const holder: {
    current: Plugins | undefined;
    streams: { dispatcher: PluginDispatcher; scheduler: PluginScheduler } | undefined;
  } = { current: undefined, streams: undefined };
  const host = new PluginHost({
    entry: HOST_ENTRY,
    allowRead: await allowedReadRoots(root),
    env: hostEnvironment(options.env),
    logger,
    onContext: (call) =>
      holder.current === undefined
        ? Promise.reject(new Error("not started"))
        : holder.current.contextHandler(call),
  });
  try {
    const workspace = await ensureWorkspace(testDatabase.database, {
      name: "Acme",
      now: new Date(),
    });
    const clock = { now: () => new Date() };
    const plugins = new Plugins({
      database: testDatabase.database,
      workspace: async () => workspace,
      host,
      discovery: await discoverPlugins(root),
      memoryMb: 64,
      secrets: createSecrets("a secret for tests, long enough to be one"),
      records: new RecordStore({
        database: testDatabase.database,
        blobs: createPgBlobStore(testDatabase.database),
        clock,
        fileBytesAtMost: undefined,
      }),
      clock,
      logger,
      timeouts: { command: 5_000, query: 5_000, endpoint: 5_000, lifecycle: 5_000 },
    });
    holder.current = plugins;
    await host.start();
    await plugins.start();
    // The hooks and the jobs, in this process, so that what a plugin does when a decision is
    // answered, or on its schedule, is seen here and not only on a deployment.
    const dispatcher = new PluginDispatcher({
      database: testDatabase.database,
      workspace: async () => workspace,
      plugins,
      clock,
      logger,
    });
    const scheduler = new PluginScheduler({
      database: testDatabase.database,
      workspace: async () => workspace,
      plugins,
      clock,
      logger,
    });
    dispatcher.start(PREVIEW_DISPATCH_INTERVAL_MS);
    scheduler.start(PREVIEW_SCHEDULE_INTERVAL_MS);
    holder.streams = { dispatcher, scheduler };
    const provider = createFixtureProvider("gh", {
      authorize: () => `${origin}${FIXTURE_AUTHORIZE}`,
    });
    const harness = createHarness(testDatabase, {
      providers: [provider],
      admins: [BROWSER_ADMIN],
      plugins,
      origin,
      web,
    });
    const admin = await harness.signIn(BROWSER_ADMIN);
    // The members too, once each, so that the people the fixture knows are the workspace's
    // people before any of them signs in from the browser: someone to grant a role or to name
    // in a setting.
    await harness.signIn("bob");
    await harness.signIn("carol");
    const enabled = await harness.request(pluginPath("hello", "enable"), {
      method: "POST",
      headers: { cookie: admin, origin, "content-type": "application/json" },
      body: JSON.stringify({ consent: [], board: null, projects: "all" }),
    });
    if (enabled.status !== 200) {
      throw new Error(
        `the example plugin could not be enabled: ${enabled.status} ${await enabled.text()}`,
      );
    }

    // The browser's sign-in: who it is for, then the host's answer, then the console's own routes.
    // The console begins a sign-in from its own pages alone (sec-fetch-site), so the page of the
    // person is a page of this origin that goes on to the console's login itself.
    const outer = new Hono<AppEnv>();
    let pending: string | undefined;
    const people = Object.keys(provider.people);
    outer.get(FIXTURE_SIGN_IN, (c) =>
      c.html(
        `<!doctype html><meta charset="utf-8"><title>Sign in</title><h1>Sign in as</h1><ul>${people
          .map(
            (person) =>
              `<li><a href="${FIXTURE_SIGN_IN}/${person}">${person}${person === BROWSER_ADMIN ? " (administrator)" : ""}</a></li>`,
          )
          .join("")}</ul>`,
      ),
    );
    outer.get(`${FIXTURE_SIGN_IN}/:person`, (c) => {
      const person = c.req.param("person");
      if (!people.includes(person)) {
        return c.text(`the fixture knows nobody called ${person}`, 404);
      }
      pending = person;
      c.header("cache-control", "no-store");
      return c.html(
        `<!doctype html><meta charset="utf-8"><title>Signing in</title><p>Signing in as ${person}…</p><script>location.replace(${JSON.stringify(AUTH_ROUTES.login(provider.key))})</script>`,
      );
    });
    outer.get(FIXTURE_AUTHORIZE, (c) => {
      const state = c.req.query("state");
      const redirect = c.req.query("redirect_uri");
      if (state === undefined || redirect === undefined || pending === undefined) {
        return c.text("no sign-in was begun", 400);
      }
      const query = new URLSearchParams({ code: provider.codeFor(pending, state), state });
      return c.redirect(`${redirect}?${query}`);
    });
    outer.all("*", (c) => harness.app.fetch(c.req.raw, c.env));

    const server = await startServer({
      fetch: outer.fetch,
      host: "127.0.0.1",
      port,
      keepAliveMs: 5_000,
      requestTimeoutMs: 60_000,
      logger,
    });
    return {
      origin,
      harness,
      plugins,
      provider,
      signInUrl: (person) =>
        person === undefined
          ? `${origin}${FIXTURE_SIGN_IN}`
          : `${origin}${FIXTURE_SIGN_IN}/${encodeURIComponent(person)}`,
      async close() {
        await server.close(2_000);
        await dispatcher.close();
        await scheduler.close();
        await plugins.stop();
        await harness.close();
        await testDatabase.drop();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await holder.streams?.dispatcher.close().catch(() => undefined);
    await holder.streams?.scheduler.close().catch(() => undefined);
    await holder.current?.stop().catch(() => undefined);
    await testDatabase.drop().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
