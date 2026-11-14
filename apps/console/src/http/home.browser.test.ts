import process from "node:process";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_ADMIN,
  type BrowserConsole,
  startBrowserConsole,
} from "../testing/browser-console.js";

// The front page in a real browser (ADR-0061): a tile taken in hand with the mouse, which no
// other test can see: where the pointer is over the grid, what the tile under it does, and that
// nothing opens meanwhile. What is kept, and how the tiles give way, the unit tests prove.

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

async function signedIn(person: string): Promise<Page> {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(console_.signInUrl(person));
  await page.waitForURL((url) => url.origin === console_.origin && url.pathname === "/");
  return page;
}

/** A project made as the person, for the page to have tiles of it. */
async function made(page: Page, key: string): Promise<string> {
  const answer = (await page.evaluate(async (projectKey) => {
    const response = await fetch("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: projectKey, name: projectKey.toUpperCase() }),
    });
    return response.json();
  }, key)) as { readonly id: string };
  return `project:${answer.id}`;
}

/** What a tile's style says of one of its numbers. */
async function styleOf(page: Page, tile: string, name: string): Promise<string | undefined> {
  const style = await page.getAttribute(`[data-tile="${tile}"]`, "style");
  return new RegExp(`${name}:\\s*([^;]+)`).exec(style ?? "")?.[1]?.trim();
}

/** Where a tile stands on the grid. */
const placeOf = async (page: Page, tile: string) => [
  await styleOf(page, tile, "--sc-tile-x"),
  await styleOf(page, tile, "--sc-tile-y"),
];

/** The middle of a cell of the grid, on the screen. */
async function middleOf(page: Page, x: number, y: number) {
  const grid = await page.$(".sc-home-grid");
  const box = await grid?.boundingBox();
  if (box === null || box === undefined) {
    throw new Error("no grid on the page");
  }
  const gap = 16;
  const step = (box.width + gap) / 8;
  return { x: box.x + step * x + step / 2 - gap / 2, y: box.y + step * y + step / 2 - gap / 2 };
}

/** Takes a tile from where it stands to a cell, with the mouse, and lets go. */
async function drag(page: Page, tile: string, x: number, y: number): Promise<void> {
  const from = await (await page.$(`[data-tile="${tile}"]`))?.boundingBox();
  if (from === null || from === undefined) {
    throw new Error(`no tile ${tile}`);
  }
  await page.mouse.move(from.x + 40, from.y + 40);
  await page.mouse.down();
  const to = await middleOf(page, x, y);
  // Where it was taken hold of stays under the pointer.
  await page.mouse.move(to.x + 40 - from.width / 2, to.y + 40 - from.height / 2, { steps: 8 });
  await page.mouse.up();
}

/**
 * What of the projects' words the page cuts: a row reaching past its tile, and a text that is not
 * a whole number of lines. A row beyond the tile's right edge has gone whole. Written out as text,
 * since it runs in the page and this workspace has no types of a page.
 */
const CUT_WORDS = `(() => {
  const cut = [];
  for (const pane of document.querySelectorAll(".sc-tile-project")) {
    const tile = pane.getBoundingClientRect();
    for (const row of pane.querySelectorAll(".sc-tile-name, .sc-tile-meta, .sc-tile-about")) {
      const box = row.getBoundingClientRect();
      if (box.left >= tile.right) {
        continue;
      }
      const name = row.className + " of " + pane.querySelector(".sc-tile-name").textContent;
      if (box.bottom > tile.bottom + 0.5 || box.right > tile.right + 0.5) {
        cut.push(name + " past its tile");
      }
      if (!row.matches(".sc-tile-meta")) {
        const lines = box.height / Number.parseFloat(getComputedStyle(row).lineHeight);
        if (Math.abs(lines - Math.round(lines)) > 0.05) {
          cut.push(name + " at " + lines + " lines");
        }
      }
    }
  }
  return cut;
})()`;

/** How many of the icons have lost their names. */
const NAMES_GONE = `(() =>
  [...document.querySelectorAll(".sc-tile-project:not(.sc-tile-project-card)")].filter(
    (pane) =>
      pane.querySelector(".sc-tile-name").getBoundingClientRect().left >=
      pane.getBoundingClientRect().right,
  ).length)()`;

