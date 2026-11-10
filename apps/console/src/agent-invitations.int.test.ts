import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  INVITATION_DAYS,
  REST_ROUTES,
  restAgentInvitationMadeSchema,
  restAgentInvitationStateSchema,
  restAgentSetupSchema,
  restClaimSchema,
  restConnectionSchema,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { agentInvitations } from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The invitation that leads a machine to an agent account (ADR-0088): a code a supervisor makes,
// makes again and takes away, which opens the account's setup to whoever holds it and gives
// nobody the account. On a database of its own, with a clock the test moves.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let bobId: string;
let now = new Date("2026-11-10T09:00:00.000Z");

const DAY_MS = 86_400_000;
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
const INVITATION = agentPath("mira", "invitation");
const invite = async (headers: Record<string, string> = fromPages(alice)) =>
  restAgentInvitationMadeSchema.parse(await (await send(headers, "POST", INVITATION)).json());
const standing = async (cookie: string) =>
  restAgentInvitationStateSchema.parse(await (await get({ cookie }, INVITATION)).json()).invitation;
const setup = (code: string, headers: Record<string, string> = {}) =>
  get(headers, `${REST_ROUTES.setup}/${code}`);

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh"), createFixtureProvider("google")],
    admins: ["alice"],
    listed: ["alice", "bob"],
    clock: { now: () => now },
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  bobId =
    restMeSchema.parse(await (await get({ cookie: bob }, REST_ROUTES.me)).json()).person?.id ?? "";
  await h.project(alice, { key: "ops", name: "Operations", visibility: "workspace" });
  await send(fromPages(alice), "PATCH", REST_ROUTES.workspace, {
    handle: "acme",
    domain: "acme.example",
    services: { identity: { kind: "github" }, git: { kind: "github", organization: "acme" } },
  });
  await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "gh",
    login: "carol",
    handle: "mira",
    name: "Mira",
    title: "Release engineer",
    project: "ops",
  });
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the invitation that leads a machine to an agent account (ADR-0088)", () => {
  it("is made by a supervisor, its code shown once, and stands for seven days", async () => {
    expect(await standing(alice)).toBeNull();
    const made = await send(fromPages(alice), "POST", INVITATION);
    expect(made.status).toBe(201);
    const first = restAgentInvitationMadeSchema.parse(await made.json());
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(first.command).toBe(`console agent setup --console ${SIGN_IN_URL} --code ${first.code}`);
    expect(first.invitation).toMatchObject({
      by: { login: "Alice" },
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY_MS).toISOString(),
    });
    // What stands says when and by whom, and never the code; the row holds its hash alone.
    const kept = await standing(alice);
    expect(kept).toEqual(first.invitation);
    expect(JSON.stringify(kept)).not.toContain(first.code);
    const [row] = await drizzleOf(testDatabase.database).select().from(agentInvitations);
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(first.code);

    // Made again, the code before opens nothing.
    const second = await invite();
    expect(second.code).not.toBe(first.code);
    expect((await setup(first.code)).status).toBe(404);
    expect((await setup(second.code)).status).toBe(200);
    // Nothing of it is on the board's feed.
    const feed = await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).text();
    expect(restEventsSchema.safeParse(JSON.parse(feed)).success).toBe(true);
    expect(feed).not.toContain(second.code);
    expect(feed).not.toContain("invit");
  });

  it("is a supervisor's to make and to take away, on the pages or through their agent", async () => {
    // Bob sees the account and supervises nothing of it.
    for (const [method, expected] of [
      ["GET", 403],
      ["POST", 403],
      ["DELETE", 403],
    ] as const) {
      const refused = await send(fromPages(bob), method, INVITATION);
      expect(refused.status, method).toBe(expected);
      expect(await errorOf(refused)).toBe("auth.forbidden");
    }
    expect((await send({ cookie: alice }, "POST", INVITATION)).status).toBe(403);
    // Nobody at all: asked from the pages it is nobody signed in, and from elsewhere it is not asked.
    expect((await send({ origin: SIGN_IN_URL }, "POST", INVITATION)).status).toBe(401);
    expect((await get({}, INVITATION)).status).toBe(401);
    expect((await send({}, "POST", INVITATION)).status).toBe(403);
    expect((await send(fromPages(alice), "POST", agentPath("nobody", "invitation"))).status).toBe(
      404,
    );
    // Its manager is a supervisor, and so is an agent of theirs (ADR-0021).
    const mira = (await (await get({ cookie: alice }, agentPath("mira"))).json()) as {
      person: { id: string };
    };
    await send(fromPages(alice), "PATCH", `${REST_ROUTES.people}/${mira.person.id}`, {
      managerId: bobId,
    });
    const made = await send(fromPages(bob), "POST", REST_ROUTES.tokens, { name: "Claude Code" });
    const bobsAgent = restTokenCreatedSchema.parse(await made.json()).secret;
    const through = await invite({ authorization: `Bearer ${bobsAgent}` });
    expect(through.invitation.by?.login).toBe("bob");
    // Taken away, its code opens nothing; taken away again, it is gone already.
    expect((await send(fromPages(bob), "DELETE", INVITATION)).status).toBe(204);
    expect((await setup(through.code)).status).toBe(404);
    expect(await standing(bob)).toBeNull();
    expect((await send(fromPages(bob), "DELETE", INVITATION)).status).toBe(204);
  });

  it("opens the account's setup to whoever holds the code, signed in or not, and says nothing secret", async () => {
    const { code } = await invite();
    const opened = await setup(code);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("cache-control")).toBe("no-store");
    const text = await opened.text();
    expect(restAgentSetupSchema.parse(JSON.parse(text))).toEqual({
      account: {
        handle: "mira",
        name: "Mira",
        title: "Release engineer",
        login: "carol",
        host: "gh",
        avatarParts: expect.any(Object),
      },
      workspace: {
        name: "Acme",
        handle: "acme",
        domain: "acme.example",
        services: { identity: { kind: "github" }, git: { kind: "github", organization: "acme" } },
      },
      console: { url: SIGN_IN_URL },
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY_MS).toISOString(),
    });
    // Nothing by which the account or anyone is entered, and nobody else of the workspace.
    for (const word of ["secret", "token", "password", "session", "email", "Alice", "bob", 'id"']) {
      expect(text, word).not.toContain(word);
    }
    // As a person types one: any case, with or without the hyphen.
    expect((await setup(code.toLowerCase().replace("-", ""))).status).toBe(200);
    expect((await setup(code, { cookie: bob })).status).toBe(200);

    // A code nobody made, or no code at all, opens nothing, and says the same.
    for (const wrong of [
      "AAAA-AAAA",
      "ABCD",
      "not-a-code",
      "ABCD-EFG1",
      "%00%00%00%00-%00%00%00%00",
    ]) {
      const refused = await setup(wrong);
      expect(refused.status, wrong).toBe(404);
      expect(await errorOf(refused)).toBe("setup.not_found");
    }
  });

  it("ends with its day, with its account, and when the account's command has signed in", async () => {
    const { code } = await invite();
    now = new Date(now.getTime() + INVITATION_DAYS * DAY_MS - 1000);
    expect((await setup(code)).status).toBe(200);
    now = new Date(now.getTime() + 2000);
    expect((await setup(code)).status).toBe(404);
    expect(await standing(alice)).toBeNull();

    // An account that is out is led to by nothing.
    const fresh = await invite();
    const mira = (await (await get({ cookie: alice }, agentPath("mira"))).json()) as {
      person: { id: string };
    };
    const account = `${REST_ROUTES.people}/${mira.person.id}`;
    await send(fromPages(alice), "PATCH", account, { status: "deactivated" });
    expect((await setup(fresh.code)).status).toBe(404);
    await send(fromPages(alice), "PATCH", account, { status: "active" });
    expect((await setup(fresh.code)).status).toBe(200);

    // The account signs in as itself, and its command with it: the invitation has done its work.
    const carol = await h.signIn("carol");
    const begun = await send({}, "POST", REST_ROUTES.connect, { agent: "console", as: "self" });
    const connection = restConnectionSchema.parse(await begun.json());
    // A browser signed in is not a command signed in: the code still stands.
    expect((await setup(fresh.code)).status).toBe(200);
    await send(fromPages(carol), "POST", connectPath(connection.code, "approve"));
    const claim = restClaimSchema.parse(
      await (await send({}, "POST", CLAIM_PATH, { secret: connection.secret })).json(),
    );
    expect(claim.status).toBe("signed_in");
    expect((await setup(fresh.code)).status).toBe(404);
    expect(await standing(alice)).toBeNull();
    expect(
      await drizzleOf(testDatabase.database)
        .select()
        .from(agentInvitations)
        .where(eq(agentInvitations.personId, mira.person.id)),
    ).toEqual([]);
  });
});
