import process from "node:process";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_ADMIN,
  type BrowserConsole,
  startBrowserConsole,
} from "../testing/browser-console.js";

// The header over a page as it scrolls: what stands in front of what comes of every rule on the
// way up from an element, and only a browser works it out.

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

/**
 * Scrolls the title of a task across days to the middle of the header and says what stands in front
 * of it there; the title takes no pointer, so it is made to for the browser to find it at all.
 */
const IN_FRONT_OF_THE_TITLE = `(() => {
  const header = document.querySelector(".sc-header");
  const title = document.querySelector(".sc-calendar-task-title-spanning");
  window.scrollBy(0, title.getBoundingClientRect().top - header.offsetHeight / 2);
  title.style.pointerEvents = "auto";
  const box = title.getBoundingClientRect();
  const found = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return found?.closest(".sc-header, .sc-calendar-task-title-spanning")?.className;
})()`;

describe("the header over a page", () => {
  it("has a task's title on the week pass under it as the page scrolls", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1280, height: 280 },
    });
    const page = await context.newPage();
    await page.goto(console_.signInUrl(BROWSER_ADMIN));
    await page.waitForURL((url) => url.origin === console_.origin && url.pathname === "/");
    await page.evaluate(async () => {
      const headers = { "content-type": "application/json" };
      const me = (await (await fetch("/api/v1/me")).json()) as {
        readonly person: { readonly id: string };
      };
      await fetch("/api/v1/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ key: "week", name: "Week" }),
      });
      // Three days to each side of today: more than one day of whichever week today is in.
      const day = (offset: number) =>
        new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      await fetch("/api/v1/projects/week/tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Across the week",
          state: "in_progress",
          workerIds: [me.person.id],
          startsOn: day(-3),
          dueOn: day(3),
        }),
      });
    });
    await page.goto(`${console_.origin}/work`);
    await page.waitForSelector(".sc-calendar-task-title-spanning");

    expect(await page.evaluate(IN_FRONT_OF_THE_TITLE)).toBe("sc-header");
    await context.close();
  });
});
