import {
  DEFAULT_TOKEN_DAYS,
  MAX_TITLE_LENGTH,
  MAX_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKENS_PER_PERSON,
  REST_ROUTES,
  type RestTask,
  restDecisionSchema,
  restDecisionsSchema,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restPeopleSchema,
  restPersonSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
  restTokensSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, { providers: [createFixtureProvider()] });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
});

afterAll(async () => {
  await testDatabase?.drop();
});

/** A request from the console's own pages, as the browser of a signed-in person sends one. */
const send = (cookie: string, method: "POST" | "PATCH", path: string, body: unknown) =>
  h.request(path, {
    method,
    headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const get = (cookie: string, path: string) => h.request(path, { headers: { cookie } });

const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;

async function createTask(cookie: string, body: unknown): Promise<RestTask> {
  const response = await send(cookie, "POST", REST_ROUTES.tasks, body);
  expect(response.status).toBe(201);
  return restTaskSchema.parse(await response.json());
}

describe("who may ask", () => {
  it("answers nobody with a refusal, on every route", async () => {
    for (const path of [
      REST_ROUTES.people,
      REST_ROUTES.tasks,
      `${REST_ROUTES.tasks}/0199c4d8-0000-7000-8000-000000000010`,
      REST_ROUTES.decisions,
      REST_ROUTES.events,
      `${REST_ROUTES.events}/stream`,
    ]) {
      const response = await h.request(path);
      expect(response.status, path).toBe(401);
      expect(await errorOf(response)).toBe("auth.required");
    }
    expect((await h.request(REST_ROUTES.tasks, { method: "POST" })).status).toBe(403);
  });

  it("takes a change only from the console's own pages", async () => {
    const elsewhere = await h.request(REST_ROUTES.tasks, {
      method: "POST",
      headers: { cookie: alice, origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify({ title: "Planted" }),
    });
    expect(elsewhere.status).toBe(403);
    expect(await errorOf(elsewhere)).toBe("auth.forbidden_origin");
    const noOrigin = await h.request(REST_ROUTES.tasks, {
      method: "POST",
      headers: { cookie: alice, "content-type": "application/json" },
      body: JSON.stringify({ title: "Planted" }),
    });
    expect(noOrigin.status).toBe(403);
  });
});

describe("tasks", () => {
  it("are written, numbered, listed newest first, and read back as the schema says", async () => {
    const first = await createTask(alice, { title: "  Write the release notes  " });
    expect(first).toMatchObject({
      title: "Write the release notes",
      state: "idea",
      priority: "normal",
      body: "",
      assignee: null,
      parentId: null,
      links: [],
      openDecisions: 0,
    });
    expect(first.owner.login).toBe("Alice");
    const second = await createTask(bob, {
      title: "Ship",
      body: "# Plan\n",
      state: "ready",
      priority: "high",
      assigneeId: first.owner.id,
      links: [{ url: "https://github.com/acme/app/pull/1", label: "the pull request" }],
    });
    expect(second.number).toBe(first.number + 1);
    expect(second.assignee?.login).toBe("Alice");

    const listed = restTasksSchema.parse(await (await get(alice, REST_ROUTES.tasks)).json());
    expect(listed.items.slice(0, 2).map((task) => task.id)).toEqual([second.id, first.id]);
    const ready = restTasksSchema.parse(
      await (await get(alice, `${REST_ROUTES.tasks}?state=ready`)).json(),
    );
    expect(ready.items.every((task) => task.state === "ready")).toBe(true);
    expect(ready.items.some((task) => task.id === second.id)).toBe(true);
    const one = await get(bob, `${REST_ROUTES.tasks}/${second.id}`);
    expect(one.headers.get("cache-control")).toBe("no-store");
    expect(restTaskSchema.parse(await one.json())).toEqual(second);
  });

  it("refuse what the schema refuses, and say what is wrong", async () => {
    for (const [body, expected] of [
      [{ title: "" }, /title/],
      [{ title: "t".repeat(MAX_TITLE_LENGTH + 1) }, /title/],
      [{ title: "ok", state: "started" }, /state/],
      [{ title: "ok", links: [{ url: "javascript:alert(1)" }] }, /links/],
      [{ title: "ok", assigneeId: "alice" }, /assigneeId/],
      ["not json", /readable/],
    ] as const) {
      const response = await h.request(REST_ROUTES.tasks, {
        method: "POST",
        headers: { cookie: alice, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      const error = restErrorSchema.parse(await response.json()).error;
      expect(error.code).toBe("request.invalid");
      expect(error.message).toMatch(expected);
    }
    const huge = await h.request(REST_ROUTES.tasks, {
      method: "POST",
      headers: { cookie: alice, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ title: "ok", body: "x".repeat(300_000) }),
    });
    expect(huge.status).toBe(413);
    expect(await errorOf(huge)).toBe("request.too_large");
  });

  it("refuse an assignee who is nobody here, and a parent that is not a task", async () => {
    const stranger = await send(alice, "POST", REST_ROUTES.tasks, {
      title: "ok",
      assigneeId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(stranger.status).toBe(400);
    expect(await errorOf(stranger)).toBe("task.invalid_assignee");
    const orphan = await send(alice, "POST", REST_ROUTES.tasks, {
      title: "ok",
      parentId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(await errorOf(orphan)).toBe("task.invalid_parent");
  });

  it("move along and change, and say so in the feed", async () => {
    const task = await createTask(alice, { title: "Review the design" });
    const before = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=0`)).json(),
    );
    const latest = before.items.at(-1)?.id ?? 0;

    const moved = await send(bob, "PATCH", `${REST_ROUTES.tasks}/${task.id}`, {
      state: "in_progress",
    });
    expect(moved.status).toBe(200);
    expect(restTaskSchema.parse(await moved.json()).state).toBe("in_progress");
    const edited = await send(bob, "PATCH", `${REST_ROUTES.tasks}/${task.id}`, {
      title: "Review the design, again",
      priority: "urgent",
    });
    expect(restTaskSchema.parse(await edited.json())).toMatchObject({
      title: "Review the design, again",
      priority: "urgent",
      state: "in_progress",
    });

    const since = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=${latest}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.actor?.login, event.taskId])).toEqual([
      ["task.moved", "bob", task.id],
      ["task.updated", "bob", task.id],
    ]);
    expect(since.items[0]?.data).toEqual({
      number: task.number,
      title: "Review the design",
      from: "idea",
      to: "in_progress",
    });
    expect(since.more).toBe(false);
  });

  it("are not found by an id that is nothing, and never by a non-id", async () => {
    for (const id of ["0199c4d8-0000-7000-8000-000000000099", "not-an-id", "..%2F"]) {
      const response = await get(alice, `${REST_ROUTES.tasks}/${id}`);
      expect(response.status, id).toBe(404);
      expect(await errorOf(response)).toBe("task.not_found");
      const patched = await send(alice, "PATCH", `${REST_ROUTES.tasks}/${id}`, { state: "done" });
      expect(patched.status, id).toBe(404);
    }
  });
});

describe("decisions", () => {
  it("are raised about a task or not, listed with the waiting first, and answered once", async () => {
    const task = await createTask(alice, { title: "Choose a database" });
    const raised = await send(alice, "POST", REST_ROUTES.decisions, {
      question: "Which one?",
      body: "Both work.",
      options: [{ label: "The first" }, { label: "The second" }],
      taskId: task.id,
    });
    expect(raised.status).toBe(201);
    const decision = restDecisionSchema.parse(await raised.json());
    expect(decision).toMatchObject({
      question: "Which one?",
      options: [
        { id: "1", label: "The first" },
        { id: "2", label: "The second" },
      ],
      taskId: task.id,
      answer: null,
    });
    expect(decision.raisedBy.login).toBe("Alice");
    expect(
      restTaskSchema.parse(await (await get(alice, `${REST_ROUTES.tasks}/${task.id}`)).json())
        .openDecisions,
    ).toBe(1);

    const open = restDecisionsSchema.parse(
      await (await get(bob, `${REST_ROUTES.decisions}?open=true`)).json(),
    );
    expect(open.items.some((item) => item.id === decision.id)).toBe(true);
    const about = restDecisionsSchema.parse(
      await (await get(bob, `${REST_ROUTES.decisions}?task=${task.id}`)).json(),
    );
    expect(about.items.map((item) => item.id)).toEqual([decision.id]);

    const wrong = await send(bob, "POST", `${REST_ROUTES.decisions}/${decision.id}/answer`, {
      option: "3",
    });
    expect(wrong.status).toBe(400);
    expect(await errorOf(wrong)).toBe("decision.no_such_option");
    const answered = await send(bob, "POST", `${REST_ROUTES.decisions}/${decision.id}/answer`, {
      option: "2",
      note: "Shorter.",
    });
    expect(answered.status).toBe(200);
    const answer = restDecisionSchema.parse(await answered.json()).answer;
    expect(answer).toMatchObject({ option: "2", note: "Shorter." });
    expect(answer?.by.login).toBe("bob");
    const again = await send(alice, "POST", `${REST_ROUTES.decisions}/${decision.id}/answer`, {
      option: "1",
    });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("decision.answered");
    expect(
      restDecisionSchema.parse(
        await (await get(alice, `${REST_ROUTES.decisions}/${decision.id}`)).json(),
      ).answer?.option,
    ).toBe("2");
  });

  it("refuse one about a task that is nothing, too few options, and an id that is nothing", async () => {
    const orphan = await send(alice, "POST", REST_ROUTES.decisions, {
      question: "About nothing?",
      options: [{ label: "a" }, { label: "b" }],
      taskId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(orphan.status).toBe(400);
    expect(await errorOf(orphan)).toBe("decision.invalid_task");
    const few = await send(alice, "POST", REST_ROUTES.decisions, {
      question: "Alone?",
      options: [{ label: "a" }],
    });
    expect(await errorOf(few)).toBe("request.invalid");
    expect((await get(alice, `${REST_ROUTES.decisions}/not-an-id`)).status).toBe(404);
    expect(
      (
        await send(
          alice,
          "POST",
          `${REST_ROUTES.decisions}/0199c4d8-0000-7000-8000-000000000099/answer`,
          {
            option: "1",
          },
        )
      ).status,
    ).toBe(404);
  });
});

describe("people and the feed", () => {
  it("list everyone who signed in, by login", async () => {
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    expect(people.items.map((person) => person.login)).toEqual(["Alice", "bob"]);
  });

  it("page the feed from a number on, and refuse a cursor that is not one", async () => {
    const page = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=0&limit=2`)).json(),
    );
    expect(page.items).toHaveLength(2);
    expect(page.more).toBe(true);
    expect(page.items[0]?.kind).toBe("person.joined");
    const rest = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=${page.items[1]?.id}`)).json(),
    );
    expect(rest.more).toBe(false);
    expect((await get(alice, `${REST_ROUTES.events}?after=-1`)).status).toBe(400);
    expect((await get(alice, `${REST_ROUTES.events}?limit=1000`)).status).toBe(400);
  });
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

describe("tokens", () => {
  const DAY_MS = 86_400_000;
  const make = async (cookie: string, body: unknown) => {
    const response = await send(cookie, "POST", REST_ROUTES.tokens, body);
    expect(response.status).toBe(201);
    return restTokenCreatedSchema.parse(await response.json());
  };
  const remove = (cookie: string, id: string) =>
    h.request(`${REST_ROUTES.tokens}/${id}`, {
      method: "DELETE",
      headers: { cookie, origin: SIGN_IN_URL },
    });
  const listed = async (cookie: string) =>
    restTokensSchema.parse(await (await get(cookie, REST_ROUTES.tokens)).json()).items;

  it("are made on the console's own pages, listed newest first, and taken away", async () => {
    const { token, secret } = await make(alice, { name: "  Claude Code on the laptop  " });
    expect(secret).toMatch(/^cns_t_[\w-]{40,}$/);
    expect(token).toMatchObject({ name: "Claude Code on the laptop", lastUsedAt: null });
    const lasts = new Date(token.expiresAt ?? 0).getTime() - new Date(token.createdAt).getTime();
    expect(lasts).toBe(DEFAULT_TOKEN_DAYS * DAY_MS);
    const second = await make(alice, { name: "ci", expiresInDays: 7 });
    expect(
      new Date(second.token.expiresAt ?? 0).getTime() - new Date(second.token.createdAt).getTime(),
    ).toBe(7 * DAY_MS);
    const forever = await make(alice, { name: "forever", expiresInDays: null });
    expect(forever.token.expiresAt).toBeNull();

    const mine = await listed(alice);
    expect(mine.map((item) => item.name)).toEqual(["forever", "ci", "Claude Code on the laptop"]);
    // The page sees names and dates, never a secret.
    expect(JSON.stringify(mine)).not.toContain("cns_t_");
    // Bob sees his own, which are none, and cannot take Alice's away.
    expect(await listed(bob)).toEqual([]);
    expect((await remove(bob, token.id)).status).toBe(404);

    expect((await remove(alice, second.token.id)).status).toBe(204);
    expect((await remove(alice, second.token.id)).status).toBe(404);
    expect((await remove(alice, "not-an-id")).status).toBe(404);
    expect((await listed(alice)).map((item) => item.id)).toEqual([forever.token.id, token.id]);
    expect(JSON.stringify(h.logs)).not.toContain("cns_t_");
  });

  it("act as their person over the API, with no origin needed, and are noted as used", async () => {
    const { token, secret } = await make(alice, { name: "a script" });
    const auth = { authorization: `Bearer ${secret}` };
    const me = restMeSchema.parse(
      await (await h.request(REST_ROUTES.me, { headers: auth })).json(),
    );
    expect(me.person?.login).toBe("Alice");
    const created = await h.request(REST_ROUTES.tasks, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: "Written by a script" }),
    });
    expect(created.status).toBe(201);
    const task = restTaskSchema.parse(await created.json());
    expect(task.owner.login).toBe("Alice");
    const events = restEventsSchema.parse(
      await (await h.request(`${REST_ROUTES.events}?after=0`, { headers: auth })).json(),
    );
    expect(events.items.at(-1)).toMatchObject({ kind: "task.created", taskId: task.id });
    expect(events.items.at(-1)?.actor?.login).toBe("Alice");
    const used = (await listed(alice)).find((item) => item.id === token.id);
    expect(used?.lastUsedAt).not.toBeNull();
  });

  it("are refused when they are nothing, taken away, expired, or no longer a member's", async () => {
    for (const header of [
      "Bearer cns_t_nonsense",
      "Bearer",
      "Basic Y25zX3RfeDp4",
      "Bearer cns_s_not-a-token",
      "Token cns_t_x",
    ]) {
      const response = await h.request(REST_ROUTES.tasks, { headers: { authorization: header } });
      expect(response.status, header).toBe(401);
      expect(await errorOf(response)).toBe("auth.required");
    }
    // A token that is nothing is refused beside a good session too: the token is the credential.
    const beside = await h.request(REST_ROUTES.tasks, {
      headers: { cookie: alice, authorization: "Bearer cns_t_nonsense" },
    });
    expect(beside.status).toBe(401);
    expect(beside.headers.getSetCookie()).toEqual([]);

    const { token, secret } = await make(alice, { name: "short-lived" });
    expect((await remove(alice, token.id)).status).toBe(204);
    const gone = await h.request(REST_ROUTES.tasks, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(gone.status).toBe(401);

    const clock = movableClock();
    const later = createHarness(testDatabase, { providers: [createFixtureProvider()], clock });
    const cookie = await later.signIn("alice");
    const made = await later.request(REST_ROUTES.tokens, {
      method: "POST",
      headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ name: "a day", expiresInDays: 1 }),
    });
    const aDay = restTokenCreatedSchema.parse(await made.json());
    const bearer = { authorization: `Bearer ${aDay.secret}` };
    expect((await later.request(REST_ROUTES.tasks, { headers: bearer })).status).toBe(200);
    clock.advance(2 * DAY_MS);
    expect((await later.request(REST_ROUTES.tasks, { headers: bearer })).status).toBe(401);
    const left = restTokensSchema.parse(
      await (await later.request(REST_ROUTES.tokens, { headers: { cookie } })).json(),
    );
    expect(left.items.some((item) => item.id === aDay.token.id)).toBe(false);
    // One made without an expiry is good whenever.
    const forever = restTokenCreatedSchema.parse(
      await (
        await later.request(REST_ROUTES.tokens, {
          method: "POST",
          headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
          body: JSON.stringify({ name: "forever", expiresInDays: null }),
        })
      ).json(),
    );
    clock.advance(3650 * DAY_MS);
    expect(
      (
        await later.request(REST_ROUTES.tasks, {
          headers: { authorization: `Bearer ${forever.secret}` },
        })
      ).status,
    ).toBe(200);

    // Membership is decided on every request, for a token as for a session.
    const { secret: whileListed } = await make(alice, { name: "while listed" });
    const bobOnly = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      members: ["bob"],
    });
    const out = await bobOnly.request(REST_ROUTES.tasks, {
      headers: { authorization: `Bearer ${whileListed}` },
    });
    expect(out.status).toBe(401);
  });

  it("cannot be made, listed or taken away with a token, nor from elsewhere", async () => {
    const { token, secret } = await make(alice, { name: "a leak" });
    const auth = { authorization: `Bearer ${secret}` };
    const list = await h.request(REST_ROUTES.tokens, { headers: auth });
    expect(list.status).toBe(403);
    expect(await errorOf(list)).toBe("auth.session_required");
    const successor = await h.request(REST_ROUTES.tokens, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "a successor" }),
    });
    expect(successor.status).toBe(403);
    const removal = await h.request(`${REST_ROUTES.tokens}/${token.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(removal.status).toBe(403);
    expect((await listed(alice)).some((item) => item.id === token.id)).toBe(true);

    const elsewhere = await h.request(REST_ROUTES.tokens, {
      method: "POST",
      headers: { cookie: alice, origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify({ name: "planted" }),
    });
    expect(elsewhere.status).toBe(403);
    expect(await errorOf(elsewhere)).toBe("auth.forbidden_origin");
    expect((await h.request(REST_ROUTES.tokens)).status).toBe(401);
  });

  it("are bounded in name, in days, and in how many a person holds", async () => {
    for (const body of [
      { name: " " },
      { name: "n".repeat(MAX_TOKEN_NAME_LENGTH + 1) },
      { name: `a${String.fromCodePoint(0x200b)}b` },
      { name: "ok", expiresInDays: 0 },
      { name: "ok", expiresInDays: MAX_TOKEN_DAYS + 1 },
      { name: "ok", expiresInDays: "never" },
      {},
    ]) {
      const response = await send(alice, "POST", REST_ROUTES.tokens, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    }
    const carol = await h.signIn("carol");
    for (let n = 0; n < MAX_TOKENS_PER_PERSON; n += 1) {
      await make(carol, { name: `token ${n}` });
    }
    const oneMore = await send(carol, "POST", REST_ROUTES.tokens, { name: "one too many" });
    expect(oneMore.status).toBe(409);
    expect(await errorOf(oneMore)).toBe("token.too_many");
    expect(await listed(carol)).toHaveLength(MAX_TOKENS_PER_PERSON);
  });
});

describe("roles", () => {
  it("are changed by an administrator signed in, kept to at least one, and told to the board", async () => {
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["alice"],
    });
    const admin = await named.signIn("alice");
    const change = (cookie: string, id: string, body: unknown) =>
      named.request(`${REST_ROUTES.people}/${id}`, {
        method: "PATCH",
        headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    const aliceId = people.items.find((person) => person.login === "Alice")?.id ?? "";
    const bobId = people.items.find((person) => person.login === "bob")?.id ?? "";

    // A member may not, a token may not, and nobody may from elsewhere.
    const byMember = await change(bob, aliceId, { role: "member" });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const { secret } = restTokenCreatedSchema.parse(
      await (
        await named.request(REST_ROUTES.tokens, {
          method: "POST",
          headers: { cookie: admin, origin: SIGN_IN_URL, "content-type": "application/json" },
          body: JSON.stringify({ name: "an administrator's agent" }),
        })
      ).json(),
    );
    const byToken = await named.request(`${REST_ROUTES.people}/${bobId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(byToken.status).toBe(403);
    expect(await errorOf(byToken)).toBe("auth.session_required");

    // The last administrator stays one.
    const last = await change(admin, aliceId, { role: "member" });
    expect(last.status).toBe(409);
    expect(await errorOf(last)).toBe("person.last_admin");

    const before = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=0`)).json(),
    );
    const latest = before.items.at(-1)?.id ?? 0;
    const promoted = await change(admin, bobId, { role: "admin" });
    expect(promoted.status).toBe(200);
    expect(restPersonSchema.parse(await promoted.json())).toMatchObject({
      login: "bob",
      role: "admin",
    });
    expect(
      (await (await named.request(REST_ROUTES.me, { headers: { cookie: bob } })).json()) as {
        person: { role: string };
      },
    ).toMatchObject({ person: { role: "admin" } });
    // Now Alice may step down, and the board is told of both.
    expect((await change(admin, aliceId, { role: "member" })).status).toBe(200);
    const since = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=${latest}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.actor?.login, event.data])).toEqual([
      ["person.role_changed", "Alice", { login: "bob", role: "admin" }],
      ["person.role_changed", "Alice", { login: "Alice", role: "member" }],
    ]);
    // Said again, nothing is written; and what is not a person is not found.
    expect((await change(bob, aliceId, { role: "member" })).status).toBe(200);
    expect(
      (await change(bob, "0199c4d8-0000-7000-8000-000000000099", { role: "admin" })).status,
    ).toBe(404);
    expect((await change(bob, "nobody", { role: "admin" })).status).toBe(404);
    expect((await change(bob, aliceId, { role: "owner" })).status).toBe(400);
    const after = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=${latest}`)).json(),
    );
    expect(after.items).toHaveLength(2);
  });
});
