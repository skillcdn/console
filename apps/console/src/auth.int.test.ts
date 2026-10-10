import { AUTH_ROUTES, REST_ROUTES, restMeSchema } from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listEventsAfter } from "./db/queries/events.js";
import { ensureWorkspace } from "./db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
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
      workspace: { name: "Acme", tokenDaysAtMost: null },
      language: null,
      person: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        login: "Alice",
        name: "Alice Example",
        avatar: "https://avatars.example/alice.png",
        role: "member",
      },
      signIn: [{ key: "gh", label: "GitHub" }],
    });
    expect(await me(h)).toEqual({
      workspace: { name: "Acme", tokenDaysAtMost: null },
      language: null,
      person: null,
      signIn: [{ key: "gh", label: "GitHub" }],
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

  it("refuses someone the operator did not list, and writes nothing down about them", async () => {
    const { request, login } = harness({ members: ["alice"] });
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

  it("ends when its time is up, and lives longer while it is used", async () => {
    const clock = movableClock();
    const h = harness({ clock, sessionTtlMs: 10 * 60_000 });
    const cookie = await h.signIn("alice");
    clock.advance(9 * 60_000);
    expect((await me(h, cookie)).person?.login).toBe("Alice");
    clock.advance(2 * 60_000);
    expect((await me(h, cookie)).person).toBeNull();
  });

  it("ends at once for a login taken off the list, and the cookie goes with the answer", async () => {
    const login = createFixtureProvider();
    const h = harness({ login, members: ["alice", "bob"] });
    const cookie = await h.signIn("bob");
    expect((await me(h, cookie)).person?.login).toBe("bob");
    const without = harness({ login, members: ["alice"] });
    const answer = await without.request(REST_ROUTES.me, { headers: { cookie } });
    expect(restMeSchema.parse(await answer.json()).person).toBeNull();
    expect(answer.headers.getSetCookie()[0]).toMatch(/^__Host-console_session=; .*Max-Age=0/);
  });

  it("is nobody's with a cookie that was not handed out here", async () => {
    const h = harness();
    expect((await me(h, "__Host-console_session=cns_s_forged")).person).toBeNull();
    expect((await me(h, "console_session=; other=1")).person).toBeNull();
  });
});

describe("a deployment where nobody signs in", () => {
  it("has no sign-in routes, and says so", async () => {
    const h = createHarness(testDatabase);
    expect(await me(h)).toEqual({
      workspace: { name: "Acme", tokenDaysAtMost: null },
      language: null,
      person: null,
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
      members: ["alice"],
      domains: ["acme.test"],
    });
    expect((await me(h)).signIn).toEqual([
      { key: "gh", label: "GitHub" },
      { key: "google", label: "Google" },
    ]);
    const dave = await h.signIn("dave");
    expect((await me(h, dave)).person).toMatchObject({
      login: "dave@acme.test",
      name: "Dave Example",
      role: "member",
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
      members: ["Erin@mail.test"],
    });
    expect((await me(listed, await listed.signIn("erin"))).person?.login).toBe("erin@mail.test");
    // The domain taken away, Dave is out at once.
    const without = createHarness(testDatabase, { providers: [git, google], members: ["alice"] });
    expect((await me(without, dave)).person).toBeNull();
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
});
