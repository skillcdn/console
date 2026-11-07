import process from "node:process";
import { type Browser, chromium, type Frame, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_ADMIN,
  type BrowserConsole,
  startBrowserConsole,
} from "../testing/browser-console.js";

// A plugin's pages as a real browser has them (ADR-0054, docs/specs/plugins.md, "The frame" and
// "The bridge"): what plugin-frame.int.test.ts proves of the headers, the browser is seen to
// enforce. The example plugin's page and widget work through the bridge alone, and from inside
// the frame nothing else gets through: no request, no cookie, no reach into the console's page,
// no call the bridge does not know. Needs PostgreSQL, the build, and the Chromium of Playwright
// (`pnpm --filter @skillcdn/console-app exec playwright install chromium`); `pnpm test:browser`,
// apart from `pnpm check`.

let console_: BrowserConsole;
let browser: Browser;
/** Every request a page of the browser made, by its address. */
const requests: string[] = [];
/** Every answer of 400 or above a page of the browser got, with its body, to say what went wrong. */
const troubles: string[] = [];
/** What the pages and the frames wrote to the browser's console, for the same. */
const logs: string[] = [];

/** What a test can say when the frame did not come to what was expected. */
async function sayWhy(frame: Frame, error: unknown): Promise<never> {
  const seen = (await frame.evaluate("document.body.innerText").catch(() => "")) as string;
  const ofPlugins = requests.filter((url) => url.includes("/api/v1/plugins/")).slice(-12);
  throw new Error(
    [
      String(error),
      `the frame shows: ${seen.slice(0, 500)}`,
      `answers of 400 and above: ${troubles.join("\n  ") || "none"}`,
      `the browser's console: ${logs.join("\n  ") || "nothing"}`,
      `the last requests to plugins: ${ofPlugins.join("\n  ")}`,
    ].join("\n"),
  );
}

