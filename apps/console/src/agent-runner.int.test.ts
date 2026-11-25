import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  MAX_RUNNER_LINE_LENGTH,
  MAX_RUNNER_OFFERS,
  MAX_SIGNAL_ATTACHMENTS,
  MAX_SIGNAL_LENGTH,
  REST_ROUTES,
  restAgentSchema,
  restAgentsSchema,
  restClaimSchema,
  restConnectionSchema,
  restErrorSchema,
  restEventsSchema,
  restRunnerHeartbeatSchema,
  restSignalSchema,
  restSignalsSchema,
  restTokenCreatedSchema,
  restWritersSchema,
} from "@skillcdn/console/api";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { noteUnheardRunners } from "./db/queries/agent-runners.js";
import { putMessengerAccount, removeMessengerAccount } from "./db/queries/messenger-accounts.js";
import { purgeInstall } from "./db/queries/plugins.js";
import { people, pluginInstalls } from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { RUNNER_UNHEARD_MS, RunnerWatch } from "./jobs/runner-watch.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// What passes between the console and an agent account's runner (ADR-0085, docs/specs/runner.md):
// the heartbeat, which says how the agent stands; the signals its supervisors send, a record
// numbered per account; the stream its runner receives them on; and the note of a runner not
// heard from. On a database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let mira: string;
/** The secret of Mira's command, signed in as the account itself: her runner's one credential. */
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

const RUNNER = agentPath("me", "runner");
const SIGNALS = agentPath("mira", "signals");
const OWN_SIGNALS = agentPath("me", "signals");
const STREAM = agentPath("me", "signals", "stream");

/** A heartbeat as a runner sends one. */
const beat = (over: Record<string, unknown> = {}) => ({
  state: "running",
  reason: "started",
  delivered: 0,
  session: null,
  machine: { name: "mac-mini", os: "macOS 15.1", user: "mira" },
  runner: "0.5.0",
  product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
  offers: {
    models: ["opus", "sonnet"],
    efforts: ["low", "medium", "high"],
    steer: true,
    images: true,
    resume: true,
  },
  running: { model: null, effort: null },
  ...over,
});
const heartbeat = async (over: Record<string, unknown> = {}) =>
  restRunnerHeartbeatSchema.parse(
    await (await send(bearer(command), "PUT", RUNNER, beat(over))).json(),
  );
const signal = async (headers: Record<string, string>, body: unknown) =>
  restSignalSchema.parse(await (await send(headers, "POST", SIGNALS, body)).json());
/** How the workspace's feed tells of the agent's states, oldest first: who said so, and what. */
const stateEvents = async () =>
  restEventsSchema
    .parse(await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json())
    .items.filter((event) => event.kind === "agent.state_changed")
    .map((event) => ({
      by: event.actor?.login ?? null,
      state: event.data.state,
      was: event.data.was,
      detail: event.data.detail,
    }));
const agentOf = async (headers: Record<string, string>) =>
  restAgentSchema.parse(await (await get(headers, agentPath("mira"))).json());

/** A command signed in as whoever the cookie carries: the secret of its session. */
async function commandOf(cookie: string): Promise<string> {
  const begun = await send({}, "POST", REST_ROUTES.connect, { agent: "console", as: "self" });
  const connection = restConnectionSchema.parse(await begun.json());
  await send(fromPages(cookie), "POST", connectPath(connection.code, "approve"));
  const claim = restClaimSchema.parse(
    await (await send({}, "POST", CLAIM_PATH, { secret: connection.secret })).json(),
  );
  if (claim.status !== "signed_in") {
    throw new Error("the command was not signed in");
  }
  return claim.secret;
}

/** Reads an SSE stream a chunk at a time and hands back what it has seen so far. */
function tail(response: Response) {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("no body to read");
  }
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  return {
    /** Waits until the stream has carried `predicate` true, or it ended, or the deadline passes. */
    async until(predicate: (text: string) => boolean, timeoutMs = 5000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(text) && !ended) {
        if (Date.now() > deadline) {
          throw new Error(`the stream did not carry what was waited for:\n${text}`);
        }
        const { done, value, timedOut } = await Promise.race([
          reader.read().then((read) => ({ ...read, timedOut: false })),
          new Promise<{ done: true; value: undefined; timedOut: true }>((resolve) =>
            setTimeout(
              () => resolve({ done: true, value: undefined, timedOut: true }),
              deadline - Date.now(),
            ),
          ),
        ]);
        if (value !== undefined) {
          text += decoder.decode(value, { stream: true });
        } else if (done) {
          ended = !timedOut;
          break;
        }
      }
      return text;
    },
    cancel: () => reader.cancel(),
    /** Whether the server ended the stream, as against the deadline passing. */
    get ended() {
      return ended;
    },
  };
}

/** The signals a stream carried, parsed, each with the id it was sent under. */
const signalsOf = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => block.includes("data:"))
    .map((block) => ({
      id: Number(/^id: (\d+)$/m.exec(block)?.[1]),
      event: /^event: (.*)$/m.exec(block)?.[1],
      signal: restSignalSchema.parse(JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "")),
    }));

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice", "bob"],
    live: true,
    feed: { heartbeatMs: 300, pollMs: 60_000 },
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  // Alice makes the account, and is whom it reports to: its supervisor. Bob sees it and is none.
  await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "gh",
    login: "carol",
    handle: "mira",
    name: "Mira",
    project: "ops",
  });
  mira = await h.signIn("carol");
  command = await commandOf(mira);
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

