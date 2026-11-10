import {
  agentPath,
  MAX_AGENT_ELSEWHERE,
  MAX_ELSEWHERE_NAME_LENGTH,
  projectPath,
  REST_ROUTES,
  restAgentSchema,
  restAgentsSchema,
  restErrorSchema,
  restEventsSchema,
  restSignalsSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { workspaces } from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { BoardWakes } from "./jobs/board-wakes.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The onboarding of an agent account (ADR-0088, points 4 to 6): its first task, made with the
// account, with which the board wakes it; and the accounts it holds elsewhere
// (ADR-0089), which the account records of itself and a supervisor may. On a database of its own.

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
const MIRA = agentPath("mira");
const agentOf = async (cookie: string) =>
  restAgentSchema.parse(await (await get({ cookie }, MIRA)).json());
const record = (headers: Record<string, string>, accounts: unknown) =>
  send(headers, "PATCH", MIRA, { accounts });
/** How many times the feed says the account's accounts changed. */
const recordings = async () =>
  restEventsSchema
    .parse(await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json())
    .items.filter(
      (event) => event.kind === "person.updated" && event.data.fields?.includes("accounts"),
    ).length;

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
  await send(fromPages(alice), "PATCH", REST_ROUTES.workspace, {
    handle: "acme",
    domain: "acme.example",
    services: {
      identity: { kind: "github" },
      git: { kind: "github", organization: "acme" },
      messenger: { kind: "slack", workspace: "acme.slack.com" },
    },
  });
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the onboarding of an agent account (ADR-0088)", () => {
  it("makes its first task with the account, and the board wakes it with it", async () => {
    const made = await send(fromPages(alice), "POST", REST_ROUTES.agents, {
      host: "gh",
      login: "carol",
      handle: "mira",
      name: "Mira",
      title: "Release engineer",
      project: "ops",
    });
    expect(made.status).toBe(201);
    const account = restAgentSchema.parse(await made.json());
    expect(account.onboarding).toEqual({ project: "ops", number: 1 });

    // The task: in the project the account starts in, ready, the account at work on it, and
    // whoever made the account its owner.
    const tasks = restTasksSchema.parse(
      await (await get({ cookie: alice }, projectPath("ops", "tasks"))).json(),
    ).items;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ number: 1, title: "Set up @mira", state: "ready" });
    expect(tasks[0]?.workers.map((worker) => worker.handle)).toEqual(["mira"]);
    expect(tasks[0]?.owner.login).toBe("Alice");
    // Its words, for this account and the services of its workspace: what the agent does
    // itself, and what only a person can do, asked as decisions. The account it signs in with
    // came before the line, and is asked for nowhere.
    const task = restTaskSchema.parse(
      await (await get({ cookie: alice }, projectPath("ops", "tasks", "1"))).json(),
    );
    expect(task.body).toContain("This is your first task, @mira");
    expect(task.body).toContain("Make the repository `acme-mira/desk`, private");
    expect(task.body).toContain("`console agent mira --account <service>=<name>`");
    expect(task.body).toContain("## What only a person can do");
    expect(task.body).toContain("**Invite mira to the messenger.**");
    expect(task.body).not.toContain("Make the account `acme-mira` at GitHub");

    // The board wakes the account with it, as with any ready task it is at work on, and the
    // wake waits on the account's record for a runner's first connection: nothing is there
    // until the worker has read the feed, and one wake after.
    const signalsOf = async () =>
      restSignalsSchema.parse(
        await (await get({ cookie: alice }, agentPath("mira", "signals"))).json(),
      ).items;
    expect(await signalsOf()).toEqual([]);
    const [workspace] = await drizzleOf(testDatabase.database).select().from(workspaces).limit(1);
    const wakes = new BoardWakes({
      database: testDatabase.database,
      workspaceId: async () => workspace?.id ?? "",
      clock: { now: () => new Date() },
      logger: pino({ level: "silent" }),
    });
    await wakes.sweep();
    const signals = await signalsOf();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      number: 1,
      kind: "wake",
      source: "board",
      key: "ops#1",
      by: { login: "Alice" },
    });
    expect(signals[0]?.text).toBe(
      '#1 "Set up @mira" in ops is ready, and you are at work on it. Read it: console task 1 --project ops',
    );
    await wakes.close();

    // Made through an administrator's agent, the task names the agent it was written through.
    const token = restTokenCreatedSchema.parse(
      await (
        await send(fromPages(alice), "POST", REST_ROUTES.tokens, { name: "Claude Code" })
      ).json(),
    ).secret;
    const second = await send({ authorization: `Bearer ${token}` }, "POST", REST_ROUTES.agents, {
      host: "gh",
      login: "dana",
      handle: "noor",
      name: "Noor",
      project: "ops",
    });
    expect(restAgentSchema.parse(await second.json()).onboarding).toEqual({
      project: "ops",
      number: 2,
    });
    const written = restTaskSchema.parse(
      await (await get({ cookie: alice }, projectPath("ops", "tasks", "2"))).json(),
    );
    expect(written).toMatchObject({ title: "Set up @noor", agent: "Claude Code" });

    // Read later, an account says nothing of the task made with it: the board does.
    expect((await agentOf(alice)).onboarding).toBeUndefined();
  });
});

