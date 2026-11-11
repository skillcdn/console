import {
  agentLoginOf,
  REST_ROUTES,
  restAgentSchema,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restTokenCreatedSchema,
  restWorkspaceSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The services a workspace's agents work with (ADR-0089): its short name, its domain, and a
// service for each of what an agent needs an account at, named by an administrator, read by
// everyone, and what an agent account's login is put together from. On a database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;

const JSON_HEADERS = { "content-type": "application/json" };
const fromPages = (cookie: string) => ({ cookie, origin: SIGN_IN_URL });
const get = (headers: Record<string, string>, path: string) => h.request(path, { headers });
const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: { ...headers, ...JSON_HEADERS },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;
const patch = (cookie: string, body: unknown) =>
  send(fromPages(cookie), "PATCH", REST_ROUTES.workspace, body);
const workspaceOf = async (cookie: string) =>
  restMeSchema.parse(await (await get({ cookie }, REST_ROUTES.me)).json()).workspace;
/** What the workspace's feed says changed, oldest first. */
const changes = async () =>
  restEventsSchema
    .parse(await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json())
    .items.filter((event) => event.kind === "workspace.updated")
    .map((event) => event.data.fields);

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh"), createFixtureProvider("google")],
    admins: ["alice"],
    listed: ["alice", "bob"],
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  await h.project(alice, { key: "ops", name: "Operations", visibility: "workspace" });
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the services a workspace's agents work with (ADR-0089)", () => {
  it("are named by an administrator and read by everyone, with the short name and the domain", async () => {
    expect(await workspaceOf(bob)).toMatchObject({ handle: null, domain: null, services: {} });

    const named = await patch(alice, {
      handle: "acme",
      domain: "acme.example",
      services: {
        identity: { kind: "google-workspace" },
        git: { kind: "github", organization: "acme" },
        messenger: { kind: "slack", workspace: "acme.slack.com" },
      },
    });
    expect(named.status).toBe(200);
    const services = {
      identity: { kind: "google-workspace" },
      git: { kind: "github", organization: "acme" },
      messenger: { kind: "slack", workspace: "acme.slack.com" },
    };
    expect(restWorkspaceSchema.parse(await named.json())).toMatchObject({
      handle: "acme",
      domain: "acme.example",
      services,
    });
    expect(await workspaceOf(bob)).toMatchObject({
      handle: "acme",
      domain: "acme.example",
      services,
    });
    expect(await changes()).toEqual([
      ["handle", "domain", "services.git", "services.identity", "services.messenger"],
    ]);
    // What is already so writes nothing, whatever order its parameters come in.
    await patch(alice, {
      handle: "acme",
      services: { git: { organization: "acme", kind: "github" } },
    });
    expect(await changes()).toHaveLength(1);

    // A role left out stays; `null` takes one away; a kind the console does not know is kept as it came.
    const changed = await patch(alice, {
      services: { messenger: null, git: { kind: "forgejo", url: "git.acme.example" } },
    });
    expect(restWorkspaceSchema.parse(await changed.json()).services).toEqual({
      identity: { kind: "google-workspace" },
      git: { kind: "forgejo", url: "git.acme.example" },
    });
    expect((await changes()).at(-1)).toEqual(["services.git", "services.messenger"]);
    await patch(alice, { domain: null });
    expect(await workspaceOf(alice)).toMatchObject({ handle: "acme", domain: null });

    // Through an administrator's agent too (ADR-0021); never by a member.
    const made = await send(fromPages(alice), "POST", REST_ROUTES.tokens, { name: "Claude Code" });
    const token = restTokenCreatedSchema.parse(await made.json()).secret;
    expect(
      (
        await send({ authorization: `Bearer ${token}` }, "PATCH", REST_ROUTES.workspace, {
          domain: "acme.example",
        })
      ).status,
    ).toBe(200);
    const member = await patch(bob, { handle: "theirs" });
    expect(member.status).toBe(403);
    expect((await patch(alice, { handle: "acme" })).status).toBe(200);
    expect(
      (await send({ cookie: alice }, "PATCH", REST_ROUTES.workspace, { handle: "x1" })).status,
    ).toBe(403);
  });

  it("are read as data: a service that does not read changes nothing", async () => {
    const before = await workspaceOf(alice);
    for (const body of [
      { handle: "Acme" },
      { handle: "new\nline" },
      { domain: "acme" },
      { domain: "https://acme.example" },
      { services: { git: { kind: "slack" } } },
      { services: { messenger: { kind: "github" } } },
      { services: { git: { kind: "github", organization: "<script>" } } },
      { services: { git: { kind: "github", token: "not-a-real-token" } } },
      { services: { git: { kind: "github", account: "{agent}/../../x" } } },
      { services: { git: { kind: "forgejo", "not a word": "x" } } },
      { services: { git: { kind: "forgejo", url: "x".repeat(300) } } },
      { services: { git: "github" } },
      { services: { git: {} } },
      {},
    ]) {
      const refused = await patch(alice, body);
      expect(refused.status, JSON.stringify(body).slice(0, 70)).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    // Whoever sent a service that does not read is told which, and what is wrong with it.
    const said = async (body: unknown): Promise<string> =>
      ((await (await patch(alice, body)).json()) as { error: { message: string } }).error.message;
    expect(await said({ services: { git: { kind: "github", org: "acme" } } })).toBe(
      "services.git: takes no org.",
    );
    expect(await said({ services: { messenger: { kind: "slack", workspace: "acme" } } })).toBe(
      "services.messenger: workspace is not spelled as one is.",
    );
    expect(await said({ services: { messenger: { kind: "github" } } })).toBe(
      "services.messenger: is no messenger service.",
    );
    expect(await said({ services: { git: {} } })).toBe("services.git: names no kind.");
    // What is no word is not said back.
    expect(await said({ services: { git: { kind: "forgejo", "<b>": "x" } } })).toBe(
      "services.git: has more parameters than one may, or one that is no word.",
    );
    expect(await said({})).toBe("The patch names nothing to change, or no setting.");
    // The service agents sign in through is one people sign in through here.
    for (const identity of [{ kind: "okta" }, { kind: "forgejo", url: "id.acme.example" }]) {
      const refused = await patch(alice, { services: { identity } });
      expect(refused.status).toBe(400);
      expect(await errorOf(refused)).toBe("workspace.identity_unavailable");
    }
    expect((await patch(alice, { services: { identity: { kind: "github" } } })).status).toBe(200);
    expect(
      (await patch(alice, { services: { identity: before.services?.identity ?? null } })).status,
    ).toBe(200);
    expect(await workspaceOf(alice)).toEqual(before);
  });

  it("refuse an identity service of a provider this deployment signs nobody in through", async () => {
    // The same workspace, on a deployment that signs people in at the git host alone.
    const narrow = createHarness(testDatabase, {
      providers: [createFixtureProvider("gh")],
      admins: ["alice"],
      listed: ["alice", "bob"],
    });
    const cookie = await narrow.signIn("alice");
    const ask = (identity: unknown) =>
      narrow.request(REST_ROUTES.workspace, {
        method: "PATCH",
        headers: { ...fromPages(cookie), ...JSON_HEADERS },
        body: JSON.stringify({ services: { identity } }),
      });
    const refused = await ask({ kind: "google-workspace" });
    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toBe("workspace.identity_unavailable");
    expect((await ask({ kind: "github" })).status).toBe(200);
    expect((await ask({ kind: "google-workspace" })).status).toBe(400);
    await patch(alice, { services: { identity: { kind: "google-workspace" } } });
  });

  it("give an agent account the login it signs in with, put together from the names", async () => {
    const workspace = await workspaceOf(alice);
    expect(workspace).toMatchObject({
      handle: "acme",
      domain: "acme.example",
      services: { identity: { kind: "google-workspace" } },
    });
    // What the pages and the command put together, the console takes as any login: the
    // account is made with it, and whoever signs in with that address is the agent.
    const derived = agentLoginOf(workspace, "mira");
    expect(derived).toEqual({ host: "google", login: "mira@acme.example" });
    const made = await send(fromPages(alice), "POST", REST_ROUTES.agents, {
      ...derived,
      handle: "mira",
      name: "Mira",
      project: "ops",
    });
    expect(made.status).toBe(201);
    expect(restAgentSchema.parse(await made.json()).person).toMatchObject({
      handle: "mira",
      login: "mira@acme.example",
      invited: true,
    });
  });
});
