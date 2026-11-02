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
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { RecordStore } from "../plugins/records.js";
import { Plugins } from "../plugins/registry.js";
import { createFixtureProvider, type FixtureProvider } from "./fixture-provider.js";
import { createHarness, type Harness } from "./harness.js";
import { HELLO_PLUGIN_DIR, HOST_ENTRY, hostEnvironment, writePluginsDir } from "./plugins.js";

// Test support: the console as a real browser meets it, listening on this machine with the
// default UI, the example plugin enabled, and the fixture's people, who sign in from the
// browser. For what only a browser enforces of a plugin's frame (docs/specs/plugins.md, "The
// frame"), and for a person to look at the plugins' pages. Not compiled.

/** The build of the default UI, which `pnpm build` writes. */
const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));

/** The example plugin's package name, as PLUGINS_DIR names it. */
export const HELLO_PLUGIN_NAME = "console-plugin-hello";

/** The administrator among the fixture's people; the git host's other two are members. */
export const BROWSER_ADMIN = "alice";

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
  ]);
  const logger = pino({ level: "warn" }, { write: () => {} });
  const holder: { current: Plugins | undefined } = { current: undefined };
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
        await plugins.stop();
        await harness.close();
        await testDatabase.drop();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await holder.current?.stop().catch(() => undefined);
    await testDatabase.drop().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