beforeAll(async () => {
  console_ = await startBrowserConsole({
    databaseUrl: process.env.TEST_DATABASE_URL,
    env: process.env,
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await console_?.close();
});

/** A page of a browser of its own, in English whatever the machine speaks, signed in as the person through the fixture's round trip. */
async function signedIn(person: string): Promise<Page> {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  page.on("request", (request) => {
    requests.push(request.url());
  });
  page.on("console", (message) => {
    logs.push(`${message.type()}: ${message.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => {
    logs.push(`error: ${error.message.slice(0, 300)}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      void response
        .text()
        .catch(() => "")
        .then((body) => {
          troubles.push(`${response.status()} ${response.url()} ${body.slice(0, 300)}`);
        });
    }
  });
  await page.goto(console_.signInUrl(person));
  await page.waitForURL((url) => url.origin === console_.origin && url.pathname === "/");
  return page;
}

/** The frame the element holds, once it is on the page. */
async function frameOf(page: Page, selector: string): Promise<Frame> {
  const element = await page.waitForSelector(selector);
  const frame = await element.contentFrame();
  if (frame === null) {
    throw new Error(`${selector} holds no frame`);
  }
  return frame;
}

/** An expression evaluated in the frame: its value, or the name of the error it threw. */
const attempt = (expression: string): string =>
  `(() => { try { return String(${expression}); } catch (error) { return error instanceof Error ? error.name : String(error); } })()`;

/** A fetch from inside the frame: what answered, or the name of the error it threw. */
const fetchFrom = (url: string): string =>
  `fetch(${JSON.stringify(url)}).then(() => "answered", (error) => (error instanceof Error ? error.name : String(error)))`;

/** What the page tells a frame that says it is ready, of the workspace. */
const WORKSPACE_TOLD = `new Promise((resolve) => {
  window.addEventListener("message", (event) => {
    if (event.data !== null && typeof event.data === "object" && event.data.t === "init") {
      resolve(event.data.workspace);
    }
  });
  window.parent.postMessage({ v: 1, t: "ready" }, "*");
})`;

/**
 * Two calls over the bridge from inside the frame: one of its methods, and one it does not know.
 * What came back for each, or "ignored" when nothing did within two seconds.
 */
const BRIDGE_CALLS = `new Promise((resolve) => {
  const ids = { known: "known-" + Date.now(), unknown: "unknown-" + Date.now() };
  const results = {};
  const onMessage = (event) => {
    const data = event.data;
    if (data === null || typeof data !== "object" || data.t !== "result") return;
    for (const [name, id] of Object.entries(ids)) {
      if (data.id === id) results[name] = data.ok === true ? "performed" : "refused:" + String(data.error && data.error.code);
    }
  };
  window.addEventListener("message", onMessage);
  window.parent.postMessage({ v: 1, t: "call", id: ids.known, method: "query", params: { name: "latest", args: { limit: 1 } } }, "*");
  window.parent.postMessage({ v: 1, t: "call", id: ids.unknown, method: "fetch", params: { url: "/api/v1/me" } }, "*");
  setTimeout(() => {
    window.removeEventListener("message", onMessage);
    resolve({ known: results.known ?? "ignored", unknown: results.unknown ?? "ignored" });
  }, 2000);
})`;

/** How far the frame stands outside the page's column. Text, as this workspace has no types of a page. */
const FRAME_OUTSIDE_THE_COLUMN = `(() => {
  const main = document.querySelector("#sc-content");
  const column = main.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(main).paddingLeft);
  return column - document.querySelector(".sc-plugin-frame").getBoundingClientRect().left;
})()`;

describe("the example plugin in a browser", () => {
  it("shows its page in a frame, works it through the bridge alone, and the widget follows", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    await page.goto(`${console_.origin}/plugins/hello/greetings`);
    const frame = await frameOf(page, "iframe.sc-plugin-frame");
    await frame.waitForSelector("text=Nobody has been greeted yet.");
    // A page pads itself by a step, which its frame takes back, so that it lines up with the tabs.
    expect(await page.evaluate(FRAME_OUTSIDE_THE_COLUMN)).toBe(16);
    // The console's theme reached the frame with `init`: its tokens are on the frame's root.
    expect(
      await frame.evaluate(
        'getComputedStyle(document.documentElement).getPropertyValue("--sc-color-text").trim()',
      ),
    ).not.toBe("");
    // The frame reads in the console's own faces: the Korean one the build carries is there.
    expect(
      await frame.evaluate(
        'document.fonts.load(\'1em "Pretendard Variable"\', "가").then((faces) => faces.length)',
      ),
    ).toBeGreaterThan(0);
    // It paints no background of its own and is as tall as its content, within the console's box.
    expect(await frame.evaluate("getComputedStyle(document.body).backgroundColor")).toBe(
      "rgba(0, 0, 0, 0)",
    );
    await frame.fill("input.sc-input", "Bob");
    await frame.click("button.sc-button");
    // The greeting, or the refusal the page shows in its place, with what the console answered.
    const outcome = await frame
      .waitForSelector(".pl-hello-greeting, .pl-hello-error")
      .catch((error: unknown) => sayWhy(frame, error));
    expect(
      await outcome.getAttribute("class"),
      `${await outcome.textContent()}\n${troubles.join("\n")}`,
    ).toBe("pl-hello-greeting");
    expect(await frame.textContent(".pl-hello-text")).toBe("Hello, Bob!");
    expect(await frame.textContent(".pl-hello-by")).toBe("by Alice");
    // Every request the bridge made on the frame's behalf went to the plugin's own routes.
    const ofPlugins = requests
      .map((url) => new URL(url).pathname)
      .filter((path) => path.startsWith("/api/v1/plugins/"));
    expect(ofPlugins.length).toBeGreaterThan(0);
    expect(ofPlugins.filter((path) => !path.startsWith("/api/v1/plugins/hello/"))).toEqual([]);
    // The widget on the front page shows the latest greeting.
    await page.goto(`${console_.origin}/`);
    const widget = await frameOf(page, "iframe.sc-plugin-frame-widget");
    await widget.waitForSelector(".pl-hello-text");
    expect(await widget.textContent(".pl-hello-text")).toBe("Hello, Bob!");
    // The widget's frame fills the cells its size gives it (ADR-0059), a row of the grid, and
    // not the one line it asks for: the height it says is not read.
    expect(await widget.evaluate("document.documentElement.clientHeight")).toBeGreaterThan(120);
    // The administrator's Settings page lists the plugin, as the plugins' own page does, and the
    // plugin's page says what it is. Its tab comes before Settings.
    await page.goto(`${console_.origin}/settings`);
    await page.waitForSelector("text=hello 0.1.0");
    const tabs = (await page.$$eval("nav a", (links) =>
      links.map((link) => link.textContent?.trim() ?? ""),
    )) as string[];
    expect(tabs.indexOf("Hello")).toBeGreaterThan(-1);
    expect(tabs.indexOf("Hello")).toBeLessThan(tabs.indexOf("Settings"));
    await page.goto(`${console_.origin}/settings/plugins`);
    await page.waitForSelector("text=hello 0.1.0");
    await page.goto(`${console_.origin}/settings/plugins/hello`);
    await page.waitForSelector("text=Greetings kept as records");
    // Its one role is the default one: every member's, which the roles say without a grant.
    await page.waitForSelector("text=Every member");
    await page.context().close();
  });

  it("lets nothing but the bridge out of the frame", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    await page.goto(`${console_.origin}/plugins/hello/greetings`);
    const frame = await frameOf(page, "iframe.sc-plugin-frame");
    await frame.waitForSelector(".pl-hello-page");
    // The frame's origin is opaque, and the console's page is out of its reach.
    expect(await frame.evaluate("window.origin")).toBe("null");
    expect(await frame.evaluate(attempt("window.top.location.href"))).toBe("SecurityError");
    expect(await frame.evaluate(attempt("window.top.document.title"))).toBe("SecurityError");
    // The cookie and the storage of the console's origin are not the frame's to read.
    expect(await frame.evaluate(attempt("document.cookie"))).toBe("SecurityError");
    expect(await frame.evaluate(attempt("localStorage.length"))).toBe("SecurityError");
    // No request leaves it: not to the console, not to another plugin, not elsewhere.
    for (const url of [
      "/api/v1/me",
      `${console_.origin}/api/v1/plugins/other/invoke`,
      "https://example.com/",
    ]) {
      expect(await frame.evaluate(fetchFrom(url))).toBe("TypeError");
    }
    // The bridge performs its own methods, and a call it does not know is dropped unanswered.
    expect(await frame.evaluate(BRIDGE_CALLS)).toEqual({ known: "performed", unknown: "ignored" });
    // A frame is told the workspace, with the day its week begins on worked out for it.
    expect(await frame.evaluate(WORKSPACE_TOLD)).toEqual({
      timeZone: expect.any(String),
      weekStart: "auto",
      firstDay: expect.any(Number),
    });
    await page.context().close();
  });

  it("says in the console's words that a frame has nothing to show, and shows no answer meant for a program", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    // The page reads a widget the plugin does not have, as a page that read the plugins a while
    // ago reads one that was turned off since.
    await page.route("**/api/v1/plugins", async (route) => {
      const response = await route.fetch();
      const plugins = (await response.json()) as {
        items: { key: string; widgets: Record<string, unknown>[] }[];
      };
      for (const plugin of plugins.items) {
        if (plugin.key === "hello") {
          plugin.widgets.push({
            key: "gone",
            name: { en: "Gone" },
            place: "home:top",
            size: "third",
            sizes: ["small"],
            defaultSize: "small",
          });
        }
      }
      await route.fulfill({ response, json: plugins });
    });
    await page.goto(`${console_.origin}/`);
    await page.waitForSelector(".sc-plugin-frame-unavailable");
    expect(await page.textContent(".sc-plugin-frame-unavailable")).toBe(
      "This can't be shown right now.",
    );
    await page.context().close();
  });

  it("serves the frame to the console's own pages alone: opened as a page of its own, it is not found", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(
      `${console_.origin}/api/v1/plugins/hello/frame?page=greetings`,
    );
    expect(response?.status()).toBe(404);
    await context.close();
  });
});
