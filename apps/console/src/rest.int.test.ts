import {
  MAX_TITLE_LENGTH,
  REST_ROUTES,
  type RestTask,
  restDecisionSchema,
  restDecisionsSchema,
  restErrorSchema,
  restEventsSchema,
  restPeopleSchema,
  restTaskSchema,
  restTasksSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureLogin } from "./testing/fixture-login.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, { login: createFixtureLogin() });
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
