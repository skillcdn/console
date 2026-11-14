import {
  GLANCE_ROWS,
  projectPath,
  REST_ROUTES,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restProjectGlanceSchema,
  restProjectSchema,
  restProjectsSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// Making a project (ADR-0045): an administrator's, on the console's own pages or through their
// agent, and never a member's. On a database of its own, so that the administrator here is a
// member nowhere else.

let testDatabase: TestDatabase;
let h: Harness;
let admin: string;
let member: string;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, { providers: [createFixtureProvider()], admins: ["carol"] });
  admin = await h.signIn("carol");
  member = await h.signIn("alice");
});

afterAll(async () => {
  await testDatabase?.drop();
});

const JSON_HEADERS = { "content-type": "application/json" };
/** The headers of a request from the console's own pages, as a signed-in person's browser sends one. */
const fromPages = (cookie: string) => ({ cookie, origin: SIGN_IN_URL });
const post = (headers: Record<string, string>, body: unknown) =>
  h.request(REST_ROUTES.projects, {
    method: "POST",
    headers: { ...headers, ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;
const tokenFor = async (cookie: string, name: string): Promise<string> => {
  const made = await h.request(REST_ROUTES.tokens, {
    method: "POST",
    headers: { ...fromPages(cookie), ...JSON_HEADERS },
    body: JSON.stringify({ name }),
  });
  expect(made.status).toBe(201);
  return restTokenCreatedSchema.parse(await made.json()).secret;
};

describe("making a project (ADR-0045)", () => {
  it("is an administrator's, who owns it, on the console's own pages or through their agent, and never a member's", async () => {
    const byMember = await post(fromPages(member), { key: "docs", name: "The docs" });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const membersAgent = await tokenFor(member, "a member's agent");
    const byMembersAgent = await post(
      { authorization: `Bearer ${membersAgent}` },
      { key: "docs", name: "The docs" },
    );
    expect(byMembersAgent.status).toBe(403);
    expect(await errorOf(byMembersAgent)).toBe("auth.forbidden");

    const made = await post(fromPages(admin), {
      key: "docs",
      name: "  The docs  ",
      description: "What we write.",
      skillsAddress: "/gh/Acme/Writing@main",
      color: "teal",
      symbol: "Dx",
    });
    expect(made.status).toBe(201);
    expect(restProjectSchema.parse(await made.json())).toMatchObject({
      key: "docs",
      name: "The docs",
      description: "What we write.",
      visibility: "private",
      skillsAddress: "/gh/acme/writing@main",
      color: "teal",
      symbol: "Dx",
      role: "owner",
      openDecisions: 0,
      openRuns: 0,
    });

    // Through their agent, as its administrator (ADR-0021), named on what it did.
    const adminsAgent = await tokenFor(admin, "an administrator's agent");
    const byAgent = await post(
      { authorization: `Bearer ${adminsAgent}` },
      { key: "by-agent", name: "Made by an agent", visibility: "workspace" },
    );
    expect(byAgent.status).toBe(201);
    expect(restProjectSchema.parse(await byAgent.json())).toMatchObject({
      key: "by-agent",
      role: "owner",
    });
    const events = restEventsSchema.parse(
      await (
        await h.request(`${projectPath("by-agent")}/events?after=0`, {
          headers: { cookie: admin },
        })
      ).json(),
    ).items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "project.created",
      agent: "an administrator's agent",
      data: { key: "by-agent", name: "Made by an agent" },
    });
    expect(events[0]?.actor?.login).toBe("carol");

    // The member sees the open one as a member and nothing of the private one.
    const theirs = restProjectsSchema.parse(
      await (await h.request(REST_ROUTES.projects, { headers: { cookie: member } })).json(),
    );
    expect(theirs.items.map((project) => [project.key, project.role])).toEqual([
      ["by-agent", "member"],
    ]);
  });

  it("refuses a key taken, one that is not a key, and an address that is not one, and tells a member nothing of the keys", async () => {
    const taken = await post(fromPages(admin), { key: "docs", name: "Again" });
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe("project.key_taken");
    for (const body of [
      { key: "Web", name: "x" },
      { key: "the web", name: "x" },
      { key: "web-", name: "x" },
      { key: "", name: "x" },
      { key: "ok" },
      { key: "ok", name: "x", visibility: "public" },
      { key: "ok", name: "x", color: "red" },
      { key: "ok", name: "x", symbol: "a b" },
      { key: "ok", name: "x", symbol: "123456789" },
    ]) {
      const response = await post(fromPages(admin), body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    }
    const address = await post(fromPages(admin), {
      key: "ok",
      name: "x",
      skillsAddress: "github.com/acme/skills",
    });
    expect(address.status).toBe(400);
    expect(await errorOf(address)).toBe("project.invalid_address");
    // A key in use is not told to a member, whom the refusal reaches first.
    const askedByMember = await post(fromPages(member), { key: "docs", name: "Again" });
    expect(askedByMember.status).toBe(403);
    expect(await errorOf(askedByMember)).toBe("auth.forbidden");
  });
});

describe("a project at a glance (ADR-0107)", () => {
  const at = (key: string, path = "") => `${projectPath(key)}${path}`;
  const make = async (key: string, path: string, body: unknown): Promise<string> => {
    const answer = await h.request(at(key, path), {
      method: "POST",
      headers: { ...fromPages(admin), ...JSON_HEADERS },
      body: JSON.stringify(body),
    });
    expect(answer.status).toBe(201);
    return ((await answer.json()) as { readonly id: string }).id;
  };
  const glanceOf = async (key: string, headers: Record<string, string>) => {
    const answer = await h.request(at(key, "/glance"), { headers });
    expect(answer.status).toBe(200);
    const raw: unknown = await answer.json();
    return { raw, glance: restProjectGlanceSchema.parse(raw) };
  };

  it("is one answer: the board counted by state, and its rows ordered and cut by the console with how many there are", async () => {
    expect((await post(fromPages(admin), { key: "glanced", name: "Glanced" })).status).toBe(201);
    const me = restMeSchema.parse(
      await (await h.request(REST_ROUTES.me, { headers: { cookie: admin } })).json(),
    );
    const carol = me.person?.id ?? "";
    // The first written is due the soonest: a listing newest first, cut, would never reach it.
    const soonest = await make("glanced", "/tasks", {
      title: "Due the soonest",
      body: "A body a glance never carries.",
      state: "in_progress",
      dueOn: "2030-01-02",
      workerIds: [carol],
    });
    // More in progress than a glance carries rows of, on later days and on none.
    for (let n = 0; n < GLANCE_ROWS; n++) {
      await make("glanced", "/tasks", {
        title: `In progress ${n}`,
        state: "in_progress",
        dueOn: n % 2 === 0 ? `2030-02-${String(n + 1).padStart(2, "0")}` : null,
      });
    }
    await make("glanced", "/tasks", { title: "Read me", state: "in_review", dueOn: "2030-03-01" });
    await make("glanced", "/tasks", {
      title: "Read me first",
      state: "in_review",
      dueOn: "2030-01-15",
    });
    await make("glanced", "/tasks", { title: "An idea", state: "idea" });
    const putAway = await make("glanced", "/tasks", { title: "Done and put away", state: "done" });
    await make("glanced", "/tasks", { title: "Done", state: "done" });
    const archived = await h.request(at("glanced", `/tasks/${putAway}/archive`), {
      method: "POST",
      headers: fromPages(admin),
    });
    expect(archived.ok).toBe(true);
    // A goal reached is not ahead; of those that are, the active one comes first.
    await make("glanced", "/goals", { title: "Planned", state: "planned", dueOn: "2030-01-01" });
    const active = await make("glanced", "/goals", { title: "Active", state: "active" });
    await make("glanced", "/goals", { title: "Reached", state: "done" });
    await make("glanced", "/tasks", { title: "Towards it", state: "done", goalId: active });
    await make("glanced", "/decisions", {
      question: "Which day?",
      options: [{ label: "Monday" }, { label: "Friday" }],
      taskId: soonest,
    });

    const { raw, glance } = await glanceOf("glanced", { cookie: admin });
    expect(glance.taskCounts).toEqual({
      idea: 1,
      ready: 0,
      in_progress: GLANCE_ROWS + 1,
      in_review: 2,
      done: 2,
      dropped: 0,
    });
    expect(glance.openDecisions).toBe(1);
    // Cut to the rows a glance carries, with the true total beside them.
    expect(glance.inProgress.total).toBe(GLANCE_ROWS + 1);
    expect(glance.inProgress.items).toHaveLength(GLANCE_ROWS);
    // The soonest due first, whenever it was written, with who is at work on it.
    expect(glance.inProgress.items[0]?.title).toBe("Due the soonest");
    expect(glance.inProgress.items[0]?.workers.map((worker) => worker.id)).toEqual([carol]);
    // The days in order, and those due on no day after every one that is.
    const days = glance.inProgress.items.map((task) => task.dueOn);
    const dated = days.filter((day): day is string => day !== null);
    expect(dated).toEqual([...dated].sort());
    expect(days.slice(dated.length).every((day) => day === null)).toBe(true);
    expect(dated.length).toBeGreaterThan(1);
    expect(days.length - dated.length).toBeGreaterThan(1);
    expect(glance.inReview).toMatchObject({ total: 2 });
    expect(glance.inReview.items.map((task) => task.title)).toEqual(["Read me first", "Read me"]);
    expect(glance.goals.total).toBe(2);
    expect(glance.goals.items.map((goal) => goal.title)).toEqual(["Active", "Planned"]);
    expect(glance.goals.items[0]?.taskCounts.done).toBe(1);
    // What a tile does not draw is not sent: no body of a task or of a goal.
    expect(JSON.stringify(raw)).not.toContain("A body a glance never carries.");
    expect(JSON.stringify(raw)).not.toContain('"body"');

    // The project itself carries no counts: they are the glance's.
    const one: unknown = await (
      await h.request(at("glanced"), { headers: { cookie: admin } })
    ).json();
    expect(one).not.toHaveProperty("taskCounts");
    expect(restProjectSchema.parse(one).openDecisions).toBe(1);
  });

  it("is read by whoever may see the project and by nobody else, one that is not theirs the same as one that is not there", async () => {
    expect((await post(fromPages(admin), { key: "closed", name: "Closed" })).status).toBe(201);
    // Nobody signed in.
    expect((await h.request(at("closed", "/glance"))).status).toBe(401);
    // A member of the workspace who is not listed in a private project: it is not there, in
    // the words of a project that never was.
    const hidden = await h.request(at("closed", "/glance"), { headers: { cookie: member } });
    const never = await h.request(at("no-such-project", "/glance"), {
      headers: { cookie: member },
    });
    expect(hidden.status).toBe(404);
    expect(never.status).toBe(404);
    expect(await hidden.json()).toEqual(await never.json());
    // An agent reads what its person may: the administrator's the project, the member's not.
    const adminsAgent = await tokenFor(admin, "glance-admin");
    const membersAgent = await tokenFor(member, "glance-member");
    const { glance } = await glanceOf("closed", { authorization: `Bearer ${adminsAgent}` });
    expect(glance.inProgress).toEqual({ items: [], total: 0 });
    expect(glance.goals).toEqual({ items: [], total: 0 });
    const refused = await h.request(at("closed", "/glance"), {
      headers: { authorization: `Bearer ${membersAgent}` },
    });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual(
      await (
        await h.request(at("no-such-project", "/glance"), {
          headers: { authorization: `Bearer ${membersAgent}` },
        })
      ).json(),
    );
    // Listed in it, the member reads it.
    const alice = restMeSchema.parse(
      await (await h.request(REST_ROUTES.me, { headers: { cookie: member } })).json(),
    ).person?.id;
    const listed = await h.request(at("closed", "/members"), {
      method: "POST",
      headers: { ...fromPages(admin), ...JSON_HEADERS },
      body: JSON.stringify({ personId: alice, role: "member" }),
    });
    expect(listed.ok).toBe(true);
    expect((await glanceOf("closed", { cookie: member })).glance.openDecisions).toBe(0);
    // A key that is no key reaches nothing.
    expect(
      (
        await h.request(`${REST_ROUTES.projects}/NOT%20A%20KEY/glance`, {
          headers: { cookie: admin },
        })
      ).status,
    ).toBe(404);
  });
});
