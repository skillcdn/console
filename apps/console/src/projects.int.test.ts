import {
  projectPath,
  REST_ROUTES,
  restErrorSchema,
  restEventsSchema,
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