describe("an agent account's runner (ADR-0085)", () => {
  it("says how its agent stands with a heartbeat, on the account's command and nothing else", async () => {
    // Before any runner said anything, the console says nothing of how the agent stands.
    expect((await agentOf({ cookie: alice })).state).toBeNull();

    const first = await send(bearer(command), "PUT", RUNNER, beat());
    expect(first.status).toBe(200);
    expect(restRunnerHeartbeatSchema.parse(await first.json())).toEqual({
      latest: 0,
      delivered: 0,
      settings: { model: null, effort: null },
      state: "running",
    });
    // The workspace is told once, by the account, whose runner said so; a heartbeat that says
    // the same again tells nothing new.
    await heartbeat({ reason: "resumed", delivered: 0 });
    expect(await stateEvents()).toEqual([
      { by: "carol", state: "running", was: null, detail: "started" },
    ]);

    // Neither the account's browser nor a token it made is its runner; a person has none.
    const browser = await send(fromPages(mira), "PUT", RUNNER, beat());
    expect(browser.status).toBe(403);
    expect(await errorOf(browser)).toBe("agent.own_command");
    const made = await send(fromPages(mira), "POST", REST_ROUTES.tokens, { name: "a helper" });
    const token = restTokenCreatedSchema.parse(await made.json()).secret;
    const helper = await send(bearer(token), "PUT", RUNNER, beat());
    expect(helper.status).toBe(403);
    expect(await errorOf(helper)).toBe("agent.own_command");
    const person = await send(bearer(await commandOf(bob)), "PUT", RUNNER, beat());
    expect(person.status).toBe(404);
    expect(await errorOf(person)).toBe("agent.not_found");
    expect((await send({}, "PUT", RUNNER, beat())).status).toBe(401);
  });

  it("answers the state to whoever sees the account, and the runner to its supervisors and itself", async () => {
    const supervised = await agentOf({ cookie: alice });
    expect(supervised.state).toMatchObject({ state: "running", reason: "resumed" });
    expect(supervised.state?.heardAt).not.toBeNull();
    expect(supervised.runner).toMatchObject({
      delivered: 0,
      latest: 0,
      session: null,
      machine: { name: "mac-mini", os: "macOS 15.1", user: "mira" },
      runner: "0.5.0",
      product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
      offers: { models: ["opus", "sonnet"], efforts: ["low", "medium", "high"], steer: true },
      running: { model: null, effort: null },
      settings: { model: null, effort: null },
    });
    // Bob sees the account and how it stands, and nothing of where it runs.
    const beside = await agentOf({ cookie: bob });
    expect(beside.supervised).toBe(false);
    expect(beside.state?.state).toBe("running");
    expect(beside.runner).toBeNull();
    const listed = restAgentsSchema.parse(
      await (await get({ cookie: bob }, REST_ROUTES.agents)).json(),
    );
    expect(
      listed.items.map((item) => [item.person.handle, item.state?.state, item.runner]),
    ).toEqual([["mira", "running", null]]);
    // The account reads its own.
    expect((await agentOf(bearer(command))).runner?.machine?.name).toBe("mac-mini");
  });

  it("keeps how the runner's wake sources stand, as it last said, for its supervisors and itself (ADR-0144)", async () => {
    const since = "2026-11-20T08:32:00.000Z";
    // A runner of before says none, and the account's line holds none.
    expect((await agentOf({ cookie: alice })).runner?.sources).toBeUndefined();
    await heartbeat({
      reason: "resumed",
      sources: [
        {
          name: "slack",
          state: "waiting",
          since,
          why: "no slack.app_token in the account's store",
        },
      ],
    });
    expect((await agentOf({ cookie: alice })).runner?.sources).toEqual([
      { name: "slack", state: "waiting", since, why: "no slack.app_token in the account's store" },
    ]);
    await heartbeat({ reason: "resumed", sources: [{ name: "slack", state: "connected", since }] });
    expect((await agentOf(bearer(command))).runner?.sources).toEqual([
      { name: "slack", state: "connected", since },
    ]);
    // Whoever is no supervisor reads nothing of the runner, its sources among it.
    expect((await agentOf({ cookie: bob })).runner).toBeNull();
    // What it says is data: a name of a module, a state of the three, a moment, a line.
    for (const sources of [
      [{ name: "Slack!", state: "connected", since }],
      [{ name: "slack", state: "listening", since }],
      [{ name: "slack", state: "connected", since: "yesterday" }],
      [{ name: "slack", state: "failing", since, why: "x".repeat(400) }],
      Array.from({ length: 11 }, (_, index) => ({ name: `s${index}`, state: "connected", since })),
    ]) {
      const refused = await send(bearer(command), "PUT", RUNNER, beat({ sources }));
      expect(refused.status, JSON.stringify(sources).slice(0, 60)).toBe(400);
    }
    // A runner that says none again, one of before among them, leaves none standing.
    await heartbeat({ reason: "resumed" });
    expect((await agentOf({ cookie: alice })).runner?.sources).toBeUndefined();
  });

  it("keeps what the product said of its allowance, a window at a time, for whoever sees the account (ADR-0156)", async () => {
    const said = new Date().toISOString();
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const week = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    // A runner of before says none, and nothing is answered.
    expect((await agentOf({ cookie: alice })).usage).toBeUndefined();
    await heartbeat({
      reason: "resumed",
      usage: [
        { name: "5-hour", used: 0.42, resetsAt: soon, at: said },
        { name: "weekly", used: 0.13, resetsAt: week, at: said },
      ],
    });
    const windows = [
      { name: "5-hour", used: 0.42, resetsAt: soon, at: said },
      { name: "weekly", used: 0.13, resetsAt: week, at: said },
    ];
    // Whoever sees the account reads it, a member who supervises nothing among them: it says
    // whom work can be given to now, as how the account stands does.
    expect((await agentOf({ cookie: bob })).usage).toEqual(windows);
    expect((await agentOf({ cookie: bob })).runner).toBeNull();
    expect((await agentOf(bearer(command))).usage).toEqual(windows);
    const listed = restAgentsSchema.parse(
      await (await get({ cookie: bob }, REST_ROUTES.agents)).json(),
    );
    expect(listed.items[0]?.usage).toEqual(windows);
    // A product says a window at a time: the one named takes the place of the one kept under
    // its name, and the other stands while its reset is still to come.
    const later = new Date(Date.now() + 1000).toISOString();
    await heartbeat({
      reason: "resumed",
      usage: [{ name: "5-hour", used: 0.9, resetsAt: soon, near: true, at: later }],
    });
    expect((await agentOf({ cookie: alice })).usage).toEqual([
      { name: "5-hour", used: 0.9, resetsAt: soon, near: true, at: later },
      { name: "weekly", used: 0.13, resetsAt: week, at: said },
    ]);
    // A heartbeat that says nothing of it, a runner of before, takes nothing away.
    await heartbeat({ reason: "resumed" });
    expect((await agentOf({ cookie: alice })).usage).toHaveLength(2);
    // One that names no window keeps what is still to reset, and lets go what never said when.
    await heartbeat({
      reason: "resumed",
      usage: [{ name: "primary", used: null, resetsAt: null, near: true, at: later }],
    });
    expect((await agentOf({ cookie: alice })).usage?.map((window) => window.name)).toEqual([
      "primary",
      "5-hour",
      "weekly",
    ]);
    await heartbeat({ reason: "resumed", usage: [] });
    expect((await agentOf({ cookie: alice })).usage?.map((window) => window.name)).toEqual([
      "5-hour",
      "weekly",
    ]);
    // What it says is data: a name on one line, a share from 0 to 1, moments, and no more
    // windows than a product has.
    for (const usage of [
      [{ name: "", used: 0.1, resetsAt: soon, at: said }],
      [{ name: "x".repeat(41), used: 0.1, resetsAt: soon, at: said }],
      [{ name: "5-hour\n<script>", used: 0.1, resetsAt: soon, at: said }],
      [{ name: `5-hour${String.fromCodePoint(0x202e)}`, used: 0.1, resetsAt: soon, at: said }],
      [{ name: "5-hour", used: 1.5, resetsAt: soon, at: said }],
      [{ name: "5-hour", used: -0.1, resetsAt: soon, at: said }],
      [{ name: "5-hour", used: "half", resetsAt: soon, at: said }],
      [{ name: "5-hour", used: 0.1, resetsAt: "tomorrow", at: said }],
      [{ name: "5-hour", used: 0.1, resetsAt: soon }],
      [{ name: "5-hour", used: 0.1, resetsAt: soon, near: "yes", at: said }],
      Array.from({ length: 9 }, (_, index) => ({
        name: `w${index}`,
        used: 0.1,
        resetsAt: soon,
        at: said,
      })),
      "all of it",
    ]) {
      const refused = await send(bearer(command), "PUT", RUNNER, beat({ usage }));
      expect(refused.status, JSON.stringify(usage).slice(0, 60)).toBe(400);
    }
    // What was said of one product's allowance says nothing of another's: a runner that says
    // another product begins with none, whether or not it says any usage with it.
    await heartbeat({
      reason: "resumed",
      product: { driver: "codex", name: "Codex", version: "0.171.0", tried: true },
    });
    expect((await agentOf({ cookie: alice })).usage).toBeUndefined();
    await heartbeat({
      reason: "resumed",
      usage: [
        { name: "5-hour", used: 0.3, resetsAt: soon, at: said },
        { name: "5-hour", used: 0.8, resetsAt: soon, at: said },
      ],
    });
    // A name is kept once, as it was first said.
    expect((await agentOf({ cookie: alice })).usage).toEqual([
      { name: "5-hour", used: 0.3, resetsAt: soon, at: said },
    ]);
    // A window whose reset has passed is let go when the runner next says its windows.
    await heartbeat({
      reason: "resumed",
      usage: [{ name: "weekly", used: 0.2, resetsAt: past, at: said }],
    });
    await heartbeat({ reason: "resumed", usage: [] });
    expect((await agentOf({ cookie: alice })).usage?.map((window) => window.name)).toEqual([
      "5-hour",
    ]);
  });

  it("takes a heartbeat as data: bounded, of the words it knows, and nothing else", async () => {
    const refused = async (body: unknown) => {
      const response = await send(bearer(command), "PUT", RUNNER, body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    };
    // `unheard` is the console's word, never the runner's.
    await refused(beat({ state: "unheard", reason: "no_heartbeat" }));
    await refused(beat({ reason: "because I said so" }));
    await refused(beat({ delivered: -1 }));
    await refused(beat({ session: "not-an-id" }));
    await refused(
      beat({ machine: { name: "m".repeat(MAX_RUNNER_LINE_LENGTH + 1), os: "x", user: "y" } }),
    );
    // A line is one line, with nothing in it that hides.
    await refused(beat({ runner: `0.5.0${String.fromCodePoint(0x202e)}` }));
    await refused(beat({ runner: "0.5.0\n<script>" }));
    await refused(
      beat({
        offers: {
          models: Array.from({ length: MAX_RUNNER_OFFERS + 1 }, (_, index) => `m${index}`),
          efforts: [],
          steer: true,
          images: true,
          resume: true,
        },
      }),
    );
    await refused(
      beat({
        offers: { models: ["<img src=x>"], efforts: [], steer: true, images: true, resume: true },
      }),
    );
    await refused({});
    await refused([beat()]);
    const unreadable = await h.request(RUNNER, {
      method: "PUT",
      headers: { ...bearer(command), ...JSON_HEADERS },
      body: "{",
    });
    expect(unreadable.status).toBe(400);
    const large = await send(
      bearer(command),
      "PUT",
      RUNNER,
      beat({ padding: "x".repeat(70 * 1024) }),
    );
    expect(large.status).toBe(413);
    // Nothing of it changed how the agent stands.
    expect((await agentOf({ cookie: alice })).state?.state).toBe("running");
  });

  it("numbers the signals a supervisor sends, with who sent them, and keeps them off the board's feed", async () => {
    const told = await send(fromPages(alice), "POST", SIGNALS, {
      kind: "tell",
      text: "  Hold the release until the migration is checked.  ",
    });
    expect(told.status).toBe(201);
    expect(restSignalSchema.parse(await told.json())).toMatchObject({
      number: 1,
      kind: "tell",
      by: { login: "Alice" },
      agent: null,
      plugin: null,
      source: "person",
      key: null,
      text: "Hold the release until the migration is checked.",
      set: null,
      attachments: [],
    });
    // Through an agent of the supervisor's own, which the signal names (ADR-0021, ADR-0056).
    const made = await send(fromPages(alice), "POST", REST_ROUTES.tokens, { name: "Claude Code" });
    const alicesAgent = restTokenCreatedSchema.parse(await made.json()).secret;
    expect(await signal(bearer(alicesAgent), { kind: "wake" })).toMatchObject({
      number: 2,
      kind: "wake",
      by: { login: "Alice" },
      agent: "Claude Code",
      text: "",
    });
    // The heartbeat is answered where the record stands, and what the console has as delivered:
    // the most it was ever told, for a runner that lost its own count.
    expect(await heartbeat({ delivered: 1 })).toMatchObject({ latest: 2, delivered: 1 });
    expect((await heartbeat({ delivered: 0 })).delivered).toBe(1);
    expect((await agentOf({ cookie: alice })).runner).toMatchObject({ delivered: 1, latest: 2 });

    // Only a supervisor sends one; from a browser, from the console's own pages.
    const beside = await send(fromPages(bob), "POST", SIGNALS, { kind: "tell", text: "Hello" });
    expect(beside.status).toBe(403);
    expect(await errorOf(beside)).toBe("auth.forbidden");
    const elsewhere = await send({ cookie: alice }, "POST", SIGNALS, { kind: "wake" });
    expect(elsewhere.status).toBe(403);
    expect(await errorOf(elsewhere)).toBe("auth.forbidden_origin");
    const nobody = await send(fromPages(alice), "POST", agentPath("nobody", "signals"), {
      kind: "wake",
    });
    expect(nobody.status).toBe(404);
    // The account is not its own supervisor.
    const own = await send(bearer(command), "POST", SIGNALS, { kind: "tell", text: "To myself" });
    expect(own.status).toBe(403);

    // What is sent is read by schema: a tell needs words, a kind is one of the seven, words are bounded.
    for (const body of [
      { kind: "tell" },
      { kind: "tell", text: "   " },
      { kind: "shout", text: "Hey" },
      { kind: "tell", text: "x".repeat(MAX_SIGNAL_LENGTH + 1) },
      { kind: "tell", text: `Fine${String.fromCodePoint(0x202e)}` },
      { kind: "set" },
      { kind: "set", set: {} },
      { kind: "set", set: { model: "--dangerously" } },
      { text: "No kind" },
    ]) {
      const response = await send(fromPages(alice), "POST", SIGNALS, body);
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    }

    // The record, the newest first, for its supervisors and for the account itself.
    const record = restSignalsSchema.parse(await (await get({ cookie: alice }, SIGNALS)).json());
    expect(record.items.map((item) => [item.number, item.kind])).toEqual([
      [2, "wake"],
      [1, "tell"],
    ]);
    expect(record.more).toBe(false);
    // With how far the record is delivered, as the runner last said: the first, not the second.
    expect(record.delivered).toBe(1);
    const page = restSignalsSchema.parse(
      await (await get({ cookie: alice }, `${SIGNALS}?limit=1`)).json(),
    );
    expect(page.items.map((item) => item.number)).toEqual([2]);
    expect(page.more).toBe(true);
    const before = restSignalsSchema.parse(
      await (await get({ cookie: alice }, `${SIGNALS}?before=2`)).json(),
    );
    expect(before.items.map((item) => item.number)).toEqual([1]);
    for (const query of [
      "limit=0",
      "limit=1000",
      "limit=x",
      "before=0",
      "before=1.5",
      "before=3000000000",
    ]) {
      expect((await get({ cookie: alice }, `${SIGNALS}?${query}`)).status, query).toBe(400);
    }
    expect((await get({ cookie: bob }, SIGNALS)).status).toBe(403);
    for (const headers of [bearer(command), { cookie: mira }]) {
      const mine = restSignalsSchema.parse(await (await get(headers, OWN_SIGNALS)).json());
      expect(mine.items.map((item) => item.number)).toEqual([2, 1]);
      expect(mine.delivered).toBe(1);
    }
    expect((await get({ cookie: bob }, OWN_SIGNALS)).status).toBe(404);

    // A signal is the account's, not the board's: the feed carries none of it.
    const events = await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).text();
    expect(events).not.toContain("Hold the release");
  });

  it("keeps the model and the effort chosen for it, among those its runner offered", async () => {
    const chosen = await signal(fromPages(alice), { kind: "set", set: { model: "opus" } });
    expect(chosen).toMatchObject({ number: 3, kind: "set", set: { model: "opus", effort: null } });
    // A field left out stays as it is; `null` is the product's own again.
    expect((await signal(fromPages(alice), { kind: "set", set: { effort: "high" } })).set).toEqual({
      model: "opus",
      effort: "high",
    });
    expect((await heartbeat()).settings).toEqual({ model: "opus", effort: "high" });
    // A runner that offers nothing to choose from takes nothing away.
    const offers = { steer: false, images: false, resume: true };
    expect((await heartbeat({ offers: { ...offers, models: [], efforts: [] } })).settings).toEqual({
      model: "opus",
      effort: "high",
    });
    // What was chosen is kept while the product offers it: a runner that says another product
    // since, a desk whose driver changed, offers other models, and one it does not offer is the
    // product's own again, where a level it still offers stays. Its runner is answered so, and
    // hands the product no model it would refuse at every turn.
    const other = { ...offers, models: ["gpt-6-luna"], efforts: ["low", "high"] };
    expect((await heartbeat({ offers: other })).settings).toEqual({ model: null, effort: "high" });
    expect((await agentOf({ cookie: alice })).runner?.settings).toEqual({
      model: null,
      effort: "high",
    });
    // And it does not come back with the product that offered it.
    expect((await heartbeat()).settings).toEqual({ model: null, effort: "high" });
    expect((await signal(fromPages(alice), { kind: "set", set: { model: null } })).set).toEqual({
      model: null,
      effort: "high",
    });
    expect((await agentOf({ cookie: alice })).runner?.settings).toEqual({
      model: null,
      effort: "high",
    });
    // What the product does not offer is refused, and changes nothing.
    for (const set of [{ model: "gpt" }, { effort: "max" }, { model: "opus", effort: "max" }]) {
      const refused = await send(fromPages(alice), "POST", SIGNALS, { kind: "set", set });
      expect(refused.status).toBe(400);
      expect(await errorOf(refused)).toBe("signal.not_offered");
    }
    expect((await heartbeat()).latest).toBe(5);
  });

  it("is stopped by a supervisor at once, and stays so until a restart, whatever the runner says", async () => {
    const stopped = await signal(fromPages(alice), { kind: "stop", text: "Wait for the review." });
    expect(stopped).toMatchObject({ number: 6, kind: "stop", text: "Wait for the review." });
    expect((await agentOf({ cookie: bob })).state).toMatchObject({
      state: "stopped",
      reason: "stop",
    });
    // The runner may not have received it yet: its heartbeat is answered how the console has it.
    expect((await heartbeat()).state).toBe("stopped");
    expect((await heartbeat({ state: "refused", reason: "model_refused" })).state).toBe("stopped");
    // A second stop stops nothing more.
    await signal(fromPages(alice), { kind: "stop" });
    expect((await stateEvents()).slice(1)).toEqual([
      { by: "Alice", state: "stopped", was: "running", detail: "stop" },
    ]);

    // A restart takes the stop away; the agent is as its runner next says.
    await signal(fromPages(alice), { kind: "restart" });
    expect((await agentOf({ cookie: alice })).state?.state).toBe("stopped");
    expect((await heartbeat({ reason: "resumed" })).state).toBe("running");
    // And a reset does the same of a stop.
    await signal(fromPages(alice), { kind: "stop" });
    await signal(fromPages(alice), { kind: "reset", text: "Start over from the board." });
    expect((await heartbeat({ state: "refused", reason: "model_refused" })).state).toBe("refused");
    expect((await stateEvents()).slice(2)).toEqual([
      { by: "carol", state: "running", was: "stopped", detail: "resumed" },
      { by: "Alice", state: "stopped", was: "running", detail: "stop" },
      { by: "carol", state: "refused", was: "stopped", detail: "model_refused" },
    ]);
  });

  it("streams the signals to the runner from where it left off, as they are sent", async () => {
    const latest = (await heartbeat()).latest;
    const stream = await h.request(`${STREAM}?after=${latest - 2}`, {
      headers: { ...bearer(command), accept: "text/event-stream" },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reading = tail(stream);
    // What was sent after the number comes first, in order, each under its number.
    const seen = signalsOf(await reading.until((text) => text.includes(`id: ${latest}`)));
    expect(seen.map((entry) => [entry.id, entry.event, entry.signal.number])).toEqual([
      [latest - 1, "signal", latest - 1],
      [latest, "signal", latest],
    ]);

    const told = await signal(fromPages(alice), { kind: "interrupt", text: "Stop that turn." });
    const text = await reading.until((carried) => carried.includes(`id: ${told.number}`));
    expect(signalsOf(text).at(-1)?.signal).toMatchObject({
      number: latest + 1,
      kind: "interrupt",
      by: { login: "Alice" },
      text: "Stop that turn.",
    });
    await reading.until((carried) => carried.includes(": ping"));
    await reading.cancel();

    // Where the runner says it was wins over the query, as a connection made again says it.
    const again = await h.request(`${STREAM}?after=0`, {
      headers: { ...bearer(command), "last-event-id": String(latest) },
    });
    const resumed = tail(again);
    expect(
      signalsOf(await resumed.until((carried) => carried.includes("data:"))).map(
        (entry) => entry.id,
      ),
    ).toEqual([latest + 1]);
    await resumed.cancel();

    // The stream is the runner's alone.
    const browser = await get({ cookie: mira }, `${STREAM}?after=0`);
    expect(browser.status).toBe(403);
    expect(await errorOf(browser)).toBe("agent.own_command");
    expect((await get({ cookie: alice }, `${STREAM}?after=0`)).status).toBe(404);
    expect((await get({}, `${STREAM}?after=0`)).status).toBe(401);
    for (const after of ["-1", "x", "1.5", "3000000000"]) {
      expect((await get(bearer(command), `${STREAM}?after=${after}`)).status, after).toBe(400);
    }
  });

  it("holds what a runner says it took to what it was sent, so that the next signal still comes", async () => {
    const before = await heartbeat();
    // A runner whose state was spoiled says it took two thousand million signals, and then more
    // than a column holds: the console keeps what was sent, and answers as it does any heartbeat.
    for (const delivered of [2_000_000_000, 9_000_000_000_000]) {
      const said = await send(bearer(command), "PUT", RUNNER, beat({ delivered }));
      expect(said.status, String(delivered)).toBe(200);
      expect(restRunnerHeartbeatSchema.parse(await said.json())).toMatchObject({
        latest: before.latest,
        delivered: before.latest,
      });
    }
    const told = await signal(fromPages(alice), { kind: "tell", text: "Still there?" });
    expect(told.number).toBe(before.latest + 1);
    const after = await heartbeat();
    expect(after).toMatchObject({ latest: told.number, delivered: before.latest });
    // A runner that begins from what the console says it took finds the signal on its stream.
    const reading = tail(
      await h.request(`${STREAM}?after=${after.delivered}`, { headers: bearer(command) }),
    );
    expect(
      signalsOf(await reading.until((text) => text.includes(`id: ${told.number}`))).at(-1)?.signal
        .text,
    ).toBe("Still there?");
    await reading.cancel();
  });

  it("ends a stream whose command was signed out", async () => {
    const other = await commandOf(mira);
    const stream = await h.request(`${STREAM}?after=0`, { headers: bearer(other) });
    const reading = tail(stream);
    await reading.until((text) => text.includes("id: 1"));
    expect((await send(bearer(other), "DELETE", REST_ROUTES.meToken)).status).toBe(204);
    // Asked again before the next look, the session is nobody's: the stream ends.
    await reading.until(() => false).catch(() => undefined);
    expect(reading.ended).toBe(true);
  });

  it("is noted as not heard from by the worker, by nobody, until its runner says again", async () => {
    await heartbeat({ reason: "completed" });
    const told = (await stateEvents()).length;
    // Heard from a moment ago: nothing to note.
    expect(
      await noteUnheardRunners(testDatabase.database, {
        before: new Date(Date.now() - RUNNER_UNHEARD_MS),
        now: new Date(),
      }),
    ).toBe(0);
    // Five minutes and more later, the worker's pass notes it, once.
    const later = { now: () => new Date(Date.now() + RUNNER_UNHEARD_MS + 60_000) };
    const watch = new RunnerWatch({
      database: testDatabase.database,
      clock: later,
      logger: pino({ level: "silent" }),
    });
    await watch.sweep();
    await watch.sweep();
    await watch.close();
    expect((await agentOf({ cookie: bob })).state).toMatchObject({
      state: "unheard",
      reason: "no_heartbeat",
    });
    expect((await stateEvents()).slice(told)).toEqual([
      { by: null, state: "unheard", was: "running", detail: "no_heartbeat" },
    ]);
    // The runner's next heartbeat says how the agent stands again.
    expect((await heartbeat({ reason: "resumed" })).state).toBe("running");
    expect((await stateEvents()).at(-1)).toEqual({
      by: "carol",
      state: "running",
      was: "unheard",
      detail: "resumed",
    });
  });

  it("carries the files a supervisor sends with a tell, read by the account's runner and its supervisors", async () => {
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
    const form = (signal: unknown, files: readonly [Uint8Array, string, string][]) => {
      const body = new FormData();
      if (signal !== undefined) {
        body.set("signal", JSON.stringify(signal));
      }
      for (const [bytes, name, type] of files) {
        body.append("file", new File([Uint8Array.from(bytes)], name, { type }));
      }
      return h.request(SIGNALS, { method: "POST", headers: fromPages(alice), body });
    };
    const CSV = new TextEncoder().encode("week,orders\n2026-W45,1297\n");
    const PAGE = new TextEncoder().encode("<script>alert(1)</script>");
    const DRAWING = new TextEncoder().encode("<svg onload=alert(1)>");
    const sent = await form({ kind: "tell", text: "Look at these." }, [
      [PNG, "screen.png", "image/png"],
      // What it is is read off its bytes, whatever the form called it.
      [GIF, "moving.bin", "application/octet-stream"],
      // A file that is no picture is carried as what its sender called it.
      [CSV, "export 2026-11.csv", "text/csv"],
      // What is called a picture and is none by its bytes is carried as bytes of no kind, so
      // that nothing shows it in place: a page with a script, a drawing that runs.
      [PAGE, "page.png", "image/png"],
      [DRAWING, "x.svg", "image/svg+xml"],
    ]);
    expect(sent.status).toBe(201);
    const told = restSignalSchema.parse(await sent.json());
    expect(told).toMatchObject({ kind: "tell", text: "Look at these." });
    expect(told.attachments).toMatchObject([
      { name: "screen.png", size: PNG.byteLength, contentType: "image/png" },
      { name: "moving.bin", size: GIF.byteLength, contentType: "image/gif" },
      { name: "export 2026-11.csv", size: CSV.byteLength, contentType: "text/csv" },
      { name: "page.png", size: PAGE.byteLength, contentType: "application/octet-stream" },
      { name: "x.svg", size: DRAWING.byteLength, contentType: "application/octet-stream" },
    ]);
    expect(JSON.stringify(told)).not.toContain("sha256");
    const [first, second, third, fourth, fifth] = told.attachments;
    const file = (number: number, id: string, who = "mira") =>
      agentPath(who, "signals", String(number), "files", id);

    // Its supervisors read them, shown in place and never run; and the account's runner, for the product.
    const read = await get({ cookie: alice }, file(told.number, first?.id ?? ""));
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(read.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
    const own = await get(bearer(command), file(told.number, second?.id ?? "", "me"));
    expect(own.headers.get("content-type")).toBe("image/gif");
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(GIF);
    // A file that is no picture is handed over as bytes to save, under its name, and shown
    // nowhere in place, whatever it was called.
    for (const [attachment, bytes, name] of [
      [third, CSV, "export 2026-11.csv"],
      [fourth, PAGE, "page.png"],
      [fifth, DRAWING, "x.svg"],
    ] as const) {
      for (const read of [
        await get({ cookie: alice }, file(told.number, attachment?.id ?? "")),
        await get(bearer(command), file(told.number, attachment?.id ?? "", "me")),
      ]) {
        expect(read.status, name).toBe(200);
        expect(read.headers.get("content-type"), name).toBe("application/octet-stream");
        expect(read.headers.get("content-disposition"), name).toBe(
          `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
        expect(read.headers.get("x-content-type-options")).toBe("nosniff");
        expect(read.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
        expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
      }
    }
    expect((await get({ cookie: bob }, file(told.number, first?.id ?? ""))).status).toBe(403);
    expect((await get({ cookie: bob }, file(told.number, first?.id ?? "", "me"))).status).toBe(404);
    // A picture is its own signal's, and nothing else's.
    expect((await get({ cookie: alice }, file(told.number - 1, first?.id ?? ""))).status).toBe(404);
    expect((await get({ cookie: alice }, file(told.number, "not-an-id"))).status).toBe(404);
    expect(
      (await get({ cookie: alice }, file(told.number, "0199c4d8-0000-7000-8000-00000000dead")))
        .status,
    ).toBe(404);

    // The record and the stream carry what was sent with it.
    const record = restSignalsSchema.parse(
      await (await get({ cookie: alice }, `${SIGNALS}?limit=1`)).json(),
    );
    expect(record.items[0]?.attachments).toEqual(told.attachments);
    const stream = await h.request(`${STREAM}?after=${told.number - 1}`, {
      headers: bearer(command),
    });
    const reading = tail(stream);
    const carried = signalsOf(await reading.until((text) => text.includes("data:")));
    expect(carried[0]?.signal.attachments).toEqual(told.attachments);
    await reading.cancel();

    // A few files, with a tell or an interrupt that has words, and what says which.
    for (const [signal, files] of [
      [
        { kind: "tell", text: "Too many." },
        Array.from({ length: MAX_SIGNAL_ATTACHMENTS + 1 }, () => [PNG, "a.png", "image/png"]),
      ],
      [{ kind: "tell", text: "Empty." }, [[new Uint8Array(), "empty.png", "image/png"]]],
      [{ kind: "tell", text: "A path." }, [[PNG, "../screen.png", "image/png"]]],
      [{ kind: "stop" }, [[PNG, "screen.png", "image/png"]]],
      [{ kind: "tell" }, [[PNG, "screen.png", "image/png"]]],
      [undefined, [[PNG, "screen.png", "image/png"]]],
    ] as [unknown, [Uint8Array, string, string][]][]) {
      const refused = await form(signal, files);
      expect(refused.status, JSON.stringify(signal)).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    const heavy = new Uint8Array(6 * 1024 * 1024);
    heavy.set(PNG);
    const large = await form({ kind: "tell", text: "Too large together." }, [
      [heavy, "a.png", "image/png"],
      [heavy, "b.png", "image/png"],
    ]);
    expect(large.status).toBe(413);
    // An interrupt carries them too; and none of what was refused is on the record.
    const interrupt = await form({ kind: "interrupt", text: "This instead." }, [
      [PNG, "this.png", "image/png"],
    ]);
    expect(restSignalSchema.parse(await interrupt.json()).number).toBe(told.number + 1);
  });

  it("takes a wake its own runner raises, from the messenger and from nowhere else", async () => {
    const raise = (headers: Record<string, string>, body: unknown) =>
      send(headers, "POST", OWN_SIGNALS, body);
    const wake = {
      kind: "wake",
      source: "messenger",
      key: "slack:C0OPS:1762800000.000100",
      text: "A mention at Slack, from the member U0TOM:\nCan you look?",
    };
    const raised = await raise(bearer(command), wake);
    expect(raised.status).toBe(201);
    // Recorded as any signal is, by nobody, under the next number of the account's record.
    const signal = restSignalSchema.parse(await raised.json());
    expect(signal).toMatchObject({
      kind: "wake",
      source: "messenger",
      key: "slack:C0OPS:1762800000.000100",
      by: null,
      agent: null,
      text: "A mention at Slack, from the member U0TOM:\nCan you look?",
    });
    const record = restSignalsSchema.parse(await (await get({ cookie: alice }, SIGNALS)).json());
    expect(record.items[0]?.number).toBe(signal.number);
    // A runner tells its own agent nothing in anyone's name: a wake alone, from the messenger alone.
    for (const body of [
      { ...wake, kind: "tell" },
      { ...wake, kind: "reset" },
      { ...wake, source: "person" },
      { ...wake, source: "board" },
      { ...wake, source: "console" },
      { ...wake, key: "" },
      { ...wake, key: "x".repeat(201) },
      { ...wake, key: "two\nlines" },
      { ...wake, text: "x".repeat(MAX_SIGNAL_LENGTH + 1) },
      { ...wake, by: { login: "Alice" } },
      { kind: "wake" },
      "wake",
    ]) {
      const refused = await raise(bearer(command), body);
      // A field the route does not read changes nothing of who is said to have sent it.
      if (refused.status === 201) {
        expect(restSignalSchema.parse(await refused.json()).by).toBeNull();
        continue;
      }
      expect(refused.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    // Only the account's own command raises one: not its browser, not its supervisor, nobody.
    const browser = await raise({ cookie: mira, origin: SIGN_IN_URL }, wake);
    expect(browser.status).toBe(403);
    expect(await errorOf(browser)).toBe("agent.own_command");
    expect((await raise(fromPages(alice), wake)).status).toBe(404);
    expect((await raise({}, wake)).status).not.toBe(201);
  });

  it("takes an interrupt with no words, which stops the turn so that what the agent was sent is read now", async () => {
    const wordless = await send(fromPages(alice), "POST", SIGNALS, { kind: "interrupt" });
    expect(wordless.status).toBe(201);
    expect(restSignalSchema.parse(await wordless.json())).toMatchObject({
      kind: "interrupt",
      text: "",
      attachments: [],
    });
    // A tell with none is still refused: it would tell the agent nothing.
    const silent = await send(fromPages(alice), "POST", SIGNALS, { kind: "tell" });
    expect(silent.status).toBe(400);
    expect(await errorOf(silent)).toBe("request.invalid");
  });

  it("keeps until when a usage limit stops the agent, as its runner said, and tells the feed (ADR-0150)", async () => {
    const until = "2026-11-20T18:30:00.000Z";
    await heartbeat({ reason: "resumed" });
    // A runner of before says no moment, and the account's line holds none.
    expect((await agentOf({ cookie: alice })).state?.until).toBeNull();
    await heartbeat({ state: "failed", reason: "usage_limit", until });
    // Whoever sees the account reads why it stands so and until when.
    expect((await agentOf({ cookie: bob })).state).toMatchObject({
      state: "failed",
      reason: "usage_limit",
      until,
    });
    // The feed is told with the moment, for whoever tells people when the agent is back.
    const told = restEventsSchema
      .parse(await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json())
      .items.filter((event) => event.kind === "agent.state_changed")
      .at(-1);
    expect(told?.data).toMatchObject({ state: "failed", detail: "usage_limit", until });
    // Told as the limit's moment moves, and not again while it stands: the week's window
    // refuses at the reset of the short one, and whoever tells people says the new moment.
    const stateChanges = async () =>
      restEventsSchema
        .parse(await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json())
        .items.filter((event) => event.kind === "agent.state_changed");
    const before = (await stateChanges()).length;
    await heartbeat({ state: "failed", reason: "usage_limit", until });
    expect(await stateChanges()).toHaveLength(before);
    const later = "2026-11-23T03:00:00.000Z";
    await heartbeat({ state: "failed", reason: "usage_limit", until: later });
    const moved = await stateChanges();
    expect(moved).toHaveLength(before + 1);
    expect(moved.at(-1)?.data).toMatchObject({
      state: "failed",
      was: "failed",
      detail: "usage_limit",
      until: later,
    });
    // A moment is data: an instant, or nothing.
    for (const moment of ["3am", 1795458600, "2026-11-20"]) {
      const refused = await send(bearer(command), "PUT", RUNNER, beat({ until: moment }));
      expect(refused.status, String(moment)).toBe(400);
    }
    // The agent is back: the next heartbeat says no moment, and none stands.
    await heartbeat({ reason: "resumed" });
    expect((await agentOf({ cookie: alice })).state).toMatchObject({
      state: "running",
      until: null,
    });
  });
});

describe("a new conversation an agent account begins for itself (ADR-0154)", () => {
  const OWN_RESET = agentPath("me", "reset");
  /** The resets on the account's record, the oldest first: who sent each, and what it says. */
  const resets = async () =>
    restSignalsSchema
      .parse(await (await get({ cookie: alice }, `${SIGNALS}?limit=100`)).json())
      .items.filter((one) => one.kind === "reset")
      .map((one) => ({ by: one.by?.login ?? null, source: one.source, text: one.text }))
      .reverse();

  it("is a reset of its record that the account itself sent, with why, on its command or from the console's own pages", async () => {
    await signal(fromPages(alice), { kind: "restart" });
    await heartbeat({ reason: "resumed" });
    const before = await resets();
    const asked = await send(bearer(command), "POST", OWN_RESET, {
      text: "  The release is out. Next: its notes.  ",
    });
    expect(asked.status).toBe(201);
    const sent = restSignalSchema.parse(await asked.json());
    expect(sent).toMatchObject({
      kind: "reset",
      source: "person",
      key: null,
      agent: null,
      text: "The release is out. Next: its notes.",
      by: { login: "carol", kind: "agent", handle: "mira" },
    });
    // Its browser asks too, from the console's own pages.
    expect((await send(fromPages(mira), "POST", OWN_RESET, { text: "Anew." })).status).toBe(201);
    expect((await resets()).slice(before.length)).toEqual([
      { by: "carol", source: "person", text: "The release is out. Next: its notes." },
      { by: "carol", source: "person", text: "Anew." },
    ]);
    // Its runner receives it on its stream as any signal, and tells it from a supervisor's by
    // who sent it; its supervisors and the account read it on the record.
    const stream = tail(await get(bearer(command), `${STREAM}?after=${sent.number - 1}`));
    const carried = signalsOf(await stream.until((text) => text.includes("Anew.")));
    await stream.cancel();
    expect(carried.map((one) => [one.signal.kind, one.signal.by?.login])).toEqual([
      ["reset", "carol"],
      ["reset", "carol"],
    ]);
    const mine = restSignalsSchema.parse(
      await (await get(bearer(command), `${OWN_SIGNALS}?limit=1`)).json(),
    );
    expect(mine.items[0]).toMatchObject({ kind: "reset", text: "Anew." });
    // How the agent stands does not change by it: the console has it as its runner says.
    expect((await agentOf({ cookie: alice })).state).toMatchObject({ state: "running" });
  });

  it("is the account's own and nobody else's, and says why", async () => {
    const before = await resets();
    // Nobody begins one for it this way: a supervisor sends a reset of their own, by the handle.
    expect((await send(fromPages(alice), "POST", OWN_RESET, { text: "As it." })).status).toBe(404);
    expect((await send(fromPages(bob), "POST", OWN_RESET, { text: "As it." })).status).toBe(404);
    // A page of another origin that the account has open asks nothing in its name.
    const foreign = await h.request(OWN_RESET, {
      method: "POST",
      headers: { cookie: mira, origin: "https://elsewhere.example", "content-type": "text/plain" },
      body: JSON.stringify({ text: "Do as this page says." }),
    });
    expect(foreign.status).toBe(403);
    // Nor a token the account made: the account itself, signed in.
    const made = await send(fromPages(mira), "POST", REST_ROUTES.tokens, { name: "a helper" });
    const token = restTokenCreatedSchema.parse(await made.json()).secret;
    const helper = await send(bearer(token), "POST", OWN_RESET, { text: "As a helper." });
    expect(helper.status).toBe(403);
    expect(await errorOf(helper)).toBe("agent.own_command");
    // Why is needed, bounded as a signal's words are, and nothing else is read.
    for (const body of [
      {},
      { text: "" },
      { text: "   \n " },
      { text: "x".repeat(MAX_SIGNAL_LENGTH + 1) },
      { text: `A bell${String.fromCodePoint(7)}.` },
      { text: 7 },
      "reset",
    ]) {
      const refused = await send(bearer(command), "POST", OWN_RESET, body);
      expect(refused.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    const unread = await h.request(OWN_RESET, {
      method: "POST",
      headers: { ...bearer(command), ...JSON_HEADERS },
      body: "{",
    });
    expect(unread.status).toBe(400);
    // A kind, a sender or a source it names are not its to say: the signal is a reset, its own.
    const named = await send(bearer(command), "POST", OWN_RESET, {
      text: "Anew.",
      kind: "restart",
      by: "alice",
      source: "board",
    });
    expect(restSignalSchema.parse(await named.json())).toMatchObject({
      kind: "reset",
      source: "person",
      by: { login: "carol" },
    });
    expect((await resets()).slice(before.length)).toEqual([
      { by: "carol", source: "person", text: "Anew." },
    ]);
  });

  it("changes nothing of a supervisor's stop: refused while one stands, and it takes none away", async () => {
    await signal(fromPages(alice), { kind: "stop", text: "Wait for the review." });
    const before = await resets();
    const refused = await send(bearer(command), "POST", OWN_RESET, { text: "Begin anew." });
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("agent.stopped");
    expect((await send(fromPages(mira), "POST", OWN_RESET, { text: "Begin anew." })).status).toBe(
      409,
    );
    // Nothing was recorded, and the agent is stopped still, whatever its runner says.
    expect(await resets()).toEqual(before);
    expect((await heartbeat()).state).toBe("stopped");
    expect((await agentOf({ cookie: alice })).state).toMatchObject({ state: "stopped" });
    // A supervisor starts it again, and from then on it begins anew for itself as before.
    await signal(fromPages(alice), { kind: "restart" });
    expect((await heartbeat({ reason: "resumed" })).state).toBe("running");
    expect((await send(bearer(command), "POST", OWN_RESET, { text: "Now." })).status).toBe(201);
    expect((await heartbeat({ reason: "resumed" })).state).toBe("running");
  });
});

describe("who wrote at a messenger, as the console answers an agent account (ADR-0164)", () => {
  const WRITERS = agentPath("me", "writers");
  const ask = (headers: Record<string, string>, body: unknown) =>
    send(headers, "POST", WRITERS, body);
  const asked = async (accounts: readonly { workspace: string; account: string }[]) =>
    restWritersSchema.parse(
      await (await ask(bearer(command), { messenger: "slack", accounts })).json(),
    ).items;
  const one = async (account: string, workspace = "T0ACME") =>
    (await asked([{ workspace, account }]))[0];
  let workspaceId: string;
  const ids = new Map<string, string>();
  const now = new Date("2026-03-02T09:00:00.000Z");
  const install = (key: string, state: string, consent: string[]) =>
    drizzleOf(testDatabase.database)
      .insert(pluginInstalls)
      .values({
        workspaceId,
        key,
        packageName: `console-plugin-${key}`,
        version: "1.0.0",
        state,
        consent,
      })
      .onConflictDoUpdate({
        target: [pluginInstalls.workspaceId, pluginInstalls.key],
        set: { state, consent },
      });
  const put = (plugin: string, login: string, account: string, team = "T0ACME") =>
    putMessengerAccount(testDatabase.database, {
      workspaceId,
      plugin,
      messenger: "slack",
      team,
      account,
      personId: ids.get(login) ?? "",
      actor: undefined,
      most: 100,
      now,
    });

  beforeAll(async () => {
    const rows = await drizzleOf(testDatabase.database)
      .select({ id: people.id, login: people.login, workspaceId: people.workspaceId })
      .from(people);
    for (const row of rows) {
      ids.set(row.login, row.id);
      workspaceId = row.workspaceId;
    }
    await install("messenger", "enabled", ["people:read", "people:accounts"]);
  });

  it("says nothing of a workspace nobody told it the accounts of", async () => {
    expect(await one("U0ALICE")).toEqual({
      workspace: "T0ACME",
      account: "U0ALICE",
      told: false,
      member: null,
    });
  });

  it("names the member an account is, and a supervisor only by the reporting line or as an administrator", async () => {
    expect(await put("messenger", "Alice", "U0ALICE")).toMatchObject({ account: "U0ALICE" });
    expect(await put("messenger", "bob", "U0BOB")).toMatchObject({ account: "U0BOB" });
    expect(await put("messenger", "carol", "U0MIRA")).toMatchObject({ account: "U0MIRA" });
    // Alice administers and is whom the account reports to; Bob is a member and no more; the
    // account itself is an agent account, and nobody's supervisor.
    expect(
      await asked([
        { workspace: "T0ACME", account: "U0ALICE" },
        { workspace: "T0ACME", account: "U0BOB" },
        { workspace: "T0ACME", account: "U0MIRA" },
        { workspace: "T0ACME", account: "U0NOBODY" },
      ]),
    ).toEqual([
      {
        workspace: "T0ACME",
        account: "U0ALICE",
        told: true,
        member: {
          login: "Alice",
          kind: "person",
          supervisor: true,
          administrator: true,
          line: "manager",
        },
      },
      {
        workspace: "T0ACME",
        account: "U0BOB",
        told: true,
        member: {
          login: "bob",
          kind: "person",
          supervisor: false,
          administrator: false,
          line: null,
        },
      },
      {
        workspace: "T0ACME",
        account: "U0MIRA",
        told: true,
        member: {
          login: "carol",
          kind: "agent",
          supervisor: false,
          administrator: false,
          line: null,
        },
      },
      // Told the accounts of that workspace and not this one: no member, and so no supervisor.
      { workspace: "T0ACME", account: "U0NOBODY", told: true, member: null },
    ]);
    // The same id at another workspace is another account, which nobody said anything of.
    expect(await one("U0ALICE", "T0OTHER")).toMatchObject({ told: false, member: null });
    // Whoever the account reports to supervises it, an administrator or not, and no longer
    // once it reports to someone else.
    const manager = (login: string) =>
      send(fromPages(alice), "PATCH", `${REST_ROUTES.people}/${ids.get("carol")}`, {
        managerId: ids.get(login),
      });
    expect((await manager("bob")).status).toBe(200);
    expect((await one("U0BOB"))?.member).toEqual({
      login: "bob",
      kind: "person",
      supervisor: true,
      administrator: false,
      line: "manager",
    });
    expect((await one("U0ALICE"))?.member?.supervisor).toBe(true);
    expect((await manager("Alice")).status).toBe(200);
    expect((await one("U0BOB"))?.member?.supervisor).toBe(false);
  });

  it("reads the line whole, both ways: the manager, every level above, an administrator in the line or out of it, a report and every level below", async () => {
    const db = drizzleOf(testDatabase.database);
    const reportsTo = (login: string, manager: string | null) =>
      db
        .update(people)
        .set({ managerId: manager === null ? null : (ids.get(manager) ?? null) })
        .where(eq(people.id, ids.get(login) ?? ""));
    // Invented members, each at a place of its own: nobody signs in as them.
    const added: [login: string, role: "admin" | "member"][] = [
      ["dana", "member"],
      ["erin", "member"],
      ["frank", "member"],
      ["gina", "admin"],
      ["henry", "member"],
      ["ida", "admin"],
    ];
    for (const [login, role] of added) {
      const [row] = await db
        .insert(people)
        .values({
          workspaceId,
          host: "gh",
          hostAccountId: `invented-${login}`,
          login,
          role,
          lastLoginAt: now,
        })
        .returning({ id: people.id });
      ids.set(login, row?.id ?? "");
    }
    // Another agent account, made as the first was: Alice's, until it reports to Bob below.
    const made = await send(fromPages(alice), "POST", REST_ROUTES.agents, {
      host: "gh",
      login: "nova",
      handle: "nova",
      name: "Nova",
      project: "ops",
    });
    expect(made.status).toBe(201);
    const [nova] = await db.select({ id: people.id }).from(people).where(eq(people.login, "nova"));
    ids.set("nova", nova?.id ?? "");
    for (const login of [...added.map(([one]) => one), "nova"]) {
      expect(await put("messenger", login, `U0${login.toUpperCase()}`)).toMatchObject({
        plugin: "messenger",
      });
    }
    // Above the account: it reports to Bob, Bob to Dana, Dana to Gina, an administrator. Alice
    // administers and is nowhere in the line; Ida administers too, and reports two levels
    // below the account. Below it: Erin reports to it, Frank to Erin. Henry is nowhere, and
    // Nova, another agent account, reports to Bob beside it.
    await reportsTo("carol", "bob");
    await reportsTo("bob", "dana");
    await reportsTo("dana", "gina");
    await reportsTo("erin", "carol");
    await reportsTo("frank", "erin");
    await reportsTo("ida", "erin");
    await reportsTo("nova", "bob");
    const stands = async (login: string, account = `U0${login.toUpperCase()}`) => {
      const member = (await one(account))?.member;
      return member === null || member === undefined
        ? undefined
        : [member.supervisor, member.administrator, member.line];
    };
    // The manager, and the manager's manager: supervisors by the line alone.
    expect(await stands("bob")).toEqual([true, false, "manager"]);
    expect(await stands("dana")).toEqual([true, false, "above"]);
    // An administrator three levels up is both, and one out of the line supervises all the same.
    expect(await stands("gina")).toEqual([true, true, "above"]);
    expect(await stands("Alice", "U0ALICE")).toEqual([true, true, null]);
    // Whoever reports to the account, and whoever reports to them: below it, and no supervisor.
    expect(await stands("erin")).toEqual([false, false, "report"]);
    expect(await stands("frank")).toEqual([false, false, "below"]);
    // An administrator below the account supervises it, and reports to it through another.
    expect(await stands("ida")).toEqual([true, true, "below"]);
    // Beside the account under one manager, or nowhere at all: no line, and no supervisor.
    expect(await stands("nova")).toEqual([false, false, null]);
    expect(await stands("henry")).toEqual([false, false, null]);
    // The line moved: who was above is none of it, and who is above now is.
    await reportsTo("carol", "dana");
    expect(await stands("bob")).toEqual([false, false, null]);
    expect(await stands("dana")).toEqual([true, false, "manager"]);
    expect(await stands("gina")).toEqual([true, true, "above"]);
    // As it was for the tests after this one: the account reports to Alice, and the invented
    // members are no account's at the messenger.
    await reportsTo("carol", "Alice");
    await reportsTo("bob", null);
    await reportsTo("nova", "Alice");
    for (const login of [...added.map(([one]) => one), "nova"]) {
      if (login !== "nova") {
        await reportsTo(login, null);
      }
      await removeMessengerAccount(testDatabase.database, {
        workspaceId,
        plugin: "messenger",
        messenger: "slack",
        team: "T0ACME",
        personId: ids.get(login) ?? "",
        actor: undefined,
        now,
      });
    }
  });

  it("counts what a plugin said only while it is enabled and holds the capability", async () => {
    await install("messenger", "enabled", ["people:read"]);
    expect(await one("U0ALICE")).toMatchObject({ told: false, member: null });
    await install("messenger", "disabled", ["people:read", "people:accounts"]);
    expect(await one("U0ALICE")).toMatchObject({ told: false, member: null });
    await install("messenger", "needs_consent", ["people:read", "people:accounts"]);
    expect(await one("U0ALICE")).toMatchObject({ told: false, member: null });
    await install("messenger", "enabled", ["people:read", "people:accounts"]);
    expect((await one("U0ALICE"))?.member?.supervisor).toBe(true);
  });

  it("lets no plugin say over another, and nobody a member who is not active", async () => {
    await install("other", "enabled", ["people:accounts"]);
    // An account another plugin said, or a person it said an account of there: refused.
    expect(await put("other", "bob", "U0ALICE")).toBe("another_plugins");
    expect(await put("other", "Alice", "U0ELSE")).toBe("another_plugins");
    expect((await one("U0ALICE"))?.member?.login).toBe("Alice");
    expect(
      await putMessengerAccount(testDatabase.database, {
        workspaceId,
        plugin: "messenger",
        messenger: "slack",
        team: "T0ACME",
        account: "U0GHOST",
        personId: "00000000-0000-7000-8000-000000000000",
        actor: undefined,
        most: 100,
        now,
      }),
    ).toBe("not_a_person");
    // The bound on what a workspace keeps holds.
    expect(
      await putMessengerAccount(testDatabase.database, {
        workspaceId,
        plugin: "messenger",
        messenger: "slack",
        team: "T0FULL",
        account: "U0BOB",
        personId: ids.get("bob") ?? "",
        actor: undefined,
        most: 3,
        now,
      }),
    ).toBe("too_many");
    // A member deactivated is nobody, whatever was said of their account.
    const active = (status: string) =>
      send(fromPages(alice), "PATCH", `${REST_ROUTES.people}/${ids.get("bob")}`, { status });
    expect((await active("deactivated")).status).toBe(200);
    expect(await one("U0BOB")).toMatchObject({ told: true, member: null });
    expect((await active("active")).status).toBe(200);
    expect((await one("U0BOB"))?.member?.login).toBe("bob");
  });

  it("lets what counts no more give way to the plugin in its place, and is forgotten with the plugin purged", async () => {
    // The plugin that said it is disabled: the one in its place says it now, and it counts.
    await install("messenger", "disabled", ["people:read", "people:accounts"]);
    expect(await put("other", "Alice", "U0ALICE")).toMatchObject({ plugin: "other" });
    expect((await one("U0ALICE"))?.member?.login).toBe("Alice");
    await install("messenger", "enabled", ["people:read", "people:accounts"]);
    expect(await put("messenger", "Alice", "U0ALICE")).toBe("another_plugins");
    // Purged, what it said is gone with it, each as an event of whoever purged it: a package
    // installed later under its key has said nothing, and the plugin before it may say it again.
    const events = async () =>
      (
        restEventsSchema.parse(
          await (
            await h.request(`${REST_ROUTES.events}?latest=true&limit=100`, {
              headers: fromPages(alice),
            })
          ).json(),
        ).items as readonly {
          kind: string;
          plugin?: string | null;
          data: Record<string, unknown>;
        }[]
      )
        .filter((event) => event.kind === "person.updated" && event.plugin === "other")
        .map((event) => [event.data.set, event.data.account]);
    await purgeInstall(testDatabase.database, {
      workspaceId,
      key: "other",
      boardProjectId: undefined,
      actor: { id: ids.get("Alice") ?? "" },
      now,
    });
    expect((await events()).at(-1)).toEqual([false, "U0ALICE"]);
    await install("other", "enabled", ["people:accounts"]);
    expect((await one("U0ALICE"))?.member).toBeNull();
    expect(await put("messenger", "Alice", "U0ALICE")).toMatchObject({ plugin: "messenger" });
    expect((await one("U0ALICE"))?.member?.supervisor).toBe(true);
  });

  it("names no member the account may not see, but for its own line", async () => {
    const visibility = (peopleVisibility: string) =>
      send(fromPages(alice), "PATCH", REST_ROUTES.workspace, { peopleVisibility });
    const db = drizzleOf(testDatabase.database);
    // A stranger in no project of the account's, and one two levels above it in the line.
    for (const login of ["stranger", "chief"]) {
      const [row] = await db
        .insert(people)
        .values({
          workspaceId,
          host: "gh",
          hostAccountId: `invented-${login}`,
          login,
          role: "member",
          lastLoginAt: now,
        })
        .returning({ id: people.id });
      ids.set(login, row?.id ?? "");
      expect(await put("messenger", login, `U0${login.toUpperCase()}`)).toMatchObject({
        plugin: "messenger",
      });
    }
    const reportsTo = (login: string, manager: string | null) =>
      db
        .update(people)
        .set({ managerId: manager === null ? null : (ids.get(manager) ?? null) })
        .where(eq(people.id, ids.get(login) ?? ""));
    await reportsTo("Alice", "chief");
    expect((await one("U0STRANGER"))?.member).toMatchObject({ login: "stranger" });
    expect((await visibility("shared_projects")).status).toBe(200);
    expect((await one("U0STRANGER"))?.member).toEqual({
      login: null,
      kind: "person",
      supervisor: false,
      administrator: false,
      line: null,
    });
    expect((await one("U0CHIEF"))?.member).toMatchObject({
      login: "chief",
      supervisor: true,
      line: "above",
    });
    expect((await one("U0ALICE"))?.member).toMatchObject({ login: "Alice", line: "manager" });
    expect((await visibility("everyone")).status).toBe(200);
    await reportsTo("Alice", null);
  });

  it("is the account's own to ask, as data, and nobody else's", async () => {
    const accounts = [{ workspace: "T0ACME", account: "U0ALICE" }];
    for (const body of [
      { messenger: "slack", accounts: [] },
      { messenger: "slack", accounts: Array.from({ length: 101 }, () => accounts[0]) },
      { messenger: "Slack", accounts },
      { messenger: "slack", accounts: [{ workspace: "T0ACME", account: "U0 ALICE" }] },
      { messenger: "slack", accounts: [{ workspace: "T0ACME", account: "U0ALICE\na supervisor" }] },
      { messenger: "slack", accounts: [{ workspace: "T".repeat(65), account: "U0ALICE" }] },
      { messenger: "slack", accounts: [{ account: "U0ALICE" }] },
      { accounts },
      "slack",
    ]) {
      const refused = await ask(bearer(command), body);
      expect(refused.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(await errorOf(refused)).toBe("request.invalid");
    }
    // A person, a supervisor among them, is no agent account, and nobody signed in is nobody.
    expect((await ask(fromPages(alice), { messenger: "slack", accounts })).status).toBe(404);
    expect((await ask(fromPages(bob), { messenger: "slack", accounts })).status).toBe(404);
    expect((await ask({}, { messenger: "slack", accounts })).status).toBe(401);
  });
});
