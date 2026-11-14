import process from "node:process";
import {
  AUTH_ROUTES,
  pluginPath,
  projectPath,
  REST_ROUTES,
  restMeSchema,
  restProjectSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_ADMIN, type BrowserConsole, startBrowserConsole } from "./browser-console.js";
import { PREVIEW_BOARD_KEY, seedPreviewBoard } from "./preview-board.js";

// The console a person looks at the plugins on (`pnpm dev:plugins`) runs the plugins' hooks and
// jobs itself, as a deployment's worker does: a decision a plugin raised, answered on the board,
// reaches the plugin's hook here within seconds, and the record it keeps moves on. Needs
// PostgreSQL and the build, as the browser tests do, and no browser.

let started: BrowserConsole;

const json = (body: unknown, cookie: string, method = "POST"): RequestInit => ({
  method,
  headers: { cookie, origin: started.origin, "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Asks again until the answer satisfies `until`, or the time is up. */
async function eventually<T>(
  read: () => Promise<T>,
  until: (value: T) => boolean,
  ms: number,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last = await read();
  while (!until(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await read();
  }
  return last;
}

beforeAll(async () => {
  started = await startBrowserConsole({
    databaseUrl: process.env.TEST_DATABASE_URL,
    env: process.env,
  });
}, 120_000);

afterAll(async () => {
  await started?.close();
});

describe("the preview console", () => {
  it("is reached at the public address it is given, by sign-in addresses that carry a secret of the run", async () => {
    const outside = await startBrowserConsole({
      databaseUrl: process.env.TEST_DATABASE_URL,
      env: process.env,
      publicUrl: "https://preview.example.test",
    });
    try {
      expect(outside.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(outside.publicUrl).toBe("https://preview.example.test");
      const signIn = outside.signInUrl(BROWSER_ADMIN);
      expect(signIn).toMatch(
        /^https:\/\/preview\.example\.test\/__fixture\/[0-9a-f]{24}\/sign-in\/alice$/,
      );
      // The page is at the secret address on the listener, and not at the plain one.
      const secret = new URL(signIn).pathname.replace(/\/alice$/, "");
      const found = await fetch(`${outside.origin}${secret}`);
      expect(found.status).toBe(200);
      expect(await found.text()).toContain("Sign in as");
      const plain = await fetch(`${outside.origin}/__fixture/sign-in`);
      expect(await plain.text()).not.toContain("Sign in as");
      // The console's own pages are the public address's: a request from the loopback's origin
      // is another site's.
      const admin = await outside.harness.signIn(BROWSER_ADMIN);
      const foreign = await outside.harness.request(REST_ROUTES.projects, {
        method: "POST",
        headers: { cookie: admin, origin: outside.origin, "content-type": "application/json" },
        body: JSON.stringify({ key: "x", name: "X" }),
      });
      expect(foreign.status).toBe(403);

      // Whom the host answers for is the browser's own. Anyone who reaches the tunnel may begin
      // the console's login, which sends them to the answer's address, the run's secret in it;
      // the answer gives a code only to the browser the page of a person gave its word to, once,
      // and only back to the console's callback.
      const atListener = (url: string): string => {
        const at = new URL(url);
        return `${outside.origin}${at.pathname}${at.search}`;
      };
      const pairOf = (response: Response, name: string): string =>
        response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";")[0] ?? "")
          .find((pair) => pair.split("=")[0]?.endsWith(name) === true) ?? "";
      const word = pairOf(
        await fetch(`${outside.origin}${secret}/alice`),
        "console_fixture_sign_in",
      );
      expect(word).toMatch(/^console_fixture_sign_in=[0-9a-f]{32}$/);
      const login = async () => {
        const begun = await fetch(`${outside.origin}${AUTH_ROUTES.login("gh")}`, {
          redirect: "manual",
        });
        expect(begun.status).toBe(302);
        return {
          authorize: begun.headers.get("location") ?? "",
          cookie: pairOf(begun, "console_login"),
        };
      };
      const stranger = await login();
      expect(new URL(stranger.authorize).pathname).toBe(secret.replace(/\/sign-in$/, "/authorize"));
      expect((await fetch(atListener(stranger.authorize), { redirect: "manual" })).status).toBe(
        403,
      );
      const mine = await login();
      const answered = await fetch(atListener(mine.authorize), {
        redirect: "manual",
        headers: { cookie: word },
      });
      expect(answered.status).toBe(302);
      const back = answered.headers.get("location") ?? "";
      expect(back.startsWith(`https://preview.example.test${AUTH_ROUTES.callback("gh")}?`)).toBe(
        true,
      );
      const signedIn = await fetch(atListener(back), {
        redirect: "manual",
        headers: { cookie: mine.cookie },
      });
      expect(pairOf(signedIn, "console_session")).not.toBe("");
      // The word is used once.
      const again = await login();
      const twice = await fetch(atListener(again.authorize), {
        redirect: "manual",
        headers: { cookie: word },
      });
      expect(twice.status).toBe(403);
      // And the answer goes back to the console's callback alone.
      const fresh = pairOf(
        await fetch(`${outside.origin}${secret}/alice`),
        "console_fixture_sign_in",
      );
      const elsewhere = new URL((await login()).authorize);
      elsewhere.searchParams.set("redirect_uri", "https://elsewhere.example.test/callback");
      const away = await fetch(atListener(elsewhere.toString()), {
        redirect: "manual",
        headers: { cookie: fresh },
      });
      expect(away.status).toBe(400);
    } finally {
      await outside.close();
    }
  });

  it("runs a plugin's hooks itself: a decision answered on the board moves the plugin's record", async () => {
    const admin = await started.harness.signIn(BROWSER_ADMIN);
    const bob = await started.harness.signIn("bob");
    const enabled = await started.harness.request(
      pluginPath("leave", "enable"),
      json(
        {
          consent: [
            "board:read",
            "board:tasks",
            "board:decisions",
            "board:documents",
            "events:console",
            "jobs",
            "people:read",
            "people:read:all",
            "outbound:api.example.test",
          ],
          board: {
            create: { key: "leave-board", name: "Leave", description: "Leave and its approval." },
          },
          projects: ["leave-board"],
        },
        admin,
      ),
    );
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    const bobId = (
      (await (
        await started.harness.request("/api/v1/me", { headers: { cookie: bob } })
      ).json()) as { person: { id: string } }
    ).person.id;
    const listed = await started.harness.request(
      projectPath("leave-board", "members"),
      json({ personId: bobId, role: "member" }, admin),
    );
    expect(listed.status, await listed.clone().text()).toBe(201);

    const requested = await started.harness.request(
      pluginPath("leave", "invoke"),
      json(
        { argv: ["request", "--from", "2026-12-01", "--to", "2026-12-02", "--approver", "alice"] },
        bob,
      ),
    );
    expect(requested.status, await requested.clone().text()).toBe(200);
    const { data } = (await requested.json()) as {
      data: { record: { id: string }; decision: { id: string } };
    };

    const answered = await started.harness.request(
      `${projectPath("leave-board", "decisions", data.decision.id)}/answer`,
      json({ option: "1" }, admin),
    );
    expect(answered.status, await answered.clone().text()).toBe(200);

    // Nobody dispatches by hand: the preview's own dispatcher delivers the event to the hook.
    const record = await eventually(
      async () =>
        (await (
          await started.harness.request(
            pluginPath("leave", "records", "requests", data.record.id),
            {
              headers: { cookie: bob },
            },
          )
        ).json()) as { data: { state: string } },
      (found) => found.data.state === "approved",
      20_000,
    );
    expect(record.data.state).toBe("approved");
  }, 60_000);

  it("makes a board for the front page's glance once, and shows it at one on a member's page (ADR-0105)", async () => {
    const admin = await started.harness.signIn(BROWSER_ADMIN);
    const member = await started.harness.signIn("bob");
    const seed = () =>
      seedPreviewBoard({
        harness: started.harness,
        origin: started.origin,
        admin,
        member,
        now: new Date("2026-11-14T09:00:00Z"),
      });
    expect(await seed()).toBe(true);
    const project = restProjectSchema.parse(
      await (
        await started.harness.request(projectPath(PREVIEW_BOARD_KEY), {
          headers: { cookie: member },
        })
      ).json(),
    );
    expect(project.taskCounts).toEqual({
      idea: 0,
      ready: 3,
      in_progress: 6,
      in_review: 3,
      done: 3,
      dropped: 0,
    });
    expect(project.openDecisions).toBe(1);
    const me = restMeSchema.parse(
      await (await started.harness.request(REST_ROUTES.me, { headers: { cookie: member } })).json(),
    );
    expect(me.home?.layouts[12]).toEqual([
      { tile: `project:${project.id}`, x: 0, y: 0, size: "large" },
    ]);
    expect(me.home?.layouts[8]?.[0]?.size).toBe("wide");
    // Made once: a database kept from an earlier run keeps what was there, a page arranged since too.
    expect(await seed()).toBe(false);
    const adminMe = restMeSchema.parse(
      await (await started.harness.request(REST_ROUTES.me, { headers: { cookie: admin } })).json(),
    );
    expect(Object.keys(adminMe.home?.layouts ?? {})).toEqual([]);
  }, 60_000);
});
