import {
  AUTH_ROUTES,
  REST_ROUTES,
  restErrorSchema,
  restMeSchema,
  restPeopleSchema,
  restSessionsSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { latestEventId, listEventsAfter } from "./db/queries/events.js";
import { ensureWorkspace } from "./db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureOrganization } from "./testing/fixture-organization.js";
import { createFixtureProvider, type FixtureProvider } from "./testing/fixture-provider.js";
import {
  cookieOf,
  createHarness,
  type Harness,
  type HarnessOptions,
  SIGN_IN_URL,
} from "./testing/harness.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

/** A clock a test can move forward. */
function movableClock() {
  let offset = 0;
  return {
    now: () => new Date(Date.now() + offset),
    advance(milliseconds: number) {
      offset += milliseconds;
    },
  };
}

function harness(
  options: Omit<HarnessOptions, "providers"> & { readonly login?: FixtureProvider } = {},
): Harness & { login: FixtureProvider } {
  const { login = createFixtureProvider(), ...rest } = options;
  return { login, ...createHarness(testDatabase, { providers: [login], ...rest }) };
}

const me = async (h: Harness, cookie?: string) =>
  restMeSchema.parse(
    await (
      await h.request(REST_ROUTES.me, cookie === undefined ? {} : { headers: { cookie } })
    ).json(),
  );

/** The number of the workspace's newest event, to read what happens after it. */
async function latestEvent(): Promise<number> {
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  return latestEventId(testDatabase.database, workspace.id);
}

/** The workspace's own events after the one numbered `after`: what, by whom, and with what. */
async function workspaceEventsAfter(after: number) {
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  const { items } = await listEventsAfter(
    testDatabase.database,
    { workspaceId: workspace.id, projectId: null },
    after,
    100,
  );
  return items.map((event) => [event.kind, event.actor?.login ?? null, event.data]);
}

describe("signing in", () => {
  it("sends the browser to the git host with a state and a challenge, and remembers both", async () => {
    const { request } = harness();
    const begun = await request(`${AUTH_ROUTES.login("gh")}?return_to=/tasks`);
    expect(begun.status).toBe(302);
    expect(begun.headers.get("cache-control")).toBe("no-store");
    const location = new URL(begun.headers.get("location") ?? "");
    expect(location.origin).toBe("https://git.test");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${SIGN_IN_URL}${AUTH_ROUTES.callback("gh")}`,
    );
    expect(location.searchParams.get("state")).toMatch(/^[\w-]{20,}$/);
    expect(location.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    const [cookie] = begun.headers.getSetCookie();
    // Bound to this very host, so that nobody else can have put it in the browser.
    expect(cookie).toMatch(/^__Host-console_login=v1\./);
    for (const attribute of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure", "Max-Age=600"]) {
      expect(cookie).toContain(attribute);
    }
    // What the browser carries is sealed: neither the state nor the verifier can be read off it.
    expect(cookie).not.toContain(location.searchParams.get("state"));
  });

  it("comes back signed in, to the page it left for, with a session only the server reads", async () => {
    const { request, login } = harness();
    const begun = await request(
      `${AUTH_ROUTES.login("gh")}?return_to=${encodeURIComponent("/tasks/42?x=1")}`,
    );
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const done = await request(
      `${AUTH_ROUTES.callback("gh")}?code=${login.codeFor("alice", state)}&state=${state}`,
      { headers: { cookie: cookieOf(begun, "console_login") } },
    );
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/tasks/42?x=1");
    const cookies = done.headers.getSetCookie();
    // The attempt is forgotten and the session begins.
    expect(cookies.some((cookie) => /^__Host-console_login=; .*Max-Age=0/.test(cookie))).toBe(true);
    const session = cookies.find((cookie) => cookie.startsWith("__Host-console_session="));
    for (const attribute of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure"]) {
      expect(session).toContain(attribute);
    }

    const h = harness({ login });
    const answer = await h.request(REST_ROUTES.me, {
      headers: { cookie: session?.split(";")[0] ?? "" },
    });
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(restMeSchema.parse(await answer.json())).toEqual({
      workspace: {
        name: "Acme",
        tokenDaysAtMost: null,
        skills: { source: "https://skillcdn.ai", address: null, packToken: null },
        peopleVisibility: "everyone",
        weekStart: "auto",
        timeZone: null,
        language: null,
      },
      language: null,
      home: null,
      agent: null,
      session: { kind: "browser", name: null },
      console: { version: "0.1.18", clientRange: ">=0.1.0 <0.2.0" },
      // Nothing waits for Alice yet.
      decisions: { waiting: 0 },
      person: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        login: "Alice",
        name: "Alice Example",
        avatar: "https://avatars.example/alice.png",
        role: "member",
        status: "active",
        source: "listed",
        deactivatedAt: null,
        email: null,
        managerId: null,
        language: null,
        // A person, as every member was before agent accounts (ADR-0084).
        kind: "person",
        handle: null,
        title: null,
        avatarParts: null,
      },
      signIn: [{ key: "gh", label: "GitHub", admits: { organization: null, domains: [] } }],
    });
    expect(await me(h)).toEqual({
      workspace: {
        name: "Acme",
        tokenDaysAtMost: null,
        skills: { source: "https://skillcdn.ai", address: null, packToken: null },
        peopleVisibility: "everyone",
        weekStart: "auto",
        timeZone: null,
        language: null,
      },
      language: null,
      home: null,
      agent: null,
      session: null,
      console: { version: "0.1.18", clientRange: ">=0.1.0 <0.2.0" },
      person: null,
      // Nobody has decisions to answer.
      decisions: null,
      signIn: [{ key: "gh", label: "GitHub", admits: { organization: null, domains: [] } }],
    });
  });

  it("keeps nothing of the git host's credential, and logs none of it", async () => {
    const h = harness();
    const cookie = await h.signIn("alice");
    expect(JSON.stringify(await me(h, cookie))).not.toContain("ghu_");
    expect(JSON.stringify(h.logs)).not.toContain("ghu_");
    expect(JSON.stringify(h.logs)).not.toContain("cns_s_");
  });

  it("makes the logins the operator names administrators, and keeps what the board says since", async () => {
    const named = harness({ admins: ["ALICE"] });
    expect((await me(named, await named.signIn("alice"))).person?.role).toBe("admin");
    expect((await me(named, await named.signIn("bob"))).person?.role).toBe("member");
    // Taken off the list, an administrator stays one: the role is the board's record now.
    const unnamed = harness();
    expect((await me(unnamed, await unnamed.signIn("alice"))).person?.role).toBe("admin");
  });

  it("tells the board when a person joins, once", async () => {
    const h = harness();
    await h.signIn("bob");
    await h.signIn("bob");
    const workspace = await ensureWorkspace(testDatabase.database, {
      name: "Acme",
      now: new Date(),
    });
    const { items } = await listEventsAfter(
      testDatabase.database,
      { workspaceId: workspace.id, projectId: null },
      0,
      100,
    );
    expect(items.filter((event) => event.actor?.login === "bob")).toHaveLength(1);
  });

  it.each([
    ["//evil.test/path", "/"],
    ["https://evil.test/", "/"],
    ["/\\evil.test", "/"],
    ["javascript:alert(1)", "/"],
    ["tasks", "/"],
    ["/decisions?open=true#frag", "/decisions?open=true"],
  ])("only comes back to a page of its own: %s", async (returnTo, expected) => {
    const { request, login } = harness();
    const begun = await request(
      `${AUTH_ROUTES.login("gh")}?return_to=${encodeURIComponent(returnTo)}`,
    );
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const done = await request(
      `${AUTH_ROUTES.callback("gh")}?code=${login.codeFor("alice", state)}&state=${state}`,
      { headers: { cookie: cookieOf(begun, "console_login") } },
    );
    expect(done.headers.get("location")).toBe(expected);
  });

  it("does not finish a sign-in that this browser did not start, and says why", async () => {
    const { request, login } = harness();
    const begun = await request(`${AUTH_ROUTES.login("gh")}?return_to=/tasks`);
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const cookie = cookieOf(begun, "console_login");
    const code = login.codeFor("alice", state);

    const noCookie = await request(`${AUTH_ROUTES.callback("gh")}?code=${code}&state=${state}`);
    expect(noCookie.headers.get("location")).toBe("/?sign_in=expired");
    const otherState = await request(
      `${AUTH_ROUTES.callback("gh")}?code=${code}&state=someone-elses`,
      {
        headers: { cookie },
      },
    );
    expect(otherState.headers.get("location")).toBe("/tasks?sign_in=failed");
    const denied = await request(
      `${AUTH_ROUTES.callback("gh")}?error=access_denied&state=${state}`,
      {
        headers: { cookie },
      },
    );
    expect(denied.headers.get("location")).toBe("/tasks?sign_in=denied");
    const badCode = await request(`${AUTH_ROUTES.callback("gh")}?code=not-a-code&state=${state}`, {
      headers: { cookie },
    });
    expect(badCode.headers.get("location")).toBe("/tasks?sign_in=failed");
    for (const response of [noCookie, otherState, denied, badCode]) {
      expect(response.headers.getSetCookie().some((c) => c.includes("console_session"))).toBe(
        false,
      );
    }
    login.unreachable(true);
    const down = await request(`${AUTH_ROUTES.callback("gh")}?code=${code}&state=${state}`, {
      headers: { cookie },
    });
    expect(down.headers.get("location")).toBe("/tasks?sign_in=failed");
    login.unreachable(false);
  });

  it("refuses someone nobody let in, and writes nothing down about them", async () => {
    const { request, login } = harness({ listed: ["alice"] });
    const begun = await request(`${AUTH_ROUTES.login("gh")}?return_to=/tasks`);
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const done = await request(
      `${AUTH_ROUTES.callback("gh")}?code=${login.codeFor("carol", state)}&state=${state}`,
      { headers: { cookie: cookieOf(begun, "console_login") } },
    );
    expect(done.headers.get("location")).toBe("/tasks?sign_in=refused");
    expect(done.headers.getSetCookie().some((c) => c.includes("console_session"))).toBe(false);
    const workspace = await ensureWorkspace(testDatabase.database, {
      name: "Acme",
      now: new Date(),
    });
    const { items } = await listEventsAfter(
      testDatabase.database,
      { workspaceId: workspace.id, projectId: null },
      0,
      100,
    );
    expect(items.some((event) => event.actor?.login === "carol")).toBe(false);
  });

  it("is begun on the deployment's own pages, not followed from elsewhere", async () => {
    const { request } = harness();
    const fromElsewhere = await request(`${AUTH_ROUTES.login("gh")}?return_to=/tasks`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(fromElsewhere.status).toBe(302);
    expect(fromElsewhere.headers.get("location")).toBe("/tasks");
    expect(fromElsewhere.headers.getSetCookie()).toEqual([]);
    const own = await request(`${AUTH_ROUTES.login("gh")}`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(own.headers.get("location")).toContain("git.test");
    expect((await request(AUTH_ROUTES.login("google"))).status).toBe(404);
    expect((await request("/auth/other/login")).status).toBe(404);
  });
});

describe("a session", () => {
  it("ends when the person signs out, from the console's own pages only", async () => {
    const h = harness();
    const cookie = await h.signIn("alice");
    const elsewhere = await h.request(AUTH_ROUTES.logout, {
      method: "POST",
      headers: { cookie, origin: "https://evil.test" },
    });
    expect(elsewhere.status).toBe(403);
    expect(await elsewhere.json()).toMatchObject({ error: { code: "auth.forbidden_origin" } });
    expect((await me(h, cookie)).person?.login).toBe("Alice");

    const out = await h.request(AUTH_ROUTES.logout, {
      method: "POST",
      headers: { cookie, origin: SIGN_IN_URL },
    });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()[0]).toMatch(/^__Host-console_session=; .*Max-Age=0/);
    expect((await me(h, cookie)).person).toBeNull();
    // Signing out twice is nothing to complain about.
    expect(
      (await h.request(AUTH_ROUTES.logout, { method: "POST", headers: { origin: SIGN_IN_URL } }))
        .status,
    ).toBe(204);
  });

  it("is listed to its person with the browser and the last use, and ended one by one or all the others (board #309)", async () => {
    const h = harness();
    // Two browsers: one that says what it is, and one as the harness signs in.
    const begun = await h.request(AUTH_ROUTES.login(h.login.key));
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const done = await h.request(
      `${AUTH_ROUTES.callback(h.login.key)}?code=${h.login.codeFor("alice", state)}&state=${state}`,
      {
        headers: {
          cookie: cookieOf(begun, "console_login"),
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        },
      },
    );
    const second = cookieOf(done, "console_session");
    const sessionsOf = async (cookie: string) =>
      restSessionsSchema.parse(
        await (await h.request(REST_ROUTES.sessions, { headers: { cookie } })).json(),
      );
    // A clean slate: the sessions the tests before this one left behind go, this one stays.
    expect(
      (
        await h.request(`${REST_ROUTES.sessions}/others`, {
          method: "DELETE",
          headers: { cookie: second, origin: SIGN_IN_URL },
        })
      ).status,
    ).toBe(204);
    const first = await h.signIn("alice");
    const listed = await sessionsOf(second);
    expect(listed.idleDays).toBeGreaterThan(0);
    expect(listed.items).toHaveLength(2);
    const [current, other] = listed.items;
    // The one asked from first, read as a browser on a platform; the harness's names nothing,
    // and comes from no address, since the app is called without a socket.
    expect(current).toMatchObject({
      current: true,
      browser: "Chrome",
      platform: "Windows",
      address: null,
    });
    expect(other).toMatchObject({ current: false, browser: null, platform: null });
    expect(JSON.stringify(listed)).not.toContain("cns_s_");

    // A token sees no sessions, and another site's request ends none.
    const made = restTokenCreatedSchema.parse(
      await (
        await h.request(REST_ROUTES.tokens, {
          method: "POST",
          headers: { cookie: second, origin: SIGN_IN_URL, "content-type": "application/json" },
          body: JSON.stringify({ name: "an agent" }),
        })
      ).json(),
    );
    expect(
      (
        await h.request(REST_ROUTES.sessions, {
          headers: { authorization: `Bearer ${made.secret}` },
        })
      ).status,
    ).toBe(403);
    const end = (cookie: string, id: string, origin = SIGN_IN_URL) =>
      h.request(`${REST_ROUTES.sessions}/${id}`, { method: "DELETE", headers: { cookie, origin } });
    expect((await end(second, other?.id ?? "", "https://evil.test")).status).toBe(403);

    // The other browser ended: it is out, this one stays; gone is gone.
    expect((await end(second, other?.id ?? "")).status).toBe(204);
    expect((await me(h, first)).person).toBeNull();
    expect((await me(h, second)).person?.login).toBe("Alice");
    expect((await end(second, other?.id ?? "")).status).toBe(404);

    // Every other at once: two more browsers go in one request, this one stays.
    const third = await h.signIn("alice");
    const fourth = await h.signIn("alice");
    expect((await sessionsOf(second)).items).toHaveLength(3);
    expect(
      (
        await h.request(`${REST_ROUTES.sessions}/others`, {
          method: "DELETE",
          headers: { cookie: second, origin: SIGN_IN_URL },
        })
      ).status,
    ).toBe(204);
    expect((await me(h, third)).person).toBeNull();
    expect((await me(h, fourth)).person).toBeNull();
    expect((await me(h, second)).person?.login).toBe("Alice");
    const [mine] = (await sessionsOf(second)).items;
    expect(mine?.current).toBe(true);

    // This browser's own session ended here: signed out, cookie and all.
    const out = await end(second, mine?.id ?? "");
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()[0]).toMatch(/console_session=; .*Max-Age=0/);
    expect((await me(h, second)).person).toBeNull();
  });

  it("ends when its time is up, and lives longer while it is used", async () => {
    const clock = movableClock();
    const h = harness({ clock, sessionTtlMs: 10 * 60_000 });
    const cookie = await h.signIn("alice");
    clock.advance(9 * 60_000);
    expect((await me(h, cookie)).person?.login).toBe("Alice");
    clock.advance(2 * 60_000);
    expect((await me(h, cookie)).person).toBeNull();
  });

  it("keeps the person's own arrangement of the front page's widgets (ADR-0059)", async () => {
    const login = createFixtureProvider();
    const h = harness({ login, listed: ["alice"], admins: ["alice"] });
    const cookie = await h.signIn("alice");
    const patch = (body: unknown) =>
      h.request(REST_ROUTES.me, {
        method: "PATCH",
        headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await me(h, cookie)).home).toBeNull();
    const home = {
      hidden: ["project:0199c4d8-0000-7000-8000-000000000001"],
      layouts: {
        8: [
          { tile: "widget:hr:today", x: 2, y: 0, size: "large" },
          { tile: "project:0199c4d8-0000-7000-8000-000000000002", x: 7, y: 3, size: "icon" },
        ],
        4: [{ tile: "widget:hello:latest", x: 0, y: 0, size: "small" }],
      },
    };
    const kept = await patch({ home });
    expect(kept.status, await kept.clone().text()).toBe(200);
    expect(restMeSchema.parse(await kept.json()).home).toEqual(home);
    expect((await me(h, cookie)).home).toEqual(home);
    // The language changes beside it, and leaves it; nothing named, or what is not a page, is refused.
    expect((await patch({ language: "ko" })).status).toBe(200);
    expect(await me(h, cookie)).toMatchObject({ language: "ko", home });
    expect((await patch({})).status).toBe(400);
    const tile = { tile: "widget:hr:today", x: 0, y: 0, size: "small" };
    for (const wrong of [
      [tile],
      { hidden: [], layouts: { 8: [{ ...tile, size: "huge" }] } },
      { hidden: [], layouts: { 8: [{ ...tile, x: 12 }] } },
      { hidden: [], layouts: { 8: [{ ...tile, y: -1 }] } },
      { hidden: [], layouts: { 8: [{ ...tile, tile: "widget:../../etc" }] } },
      { hidden: ["task:1"], layouts: {} },
      { hidden: [], layouts: { 8: Array.from({ length: 201 }, () => tile) } },
    ]) {
      expect((await patch({ home: wrong })).status).toBe(400);
    }
    expect((await patch({ home: null, language: null })).status).toBe(200);
    expect(await me(h, cookie)).toMatchObject({ language: null, home: null });
  });

  it("ends at once for a person deactivated, and the cookie goes with the answer", async () => {
    const login = createFixtureProvider();
    const h = harness({ login, listed: ["alice", "bob"], admins: ["alice"] });
    const admin = await h.signIn("alice");
    const cookie = await h.signIn("bob");
    const bob = (await me(h, cookie)).person;
    expect(bob).toMatchObject({ login: "bob", status: "active", source: "listed" });
    const out = await h.request(`${REST_ROUTES.people}/${bob?.id}`, {
      method: "PATCH",
      headers: { cookie: admin, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ status: "deactivated" }),
    });
    expect(out.status).toBe(200);
    const answer = await h.request(REST_ROUTES.me, { headers: { cookie } });
    expect(restMeSchema.parse(await answer.json()).person).toBeNull();
    expect(answer.headers.getSetCookie()[0]).toMatch(/^__Host-console_session=; .*Max-Age=0/);
    // Signing in again admits nobody: the listing went with the deactivation.
    const begun = await h.request(AUTH_ROUTES.login("gh"));
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const refused = await h.request(
      `${AUTH_ROUTES.callback("gh")}?code=${login.codeFor("bob", state)}&state=${state}`,
      { headers: { cookie: cookieOf(begun, "console_login") } },
    );
    expect(refused.headers.get("location")).toBe("/?sign_in=refused");
    // Listed again by an administrator, Bob signs in and is back in, as the board is told.
    const listed = await h.request(REST_ROUTES.listings, {
      method: "POST",
      headers: { cookie: admin, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ host: "gh", login: "BOB" }),
    });
    expect(listed.status).toBe(201);
    const back = (await me(h, await h.signIn("bob"))).person;
    expect(back).toMatchObject({ id: bob?.id, status: "active", source: "listed" });
    const workspace = await ensureWorkspace(testDatabase.database, {
      name: "Acme",
      now: new Date(),
    });
    const { items } = await listEventsAfter(
      testDatabase.database,
      { workspaceId: workspace.id, projectId: null },
      0,
      1000,
    );
    expect(items.map((event) => event.kind).slice(-3)).toEqual([
      "person.deactivated",
      "person.listed",
      "person.reactivated",
    ]);
  });

  it("is nobody's with a cookie that was not handed out here", async () => {
    const h = harness();
    expect((await me(h, "__Host-console_session=cns_s_forged")).person).toBeNull();
    expect((await me(h, "console_session=; other=1")).person).toBeNull();
  });
});

describe("the organization at the git host", () => {
  it("lets its members in as the host says, and the listings decide for the rest", async () => {
    const organization = createFixtureOrganization({ Alice: "1001", carol: "1003" });
    const login = createFixtureProvider();
    const h = createHarness(testDatabase, {
      providers: [login],
      organization,
      listed: ["bob"],
    });
    // The sign-in page is told whose members get in through the host.
    expect((await me(h)).signIn[0]?.admits).toEqual({ organization: "acme", domains: [] });
    // Carol is in by the organization alone, never listed; Alice by it too; Bob by his listing.
    expect((await me(h, await h.signIn("carol"))).person).toMatchObject({
      login: "carol",
      source: "organization",
      status: "active",
    });
    expect((await me(h, await h.signIn("alice"))).person?.source).toBe("organization");
    expect((await me(h, await h.signIn("bob"))).person?.source).toBe("listed");
    expect(organization.calls.isMember).toBe(3);
    // While the host cannot be asked, a listed person still signs in; a member of the organization waits.
    organization.unreachable(true);
    expect((await me(h, await h.signIn("bob"))).person?.login).toBe("bob");
    const again = await h.request(AUTH_ROUTES.login("gh"));
    const state = new URL(again.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const waits = await h.request(
      `${AUTH_ROUTES.callback("gh")}?code=${login.codeFor("carol", state)}&state=${state}`,
      { headers: { cookie: cookieOf(again, "console_login") } },
    );
    expect(waits.headers.get("location")).toBe("/?sign_in=refused");
    organization.unreachable(false);
    // The organization taken out of the configuration takes its people with it at once; a
    // token of theirs is kept, and refused with the reason (ADR-0044).
    const carol = await h.signIn("carol");
    const made = await h.request(REST_ROUTES.tokens, {
      method: "POST",
      headers: { cookie: carol, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ name: "an agent of Carol" }),
    });
    expect(made.status).toBe(201);
    const { secret } = restTokenCreatedSchema.parse(await made.json());
    const without = createHarness(testDatabase, { providers: [login], listed: ["bob"] });
    expect((await me(without, carol)).person).toBeNull();
    const refused = await without.request(REST_ROUTES.me, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(refused.status).toBe(403);
    expect(restErrorSchema.parse(await refused.json()).error.code).toBe("auth.not_admitted");
    // Named again, the organization's people are back in, and the token with them.
    const back = await h.request(REST_ROUTES.me, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(restMeSchema.parse(await back.json()).person?.login).toBe("carol");
  });
});

describe("a deployment where nobody signs in", () => {
  it("has no sign-in routes, and says so", async () => {
    const h = createHarness(testDatabase);
    expect(await me(h)).toEqual({
      workspace: {
        name: "Acme",
        tokenDaysAtMost: null,
        skills: { source: "https://skillcdn.ai", address: null, packToken: null },
        peopleVisibility: "everyone",
        weekStart: "auto",
        timeZone: null,
        language: null,
      },
      language: null,
      home: null,
      agent: null,
      session: null,
      console: { version: "0.1.18", clientRange: ">=0.1.0 <0.2.0" },
      person: null,
      decisions: null,
      signIn: [],
    });
    expect((await h.request(AUTH_ROUTES.login("gh"))).status).toBe(404);
    expect((await h.request(AUTH_ROUTES.logout, { method: "POST" })).status).toBe(404);
  });
});

describe("a Workspace as a second provider", () => {
  it("lists both ways in, lets a named domain's accounts in, and refuses the rest", async () => {
    const git = createFixtureProvider("gh");
    const google = createFixtureProvider("google");
    const h = createHarness(testDatabase, {
      providers: [git, google],
      listed: ["alice"],
      domains: ["acme.test"],
    });
    // Each way in says who gets in through it, for the line under its button.
    expect((await me(h)).signIn).toEqual([
      { key: "gh", label: "GitHub", admits: { organization: null, domains: [] } },
      { key: "google", label: "Google", admits: { organization: null, domains: ["acme.test"] } },
    ]);
    const dave = await h.signIn("dave");
    // The address Google vouched for is the person's work email, which they read on themselves.
    expect((await me(h, dave)).person).toMatchObject({
      login: "dave@acme.test",
      name: "Dave Example",
      role: "member",
      source: "domain",
      email: "dave@acme.test",
    });
    // Erin's account is of no domain, and she is not listed.
    const begun = await h.request(AUTH_ROUTES.login("google"));
    const location = new URL(begun.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.test");
    const state = location.searchParams.get("state") ?? "";
    const refused = await h.request(
      `${AUTH_ROUTES.callback("google")}?code=${google.codeFor("erin", state)}&state=${state}`,
      { headers: { cookie: cookieOf(begun, "console_login") } },
    );
    expect(refused.headers.get("location")).toBe("/?sign_in=refused");
    // Listed by address, Erin is in.
    const listed = createHarness(testDatabase, {
      providers: [google],
      listed: ["Erin@mail.test"],
    });
    expect((await me(listed, await listed.signIn("erin"))).person).toMatchObject({
      login: "erin@mail.test",
      source: "listed",
    });
    // The domain taken away, Dave is out at once; Erin, listed, stays.
    const without = createHarness(testDatabase, { providers: [git, google], listed: ["alice"] });
    expect((await me(without, dave)).person).toBeNull();
    expect((await me(without, await listed.signIn("erin"))).person?.login).toBe("erin@mail.test");
  });

  it("finishes a sign-in only at the provider where it began", async () => {
    const git = createFixtureProvider("gh");
    const h = createHarness(testDatabase, { providers: [git, createFixtureProvider("google")] });
    const begun = await h.request(`${AUTH_ROUTES.login("gh")}?return_to=/tasks`);
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const elsewhere = await h.request(
      `${AUTH_ROUTES.callback("google")}?code=${git.codeFor("alice", state)}&state=${state}`,
      { headers: { cookie: cookieOf(begun, "console_login") } },
    );
    expect(elsewhere.headers.get("location")).toBe("/tasks?sign_in=failed");
    expect(git.calls.exchangeCode).toBe(0);
  });

  it("gives the address Google vouches for to whoever signs in with it, off another person an administrator wrote it on (ADR-0069)", async () => {
    const h = createHarness(testDatabase, {
      providers: [createFixtureProvider("gh"), createFixtureProvider("google")],
      listed: ["alice", "bob"],
      admins: ["alice"],
      domains: ["acme.test"],
    });
    const admin = await h.signIn("alice");
    const bob = (await me(h, await h.signIn("bob"))).person;
    const dave = (await me(h, await h.signIn("dave"))).person;
    const writeEmail = async (id: string | undefined, email: string | null) => {
      const written = await h.request(`${REST_ROUTES.people}/${id}`, {
        method: "PATCH",
        headers: { cookie: admin, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      expect(written.status, await written.clone().text()).toBe(200);
    };
    // An administrator takes Dave's address off him and writes it on Bob by mistake.
    await writeEmail(dave?.id, null);
    await writeEmail(bob?.id, "dave@acme.test");
    const latest = await latestEvent();
    // Dave signs in at Google again, and is in: the address Google vouches for is his, and Bob gives it up.
    expect((await me(h, await h.signIn("dave"))).person?.email).toBe("dave@acme.test");
    const people = restPeopleSchema.parse(
      await (await h.request(REST_ROUTES.people, { headers: { cookie: admin } })).json(),
    );
    expect(people.items.find((person) => person.id === bob?.id)?.email).toBeNull();
    // The feed says both, as the console's doing, and never the address but in Dave's login.
    expect(await workspaceEventsAfter(latest)).toEqual([
      ["person.email_changed", null, { login: "bob", set: false }],
      ["person.email_changed", null, { login: "dave@acme.test", set: true }],
    ]);
    // Nothing failed on the way, and nothing logged the address.
    expect(JSON.stringify(h.logs)).not.toContain("dave@acme.test");
  });

  it("lets a person in with their address while an administrator writes it on someone else at the same moment (ADR-0069)", async () => {
    const h = createHarness(testDatabase, {
      providers: [createFixtureProvider("gh"), createFixtureProvider("google")],
      listed: ["alice", "bob"],
      admins: ["alice"],
      domains: ["acme.test"],
    });
    const admin = await h.signIn("alice");
    const bob = (await me(h, await h.signIn("bob"))).person;
    const dave = (await me(h, await h.signIn("dave"))).person;
    const writeEmail = (id: string | undefined, email: string | null) =>
      h.request(`${REST_ROUTES.people}/${id}`, {
        method: "PATCH",
        headers: { cookie: admin, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    for (let round = 0; round < 10; round += 1) {
      expect((await writeEmail(dave?.id, null)).status).toBe(200);
      const [written, signedIn] = await Promise.all([
        writeEmail(bob?.id, "dave@acme.test"),
        h.signIn("dave"),
      ]);
      // Whichever comes first, Dave is in with his address: Bob is refused it, or gives it up.
      expect([200, 409]).toContain(written.status);
      expect((await me(h, signedIn)).person?.email).toBe("dave@acme.test");
    }
    const people = restPeopleSchema.parse(
      await (await h.request(REST_ROUTES.people, { headers: { cookie: admin } })).json(),
    );
    expect(people.items.find((person) => person.id === bob?.id)?.email).toBeNull();
  });

  it("writes the address Google gives at a later sign-in, and tells the feed that it changed, once (ADR-0069)", async () => {
    const h = createHarness(testDatabase, {
      providers: [createFixtureProvider("google")],
      domains: ["acme.test"],
    });
    const before = (await me(h, await h.signIn("dave"))).person;
    expect(before?.email).toBe("dave@acme.test");
    const latest = await latestEvent();
    // The Workspace renamed Dave's account: the same account, under another address.
    const renamed = createHarness(testDatabase, {
      providers: [
        createFixtureProvider("google", {
          changed: { dave: { login: "dave.example@acme.test", email: "dave.example@acme.test" } },
        }),
      ],
      domains: ["acme.test"],
    });
    expect((await me(renamed, await renamed.signIn("dave"))).person).toMatchObject({
      id: before?.id,
      login: "dave.example@acme.test",
      email: "dave.example@acme.test",
    });
    // Signed in again with it, nothing changed, and nothing is said.
    await renamed.signIn("dave");
    expect(await workspaceEventsAfter(latest)).toEqual([
      ["person.email_changed", null, { login: "dave.example@acme.test", set: true }],
    ]);
  });

  it("gives the address to an account Google made again under another id, off the old one's person (ADR-0069)", async () => {
    const h = createHarness(testDatabase, {
      providers: [createFixtureProvider("google")],
      domains: ["acme.test"],
    });
    const old = (await me(h, await h.signIn("dave"))).person;
    expect(old?.email).toBe("dave@acme.test");
    const latest = await latestEvent();
    const again = createHarness(testDatabase, {
      providers: [createFixtureProvider("google", { changed: { dave: { accountId: "2101" } } })],
      domains: ["acme.test"],
    });
    const remade = (await me(again, await again.signIn("dave"))).person;
    expect(remade).toMatchObject({ login: "dave@acme.test", email: "dave@acme.test" });
    expect(remade?.id).not.toBe(old?.id);
    // The old account's person gives the address up, and the new one joins with it.
    expect(await workspaceEventsAfter(latest)).toEqual([
      ["person.email_changed", null, { login: "dave@acme.test", set: false }],
      ["person.joined", "dave@acme.test", {}],
    ]);
  });
});
