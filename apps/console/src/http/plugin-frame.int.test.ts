import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pluginPath, restPluginDetailSchema } from "@skillcdn/console/api";
import { loadWebRoot } from "@skillcdn/console/web";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecrets } from "../auth/secrets.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { discoverPlugins } from "../plugins/discovery.js";
import { PluginHost } from "../plugins/host.js";
import { allowedReadRoots } from "../plugins/paths.js";
import { Plugins } from "../plugins/registry.js";
import { createFixtureProvider, type FixtureProvider } from "../testing/fixture-provider.js";
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
let provider: FixtureProvider;
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
  provider = createFixtureProvider("gh");
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
        "sandbox allow-scripts allow-forms",
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
    // A module script is fetched with CORS from the frame's opaque origin.
    expect(script.headers.get("access-control-allow-origin")).toBe("*");
    expect(script.headers.get("x-content-type-options")).toBe("nosniff");
    // A frame may go to a file of its bundle; there the frame's policy is gone, and this one holds.
    expect(script.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    // Every script begins by taking WebRTC out of wherever it runs, before a line of the plugin's.
    const served = await script.text();
    expect(served.startsWith('if(typeof globalThis!=="object")')).toBe(true);
    expect(served.split("\n").slice(1).join("\n").length).toBeGreaterThan(0);
    expect(Number(script.headers.get("content-length"))).toBe(
      new TextEncoder().encode(served).length,
    );
    const style = await h.request(`${AT}/web/${version}/index.css`);
    expect(style.status).toBe(200);
    expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await style.text()).not.toContain("globalThis");
    expect(style.headers.get("access-control-allow-origin")).toBe("*");
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
    expect(css.headers.get("access-control-allow-origin")).toBe("*");
    expect(await css.text()).toContain("--sc-color-info");
  });

  it("gives the frames the faces of the console's own build, their files served from here and nothing else", async () => {
    const dir = await mkdtemp(join(tmpdir(), "console-faces-"));
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(
      join(dir, "index.html"),
      '<!doctype html><html><head><link rel="icon" href="/favicon.svg"><link rel="stylesheet" crossorigin href="/assets/index-abc.css"></head><body><div id="root"></div></body></html>',
    );
    await writeFile(
      join(dir, "assets", "index-abc.css"),
      '@font-face{font-family:"Face";font-weight:45 920;src:url(/assets/face-abc.woff2) format("woff2");unicode-range:U+AC00-D7A3}.sc-x{color:red}@font-face{font-family:"Face";src:url("/assets/face-def.woff2")}',
    );
    await writeFile(join(dir, "assets", "face-abc.woff2"), "wOF2fake");
    const withWeb = createHarness(testDatabase, {
      providers: [provider],
      admins: ["alice"],
      plugins,
      web: await loadWebRoot(dir),
    });
    try {
      const faces = await withWeb.request("/api/v1/plugin-runtime/fonts.css");
      expect(faces.status).toBe(200);
      expect(faces.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(faces.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(faces.headers.get("access-control-allow-origin")).toBe("*");
      const text = await faces.text();
      expect(text).toContain('src:url(assets/face-abc.woff2) format("woff2")');
      expect(text).toContain('url("assets/face-def.woff2")');
      expect(text).not.toContain(".sc-x");
      const font = await withWeb.request("/api/v1/plugin-runtime/assets/face-abc.woff2");
      expect(font.status).toBe(200);
      expect(font.headers.get("content-type")).toBe("font/woff2");
      expect(font.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(font.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(font.headers.get("access-control-allow-origin")).toBe("*");
      expect(await font.text()).toBe("wOF2fake");
      // A font alone, of the build, by its name alone.
      for (const path of [
        "/api/v1/plugin-runtime/assets/index-abc.css",
        "/api/v1/plugin-runtime/assets/nothing.woff2",
        "/api/v1/plugin-runtime/assets/..%2Findex.html",
        "/api/v1/plugin-runtime/assets/",
      ]) {
        expect((await withWeb.request(path)).status, path).toBe(404);
      }
      // The frame links them before the console's stylesheet.
      const framed = await withWeb.request(`${AT}/frame?page=greetings`, {
        headers: { referer: `${SIGN_IN_URL}/plugins/hello/greetings` },
      });
      const html = await framed.text();
      expect(html.indexOf(`href="${SIGN_IN_URL}/api/v1/plugin-runtime/fonts.css"`)).toBeGreaterThan(
        0,
      );
      expect(html.indexOf("plugin-runtime/fonts.css")).toBeLessThan(
        html.indexOf("plugin-runtime/console.css"),
      );
    } finally {
      await withWeb.close();
      await rm(dir, { recursive: true, force: true });
    }
    // Without a build, the stylesheet is there and empty, and there are no files.
    const none = await h.request("/api/v1/plugin-runtime/fonts.css");
    expect(none.status).toBe(200);
    expect(await none.text()).toBe("");
    expect((await h.request("/api/v1/plugin-runtime/assets/face-abc.woff2")).status).toBe(404);
  });

  it("serves nothing of a plugin that is disabled, and a frame shows no answer meant for a program", async () => {
    expect((await h.request(pluginPath("hello", "disable"), json({}, admin))).status).toBe(200);
    const framed = await h.request(`${AT}/frame?page=greetings`, {
      headers: { referer: `${SIGN_IN_URL}/` },
    });
    expect(framed.status).toBe(404);
    expect(framed.headers.get("content-type")).toContain("text/html");
    const html = await framed.text();
    expect(html).not.toContain("plugin.not_found");
    expect(html).not.toContain("<link");
    // The one script it runs tells the console's page, by its hash; nothing else may run or load.
    const script = /<script>(.*)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).toContain('t:"unavailable"');
    const hash = createHash("sha256").update(script).digest("base64");
    expect(framed.headers.get("content-security-policy")).toBe(
      [
        "default-src 'none'",
        `script-src 'sha256-${hash}'`,
        `frame-ancestors ${SIGN_IN_URL}`,
        "base-uri 'none'",
        "form-action 'none'",
        "sandbox allow-scripts",
      ].join("; "),
    );
    expect((await h.request(`${AT}/web/${version}/index.js`)).status).toBe(404);
  });
});
