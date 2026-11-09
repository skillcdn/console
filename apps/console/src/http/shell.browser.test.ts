import process from "node:process";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_ADMIN,
  type BrowserConsole,
  startBrowserConsole,
} from "../testing/browser-console.js";
import { CALL_PLUGIN_DIR } from "../testing/plugins.js";

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
    // A second plugin of the operations group, beside the example plugin, once enabled: the
    // group becomes a tab that opens a list.
    plugins: [{ name: "console-plugin-call", dir: CALL_PLUGIN_DIR }],
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

/** The language the console keeps on the person signed in on this page. */
const languageOn = (page: Page) =>
  page.evaluate(async () => {
    const me = (await (await fetch("/api/v1/me")).json()) as { readonly language: string | null };
    return me.language;
  });

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
  it("keeps the language a person is first seen in, and leaves theirs alone after that (ADR-0065)", async () => {
    const context = await browser.newContext({ locale: "ko-KR" });
    const page = await context.newPage();
    await page.goto(console_.signInUrl(BROWSER_ADMIN));
    await page.locator(".sc-header").waitFor();
    await expect.poll(() => languageOn(page)).toBe("ko");

    // Chosen on the menu, it stays chosen, in a browser that asks for another.
    const chosen = await page.evaluate(async () => {
      const response = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "en" }),
      });
      return response.status;
    });
    expect(chosen).toBe(200);
    await page.reload();
    await page.locator(".sc-header").waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    expect(await languageOn(page)).toBe("en");
    await context.close();
  });

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

  it("opens a group of plugins from its tab, the list in front of the page and pressable: to a mouse resting on it, and to a finger's tap", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await page.goto(console_.signInUrl(BROWSER_ADMIN));
    await page.waitForURL((url) => url.origin === console_.origin && url.pathname === "/");
    const sent = (path: string, body: unknown) =>
      page.evaluate(
        async (request) => {
          const answer = await fetch(request.path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request.body),
          });
          return answer.status;
        },
        { path, body },
      );
    expect(
      await sent("/api/v1/plugins/call/enable", { consent: [], board: null, projects: "all" }),
    ).toBe(200);
    // A finger's browser: a phone's width, touching.
    const touching = await browser.newContext({
      locale: "en-US",
      viewport: { width: 390, height: 720 },
      hasTouch: true,
    });
    try {
      const openCount = 'document.querySelectorAll(".sc-tab-group-panel:popover-open").length';
      const linkOf = (where: Page) =>
        where.locator('.sc-tab-group-panel a.sc-menu-link[href="/plugins/call/room"]');
      /** The link is what the browser finds at its place, within the window, and names the plugin alone. */
      const pressable = async (where: Page, width: number) => {
        const link = linkOf(where);
        await link.waitFor({ state: "visible" });
        const box = await link.boundingBox();
        if (box === null) {
          throw new Error("the link has no box");
        }
        const atPoint = await where.evaluate(
          `document.elementFromPoint(${box.x + box.width / 2}, ${box.y + box.height / 2})?.closest("a")?.getAttribute("href") ?? null`,
        );
        expect(atPoint, `at ${width}`).toBe("/plugins/call/room");
        expect(box.x, `at ${width}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `at ${width}`).toBeLessThanOrEqual(width);
        expect(await link.textContent()).toBe("Call");
      };
      // A mouse resting on the tab opens the list, over a page of the group, whose frame is what
      // the browser found in the list's place before; a click on a link follows it and closes it.
      await page.goto(`${console_.origin}/plugins/hello/greetings`);
      await page.waitForSelector("iframe.sc-plugin-frame", { state: "attached" });
      const tab = page.locator(".sc-tabs .sc-tab-summary", { hasText: "Operations" });
      await tab.hover();
      await pressable(page, 1280);
      await linkOf(page).click();
      await page.waitForURL((url) => url.pathname === "/plugins/call/room");
      expect(await page.evaluate(openCount)).toBe(0);
      // Resting on the tab again opens it; leaving the tab and the list closes it a moment later.
      await tab.hover();
      await linkOf(page).waitFor({ state: "visible" });
      await page.mouse.move(640, 600);
      await expect.poll(() => page.evaluate(openCount)).toBe(0);
      // A mouse's click on the tab goes where the tab leads: the group's first page, which is
      // Call's, the keys ordering the two.
      await page.goto(`${console_.origin}/plugins/hello/greetings`);
      await page.waitForSelector("iframe.sc-plugin-frame", { state: "attached" });
      await tab.click();
      await page.waitForURL((url) => url.pathname === "/plugins/call/room");
      expect(await page.evaluate(openCount)).toBe(0);
      // A finger: a tap on the tab opens the list, and a tap on a link follows it.
      const phone = await touching.newPage();
      await phone.goto(console_.signInUrl(BROWSER_ADMIN));
      await phone.waitForURL((url) => url.origin === console_.origin && url.pathname === "/");
      await phone.goto(`${console_.origin}/plugins/hello/greetings`);
      await phone.waitForSelector("iframe.sc-plugin-frame", { state: "attached" });
      await phone.locator(".sc-tabs .sc-tab-summary", { hasText: "Operations" }).tap();
      await pressable(phone, 390);
      await linkOf(phone).tap();
      await phone.waitForURL((url) => url.pathname === "/plugins/call/room");
      expect(await phone.evaluate(openCount)).toBe(0);
      // A window too short for the list: it scrolls within itself, a scroll there leaves it
      // open, and the window losing the focus, as to a click in a plugin's frame, closes it.
      await page.setViewportSize({ width: 390, height: 260 });
      await page.goto(`${console_.origin}/plugins/hello/greetings`);
      await page.waitForSelector("iframe.sc-plugin-frame", { state: "attached" });
      await page.locator(".sc-tabs .sc-tab-summary", { hasText: "Operations" }).hover();
      await expect.poll(() => page.evaluate(openCount)).toBe(1);
      const fits = await page.evaluate(
        `(() => { const box = document.querySelector(".sc-tab-group-panel").getBoundingClientRect(); return box.bottom <= document.documentElement.clientHeight; })()`,
      );
      expect(fits).toBe(true);
      await page.evaluate(
        `(() => { const list = document.querySelector(".sc-tab-group-panel"); list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event("scroll")); })()`,
      );
      expect(await page.evaluate(openCount)).toBe(1);
      await page.evaluate('window.dispatchEvent(new Event("blur"))');
      // Polled from outside: the console's policy evaluates no string in the page.
      await expect.poll(() => page.evaluate(openCount)).toBe(0);
    } finally {
      await sent("/api/v1/plugins/call/disable", {});
      await touching.close();
      await context.close();
    }
  });
});
