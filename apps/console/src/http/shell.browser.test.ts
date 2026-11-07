import process from "node:process";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_ADMIN,
  type BrowserConsole,
  startBrowserConsole,
} from "../testing/browser-console.js";

// The header over the pages as they scroll: what stands in front of what comes of every rule on
// the way up from an element, and only a browser works it out. Everything of a page passes under
// the header; what a person is holding or has opened over the page is not a part of it, and is
// not looked at here.

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
 * Scrolls the page from top to end and says what the browser finds in the header's place that is
 * not the header; everything on the page is made to take the pointer first, or what takes none,
 * as a title along a bar does, would not be found.
 */
const IN_FRONT_OF_THE_HEADER = `(() => {
  const header = document.querySelector(".sc-header");
  for (const element of document.querySelectorAll(".sc-main *")) {
    element.style.pointerEvents = "auto";
  }
  const { width, height } = header.getBoundingClientRect();
  const room = document.documentElement.scrollHeight - window.innerHeight;
  const found = new Set();
  for (let top = 0; top < room + 20; top += 20) {
    window.scrollTo({ top, behavior: "instant" });
    for (let x = 6; x < width; x += 24) {
      for (let y = 3; y < height; y += 10) {
        const element = document.elementFromPoint(x, y);
        if (element !== null && !header.contains(element)) {
          found.add(element.getAttribute("class") ?? element.tagName);
        }
      }
    }
  }
  return [...found];
})()`;

/** A project with a goal and a task across days, on the person's plate; answers their ids. */
async function seeded(page: Page) {
  return await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await response.json()) as { readonly id: string };
    };
    const me = (await (await fetch("/api/v1/me")).json()) as {
      readonly person: { readonly id: string };
    };
    await post("/api/v1/projects", { key: "week", name: "Week" });
    // Three days to each side of today: more than one day of whichever week today is in.
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const plan = { startsOn: day(-3), dueOn: day(3) };
    const goal = await post("/api/v1/projects/week/goals", { title: "The month", ...plan });
    await post("/api/v1/projects/week/tasks", {
      title: "Across the week",
      state: "in_progress",
      workerIds: [me.person.id],
      goalId: goal.id,
      ...plan,
    });
    return { person: me.person.id, goal: goal.id };
  });
}

describe("the header over the pages", () => {
  it("stands in front of everything on a page as it scrolls, at both ends of the widths", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(console_.signInUrl(BROWSER_ADMIN));
    await page.waitForURL((url) => url.origin === console_.origin && url.pathname === "/");
    const { person, goal } = await seeded(page);

    // Each page, and what it must show before there is anything to look at.
    const bars = ".sc-calendar-task-title-spanning";
    const pages = [
      ["/work", bars],
      [`/people/${person}/work`, bars],
      ["/projects/week/calendar", bars],
      [`/projects/week/roadmap/${goal}?view=calendar`, bars],
      [`/projects/week/roadmap/${goal}?view=list`, ".sc-goal-view-list"],
      [`/projects/week/roadmap/${goal}`, ".sc-column"],
      ["/projects/week/roadmap", ".sc-timeline-goal"],
      ["/projects/week", ".sc-column"],
      ["/people", ".sc-person-card"],
      ["/plugins/hello", "iframe.sc-plugin-frame"],
    ] as const;

    const inFront: Record<string, unknown> = {};
    const look = async (where: string) => {
      const found = (await page.evaluate(IN_FRONT_OF_THE_HEADER)) as readonly string[];
      if (found.length > 0) {
        inFront[where] = found;
      }
    };
    // Short, so that every page has somewhere to scroll to.
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 220 });
      for (const [path, shown] of pages) {
        await page.goto(`${console_.origin}${path}`);
        await page.waitForSelector(shown, { state: "attached" });
        await look(`${path} at ${width}`);
      }
      await page.goto(`${console_.origin}/`);
      await page.click("text=Edit layout");
      await page.waitForSelector(".sc-home-bar");
      await look(`Edit layout at ${width}`);
    }

    expect(inFront).toEqual({});
    await context.close();
  });
});
