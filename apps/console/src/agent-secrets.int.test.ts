import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  MAX_AGENT_SECRET_BYTES,
  REST_ROUTES,
  restAgentSchema,
  restAgentSecretAccessesSchema,
  restAgentSecretSchema,
  restAgentSecretsSchema,
  restAgentSecretValueSchema,
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
import { agentSecrets } from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// An agent account's secret store (ADR-0087): the account reads, writes and removes its own, on a
// session of its own; a supervisor seeds one write-only and removes one, and never reads a
// value; every access is on the account's record, by name. On a database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let mira: string;
let miraId: string;
let bobId: string;
/** The secret of Mira's command, signed in as the account itself. */
let command: string;

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
const own = (name?: string) =>
  name === undefined ? agentPath("me", "secrets") : agentPath("me", "secrets", name);
const theirs = (name?: string) =>
  name === undefined ? agentPath("mira", "secrets") : agentPath("mira", "secrets", name);

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice", "bob"],
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  bobId =
    restMeSchema.parse(await (await get({ cookie: bob }, REST_ROUTES.me)).json()).person?.id ?? "";
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  const made = await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "gh",
    login: "carol",
    handle: "mira",
    name: "Mira",
    project: "ops",
  });
  miraId = restAgentSchema.parse(await made.json()).person.id;
  mira = await h.signIn("carol");
  // Its command, signed in as the account itself.
  const begun = await send({}, "POST", REST_ROUTES.connect, { agent: "console", as: "self" });
  const connection = restConnectionSchema.parse(await begun.json());
  await send(fromPages(mira), "POST", connectPath(connection.code, "approve"));
  const claim = restClaimSchema.parse(
    await (await send({}, "POST", CLAIM_PATH, { secret: connection.secret })).json(),
  );
  command = claim.status === "signed_in" ? claim.secret : "";
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("an agent account's secret store (ADR-0087)", () => {
  it("keeps what the account sets, sealed, and answers the value to the account alone", async () => {
    const kept = await send(bearer(command), "PUT", own("git.token"), {
      value: "not-a-real-token-1",
      expiresOn: "2027-11-10",
    });
    expect(kept.status).toBe(200);
    const secret = restAgentSecretSchema.parse(await kept.json());
    expect(secret).toMatchObject({ name: "git.token", seeded: false, expiresOn: "2027-11-10" });
    expect(JSON.stringify(secret)).not.toContain("not-a-real");
    // The names, with no value; and the value on the one route that reads it.
    const listed = restAgentSecretsSchema.parse(await (await get(bearer(command), own())).json());
    expect(listed.items.map((item) => item.name)).toEqual(["git.token"]);
    const read = await get(bearer(command), own("git.token"));
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(restAgentSecretValueSchema.parse(await read.json())).toMatchObject({
      name: "git.token",
      value: "not-a-real-token-1",
      expiresOn: "2027-11-10",
    });
    // In the account's browser too, which is a session of its own; a change comes from its pages.
    expect((await get({ cookie: mira }, own("git.token"))).status).toBe(200);
    expect((await send({ cookie: mira }, "PUT", own("x"), { value: "y" })).status).toBe(403);
    // What the database holds is sealed: neither the value nor anything that reads as it.
    const [row] = await drizzleOf(testDatabase.database)
      .select({ sealed: agentSecrets.sealed })
      .from(agentSecrets)
      .where(eq(agentSecrets.personId, miraId));
    expect(row?.sealed).toMatch(/^v1\./);
    expect(row?.sealed).not.toContain("not-a-real");
    // Set again, it is the new value, with no day where none is said.
    const again = await send(bearer(command), "PUT", own("git.token"), { value: "second" });
    expect(restAgentSecretSchema.parse(await again.json()).expiresOn).toBeNull();
    expect(
      restAgentSecretValueSchema.parse(await (await get(bearer(command), own("git.token"))).json())
        .value,
    ).toBe("second");
    // Nothing of it is on the board's feed.
    const events = restEventsSchema.parse(
      await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json(),
    ).items;
    expect(JSON.stringify(events)).not.toContain("git.token");
  });

  it("is the account's own: not a person's, and not what a token the account made reads", async () => {
    // A person has no store; an agent account's is read on a session of its own.
    const person = await get({ cookie: bob }, own());
    expect(person.status).toBe(404);
    expect(await errorOf(person)).toBe("agent.not_found");
    expect((await get({}, own())).status).toBe(401);
    const made = await send(fromPages(mira), "POST", REST_ROUTES.tokens, { name: "a helper" });
    const token = restTokenCreatedSchema.parse(await made.json()).secret;
    for (const [method, path, body] of [
      ["GET", own(), undefined],
      ["GET", own("git.token"), undefined],
      ["PUT", own("git.token"), { value: "stolen" }],
      ["DELETE", own("git.token"), undefined],
    ] as const) {
      const refused = await send(bearer(token), method, path, body);
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(await errorOf(refused)).toBe("secret.own_session");
    }
    expect(
      restAgentSecretValueSchema.parse(await (await get(bearer(command), own("git.token"))).json())
        .value,
    ).toBe("second");
  });

  it("is seeded write-only by a supervisor, who removes one and never reads a value", async () => {
    // Bob is no supervisor yet: he reads the account as a member and keeps nothing of its store.
    const beside = await send(fromPages(bob), "PUT", theirs("mail.password"), { value: "x" });
    expect(beside.status).toBe(403);
    expect(await errorOf(beside)).toBe("auth.forbidden");
    expect((await get({ cookie: bob }, theirs())).status).toBe(403);
    await send(fromPages(alice), "PATCH", `${REST_ROUTES.people}/${miraId}`, { managerId: bobId });

    // Its manager seeds one, on the pages or through an agent of their own (ADR-0021).
    const seeded = await send(fromPages(bob), "PUT", theirs("mail.password"), {
      value: "first-password",
    });
    expect(seeded.status).toBe(200);
    expect(restAgentSecretSchema.parse(await seeded.json())).toMatchObject({
      name: "mail.password",
      seeded: true,
    });
    const made = await send(fromPages(bob), "POST", REST_ROUTES.tokens, { name: "Claude Code" });
    const bobsAgent = restTokenCreatedSchema.parse(await made.json()).secret;
    expect(
      (await send(bearer(bobsAgent), "PUT", theirs("os.password"), { value: "pw" })).status,
    ).toBe(200);
    // The names, for a supervisor; no route of theirs answers a value.
    const names = restAgentSecretsSchema.parse(await (await get({ cookie: bob }, theirs())).json());
    expect(names.items.map((item) => [item.name, item.seeded])).toEqual([
      ["git.token", false],
      ["mail.password", true],
      ["os.password", true],
    ]);
    expect(JSON.stringify(names)).not.toContain("first-password");
    const value = await get({ cookie: bob }, theirs("mail.password"));
    expect(value.status).toBe(404);
    // The account reads what was handed to it.
    expect(
      restAgentSecretValueSchema.parse(
        await (await get(bearer(command), own("mail.password"))).json(),
      ),
    ).toMatchObject({ value: "first-password", seeded: true });
    // Removed by a supervisor, or by the account; one that is not there is not found.
    expect((await send(fromPages(alice), "DELETE", theirs("os.password"))).status).toBe(204);
    expect((await send(fromPages(alice), "DELETE", theirs("os.password"))).status).toBe(404);
    expect((await send(bearer(command), "DELETE", own("mail.password"))).status).toBe(204);
    expect((await get(bearer(command), own("mail.password"))).status).toBe(404);
  });

  it("writes every access on the account's record, by name, with who did it and through which agent", async () => {
    const page = restAgentSecretAccessesSchema.parse(
      await (await get({ cookie: bob }, agentPath("mira", "secret-accesses"))).json(),
    );
    expect(page.more).toBe(false);
    // The newest first: what happened above, one line each, and no value anywhere.
    expect(
      page.items.map((line) => [line.name, line.action, line.by?.login, line.agent, line.seeded]),
    ).toEqual([
      ["mail.password", "removed", "carol", null, false],
      ["os.password", "removed", "Alice", null, true],
      ["mail.password", "read", "carol", null, true],
      ["os.password", "set", "bob", "Claude Code", true],
      ["mail.password", "set", "bob", null, true],
      ["git.token", "read", "carol", null, false],
      ["git.token", "read", "carol", null, false],
      ["git.token", "set", "carol", null, false],
      ["git.token", "read", "carol", null, false],
      ["git.token", "read", "carol", null, false],
      ["git.token", "set", "carol", null, false],
    ]);
    expect(JSON.stringify(page)).not.toMatch(/not-a-real|first-password|second/);
    // A page at a time, from before a line on.
    const first = restAgentSecretAccessesSchema.parse(
      await (await get({ cookie: bob }, `${agentPath("mira", "secret-accesses")}?limit=2`)).json(),
    );
    expect(first.items).toHaveLength(2);
    expect(first.more).toBe(true);
    const next = restAgentSecretAccessesSchema.parse(
      await (
        await get(
          { cookie: bob },
          `${agentPath("mira", "secret-accesses")}?limit=2&before=${first.items.at(-1)?.id}`,
        )
      ).json(),
    );
    expect(next.items.map((line) => line.action)).toEqual(["read", "set"]);
    // For its supervisors alone; the account does not read its own record here.
    expect((await get({ cookie: mira }, agentPath("mira", "secret-accesses"))).status).toBe(403);
    for (const query of ["?limit=0", "?limit=201", "?before=x"]) {
      expect(
        (await get({ cookie: bob }, `${agentPath("mira", "secret-accesses")}${query}`)).status,
        query,
      ).toBe(400);
    }
  });

  it("bounds a name, a value and how many an account keeps, and never says a value back", async () => {
    for (const name of ["Git.Token", ".hidden", "a b", "x".repeat(65), "trailing."]) {
      const refused = await send(bearer(command), "PUT", own(name), { value: "v" });
      expect(refused.status, name).toBe(400);
    }
    const large = await send(bearer(command), "PUT", own("large"), {
      // Three bytes a character: as many as half the bound is more bytes than the bound.
      value: String.fromCodePoint(0xac00).repeat(MAX_AGENT_SECRET_BYTES / 2),
    });
    expect(large.status).toBe(400);
    expect(await errorOf(large)).toBe("secret.too_large");
    const unsaid = await send(bearer(command), "PUT", own("unsaid"), {
      value: "",
      expiresOn: "soon",
    });
    expect(unsaid.status).toBe(400);
    expect(JSON.stringify(await unsaid.json())).not.toContain("soon");
    // A value that fits to the byte is kept, and comes back whole.
    const fits = "x".repeat(MAX_AGENT_SECRET_BYTES);
    expect((await send(bearer(command), "PUT", own("fits"), { value: fits })).status).toBe(200);
    expect(
      restAgentSecretValueSchema.parse(await (await get(bearer(command), own("fits"))).json())
        .value,
    ).toBe(fits);
  });

  it("opens a value only for the account and the name it was sealed for", async () => {
    await send(bearer(command), "PUT", own("a"), { value: "of a" });
    await send(bearer(command), "PUT", own("b"), { value: "of b" });
    // A row's sealed value written over another's, as only whoever holds the database could:
    // it opens for nobody, and the account is told to set it again.
    const table = drizzleOf(testDatabase.database);
    const rows = await table
      .select({ name: agentSecrets.name, sealed: agentSecrets.sealed })
      .from(agentSecrets)
      .where(eq(agentSecrets.personId, miraId));
    const sealedOfA = rows.find((row) => row.name === "a")?.sealed ?? "";
    await table.update(agentSecrets).set({ sealed: sealedOfA }).where(eq(agentSecrets.name, "b"));
    const moved = await get(bearer(command), own("b"));
    expect(moved.status).toBe(409);
    expect(await errorOf(moved)).toBe("secret.unreadable");
    expect(
      restAgentSecretValueSchema.parse(await (await get(bearer(command), own("a"))).json()).value,
    ).toBe("of a");
  });
});
