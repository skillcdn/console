import {
  CLAIM_PATH,
  connectPath,
  DEFAULT_TOKEN_DAYS,
  MAX_TITLE_LENGTH,
  MAX_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKENS_PER_PERSON,
  personTokensPath,
  projectPath,
  REST_ROUTES,
  type RestTask,
  restClaimSchema,
  restConnectionSchema,
  restConnectRequestSchema,
  restDecisionSchema,
  restDecisionsSchema,
  restDocumentSchema,
  restDocumentsSchema,
  restErrorSchema,
  restEventsSchema,
  restMemberSchema,
  restMembersSchema,
  restMeSchema,
  restPeopleSchema,
  restPersonSchema,
  restProjectSchema,
  restProjectsSchema,
  restSkillsSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
  restTokensSchema,
  restVersionSchema,
  restVersionsSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import type { SkillSource } from "./ports/skill-source.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
/** The project the board's tests work in, open to the workspace, under its key. */
const IN = projectPath("web");

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, { providers: [createFixtureProvider()] });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  await h.project(alice, { key: "web", name: "The web app", visibility: "workspace" });
});

afterAll(async () => {
  await testDatabase?.drop();
});

/** A request from the console's own pages, as the browser of a signed-in person sends one. */
const send = (cookie: string, method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: {
      cookie,
      origin: SIGN_IN_URL,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const get = (cookie: string, path: string) => h.request(path, { headers: { cookie } });

const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;

async function createTask(cookie: string, body: unknown, at = IN): Promise<RestTask> {
  const response = await send(cookie, "POST", `${at}/tasks`, body);
  expect(response.status).toBe(201);
  return restTaskSchema.parse(await response.json());
}

const latestEventIn = async (cookie: string, at = IN) =>
  restEventsSchema.parse(await (await get(cookie, `${at}/events?after=0`)).json()).items.at(-1)
    ?.id ?? 0;

describe("who may ask", () => {
  it("answers nobody with a refusal, on every route", async () => {
    for (const path of [
      REST_ROUTES.people,
      REST_ROUTES.projects,
      REST_ROUTES.events,
      IN,
      `${IN}/members`,
      `${IN}/tasks`,
      `${IN}/tasks/0199c4d8-0000-7000-8000-000000000010`,
      `${IN}/decisions`,
      `${IN}/runs`,
      `${IN}/events`,
      `${IN}/skills`,
      `${IN}/events/stream`,
    ]) {
      const response = await h.request(path);
      expect(response.status, path).toBe(401);
      expect(await errorOf(response)).toBe("auth.required");
    }
    expect((await h.request(`${IN}/tasks`, { method: "POST" })).status).toBe(403);
  });

  it("takes a change only from the console's own pages", async () => {
    const elsewhere = await h.request(`${IN}/tasks`, {
      method: "POST",
      headers: { cookie: alice, origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify({ title: "Planted" }),
    });
    expect(elsewhere.status).toBe(403);
    expect(await errorOf(elsewhere)).toBe("auth.forbidden_origin");
    const noOrigin = await h.request(`${IN}/tasks`, {
      method: "POST",
      headers: { cookie: alice, "content-type": "application/json" },
      body: JSON.stringify({ title: "Planted" }),
    });
    expect(noOrigin.status).toBe(403);
  });
});

describe("projects", () => {
  it("are made on the console's own pages by whoever is signed in, who owns them, and listed as each may see", async () => {
    const made = await send(alice, "POST", REST_ROUTES.projects, {
      key: "docs",
      name: "  The docs  ",
      description: "What we write.",
      skillsAddress: "/gh/Acme/Writing@main",
    });
    expect(made.status).toBe(201);
    const docs = restProjectSchema.parse(await made.json());
    expect(docs).toMatchObject({
      key: "docs",
      name: "The docs",
      description: "What we write.",
      visibility: "private",
      skillsAddress: "/gh/acme/writing@main",
      role: "owner",
      openDecisions: 0,
      openRuns: 0,
    });
    // Alice sees both; Bob only the open one, as a member; a private project is nothing to him.
    const mine = restProjectsSchema.parse(await (await get(alice, REST_ROUTES.projects)).json());
    expect(mine.items.map((project) => [project.key, project.role])).toEqual([
      ["docs", "owner"],
      ["web", "owner"],
    ]);
    const his = restProjectsSchema.parse(await (await get(bob, REST_ROUTES.projects)).json());
    expect(his.items.map((project) => [project.key, project.role])).toEqual([["web", "member"]]);
    for (const path of [
      projectPath("docs"),
      `${projectPath("docs")}/tasks`,
      `${projectPath("docs")}/members`,
      `${projectPath("docs")}/events`,
      `${projectPath("docs")}/skills`,
      projectPath("nothing"),
      `${REST_ROUTES.projects}/Not-A-Key`,
      `${REST_ROUTES.projects}/${"k".repeat(41)}`,
    ]) {
      const response = await get(bob, path);
      expect(response.status, path).toBe(404);
      expect(await errorOf(response)).toBe("project.not_found");
    }
    const one = restProjectSchema.parse(await (await get(alice, projectPath("docs"))).json());
    expect(one).toEqual(docs);
    const open = restProjectSchema.parse(await (await get(bob, IN)).json());
    expect(open).toMatchObject({ key: "web", role: "member", visibility: "workspace" });
  });

  it("refuse a key taken, one that is not a key, and an address that is not one", async () => {
    const taken = await send(alice, "POST", REST_ROUTES.projects, { key: "web", name: "Again" });
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe("project.key_taken");
    for (const body of [
      { key: "Web", name: "x" },
      { key: "the web", name: "x" },
      { key: "web-", name: "x" },
      { key: "", name: "x" },
      { key: "ok" },
      { key: "ok", name: "x", visibility: "public" },
    ]) {
      const response = await send(alice, "POST", REST_ROUTES.projects, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    }
    const address = await send(alice, "POST", REST_ROUTES.projects, {
      key: "ok",
      name: "x",
      skillsAddress: "github.com/acme/skills",
    });
    expect(address.status).toBe(400);
    expect(await errorOf(address)).toBe("project.invalid_address");
  });

  it("are configured by an owner signed in: never by a member, never with a token", async () => {
    const changed = await send(alice, "PATCH", projectPath("docs"), {
      name: "Documentation",
      visibility: "workspace",
      skillsAddress: null,
    });
    expect(changed.status).toBe(200);
    expect(restProjectSchema.parse(await changed.json())).toMatchObject({
      name: "Documentation",
      visibility: "workspace",
      skillsAddress: null,
    });
    // Open to the workspace now, Bob sees it as a member, and may not change it.
    const byMember = await send(bob, "PATCH", projectPath("docs"), { name: "Mine" });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const { secret } = restTokenCreatedSchema.parse(
      await (await send(alice, "POST", REST_ROUTES.tokens, { name: "an owner's agent" })).json(),
    );
    const auth = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const byToken = await h.request(projectPath("docs"), {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(byToken.status).toBe(403);
    expect(await errorOf(byToken)).toBe("auth.session_required");
    const madeByToken = await h.request(REST_ROUTES.projects, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ key: "agents", name: "Agents' own" }),
    });
    expect(madeByToken.status).toBe(403);
    expect(await errorOf(madeByToken)).toBe("auth.session_required");
    const badAddress = await send(alice, "PATCH", projectPath("docs"), {
      skillsAddress: "nothing",
    });
    expect(badAddress.status).toBe(400);
    expect(await errorOf(badAddress)).toBe("project.invalid_address");
    // Said again, nothing changes and nothing is written.
    const before = await latestEventIn(alice, projectPath("docs"));
    expect(
      (await send(alice, "PATCH", projectPath("docs"), { name: "Documentation" })).status,
    ).toBe(200);
    expect(await latestEventIn(alice, projectPath("docs"))).toBe(before);
    // Back to private for the tests of its members.
    expect(
      (await send(alice, "PATCH", projectPath("docs"), { visibility: "private" })).status,
    ).toBe(200);
  });

  it("list their members, whom an owner adds, changes and removes, and tell the board", async () => {
    const docs = projectPath("docs");
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    const bobId = people.items.find((person) => person.login === "bob")?.id ?? "";
    const before = await latestEventIn(alice, docs);
    expect((await get(bob, docs)).status).toBe(404);
    const added = await send(alice, "POST", `${docs}/members`, { personId: bobId });
    expect(added.status).toBe(201);
    expect(restMemberSchema.parse(await added.json())).toMatchObject({
      person: { login: "bob" },
      role: "member",
    });
    expect(restProjectSchema.parse(await (await get(bob, docs)).json()).role).toBe("member");
    const listed = restMembersSchema.parse(await (await get(bob, `${docs}/members`)).json());
    expect(listed.items.map((member) => [member.person.login, member.role])).toEqual([
      ["Alice", "owner"],
      ["bob", "member"],
    ]);
    const again = await send(alice, "POST", `${docs}/members`, { personId: bobId, role: "owner" });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("member.exists");
    const stranger = await send(alice, "POST", `${docs}/members`, {
      personId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(stranger.status).toBe(400);
    expect(await errorOf(stranger)).toBe("member.invalid_person");
    // A member may not list others; an owner may make another an owner.
    const byMember = await send(bob, "POST", `${docs}/members`, { personId: bobId });
    expect(byMember.status).toBe(403);
    const promoted = await send(alice, "PATCH", `${docs}/members/${bobId}`, { role: "owner" });
    expect(promoted.status).toBe(200);
    expect(restMemberSchema.parse(await promoted.json()).role).toBe("owner");
    expect(restProjectSchema.parse(await (await get(bob, docs)).json()).role).toBe("owner");
    const removed = await send(bob, "DELETE", `${docs}/members/${bobId}`);
    expect(removed.status).toBe(204);
    expect((await get(bob, docs)).status).toBe(404);
    expect((await send(alice, "DELETE", `${docs}/members/${bobId}`)).status).toBe(404);
    expect((await send(alice, "DELETE", `${docs}/members/nobody`)).status).toBe(404);
    const since = restEventsSchema.parse(
      await (await get(alice, `${docs}/events?after=${before}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.actor?.login, event.data])).toEqual([
      [
        "project.member_added",
        "Alice",
        { key: "docs", name: "Documentation", login: "bob", role: "member" },
      ],
      [
        "project.member_changed",
        "Alice",
        { key: "docs", name: "Documentation", login: "bob", role: "owner" },
      ],
      ["project.member_removed", "bob", { key: "docs", name: "Documentation", login: "bob" }],
    ]);
  });

  it("are every one an administrator's, as owner", async () => {
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["carol"],
    });
    const carol = await named.signIn("carol");
    const all = restProjectsSchema.parse(
      await (await named.request(REST_ROUTES.projects, { headers: { cookie: carol } })).json(),
    );
    expect(all.items.map((project) => [project.key, project.role])).toEqual([
      ["docs", "owner"],
      ["web", "owner"],
    ]);
    const renamed = await named.request(projectPath("docs"), {
      method: "PATCH",
      headers: { cookie: carol, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ description: "Kept by the administrators too." }),
    });
    expect(renamed.status).toBe(200);
  });
});

describe("tasks", () => {
  it("are written, numbered per project, listed newest first, and read back as the schema says", async () => {
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
    // Another project numbers its own from one, and does not find this one's.
    const elsewhere = await createTask(
      alice,
      { title: "The first of the docs" },
      projectPath("docs"),
    );
    expect(elsewhere.number).toBe(1);
    expect((await get(alice, `${IN}/tasks/${elsewhere.id}`)).status).toBe(404);
    expect((await get(alice, `${projectPath("docs")}/tasks/${first.id}`)).status).toBe(404);

    const listed = restTasksSchema.parse(await (await get(alice, `${IN}/tasks`)).json());
    expect(listed.items.slice(0, 2).map((task) => task.id)).toEqual([second.id, first.id]);
    expect(listed.items.some((task) => task.id === elsewhere.id)).toBe(false);
    const ready = restTasksSchema.parse(await (await get(alice, `${IN}/tasks?state=ready`)).json());
    expect(ready.items.every((task) => task.state === "ready")).toBe(true);
    expect(ready.items.some((task) => task.id === second.id)).toBe(true);
    const one = await get(bob, `${IN}/tasks/${second.id}`);
    expect(one.headers.get("cache-control")).toBe("no-store");
    expect(restTaskSchema.parse(await one.json())).toEqual(second);
    expect(
      restTaskSchema.parse(await (await get(bob, `${IN}/tasks/${second.number}`)).json()),
    ).toEqual(second);
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
      const response = await h.request(`${IN}/tasks`, {
        method: "POST",
        headers: { cookie: alice, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      const error = restErrorSchema.parse(await response.json()).error;
      expect(error.code).toBe("request.invalid");
      expect(error.message).toMatch(expected);
    }
    const huge = await h.request(`${IN}/tasks`, {
      method: "POST",
      headers: { cookie: alice, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ title: "ok", body: "x".repeat(300_000) }),
    });
    expect(huge.status).toBe(413);
    expect(await errorOf(huge)).toBe("request.too_large");
  });

  it("refuse an assignee who may not work in the project, and a parent that is not its task", async () => {
    const stranger = await send(alice, "POST", `${IN}/tasks`, {
      title: "ok",
      assigneeId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(stranger.status).toBe(400);
    expect(await errorOf(stranger)).toBe("task.invalid_assignee");
    // Bob is not in the private docs project: not an assignee there, though a person of the workspace.
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    const bobId = people.items.find((person) => person.login === "bob")?.id ?? "";
    const outsider = await send(alice, "POST", `${projectPath("docs")}/tasks`, {
      title: "ok",
      assigneeId: bobId,
    });
    expect(outsider.status).toBe(400);
    expect(await errorOf(outsider)).toBe("task.invalid_assignee");
    const orphan = await send(alice, "POST", `${IN}/tasks`, {
      title: "ok",
      parentId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(await errorOf(orphan)).toBe("task.invalid_parent");
  });

  it("move along and change, and say so in the project's feed", async () => {
    const task = await createTask(alice, { title: "Review the design" });
    const latest = await latestEventIn(alice);

    const moved = await send(bob, "PATCH", `${IN}/tasks/${task.id}`, { state: "in_progress" });
    expect(moved.status).toBe(200);
    expect(restTaskSchema.parse(await moved.json()).state).toBe("in_progress");
    const edited = await send(bob, "PATCH", `${IN}/tasks/${task.id}`, {
      title: "Review the design, again",
      priority: "urgent",
    });
    expect(restTaskSchema.parse(await edited.json())).toMatchObject({
      title: "Review the design, again",
      priority: "urgent",
      state: "in_progress",
    });

    const since = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?after=${latest}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.actor?.login, event.taskId])).toEqual([
      ["task.moved", "bob", task.id],
      ["task.updated", "bob", task.id],
    ]);
    expect(since.items[0]).toMatchObject({
      agent: null,
      data: { number: task.number, title: "Review the design", from: "idea", to: "in_progress" },
    });
    expect(since.items[0]?.projectId).toBe(
      restProjectSchema.parse(await (await get(alice, IN)).json()).id,
    );
    expect(since.more).toBe(false);
    // The feed narrowed to the task is everything that happened to it.
    const history = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?task=${task.id}`)).json(),
    );
    expect(history.items.map((event) => event.kind)).toEqual([
      "task.created",
      "task.moved",
      "task.updated",
    ]);
  });

  it("are not found by an id that is nothing, and never by a non-id", async () => {
    for (const id of ["0199c4d8-0000-7000-8000-000000000099", "not-an-id", "..%2F"]) {
      const response = await get(alice, `${IN}/tasks/${id}`);
      expect(response.status, id).toBe(404);
      expect(await errorOf(response)).toBe("task.not_found");
      const patched = await send(alice, "PATCH", `${IN}/tasks/${id}`, { state: "done" });
      expect(patched.status, id).toBe(404);
    }
  });
});

describe("decisions", () => {
  it("are raised about a task or not, listed with the waiting first, and answered once", async () => {
    const task = await createTask(alice, { title: "Choose a database" });
    const raised = await send(alice, "POST", `${IN}/decisions`, {
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
      restTaskSchema.parse(await (await get(alice, `${IN}/tasks/${task.id}`)).json()).openDecisions,
    ).toBe(1);
    expect(restProjectSchema.parse(await (await get(alice, IN)).json()).openDecisions).toBe(1);

    const open = restDecisionsSchema.parse(
      await (await get(bob, `${IN}/decisions?open=true`)).json(),
    );
    expect(open.items.some((item) => item.id === decision.id)).toBe(true);
    const about = restDecisionsSchema.parse(
      await (await get(bob, `${IN}/decisions?task=${task.id}`)).json(),
    );
    expect(about.items.map((item) => item.id)).toEqual([decision.id]);
    // Another project does not find it.
    expect((await get(alice, `${projectPath("docs")}/decisions/${decision.id}`)).status).toBe(404);

    const wrong = await send(bob, "POST", `${IN}/decisions/${decision.id}/answer`, { option: "3" });
    expect(wrong.status).toBe(400);
    expect(await errorOf(wrong)).toBe("decision.no_such_option");
    const answered = await send(bob, "POST", `${IN}/decisions/${decision.id}/answer`, {
      option: "2",
      note: "Shorter.",
    });
    expect(answered.status).toBe(200);
    const answer = restDecisionSchema.parse(await answered.json()).answer;
    expect(answer).toMatchObject({ option: "2", note: "Shorter." });
    expect(answer?.by.login).toBe("bob");
    const again = await send(alice, "POST", `${IN}/decisions/${decision.id}/answer`, {
      option: "1",
    });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("decision.answered");
    expect(
      restDecisionSchema.parse(await (await get(alice, `${IN}/decisions/${decision.id}`)).json())
        .answer?.option,
    ).toBe("2");
  });

  it("refuse one about a task that is nothing, too few options, and an id that is nothing", async () => {
    const orphan = await send(alice, "POST", `${IN}/decisions`, {
      question: "About nothing?",
      options: [{ label: "a" }, { label: "b" }],
      taskId: "0199c4d8-0000-7000-8000-000000000099",
    });
    expect(orphan.status).toBe(400);
    expect(await errorOf(orphan)).toBe("decision.invalid_task");
    const few = await send(alice, "POST", `${IN}/decisions`, {
      question: "Alone?",
      options: [{ label: "a" }],
    });
    expect(await errorOf(few)).toBe("request.invalid");
    expect((await get(alice, `${IN}/decisions/not-an-id`)).status).toBe(404);
    expect(
      (
        await send(alice, "POST", `${IN}/decisions/0199c4d8-0000-7000-8000-000000000099/answer`, {
          option: "1",
        })
      ).status,
    ).toBe(404);
  });
});

describe("documents", () => {
  const DOC = `${IN}/docs`;
  const at = (path: string) => `${DOC}/${encodeURIComponent(path)}`;
  const write = async (cookie: string, path: string, body: unknown, status = 201) => {
    const response = await h.request(at(path), {
      method: "PUT",
      headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(status);
    return restDocumentSchema.parse(await response.json());
  };
  const read = async (cookie: string, path: string) =>
    restDocumentSchema.parse(await (await get(cookie, at(path))).json());
  const listing = async (cookie: string, query = "") =>
    restDocumentsSchema.parse(await (await get(cookie, `${DOC}${query}`)).json());

  it("are written at a path, versioned on every write, listed by folder, found by words, and read as the schema says", async () => {
    const first = await write(alice, "guides/onboarding", {
      title: "  Onboarding  ",
      body: "# Welcome\n\nSee [the setup](guides/setup) and [the plan](plan).",
    });
    expect(first).toMatchObject({
      path: "guides/onboarding",
      title: "Onboarding",
      version: 1,
      agent: null,
      archivedAt: null,
      links: [
        { path: "guides/setup", title: null },
        { path: "plan", title: null },
      ],
      backlinks: [],
      files: [],
    });
    expect(first.updatedBy.login).toBe("Alice");
    expect(first.createdBy.login).toBe("Alice");
    // The same page written again is no version.
    const same = await write(
      alice,
      "guides/onboarding",
      { title: "Onboarding", body: first.body },
      200,
    );
    expect(same.version).toBe(1);
    // A member of the workspace writes the next version; the links follow the text.
    const second = await write(
      bob,
      "guides/onboarding",
      { title: "Onboarding", body: "# Welcome\n\nSee [the plan](plan) only.", baseVersion: 1 },
      200,
    );
    expect(second.version).toBe(2);
    expect(second.updatedBy.login).toBe("bob");
    expect(second.links).toEqual([{ path: "plan", title: null }]);
    // A write from a version the page has moved on from is refused.
    const stale = await h.request(at("guides/onboarding"), {
      method: "PUT",
      headers: { cookie: alice, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ title: "Onboarding", body: "older", baseVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await errorOf(stale)).toBe("document.conflict");
    // The plan links back: both pages say so.
    const plan = await write(alice, "plan", {
      title: "The plan",
      body: "Start with [onboarding](guides/onboarding).",
    });
    expect(plan.backlinks).toEqual([
      {
        kind: "document",
        id: first.id,
        path: "guides/onboarding",
        number: null,
        title: "Onboarding",
      },
    ]);
    const onboarding = await read(bob, "guides/onboarding");
    expect(onboarding.links).toEqual([{ path: "plan", title: "The plan" }]);
    expect(onboarding.backlinks).toEqual([
      { kind: "document", id: plan.id, path: "plan", number: null, title: "The plan" },
    ]);
    // The folders: the root has the plan and the guides; the guides hold the onboarding.
    const root = await listing(bob);
    expect(root.folder).toBe("");
    expect(root.folders).toEqual(["guides"]);
    expect(root.items.map((item) => item.path)).toEqual(["plan"]);
    expect(root.items[0]).toMatchObject({ title: "The plan", version: 1 });
    expect(JSON.stringify(root)).not.toContain("Start with");
    const guides = await listing(bob, "?folder=guides");
    expect(guides.folders).toEqual([]);
    expect(guides.items.map((item) => item.path)).toEqual(["guides/onboarding"]);
    expect((await listing(bob, "?folder=nowhere")).items).toEqual([]);
    expect((await get(bob, `${DOC}?folder=/bad`)).status).toBe(400);
    // The words find the page; the folder is not looked at then.
    const found = await listing(bob, "?q=welcome&folder=nowhere");
    expect(found.items.map((item) => item.path)).toEqual(["guides/onboarding"]);
    expect((await listing(bob, "?q=onboard")).items.map((item) => item.path)).toEqual([
      "guides/onboarding",
    ]);
    expect((await listing(bob, "?q=nothing-of-the-sort")).items).toEqual([]);
    // The versions, newest first, each as it was.
    const versions = restVersionsSchema.parse(
      await (await get(bob, `${at("guides/onboarding")}/versions`)).json(),
    );
    expect(versions.items.map((version) => version.number)).toEqual([2, 1]);
    expect(versions.items[1]?.author.login).toBe("Alice");
    const original = restVersionSchema.parse(
      await (await get(bob, `${at("guides/onboarding")}/versions/1`)).json(),
    );
    expect(original.body).toContain("guides/setup");
    const missing = await get(bob, `${at("guides/onboarding")}/versions/9`);
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toBe("document.version_not_found");
    const nowhere = await get(bob, `${at("nowhere/here")}/versions`);
    expect(await errorOf(nowhere)).toBe("document.not_found");
    // Everything that happened to the page.
    const history = restEventsSchema.parse(
      await (await get(bob, `${IN}/events?document=${first.id}`)).json(),
    );
    expect(history.items.map((event) => event.kind)).toEqual([
      "document.written",
      "document.written",
    ]);
    expect(history.items[1]).toMatchObject({
      documentId: first.id,
      data: { path: "guides/onboarding", title: "Onboarding", version: 2 },
    });
    expect(history.items[1]?.actor?.login).toBe("bob");
  });

  it("link both ways from tasks and decisions, and grow a decision into a record", async () => {
    const task = await createTask(alice, {
      title: "Read the guide",
      body: "Start with [onboarding](guides/onboarding).",
    });
    expect((await read(alice, "guides/onboarding")).backlinks).toContainEqual({
      kind: "task",
      id: task.id,
      path: null,
      number: task.number,
      title: "Read the guide",
    });
    const raised = await send(alice, "POST", `${IN}/decisions`, {
      question: "Keep the guide?",
      body: "It is at [onboarding](guides/onboarding).",
      options: [{ label: "Keep it" }, { label: "Drop it" }],
    });
    expect(raised.status).toBe(201);
    const decision = restDecisionSchema.parse(await raised.json());
    expect(decision.outcome).toBeNull();
    expect((await read(alice, "guides/onboarding")).backlinks).toContainEqual({
      kind: "decision",
      id: decision.id,
      path: null,
      number: null,
      title: "Keep the guide?",
    });
    // The record grows: what followed, by anyone who works in the project, with its links.
    const grown = await send(bob, "PATCH", `${IN}/decisions/${decision.id}`, {
      outcome: "We kept it and wrote [the plan](plan) down.",
    });
    expect(grown.status).toBe(200);
    expect(restDecisionSchema.parse(await grown.json()).outcome).toBe(
      "We kept it and wrote [the plan](plan) down.",
    );
    expect((await read(alice, "plan")).backlinks).toContainEqual({
      kind: "decision",
      id: decision.id,
      path: null,
      number: null,
      title: "Keep the guide?",
    });
    const nothing = await send(bob, "PATCH", `${IN}/decisions/${decision.id}`, {});
    expect(nothing.status).toBe(200);
    const record = restEventsSchema.parse(
      await (await get(bob, `${IN}/events?decision=${decision.id}`)).json(),
    );
    expect(record.items.map((event) => event.kind)).toEqual([
      "decision.raised",
      "decision.updated",
    ]);
    expect(record.items[1]?.data).toMatchObject({
      question: "Keep the guide?",
      fields: ["outcome"],
    });
    // A link taken out of a task's body is gone from the page.
    const changed = await send(alice, "PATCH", `${IN}/tasks/${task.id}`, { body: "No links now." });
    expect(changed.status).toBe(200);
    expect(
      (await read(alice, "guides/onboarding")).backlinks.some(
        (backlink) => backlink.kind === "task",
      ),
    ).toBe(false);
  });

  it("are archived rather than deleted, kept out of the folders and the search, readable, and restored", async () => {
    const put = await send(alice, "POST", `${at("plan")}/archive`);
    expect(put.status).toBe(200);
    const archived = restDocumentSchema.parse(await put.json());
    expect(archived.archivedAt).not.toBeNull();
    expect((await listing(bob)).items.map((item) => item.path)).toEqual([]);
    expect((await listing(bob, "?archived=true")).items.map((item) => item.path)).toEqual(["plan"]);
    expect((await listing(bob, "?q=onboarding")).items.map((item) => item.path)).toEqual([
      "guides/onboarding",
    ]);
    expect((await read(bob, "plan")).archivedAt).not.toBeNull();
    const refused = await h.request(at("plan"), {
      method: "PUT",
      headers: { cookie: alice, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ title: "The plan", body: "changed" }),
    });
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("document.archived");
    // The link to an archived page still says where it leads.
    expect((await read(bob, "guides/onboarding")).links).toEqual([
      { path: "plan", title: "The plan" },
    ]);
    const again = await send(alice, "POST", `${at("plan")}/archive`);
    expect(restDocumentSchema.parse(await again.json()).archivedAt).toEqual(archived.archivedAt);
    const back = await send(bob, "POST", `${at("plan")}/restore`);
    expect(restDocumentSchema.parse(await back.json()).archivedAt).toBeNull();
    expect((await listing(bob)).items.map((item) => item.path)).toEqual(["plan"]);
    const history = restEventsSchema.parse(
      await (await get(bob, `${IN}/events?document=${archived.id}`)).json(),
    );
    expect(history.items.map((event) => event.kind)).toEqual([
      "document.written",
      "document.archived",
      "document.restored",
    ]);
  });

  it("take files, kept under their hash and read back under a policy that runs nothing", async () => {
    const form = new FormData();
    form.set("file", new File(["# Notes\n"], "notes.md", { type: "text/markdown" }), "notes.md");
    form.set("label", "the notes");
    const attached = await h.request(`${at("plan")}/files`, {
      method: "POST",
      headers: { cookie: alice, origin: SIGN_IN_URL },
      body: form,
    });
    expect(attached.status, await attached.clone().text()).toBe(201);
    const document = restDocumentSchema.parse(await attached.json());
    expect(document.files).toHaveLength(1);
    const [file] = document.files;
    expect(file).toMatchObject({
      label: "the notes",
      file: { name: "notes.md", size: 8, contentType: "text/markdown" },
      agent: null,
    });
    expect(file?.addedBy.login).toBe("Alice");
    const bytes = await get(bob, `${at("plan")}/files/${file?.id}`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(bytes.headers.get("content-disposition")).toContain("inline");
    expect(bytes.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(await bytes.text()).toBe("# Notes\n");
    const wrong = await get(bob, `${at("guides/onboarding")}/files/${file?.id}`);
    expect(wrong.status).toBe(404);
    expect(await errorOf(wrong)).toBe("file.not_found");
    const nowhere = await h.request(`${at("nowhere")}/files`, {
      method: "POST",
      headers: { cookie: alice, origin: SIGN_IN_URL },
      body: form,
    });
    expect(nowhere.status).toBe(404);
    const history = restEventsSchema.parse(
      await (await get(bob, `${IN}/events?document=${document.id}`)).json(),
    );
    expect(history.items.at(-1)).toMatchObject({
      kind: "document.file_attached",
      data: { path: "plan", title: "The plan", label: "the notes" },
    });
  });

  it("refuse a path that is not one, are not found where the project is not, and name the agent that wrote", async () => {
    const odd = await h.request(`${DOC}/Bad%20Path`, {
      method: "PUT",
      headers: { cookie: alice, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ title: "Odd", body: "" }),
    });
    expect(odd.status).toBe(400);
    expect(await errorOf(odd)).toBe("document.invalid_path");
    expect((await get(alice, `${DOC}/Bad`)).status).toBe(404);
    expect((await get(alice, at("nowhere/at/all"))).status).toBe(404);
    expect((await h.request(at("plan"))).status).toBe(401);
    // Bob may not see Alice's private project: its pages are not found, whatever is asked.
    expect((await get(bob, `${projectPath("docs")}/docs`)).status).toBe(404);
    expect(await errorOf(await get(bob, `${projectPath("docs")}/docs`))).toBe("project.not_found");
    // An agent writes as its person, and the page and the feed name it.
    const made = await send(alice, "POST", REST_ROUTES.tokens, { name: "the writer" });
    const { token, secret } = restTokenCreatedSchema.parse(await made.json());
    const written = await h.request(at("notes/from-the-agent"), {
      method: "PUT",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "From the agent", body: "Written mid-run." }),
    });
    expect(written.status).toBe(201);
    const page = restDocumentSchema.parse(await written.json());
    expect(page.agent).toBe("the writer");
    expect(page.updatedBy.login).toBe("Alice");
    const history = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?document=${page.id}`)).json(),
    );
    expect(history.items[0]).toMatchObject({ kind: "document.written", agent: "the writer" });
    // The token goes, so that the tokens' own tests find what they expect.
    const gone = await h.request(`${REST_ROUTES.tokens}/${token.id}`, {
      method: "DELETE",
      headers: { cookie: alice, origin: SIGN_IN_URL },
    });
    expect(gone.status).toBe(204);
  });
});

describe("people and the feeds", () => {
  it("list everyone who signed in, by login", async () => {
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    expect(people.items.map((person) => person.login)).toEqual(["Alice", "bob", "carol"]);
  });

  it("page a project's feed from a number on, keep the workspace's own apart, and refuse a cursor that is not one", async () => {
    const page = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?after=0&limit=2`)).json(),
    );
    expect(page.items).toHaveLength(2);
    expect(page.more).toBe(true);
    expect(page.items[0]?.kind).toBe("project.created");
    expect(page.items[0]?.data).toEqual({ key: "web", name: "The web app" });
    const rest = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?after=${page.items[1]?.id}`)).json(),
    );
    expect(rest.more).toBe(false);
    expect(rest.items.every((event) => event.projectId === page.items[0]?.projectId)).toBe(true);
    // Who joined, and who was made what, is the workspace's own: on no project's feed.
    const own = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=0`)).json(),
    );
    expect(own.items.map((event) => event.kind)).toEqual([
      "person.joined",
      "person.joined",
      "person.joined",
    ]);
    expect(own.items.every((event) => event.projectId === null)).toBe(true);
    expect((await get(alice, `${IN}/events?after=-1`)).status).toBe(400);
    expect((await get(alice, `${IN}/events?limit=1000`)).status).toBe(400);
    expect((await get(alice, `${IN}/events?task=7`)).status).toBe(400);
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
    expect(mine.map((item) => item.name)).toEqual([
      "forever",
      "ci",
      "Claude Code on the laptop",
      "an owner's agent",
    ]);
    // The page sees names and dates, never a secret.
    expect(JSON.stringify(mine)).not.toContain("cns_t_");
    // Bob sees his own, which are none, and cannot take Alice's away.
    expect(await listed(bob)).toEqual([]);
    expect((await remove(bob, token.id)).status).toBe(404);

    expect((await remove(alice, second.token.id)).status).toBe(204);
    expect((await remove(alice, second.token.id)).status).toBe(404);
    expect((await remove(alice, "not-an-id")).status).toBe(404);
    expect((await listed(alice)).map((item) => item.name)).toEqual([
      "forever",
      "Claude Code on the laptop",
      "an owner's agent",
    ]);
    expect(JSON.stringify(h.logs)).not.toContain("cns_t_");
  });

  it("act as their person over the API, with no origin needed, name the agent on what they do, and are noted as used", async () => {
    const { token, secret } = await make(alice, { name: "a script" });
    const auth = { authorization: `Bearer ${secret}` };
    const me = restMeSchema.parse(
      await (await h.request(REST_ROUTES.me, { headers: auth })).json(),
    );
    expect(me.person?.login).toBe("Alice");
    // With what: the token's name, so that a console of a person's own knows it holds one.
    expect(me.agent).toBe("a script");
    const created = await h.request(`${IN}/tasks`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: "Written by a script" }),
    });
    expect(created.status).toBe(201);
    const task = restTaskSchema.parse(await created.json());
    expect(task.owner.login).toBe("Alice");
    const events = restEventsSchema.parse(
      await (await h.request(`${IN}/events?task=${task.id}`, { headers: auth })).json(),
    );
    // Traceability: the person, and the agent they acted through.
    expect(events.items).toHaveLength(1);
    expect(events.items[0]).toMatchObject({ kind: "task.created", agent: "a script" });
    expect(events.items[0]?.actor?.login).toBe("Alice");
    const used = (await listed(alice)).find((item) => item.id === token.id);
    expect(used?.lastUsedAt).not.toBeNull();
    // A token sees the projects its person sees, and no more.
    const projects = restProjectsSchema.parse(
      await (await h.request(REST_ROUTES.projects, { headers: auth })).json(),
    );
    expect(projects.items.map((project) => project.key)).toEqual(["docs", "web"]);
  });

  it("are refused when they are nothing, taken away, expired, or no longer a member's", async () => {
    for (const header of [
      "Bearer cns_t_nonsense",
      "Bearer",
      "Basic Y25zX3RfeDp4",
      "Bearer cns_s_not-a-token",
      "Token cns_t_x",
    ]) {
      const response = await h.request(`${IN}/tasks`, { headers: { authorization: header } });
      expect(response.status, header).toBe(401);
      expect(await errorOf(response)).toBe("auth.required");
    }
    // A token that is nothing is refused beside a good session too: the token is the credential.
    const beside = await h.request(`${IN}/tasks`, {
      headers: { cookie: alice, authorization: "Bearer cns_t_nonsense" },
    });
    expect(beside.status).toBe(401);
    expect(beside.headers.getSetCookie()).toEqual([]);

    const { token, secret } = await make(alice, { name: "short-lived" });
    expect((await remove(alice, token.id)).status).toBe(204);
    const gone = await h.request(`${IN}/tasks`, { headers: { authorization: `Bearer ${secret}` } });
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
    expect((await later.request(`${IN}/tasks`, { headers: bearer })).status).toBe(200);
    clock.advance(2 * DAY_MS);
    expect((await later.request(`${IN}/tasks`, { headers: bearer })).status).toBe(401);
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
        await later.request(`${IN}/tasks`, {
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
    const out = await bobOnly.request(`${IN}/tasks`, {
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

describe("connecting an agent", () => {
  const JSON_ONLY = { "content-type": "application/json" };
  const begin = async (agent: string) => {
    const response = await h.request(REST_ROUTES.connect, {
      method: "POST",
      headers: JSON_ONLY,
      body: JSON.stringify({ agent }),
    });
    expect(response.status).toBe(201);
    return restConnectionSchema.parse(await response.json());
  };
  const claim = (secret: string) =>
    h.request(CLAIM_PATH, { method: "POST", headers: JSON_ONLY, body: JSON.stringify({ secret }) });

  it("is begun by nobody, approved by a person signed in, claimed once with the secret, and acts as the approver", async () => {
    const connection = await begin("  Claude Code on the laptop  ");
    expect(connection.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(connection.url).toBe(`${SIGN_IN_URL}/connect/${connection.code}`);
    expect(connection.secret).toMatch(/^cns_c_[\w-]{40,}$/);
    expect(connection.interval).toBeGreaterThan(0);
    expect(new Date(connection.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Nobody approved yet: the command waits.
    const waiting = await claim(connection.secret);
    expect(waiting.status).toBe(202);
    expect(restClaimSchema.parse(await waiting.json())).toMatchObject({ status: "pending" });
    // The page shows what asks to a person signed in, however they typed the code; nobody else.
    expect((await h.request(connectPath(connection.code))).status).toBe(401);
    const seen = await get(bob, connectPath(connection.code.toLowerCase().replace("-", "")));
    expect(seen.status).toBe(200);
    expect(restConnectRequestSchema.parse(await seen.json())).toMatchObject({
      code: connection.code,
      agent: "Claude Code on the laptop",
      approved: false,
    });
    const approved = await send(bob, "POST", connectPath(connection.code, "approve"), {
      name: "Claude Code",
      expiresInDays: 7,
    });
    expect(approved.status).toBe(200);
    expect(restConnectRequestSchema.parse(await approved.json()).approved).toBe(true);
    const again = await send(bob, "POST", connectPath(connection.code, "approve"), {
      name: "Again",
    });
    expect(await errorOf(again)).toBe("connect.approved");
    // The claim gets the token once, made now for Bob; then nothing is left to find.
    const handed = await claim(connection.secret);
    expect(handed.status).toBe(200);
    const result = restClaimSchema.parse(await handed.json());
    if (result.status !== "connected") {
      throw new Error("expected the token");
    }
    expect(result.token.name).toBe("Claude Code");
    expect(result.secret).toMatch(/^cns_t_/);
    expect(
      new Date(result.token.expiresAt ?? 0).getTime() - new Date(result.token.createdAt).getTime(),
    ).toBe(7 * 86_400_000);
    expect((await claim(connection.secret)).status).toBe(404);
    expect((await get(bob, connectPath(connection.code))).status).toBe(404);
    const me = await h.request(REST_ROUTES.me, {
      headers: { authorization: `Bearer ${result.secret}` },
    });
    expect(restMeSchema.parse(await me.json())).toMatchObject({
      person: { login: "bob" },
      agent: result.token.name,
    });
    // Bob's token goes again, so that the tokens' own tests find what they expect.
    expect((await send(bob, "DELETE", `${REST_ROUTES.tokens}/${result.token.id}`)).status).toBe(
      204,
    );
  });

  it("is denied by the person, refused with a token or from elsewhere, and not found when it is nothing", async () => {
    const denied = await begin("Codex on a server");
    expect((await send(alice, "POST", connectPath(denied.code, "deny"))).status).toBe(204);
    expect(await errorOf(await claim(denied.secret))).toBe("connect.not_found");
    expect(await errorOf(await get(alice, connectPath("ZZZZ-ZZZZ")))).toBe("connect.not_found");
    expect(await errorOf(await get(alice, connectPath("not-a-code")))).toBe("connect.not_found");
    expect(await errorOf(await claim("cns_c_nothing"))).toBe("connect.not_found");
    expect(await errorOf(await claim("cns_t_wrong-kind"))).toBe("connect.not_found");
    const unnamed = await h.request(REST_ROUTES.connect, {
      method: "POST",
      headers: JSON_ONLY,
      body: JSON.stringify({ agent: "" }),
    });
    expect(unnamed.status).toBe(400);
    // Approving is a person's own doing: never with a token, never from elsewhere.
    const pending = await begin("Claude Code elsewhere");
    const made = restTokenCreatedSchema.parse(
      await (await send(alice, "POST", REST_ROUTES.tokens, { name: "a connecting agent" })).json(),
    );
    const byToken = await h.request(connectPath(pending.code, "approve"), {
      method: "POST",
      headers: { authorization: `Bearer ${made.secret}`, ...JSON_ONLY },
      body: JSON.stringify({ name: "x" }),
    });
    expect(await errorOf(byToken)).toBe("auth.session_required");
    const elsewhere = await h.request(connectPath(pending.code, "approve"), {
      method: "POST",
      headers: { cookie: alice, origin: "https://evil.test", ...JSON_ONLY },
      body: JSON.stringify({ name: "x" }),
    });
    expect(await errorOf(elsewhere)).toBe("auth.forbidden_origin");
    expect((await send(alice, "POST", connectPath(pending.code, "deny"))).status).toBe(204);
    expect((await send(alice, "DELETE", `${REST_ROUTES.tokens}/${made.token.id}`)).status).toBe(
      204,
    );
  });

  it("lets an administrator see and disconnect anyone's agents, and nobody else", async () => {
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["alice"],
    });
    const admin = await named.signIn("alice");
    const member = await named.signIn("bob");
    const bobId = restMeSchema.parse(
      await (await named.request(REST_ROUTES.me, { headers: { cookie: member } })).json(),
    ).person?.id;
    const aliceId = restMeSchema.parse(
      await (await named.request(REST_ROUTES.me, { headers: { cookie: admin } })).json(),
    ).person?.id;
    if (bobId === undefined || aliceId === undefined) {
      throw new Error("expected both people");
    }
    const made = restTokenCreatedSchema.parse(
      await (
        await named.request(REST_ROUTES.tokens, {
          method: "POST",
          headers: { cookie: member, origin: SIGN_IN_URL, ...JSON_ONLY },
          body: JSON.stringify({ name: "Bob's agent" }),
        })
      ).json(),
    );
    const seen = await named.request(personTokensPath(bobId), { headers: { cookie: admin } });
    expect(seen.status).toBe(200);
    expect(restTokensSchema.parse(await seen.json()).items.map((item) => item.id)).toContain(
      made.token.id,
    );
    const byMember = await named.request(personTokensPath(aliceId), {
      headers: { cookie: member },
    });
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const nobody = await named.request(personTokensPath("0199c4d8-0000-7000-8000-00000000dead"), {
      headers: { cookie: admin },
    });
    expect(await errorOf(nobody)).toBe("person.not_found");
    const removed = await named.request(personTokensPath(bobId, made.token.id), {
      method: "DELETE",
      headers: { cookie: admin, origin: SIGN_IN_URL },
    });
    expect(removed.status).toBe(204);
    const after = await named.request(personTokensPath(bobId), { headers: { cookie: admin } });
    expect(restTokensSchema.parse(await after.json()).items.map((item) => item.id)).not.toContain(
      made.token.id,
    );
    // Bob's token is gone for Bob too; the agent that held it is nobody.
    const gone = await named.request(REST_ROUTES.me, {
      headers: { authorization: `Bearer ${made.secret}` },
    });
    expect(restMeSchema.parse(await gone.json()).person).toBeNull();
  });

  it("gives tokens that expire within what the organization requires, wherever one is made", async () => {
    const bounded = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      tokenDaysAtMost: 30,
    });
    const cookie = await bounded.signIn("alice");
    const me = restMeSchema.parse(
      await (await bounded.request(REST_ROUTES.me, { headers: { cookie } })).json(),
    );
    expect(me.workspace.tokenDaysAtMost).toBe(30);
    const make = (body: unknown) =>
      bounded.request(REST_ROUTES.tokens, {
        method: "POST",
        headers: { cookie, origin: SIGN_IN_URL, ...JSON_ONLY },
        body: JSON.stringify(body),
      });
    expect(await errorOf(await make({ name: "forever", expiresInDays: null }))).toBe(
      "token.expiry_at_most",
    );
    expect(await errorOf(await make({ name: "long", expiresInDays: 60 }))).toBe(
      "token.expiry_at_most",
    );
    expect(await errorOf(await make({ name: "the default" }))).toBe("token.expiry_at_most");
    const made = await make({ name: "fits", expiresInDays: 30 });
    expect(made.status).toBe(201);
    const token = restTokenCreatedSchema.parse(await made.json());
    expect(
      (
        await bounded.request(`${REST_ROUTES.tokens}/${token.token.id}`, {
          method: "DELETE",
          headers: { cookie, origin: SIGN_IN_URL },
        })
      ).status,
    ).toBe(204);
    // Approving a connection is bounded the same way.
    const begun = restConnectionSchema.parse(
      await (
        await bounded.request(REST_ROUTES.connect, {
          method: "POST",
          headers: JSON_ONLY,
          body: JSON.stringify({ agent: "an agent" }),
        })
      ).json(),
    );
    const approve = await bounded.request(connectPath(begun.code, "approve"), {
      method: "POST",
      headers: { cookie, origin: SIGN_IN_URL, ...JSON_ONLY },
      body: JSON.stringify({ name: "an agent", expiresInDays: null }),
    });
    expect(await errorOf(approve)).toBe("token.expiry_at_most");
    expect(
      (
        await bounded.request(connectPath(begun.code, "deny"), {
          method: "POST",
          headers: { cookie, origin: SIGN_IN_URL },
        })
      ).status,
    ).toBe(204);
  });
});

describe("roles", () => {
  it("are changed by an administrator signed in, kept to at least one, and told to the workspace", async () => {
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
    const carolId = people.items.find((person) => person.login === "carol")?.id ?? "";
    // Carol was made an administrator by an earlier harness; Alice is to be the last one here.
    expect((await change(admin, carolId, { role: "member" })).status).toBe(200);

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
    // Now Alice may step down, and the workspace is told of both.
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
    // Alice, a member again, no longer owns the docs project by right of office; she is listed, so she still does.
    expect(restProjectSchema.parse(await (await get(alice, projectPath("docs"))).json()).role).toBe(
      "owner",
    );
    // Bob, an administrator now, owns every project.
    expect((await change(bob, aliceId, { role: "admin" })).status).toBe(200);
    expect((await change(admin, bobId, { role: "member" })).status).toBe(200);
  });
});

describe("skills", () => {
  it("are none without an address, the organization's with one, and a project's own when it names one", async () => {
    const none = restSkillsSchema.parse(await (await get(alice, `${IN}/skills`)).json());
    expect(none).toEqual({
      address: null,
      source: "https://skillcdn.ai",
      page: null,
      status: "none",
      items: [],
    });

    const asked: string[] = [];
    const source: SkillSource = {
      async list(address) {
        asked.push(`/gh/${address.owner}/${address.repo}`);
        return {
          status: "ready",
          skills: [
            {
              name: "review",
              description: "Reviews a change.",
              directory: "review",
              path: "review/SKILL.md",
              translations: { ko: { title: "리뷰", description: null } },
            },
          ],
        };
      },
    };
    const served = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      skills: { address: "/gh/Acme/skills", source },
    });
    const cookie = await served.signIn("alice");
    const read = async (at = IN) =>
      restSkillsSchema.parse(
        await (await served.request(`${at}/skills`, { headers: { cookie } })).json(),
      );
    const first = await read();
    expect(first).toMatchObject({
      address: "/gh/acme/skills",
      source: "https://skillcdn.test",
      page: "https://skillcdn.test/gh/acme/skills",
      status: "ready",
    });
    expect(first.items).toEqual([
      {
        name: "review",
        description: "Reviews a change.",
        directory: "review",
        path: "review/SKILL.md",
        page: "https://skillcdn.test/gh/acme/skills?skill=review%2FSKILL.md",
        uri: "skill://gh/acme/skills/review/SKILL.md",
        translations: { ko: { title: "리뷰", description: null } },
      },
    ]);
    // Held for a while: a second read asks the deployment nothing.
    expect(await read()).toEqual(first);
    expect(asked).toEqual(["/gh/acme/skills"]);
    // A project that names its own address is read at it, and held on its own.
    const named = await served.request(projectPath("docs"), {
      method: "PATCH",
      headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ skillsAddress: "/gh/acme/writing" }),
    });
    expect(named.status).toBe(200);
    const own = await read(projectPath("docs"));
    expect(own).toMatchObject({ address: "/gh/acme/writing", status: "ready" });
    expect(own.items[0]?.uri).toBe("skill://gh/acme/writing/review/SKILL.md");
    expect(asked).toEqual(["/gh/acme/skills", "/gh/acme/writing"]);
    expect((await served.request(`${IN}/skills`)).status).toBe(401);
    await served.close();
  });
});
