import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FetchLike } from "../client.js";
import { loadWebRoot, type WebRoot } from "../web.js";
import { createServeHandler, listenOn, type ServeHandler } from "./serve.js";

const UPSTREAM = "https://console.test";
const TOKEN = "cns_t_secret";
const PORT = 11197;
const AT = `http://127.0.0.1:${PORT}`;
const ME = { workspace: { name: "Acme" }, person: { login: "alice" }, agent: "my console" };

let dir: string;
let web: WebRoot;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "console-serve-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Mine</title><div id=root></div>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
  web = await loadWebRoot(dir);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly headers: Headers;
  readonly body: string;
}

/** The organization's console, as far as the command sees it: what was asked, and a few answers. */
function fakeConsole() {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = init?.body === undefined ? "" : await new Response(init.body as BodyInit).text();
    calls.push({ url, init, headers: new Headers(init?.headers), body });
    const path = new URL(url).pathname;
    if (path === "/api/v1/me") {
      return new Response(JSON.stringify(ME), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    if (path.endsWith("/events/stream")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("event: hello\n\n"));
          controller.enqueue(encoder.encode("data: 1\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "content-encoding": "gzip" },
      });
    }
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ got: JSON.parse(body) }), {
        status: 201,
        headers: { "content-type": "application/json", "set-cookie": "nope=1" },
      });
    }
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Nothing." } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

function handlerWith(fetch: FetchLike, withBuild = true): ServeHandler {
  return createServeHandler({
    upstream: `${UPSTREAM}/`,
    token: TOKEN,
    fetch,
    port: PORT,
    web: withBuild ? web : undefined,
  });
}

const fromPage = { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" };

describe("console serve", () => {
  it("carries the API to the console with the token, and nothing of the browser's session", async () => {
    const { fetch, calls } = fakeConsole();
    const handler = handlerWith(fetch);
    const answer = await handler(
      new Request(`${AT}/api/v1/me?x=1`, {
        headers: {
          ...fromPage,
          cookie: "console_session=cns_s_browser",
          authorization: "Bearer cns_t_wrong",
          referer: `${AT}/projects/web`,
          accept: "application/json",
          "accept-encoding": "gzip, br",
          "accept-language": "ko",
        },
      }),
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(ME);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(`${UPSTREAM}/api/v1/me?x=1`);
    expect(call?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call?.headers.get("accept-encoding")).toBe("identity");
    expect(call?.headers.get("accept")).toBe("application/json");
    expect(call?.headers.get("accept-language")).toBe("ko");
    for (const name of ["cookie", "referer", "sec-fetch-site", "sec-fetch-mode", "host"]) {
      expect(call?.headers.get(name), name).toBeNull();
    }
  });

  it("passes a body through, and an answer as it streams, without the loopback's cookies", async () => {
    const { fetch, calls } = fakeConsole();
    const handler = handlerWith(fetch);
    const made = await handler(
      new Request(`${AT}/api/v1/projects/web/tasks`, {
        method: "POST",
        headers: { ...fromPage, "content-type": "application/json" },
        body: JSON.stringify({ title: "From my own console" }),
      }),
    );
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({ got: { title: "From my own console" } });
    expect(made.headers.get("set-cookie")).toBeNull();
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.init?.method).toBe("POST");

    const stream = await handler(
      new Request(`${AT}/api/v1/projects/web/events/stream?after=0`, { headers: fromPage }),
    );
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    expect(stream.headers.get("content-encoding")).toBeNull();
    expect(await stream.text()).toBe("event: hello\n\ndata: 1\n\n");
  });

  it("refuses another site's page, and another name for this machine", async () => {
    const { fetch, calls } = fakeConsole();
    const handler = handlerWith(fetch);
    const refused = async (init: RequestInit, host = `127.0.0.1:${PORT}`) =>
      handler(new Request(`http://${host}/api/v1/me`, init));
    // A page of another site, with the person's standing: no.
    expect((await refused({ headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect(
      (await refused({ headers: { "sec-fetch-site": "same-site" }, method: "POST" })).status,
    ).toBe(403);
    // A browser too old to say which site, naming another origin: no.
    expect((await refused({ headers: { origin: "http://evil.example" } })).status).toBe(403);
    // A name made to resolve here: no, whatever it asks.
    const elsewhere = await refused({ headers: fromPage }, `evil.example:${PORT}`);
    expect(elsewhere.status).toBe(421);
    expect(calls).toHaveLength(0);
    // The person's own page, a request typed into the browser, a program with no page at all,
    // and the loopback by its other name: yes.
    expect((await refused({ headers: fromPage })).status).toBe(200);
    expect((await refused({ headers: { "sec-fetch-site": "none" } })).status).toBe(200);
    expect((await refused({})).status).toBe(200);
    expect((await refused({ headers: fromPage }, `localhost:${PORT}`)).status).toBe(200);
    expect(calls).toHaveLength(4);
  });

  it("serves the build's page and files beside the API, and nothing without a build", async () => {
    const { fetch } = fakeConsole();
    const handler = handlerWith(fetch);
    const page = await handler(new Request(`${AT}/projects/web/tasks/7`));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(await page.text()).toContain("<title>Mine</title>");
    const script = await handler(new Request(`${AT}/assets/index-abc123.js`));
    expect(script.status).toBe(200);
    expect(script.headers.get("cache-control")).toContain("immutable");
    // Signing in is the organization's console's, not here.
    expect((await handler(new Request(`${AT}/auth/gh/login`))).status).toBe(404);

    const bare = handlerWith(fetch, false);
    const nothing = await bare(new Request(`${AT}/`));
    expect(nothing.status).toBe(404);
    expect(await nothing.text()).toContain("Nothing is served here but the API");
    expect((await bare(new Request(`${AT}/api/v1/me`, { headers: fromPage }))).status).toBe(200);
  });

  it("listens on the loopback, and answers over HTTP what the handler answers", async () => {
    const { fetch, calls } = fakeConsole();
    const listening = await listenOn(
      (port) => createServeHandler({ upstream: UPSTREAM, token: TOKEN, fetch, port, web }),
      0,
    );
    try {
      expect(listening.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const page = await globalThis.fetch(listening.url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<title>Mine</title>");
      const me = await globalThis.fetch(`${listening.url}api/v1/me`);
      expect(me.status).toBe(200);
      expect(await me.json()).toEqual(ME);
      expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      const made = await globalThis.fetch(`${listening.url}api/v1/projects/web/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Over the wire" }),
      });
      expect(made.status).toBe(201);
      expect(await made.json()).toEqual({ got: { title: "Over the wire" } });
      const head = await globalThis.fetch(listening.url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      // A name made to resolve here, as a browser would send it: refused on the wire too.
      const elsewhere = await new Promise<number>((resolve, reject) => {
        const url = new URL(`${listening.url}api/v1/me`);
        const sent = request(
          {
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: { host: "evil.example" },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        sent.on("error", reject);
        sent.end();
      });
      expect(elsewhere).toBe(421);
    } finally {
      await listening.close();
    }
    await listening.closed;
  });
});