describe("the front page in a browser (ADR-0061)", () => {
  it("takes a tile anywhere, opens nothing meanwhile, and keeps where it was put", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    const ops = await made(page, "ops");
    const web = await made(page, "web");
    await page.goto(`${console_.origin}/`);
    await page.waitForSelector(`[data-tile="${web}"]`);
    // On the page as it is, a project is the way into it.
    await page.click(`[data-tile="${ops}"] a`);
    await page.waitForURL(/\/projects\/ops/);
    await page.goBack();
    await page.waitForSelector(`[data-tile="${ops}"]`);

    await page.click("text=Edit layout");
    await page.waitForSelector(".sc-home-bar");
    // Arranging, the same press opens nothing, and there is no link to follow.
    await page.click(`[data-tile="${ops}"] .sc-tile-name`);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await page.$(`[data-tile="${ops}"] a`)).toBeNull();

    // Down and to the right, onto cells nothing stands on, which stay empty around it.
    await drag(page, ops, 5, 3);
    expect(await placeOf(page, ops)).toEqual(["5", "3"]);
    // Up and to the left again, next to the other.
    await drag(page, web, 7, 0);
    expect(await placeOf(page, web)).toEqual(["7", "0"]);

    // The way off the page, and back from what was taken off.
    await page.click(`[data-tile="${web}"] .sc-tile-remove`);
    expect(await page.$(`[data-tile="${web}"]`)).toBeNull();
    await page.click("text=+ WEB");
    await page.waitForSelector(`[data-tile="${web}"]`);

    // A size picked on the tile, and the cells it takes.
    await page.click(`[data-tile="${ops}"] [aria-label="Small"]`);
    expect(await styleOf(page, ops, "--sc-tile-w")).toBe("2");

    await page.click("text=Done");
    await page.waitForSelector("text=Edit layout");
    await page.reload();
    await page.waitForSelector(`[data-tile="${ops}"]`);
    expect((await placeOf(page, ops))[1]).toBe("3");
    await page.context().close();
  });

  it("lets go of what was done when the person cancels, and puts a tile back with the Escape key", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    const key = "keep";
    const tile = await made(page, key);
    await page.goto(`${console_.origin}/`);
    await page.waitForSelector(`[data-tile="${tile}"]`);
    const before = await placeOf(page, tile);
    await page.click("text=Edit layout");
    await page.waitForSelector(".sc-home-bar");
    await drag(page, tile, 6, 1);
    expect(await placeOf(page, tile)).toEqual(["6", "1"]);
    await page.click("text=Cancel");
    await page.waitForSelector("text=Edit layout");
    expect(await placeOf(page, tile)).toEqual(before);

    await page.click("text=Edit layout");
    await page.waitForSelector(".sc-home-bar");
    const from = await (await page.$(`[data-tile="${tile}"]`))?.boundingBox();
    await page.mouse.move((from?.x ?? 0) + 40, (from?.y ?? 0) + 40);
    await page.mouse.down();
    await page.mouse.move((from?.x ?? 0) + 300, (from?.y ?? 0) + 300, { steps: 6 });
    expect(await page.$(".sc-tile-held")).not.toBeNull();
    await page.keyboard.press("Escape");
    expect(await page.$(".sc-tile-held")).toBeNull();
    await page.mouse.up();
    expect(await placeOf(page, tile)).toEqual(before);
    await page.context().close();
  });

  it("lifts a tile under the pointer, shows where it would land, and slides those in the way aside", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    const held = await made(page, "held");
    const inTheWay = await made(page, "way");
    await page.goto(`${console_.origin}/`);
    await page.waitForSelector(`[data-tile="${inTheWay}"]`);
    await page.click("text=Edit layout");
    await page.waitForSelector(".sc-home-bar");
    const boxOf = async (tile: string) => {
      const box = await (await page.$(`[data-tile="${tile}"]`))?.boundingBox();
      if (box === null || box === undefined) {
        throw new Error(`no tile ${tile}`);
      }
      return box;
    };
    const from = await boxOf(held);
    const over = await boxOf(inTheWay);
    const target = { x: over.x + over.width / 2, y: over.y + over.height / 2 };
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 6 });

    // The one in the way is on its way there, not there at once.
    await page.waitForFunction(
      `document.querySelector('[data-tile="${inTheWay}"]').getAnimations().some((running) => running.transitionProperty === "translate")`,
    );
    // Where the tile in hand would land shows the tile itself.
    expect(await page.textContent(".sc-tile-slot .sc-tile-name")).toBe("HELD");

    // Lifted, it stays under the pointer: the lift grows the tile and not how far it has come.
    const lifted = await boxOf(held);
    expect(Math.abs(lifted.x + lifted.width / 2 - target.x)).toBeLessThan(2);
    expect(Math.abs(lifted.y + lifted.height / 2 - target.y)).toBeLessThan(2);
    expect(lifted.width).toBeGreaterThan(from.width);

    await page.mouse.up();
    expect(await page.$(".sc-tile-slot")).toBeNull();
    await page.context().close();
  });

  it("shows a tile's words whole or not at all, at every width", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    const icon = await made(page, "icon");
    const card = await made(page, "card");
    await page.evaluate(async (tile) => {
      await fetch(`/api/v1/projects/card`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "A project whose name goes on for rather longer than a tile has room for",
          description: "What the project is for, said at length. ".repeat(6),
        }),
      });
      const layout = [{ tile, x: 0, y: 0, size: "small" }];
      await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          home: { hidden: [], layouts: { 12: layout, 8: layout, 6: layout, 4: layout } },
        }),
      });
    }, card);
    await page.goto(`${console_.origin}/`);
    await page.waitForSelector(`[data-tile="${icon}"]`);
    for (let width = 320; width <= 2000; width += 40) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(40);
      expect(await page.evaluate(CUT_WORDS), `at ${width} pixels`).toEqual([]);
      expect(await page.evaluate(NAMES_GONE), `at ${width} pixels`).toBe(0);
    }
    await page.context().close();
  });

  it("reads a project at a glance in one request, again each time the page is shown, its figures and its rows of one moment (ADR-0107)", async () => {
    const page = await signedIn(BROWSER_ADMIN);
    const tile = await made(page, "glanced");
    const plain = await made(page, "plain");
    await page.evaluate(async (glanced) => {
      const write = (path: string, method: string, body: unknown) =>
        fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      for (const [title, state] of [
        ["One in progress", "in_progress"],
        ["Another in progress", "in_progress"],
        ["One in review", "in_review"],
        ["One that waits", "ready"],
      ]) {
        await write("/api/v1/projects/glanced/tasks", "POST", { title, state });
      }
      const layout = [{ tile: glanced, x: 0, y: 0, size: "large" }];
      await write("/api/v1/me", "PATCH", {
        home: { hidden: [], layouts: { 12: layout, 8: layout, 6: layout, 4: layout } },
      });
    }, tile);
    const asked: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/glance")) {
        asked.push(pathname);
      }
    });
    /** The three figures at the tile's head, and the titles of its rows, as the page shows them. */
    const shown = () =>
      page.evaluate(
        `({ figures: [...document.querySelectorAll(".sc-tile-glance .sc-glance-fact dd")].map((dd) => dd.textContent), rows: [...document.querySelectorAll(".sc-tile-glance .sc-glance-row-main")].map((row) => row.textContent) })`,
      ) as Promise<{ readonly figures: string[]; readonly rows: string[] }>;

    await page.goto(`${console_.origin}/`);
    await expect.poll(async () => (await shown()).figures).toEqual(["2", "1", "0"]);
    expect((await shown()).rows).toEqual([
      "Another in progress",
      "One in progress",
      "One in review",
    ]);
    // One request for the one project at a glance, and none for the one shown as an icon.
    expect(asked).toEqual(["/api/v1/projects/glanced/glance"]);
    // The name of the link is the project and its figures, not every row.
    expect(await page.getAttribute(".sc-tile-glance", "aria-label")).toBe(
      "GLANCED (glanced). In progress 2, in review 1, decisions waiting 0.",
    );

    // Into the project, where its board changes, and back to the front page as a person goes.
    await page.click(".sc-tile-glance");
    await page.waitForURL((url) => url.pathname.startsWith("/projects/glanced"));
    await page.evaluate(async () => {
      const listed = (await (await fetch("/api/v1/projects/glanced/tasks?state=ready")).json()) as {
        readonly items: readonly { readonly id: string }[];
      };
      await fetch(`/api/v1/projects/glanced/tasks/${listed.items[0]?.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "in_progress" }),
      });
      for (const key of ["glanced", "plain"]) {
        await fetch(`/api/v1/projects/${key}/decisions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: "Which first?",
            options: [{ label: "This" }, { label: "That" }],
          }),
        });
      }
    });
    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/");
    // The head and the rows are of the same moment: three in progress, three rows of them, and
    // the decision that was raised.
    await expect.poll(async () => (await shown()).figures).toEqual(["3", "1", "1"]);
    expect((await shown()).rows).toEqual([
      "One that waits",
      "Another in progress",
      "One in progress",
      "One in review",
    ]);
    // The projects were read again with it: the one shown as an icon says its decision too.
    await expect
      .poll(() =>
        page.evaluate(
          `document.querySelector('[data-tile="${plain}"] .sc-tile-count')?.firstChild?.textContent ?? ""`,
        ),
      )
      .toBe("1");
    // Read once more for the page shown again, and no more than that.
    expect(asked).toEqual(["/api/v1/projects/glanced/glance", "/api/v1/projects/glanced/glance"]);
    await page.context().close();
  });
});
