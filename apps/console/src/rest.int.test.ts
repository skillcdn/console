import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAIM_PATH,
  connectPath,
  DEFAULT_TOKEN_DAYS,
  MAX_FILE_BYTES,
  MAX_FILES_PER_COMMENT,
  MAX_PROJECT_ICON_BYTES,
  MAX_RULES_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKENS_PER_PERSON,
  OPEN_TASK_STATES,
  personTokensPath,
  personWorkPath,
  projectPath,
  REFERENCE_RULES,
  REST_ROUTES,
  type RestTask,
  restCategoriesSchema,
  restCategorySchema,
  restClaimSchema,
  restCommentSchema,
  restCommentsSchema,
  restConnectionSchema,
  restConnectRequestSchema,
  restDecisionSchema,
  restDecisionsSchema,
  restDocumentSchema,
  restDocumentsSchema,
  restErrorSchema,
  restEventsSchema,
  restGoalSchema,
  restGoalsSchema,
  restListingSchema,
  restMemberSchema,
  restMembersSchema,
  restMeSchema,
  restPeopleSchema,
  restPersonSchema,
  restPersonWorkSchema,
  restProjectRulesSchema,
  restProjectSchema,
  restProjectsSchema,
  restRulesSchema,
  restSkillBrowseSchema,
  restSkillFileSchema,
  restSkillFindSchema,
  restSkillLoadSchema,
  restSkillsSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
  restTokensSchema,
  restVersionSchema,
  restVersionsSchema,
  restWorkSchema,
  restWorkspaceSchema,
  rulesPath,
} from "@skillcdn/console/api";
import {
  type Address,
  formatAddress,
  parseAddress,
  type RestBrowse,
  type RestFile,
  type RestFind,
  type RestMount,
  type RestSkill,
} from "@skillcdn/core";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDirectorySource } from "./adapters/directory-packs.js";
import { drizzleOf } from "./db/client.js";
import { archiveStaleTasks } from "./db/queries/tasks.js";
import { ensureWorkspace } from "./db/queries/workspaces.js";
import { tasks } from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { Archivist } from "./jobs/archivist.js";
import { OrganizationSync } from "./jobs/organization-sync.js";
import { type Pack, PackError, type PackSource } from "./ports/skill-source.js";
import { createFixtureOrganization } from "./testing/fixture-organization.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, HARNESS_VERSION, type Harness, SIGN_IN_URL } from "./testing/harness.js";

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
const parseAddressOrThrow = (text: string): Address => {
  const parsed = parseAddress(text);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
};

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
      color: "teal",
      symbol: "Dx",
    });
    expect(made.status).toBe(201);
    const docs = restProjectSchema.parse(await made.json());
    expect(docs).toMatchObject({
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
    // A project that chose no mark has none: the pages choose one from its key and name.
    expect(open).toMatchObject({
      key: "web",
      role: "member",
      visibility: "workspace",
      color: null,
      symbol: null,
    });
  });

  it("carry an image for their mark: set and taken away by an owner, served to whoever may see the project, and never believed to be what it says", async () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    const upload = (cookie: string, bytes: Uint8Array, type = "image/png", at = IN) => {
      const form = new FormData();
      form.set("file", new File([bytes], "mark.png", { type }), "mark.png");
      return h.request(`${at}/icon`, {
        method: "POST",
        headers: { cookie, origin: SIGN_IN_URL },
        body: form,
      });
    };
    const byMember = await upload(bob, png);
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const svg = await upload(
      alice,
      new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      "image/svg+xml",
    );
    expect(svg.status).toBe(400);
    expect(await errorOf(svg)).toBe("project.invalid_icon");
    const saysPng = await upload(alice, new TextEncoder().encode("not a picture at all"));
    expect(saysPng.status).toBe(400);
    expect(await errorOf(saysPng)).toBe("project.invalid_icon");
    const tooBig = new Uint8Array(MAX_PROJECT_ICON_BYTES + 1);
    tooBig.set(png);
    const large = await upload(alice, tooBig);
    expect(large.status).toBe(413);
    expect(await errorOf(large)).toBe("request.too_large");

    const before = await latestEventIn(alice);
    const set = await upload(alice, png);
    expect(set.status).toBe(200);
    const sha256 = createHash("sha256").update(png).digest("hex");
    expect(restProjectSchema.parse(await set.json()).icon).toEqual({
      sha256,
      contentType: "image/png",
    });
    // The same image again changes nothing and writes nothing.
    expect((await upload(alice, png)).status).toBe(200);
    const since = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?after=${before}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.data])).toEqual([
      ["project.updated", { key: "web", name: "The web app", fields: ["icon"] }],
    ]);
    const served = await get(bob, `${IN}/icon`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("etag")).toBe(`"${sha256}"`);
    expect(served.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-disposition")).toContain("inline");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
    const cached = await h.request(`${IN}/icon`, {
      headers: { cookie: bob, "if-none-match": `"${sha256}"` },
    });
    expect(cached.status).toBe(304);
    // A project one may not see has no image to speak of; one without an image says so.
    expect(await errorOf(await get(bob, `${projectPath("docs")}/icon`))).toBe("project.not_found");
    expect(await errorOf(await get(alice, `${projectPath("docs")}/icon`))).toBe("project.no_icon");

    const removed = await send(alice, "DELETE", `${IN}/icon`);
    expect(removed.status).toBe(200);
    expect(restProjectSchema.parse(await removed.json()).icon).toBeNull();
    const gone = await get(bob, `${IN}/icon`);
    expect(gone.status).toBe(404);
    expect(await errorOf(gone)).toBe("project.no_icon");
    expect((await send(bob, "DELETE", `${IN}/icon`)).status).toBe(403);
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
      { key: "ok", name: "x", color: "red" },
      { key: "ok", name: "x", symbol: "a b" },
      { key: "ok", name: "x", symbol: "123456789" },
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
    // The mark is set and given up like the rest, and the board hears which fields changed.
    const marked = await send(alice, "PATCH", projectPath("docs"), { color: "pink", symbol: "D" });
    expect(restProjectSchema.parse(await marked.json())).toMatchObject({
      color: "pink",
      symbol: "D",
    });
    const sinceMarked = await latestEventIn(alice, projectPath("docs"));
    const unmarked = await send(alice, "PATCH", projectPath("docs"), { color: null, symbol: null });
    expect(restProjectSchema.parse(await unmarked.json())).toMatchObject({
      color: null,
      symbol: null,
    });
    expect(
      restEventsSchema
        .parse(
          await (await get(alice, `${projectPath("docs")}/events?after=${sinceMarked}`)).json(),
        )
        .items.map((event) => [event.kind, event.data]),
    ).toEqual([
      ["project.updated", { key: "docs", name: "Documentation", fields: ["color", "symbol"] }],
    ]);
    // Open to the workspace now, Bob sees it as a member, and may not change it.
    const byMember = await send(bob, "PATCH", projectPath("docs"), { name: "Mine" });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    // An owner's agent configures as its owner does (ADR-0021), named on what it did; a
    // member's agent is a member.
    const { secret } = restTokenCreatedSchema.parse(
      await (await send(alice, "POST", REST_ROUTES.tokens, { name: "an owner's agent" })).json(),
    );
    const auth = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const byToken = await h.request(projectPath("docs"), {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(byToken.status).toBe(200);
    expect(restProjectSchema.parse(await byToken.json()).name).toBe("Mine");
    const renamed = restEventsSchema
      .parse(await (await get(alice, `${projectPath("docs")}/events?after=0`)).json())
      .items.at(-1);
    expect(renamed).toMatchObject({ kind: "project.updated", agent: "an owner's agent" });
    expect(renamed?.actor?.login).toBe("Alice");
    expect(
      (await send(alice, "PATCH", projectPath("docs"), { name: "Documentation" })).status,
    ).toBe(200);
    const madeByToken = await h.request(REST_ROUTES.projects, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ key: "by-agent", name: "Made by an agent" }),
    });
    expect(madeByToken.status).toBe(201);
    expect(restProjectSchema.parse(await madeByToken.json())).toMatchObject({
      key: "by-agent",
      role: "owner",
    });
    const made = restEventsSchema.parse(
      await (await get(alice, `${projectPath("by-agent")}/events?after=0`)).json(),
    ).items;
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ kind: "project.created", agent: "an owner's agent" });
    const bobs = restTokenCreatedSchema.parse(
      await (await send(bob, "POST", REST_ROUTES.tokens, { name: "a member's agent" })).json(),
    );
    const byMembersToken = await h.request(projectPath("docs"), {
      method: "PATCH",
      headers: { authorization: `Bearer ${bobs.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(byMembersToken.status).toBe(403);
    expect(await errorOf(byMembersToken)).toBe("auth.forbidden");
    expect((await send(bob, "DELETE", `${REST_ROUTES.tokens}/${bobs.token.id}`)).status).toBe(204);
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
      ["by-agent", "owner"],
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
    // A page at a time, the newest first, and whether there is more after it.
    const page = restTasksSchema.parse(await (await get(alice, `${IN}/tasks?limit=1`)).json());
    expect(page.items.map((task) => task.id)).toEqual([second.id]);
    expect(page.more).toBe(true);
    const next = restTasksSchema.parse(
      await (await get(alice, `${IN}/tasks?limit=1&offset=1`)).json(),
    );
    expect(next.items.map((task) => task.id)).toEqual([first.id]);
    expect(next.more).toBe(listed.items.length > 2);
    expect(
      restTasksSchema.parse(
        await (await get(alice, `${IN}/tasks?offset=${listed.items.length}`)).json(),
      ),
    ).toEqual({ items: [], more: false });
    for (const query of ["limit=0", "limit=501", "limit=x", "offset=-1"]) {
      const refused = await get(alice, `${IN}/tasks?${query}`);
      expect(refused.status, query).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
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
    expect(
      restDecisionsSchema.parse(
        await (await get(bob, `${IN}/decisions?task=${task.id}&limit=1`)).json(),
      ),
    ).toEqual({ items: about.items, more: false });
    expect(
      restDecisionsSchema.parse(
        await (await get(bob, `${IN}/decisions?task=${task.id}&offset=1`)).json(),
      ),
    ).toEqual({ items: [], more: false });
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

  it("are answered in the person's own words as one more option marked theirs, with an option or own and never both", async () => {
    const raised = await send(alice, "POST", `${IN}/decisions`, {
      question: "Which colour?",
      options: [{ label: "Red" }, { label: "Blue" }],
    });
    const decision = restDecisionSchema.parse(await raised.json());
    const both = await send(bob, "POST", `${IN}/decisions/${decision.id}/answer`, {
      option: "1",
      own: "Green",
    });
    expect(both.status).toBe(400);
    expect(await errorOf(both)).toBe("request.invalid");
    const neither = await send(bob, "POST", `${IN}/decisions/${decision.id}/answer`, {
      note: "Hm.",
    });
    expect(await errorOf(neither)).toBe("request.invalid");
    const answered = await send(bob, "POST", `${IN}/decisions/${decision.id}/answer`, {
      own: "  Green, as the brand is  ",
      note: "Neither fits.",
    });
    expect(answered.status, await answered.clone().text()).toBe(200);
    const own = restDecisionSchema.parse(await answered.json());
    expect(own.options).toEqual([
      { id: "1", label: "Red" },
      { id: "2", label: "Blue" },
      { id: "3", label: "Green, as the brand is", own: true },
    ]);
    expect(own.answer).toMatchObject({ option: "3", note: "Neither fits." });
    expect(own.answer?.by.login).toBe("bob");
    // The board hears the label, as for an option given; the record reads back the same.
    const events = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?after=0&decision=${decision.id}`)).json(),
    );
    expect(events.items.find((event) => event.kind === "decision.answered")?.data.option).toBe(
      "Green, as the brand is",
    );
    expect(
      restDecisionSchema
        .parse(await (await get(alice, `${IN}/decisions/${decision.id}`)).json())
        .options.at(-1),
    ).toEqual({ id: "3", label: "Green, as the brand is", own: true });
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
  it("list everyone who signed in, by login, each with their standing", async () => {
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    expect(people.items.map((person) => person.login)).toEqual(["Alice", "bob", "carol"]);
    expect(people.items[0]).toMatchObject({
      status: "active",
      source: "listed",
      deactivatedAt: null,
    });
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
    expect(used?.client).toBeNull();
    // The command names its version, and the token keeps it (ADR-0025).
    const named = await h.request(REST_ROUTES.projects, {
      headers: { ...auth, "user-agent": `skillcdn-console/${HARNESS_VERSION} (cli)` },
    });
    expect(named.status).toBe(200);
    // The note does not hold the answer up, so the listing is read once it has landed.
    await expect
      .poll(async () => (await listed(alice)).find((item) => item.id === token.id)?.client, {
        timeout: 2000,
      })
      .toBe(HARNESS_VERSION);
    // A token sees the projects its person sees, and no more.
    const projects = restProjectsSchema.parse(
      await (await h.request(REST_ROUTES.projects, { headers: auth })).json(),
    );
    expect(projects.items.map((project) => project.key)).toEqual(["docs", "by-agent", "web"]);
  });

  it("give themselves up: DELETE /api/v1/me/token with the token, never with a session", async () => {
    const { token, secret } = await make(alice, { name: "leaving" });
    const auth = { authorization: `Bearer ${secret}` };
    const bySession = await h.request(REST_ROUTES.meToken, {
      method: "DELETE",
      headers: { cookie: alice, origin: SIGN_IN_URL },
    });
    expect(bySession.status).toBe(400);
    expect(await errorOf(bySession)).toBe("request.invalid");
    expect((await listed(alice)).map((item) => item.id)).toContain(token.id);
    const gone = await h.request(REST_ROUTES.meToken, { method: "DELETE", headers: auth });
    expect(gone.status).toBe(204);
    expect((await listed(alice)).map((item) => item.id)).not.toContain(token.id);
    const again = await h.request(REST_ROUTES.meToken, { method: "DELETE", headers: auth });
    expect(again.status).toBe(401);
    expect((await h.request(`${IN}/tasks`, { headers: auth })).status).toBe(401);
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

    // Membership is decided on every request, for a token as for a session (ADR-0022):
    // deactivated, Bob's token is nothing; back in, it is Bob again.
    const { secret: whileIn } = await make(bob, { name: "while in" });
    const admins = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["carol"],
    });
    const carol = await admins.signIn("carol");
    const bobId = restMeSchema.parse(await (await get(bob, REST_ROUTES.me)).json()).person?.id;
    const standing = (status: string) =>
      admins.request(`${REST_ROUTES.people}/${bobId}`, {
        method: "PATCH",
        headers: { cookie: carol, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
    expect((await standing("deactivated")).status).toBe(200);
    const out = await h.request(`${IN}/tasks`, {
      headers: { authorization: `Bearer ${whileIn}` },
    });
    expect(out.status).toBe(401);
    expect((await standing("active")).status).toBe(200);
    const back = await h.request(`${IN}/tasks`, {
      headers: { authorization: `Bearer ${whileIn}` },
    });
    expect(back.status).toBe(200);
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
    // An administrator's agent says what a person is, as the administrator does (ADR-0021),
    // and is named on it; a member's agent may not.
    const byToken = await named.request(`${REST_ROUTES.people}/${bobId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(byToken.status).toBe(200);
    expect(restPersonSchema.parse(await byToken.json()).role).toBe("admin");
    const saidByAgent = restEventsSchema
      .parse(await (await get(alice, `${REST_ROUTES.events}?after=0`)).json())
      .items.at(-1);
    expect(saidByAgent).toMatchObject({
      kind: "person.role_changed",
      agent: "an administrator's agent",
      data: { login: "bob", role: "admin" },
    });
    expect(saidByAgent?.actor?.login).toBe("Alice");
    expect((await change(admin, bobId, { role: "member" })).status).toBe(200);
    const bobsSecret = restTokenCreatedSchema.parse(
      await (
        await named.request(REST_ROUTES.tokens, {
          method: "POST",
          headers: { cookie: bob, origin: SIGN_IN_URL, "content-type": "application/json" },
          body: JSON.stringify({ name: "a member's agent" }),
        })
      ).json(),
    ).secret;
    const byMembersToken = await named.request(`${REST_ROUTES.people}/${bobId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${bobsSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(byMembersToken.status).toBe(403);
    expect(await errorOf(byMembersToken)).toBe("auth.forbidden");

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

/** A pack whose reads are never asked: what the tests of the listing need of them. */
const unread = {
  browse: async (): Promise<RestBrowse> => {
    throw new Error("not asked");
  },
  find: async (): Promise<RestFind> => {
    throw new Error("not asked");
  },
  skill: async (): Promise<RestSkill> => {
    throw new Error("not asked");
  },
  file: async (): Promise<RestFile> => {
    throw new Error("not asked");
  },
};

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** What an address serves, as a pack answers it: one skill, with a title in Korean. */
function mountOf(address: Address): RestMount {
  return {
    address: formatAddress(address),
    repository: {
      host: address.host,
      owner: address.owner,
      name: address.repo,
      defaultBranch: "main",
      description: null,
      avatar: "https://avatars.example/acme.png",
    },
    ref: address.ref?.kind === "name" ? address.ref.name : null,
    pinned: false,
    commit: COMMIT,
    path: address.path,
    verified: false,
    image: null,
    index: {
      status: "ready",
      truncated: false,
      manifest: null,
      skillCount: 1,
      documentCount: 0,
      skills: [
        {
          path: "review/SKILL.md",
          name: "review",
          directory: "review",
          description: "Reviews a change.",
          warnings: [],
          translations: { ko: { title: "리뷰", description: null } },
        },
      ],
      documents: [],
      diagnostics: [],
    },
  };
}

describe("skills", () => {
  it("are none without an address, the organization's with one, and a project's own when it names one", async () => {
    const none = restSkillsSchema.parse(await (await get(alice, `${IN}/skills`)).json());
    expect(none).toEqual({
      address: null,
      source: "https://skillcdn.ai",
      page: null,
      status: "none",
      refusal: null,
      items: [],
      mount: null,
    });

    const asked: string[] = [];
    const source: PackSource = {
      open(address) {
        return {
          address,
          location: { kind: "deployment", url: "https://skillcdn.test" },
          ...unread,
          async mount() {
            asked.push(formatAddress(address));
            return mountOf(address);
          },
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
      refusal: null,
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
    // What the pack answered travels with the listing, as it was answered.
    expect(first.mount).toEqual(mountOf(parseAddressOrThrow("/gh/acme/skills")));
    // Held for a while: a second read asks the pack nothing.
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

describe("a pack served from the console's machine (ADR-0031)", () => {
  it("is read from the directory the console was given, as a deployment's own reads would answer it, with no page and no token", async () => {
    const root = await mkdtemp(join(tmpdir(), "console-packs-"));
    try {
      const directory = join(root, "acme", "skills");
      await mkdir(join(directory, "review"), { recursive: true });
      await writeFile(
        join(directory, "SKILLCDN.md"),
        "---\nname: Acme\ndescription: What Acme does, as skills.\n---\nBe kind.\n",
      );
      await writeFile(
        join(directory, "review", "SKILL.md"),
        "---\nname: review\ndescription: Reviews a change.\n---\nRead the diff.\n",
      );
      const deployment: PackSource = {
        open: () => {
          throw new Error("the deployment is not asked for a local address");
        },
      };
      const served = createHarness(testDatabase, {
        providers: [createFixtureProvider()],
        skills: {
          address: "/local/acme/skills",
          source: deployment,
          directory: createDirectorySource({
            root,
            clock: { now: () => new Date() },
            logger: pino({ level: "silent" }),
          }),
        },
      });
      const cookie = await served.signIn("alice");
      const headers = { cookie };
      const listed = restSkillsSchema.parse(
        await (await served.request(`${IN}/skills`, { headers })).json(),
      );
      expect(listed).toMatchObject({
        address: "/local/acme/skills",
        source: null,
        page: null,
        status: "ready",
        refusal: null,
        pack: { name: "Acme", description: "What Acme does, as skills." },
        counts: { skills: 1, documents: 0 },
        items: [
          { path: "review/SKILL.md", page: null, uri: "skill://local/acme/skills/review/SKILL.md" },
        ],
      });
      expect(listed.mount).toMatchObject({
        verified: true,
        repository: { host: "local", owner: "acme", name: "skills" },
      });
      const one = restSkillLoadSchema.parse(
        await (await served.request(`${IN}/skills/one?path=review%2FSKILL.md`, { headers })).json(),
      );
      expect(one.status).toBe("ready");
      expect(one.read?.status === "ready" ? one.read.skill.body : "").toContain("Read the diff.");
      expect(
        one.read?.status === "ready" ? one.read.skill.ruleChain?.map((rule) => rule.body) : [],
      ).toEqual(["Be kind."]);
      const found = restSkillFindSchema.parse(
        await (await served.request(`${IN}/skills/find?query=review`, { headers })).json(),
      );
      expect(
        found.read?.status === "ready" ? found.read.items.map((item) => item.path) : [],
      ).toEqual(["review/SKILL.md"]);
      // A pack that is not in the directory is not found, in the pack's own words; the
      // deployment is never asked for a local address.
      const named = await served.request("/api/v1/projects", {
        method: "POST",
        headers: { cookie, origin: SIGN_IN_URL, "content-type": "application/json" },
        body: JSON.stringify({ key: "packs", name: "Packs", skillsAddress: "/local/acme/missing" }),
      });
      expect(named.status).toBe(201);
      const missing = restSkillsSchema.parse(
        await (await served.request(`${projectPath("packs")}/skills`, { headers })).json(),
      );
      expect(missing).toMatchObject({
        status: "not_found",
        refusal: { code: "mount.repo_not_found" },
        items: [],
        mount: null,
      });
      await served.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the schedule and the roadmap", () => {
  const personId = async (login: string) =>
    restPeopleSchema
      .parse(await (await get(alice, REST_ROUTES.people)).json())
      .items.find((person) => person.login === login)?.id ?? "";

  it("keep a task's plan in days and its moments on the board, and narrow the board by them", async () => {
    const planned = await createTask(alice, {
      title: "Plan the launch",
      startsOn: "2026-10-20",
      dueOn: "2026-10-24",
      category: "engineering",
    });
    expect(planned).toMatchObject({
      startsOn: "2026-10-20",
      dueOn: "2026-10-24",
      startedAt: null,
      doneAt: null,
      archivedAt: null,
      goalId: null,
      category: { key: "engineering", name: "Engineering", color: "blue" },
    });
    const bobId = await personId("bob");
    const started = restTaskSchema.parse(
      await (
        await send(bob, "PATCH", `${IN}/tasks/${planned.id}`, {
          state: "in_progress",
          assigneeId: bobId,
        })
      ).json(),
    );
    expect(started.startedAt).not.toBeNull();
    expect(started.doneAt).toBeNull();
    const done = restTaskSchema.parse(
      await (await send(bob, "PATCH", `${IN}/tasks/${planned.id}`, { state: "done" })).json(),
    );
    expect(done.doneAt).not.toBeNull();
    expect(done.startedAt).toBe(started.startedAt);

    const ids = async (query: string) =>
      restTasksSchema
        .parse(await (await get(bob, `${IN}/tasks?${query}`)).json())
        .items.map((task) => task.id);
    expect(await ids("category=engineering")).toContain(planned.id);
    expect(await ids("category=design")).not.toContain(planned.id);
    expect(await ids("dueBy=2026-10-24")).toContain(planned.id);
    expect(await ids("dueBy=2026-10-23")).not.toContain(planned.id);
    expect(await ids("open=false")).toContain(planned.id);
    expect(await ids("open=true")).not.toContain(planned.id);
    expect(await ids(`assignee=${bobId}`)).toContain(planned.id);
    const nobodys = await createTask(alice, { title: "Handed to nobody yet" });
    expect(await ids("unassigned=true")).toContain(nobodys.id);
    expect(await ids("unassigned=true")).not.toContain(planned.id);
    expect(await ids(`unassigned=true&assignee=${bobId}`)).toEqual([]);

    for (const [body, code] of [
      [{ title: "x", startsOn: "2026-10-24", dueOn: "2026-10-20" }, "task.invalid_dates"],
      [{ title: "x", dueOn: "next week" }, "request.invalid"],
      [{ title: "x", dueOn: "2026-10-24T10:00:00Z" }, "request.invalid"],
      [{ title: "x", category: "nothing" }, "task.invalid_category"],
      [{ title: "x", category: "Not A Key" }, "request.invalid"],
      [{ title: "x", goalId: "0199c4d8-0000-7000-8000-000000000099" }, "task.invalid_goal"],
    ] as const) {
      const response = await send(alice, "POST", `${IN}/tasks`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(response)).toBe(code);
    }
    for (const query of ["dueBy=soon", "goal=7", "assignee=bob", "category=Not%20A%20Key"]) {
      const response = await get(alice, `${IN}/tasks?${query}`);
      expect(response.status, query).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    }
  });

  it("set goals by an owner, count their tasks live, and refuse a member", async () => {
    const set = await send(alice, "POST", `${IN}/goals`, {
      title: "Ship v1",
      body: "What it means.",
      state: "active",
      dueOn: "2026-11-15",
    });
    expect(set.status).toBe(201);
    const goal = restGoalSchema.parse(await set.json());
    expect(goal).toMatchObject({
      title: "Ship v1",
      state: "active",
      dueOn: "2026-11-15",
      taskCounts: { done: 0, in_progress: 0 },
    });
    expect(goal.createdBy.login).toBe("Alice");
    // Bob works in the project and may not set its roadmap.
    const byMember = await send(bob, "POST", `${IN}/goals`, { title: "Bob's" });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const part = await createTask(bob, { title: "Part of it", goalId: goal.id, state: "done" });
    expect(part.goalId).toBe(goal.id);
    const listed = restGoalsSchema.parse(await (await get(bob, `${IN}/goals`)).json());
    expect(listed.items.find((item) => item.id === goal.id)?.taskCounts.done).toBe(1);
    expect(
      restGoalSchema.parse(await (await get(bob, `${IN}/goals/${goal.id}`)).json()).taskCounts.done,
    ).toBe(1);
    const latest = await latestEventIn(alice);
    const reached = await send(alice, "PATCH", `${IN}/goals/${goal.id}`, { state: "done" });
    expect(reached.status).toBe(200);
    expect(restGoalSchema.parse(await reached.json()).state).toBe("done");
    expect((await send(bob, "PATCH", `${IN}/goals/${goal.id}`, { state: "active" })).status).toBe(
      403,
    );
    const since = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?after=${latest}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.goalId, event.data])).toEqual([
      ["goal.updated", goal.id, { title: "Ship v1", fields: ["state"] }],
    ]);
    const history = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?goal=${goal.id}`)).json(),
    );
    expect(history.items.map((event) => event.kind)).toEqual(["goal.created", "goal.updated"]);
    for (const id of ["not-an-id", "0199c4d8-0000-7000-8000-000000000099"]) {
      const response = await get(alice, `${IN}/goals/${id}`);
      expect(response.status, id).toBe(404);
      expect(await errorOf(response)).toBe("goal.not_found");
    }
    // A goal of another project is not one of this one.
    const elsewhere = restGoalSchema.parse(
      await (
        await send(alice, "POST", `${projectPath("docs")}/goals`, { title: "The docs' own" })
      ).json(),
    );
    const across = await send(alice, "POST", `${IN}/tasks`, { title: "x", goalId: elsewhere.id });
    expect(across.status).toBe(400);
    expect(await errorOf(across)).toBe("task.invalid_goal");
  });

  it("plan a goal in days and sort it into a category, and narrow the roadmap by them (ADR-0026)", async () => {
    const set = await send(alice, "POST", `${IN}/goals`, {
      title: "Planned",
      category: "design",
      startsOn: "2026-10-01",
      dueOn: "2026-12-31",
    });
    expect(set.status).toBe(201);
    const planned = restGoalSchema.parse(await set.json());
    expect(planned).toMatchObject({
      category: { key: "design", name: "Design", color: "pink" },
      startsOn: "2026-10-01",
      dueOn: "2026-12-31",
    });
    const byCategory = restGoalsSchema.parse(
      await (await get(bob, `${IN}/goals?category=design&state=planned`)).json(),
    );
    expect(byCategory.items.map((goal) => goal.id)).toEqual([planned.id]);
    expect(
      restGoalsSchema.parse(await (await get(bob, `${IN}/goals?category=engineering`)).json())
        .items,
    ).toEqual([]);
    for (const [body, code] of [
      [{ title: "x", category: "nope" }, "goal.invalid_category"],
      [{ title: "x", startsOn: "2026-12-31", dueOn: "2026-10-01" }, "goal.invalid_dates"],
    ] as const) {
      const refused = await send(alice, "POST", `${IN}/goals`, body);
      expect(refused.status, code).toBe(400);
      expect(await errorOf(refused)).toBe(code);
    }
    for (const query of ["state=open", "category=Not%20A%20Key"]) {
      const response = await get(alice, `${IN}/goals?${query}`);
      expect(response.status, query).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    }
    const latest = await latestEventIn(alice);
    const moved = await send(alice, "PATCH", `${IN}/goals/${planned.id}`, {
      category: null,
      startsOn: null,
    });
    expect(moved.status).toBe(200);
    expect(restGoalSchema.parse(await moved.json())).toMatchObject({
      category: null,
      startsOn: null,
    });
    const since = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?after=${latest}`)).json(),
    );
    expect(since.items.map((event) => event.data)).toEqual([
      { title: "Planned", fields: ["category", "startsOn"] },
    ]);
  });

  it("list what is on a person's plate across the projects they may see", async () => {
    const aliceId = await personId("Alice");
    const bobId = await personId("bob");
    const later = await createTask(alice, {
      title: "Mine, later",
      assigneeId: aliceId,
      dueOn: "2026-12-01",
    });
    const sooner = await createTask(alice, {
      title: "Mine, sooner",
      assigneeId: aliceId,
      dueOn: "2026-10-01",
    });
    const undated = await createTask(alice, { title: "Mine, some day", assigneeId: aliceId });
    const inDocs = await createTask(
      alice,
      { title: "Mine in the docs", assigneeId: aliceId },
      projectPath("docs"),
    );
    const bobs = await createTask(alice, { title: "Bob's", assigneeId: bobId });
    const finished = await createTask(alice, {
      title: "Mine, done",
      assigneeId: aliceId,
      state: "done",
    });
    const dropped = await createTask(alice, {
      title: "Mine, dropped",
      assigneeId: aliceId,
      state: "dropped",
    });
    const putAway = await createTask(alice, {
      title: "Mine, done and put away",
      assigneeId: aliceId,
      state: "done",
    });
    expect((await send(alice, "POST", `${IN}/tasks/${putAway.id}/archive`)).ok).toBe(true);
    const raised = restDecisionSchema.parse(
      await (
        await send(bob, "POST", `${IN}/decisions`, {
          question: "On whose plate?",
          options: [{ label: "Mine" }, { label: "Yours" }],
        })
      ).json(),
    );
    const work = restWorkSchema.parse(await (await get(alice, REST_ROUTES.work)).json());
    const titles = work.tasks.map((item) => [item.project.key, item.task.title]);
    expect(titles).toContainEqual(["web", "Mine, sooner"]);
    expect(titles).toContainEqual(["docs", "Mine in the docs"]);
    expect(titles).not.toContainEqual(["web", "Bob's"]);
    expect(titles).not.toContainEqual(["web", "Mine, done"]);
    // What was done or dropped and is not put away yet comes apart, for the week on the plate.
    const closed = (work.closed ?? []).map((item) => item.task.id);
    expect(closed).toContain(finished.id);
    expect(closed).toContain(dropped.id);
    expect(closed).not.toContain(putAway.id);
    expect(closed).not.toContain(sooner.id);
    // The sooner due first, and what has no day after everything that has one.
    const order = work.tasks.map((item) => item.task.id);
    expect(order.indexOf(sooner.id)).toBeLessThan(order.indexOf(later.id));
    expect(order.indexOf(later.id)).toBeLessThan(order.indexOf(undated.id));
    expect(
      work.decisions.some((item) => item.decision.id === raised.id && item.project.key === "web"),
    ).toBe(true);
    expect(work.decisions.every((item) => item.decision.answer === null)).toBe(true);
    // Bob sees his own, and nothing of the docs project, which is not his to see.
    const bobWork = restWorkSchema.parse(await (await get(bob, REST_ROUTES.work)).json());
    expect(bobWork.tasks.map((item) => item.task.id)).toEqual([bobs.id]);
    expect((bobWork.closed ?? []).every((item) => item.task.assignee?.id === bobId)).toBe(true);
    expect((bobWork.closed ?? []).some((item) => item.task.id === finished.id)).toBe(false);
    expect(bobWork.tasks.some((item) => item.task.id === inDocs.id)).toBe(false);
    expect(bobWork.decisions.some((item) => item.decision.id === raised.id)).toBe(true);
    expect(finished.state).toBe("done");
  });

  it("show another person's plate to whoever oversees them, within what the asker may see", async () => {
    const aliceId = await personId("Alice");
    const bobId = await personId("bob");
    // Alice owns the web project, open to everyone of the workspace: Bob is in it, so his plate is hers to see.
    const bobsPlate = restPersonWorkSchema.parse(
      await (await get(alice, personWorkPath(bobId))).json(),
    );
    expect(bobsPlate.tasks.map((item) => item.task.title)).toContain("Bob's");
    expect(bobsPlate.tasks.every((item) => item.task.assignee?.id === bobId)).toBe(true);
    expect(
      (bobsPlate.closed ?? []).every(
        (item) => item.task.assignee?.id === bobId && !OPEN_TASK_STATES.includes(item.task.state),
      ),
    ).toBe(true);
    expect(bobsPlate).not.toHaveProperty("decisions");
    // Bob owns nothing yet: Alice's plate is not his to see; nor is an id that is nobody's anyone's.
    expect(await errorOf(await get(bob, personWorkPath(aliceId)))).toBe("auth.forbidden");
    expect(
      await errorOf(await get(alice, personWorkPath("0199c4d8-0000-7000-8000-00000000dead"))),
    ).toBe("person.not_found");
    // A private project of Bob's own, with Alice listed in it, makes her plate his to see: within
    // what he may see, which the docs project, private and not his, is not.
    await h.project(bob, { key: "bobs", name: "Bob's own", visibility: "private" });
    const listed = await send(bob, "POST", `${projectPath("bobs")}/members`, { personId: aliceId });
    expect(listed.status).toBe(201);
    const alicesPlate = restPersonWorkSchema.parse(
      await (await get(bob, personWorkPath(aliceId))).json(),
    );
    const titles = alicesPlate.tasks.map((item) => [item.project.key, item.task.title]);
    expect(titles).toContainEqual(["web", "Mine, sooner"]);
    expect(titles).not.toContainEqual(["docs", "Mine in the docs"]);
    expect(titles.some(([key]) => key === "docs")).toBe(false);
    // What she closed comes too, within the same sight, for the week on her plate.
    expect((alicesPlate.closed ?? []).map((item) => item.task.title)).toContain("Mine, done");
    // An administrator sees everyone's, through their agent too.
    const admins = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["carol"],
    });
    const carol = await admins.signIn("carol");
    const seen = await admins.request(personWorkPath(aliceId), { headers: { cookie: carol } });
    expect(seen.status).toBe(200);
    expect(
      restPersonWorkSchema
        .parse(await seen.json())
        .tasks.map((item) => [item.project.key, item.task.title]),
    ).toContainEqual(["docs", "Mine in the docs"]);
  });
});

describe("categories", () => {
  it("are read by anyone, and made, changed and removed by an administrator, themselves or through their agent", async () => {
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["alice"],
    });
    const admin = await named.signIn("alice");
    const asAdmin = (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
      named.request(path, {
        method,
        headers: {
          cookie: admin,
          origin: SIGN_IN_URL,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const listed = restCategoriesSchema.parse(
      await (await get(bob, REST_ROUTES.categories)).json(),
    );
    expect(listed.items.map((category) => category.key)).toEqual(
      expect.arrayContaining(["engineering", "product", "design"]),
    );
    const latest =
      restEventsSchema
        .parse(await (await get(alice, `${REST_ROUTES.events}?after=0`)).json())
        .items.at(-1)?.id ?? 0;

    const made = await asAdmin("POST", REST_ROUTES.categories, {
      key: "research",
      name: "Research",
      color: "yellow",
    });
    expect(made.status).toBe(201);
    expect(restCategorySchema.parse(await made.json())).toMatchObject({
      key: "research",
      name: "Research",
      color: "yellow",
    });
    const taken = await asAdmin("POST", REST_ROUTES.categories, { key: "research", name: "x" });
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe("category.key_taken");
    for (const body of [
      { key: "Research!", name: "x" },
      { key: "research", name: "" },
      { key: "ok", name: "x", color: "#ff0000" },
    ]) {
      const response = await asAdmin("POST", REST_ROUTES.categories, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    }
    // A member may not, a token may not, and nobody may from elsewhere.
    const byMember = await send(bob, "POST", REST_ROUTES.categories, { key: "ops", name: "Ops" });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const { secret } = restTokenCreatedSchema.parse(
      await (
        await asAdmin("POST", REST_ROUTES.tokens, { name: "an administrator's agent" })
      ).json(),
    );
    // An administrator's agent keeps them as the administrator does (ADR-0021).
    const byToken = await named.request(REST_ROUTES.categories, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ key: "by-agent", name: "By an agent" }),
    });
    expect(byToken.status).toBe(201);
    const byAgent = restEventsSchema
      .parse(await (await get(alice, `${REST_ROUTES.events}?after=0`)).json())
      .items.at(-1);
    expect(byAgent).toMatchObject({
      kind: "category.created",
      agent: "an administrator's agent",
      data: { key: "by-agent", name: "By an agent" },
    });
    const removedByToken = await named.request(`${REST_ROUTES.categories}/by-agent`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(removedByToken.status).toBe(204);
    const bobsSecret = restTokenCreatedSchema.parse(
      await (
        await named.request(REST_ROUTES.tokens, {
          method: "POST",
          headers: { cookie: bob, origin: SIGN_IN_URL, "content-type": "application/json" },
          body: JSON.stringify({ name: "a member's agent" }),
        })
      ).json(),
    ).secret;
    const byMembersToken = await named.request(REST_ROUTES.categories, {
      method: "POST",
      headers: { authorization: `Bearer ${bobsSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ key: "ops", name: "Ops" }),
    });
    expect(byMembersToken.status).toBe(403);
    expect(await errorOf(byMembersToken)).toBe("auth.forbidden");
    expect(
      (
        await named.request(REST_ROUTES.categories, {
          method: "POST",
          headers: { cookie: admin, "content-type": "application/json" },
          body: JSON.stringify({ key: "ops", name: "Ops" }),
        })
      ).status,
    ).toBe(403);

    const changed = await asAdmin("PATCH", `${REST_ROUTES.categories}/research`, {
      name: "Research and insight",
    });
    expect(changed.status).toBe(200);
    expect(restCategorySchema.parse(await changed.json()).name).toBe("Research and insight");
    // In use, it stays; moved out of, it goes; gone, it is not found.
    const task = await createTask(alice, { title: "Interview users", category: "research" });
    expect(task.category?.name).toBe("Research and insight");
    const inUse = await asAdmin("DELETE", `${REST_ROUTES.categories}/research`);
    expect(inUse.status).toBe(409);
    expect(await errorOf(inUse)).toBe("category.in_use");
    expect((await send(alice, "PATCH", `${IN}/tasks/${task.id}`, { category: null })).status).toBe(
      200,
    );
    // A goal sorted into it keeps it too (ADR-0026), until the goal is moved out.
    const aimed = restGoalSchema.parse(
      await (
        await send(alice, "POST", `${IN}/goals`, { title: "Research done", category: "research" })
      ).json(),
    );
    expect(aimed.category?.key).toBe("research");
    const stillInUse = await asAdmin("DELETE", `${REST_ROUTES.categories}/research`);
    expect(stillInUse.status).toBe(409);
    expect(await errorOf(stillInUse)).toBe("category.in_use");
    expect((await send(alice, "PATCH", `${IN}/goals/${aimed.id}`, { category: null })).status).toBe(
      200,
    );
    expect((await asAdmin("DELETE", `${REST_ROUTES.categories}/research`)).status).toBe(204);
    expect(
      restCategoriesSchema
        .parse(await (await get(bob, REST_ROUTES.categories)).json())
        .items.some((category) => category.key === "research"),
    ).toBe(false);
    for (const key of ["research", "Not-A-Key", "nothing"]) {
      const response = await asAdmin("PATCH", `${REST_ROUTES.categories}/${key}`, { name: "x" });
      expect(response.status, key).toBe(404);
      expect(await errorOf(response)).toBe("category.not_found");
    }
    const since = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=${latest}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.data])).toEqual([
      ["category.created", { key: "research", name: "Research" }],
      ["category.created", { key: "by-agent", name: "By an agent" }],
      ["category.removed", { key: "by-agent", name: "By an agent" }],
      ["category.updated", { key: "research", name: "Research and insight", fields: ["name"] }],
      ["category.removed", { key: "research", name: "Research and insight" }],
    ]);
    await named.close();
  });
});

describe("who is in", () => {
  const admins = () =>
    createHarness(testDatabase, { providers: [createFixtureProvider()], admins: ["carol"] });
  const change = (
    h2: Harness,
    cookie: string,
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ) =>
    h2.request(path, {
      method,
      headers: {
        cookie,
        origin: SIGN_IN_URL,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const idOf = async (cookie: string, login: string) =>
    restPeopleSchema
      .parse(await (await get(cookie, REST_ROUTES.people)).json())
      .items.find((person) => person.login.toLowerCase() === login)?.id ?? "";

  it("lets a login in by listing it, for an administrator, and takes a listing away", async () => {
    const named = admins();
    const carol = await named.signIn("carol");
    const list = (cookie: string, body: unknown) =>
      change(named, cookie, REST_ROUTES.listings, "POST", body);
    const byMember = await list(bob, { host: "gh", login: "dana" });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const elsewhere = await named.request(REST_ROUTES.listings, {
      method: "POST",
      headers: { cookie: carol, "content-type": "application/json" },
      body: JSON.stringify({ host: "gh", login: "dana" }),
    });
    expect(elsewhere.status).toBe(403);
    // A login as the host spells one, at a provider this deployment has.
    const spelled = await list(carol, { host: "gh", login: "not a login" });
    expect(spelled.status).toBe(400);
    expect(await errorOf(spelled)).toBe("request.invalid");
    const unknownHost = await list(carol, { host: "google", login: "dana@acme.test" });
    expect(unknownHost.status).toBe(400);
    expect(await errorOf(unknownHost)).toBe("listing.unknown_host");
    const made = await list(carol, { host: "gh", login: " Dana " });
    expect(made.status).toBe(201);
    const listing = restListingSchema.parse(await made.json());
    expect(listing).toMatchObject({ host: "gh", login: "Dana" });
    // Listed once, whatever the case; a person in needs no listing.
    const again = await list(carol, { host: "gh", login: "dana" });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("listing.exists");
    const member = await list(carol, { host: "gh", login: "ALICE" });
    expect(member.status).toBe(409);
    expect(await errorOf(member)).toBe("listing.exists");
    const people = restPeopleSchema.parse(await (await get(bob, REST_ROUTES.people)).json());
    expect(people.listed.map((item) => item.login)).toContain("Dana");
    expect(people.items.map((person) => person.login)).not.toContain("Dana");
    const latest = restEventsSchema
      .parse(await (await get(bob, `${REST_ROUTES.events}?after=0`)).json())
      .items.at(-1);
    expect(latest).toMatchObject({ kind: "person.listed", data: { login: "Dana" } });
    expect(latest?.actor?.login).toBe("carol");

    const removal = (cookie: string) =>
      change(named, cookie, `${REST_ROUTES.listings}/${listing.id}`, "DELETE");
    expect((await removal(bob)).status).toBe(403);
    expect((await removal(carol)).status).toBe(204);
    const gone = await removal(carol);
    expect(gone.status).toBe(404);
    expect(await errorOf(gone)).toBe("listing.not_found");
    const after = restPeopleSchema.parse(await (await get(bob, REST_ROUTES.people)).json());
    expect(after.listed.map((item) => item.login)).not.toContain("Dana");
    expect(
      restEventsSchema
        .parse(await (await get(bob, `${REST_ROUTES.events}?after=0`)).json())
        .items.at(-1),
    ).toMatchObject({ kind: "person.unlisted", data: { login: "Dana" } });
  });

  it("deactivates a person, who is out at once and everywhere, and takes them back in", async () => {
    const named = admins();
    const carol = await named.signIn("carol");
    const bobId = await idOf(carol, "bob");
    const standing = (cookie: string, id: string, status: string) =>
      change(named, cookie, `${REST_ROUTES.people}/${id}`, "PATCH", { status });
    const byMember = await standing(bob, bobId, "deactivated");
    expect(byMember.status).toBe(403);
    const out = await standing(carol, bobId, "deactivated");
    expect(out.status).toBe(200);
    const deactivated = restPersonSchema.parse(await out.json());
    expect(deactivated).toMatchObject({ login: "bob", status: "deactivated" });
    expect(deactivated.deactivatedAt).not.toBeNull();
    // Bob's session is nothing now, and nothing may be assigned to him or list him.
    expect((await get(bob, REST_ROUTES.people)).status).toBe(401);
    const assigned = await send(alice, "POST", `${IN}/tasks`, {
      title: "For nobody",
      assigneeId: bobId,
    });
    expect(assigned.status).toBe(400);
    expect(await errorOf(assigned)).toBe("task.invalid_assignee");
    const project = await h.project(alice, {
      key: "closed",
      name: "Closed",
      visibility: "private",
    });
    const listed = await send(alice, "POST", `${projectPath(project.key)}/members`, {
      personId: bobId,
    });
    expect(listed.status).toBe(400);
    expect(await errorOf(listed)).toBe("member.invalid_person");
    // Still everyone's to see, as deactivated, those in first.
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    expect(people.items.map((person) => [person.login, person.status])).toEqual([
      ["Alice", "active"],
      ["carol", "active"],
      ["bob", "deactivated"],
    ]);
    // What is already so writes nothing; back in, the listing is his again.
    const before = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=0`)).json(),
    ).items.length;
    expect((await standing(carol, bobId, "deactivated")).status).toBe(200);
    const back = await standing(carol, bobId, "active");
    expect(back.status).toBe(200);
    expect(restPersonSchema.parse(await back.json())).toMatchObject({
      status: "active",
      deactivatedAt: null,
    });
    const events = restEventsSchema.parse(
      await (await get(alice, `${REST_ROUTES.events}?after=0`)).json(),
    ).items;
    expect(events.length).toBe(before + 1);
    expect(events.at(-1)).toMatchObject({ kind: "person.reactivated", data: { login: "bob" } });
    expect((await get(bob, REST_ROUTES.people)).status).toBe(200);
    // The board keeps at least one administrator in.
    const carolId = await idOf(carol, "carol");
    const aliceId = await idOf(carol, "alice");
    expect(
      (await change(named, carol, `${REST_ROUTES.people}/${aliceId}`, "PATCH", { role: "member" }))
        .status,
    ).toBe(200);
    const last = await standing(carol, carolId, "deactivated");
    expect(last.status).toBe(409);
    expect(await errorOf(last)).toBe("person.last_admin");
    const nothing = await change(named, carol, `${REST_ROUTES.people}/${bobId}`, "PATCH", {});
    expect(nothing.status).toBe(400);
    const nobody = await standing(carol, "0199c4d8-0000-7000-8000-000000000099", "deactivated");
    expect(nobody.status).toBe(404);
  });
});

describe("the organization at the git host", () => {
  it("says who is in, by the account's id, when the worker reads it; and nobody else may", async () => {
    const organization = createFixtureOrganization({ Alice: "1001", bob: "1002" });
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      organization,
      admins: ["carol"],
    });
    const carol = await named.signIn("carol");
    const aliceIn = await named.signIn("alice");
    const bobIn = await named.signIn("bob");
    // Everything is asked of the harness that names the organization: the base one names none.
    const read = (cookie: string, path: string) => named.request(path, { headers: { cookie } });
    const latest = async () =>
      restEventsSchema
        .parse(await (await read(carol, `${REST_ROUTES.events}?after=0`)).json())
        .items.at(-1);
    const people = restPeopleSchema.parse(await (await read(carol, REST_ROUTES.people)).json());
    expect(people.organization).toEqual({ host: "gh", name: "acme", syncedAt: null });
    const bobId = people.items.find((person) => person.login === "bob")?.id ?? "";
    expect(people.items.find((person) => person.id === bobId)?.source).toBe("organization");
    // Not an administrator's to change.
    const out = await named.request(`${REST_ROUTES.people}/${bobId}`, {
      method: "PATCH",
      headers: { cookie: carol, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ status: "deactivated" }),
    });
    expect(out.status).toBe(409);
    expect(await errorOf(out)).toBe("person.of_organization");

    const workspace = await ensureWorkspace(testDatabase.database, {
      name: "Acme",
      now: new Date(),
    });
    const logs: Record<string, unknown>[] = [];
    const sync = new OrganizationSync({
      database: testDatabase.database,
      organization,
      workspaceId: async () => workspace.id,
      clock: { now: () => new Date() },
      logger: pino(
        { level: "info" },
        { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      ),
    });
    // Bob leaves the organization: out at once, and the board is told by nobody.
    organization.members.delete("bob");
    await sync.sync();
    const after = restPeopleSchema.parse(await (await read(carol, REST_ROUTES.people)).json());
    expect(after.organization?.syncedAt).not.toBeNull();
    expect(after.items.find((person) => person.id === bobId)).toMatchObject({
      status: "deactivated",
      source: "organization",
    });
    expect((await read(bobIn, REST_ROUTES.people)).status).toBe(401);
    expect((await read(aliceIn, REST_ROUTES.people)).status).toBe(200);
    expect(await latest()).toMatchObject({
      kind: "person.deactivated",
      actor: null,
      data: { login: "bob" },
    });
    // Back in the organization under a new login, Bob is back in here: the id says it is him.
    organization.members.set("robert", "1002");
    await sync.sync();
    expect((await read(bobIn, REST_ROUTES.people)).status).toBe(200);
    expect(await latest()).toMatchObject({ kind: "person.reactivated", data: { login: "bob" } });
    // Nobody listed, or the host away: nothing changes.
    const before = (await latest())?.id;
    organization.members.clear();
    await sync.sync();
    organization.members.set("Alice", "1001");
    organization.unreachable(true);
    await sync.sync();
    organization.unreachable(false);
    expect((await read(bobIn, REST_ROUTES.people)).status).toBe(200);
    expect((await latest())?.id).toBe(before);
    expect(logs.filter((line) => String(line.msg).includes("nothing changed"))).toHaveLength(2);
    // Carol, named by the operator, is nobody of the organization's: the sync leaves her be.
    expect((await read(carol, REST_ROUTES.people)).status).toBe(200);
    await sync.close();
  });
});

describe("the rules", () => {
  const RULES = REST_ROUTES.rules;
  const as = (
    cookie: string,
    method: "PUT" | "POST",
    path: string,
    body?: unknown,
    harness: Harness = h,
  ) =>
    harness.request(path, {
      method,
      headers: {
        cookie,
        origin: SIGN_IN_URL,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const rulesOf = async (response: Response) => {
    expect(response.status, await response.clone().text()).toBe(200);
    return restRulesSchema.parse(await response.json());
  };

  it("are the console's own until an administrator writes the organization's, then the page written, versioned, put away and written again", async () => {
    const named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["alice"],
    });
    const admin = await named.signIn("alice");
    // Bob was taken out and back in above, which ended his session: a new one.
    const bob = await h.signIn("bob");
    expect((await h.request(RULES)).status).toBe(401);
    expect(await rulesOf(await get(bob, RULES))).toEqual({
      source: "reference",
      body: REFERENCE_RULES,
      page: null,
    });
    expect(restVersionsSchema.parse(await (await get(bob, rulesPath("versions"))).json())).toEqual({
      items: [],
    });
    // A member may not write them, nor put them away.
    const refused = await as(bob, "PUT", RULES, { body: "# Ours" });
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("auth.forbidden");
    expect((await as(bob, "POST", rulesPath("archive"))).status).toBe(403);
    // The console's own, sent as they are, write nothing: they keep following the console's version.
    const same = await rulesOf(
      await as(admin, "PUT", RULES, { body: `${REFERENCE_RULES}\n` }, named),
    );
    expect(same).toMatchObject({ source: "reference", page: null });
    // An administrator writes the organization's, and the workspace's own feed says so.
    const written = await rulesOf(
      await as(admin, "PUT", RULES, { body: "# Ours\n\nAsk first." }, named),
    );
    expect(written).toMatchObject({
      source: "written",
      body: "# Ours\n\nAsk first.",
      page: { path: "rules", title: "Rules", version: 1, agent: null, archivedAt: null },
    });
    const feed = restEventsSchema.parse(
      await (
        await named.request(`${REST_ROUTES.events}?after=0`, { headers: { cookie: admin } })
      ).json(),
    );
    expect(feed.items.at(-1)).toMatchObject({
      kind: "document.written",
      projectId: null,
      data: { path: "rules", title: "Rules", version: 1 },
    });
    // Everyone reads them; a write from a version they have moved on from is refused.
    expect((await rulesOf(await get(bob, RULES))).body).toBe("# Ours\n\nAsk first.");
    const stale = await as(admin, "PUT", RULES, { body: "# Older", baseVersion: 3 }, named);
    expect(await errorOf(stale)).toBe("document.conflict");
    const next = await rulesOf(
      await as(
        admin,
        "PUT",
        RULES,
        { body: "# Ours\n\nAsk first, always.", baseVersion: 1 },
        named,
      ),
    );
    expect(next.page?.version).toBe(2);
    const versions = restVersionsSchema.parse(await (await get(bob, rulesPath("versions"))).json());
    expect(versions.items.map((version) => version.number)).toEqual([2, 1]);
    // Put away, the console's own hold again, and again changes nothing; written again, the page comes back.
    expect(
      await rulesOf(await as(admin, "POST", rulesPath("archive"), undefined, named)),
    ).toMatchObject({ source: "reference", page: null });
    expect(
      await rulesOf(await as(admin, "POST", rulesPath("archive"), undefined, named)),
    ).toMatchObject({ source: "reference" });
    const back = await rulesOf(await as(admin, "PUT", RULES, { body: "# Ours again" }, named));
    expect(back.page).toMatchObject({ version: 3, archivedAt: null });
    // The console's own, sent as they are while the organization's are written, put the page
    // away rather than copy it: the console's own hold again and follow the console's version.
    const reset = await rulesOf(await as(admin, "PUT", RULES, { body: REFERENCE_RULES }, named));
    expect(reset).toMatchObject({ source: "reference", page: null });
    const after = restEventsSchema.parse(
      await (
        await named.request(`${REST_ROUTES.events}?after=0`, { headers: { cookie: admin } })
      ).json(),
    );
    expect(after.items.at(-1)).toMatchObject({ kind: "document.archived", projectId: null });
    // Written once more, for what follows: the page comes back again.
    const once = await rulesOf(await as(admin, "PUT", RULES, { body: "# Ours again" }, named));
    expect(once.page).toMatchObject({ version: 4, archivedAt: null });
    // Kept short.
    const long = await as(admin, "PUT", RULES, { body: "x".repeat(MAX_RULES_LENGTH + 1) }, named);
    expect(long.status).toBe(400);
    expect(await errorOf(long)).toBe("request.invalid");
  });

  it("add a project's own, written as the page rules by an owner, read with the workspace's by whoever may see the project, and kept out of the folders", async () => {
    const at = `${IN}/rules`;
    const page = `${IN}/docs/rules`;
    const bob = await h.signIn("bob");
    const alice = await h.signIn("alice");
    const start = restProjectRulesSchema.parse(await (await get(bob, at)).json());
    expect(start.project).toEqual({ source: "none", body: null, page: null });
    expect(start.workspace.body).toBe("# Ours again");
    // A member of the project may not write them.
    const refused = await as(bob, "PUT", page, { title: "Whatever", body: "# No" });
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("auth.forbidden");
    // The owner writes them, under the one title whatever was said, with the links the page makes.
    const written = restDocumentSchema.parse(
      await (
        await as(alice, "PUT", page, {
          title: "Whatever",
          body: "# Rules of web\n\nSee [the setup](guides/setup) first.",
        })
      ).json(),
    );
    expect(written).toMatchObject({
      path: "rules",
      title: "Rules",
      version: 1,
      links: [{ path: "guides/setup", title: null }],
    });
    const both = restProjectRulesSchema.parse(await (await get(bob, at)).json());
    expect(both.project).toMatchObject({
      source: "written",
      body: written.body,
      page: { path: "rules", version: 1 },
    });
    // The project's configuration, not its knowledge: in no folder, found by no words, readable at its path.
    const root = restDocumentsSchema.parse(await (await get(bob, `${IN}/docs`)).json());
    expect(root.items.map((item) => item.path)).not.toContain("rules");
    const found = restDocumentsSchema.parse(await (await get(bob, `${IN}/docs?q=setup`)).json());
    expect(found.items.map((item) => item.path)).not.toContain("rules");
    expect((await get(bob, page)).status).toBe(200);
    // Kept short; put away by the owner alone, and the project adds none again; written again, the page comes back.
    const long = await as(alice, "PUT", page, {
      title: "Rules",
      body: "x".repeat(MAX_RULES_LENGTH + 1),
    });
    expect(long.status).toBe(400);
    expect((await as(bob, "POST", `${page}/archive`)).status).toBe(403);
    expect((await as(alice, "POST", `${page}/archive`)).status).toBe(200);
    expect(restProjectRulesSchema.parse(await (await get(bob, at)).json()).project.source).toBe(
      "none",
    );
    const back = restDocumentSchema.parse(
      await (await as(alice, "PUT", page, { title: "Rules", body: "# Back" })).json(),
    );
    expect(back).toMatchObject({ version: 2, archivedAt: null });
    // A project the asker may not see has no rules to show.
    expect((await get(bob, `${projectPath("docs")}/rules`)).status).toBe(404);
  });
});

describe("the discussion on a task", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const form = (
    body: string,
    files: readonly { name: string; type: string; bytes: Uint8Array | string }[],
  ) => {
    const data = new FormData();
    data.set("body", body);
    for (const file of files) {
      data.append("file", new File([file.bytes], file.name, { type: file.type }), file.name);
    }
    return data;
  };

  it("is written by people as JSON and by agents with files as one form, read oldest first, and told to the board", async () => {
    const task = await createTask(alice, { title: "Draw the new board", state: "ready" });
    const at = `${IN}/tasks/${task.id}/comments`;
    // A person says a word, from the pages.
    const said = await send(alice, "POST", at, { body: "Which screen did you mean?" });
    expect(said.status, await said.clone().text()).toBe(201);
    const first = restCommentSchema.parse(await said.json());
    expect(first).toMatchObject({
      taskId: task.id,
      agent: null,
      body: "Which screen did you mean?",
      files: [],
    });
    expect(first.author.login).toBe("Alice");
    // An agent answers with a picture and a log, in one request; the form may name the task by its number.
    const made = await h.request(REST_ROUTES.tokens, {
      method: "POST",
      headers: { cookie: bob, origin: SIGN_IN_URL, "content-type": "application/json" },
      body: JSON.stringify({ name: "Codex on the laptop" }),
    });
    expect(made.status).toBe(201);
    const { secret } = restTokenCreatedSchema.parse(await made.json());
    const auth = { authorization: `Bearer ${secret}` };
    const answered = await h.request(`${IN}/tasks/${task.number}/comments`, {
      method: "POST",
      headers: auth,
      body: form("This one: ![the board](board.png)", [
        { name: "board.png", type: "image/png", bytes: png },
        { name: "run.log", type: "text/plain", bytes: "ok\n" },
      ]),
    });
    expect(answered.status, await answered.clone().text()).toBe(201);
    const second = restCommentSchema.parse(await answered.json());
    expect(second.author.login).toBe("bob");
    expect(second.agent).toBe("Codex on the laptop");
    expect(second.files.map((file) => file.file)).toEqual([
      {
        name: "board.png",
        size: png.byteLength,
        contentType: "image/png",
        sha256: expect.any(String),
      },
      { name: "run.log", size: 3, contentType: "text/plain", sha256: expect.any(String) },
    ]);
    // A picture alone says enough; words alone do; neither does not.
    const pictured = await h.request(at, {
      method: "POST",
      headers: auth,
      body: form("", [{ name: "more.png", type: "image/png", bytes: png }]),
    });
    expect(pictured.status).toBe(201);
    const silent = await h.request(at, { method: "POST", headers: auth, body: form("   ", []) });
    expect(silent.status).toBe(400);
    expect(await errorOf(silent)).toBe("request.invalid");
    const blank = await send(alice, "POST", at, { body: "" });
    expect(blank.status).toBe(400);
    // Read back oldest first, whole, by anyone who may see the project; by the task's number too.
    const listed = restCommentsSchema.parse(await (await get(bob, at)).json());
    expect(listed.items.map((comment) => comment.id)).toEqual([
      first.id,
      second.id,
      restCommentSchema.parse(await pictured.json()).id,
    ]);
    expect(
      restCommentsSchema.parse(await (await get(bob, `${IN}/tasks/${task.number}/comments`)).json())
        .items,
    ).toHaveLength(3);
    // The files are read at the project's one address for files, as a run's are.
    const [picture, log] = second.files;
    const bytes = await get(alice, `${IN}/files/${picture?.id}`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("image/png");
    expect(bytes.headers.get("content-disposition")).toContain("inline");
    expect(bytes.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(png);
    expect(await (await get(alice, `${IN}/files/${log?.id}`)).text()).toBe("ok\n");
    // Another project's file, or nothing, is not found.
    expect((await get(alice, `${projectPath("docs")}/files/${picture?.id}`)).status).toBe(404);
    expect((await get(alice, `${IN}/files/0199c4d8-0000-7000-8000-000000000000`)).status).toBe(404);
    // The board is told once per comment, with the first words and how many files came.
    const history = restEventsSchema.parse(
      await (await get(alice, `${IN}/events?task=${task.id}`)).json(),
    );
    const commented = history.items.filter((event) => event.kind === "task.commented");
    expect(commented).toHaveLength(3);
    expect(commented[1]).toMatchObject({
      agent: "Codex on the laptop",
      data: {
        number: task.number,
        title: "Draw the new board",
        excerpt: "This one: the board",
        files: 2,
      },
    });
    expect(commented[1]?.actor?.login).toBe("bob");
    // A task of another project, or none, has no discussion to read or write.
    expect((await get(alice, `${projectPath("docs")}/tasks/${task.id}/comments`)).status).toBe(404);
    expect(
      (
        await send(alice, "POST", `${IN}/tasks/0199c4d8-0000-7000-8000-000000000000/comments`, {
          body: "x",
        })
      ).status,
    ).toBe(404);
  });

  it("refuses a form with too many files, an empty file, or one over the limit, keeping nothing of it", async () => {
    const task = await createTask(alice, { title: "Hold the line" });
    const at = `${IN}/tasks/${task.id}/comments`;
    const post = (body: FormData) =>
      h.request(at, { method: "POST", headers: { cookie: alice, origin: SIGN_IN_URL }, body });
    const many = await post(
      form(
        "all of them",
        Array.from({ length: MAX_FILES_PER_COMMENT + 1 }, (_, n) => ({
          name: `${n}.png`,
          type: "image/png",
          bytes: png,
        })),
      ),
    );
    expect(many.status).toBe(400);
    expect(await errorOf(many)).toBe("request.invalid");
    const empty = await post(
      form("one is empty", [{ name: "nothing.png", type: "image/png", bytes: new Uint8Array() }]),
    );
    expect(empty.status).toBe(400);
    const heavy = await post(
      form("too heavy", [
        {
          name: "big.bin",
          type: "application/octet-stream",
          bytes: new Uint8Array(MAX_FILE_BYTES + 1),
        },
      ]),
    );
    expect(heavy.status).toBe(413);
    expect(await errorOf(heavy)).toBe("request.too_large");
    const named = await post(
      form("a path, not a name", [{ name: "../up.png", type: "image/png", bytes: png }]),
    );
    expect(named.status).toBe(400);
    expect(restCommentsSchema.parse(await (await get(alice, at)).json()).items).toEqual([]);
  });
});

describe("the pack of a project (ADR-0028)", () => {
  it("is read through the console with the pack token an owner sets, which goes to the deployment and nowhere else, and answered as the pack answered it", async () => {
    const tokens: (string | undefined)[] = [];
    const page = (cursor: string | undefined): RestSkill => ({
      status: "ready",
      commit: COMMIT,
      skill: {
        path: "review/SKILL.md",
        ruleChain: [{ path: "SKILLCDN.md", body: "Be kind.", truncated: false }],
        references: [],
        complete: cursor !== undefined,
        nextCursor: cursor === undefined ? "page-2" : null,
        includedContents: [],
        name: "review",
        directory: "review",
        description: "Reviews a change.",
        license: "MIT",
        compatibility: null,
        allowedTools: null,
        metadata: {},
        body: cursor === undefined ? "Read the diff. " : "Then say so.",
        files: ["review/guide.md"],
        filesTruncated: false,
        included: [],
        warnings: [],
        translations: {},
        rules: { path: "SKILLCDN.md", body: "Be kind.", truncated: false },
      },
    });
    const source: PackSource = {
      open(address, token): Pack {
        tokens.push(token);
        return {
          address,
          location: { kind: "deployment", url: "https://skillcdn.test" },
          async mount() {
            if (token === "scdn_repo_bad") {
              throw new PackError(401, "auth.invalid_token", "The token is no good here.");
            }
            return mountOf(address);
          },
          async skill(path, cursor) {
            if (path !== "review/SKILL.md") {
              throw new PackError(404, "skill.not_found", "No skill at that SKILL.md path.");
            }
            return page(cursor);
          },
          async file(query) {
            if (query.path !== "review/guide.md") {
              throw new PackError(404, "file.not_found", "No file at that path in this pack.");
            }
            return {
              kind: "file",
              commit: COMMIT,
              path: query.path,
              content: "How to review.",
              offset: query.offset ?? 0,
              nextOffset: null,
              totalLength: 14,
            };
          },
          async browse(query) {
            return {
              status: "ready",
              commit: COMMIT,
              path: query.path ?? "",
              entries: [
                {
                  kind: "skill",
                  path: "review/SKILL.md",
                  name: "review",
                  description: "Reviews a change.",
                  skillCount: 0,
                  documentCount: 0,
                  size: null,
                  manifestPath: null,
                  language: null,
                  license: { kind: "permissive", name: "MIT", source: null },
                },
              ],
              nextCursor: null,
            };
          },
          async find(query) {
            return {
              status: "ready",
              commit: COMMIT,
              query: query.query ?? null,
              path: query.path,
              items: [
                {
                  kind: "skill",
                  path: "review/SKILL.md",
                  directory: "review",
                  name: "review",
                  description: "Reviews a change.",
                  translations: {},
                  files: [],
                  moreFiles: 0,
                  license: { kind: "permissive", name: "MIT", source: null },
                },
              ],
              nextCursor: null,
              totals: null,
            };
          },
        };
      },
    };
    const served = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      skills: { address: "/gh/Acme/skills", source },
    });
    const owner = await served.signIn("alice");
    const member = await served.signIn("bob");
    const JSON_HEADERS = { origin: SIGN_IN_URL, "content-type": "application/json" };
    const put = (cookie: string, token: string) =>
      served.request(`${IN}/pack-token`, {
        method: "PUT",
        headers: { cookie, ...JSON_HEADERS },
        body: JSON.stringify({ token }),
      });
    const code = async (response: Response) =>
      ((await response.json()) as { error: { code: string } }).error.code;
    // A member is refused; a token the deployment refuses is refused here, and kept nowhere.
    expect((await put(member, "scdn_repo_of_bob")).status).toBe(403);
    const bad = await put(owner, "scdn_repo_bad");
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("project.pack_token_refused");
    expect((await put(owner, "short")).status).toBe(400);
    const set = await put(owner, "scdn_repo_ok");
    expect(set.status).toBe(200);
    const project = restProjectSchema.parse(await set.json());
    expect(project.packToken?.setAt).toEqual(expect.any(String));
    expect(JSON.stringify(project)).not.toContain("scdn_repo");
    // The listing and the reads go to the deployment with the token, for a member too, and
    // come back as the pack answered them, in the console's envelope.
    const headers = { cookie: member };
    const listed = restSkillsSchema.parse(
      await (await served.request(`${IN}/skills`, { headers })).json(),
    );
    expect(listed.status).toBe("ready");
    const one = restSkillLoadSchema.parse(
      await (await served.request(`${IN}/skills/one?path=review%2FSKILL.md`, { headers })).json(),
    );
    expect(one).toMatchObject({
      address: "/gh/acme/skills",
      source: "https://skillcdn.test",
      page: "https://skillcdn.test/gh/acme/skills",
      status: "ready",
      refusal: null,
    });
    expect(one.read).toEqual(page(undefined));
    const next = restSkillLoadSchema.parse(
      await (
        await served.request(`${IN}/skills/one?path=review%2FSKILL.md&cursor=page-2`, { headers })
      ).json(),
    );
    expect(next.read).toEqual(page("page-2"));
    const file = restSkillFileSchema.parse(
      await (await served.request(`${IN}/skills/file?path=review%2Fguide.md`, { headers })).json(),
    );
    expect(file.read).toMatchObject({ kind: "file", content: "How to review." });
    // A folder and a search go the same way, with the token; what is asked wrong is refused.
    const browsed = restSkillBrowseSchema.parse(
      await (await served.request(`${IN}/skills/browse?path=review`, { headers })).json(),
    );
    expect(browsed.status).toBe("ready");
    expect(browsed.read?.status === "ready" ? browsed.read.path : undefined).toBe("review");
    expect(
      browsed.read?.status === "ready"
        ? browsed.read.entries.map((entry) => `${entry.kind} ${entry.path}`)
        : [],
    ).toEqual(["skill review/SKILL.md"]);
    const found = restSkillFindSchema.parse(
      await (await served.request(`${IN}/skills/find?query=review&limit=5`, { headers })).json(),
    );
    expect(found.read?.status === "ready" ? found.read.query : undefined).toBe("review");
    expect(found.read?.status === "ready" ? found.read.items.map((item) => item.path) : []).toEqual(
      ["review/SKILL.md"],
    );
    expect((await served.request(`${IN}/skills/find`, { headers })).status).toBe(400);
    expect((await served.request(`${IN}/skills/find?query=x&limit=26`, { headers })).status).toBe(
      400,
    );
    expect((await served.request(`${IN}/skills/browse?limit=0`, { headers })).status).toBe(400);
    expect(tokens.filter((token) => token === "scdn_repo_ok").length).toBeGreaterThanOrEqual(7);
    // A skill that is not there, with the pack's own words; and a read that is not asked right.
    const missing = restSkillLoadSchema.parse(
      await (await served.request(`${IN}/skills/one?path=nothing%2FSKILL.md`, { headers })).json(),
    );
    expect(missing).toMatchObject({
      status: "not_found",
      refusal: { code: "skill.not_found", message: "No skill at that SKILL.md path." },
      read: null,
    });
    expect((await served.request(`${IN}/skills/one`, { headers })).status).toBe(400);
    expect((await served.request(`${IN}/skills/file?path=x&limit=0`, { headers })).status).toBe(
      400,
    );
    // Taken away: the next read goes without a token, and the feed says the field changed, never the token.
    const removed = await served.request(`${IN}/pack-token`, {
      method: "DELETE",
      headers: { cookie: owner, origin: SIGN_IN_URL },
    });
    expect(removed.status).toBe(200);
    expect(restProjectSchema.parse(await removed.json()).packToken).toBeNull();
    await served.request(`${IN}/skills`, { headers });
    expect(tokens.at(-1)).toBeUndefined();
    const events = restEventsSchema.parse(
      await (await served.request(`${IN}/events?after=0`, { headers: { cookie: owner } })).json(),
    );
    const changes = events.items.filter(
      (event) =>
        event.kind === "project.updated" && JSON.stringify(event.data).includes("packToken"),
    );
    expect(changes).toHaveLength(2);
    expect(JSON.stringify([events, served.logs])).not.toContain("scdn_repo");
  });
});

describe("the archive of the board (ADR-0029)", () => {
  const eventsSince = async (after: number) =>
    restEventsSchema.parse(await (await get(alice, `${IN}/events?after=${after}`)).json()).items;

  it("puts a task away and brings it back: out of the listings, open by its number, whatever its state", async () => {
    // An open task is put away too (ADR-0030): it keeps its state, and is out of the board as well.
    const open = await createTask(alice, { title: "Still open" });
    const stillOpen = restTaskSchema.parse(
      await (await send(bob, "POST", `${IN}/tasks/${open.id}/archive`)).json(),
    );
    expect(stillOpen.state).toBe(open.state);
    expect(stillOpen.archivedAt).not.toBeNull();
    const done = await createTask(alice, { title: "Over", state: "done" });
    const dropped = await createTask(alice, { title: "Let go", state: "dropped" });
    const before = await latestEventIn(alice);
    // Bob works in the project, and that is enough to put a task away.
    const archived = restTaskSchema.parse(
      await (await send(bob, "POST", `${IN}/tasks/${done.id}/archive`)).json(),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.state).toBe("done");
    expect(archived.doneAt).toBe(done.doneAt);
    // Again is nothing: no change, no event.
    expect(
      restTaskSchema.parse(
        await (await send(bob, "POST", `${IN}/tasks/${done.id}/archive`)).json(),
      ),
    ).toEqual(archived);
    const events = await eventsSince(before);
    expect(events.map((event) => event.kind)).toEqual(["task.archived"]);
    expect(events[0]).toMatchObject({
      taskId: done.id,
      data: { number: done.number, title: "Over" },
    });
    expect(events[0]?.actor?.login).toBe("bob");
    // Out of the board and of every listing of it, in the archive alone, and open by id and by number.
    const board = restTasksSchema.parse(await (await get(alice, `${IN}/tasks`)).json());
    expect(board.items.some((task) => task.id === done.id)).toBe(false);
    expect(board.items.some((task) => task.id === open.id)).toBe(false);
    expect(board.items.some((task) => task.id === dropped.id)).toBe(true);
    for (const query of ["archived=false", "state=done", "open=false"]) {
      const listed = restTasksSchema.parse(await (await get(alice, `${IN}/tasks?${query}`)).json());
      expect(
        listed.items.some((task) => task.id === done.id),
        query,
      ).toBe(false);
    }
    const archive = restTasksSchema.parse(
      await (await get(alice, `${IN}/tasks?archived=true`)).json(),
    );
    expect(archive.items.map((task) => task.id)).toContain(done.id);
    expect(archive.items.every((task) => task.archivedAt !== null)).toBe(true);
    expect(archive.items.some((task) => task.id === dropped.id)).toBe(false);
    expect(restTaskSchema.parse(await (await get(bob, `${IN}/tasks/${done.id}`)).json())).toEqual(
      archived,
    );
    expect(
      restTaskSchema.parse(await (await get(bob, `${IN}/tasks/${done.number}`)).json()),
    ).toEqual(archived);
    // Not a task of the project, or not an id at all.
    for (const ref of ["0199c4d8-0000-7000-8000-00000000dead", "not-an-id", String(done.number)]) {
      const missing = await send(alice, "POST", `${IN}/tasks/${ref}/archive`);
      expect(missing.status, ref).toBe(404);
      expect(await errorOf(missing)).toBe("task.not_found");
    }
    // Back again, and once more is nothing.
    const back = restTaskSchema.parse(
      await (await send(alice, "POST", `${IN}/tasks/${done.id}/restore`)).json(),
    );
    expect(back.archivedAt).toBeNull();
    expect(back.state).toBe("done");
    expect(
      restTaskSchema.parse(
        await (await send(alice, "POST", `${IN}/tasks/${done.id}/restore`)).json(),
      ),
    ).toEqual(back);
    expect((await eventsSince(before)).map((event) => event.kind)).toEqual([
      "task.archived",
      "task.restored",
    ]);
    const again = restTasksSchema.parse(await (await get(alice, `${IN}/tasks`)).json());
    expect(again.items.some((task) => task.id === done.id)).toBe(true);
  });

  it("puts every done or dropped task of a goal away at once, for an owner, the goal counting them still", async () => {
    const set = await send(alice, "POST", `${IN}/goals`, { title: "Wrap up", state: "active" });
    expect(set.status).toBe(201);
    const goal = restGoalSchema.parse(await set.json());
    const finished = await createTask(bob, { title: "Finished", goalId: goal.id, state: "done" });
    const letGo = await createTask(bob, { title: "Let go", goalId: goal.id, state: "dropped" });
    const pending = await createTask(bob, { title: "Pending", goalId: goal.id, state: "ready" });
    const elsewhere = await createTask(bob, { title: "Elsewhere", state: "done" });
    const byMember = await send(bob, "POST", `${IN}/tasks/archive`, { goalId: goal.id });
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");
    const malformed = await send(alice, "POST", `${IN}/tasks/archive`, { goalId: "nope" });
    expect(malformed.status).toBe(400);
    expect(await errorOf(malformed)).toBe("request.invalid");
    const before = await latestEventIn(alice);
    const response = await send(alice, "POST", `${IN}/tasks/archive`, { goalId: goal.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ archived: 2 });
    const events = await eventsSince(before);
    expect(events.map((event) => event.kind)).toEqual(["task.archived", "task.archived"]);
    expect(new Set(events.map((event) => event.taskId))).toEqual(new Set([finished.id, letGo.id]));
    const ofGoal = restTasksSchema.parse(
      await (await get(alice, `${IN}/tasks?goal=${goal.id}`)).json(),
    );
    expect(ofGoal.items.map((task) => task.id)).toEqual([pending.id]);
    const board = restTasksSchema.parse(await (await get(alice, `${IN}/tasks`)).json());
    expect(board.items.some((task) => task.id === elsewhere.id)).toBe(true);
    // The goal's progress is read from its tasks, put away or not.
    const counted = restGoalSchema.parse(await (await get(alice, `${IN}/goals/${goal.id}`)).json());
    expect(counted.taskCounts).toMatchObject({ done: 1, dropped: 1, ready: 1 });
    // Nothing is left to put away; a goal of nobody's is nothing to put away either.
    expect(
      await (await send(alice, "POST", `${IN}/tasks/archive`, { goalId: goal.id })).json(),
    ).toEqual({ archived: 0 });
    expect(
      await (
        await send(alice, "POST", `${IN}/tasks/archive`, {
          goalId: "0199c4d8-0000-7000-8000-00000000dead",
        })
      ).json(),
    ).toEqual({ archived: 0 });
  });

  it("is kept by the console itself: what was done or dropped and not touched for the period goes, with no actor", async () => {
    const DAY_MS = 86_400_000;
    const stale = await createTask(alice, { title: "Long done", state: "done" });
    const fresh = await createTask(alice, { title: "Just done", state: "done" });
    const open = await createTask(alice, { title: "Open for long" });
    const now = new Date();
    const longAgo = new Date(now.getTime() - 40 * DAY_MS);
    const handle = drizzleOf(testDatabase.database);
    await handle.update(tasks).set({ updatedAt: longAgo }).where(eq(tasks.id, stale.id));
    await handle.update(tasks).set({ updatedAt: longAgo }).where(eq(tasks.id, open.id));
    const before = await latestEventIn(alice);
    const archivist = new Archivist({
      database: testDatabase.database,
      clock: { now: () => now },
      logger: pino({ level: "silent" }),
      afterDays: 30,
    });
    await archivist.sweep();
    await archivist.close();
    const putAway = restTaskSchema.parse(
      await (await get(alice, `${IN}/tasks/${stale.id}`)).json(),
    );
    expect(putAway.archivedAt).toBe(now.toISOString());
    expect(
      restTaskSchema.parse(await (await get(alice, `${IN}/tasks/${fresh.id}`)).json()).archivedAt,
    ).toBeNull();
    expect(
      restTaskSchema.parse(await (await get(alice, `${IN}/tasks/${open.id}`)).json()).archivedAt,
    ).toBeNull();
    const events = await eventsSince(before);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "task.archived",
      taskId: stale.id,
      actor: null,
      agent: null,
      data: { number: stale.number, title: "Long done" },
    });
    // A second pass finds nothing; a task brought back is touched, and stays.
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);
    expect(await archiveStaleTasks(testDatabase.database, { before: cutoff, now })).toBe(0);
    await send(alice, "POST", `${IN}/tasks/${stale.id}/restore`);
    expect(await archiveStaleTasks(testDatabase.database, { before: cutoff, now })).toBe(0);
  });
});

describe("who sees whom (ADR-0035)", () => {
  let named: Harness;
  let admin: string;
  let owner: string;
  let member: string;
  let ownerId: string;
  let memberId: string;
  let adminId: string;
  const asAdmin = (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
    named.request(path, {
      method,
      headers: {
        cookie: admin,
        origin: SIGN_IN_URL,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    named = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      admins: ["carol"],
    });
    admin = await named.signIn("carol");
    owner = alice;
    member = bob;
    const people = restPeopleSchema.parse(await (await get(owner, REST_ROUTES.people)).json());
    const idOf = (login: string) => people.items.find((person) => person.login === login)?.id ?? "";
    ownerId = idOf("Alice");
    memberId = idOf("bob");
    adminId = idOf("carol");
  });

  it("lists everyone of the workspace as a member of a project open to it, and lists only owners there", async () => {
    const before = await latestEventIn(owner);
    const everyone = restMembersSchema.parse(await (await get(member, `${IN}/members`)).json());
    expect(everyone.items.map((item) => [item.person.login, item.role, item.listed])).toEqual([
      ["Alice", "owner", true],
      ["bob", "member", false],
      ["carol", "owner", false],
    ]);
    // A member without a listing is one since the later of the project's making and their joining.
    const project = restProjectSchema.parse(await (await get(owner, IN)).json());
    const bobsRow = everyone.items.find((item) => item.person.login === "bob");
    expect(bobsRow?.addedAt).toBe(project.createdAt);
    // Everyone is a member already: only an owner is listed.
    const asMember = await send(owner, "POST", `${IN}/members`, { personId: memberId });
    expect(asMember.status).toBe(409);
    expect(await errorOf(asMember)).toBe("member.open_project");
    const promoted = await send(owner, "PATCH", `${IN}/members/${memberId}`, { role: "owner" });
    expect(promoted.status).toBe(200);
    expect(restMemberSchema.parse(await promoted.json())).toMatchObject({
      person: { login: "bob" },
      role: "owner",
      listed: true,
    });
    expect(restProjectSchema.parse(await (await get(member, IN)).json()).role).toBe("owner");
    // Back to a member: the listing goes, the membership stays.
    const demoted = await send(owner, "PATCH", `${IN}/members/${memberId}`, { role: "member" });
    expect(demoted.status).toBe(200);
    expect(restMemberSchema.parse(await demoted.json())).toMatchObject({
      person: { login: "bob" },
      role: "member",
      listed: false,
    });
    expect(restProjectSchema.parse(await (await get(member, IN)).json()).role).toBe("member");
    expect((await send(owner, "DELETE", `${IN}/members/${memberId}`)).status).toBe(404);
    // An administrator owns every project whatever is asked, and is listed by nothing.
    const stillOwner = await send(owner, "PATCH", `${IN}/members/${adminId}`, { role: "member" });
    expect(stillOwner.status).toBe(200);
    expect(restMemberSchema.parse(await stillOwner.json())).toMatchObject({
      role: "owner",
      listed: false,
    });
    const since = restEventsSchema.parse(
      await (await get(owner, `${IN}/events?after=${before}`)).json(),
    );
    expect(since.items.map((event) => [event.kind, event.data.login, event.data.role])).toEqual([
      ["project.member_changed", "bob", "owner"],
      ["project.member_changed", "bob", "member"],
    ]);
  });

  it("narrows the people a member sees to those they share a project with, when an administrator says so", async () => {
    const team = projectPath("team");
    // Alice is an administrator by now, after the tests of the roles; here she is a member who
    // owns her projects, and every project open to the workspace is private for the while, so
    // that Bob, listed nowhere, shares no project with her.
    expect(
      (await asAdmin("PATCH", `${REST_ROUTES.people}/${ownerId}`, { role: "member" })).status,
    ).toBe(200);
    const all = restProjectsSchema.parse(
      await (await named.request(REST_ROUTES.projects, { headers: { cookie: admin } })).json(),
    );
    const open = all.items
      .filter((project) => project.visibility === "workspace")
      .map((project) => project.key);
    for (const key of open) {
      expect((await asAdmin("PATCH", projectPath(key), { visibility: "private" })).status).toBe(
        200,
      );
    }
    await named.project(owner, { key: "team", name: "The team", visibility: "private" });
    const unlisted: { readonly key: string; readonly role: "owner" | "member" }[] = [];
    try {
      // Where Bob is listed with Alice by an earlier test, she is taken off for the while.
      const his = restProjectsSchema.parse(await (await get(member, REST_ROUTES.projects)).json());
      for (const project of his.items) {
        const theirs = restMembersSchema.parse(
          await (await get(member, `${projectPath(project.key)}/members`)).json(),
        );
        const hers = theirs.items.find((item) => item.person.login === "Alice");
        if (hers !== undefined) {
          expect(
            (await asAdmin("DELETE", `${projectPath(project.key)}/members/${ownerId}`)).status,
          ).toBe(204);
          unlisted.push({ key: project.key, role: hers.role });
        }
      }
      // The setting is an administrator's, from the pages or through a token; a member may not.
      const byMember = await send(member, "PATCH", REST_ROUTES.workspace, {
        peopleVisibility: "shared_projects",
      });
      expect(byMember.status).toBe(403);
      expect(await errorOf(byMember)).toBe("auth.forbidden");
      expect((await asAdmin("PATCH", REST_ROUTES.workspace, {})).status).toBe(400);
      const changed = await asAdmin("PATCH", REST_ROUTES.workspace, {
        peopleVisibility: "shared_projects",
      });
      expect(changed.status).toBe(200);
      expect(restWorkspaceSchema.parse(await changed.json()).peopleVisibility).toBe(
        "shared_projects",
      );
      const me = restMeSchema.parse(await (await get(member, REST_ROUTES.me)).json());
      expect(me.workspace.peopleVisibility).toBe("shared_projects");

      // Bob shares no project with Alice now: he sees himself and the administrators, and
      // neither the logins let in nor the organization's reading; an administrator sees all.
      const narrowed = restPeopleSchema.parse(await (await get(member, REST_ROUTES.people)).json());
      expect(narrowed.items.map((person) => person.login)).toEqual(["bob", "carol"]);
      expect(narrowed.listed).toEqual([]);
      const whole = restPeopleSchema.parse(
        await (await named.request(REST_ROUTES.people, { headers: { cookie: admin } })).json(),
      );
      expect(whole.items.map((person) => person.login)).toEqual(["Alice", "bob", "carol"]);
      // Alice, an owner, finds Bob by his exact login, so as to list him; Bob, who owns a project
      // of his own, finds Alice the same way though his list does not show her; nobody is nobody.
      const found = restPeopleSchema.parse(
        await (await get(owner, `${REST_ROUTES.people}?login=BOB`)).json(),
      );
      expect(found.items.map((person) => person.login)).toEqual(["bob"]);
      const byOwner = restPeopleSchema.parse(
        await (await get(member, `${REST_ROUTES.people}?login=alice`)).json(),
      );
      expect(byOwner.items.map((person) => person.login)).toEqual(["Alice"]);
      expect(byOwner.listed).toEqual([]);
      const nobody = restPeopleSchema.parse(
        await (await get(member, `${REST_ROUTES.people}?login=nobody`)).json(),
      );
      expect(nobody.items).toEqual([]);
      expect((await get(member, `${REST_ROUTES.people}?login=`)).status).toBe(400);
      // The workspace's own events say who is in: not Bob's to read while narrowed.
      const events = await get(member, `${REST_ROUTES.events}?after=0`);
      expect(events.status).toBe(403);
      expect(await errorOf(events)).toBe("auth.forbidden");
      // Listed in Alice's project, Bob sees her.
      expect((await send(owner, "POST", `${team}/members`, { personId: memberId })).status).toBe(
        201,
      );
      const shared = restPeopleSchema.parse(await (await get(member, REST_ROUTES.people)).json());
      expect(shared.items.map((person) => person.login)).toEqual(["Alice", "bob", "carol"]);
      // The change is told to the workspace, by its field.
      const own = restEventsSchema.parse(
        await (
          await named.request(`${REST_ROUTES.events}?after=0`, { headers: { cookie: admin } })
        ).json(),
      );
      expect(own.items.at(-1)).toMatchObject({
        kind: "workspace.updated",
        data: { fields: ["peopleVisibility"] },
      });
    } finally {
      expect(
        (await asAdmin("PATCH", REST_ROUTES.workspace, { peopleVisibility: "everyone" })).status,
      ).toBe(200);
      for (const key of open) {
        expect((await asAdmin("PATCH", projectPath(key), { visibility: "workspace" })).status).toBe(
          200,
        );
      }
      for (const { key, role } of unlisted) {
        expect(
          (await asAdmin("POST", `${projectPath(key)}/members`, { personId: ownerId, role }))
            .status,
        ).toBe(201);
      }
      expect(
        (await asAdmin("PATCH", `${REST_ROUTES.people}/${ownerId}`, { role: "admin" })).status,
      ).toBe(200);
    }
  });

  it("keeps the day the week begins on and the time zone, for an administrator, and knows a zone by its name", async () => {
    const changed = await asAdmin("PATCH", REST_ROUTES.workspace, {
      weekStart: "monday",
      timeZone: "Asia/Seoul",
    });
    expect(changed.status).toBe(200);
    expect(restWorkspaceSchema.parse(await changed.json())).toMatchObject({
      weekStart: "monday",
      timeZone: "Asia/Seoul",
    });
    const me = restMeSchema.parse(await (await get(member, REST_ROUTES.me)).json());
    expect(me.workspace).toMatchObject({ weekStart: "monday", timeZone: "Asia/Seoul" });
    const unknown = await asAdmin("PATCH", REST_ROUTES.workspace, {
      timeZone: "Mars/Olympus_Mons",
    });
    expect(unknown.status).toBe(400);
    expect(await errorOf(unknown)).toBe("request.invalid");
    expect(
      (await asAdmin("PATCH", REST_ROUTES.workspace, { timeZone: "not a zone!" })).status,
    ).toBe(400);
    expect((await asAdmin("PATCH", REST_ROUTES.workspace, { weekStart: "tuesday" })).status).toBe(
      400,
    );
    const back = await asAdmin("PATCH", REST_ROUTES.workspace, {
      weekStart: "auto",
      timeZone: null,
    });
    expect(back.status).toBe(200);
    expect(restWorkspaceSchema.parse(await back.json())).toMatchObject({
      weekStart: "auto",
      timeZone: null,
    });
  });
});
