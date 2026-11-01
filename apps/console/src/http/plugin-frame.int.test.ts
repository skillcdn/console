import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pluginPath, restPluginDetailSchema } from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecrets } from "../auth/secrets.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { Plugins } from "../plugins/registry.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  HELLO_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  writePluginsDir,
} from "../testing/plugins.js";

// A plugin's pages as the console serves them (ADR-0054, docs/specs/plugins.md, "The frame"):
// the frame document under its own policy, for the console's own pages and a person's own console
// alone; the bundle's files, immutable and readable across origins; the console's stylesheet for
// frames. Needs PostgreSQL, the compiled host and the example plugin built.

let testDatabase: TestDatabase;
let root: string;
let plugins: Plugins;
let h: Harness;
let admin: string;
let version: string;
const AT = pluginPath("hello");

const json = (body: unknown, cookie: string): RequestInit => ({
  method: "POST",
  headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugin-frame-")), [
    { name: "console-plugin-hello", dir: HELLO_PLUGIN_DIR },
  ]);
  const logger = pino({ level: "warn" }, { write: () => {} });
  const holder: { current: Plugins | undefined } = { current: undefined };
  const host = new PluginHost({
    entry: HOST_ENTRY,
    allowRead: await allowedReadRoots(root),
    env: hostEnvironment(process.env),
    logger,
    onContext: (call) =>
      holder.current === undefined
        ? Promise.reject(new Error("not started"))
        : holder.current.contextHandler(call),
  });
  const provider = createFixtureProvider("gh");
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"] });
  admin = await h.signIn("alice");
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  plugins = new Plugins({
    database: testDatabase.database,
    workspace: async () => workspace,
    host,
    discovery: await discoverPlugins(root),
    memoryMb: 64,
    secrets: createSecrets("a secret for tests, long enough to be one"),
    clock: { now: () => new Date() },
    logger,
    timeouts: { command: 5_000, query: 5_000, lifecycle: 5_000 },
  });
  holder.current = plugins;
  await host.start();
  await plugins.start();
  h = createHarness(testDatabase, { providers: [provider], admins: ["alice"], plugins });
  const enabled = await h.request(
    pluginPath("hello", "enable"),
    json({ consent: [], board: null, projects: "all" }, admin),
  );
  expect(enabled.status).toBe(200);
  version = restPluginDetailSchema.parse(await enabled.json()).version;
}, 120_000);

afterAll(async () => {
  await plugins?.stop();
  await h?.close();
  await testDatabase?.drop();
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("the frame of a plugin's page", () => {
  it("is a document of the console's with its own policy, for the console's own pages and a loopback alone, with no session", async () => {
    const framed = await h.request(`${AT}/frame?page=greetings`, {
      headers: { referer: `${SIGN_IN_URL}/plugins/hello/greetings` },
    });
    expect(framed.status).toBe(200);
    expect(framed.headers.get("content-type")).toContain("text/html");
    const web = `${SIGN_IN_URL}${AT}/web/`;
    const runtime = `${SIGN_IN_URL}/api/v1/plugin-runtime/`;
    expect(framed.headers.get("content-security-policy")).toBe(
      [
        "default-src 'none'",
        `script-src ${web}`,
        `style-src ${web} ${runtime}`,
        `img-src ${web} data: blob:`,
        `font-src ${web} ${runtime}`,
        "connect-src 'none'",
        `frame-ancestors ${SIGN_IN_URL}`,
        "base-uri 'none'",
        "form-action 'none'",
        "sandbox allow-scripts",
      ].join("; "),
    );
    expect(framed.headers.get("referrer-policy")).toBe("no-referrer");
    expect(framed.headers.get("x-content-type-options")).toBe("nosniff");
    expect(framed.headers.get("cache-control")).toBe("no-store");
    const html = await framed.text();
    expect(html).toContain(`data-console="${SIGN_IN_URL}"`);
    expect(html).toContain('data-plugin="hello"');
    expect(html).toContain('data-page="greetings"');
    expect(html).toContain(`src="${SIGN_IN_URL}${AT}/web/${version}/index.js"`);
    expect(html).toContain(`href="${SIGN_IN_URL}${AT}/web/${version}/index.css"`);
    expect(html).toContain(`href="${SIGN_IN_URL}/api/v1/plugin-runtime/console.css"`);
    // A widget's frame says which widget; a person's own console on this machine may embed one too.
    const widget = await h.request(`${AT}/frame?widget=latest`, {
      headers: { referer: "http://localhost:4174/" },
    });
    expect(widget.status).toBe(200);
    expect(await widget.text()).toContain(
      'data-console="http://localhost:4174" data-plugin="hello" data-widget="latest"',
    );
    expect(widget.headers.get("content-security-policy")).toContain(
      "frame-ancestors http://localhost:4174",
    );
    // Nobody else embeds it: no referer, another origin, a page the plugin has not, both at once.
    for (const [path, headers] of [
      [`${AT}/frame?page=greetings`, {}],
      [`${AT}/frame?page=greetings`, { referer: "https://elsewhere.example/" }],
      [`${AT}/frame?page=nothing`, { referer: `${SIGN_IN_URL}/` }],
      [`${AT}/frame?page=greetings&widget=latest`, { referer: `${SIGN_IN_URL}/` }],
      [`${AT}/frame`, { referer: `${SIGN_IN_URL}/` }],
      [`${pluginPath("nothing", "frame")}?page=greetings`, { referer: `${SIGN_IN_URL}/` }],
    ] as const) {
      const refused = await h.request(path, { headers });
      expect(refused.status, path).toBe(404);
    }
  });

  it("serves the bundle's files under their version, immutable and readable across origins, and nothing outside", async () => {
    const script = await h.request(`${AT}/web/${version}/index.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(script.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(script.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(script.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await script.text()).length).toBeGreaterThan(0);
    const style = await h.request(`${AT}/web/${version}/index.css`);
    expect(style.status).toBe(200);
    expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8");
    for (const path of [
      `${AT}/web/0.0.0-other/index.js`,
      `${AT}/web/${version}/nothing.js`,
      `${AT}/web/${version}/..%2F..%2Fpackage.json`,
      `${AT}/web/${version}/../package.json`,
      `${AT}/web/${version}/`,
    ]) {
      const refused = await h.request(path);
      expect(refused.status, path).toBe(404);
    }
  });

  it("serves the console's stylesheet for the frames", async () => {
    const css = await h.request("/api/v1/plugin-runtime/console.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(await css.text()).toContain("--sc-color-info");
  });

  it("serves nothing of a plugin that is disabled", async () => {
    expect((await h.request(pluginPath("hello", "disable"), json({}, admin))).status).toBe(200);
    const framed = await h.request(`${AT}/frame?page=greetings`, {
      headers: { referer: `${SIGN_IN_URL}/` },
    });
    expect(framed.status).toBe(404);
    expect((await h.request(`${AT}/web/${version}/index.js`)).status).toBe(404);
  });
});