describe("the accounts an agent account holds elsewhere (ADR-0089)", () => {
  it("are recorded by a supervisor and by the account itself, and by nobody else", async () => {
    expect((await agentOf(alice)).accounts).toEqual({});
    const first = await record(fromPages(alice), { github: "acme-mira" });
    expect(first.status).toBe(200);
    expect(restAgentSchema.parse(await first.json()).accounts).toEqual({ github: "acme-mira" });

    // The account, signed in as itself, records its own: the one thing it keeps of itself here.
    const carol = await h.signIn("carol");
    const own = await record(fromPages(carol), { slack: "U0123 (mira)" });
    expect(own.status).toBe(200);
    expect(restAgentSchema.parse(await own.json()).accounts).toEqual({
      github: "acme-mira",
      slack: "U0123 (mira)",
    });
    // Its persona stays a supervisor's to keep, alone or beside an account.
    for (const patch of [{ name: "Mirabel" }, { name: "Mirabel", accounts: { mail: "m@x" } }]) {
      const refused = await send(fromPages(carol), "PATCH", MIRA, patch);
      expect(refused.status).toBe(403);
      expect(await errorOf(refused)).toBe("auth.forbidden");
    }
    // A member who sees the account and supervises nothing of it records nothing.
    const stranger = await record(fromPages(bob), { github: "someone-else" });
    expect(stranger.status).toBe(403);
    expect(await agentOf(alice)).toMatchObject({
      person: { name: "Mira" },
      accounts: { github: "acme-mira", slack: "U0123 (mira)" },
    });
    // Whoever sees the account reads them: they say what it is called, and no secret.
    expect((await agentOf(bob)).accounts).toEqual({ github: "acme-mira", slack: "U0123 (mira)" });
    // The list of the accounts says nothing of them.
    const listed = restAgentsSchema.parse(
      await (await get({ cookie: alice }, REST_ROUTES.agents)).json(),
    ).items;
    expect(listed.every((agent) => agent.accounts === undefined)).toBe(true);
  });

  it("takes one away, writes nothing that is so already, and tells the board when one changed", async () => {
    const before = await recordings();
    // What is so already writes nothing, and says nothing.
    expect((await record(fromPages(alice), { github: "acme-mira" })).status).toBe(200);
    expect((await record(fromPages(alice), { mail: null })).status).toBe(200);
    expect(await recordings()).toBe(before);
    // A name changed, one taken away and one added: once on the feed, for one request.
    const changed = await record(fromPages(alice), {
      github: "acme-mira-2",
      slack: null,
      mail: "mira@acme.example",
    });
    expect(restAgentSchema.parse(await changed.json()).accounts).toEqual({
      github: "acme-mira-2",
      mail: "mira@acme.example",
    });
    expect(await recordings()).toBe(before + 1);
  });

  it("is held to what an account is: a few, each a short name and a line, and never markup", async () => {
    for (const accounts of [
      {},
      { GitHub: "acme-mira" },
      { "git hub": "acme-mira" },
      { github: "" },
      { github: "acme\nmira" },
      { github: "x".repeat(MAX_ELSEWHERE_NAME_LENGTH + 1) },
      { github: 7 },
      { github: { name: "acme-mira" } },
      Object.fromEntries(
        Array.from({ length: MAX_AGENT_ELSEWHERE + 1 }, (_, index) => [`s${index}`, "x"]),
      ),
      "github=acme-mira",
    ]) {
      const refused = await record(fromPages(alice), accounts);
      expect(refused.status, JSON.stringify(accounts).slice(0, 60)).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    // What is held is counted, whatever one request names.
    const room = MAX_AGENT_ELSEWHERE - Object.keys((await agentOf(alice)).accounts ?? {}).length;
    const filled = await record(
      fromPages(alice),
      Object.fromEntries(Array.from({ length: room }, (_, index) => [`more-${index}`, "x"])),
    );
    expect(filled.status).toBe(200);
    const over = await record(fromPages(alice), { "one-more": "x" });
    expect(over.status).toBe(409);
    expect(await errorOf(over)).toBe("agent.too_many_accounts");
    // One taken away makes room for one, in the same request.
    expect((await record(fromPages(alice), { "more-0": null, "one-more": "x" })).status).toBe(200);
    // A name is words: what it holds is answered as it was written, as data.
    const odd = await record(fromPages(alice), { "one-more": '<img src=x onerror="alert(1)">' });
    expect(restAgentSchema.parse(await odd.json()).accounts?.["one-more"]).toBe(
      '<img src=x onerror="alert(1)">',
    );
  });
});
