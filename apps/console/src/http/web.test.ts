import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWebRoot, type WebRoot, WebRootError } from "./web.js";

let root: string;
let web: WebRoot;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "console-web-"));
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><title>Console</title><div id=root></div>",
  );
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "index-abc123.js"), "console.log(1)");
  writeFileSync(join(root, "assets", "index-abc123.css"), "body{}");
  writeFileSync(join(root, "favicon.svg"), "<svg/>");
  web = await loadWebRoot(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const request = (path: string, init?: RequestInit) =>
  web.respond(new Request(`http://console.test${path}`, init));

describe("a web root", () => {
  it("serves the files it has, with their types, and bundles as immutable", async () => {
    expect(web.files).toBe(3);
    const script = await request("/assets/index-abc123.js");
    expect(script?.status).toBe(200);
    expect(script?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(script?.headers.get("cache-control")).toContain("immutable");
    expect(await script?.text()).toBe("console.log(1)");
    const icon = await request("/favicon.svg");
    expect(icon?.headers.get("content-type")).toBe("image/svg+xml");
    expect(icon?.headers.get("cache-control")).toBe("no-cache");
    const etag = script?.headers.get("etag") ?? "";
    const same = await request("/assets/index-abc123.js", { headers: { "if-none-match": etag } });
    expect(same?.status).toBe(304);
    const head = await request("/assets/index-abc123.js", { method: "HEAD" });
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
  });

  it("answers every path of the app with the page, under a policy that runs nothing inline", async () => {
    for (const path of [
      "/",
      "/tasks/0199c4d8-0000-7000-8000-000000000010",
      "/decisions",
      "/nothing/here",
    ]) {
      const page = await request(path);
      expect(page?.status, path).toBe(200);
      expect(page?.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(page?.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(page?.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(page?.headers.get("x-frame-options")).toBe("DENY");
      expect(await page?.text()).toContain("<title>Console</title>");
    }
  });

  it("leaves the API's paths, and anything but a read, to the server", async () => {
    for (const path of ["/api/v1/me", "/auth/gh/login", "/healthz", "/readyz", "/api/"]) {
      expect(await request(path), path).toBeUndefined();
    }
    expect(await request("/", { method: "POST" })).toBeUndefined();
  });

  it("serves nothing outside the directory, whatever the path spells", async () => {
    for (const path of [
      "/../index.html",
      "/assets/../../etc/passwd",
      "/%2e%2e/secret",
      "/index.html/../x",
    ]) {
      const answer = await request(path);
      // Either the page, or nothing: never a file from elsewhere.
      expect(
        answer === undefined || answer.headers.get("content-type") === "text/html; charset=utf-8",
        path,
      ).toBe(true);
    }
  });

  it("refuses a directory without a page", async () => {
    const empty = mkdtempSync(join(tmpdir(), "console-web-empty-"));
    try {
      await expect(loadWebRoot(empty)).rejects.toBeInstanceOf(WebRootError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
