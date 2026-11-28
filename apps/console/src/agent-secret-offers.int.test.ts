import { randomUUID } from "node:crypto";
import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  MAX_AGENT_SECRET_BYTES,
  MAX_SECRET_OFFER_NOTE_LENGTH,
  MAX_SECRET_OFFERS_BY_ONE,
  MAX_SECRET_OFFERS_WAITING,
  projectPath,
  REST_ROUTES,
  type RestAgentSecretOffer,
  restAgentSchema,
  restAgentSecretAccessesSchema,
  restAgentSecretOfferSchema,
  restAgentSecretOffersSchema,
  restAgentSecretSchema,
  restAgentSecretsSchema,
  restAgentSecretValueSchema,
  restClaimSchema,
  restConnectionSchema,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restTokenCreatedSchema,
  SECRET_OFFER_DAYS,
  wakePartsOf,
} from "@skillcdn/console/api";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { lapseSecretOffers } from "./db/queries/agent-secret-offers.js";
import {
  agentRunners,
  agentSecretOffers,
  agentSecrets,
  agentSignals,
  workspaces,
} from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// A secret offered to an agent account (ADR-0169): any member who sees the account offers one,
// which is sealed apart from the account's store and answered to nobody; the account is woken,
// lists what waits, and takes it into its store or leaves it, on a session of its own; an offer
// nobody took is gone after its days. On a database of its own.
//
// Mira reports to Bob, who reports to Dana; Alice is an administrator outside that line. Juno,
// a second agent account, reports to Alice, an administrator in its line. Eli works in Mira's
// project and supervises nobody; Gus is in no project.

let testDatabase: TestDatabase;
let h: Harness;
/** How far the console's clock is ahead of the machine's: an offer's days pass by it. */
let ahead = 0;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();
/** The commands of the two accounts, each signed in as the account itself. */
let command: string;
let junosCommand: string;

/** Every value offered and every line said of one, drawn as the tests run: none is in any answer, log, signal or event. */
const values: string[] = [];
const notes: string[] = [];
const value = (): string => {
  const drawn = `value-${randomUUID()}`;
  values.push(drawn);
  return drawn;
};
const note = (): string => {
  const drawn = `for the mail of ${randomUUID()}`;
  notes.push(drawn);
  return drawn;
};
/** What every route but the store's one reading answered. */
const answers: string[] = [];

