import process from "node:process";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_ADMIN,
  type BrowserConsole,
  startBrowserConsole,
} from "../testing/browser-console.js";

// The invitation of an agent account as a browser meets it (ADR-0088): made under the account by
// a supervisor, its line shown once, and the guide its code opens read by a browser that is
// signed in nowhere. That the page stands before the sign-in is the console's composition, which
// only a page with its data shows; what the code opens and to whom, the integration tests prove.

let console_: BrowserConsole;
let browser: Browser;

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

async function newPage(): Promise<Page> {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  return context.newPage();
}

/** An agent account with the project it starts in, made as the administrator on this page. */
async function agentMade(page: Page): Promise<void> {
  const made = await page.evaluate(async () => {
    const post = (path: string, body: unknown) =>
      fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    await post("/api/v1/projects", { key: "ops", name: "Operations" });
    const answer = await post("/api/v1/agents", {
      host: "gh",
      login: "dana",
      handle: "mira",
      name: "Mira",
      title: "Release engineer",
      project: "ops",
    });
    return answer.status;
  });
  expect(made).toBe(201);
}

describe("the invitation that leads a machine to an agent account", () => {
  it("is made under the account, and its code opens the guide to a browser signed in nowhere", async () => {
    const page = await newPage();
    await page.goto(console_.signInUrl(BROWSER_ADMIN));
    await page.waitForURL((url) => url.origin === console_.origin && url.pathname === "/");
    await agentMade(page);

    await page.goto(`${console_.origin}/agents/mira/settings`);
    await page.click("text=Make an invitation");
    const line = page.locator(".sc-agent-invitation .sc-copyable .sc-code").first();
    await line.waitFor();
    const said = (await line.textContent()) ?? "";
    const code = /--code ([A-Z0-9]{4}-[A-Z0-9]{4}) /.exec(said)?.[1] ?? "";
    expect(said).toBe(
      `Run: console agent setup --console ${console_.origin} --code ${code} (before it: npm i -g @skillcdn/console), then do what it prints`,
    );
    expect(code).not.toBe("");
    const guide = await page.getAttribute(".sc-agent-invitation .sc-callout a", "href");
    expect(guide).toBe(`/setup/${code}`);

    // Read again, the page says that one stands, and the code is nowhere on it.
    await page.reload();
    await page.waitForSelector("text=An invitation stands until");
    expect(await page.textContent(".sc-main")).not.toContain(code);

    // A browser that is signed in nowhere reads the guide, and is asked for no sign-in.
    const stranger = await newPage();
    await stranger.goto(`${console_.origin}/setup/${code}`);
    await stranger.waitForSelector(".sc-setup");
    const seen = (await stranger.textContent(".sc-main")) ?? "";
    expect(seen).toContain("Setting up @mira (Mira, Release engineer)");
    expect(seen).toContain("signs in there as dana through GitHub");
    expect(seen).toContain("It makes the machine the agent's");
    expect(seen).toContain("console agent setup --refresh");
    expect(seen).toContain(said);
    expect(await stranger.locator(".sc-sign-in").count()).toBe(0);
    expect(await stranger.locator(".sc-header").count()).toBe(0);

    // A code that opens nothing says only that, to anyone.
    await stranger.goto(`${console_.origin}/setup/WXYZ-2345`);
    await stranger.waitForSelector("text=No setup is here");
    expect(await stranger.locator(".sc-setup").count()).toBe(0);

    // Taken away, the code that was read a moment ago opens nothing either.
    await page.click("text=Take it away");
    await page.waitForSelector("text=No invitation stands.");
    await stranger.goto(`${console_.origin}/setup/${code}`);
    await stranger.waitForSelector("text=No setup is here");

    await stranger.context().close();
    await page.context().close();
  });
});
