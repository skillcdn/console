import {
  agentPath,
  projectPath,
  REST_ROUTES,
  type RestAvatarParts,
  restAgentProposalsSchema,
  restAgentSchema,
  restAgentsSchema,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restPeopleSchema,
  restPersonSchema,
  restTaskSchema,
  rollAvatar,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The agent accounts of the directory (ADR-0084): made by an administrator, a member before
// anyone signed in with it, bound to its provider's account at its first sign-in, and under the
// rules a person is under but one. On a database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let aliceId: string;
let bobId: string;

const PARTS: RestAvatarParts = {
  set: 1,
  background: 0,
  head: 1,
  ears: 0,
  eyes: 2,
  mouth: 1,
  marks: 0,
  accessory: 0,
  palette: 3,
};

const JSON_HEADERS = { "content-type": "application/json" };
/** The headers of a request from the console's own pages, as a signed-in person's browser sends one. */
const fromPages = (cookie: string) => ({ cookie, origin: SIGN_IN_URL });
const get = (cookie: string, path: string) => h.request(path, { headers: { cookie } });
const send = (cookie: string, method: string, path: string, body: unknown) =>
  h.request(path, {
    method,
    headers: { ...fromPages(cookie), ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
const errorOf = async (response: Response) =>
  restErrorSchema.parse(await response.json()).error.code;
const meOf = async (cookie: string) => {
  const { person } = restMeSchema.parse(await (await get(cookie, REST_ROUTES.me)).json());
  if (person === null) {
    throw new Error("the cookie carries nobody's session");
  }
  return person;
};
const account = (fields: Record<string, unknown>) => ({
  host: "gh",
  name: "Mira",
  avatarParts: PARTS,
  project: "ops",
  ...fields,
});
const eventsOf = async (cookie: string) =>
  restEventsSchema.parse(await (await get(cookie, `${REST_ROUTES.events}?after=0`)).json()).items;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh"), createFixtureProvider("google")],
    // The operator names an agent's login an administrator too: it is made none (ADR-0084).
    admins: ["alice", "erin@mail.test"],
    domains: ["acme.test"],
    listed: ["alice", "bob"],
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  aliceId = (await meOf(alice)).id;
  bobId = (await meOf(bob)).id;
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  await h.project(alice, { key: "lab", name: "The lab", visibility: "private" });
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("an agent account (ADR-0084)", () => {
  let miraId: string;
  let mira: string;
  let dex: string;
  let echo: string;
  let dexId: string;
  let echoId: string;

  it("is made by an administrator, and is a member before anyone signed in with it", async () => {
    const byMember = await send(
      bob,
      "POST",
      REST_ROUTES.agents,
      account({ login: "carol", handle: "mira" }),
    );
    expect(byMember.status).toBe(403);
    expect(await errorOf(byMember)).toBe("auth.forbidden");

    const made = await send(
      alice,
      "POST",
      REST_ROUTES.agents,
      account({ login: "carol", handle: "mira", title: "Release engineer", avatarSeed: "s-1" }),
    );
    expect(made.status).toBe(201);
    const agent = restAgentSchema.parse(await made.json());
    expect(agent.person).toMatchObject({
      login: "carol",
      name: "Mira",
      avatar: null,
      kind: "agent",
      handle: "mira",
      title: "Release engineer",
      avatarParts: PARTS,
      role: "member",
      status: "active",
      source: "listed",
      // Whoever makes it answers for it, unless they name another.
      managerId: aliceId,
      invited: true,
    });
    expect(agent.manager?.id).toBe(aliceId);
    miraId = agent.person.id;

    // Listed among the agent accounts, read by its handle, and among the people, where a login
    // let in that nobody signed in with is no longer one of the listings.
    const listed = restAgentsSchema.parse(await (await get(bob, REST_ROUTES.agents)).json());
    expect(listed.items.map((item) => item.person.handle)).toEqual(["mira"]);
    const one = await get(bob, agentPath("mira"));
    expect(restAgentSchema.parse(await one.json()).person.id).toBe(miraId);
    expect((await get(bob, agentPath("nobody"))).status).toBe(404);
    expect((await get(bob, agentPath("new"))).status).toBe(404);
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    expect(people.items.find((person) => person.id === miraId)).toMatchObject({
      kind: "agent",
      invited: true,
    });
    expect(people.items.find((person) => person.id === aliceId)).toMatchObject({
      kind: "person",
      handle: null,
      title: null,
      avatarParts: null,
    });
    expect(people.items.find((person) => person.id === aliceId)).not.toHaveProperty("invited");
    expect(people.listed.map((listing) => listing.login)).toEqual([]);

    // The board is told as it is of a login let in, with the handle, and of the project it starts in.
    const events = await eventsOf(alice);
    expect(events.find((event) => event.kind === "person.listed")?.data).toMatchObject({
      login: "carol",
      handle: "mira",
    });

    // Work is assigned to it before it has signed in.
    const task = await send(alice, "POST", projectPath("ops", "tasks"), {
      title: "Cut the release",
      workerIds: [miraId],
    });
    expect(task.status).toBe(201);
    expect(restTaskSchema.parse(await task.json()).workers.map((worker) => worker.handle)).toEqual([
      "mira",
    ]);
  });

  it("is bound to its provider's account at its first sign-in, its name and picture the console's", async () => {
    mira = await h.signIn("carol");
    const me = await meOf(mira);
    // The row an administrator made, known by the provider's account from now on; what the
    // provider calls the account, `Carol`, is not written over the console's name.
    expect(me).toMatchObject({
      id: miraId,
      login: "carol",
      name: "Mira",
      avatar: null,
      kind: "agent",
      handle: "mira",
      role: "member",
    });
    expect(me).not.toHaveProperty("invited");
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    expect(people.items.filter((person) => person.login === "carol")).toHaveLength(1);
    // The first sign-in is the joining.
    const joined = (await eventsOf(alice)).filter((event) => event.kind === "person.joined");
    expect(joined.map((event) => event.actor?.id)).toContain(miraId);
    // It is in the project it started in, as a member, and sees it.
    expect((await get(mira, projectPath("ops"))).status).toBe(200);
    // A second sign-in changes nothing of what it is.
    const again = await meOf(await h.signIn("carol"));
    expect(again).toMatchObject({ id: miraId, name: "Mira", kind: "agent" });
  });

  it("is the same row when its domain lets it in, and never an administrator by the operator's naming", async () => {
    const dave = await send(
      alice,
      "POST",
      REST_ROUTES.agents,
      account({
        host: "google",
        login: "dave@acme.test",
        handle: "dex",
        name: "Dex",
        project: "lab",
      }),
    );
    expect(dave.status).toBe(201);
    dexId = restAgentSchema.parse(await dave.json()).person.id;
    dex = await h.signIn("dave");
    expect(await meOf(dex)).toMatchObject({
      id: dexId,
      kind: "agent",
      name: "Dex",
      // What let it in at its sign-in: the domain the operator names.
      source: "domain",
      email: "dave@acme.test",
    });

    const erin = await send(
      alice,
      "POST",
      REST_ROUTES.agents,
      account({
        host: "google",
        login: "erin@mail.test",
        handle: "echo",
        name: "Echo",
        project: "lab",
      }),
    );
    expect(erin.status).toBe(201);
    echoId = restAgentSchema.parse(await erin.json()).person.id;
    echo = await h.signIn("erin");
    expect(await meOf(echo)).toMatchObject({
      kind: "agent",
      handle: "echo",
      role: "member",
    });
  });

  it("refuses a handle taken or reserved, a login that is one already, and a manager or a project that is none", async () => {
    const post = (fields: Record<string, unknown>) =>
      send(alice, "POST", REST_ROUTES.agents, account({ login: "zed", handle: "zed", ...fields }));
    const taken = await post({ handle: "mira" });
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe("agent.handle_taken");
    for (const handle of ["new", "me", "proposals", "setup", "Mira", "a", "-a", "a_b"]) {
      const refused = await post({ handle });
      expect(refused.status, handle).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    const exists = await post({ login: "Carol" });
    expect(exists.status).toBe(409);
    expect(await errorOf(exists)).toBe("agent.exists");
    const noProject = await post({ project: "nowhere" });
    expect(noProject.status).toBe(400);
    expect(await errorOf(noProject)).toBe("agent.invalid_project");
    const noManager = await post({ managerId: "0199c4d8-0000-7000-8000-00000000dead" });
    expect(noManager.status).toBe(400);
    expect(await errorOf(noManager)).toBe("agent.invalid_manager");
    // A login as the host spells one, at a provider the deployment has.
    const address = await post({ login: "zed@acme.test" });
    expect(address.status).toBe(400);
    const only = createHarness(testDatabase, {
      providers: [createFixtureProvider("gh")],
      admins: ["alice"],
      listed: ["alice", "bob"],
    });
    const unknown = await only.request(REST_ROUTES.agents, {
      method: "POST",
      headers: { ...fromPages(await only.signIn("alice")), ...JSON_HEADERS },
      body: JSON.stringify(account({ host: "google", login: "zed@acme.test", handle: "zed" })),
    });
    expect(unknown.status).toBe(400);
    expect(await errorOf(unknown)).toBe("agent.unknown_host");
  });

  it("is what a member's login is made, once, unless they administer the workspace", async () => {
    const own = await send(
      alice,
      "POST",
      REST_ROUTES.agents,
      account({ login: "alice", handle: "ally" }),
    );
    expect(own.status).toBe(409);
    expect(await errorOf(own)).toBe("agent.administrator");

    const made = await send(
      alice,
      "POST",
      REST_ROUTES.agents,
      account({ login: "bob", handle: "bolt", name: "Bolt" }),
    );
    expect(made.status).toBe(201);
    const agent = restAgentSchema.parse(await made.json());
    // The member's own row, with everything it did: it has signed in, so nobody is invited.
    expect(agent.person).toMatchObject({
      id: bobId,
      kind: "agent",
      handle: "bolt",
      name: "Bolt",
      managerId: aliceId,
    });
    expect(agent.person).not.toHaveProperty("invited");
    const updated = (await eventsOf(alice)).filter((event) => event.kind === "person.updated");
    expect(updated.at(-1)?.data).toMatchObject({ login: "bob", handle: "bolt", fields: ["kind"] });
    // The session it holds is the account's still.
    expect(await meOf(bob)).toMatchObject({ id: bobId, kind: "agent", handle: "bolt" });

    const again = await send(
      alice,
      "POST",
      REST_ROUTES.agents,
      account({ login: "bob", handle: "bolt-2" }),
    );
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("agent.exists");
  });

  it("is never an administrator and always has a manager, who may be an agent account", async () => {
    const patch = (id: string, body: unknown) =>
      send(alice, "PATCH", `${REST_ROUTES.people}/${id}`, body);
    const admin = await patch(miraId, { role: "admin" });
    expect(admin.status).toBe(409);
    expect(await errorOf(admin)).toBe("person.agent_admin");
    const nobody = await patch(miraId, { managerId: null });
    expect(nobody.status).toBe(409);
    expect(await errorOf(nobody)).toBe("person.manager_required");
    // Replaced, by an administrator, with a person or another agent account; never in a loop.
    const replaced = await patch(miraId, { managerId: bobId });
    expect(replaced.status).toBe(200);
    expect(restPersonSchema.parse(await replaced.json()).managerId).toBe(bobId);
    const loop = await patch(bobId, { managerId: miraId });
    expect(loop.status).toBe(409);
    expect(await errorOf(loop)).toBe("person.invalid_manager");
    // The rest of what a member is said to be holds for it as it is: taken out, and back in.
    const out = await patch(miraId, { status: "deactivated" });
    expect(restPersonSchema.parse(await out.json()).status).toBe("deactivated");
    const back = await patch(miraId, { status: "active" });
    expect(restPersonSchema.parse(await back.json())).toMatchObject({
      status: "active",
      kind: "agent",
    });
  });
  it("is supervised by the administrators and the line above it, and a member sees their own line whatever the projects say", async () => {
    const agentsOf = async (cookie: string) =>
      restAgentsSchema.parse(await (await get(cookie, REST_ROUTES.agents)).json()).items;
    const seenBy = async (cookie: string) =>
      restPeopleSchema
        .parse(await (await get(cookie, REST_ROUTES.people)).json())
        .items.map((person) => person.handle ?? person.login)
        .sort();
    const patch = (id: string, body: unknown) =>
      send(alice, "PATCH", `${REST_ROUTES.people}/${id}`, body);
    // An administrator supervises every agent account; its manager supervises it; a member
    // who merely works beside it does not.
    expect((await agentsOf(alice)).every((agent) => agent.supervised)).toBe(true);
    const beside = await agentsOf(mira);
    expect(beside.find((agent) => agent.person.id === bobId)?.supervised).toBe(false);
    const asManager = await agentsOf(bob);
    expect(asManager.find((agent) => agent.person.id === miraId)?.supervised).toBe(true);
    expect(asManager.find((agent) => agent.person.id === dexId)?.supervised).toBe(false);

    // Narrowed to the people one shares a project with (ADR-0035): Echo is in the lab with Dex,
    // and sees neither Mira nor Bolt, who are in Operations.
    const narrowed = await send(alice, "PATCH", REST_ROUTES.workspace, {
      peopleVisibility: "shared_projects",
    });
    expect(narrowed.status).toBe(200);
    expect(await seenBy(echo)).toEqual(["Alice", "dex", "echo"]);
    expect((await agentsOf(echo)).map((agent) => agent.person.handle)).toEqual(["dex", "echo"]);
    expect((await get(echo, agentPath("mira"))).status).toBe(404);

    // Mira reports to Echo now: Echo sees whom it answers for, and Mira whom it reports to,
    // though they share no project.
    expect((await patch(miraId, { managerId: echoId })).status).toBe(200);
    expect(await seenBy(echo)).toEqual(["Alice", "dex", "echo", "mira"]);
    expect(await seenBy(mira)).toEqual(["Alice", "bolt", "echo", "mira"]);
    const echos = await agentsOf(echo);
    expect(echos.find((agent) => agent.person.id === miraId)).toMatchObject({ supervised: true });
    expect(echos.find((agent) => agent.person.id === dexId)).toMatchObject({ supervised: false });
    const miras = await agentsOf(mira);
    // Its manager is read with it, and it supervises nobody above it.
    expect(miras.find((agent) => agent.person.id === miraId)?.manager?.id).toBe(echoId);
    expect(miras.find((agent) => agent.person.id === echoId)).toMatchObject({ supervised: false });
    // Bolt works beside Mira and manages it no longer.
    expect((await agentsOf(bob)).find((agent) => agent.person.id === miraId)).toMatchObject({
      supervised: false,
    });

    // Up the line: Echo reports to Dex, so Dex supervises Mira through Echo, and sees it.
    expect((await patch(echoId, { managerId: dexId })).status).toBe(200);
    const dexes = await agentsOf(dex);
    expect(dexes.find((agent) => agent.person.id === miraId)).toMatchObject({ supervised: true });
    expect(await seenBy(dex)).toEqual(["Alice", "dex", "echo", "mira"]);
    // And the one below sees its own manager, not the line above them.
    expect(await seenBy(mira)).toEqual(["Alice", "bolt", "echo", "mira"]);

    const restored = await send(alice, "PATCH", REST_ROUTES.workspace, {
      peopleVisibility: "everyone",
    });
    expect(restored.status).toBe(200);
  });
  it("has a title, as every member has: an administrator's to write, and of an agent account its supervisors' too", async () => {
    const title = (cookie: string, id: string, value: unknown) =>
      send(cookie, "PATCH", `${REST_ROUTES.people}/${id}`, { title: value });
    // Of a person, by an administrator alone; the board is told that it changed.
    const own = await title(alice, aliceId, "  Founder  ");
    expect(own.status).toBe(200);
    expect(restPersonSchema.parse(await own.json()).title).toBe("Founder");
    const byAgent = await title(mira, aliceId, "Boss");
    expect(byAgent.status).toBe(403);
    expect(await errorOf(byAgent)).toBe("auth.forbidden");
    const told = (await eventsOf(alice)).filter((event) => event.kind === "person.updated");
    expect(told.at(-1)).toMatchObject({
      actor: { id: aliceId },
      data: { login: "Alice", fields: ["title"] },
    });
    expect(told.at(-1)?.data).not.toHaveProperty("handle");

    // Of an agent account, by whoever supervises it: Echo is Mira's manager, Dex above Echo;
    // Bolt works beside Mira and supervises it no longer.
    const byManager = await title(echo, miraId, "Release captain");
    expect(byManager.status).toBe(200);
    const written = restPersonSchema.parse(await byManager.json());
    expect(written).toMatchObject({ title: "Release captain", handle: "mira" });
    // A supervisor who is no administrator reads no work email with what they wrote.
    expect(written).not.toHaveProperty("email");
    expect((await title(dex, miraId, "Release lead")).status).toBe(200);
    const beside = await title(bob, miraId, "Mine");
    expect(beside.status).toBe(403);
    // Nothing else of the account is a supervisor's to say here, with a title or without.
    const more = await send(echo, "PATCH", `${REST_ROUTES.people}/${miraId}`, {
      title: "Lead",
      status: "deactivated",
    });
    expect(more.status).toBe(403);
    const events = (await eventsOf(alice)).filter((event) => event.kind === "person.updated");
    expect(events.at(-1)).toMatchObject({
      actor: { id: dexId },
      data: { login: "carol", handle: "mira", fields: ["title"] },
    });

    // Cleared with null; what is already so writes nothing; a title is one bounded line.
    const before = (await eventsOf(alice)).length;
    expect((await title(alice, miraId, "Release lead")).status).toBe(200);
    expect((await eventsOf(alice)).length).toBe(before);
    const cleared = await title(alice, miraId, null);
    expect(restPersonSchema.parse(await cleared.json()).title).toBeNull();
    expect((await title(alice, miraId, "x".repeat(81))).status).toBe(400);
    expect((await title(alice, miraId, "two\nlines")).status).toBe(400);
    expect((await title(alice, "0199c4d8-0000-7000-8000-00000000dead", "Ghost")).status).toBe(404);
  });
  it("is proposed a persona, a name, a handle nobody has and an avatar, and is made with one rolled where none is sent", async () => {
    const proposals = async (cookie: string, query = "") =>
      get(cookie, `${REST_ROUTES.agents}/proposals${query}`);
    // For whoever makes accounts: an administrator.
    expect((await proposals(mira)).status).toBe(403);
    const asked = await proposals(alice);
    expect(asked.status).toBe(200);
    const { items } = restAgentProposalsSchema.parse(await asked.json());
    expect(items).toHaveLength(4);
    expect(new Set(items.map((item) => item.handle)).size).toBe(4);
    for (const item of items) {
      // The same seed draws the same avatar anywhere the package is, and no handle is one taken.
      expect(item.avatarParts).toEqual(rollAvatar(item.seed));
      expect(["mira", "dex", "echo", "bolt"]).not.toContain(item.handle);
      expect(item.name).toMatch(/^[A-Z][a-z]+$/);
    }
    // Rolled again at each asking; as many as asked for, in the language asked for.
    const again = restAgentProposalsSchema.parse(await (await proposals(alice)).json());
    expect(again.items.map((item) => item.seed)).not.toEqual(items.map((item) => item.seed));
    const korean = restAgentProposalsSchema.parse(
      await (await proposals(alice, "?count=12&lang=ko")).json(),
    );
    expect(korean.items).toHaveLength(12);
    expect(korean.items.every((item) => !/[A-Za-z]/.test(item.name))).toBe(true);
    for (const query of ["?count=0", "?count=13", "?count=two", "?lang=not_a_tag"]) {
      expect((await proposals(alice, query)).status, query).toBe(400);
    }

    // Made with a proposal as it was proposed; and with no parts at all, which the console rolls
    // from the seed given, or from one of its own.
    const [first] = items;
    const { project: _, avatarParts: __, ...rest } = account({});
    const seeded = await send(alice, "POST", REST_ROUTES.agents, {
      ...rest,
      login: "zed",
      handle: first?.handle,
      name: first?.name,
      avatarSeed: first?.seed,
      project: "lab",
    });
    expect(seeded.status).toBe(201);
    expect(restAgentSchema.parse(await seeded.json()).person.avatarParts).toEqual(
      first?.avatarParts,
    );
    const unseeded = await send(alice, "POST", REST_ROUTES.agents, {
      ...rest,
      login: "yan",
      handle: "yan",
      project: "lab",
    });
    expect(unseeded.status).toBe(201);
    expect(restAgentSchema.parse(await unseeded.json()).person.avatarParts).toMatchObject({
      set: 1,
    });
  });

  it("has a persona its supervisors keep: its name, its title and its avatar, never its handle", async () => {
    const keep = (cookie: string, handle: string, body: unknown) =>
      send(cookie, "PATCH", agentPath(handle), body);
    const parts = rollAvatar("another-face");
    // Echo manages Mira, Dex is above Echo; Bolt works beside Mira.
    const kept = await keep(echo, "mira", {
      name: "Mira Kim",
      title: "Release lead",
      avatarParts: parts,
      avatarSeed: "another-face",
    });
    expect(kept.status).toBe(200);
    const agent = restAgentSchema.parse(await kept.json());
    expect(agent.person).toMatchObject({
      id: miraId,
      handle: "mira",
      name: "Mira Kim",
      title: "Release lead",
      avatarParts: parts,
    });
    expect(agent.supervised).toBe(true);
    const told = (await eventsOf(alice)).filter((event) => event.kind === "person.updated").at(-1);
    expect(told).toMatchObject({
      actor: { id: echoId },
      data: { login: "carol", handle: "mira", fields: ["name", "title", "avatar"] },
    });
    // What is already so writes nothing; one thing changed names that one.
    const before = (await eventsOf(alice)).length;
    expect((await keep(dex, "mira", { name: "Mira Kim", avatarParts: parts })).status).toBe(200);
    expect((await eventsOf(alice)).length).toBe(before);
    expect((await keep(alice, "mira", { title: null })).status).toBe(200);
    expect((await eventsOf(alice)).at(-1)?.data).toMatchObject({ fields: ["title"] });
    // The name survives a sign-in, as the console's own.
    expect(await meOf(await h.signIn("carol"))).toMatchObject({ name: "Mira Kim", title: null });

    // Whoever sees it and does not supervise it reads it, and keeps nothing of it; nobody keeps
    // an account that is none, and a patch names something a persona has.
    const beside = await keep(bob, "mira", { name: "Mine" });
    expect(beside.status).toBe(403);
    expect(await errorOf(beside)).toBe("auth.forbidden");
    expect((await keep(mira, "mira", { name: "Myself" })).status).toBe(403);
    expect((await keep(alice, "nobody", { name: "Ghost" })).status).toBe(404);
    for (const body of [{}, { handle: "other" }, { name: "" }, { avatarParts: { set: 1 } }]) {
      expect((await keep(alice, "mira", body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});