const JSON_HEADERS = { "content-type": "application/json" };
const fromPages = (who: string) => ({ cookie: cookies.get(who) ?? "", origin: SIGN_IN_URL });
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
async function send(
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const response = await h.request(path, {
    method,
    headers: { ...headers, ...JSON_HEADERS },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  answers.push(await response.clone().text());
  return response;
}
const get = (headers: Record<string, string>, path: string) => send(headers, "GET", path);
const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;
const offers = (handle = "mira", ...rest: string[]) => agentPath(handle, "secret-offers", ...rest);
const own = (...rest: string[]) => agentPath("me", "secret-offers", ...rest);
const db = () => drizzleOf(testDatabase.database);

/** An offer made, as its answer says it. */
async function offer(
  headers: Record<string, string>,
  input: { name: string; value?: string; note?: string; expiresOn?: string },
  handle = "mira",
): Promise<RestAgentSecretOffer> {
  const made = await send(headers, "POST", offers(handle), { value: value(), ...input });
  expect(made.status).toBe(201);
  return restAgentSecretOfferSchema.parse(await made.json());
}
/** What waits for Mira, as its own command lists it. */
const waiting = async () =>
  restAgentSecretOffersSchema.parse(await (await get(bearer(command), own())).json()).items;
/** The account's record of its offers, as one who asks reads it. */
const record = async (headers: Record<string, string>, handle = "mira") =>
  restAgentSecretOffersSchema.parse(await (await get(headers, offers(handle))).json()).items;
/** The value Mira keeps under a name: the store's one reading, which no answer kept here holds. */
async function kept(name: string): Promise<string | undefined> {
  const read = await h.request(agentPath("me", "secrets", name), { headers: bearer(command) });
  return read.status === 200
    ? restAgentSecretValueSchema.parse(await read.json()).value
    : undefined;
}
/** Leaves every offer that waits for Mira, so that a test begins with none. */
async function cleared(): Promise<void> {
  for (const one of await waiting()) {
    expect((await send(bearer(command), "DELETE", own(one.id))).status).toBe(204);
  }
}
const signalsOf = (account: string) =>
  db()
    .select({
      source: agentSignals.source,
      kind: agentSignals.kind,
      key: agentSignals.key,
      text: agentSignals.text,
      byId: agentSignals.byId,
    })
    .from(agentSignals)
    .where(eq(agentSignals.personId, ids.get(account) ?? ""))
    .orderBy(asc(agentSignals.number));

/** An agent account's command, signed in as the account itself. */
async function commandOf(account: string): Promise<string> {
  const begun = await send({}, "POST", REST_ROUTES.connect, { agent: "console", as: "self" });
  const connection = restConnectionSchema.parse(await begun.json());
  await send(fromPages(account), "POST", connectPath(connection.code, "approve"));
  const claim = restClaimSchema.parse(
    await (
      await h.request(CLAIM_PATH, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ secret: connection.secret }),
      })
    ).json(),
  );
  return claim.status === "signed_in" ? claim.secret : "";
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice", "bob", "dana", "eli", "gus"],
    clock: { now: () => new Date(Date.now() + ahead) },
  });
  for (const who of ["alice", "bob", "dana", "eli", "gus"]) {
    cookies.set(who, await h.signIn(who));
    const me = restMeSchema.parse(
      await (
        await h.request(REST_ROUTES.me, { headers: { cookie: cookies.get(who) ?? "" } })
      ).json(),
    );
    ids.set(who, me.person?.id ?? "");
  }
  await h.project(cookies.get("alice") ?? "", {
    key: "ops",
    name: "Operations",
    visibility: "private",
  });
  for (const [login, handle, name] of [
    ["carol", "mira", "Mira"],
    ["acme-juno", "juno", "Juno"],
  ] as const) {
    const made = await send(fromPages("alice"), "POST", REST_ROUTES.agents, {
      host: "gh",
      login,
      handle,
      name,
      project: "ops",
    });
    ids.set(handle, restAgentSchema.parse(await made.json()).person.id);
    cookies.set(handle, await h.signIn(login));
  }
  const reportsTo = (who: string, manager: string) =>
    send(fromPages("alice"), "PATCH", `${REST_ROUTES.people}/${ids.get(who)}`, {
      managerId: ids.get(manager),
    });
  expect((await reportsTo("mira", "bob")).status).toBe(200);
  expect((await reportsTo("bob", "dana")).status).toBe(200);
  expect((await reportsTo("juno", "alice")).status).toBe(200);
  expect(
    (
      await send(fromPages("alice"), "POST", `${projectPath("ops")}/members`, {
        personId: ids.get("eli"),
      })
    ).ok,
  ).toBe(true);
  command = await commandOf("mira");
  junosCommand = await commandOf("juno");
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("a secret offered to an agent account (ADR-0169)", () => {
  it("is kept sealed apart from the store, tells the account, and is the account's to take", async () => {
    const offered = value();
    const said = note();
    const made = await send(fromPages("eli"), "POST", offers(), {
      name: "mail.password",
      value: offered,
      note: said,
      expiresOn: "2027-11-10",
    });
    expect(made.status).toBe(201);
    const one = restAgentSecretOfferSchema.parse(await made.json());
    expect(one).toMatchObject({
      name: "mail.password",
      note: said,
      by: { login: "eli" },
      agent: null,
      expiresOn: "2027-11-10",
      state: "waiting",
      decidedAt: null,
      takenAs: null,
    });
    expect(new Date(one.endsAt).getTime() - new Date(one.at).getTime()).toBe(
      SECRET_OFFER_DAYS * 86_400_000,
    );

    // What the database holds is sealed, and nothing of the account's store changed.
    const [row] = await db()
      .select({ sealed: agentSecretOffers.sealed })
      .from(agentSecretOffers)
      .where(eq(agentSecretOffers.id, one.id));
    expect(row?.sealed).toMatch(/^v1\./);
    expect(row?.sealed).not.toContain(offered);
    expect(await db().select().from(agentSecrets)).toEqual([]);
    expect(await kept("mail.password")).toBeUndefined();

    // The account is woken at once by the console itself: who offers, the name, the commands.
    // Its runner was not heard from, so what the offerer wrote is left to the listing.
    const [wake] = (await signalsOf("mira")).slice(-1);
    expect(wake).toMatchObject({
      source: "console",
      kind: "wake",
      key: `secret-offer:${one.id}`,
      byId: null,
    });
    expect(wake?.text).toBe(
      `@eli offers you a secret, under the name mail.password. It is yours to take or to leave. Take it: console secret --accept ${one.id} (with --as <name>, under a name of your own). Leave it: console secret --decline ${one.id}. It waits until ${one.endsAt.slice(0, 16)}Z. What they say it is for: console secrets --offered`,
    );

    // The account lists what waits, in its command and in its browser, with what was said of it.
    expect(await waiting()).toEqual([one]);
    expect(
      restAgentSecretOffersSchema.parse(
        await (await get({ cookie: cookies.get("mira") ?? "" }, own())).json(),
      ).items,
    ).toEqual([one]);

    // And takes it: the value is in its store as one it set itself, and gone from the offer.
    const taken = await send(bearer(command), "POST", own(one.id, "take"), {});
    expect(taken.status).toBe(200);
    expect(restAgentSecretSchema.parse(await taken.json())).toMatchObject({
      name: "mail.password",
      seeded: false,
      expiresOn: "2027-11-10",
    });
    expect(await kept("mail.password")).toBe(offered);
    expect(await waiting()).toEqual([]);
    const [after] = await db()
      .select({ sealed: agentSecretOffers.sealed, state: agentSecretOffers.state })
      .from(agentSecretOffers)
      .where(eq(agentSecretOffers.id, one.id));
    expect(after).toEqual({ sealed: null, state: "taken" });
    // Taken once: it waits no more.
    const again = await send(bearer(command), "POST", own(one.id, "take"), {});
    expect(again.status).toBe(404);
    expect(await errorOf(again)).toBe("secret.offer_not_found");

    // The account's records say it: the offer's line, and the store's, by the account itself.
    expect((await record(fromPages("bob")))[0]).toMatchObject({
      id: one.id,
      state: "taken",
      takenAs: "mail.password",
      note: said,
      by: { login: "eli" },
    });
    const accesses = restAgentSecretAccessesSchema.parse(
      await (await get(fromPages("bob"), agentPath("mira", "secret-accesses"))).json(),
    ).items;
    expect(accesses.find((line) => line.action === "set")).toMatchObject({
      name: "mail.password",
      by: { id: ids.get("mira") },
      agent: null,
      seeded: false,
    });
  });

  it("is offered by a person, by their agent with a token and by an agent account, each named", async () => {
    await cleared();
    const made = await send(fromPages("eli"), "POST", REST_ROUTES.tokens, { name: "Claude Code" });
    const elisAgent = restTokenCreatedSchema.parse(await made.json()).secret;
    const through = await offer(bearer(elisAgent), { name: "through.agent" });
    expect(through).toMatchObject({ by: { login: "eli" }, agent: "Claude Code" });
    // An agent account offers as any member does, signed in as itself, and is named by its handle.
    const juno = await offer(bearer(junosCommand), { name: "from.juno" });
    expect(juno).toMatchObject({ by: { id: ids.get("juno") }, agent: null });
    expect((await signalsOf("mira")).at(-1)?.text).toContain(
      "The agent account @juno offers you a secret, under the name from.juno.",
    );
    // A supervisor offers too, where they would rather not set it over the account's head.
    const boss = await offer(fromPages("bob"), { name: "from.bob" });
    expect(boss.by).toMatchObject({ login: "bob" });
    expect((await waiting()).map((one) => [one.name, one.agent])).toEqual([
      ["from.bob", null],
      ["from.juno", null],
      ["through.agent", "Claude Code"],
    ]);
  });

  it("is refused to the account itself, to a member who may not see the account, and to nobody signed in", async () => {
    const input = { name: "x", value: value() };
    // The account sets its own secrets itself.
    const self = await send(bearer(command), "POST", offers(), input);
    expect(self.status).toBe(409);
    expect(await errorOf(self)).toBe("secret.offer_own");
    expect((await send({ origin: SIGN_IN_URL }, "POST", offers(), input)).status).toBe(401);
    expect((await send(fromPages("eli"), "POST", offers("nobody"), input)).status).toBe(404);
    expect((await send(fromPages("eli"), "POST", offers("me"), input)).status).toBe(404);
    // A change on a browser's session comes from the console's own pages.
    const foreign = await send({ cookie: cookies.get("eli") ?? "" }, "POST", offers(), input);
    expect(foreign.status).toBe(403);
    expect(await errorOf(foreign)).toBe("auth.forbidden_origin");

    // Where the people are narrowed, Gus, in no project of Mira's, sees no such account: the
    // same answer as for one that is not there. Eli, in its project, offers as before.
    expect((await send(fromPages("gus"), "POST", offers(), input)).status).toBe(201);
    const narrowed = (peopleVisibility: string) =>
      send(fromPages("alice"), "PATCH", REST_ROUTES.workspace, { peopleVisibility });
    expect((await narrowed("shared_projects")).status).toBe(200);
    try {
      const unseen = await send(fromPages("gus"), "POST", offers(), input);
      expect(unseen.status).toBe(404);
      expect(await errorOf(unseen)).toBe("agent.not_found");
      const unread = await get(fromPages("gus"), offers());
      expect(unread.status).toBe(404);
      expect(await errorOf(unread)).toBe("agent.not_found");
      expect((await send(fromPages("eli"), "POST", offers(), input)).status).toBe(201);
    } finally {
      expect((await narrowed("everyone")).status).toBe(200);
    }
  });

  it("is listed, taken and left by the account on a session of its own, never with a token it made", async () => {
    await cleared();
    const one = await offer(fromPages("eli"), { name: "held" });
    const made = await send(fromPages("mira"), "POST", REST_ROUTES.tokens, { name: "a helper" });
    const token = restTokenCreatedSchema.parse(await made.json()).secret;
    for (const [method, path, body] of [
      ["GET", own(), undefined],
      ["POST", own(one.id, "take"), {}],
      ["DELETE", own(one.id), undefined],
    ] as const) {
      const refused = await send(bearer(token), method, path, body);
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(await errorOf(refused)).toBe("secret.own_session");
    }
    // Nor by anyone else: a person has no offers of their own, and a supervisor takes none.
    for (const who of ["bob", "alice", "eli"]) {
      const person = await send(fromPages(who), "POST", own(one.id, "take"), {});
      expect(person.status, who).toBe(404);
      expect(await errorOf(person)).toBe("agent.not_found");
    }
    // Another account is answered as for an offer that is not there, and changes nothing.
    const other = await send(bearer(junosCommand), "POST", own(one.id, "take"), {});
    expect(other.status).toBe(404);
    expect(await errorOf(other)).toBe("secret.offer_not_found");
    expect((await send(bearer(junosCommand), "DELETE", own(one.id))).status).toBe(404);
    // In the account's browser a change comes from its own pages.
    expect(
      (await send({ cookie: cookies.get("mira") ?? "" }, "POST", own(one.id, "take"), {})).status,
    ).toBe(403);
    expect((await waiting()).map((item) => item.id)).toEqual([one.id]);
    expect((await send(fromPages("mira"), "POST", own(one.id, "take"), {})).status).toBe(200);
    expect(await kept("held")).toBe(values.at(-1));
  });

  it("is taken under another name, and over a secret the account keeps only where it says so", async () => {
    await cleared();
    const first = value();
    expect(
      (
        await send(bearer(command), "PUT", agentPath("me", "secrets", "git.token"), {
          value: first,
        })
      ).status,
    ).toBe(200);
    const offered = value();
    const one = await offer(fromPages("eli"), { name: "git.token", value: offered });
    // The name is kept: refused, and both stay as they were.
    const refused = await send(bearer(command), "POST", own(one.id, "take"), {});
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("secret.exists");
    expect(await kept("git.token")).toBe(first);
    expect((await waiting()).map((item) => item.id)).toEqual([one.id]);
    // A second offer of the same name, taken under a name of the account's own.
    const second = value();
    const two = await offer(fromPages("bob"), { name: "git.token", value: second });
    const renamed = await send(bearer(command), "POST", own(two.id, "take"), { as: "git.spare" });
    expect(restAgentSecretSchema.parse(await renamed.json()).name).toBe("git.spare");
    expect(await kept("git.spare")).toBe(second);
    expect(await kept("git.token")).toBe(first);
    expect((await record(fromPages("alice"))).find((item) => item.id === two.id)).toMatchObject({
      name: "git.token",
      state: "taken",
      takenAs: "git.spare",
    });
    // Another name that is kept too is refused the same way.
    const three = await offer(fromPages("bob"), { name: "git.third" });
    const kept2 = await send(bearer(command), "POST", own(three.id, "take"), { as: "git.spare" });
    expect(await errorOf(kept2)).toBe("secret.exists");
    // In its place, where the account says so.
    const replaced = await send(bearer(command), "POST", own(one.id, "take"), { replace: true });
    expect(replaced.status).toBe(200);
    expect(await kept("git.token")).toBe(offered);
  });

  it("is left by the account, and is gone", async () => {
    await cleared();
    const one = await offer(fromPages("eli"), { name: "unwanted" });
    expect((await send(bearer(command), "DELETE", own(one.id))).status).toBe(204);
    expect(await waiting()).toEqual([]);
    const [row] = await db()
      .select({ sealed: agentSecretOffers.sealed, state: agentSecretOffers.state })
      .from(agentSecretOffers)
      .where(eq(agentSecretOffers.id, one.id));
    expect(row).toEqual({ sealed: null, state: "left" });
    expect(await kept("unwanted")).toBeUndefined();
    for (const [method, path, body] of [
      ["POST", own(one.id, "take"), {}],
      ["DELETE", own(one.id), undefined],
      ["POST", own("not-an-id", "take"), {}],
      ["DELETE", own(randomUUID()), undefined],
    ] as const) {
      const gone = await send(bearer(command), method, path, body);
      expect(gone.status, `${method} ${path}`).toBe(404);
      expect(await errorOf(gone)).toBe("secret.offer_not_found");
    }
    expect((await record(fromPages("bob"))).find((item) => item.id === one.id)).toMatchObject({
      state: "left",
      takenAs: null,
    });
  });

  it("shows the account's record whole to each supervisor, and to any other member what they offered", async () => {
    await cleared();
    const elis = await offer(fromPages("eli"), { name: "from.eli", note: note() });
    const junos = await offer(bearer(junosCommand), { name: "from.juno", note: note() });
    // The manager, the manager's manager and an administrator outside the line.
    for (const who of ["bob", "dana", "alice"]) {
      const whole = await record(fromPages(who));
      expect(
        whole.slice(0, 2).map((item) => item.id),
        who,
      ).toEqual([junos.id, elis.id]);
      expect(whole[0]?.note, who).toBe(junos.note);
      expect(
        whole.some((item) => item.state === "taken"),
        who,
      ).toBe(true);
    }
    // And through a supervisor's own agent, as their token reads what they do.
    const made = await send(fromPages("dana"), "POST", REST_ROUTES.tokens, { name: "Codex" });
    const danasAgent = restTokenCreatedSchema.parse(await made.json()).secret;
    expect((await record(bearer(danasAgent))).length).toBeGreaterThan(2);
    // Whoever supervises nobody reads their own offers and nobody else's words.
    expect((await record(fromPages("eli"))).every((item) => item.by?.login === "eli")).toBe(true);
    expect((await record(fromPages("eli"))).map((item) => item.id)).toContain(elis.id);
    const junosOwn = await record(bearer(junosCommand));
    expect(junosOwn.map((item) => item.id)).toContain(junos.id);
    expect(junosOwn.every((item) => item.by?.id === ids.get("juno"))).toBe(true);
    expect(await record(fromPages("gus"))).toEqual(
      (await record(fromPages("alice"))).filter((item) => item.by?.login === "gus"),
    );
    // The account reads nothing of its record by its handle that it does not read as itself.
    expect(await record(bearer(command))).toEqual([]);
    expect((await get({}, offers())).status).toBe(401);

    // An administrator who is in the account's line reads it as one outside it does; whoever is
    // above another account alone does not.
    const toJuno = await offer(fromPages("eli"), { name: "for.juno" }, "juno");
    expect((await record(fromPages("alice"), "juno")).map((item) => item.id)).toEqual([toJuno.id]);
    expect(await record(fromPages("bob"), "juno")).toEqual([]);
    expect(await record(fromPages("dana"), "juno")).toEqual([]);
    expect(
      restAgentSecretOffersSchema.parse(await (await get(bearer(junosCommand), own())).json())
        .items,
    ).toEqual([toJuno]);
  });

  it("carries what the offerer wrote as their words, only to a runner that reads a wake in parts", async () => {
    await cleared();
    const runs = (runner: string | null) =>
      db()
        .insert(agentRunners)
        .values({ personId: ids.get("mira") ?? "", runner, updatedAt: new Date() })
        .onConflictDoUpdate({ target: agentRunners.personId, set: { runner } });
    const said = note();
    // A runner of before prints a wake whole as the console's own words: it is sent none of theirs.
    for (const runner of ["0.6.2", "not a version", null]) {
      await runs(runner);
      await offer(fromPages("eli"), { name: "old.runner", note: said });
      const text = (await signalsOf("mira")).at(-1)?.text ?? "";
      expect(text, String(runner)).not.toContain(said);
      expect(text).toContain("What they say it is for: console secrets --offered");
      expect(wakePartsOf(text)).toBeUndefined();
    }
    await runs("0.6.3");
    const one = await offer(fromPages("eli"), { name: "new.runner", note: said });
    expect(wakePartsOf((await signalsOf("mira")).at(-1)?.text ?? "")).toEqual([
      { says: "@eli offers you a secret, under the name new.runner, and says of it" },
      { words: said },
      {
        says: `It is yours to take or to leave. Take it: console secret --accept ${one.id} (with --as <name>, under a name of your own). Leave it: console secret --decline ${one.id}. It waits until ${one.endsAt.slice(0, 16)}Z.`,
      },
    ]);
    // With nothing said of it, the wake is the console's own line whatever the runner.
    const bare = await offer(fromPages("bob"), { name: "bare" });
    const text = (await signalsOf("mira")).at(-1)?.text ?? "";
    expect(text.startsWith("@bob offers you a secret, under the name bare. It is yours")).toBe(
      true,
    );
    expect(text).toContain(bare.id);
    expect(wakePartsOf(text)).toBeUndefined();
    await runs(null);
  });

  it("bounds what waits for one account, and what one member has waiting there", async () => {
    await cleared();
    // One member's: as many as one may, and one more is refused whoever they offer through.
    for (let index = 0; index < MAX_SECRET_OFFERS_BY_ONE; index += 1) {
      await offer(fromPages("eli"), { name: `eli.${index}` });
    }
    const more = await send(fromPages("eli"), "POST", offers(), {
      name: "eli.more",
      value: value(),
    });
    expect(more.status).toBe(409);
    expect(await errorOf(more)).toBe("secret.too_many_offers");
    // Another account's offers are counted apart.
    await offer(fromPages("eli"), { name: "for.juno.too" }, "juno");
    // The account's: other members fill what is left of it, and the next is refused.
    const others = ["bob", "dana", "alice"];
    for (const who of others) {
      for (let index = 0; index < MAX_SECRET_OFFERS_BY_ONE; index += 1) {
        await offer(fromPages(who), { name: `${who}.${index}` });
      }
    }
    expect(MAX_SECRET_OFFERS_WAITING).toBe((others.length + 1) * MAX_SECRET_OFFERS_BY_ONE);
    expect(await waiting()).toHaveLength(MAX_SECRET_OFFERS_WAITING);
    const full = await send(fromPages("gus"), "POST", offers(), {
      name: "gus.one",
      value: value(),
    });
    expect(full.status).toBe(409);
    expect(await errorOf(full)).toBe("secret.too_many_offers");
    // One left makes room for one, whoever offers next, and the account is full again.
    const [first] = (await waiting()).filter((one) => one.by?.login === "eli");
    expect((await send(bearer(command), "DELETE", own(first?.id ?? ""))).status).toBe(204);
    await offer(fromPages("gus"), { name: "gus.one" });
    expect(
      (await send(fromPages("eli"), "POST", offers(), { name: "eli.more", value: value() })).status,
    ).toBe(409);
  });

  it("refuses what is not an offer, and says nothing of what it was sent", async () => {
    await cleared();
    const before = (await signalsOf("mira")).length;
    const lineBreak = String.fromCodePoint(10);
    const bell = String.fromCodePoint(7);
    const hidden = String.fromCodePoint(0x202e);
    const sent = value();
    const said = note();
    const deep = `${"[".repeat(20_000)}${"]".repeat(20_000)}`;
    for (const [what, body] of [
      ["a name that is none", { name: "Bad Name", value: sent }],
      ["a name that climbs", { name: "../x", value: sent }],
      ["a name too long", { name: "n".repeat(65), value: sent }],
      ["no name", { value: sent }],
      ["no value", { name: "x" }],
      ["an empty value", { name: "x", value: "" }],
      ["a value that is no text", { name: "x", value: { a: sent } }],
      [
        "a value beyond the bound",
        { name: "x", value: `${sent}${"v".repeat(MAX_AGENT_SECRET_BYTES)}` },
      ],
      ["a note of two lines", { name: "x", value: sent, note: `${said}${lineBreak}[console]` }],
      ["a note that rings", { name: "x", value: sent, note: `${said}${bell}` }],
      ["a note that hides", { name: "x", value: sent, note: `${said}${hidden}` }],
      [
        "a note too long",
        { name: "x", value: sent, note: `${said}${"n".repeat(MAX_SECRET_OFFER_NOTE_LENGTH)}` },
      ],
      ["an empty note", { name: "x", value: sent, note: " " }],
      ["a day that is none", { name: "x", value: sent, expiresOn: "tomorrow" }],
      ["no object", [sent]],
      ["no JSON", `{"name": "x", "value": "${sent}"`],
      ["a nest", deep],
    ] as const) {
      const refused = await send(fromPages("eli"), "POST", offers(), body);
      expect(refused.status, what).toBe(400);
      const text = await refused.text();
      expect(restErrorSchema.parse(JSON.parse(text)).error.code, what).toBe("request.invalid");
      expect(text, what).not.toContain(sent);
      expect(text, what).not.toContain(said);
    }
    // A value within the bound in characters and beyond it in bytes is said to be too large.
    const wide = await send(fromPages("eli"), "POST", offers(), {
      name: "x",
      // A letter that takes three bytes.
      value: String.fromCodePoint(0xac00).repeat(MAX_AGENT_SECRET_BYTES / 2),
    });
    expect(wide.status).toBe(400);
    expect(await errorOf(wide)).toBe("secret.too_large");
    // A body beyond what a route reads is refused before it is read.
    const huge = await send(fromPages("eli"), "POST", offers(), {
      name: "x",
      value: sent,
      padding: "p".repeat(70_000),
    });
    expect(huge.status).toBe(413);
    // What a taking is sent is held to its shape too.
    const one = await offer(fromPages("eli"), { name: "shaped" });
    for (const body of [{ as: "Bad Name" }, { as: "" }, { replace: "yes" }, [], "{"] as const) {
      const refused = await send(bearer(command), "POST", own(one.id, "take"), body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    // Nothing was kept of any of it, and nobody was woken but for the one offer made.
    expect((await waiting()).map((item) => item.name)).toEqual(["shaped"]);
    expect(await signalsOf("mira")).toHaveLength(before + 1);
  });

  it("is gone when its days ran out, its value with it", async () => {
    await cleared();
    for (const waits of restAgentSecretOffersSchema.parse(
      await (await get(bearer(junosCommand), own())).json(),
    ).items) {
      expect((await send(bearer(junosCommand), "DELETE", own(waits.id))).status).toBe(204);
    }
    const offered = value();
    const one = await offer(fromPages("eli"), { name: "late", value: offered });
    ahead += SECRET_OFFER_DAYS * 86_400_000 - 60_000;
    expect((await waiting()).map((item) => item.id)).toEqual([one.id]);
    ahead += 120_000;
    // It waits no more for the account, and its record says when it ran out: before any pass
    // of the worker has ended it, and after.
    expect(await waiting()).toEqual([]);
    const ranOut = { id: one.id, state: "lapsed", decidedAt: one.endsAt, takenAs: null };
    expect((await record(fromPages("bob")))[0]).toMatchObject(ranOut);
    const [row] = await db().select({ id: workspaces.id }).from(workspaces);
    expect(
      await lapseSecretOffers(testDatabase.database, row?.id ?? "", new Date(Date.now() + ahead)),
    ).toBe(1);
    const [ended] = await db()
      .select({ sealed: agentSecretOffers.sealed, state: agentSecretOffers.state })
      .from(agentSecretOffers)
      .where(eq(agentSecretOffers.id, one.id));
    expect(ended).toEqual({ sealed: null, state: "lapsed" });
    expect((await record(fromPages("bob")))[0]).toMatchObject(ranOut);
    expect(
      await lapseSecretOffers(testDatabase.database, row?.id ?? "", new Date(Date.now() + ahead)),
    ).toBe(0);
    // Neither taken nor left any more.
    const taken = await send(bearer(command), "POST", own(one.id, "take"), {});
    expect(taken.status).toBe(404);
    expect(await errorOf(taken)).toBe("secret.offer_not_found");
    expect((await send(bearer(command), "DELETE", own(one.id))).status).toBe(404);
    expect(await kept("late")).toBeUndefined();

    // One whose days ran out while no pass ran is no offer any more, to the account or to the
    // bounds, and the next offer made to the account ends it.
    const next = await offer(fromPages("eli"), { name: "later" });
    ahead += SECRET_OFFER_DAYS * 86_400_000 + 60_000;
    expect((await send(bearer(command), "POST", own(next.id, "take"), {})).status).toBe(404);
    for (let index = 0; index < MAX_SECRET_OFFERS_BY_ONE; index += 1) {
      await offer(fromPages("eli"), { name: `again.${index}` });
    }
    expect(
      await db()
        .select({ sealed: agentSecretOffers.sealed })
        .from(agentSecretOffers)
        .where(and(eq(agentSecretOffers.id, next.id), eq(agentSecretOffers.state, "lapsed"))),
    ).toEqual([{ sealed: null }]);
  });

  it("puts no value in any answer, signal, event or line of the log, and no offerer's words in a log", async () => {
    expect(values.length).toBeGreaterThan(20);
    const signals = JSON.stringify([...(await signalsOf("mira")), ...(await signalsOf("juno"))]);
    const events = JSON.stringify(
      restEventsSchema.parse(
        await (
          await h.request(`${REST_ROUTES.events}?after=0`, {
            headers: { cookie: cookies.get("alice") ?? "" },
          })
        ).json(),
      ).items,
    );
    const said = answers.join("\n");
    const logged = JSON.stringify(h.logs);
    for (const one of values) {
      expect(said).not.toContain(one);
      expect(signals).not.toContain(one);
      expect(events).not.toContain(one);
      expect(logged).not.toContain(one);
    }
    for (const one of notes) {
      expect(logged).not.toContain(one);
      expect(events).not.toContain(one);
    }
    // Nothing of an offer is on the board's feed at all.
    expect(events).not.toContain("mail.password");
    // What is sealed is nothing that reads as a value.
    const sealed = await db().select({ sealed: agentSecretOffers.sealed }).from(agentSecretOffers);
    for (const row of sealed) {
      for (const one of values) {
        expect(row.sealed ?? "").not.toContain(one);
      }
    }
    // And the store holds what the account took, under the names it took them by.
    expect(
      restAgentSecretsSchema
        .parse(await (await get(bearer(command), agentPath("me", "secrets"))).json())
        .items.map((item) => item.name),
    ).toEqual(["git.spare", "git.token", "held", "mail.password"]);
  });
});
