import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  projectPath,
  REST_ROUTES,
  restAgentSchema,
  restClaimSchema,
  restConnectionSchema,
  restConnectRequestSchema,
  restErrorSchema,
  restEventsSchema,
  restManagerSchema,
  restMeSchema,
  restPeopleSchema,
  restRunSchema,
  restSessionsSchema,
  restTaskSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The command signed in as the account itself (ADR-0084): a connection that asks to be the
// account, approved by the account with "this is me", yields a session of the command's, which
// is presented as a token is, held to what a token may ask, kept while it is used, and seen and
// ended by the account and by its supervisors. On a database of its own, with a clock the test
// moves.

const DAY = 86_400_000;
const START = Date.parse("2026-11-10T09:00:00.000Z");

let testDatabase: TestDatabase;
let h: Harness;
let now = START;
let alice: string;
let bob: string;
let mira: string;
let aliceId: string;
let bobId: string;
let miraId: string;

const JSON_HEADERS = { "content-type": "application/json" };
const fromPages = (cookie: string) => ({ cookie, origin: SIGN_IN_URL });
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
const get = (headers: Record<string, string>, path: string) => h.request(path, { headers });
const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: { ...headers, ...JSON_HEADERS },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;
const meOf = async (headers: Record<string, string>) =>
  restMeSchema.parse(await (await get(headers, REST_ROUTES.me)).json());

/** A connection begun by a command, approved by whoever the cookie signs in, and claimed: what the command then holds. */
async function signInCommand(cookie: string, name: string) {
  const begun = await send({}, "POST", REST_ROUTES.connect, { agent: name, as: "self" });
  expect(begun.status).toBe(201);
  const connection = restConnectionSchema.parse(await begun.json());
  const approved = await send(fromPages(cookie), "POST", connectPath(connection.code, "approve"));
  expect(approved.status).toBe(200);
  const claimed = await send({}, "POST", CLAIM_PATH, { secret: connection.secret });
  expect(claimed.status).toBe(200);
  const claim = restClaimSchema.parse(await claimed.json());
  if (claim.status !== "signed_in") {
    throw new Error(`the claim answered ${claim.status}`);
  }
  return claim;
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice", "bob"],
    clock: { now: () => new Date(now) },
    sessionTtlMs: 30 * DAY,
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  aliceId = (await meOf({ cookie: alice })).person?.id ?? "";
  bobId = (await meOf({ cookie: bob })).person?.id ?? "";
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  const made = await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "gh",
    login: "carol",
    handle: "mira",
    name: "Mira",
    managerId: bobId,
    project: "ops",
  });
  expect(made.status).toBe(201);
  miraId = restAgentSchema.parse(await made.json()).person.id;
  mira = await h.signIn("carol");
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the command signed in as the account itself (ADR-0084)", () => {
  let secret: string;
  let sessionId: string;

  it("asks to be the account, is told 'this is me' by the account, and is handed a session once", async () => {
    const begun = await send({}, "POST", REST_ROUTES.connect, {
      agent: "console on mac-mini",
      as: "self",
    });
    expect(begun.status).toBe(201);
    const connection = restConnectionSchema.parse(await begun.json());
    // The page says what is asked: to be the account, where an agent asks for a token.
    const asked = await get({ cookie: mira }, connectPath(connection.code));
    expect(restConnectRequestSchema.parse(await asked.json())).toMatchObject({
      agent: "console on mac-mini",
      as: "self",
      approved: false,
    });
    const waiting = await send({}, "POST", CLAIM_PATH, { secret: connection.secret });
    expect(waiting.status).toBe(202);
    // Said on the console's own pages, by whoever is signed in there; nothing to name or date.
    const foreign = await send({ cookie: mira }, "POST", connectPath(connection.code, "approve"));
    expect(foreign.status).toBe(403);
    const approved = await send(fromPages(mira), "POST", connectPath(connection.code, "approve"));
    expect(approved.status).toBe(200);
    expect(restConnectRequestSchema.parse(await approved.json()).approved).toBe(true);

    const claimed = await send(
      { "user-agent": "skillcdn-console/0.1.18 (cli; node 24.0.0; darwin)" },
      "POST",
      CLAIM_PATH,
      { secret: connection.secret },
    );
    expect(claimed.status).toBe(200);
    const claim = restClaimSchema.parse(await claimed.json());
    expect(claim.status).toBe("signed_in");
    if (claim.status !== "signed_in") {
      return;
    }
    expect(claim.secret).toMatch(/^cns_a_/);
    expect(claim.session).toMatchObject({ kind: "command", name: "console on mac-mini" });
    secret = claim.secret;
    sessionId = claim.session.id;
    // Handed over once: the request went with it.
    expect((await send({}, "POST", CLAIM_PATH, { secret: connection.secret })).status).toBe(404);
    // A connection that asks for nothing in particular is an agent's, as it always was.
    const plain = await send({}, "POST", REST_ROUTES.connect, { agent: "An agent" });
    const plainCode = restConnectionSchema.parse(await plain.json()).code;
    expect(
      restConnectRequestSchema.parse(
        await (await get({ cookie: mira }, connectPath(plainCode))).json(),
      ).as,
    ).toBe("agent");
  });

  it("is the account on the board: what it does, the account does, with no agent beside it", async () => {
    const me = await meOf(bearer(secret));
    expect(me.person).toMatchObject({ id: miraId, kind: "agent", handle: "mira" });
    // No token asks, and the session says it is the command's.
    expect(me.agent).toBeNull();
    expect(me.session).toEqual({ kind: "command", name: "console on mac-mini" });
    expect((await meOf({ cookie: mira })).session).toEqual({ kind: "browser", name: null });

    const written = await send(bearer(secret), "POST", projectPath("ops", "tasks"), {
      title: "Cut the release",
    });
    expect(written.status).toBe(201);
    const task = restTaskSchema.parse(await written.json());
    expect(task.owner.id).toBe(miraId);
    const events = restEventsSchema.parse(
      await (await get({ cookie: alice }, `${projectPath("ops", "events")}?after=0`)).json(),
    ).items;
    expect(events.find((event) => event.kind === "task.created")).toMatchObject({
      actor: { id: miraId },
      agent: null,
    });
    // A run it begins is called what the command called itself, where nothing else is said.
    const taken = await send(bearer(secret), "POST", projectPath("ops", "runs"), {
      taskId: task.id,
    });
    expect(taken.status).toBe(201);
    expect(restRunSchema.parse(await taken.json())).toMatchObject({
      agent: "console on mac-mini",
      person: { id: miraId },
    });
  });

  it("is held to what a token may ask, and is neither a browser's session nor read as one", async () => {
    // The tokens, the sessions and the approval of a connection stay on the console's own pages.
    for (const [method, path] of [
      ["GET", REST_ROUTES.tokens],
      ["POST", REST_ROUTES.tokens],
      ["GET", REST_ROUTES.sessions],
      ["DELETE", `${REST_ROUTES.sessions}/others`],
      ["GET", agentPath("mira", "sign-ins")],
    ] as const) {
      const refused = await send(bearer(secret), method, path, method === "POST" ? {} : undefined);
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(await errorOf(refused)).toBe("auth.session_required");
    }
    const begun = await send({}, "POST", REST_ROUTES.connect, { agent: "Another", as: "self" });
    const { code } = restConnectionSchema.parse(await begun.json());
    const approving = await send(bearer(secret), "POST", connectPath(code, "approve"));
    expect(approving.status).toBe(403);
    expect(await errorOf(approving)).toBe("auth.session_required");

    // Each kind is read only where it is presented: the command's secret in a cookie is nobody,
    // and a browser's token in the authorization header is nobody.
    const asCookie = await meOf({ cookie: `__Host-console_session=${secret}` });
    expect(asCookie.person).toBeNull();
    const browserToken = mira.split("=")[1] ?? "";
    expect(browserToken).toMatch(/^cns_s_/);
    const asBearer = await get(bearer(browserToken), REST_ROUTES.people);
    expect(asBearer.status).toBe(401);
    expect((await get(bearer("cns_a_nothing"), REST_ROUTES.people)).status).toBe(401);
  });

  it("is seen among the account's sessions, and by its supervisors, who end it", async () => {
    const own = restSessionsSchema.parse(
      await (await get({ cookie: mira }, REST_ROUTES.sessions)).json(),
    );
    expect(own.idleDays).toBe(30);
    expect(own.items.map((item) => [item.kind, item.current, item.name])).toEqual([
      ["browser", true, null],
      ["command", false, "console on mac-mini"],
    ]);
    // Its manager and an administrator see where it is signed in, on the console's own pages.
    for (const supervisor of [bob, alice]) {
      const seen = restSessionsSchema.parse(
        await (await get({ cookie: supervisor }, agentPath("mira", "sign-ins"))).json(),
      );
      expect(seen.items.map((item) => item.kind).sort()).toEqual(["browser", "command"]);
      expect(seen.items.every((item) => !item.current)).toBe(true);
    }
    // Nobody else: the account itself reads its own on its Sessions page, not here, and a
    // supervisor's token reaches no session.
    const itself = await get({ cookie: mira }, agentPath("mira", "sign-ins"));
    expect(itself.status).toBe(403);
    expect(await errorOf(itself)).toBe("auth.forbidden");
    const made = await send(fromPages(bob), "POST", REST_ROUTES.tokens, { name: "bob's agent" });
    const token = restTokenCreatedSchema.parse(await made.json()).secret;
    expect((await get(bearer(token), agentPath("mira", "sign-ins"))).status).toBe(403);
    expect((await get({ cookie: bob }, agentPath("nobody", "sign-ins"))).status).toBe(404);

    // A second command signed in, which the manager ends: it is good for nothing at once.
    const second = await signInCommand(mira, "console on a lost machine");
    expect((await get(bearer(second.secret), REST_ROUTES.people)).status).toBe(200);
    const foreign = await send(
      { cookie: bob },
      "DELETE",
      agentPath("mira", "sign-ins", second.session.id),
    );
    expect(foreign.status).toBe(403);
    const ended = await send(
      fromPages(bob),
      "DELETE",
      agentPath("mira", "sign-ins", second.session.id),
    );
    expect(ended.status).toBe(204);
    expect((await get(bearer(second.secret), REST_ROUTES.people)).status).toBe(401);
    const again = await send(
      fromPages(bob),
      "DELETE",
      agentPath("mira", "sign-ins", second.session.id),
    );
    expect(again.status).toBe(404);
    // The first is untouched.
    expect((await get(bearer(secret), REST_ROUTES.people)).status).toBe(200);
  });

  it("is kept while it is used, and ends when left unused, as a browser's session is", async () => {
    // Used after twenty-nine days, its end moves; the note is written beside the answer.
    now += 29 * DAY;
    expect((await get(bearer(secret), REST_ROUTES.people)).status).toBe(200);
    await expect
      .poll(async () => {
        const listed = restSessionsSchema.parse(
          await (await get({ cookie: await h.signIn("carol") }, REST_ROUTES.sessions)).json(),
        );
        return listed.items.find((item) => item.id === sessionId)?.lastSeenAt;
      })
      .toBe(new Date(now).toISOString());
    // Twenty-nine more: still the account, past the day it would have ended unused.
    now += 29 * DAY;
    expect((await get(bearer(secret), REST_ROUTES.people)).status).toBe(200);
    await expect
      .poll(async () => {
        const listed = restSessionsSchema.parse(
          await (await get({ cookie: await h.signIn("carol") }, REST_ROUTES.sessions)).json(),
        );
        return listed.items.find((item) => item.id === sessionId)?.lastSeenAt;
      })
      .toBe(new Date(now).toISOString());
    // Left alone for longer than a session lasts unused, it has lapsed by itself.
    now += 31 * DAY;
    expect((await get(bearer(secret), REST_ROUTES.people)).status).toBe(401);
    // So have the browsers nobody used meanwhile: everyone signs in again.
    expect((await get({ cookie: alice }, REST_ROUTES.people)).status).toBe(401);
    alice = await h.signIn("alice");
    bob = await h.signIn("bob");
    mira = await h.signIn("carol");
  });

  it("gives itself up as a token does, and is refused with its account when the account is out", async () => {
    const held = await signInCommand(mira, "console on mac-mini");
    expect((await get(bearer(held.secret), REST_ROUTES.people)).status).toBe(200);
    // What `console logout` asks: the session is good for nothing from then on.
    expect((await send(bearer(held.secret), "DELETE", REST_ROUTES.meToken)).status).toBe(204);
    expect((await get(bearer(held.secret), REST_ROUTES.people)).status).toBe(401);

    const kept = await signInCommand(mira, "console on mac-mini");
    const out = await send(fromPages(alice), "PATCH", `${REST_ROUTES.people}/${miraId}`, {
      status: "deactivated",
    });
    expect(out.status).toBe(200);
    // Deactivating the account is how an agent account is stopped for good: every session and
    // token it holds is refused, with the reason (ADR-0044).
    const refused = await get(bearer(kept.secret), REST_ROUTES.people);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("auth.deactivated");
    const back = await send(fromPages(alice), "PATCH", `${REST_ROUTES.people}/${miraId}`, {
      status: "active",
    });
    expect(back.status).toBe(200);
    expect((await get(bearer(kept.secret), REST_ROUTES.people)).status).toBe(200);
  });

  it("is a person's too, who says the same of a command of their own", async () => {
    const held = await signInCommand(bob, "console on bob's laptop");
    const me = await meOf(bearer(held.secret));
    expect(me.person?.id).toBe(bobId);
    expect(me.agent).toBeNull();
    expect(me.session).toEqual({ kind: "command", name: "console on bob's laptop" });
    // An administrator's command configures as they do (ADR-0021), on a session as on a token.
    const admin = await signInCommand(alice, "console on alice's laptop");
    const titled = await send(bearer(admin.secret), "PATCH", `${REST_ROUTES.people}/${bobId}`, {
      title: "Engineer",
    });
    expect(titled.status).toBe(200);
  });
});

describe("what the command asks of a member's line (ADR-0084)", () => {
  it("finds an agent account by its handle wherever a login is taken", async () => {
    const byHandle = restPeopleSchema.parse(
      await (
        await get({ cookie: bob }, `${REST_ROUTES.people}?login=${encodeURIComponent("@mira")}`)
      ).json(),
    );
    expect(byHandle.items.map((person) => person.id)).toEqual([miraId]);
    const byLogin = restPeopleSchema.parse(
      await (await get({ cookie: bob }, `${REST_ROUTES.people}?login=carol`)).json(),
    );
    expect(byLogin.items.map((person) => person.id)).toEqual([miraId]);
    const nobody = restPeopleSchema.parse(
      await (
        await get({ cookie: bob }, `${REST_ROUTES.people}?login=${encodeURIComponent("@nobody")}`)
      ).json(),
    );
    expect(nobody.items).toEqual([]);
  });

  it("says whom a member reports to, and the administrators where there is nobody", async () => {
    const ofMira = restManagerSchema.parse(
      await (await get({ cookie: mira }, REST_ROUTES.meManager)).json(),
    );
    expect(ofMira.manager?.id).toBe(bobId);
    expect(ofMira.administrators.map((person) => person.id)).toEqual([aliceId]);
    // A person with no manager is told the administrators, who stand in.
    const ofBob = restManagerSchema.parse(
      await (await get({ cookie: bob }, REST_ROUTES.meManager)).json(),
    );
    expect(ofBob.manager).toBeNull();
    expect(ofBob.administrators.map((person) => person.login)).toEqual(["Alice"]);
    expect((await get({}, REST_ROUTES.meManager)).status).toBe(401);
  });
});
