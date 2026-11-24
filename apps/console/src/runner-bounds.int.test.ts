import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  REST_ROUTES,
  restAgentSchema,
  restAgentSessionSchema,
  restClaimSchema,
  restConnectionSchema,
  restErrorSchema,
  restEventsSchema,
  restOwnWakesSchema,
  restRunnerHeartbeatSchema,
  restSignalSchema,
  restSignalsSchema,
  restTranscriptBatchSchema,
} from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { workspaces } from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { DEFAULT_QUOTAS } from "./http/quotas.js";
import { BoardWakes } from "./jobs/board-wakes.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// What an agent account's runner writes within an hour (ADR-0132): the events a session takes,
// the sessions the account begins, the wakes its runner raises itself, and the changes of its
// state the feed is told. Each bound narrowed to a few, on a clock the test moves, and on a
// database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
/** The secret of Mira's command, signed in as the account itself: her runner's one credential. */
let command: string;
/** How far the test moved the clock, in milliseconds. */
let moved = 0;
const later = (minutes: number) => {
  moved += minutes * 60_000;
};

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
/** In how many seconds a refusal says to try again: within the hour, and never none. */
const retryOf = (response: Response) => Number(response.headers.get("retry-after"));

const RUNNER = agentPath("me", "runner");
const OWN_SIGNALS = agentPath("me", "signals");
const SESSIONS = agentPath("me", "sessions");
const eventsPath = (id: string) => agentPath("me", "sessions", id, "events");

const beat = (state: string, reason: string) => ({
  state,
  reason,
  delivered: 0,
  session: null,
  machine: { name: "mac-mini", os: "macOS 15.1", user: "mira" },
  runner: "0.5.1",
  product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
  offers: { models: [], efforts: [], steer: true, images: true, resume: true },
  running: { model: null, effort: null },
});
const heartbeat = async (state: string, reason: string) =>
  restRunnerHeartbeatSchema.parse(
    await (await send(bearer(command), "PUT", RUNNER, beat(state, reason))).json(),
  );
const begin = () =>
  send(bearer(command), "POST", SESSIONS, {
    product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
    model: null,
    effort: null,
    resumed: false,
    machine: { name: "mac-mini", os: "macOS 15.1", user: "mira" },
  });
const event = (n: number) => ({
  n,
  kind: "assistant",
  at: "2026-11-10T14:02:15.120Z",
  text: `Event ${n}.`,
});
const append = (id: string, numbers: readonly number[]) =>
  send(bearer(command), "POST", eventsPath(id), { events: numbers.map(event) });
const raise = (key: string) =>
  send(bearer(command), "POST", OWN_SIGNALS, {
    kind: "wake",
    source: "messenger",
    key,
    text: "Said.",
  });
const stateEvents = async () =>
  restEventsSchema
    .parse(await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json())
    .items.filter((one) => one.kind === "agent.state_changed")
    .map((one) => `${one.data.was ?? "none"} > ${one.data.state} (${one.data.detail})`);

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

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice"],
    clock: { now: () => new Date(Date.now() + moved) },
    quotas: {
      transcriptEventsPerHour: 5,
      agentSessionsPerHour: 3,
      runnerWakesPerHour: 2,
      ownWakesPerHour: 2,
      ownResetsPerHour: 2,
      agentStateChangesPerHour: 3,
    },
  });
  alice = await h.signIn("alice");
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "gh",
    login: "carol",
    handle: "mira",
    name: "Mira",
    project: "ops",
  });
  command = await commandOf(await h.signIn("carol"));
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

describe("what an agent account's runner writes within an hour (ADR-0132)", () => {
  it("has bounds far above what work is, which a deployment's tests narrow", () => {
    expect(DEFAULT_QUOTAS).toMatchObject({
      transcriptEventsPerHour: 60_000,
      agentSessionsPerHour: 60,
      runnerWakesPerHour: 600,
      ownWakesPerHour: 30,
      ownResetsPerHour: 6,
      agentStateChangesPerHour: 20,
    });
  });

  it("takes so many events of a session within the hour, refuses the batch that is one too many whole, and takes it once the hour has room", async () => {
    const session = restAgentSessionSchema.parse(await (await begin()).json()).id;
    expect((await append(session, [1, 2, 3])).status).toBe(200);
    later(20);
    expect((await append(session, [4, 5])).status).toBe(200);
    // One more than the hour takes: refused, with when to send it again, and nothing of it kept.
    const over = await append(session, [6]);
    expect(over.status).toBe(429);
    expect(retryOf(over)).toBeGreaterThan(0);
    // The first three are forty minutes from being an hour old.
    expect(retryOf(over)).toBeLessThanOrEqual(40 * 60);
    expect(await errorOf(over)).toBe("transcript.too_many");
    // A batch sent again holds nothing new, and is answered as it always was.
    const again = await append(session, [1, 2, 3, 4, 5]);
    expect(again.status).toBe(200);
    expect(restTranscriptBatchSchema.parse(await again.json()).last).toBe(5);
    // A batch that is partly new is counted by what is new in it.
    expect((await append(session, [5, 6])).status).toBe(429);
    // Forty-one minutes on, the first three are an hour old: three more are taken, and no fourth.
    later(41);
    expect((await append(session, [6, 7, 8, 9])).status).toBe(429);
    const taken = await append(session, [6, 7, 8]);
    expect(taken.status).toBe(200);
    expect(restTranscriptBatchSchema.parse(await taken.json()).last).toBe(8);
    expect((await append(session, [9])).status).toBe(429);
    // A batch that is more than an hour takes by itself is refused as it is, whenever it is sent.
    later(120);
    const large = await append(session, [9, 10, 11, 12, 13, 14]);
    expect(large.status).toBe(429);
    expect(await errorOf(large)).toBe("transcript.too_many");
    expect((await append(session, [9, 10, 11, 12, 13])).status).toBe(200);
  });

  it("begins so many sessions of an account within the hour, and leaves the open one open when it refuses one more", async () => {
    later(120);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const begun = await begin();
      expect(begun.status).toBe(201);
      ids.push(restAgentSessionSchema.parse(await begun.json()).id);
      later(10);
    }
    const over = await begin();
    expect(over.status).toBe(429);
    expect(await errorOf(over)).toBe("transcript.too_many_sessions");
    // The first of the three is thirty minutes old: thirty more until it is an hour old.
    expect(retryOf(over)).toBeGreaterThan(29 * 60);
    expect(retryOf(over)).toBeLessThanOrEqual(30 * 60);
    // The session that was open was not taken over for the one refused: it still takes events.
    expect((await append(ids[2] ?? "", [1])).status).toBe(200);
    later(31);
    expect((await begin()).status).toBe(201);
    expect((await begin()).status).toBe(429);
  });

  it("takes so many wakes a runner raises itself within the hour, and counts nothing a supervisor sends", async () => {
    later(120);
    expect((await raise("C1/1")).status).toBe(201);
    // What a supervisor tells the agent is no wake of its runner's, however much of it there is.
    for (const text of ["One.", "Two.", "Three."]) {
      const told = await send(fromPages(alice), "POST", agentPath("mira", "signals"), {
        kind: "tell",
        text,
      });
      expect(told.status).toBe(201);
    }
    later(15);
    const second = await raise("C1/2");
    expect(second.status).toBe(201);
    expect(restSignalSchema.parse(await second.json()).source).toBe("messenger");
    const over = await raise("C1/3");
    expect(over.status).toBe(429);
    expect(await errorOf(over)).toBe("signal.too_many");
    expect(retryOf(over)).toBeGreaterThan(44 * 60);
    expect(retryOf(over)).toBeLessThanOrEqual(45 * 60);
    // Nothing was recorded for the wake refused: the next signal takes the next number.
    later(46);
    const third = await raise("C1/4");
    expect(third.status).toBe(201);
    expect(restSignalSchema.parse(await third.json()).number).toBe(6);
    expect((await raise("C1/5")).status).toBe(429);
  });

  it("takes so many wakes an account raises for itself within the hour, counted apart from its runner's (ADR-0145)", async () => {
    later(120);
    const own = () => send(bearer(command), "POST", agentPath("me", "wakes"), { text: "Again." });
    expect((await own()).status).toBe(201);
    // What its runner raises from a messenger is counted by itself, and takes none of these.
    expect((await raise("C2/1")).status).toBe(201);
    later(10);
    expect((await own()).status).toBe(201);
    const over = await own();
    expect(over.status).toBe(429);
    expect(await errorOf(over)).toBe("signal.too_many");
    expect(retryOf(over)).toBeGreaterThan(49 * 60);
    expect(retryOf(over)).toBeLessThanOrEqual(50 * 60);
    // Once the first is an hour old, the hour has room for one more.
    later(51);
    expect((await own()).status).toBe(201);
    expect((await own()).status).toBe(429);
  });

  it("takes so many new conversations an account begins for itself within the hour, counted apart from a supervisor's resets and its own wakes (ADR-0154)", async () => {
    later(120);
    const own = () => send(bearer(command), "POST", agentPath("me", "reset"), { text: "Anew." });
    expect((await own()).status).toBe(201);
    // A supervisor's reset is not counted, nor a wake the account raises for itself.
    for (const body of [{ kind: "reset" }, { kind: "reset", text: "Start over." }]) {
      expect(
        (await send(fromPages(alice), "POST", agentPath("mira", "signals"), body)).status,
      ).toBe(201);
    }
    expect(
      (await send(bearer(command), "POST", agentPath("me", "wakes"), { text: "Again." })).status,
    ).toBe(201);
    later(10);
    expect((await own()).status).toBe(201);
    const over = await own();
    expect(over.status).toBe(429);
    expect(await errorOf(over)).toBe("signal.too_many");
    expect(retryOf(over)).toBeGreaterThan(49 * 60);
    expect(retryOf(over)).toBeLessThanOrEqual(50 * 60);
    // Once the first is an hour old, the hour has room for one more.
    later(51);
    expect((await own()).status).toBe(201);
    expect((await own()).status).toBe(429);
  });

  it("holds a wake kept for later to the same hour: one that is due while the hour is full stays kept, and is raised when it has room", async () => {
    later(120);
    const mine = async () =>
      restSignalsSchema
        .parse(
          await (
            await h.request(`${agentPath("mira", "signals")}?limit=100`, {
              headers: { cookie: alice },
            })
          ).json(),
        )
        .items.filter((signal) => signal.by?.login === "carol" && signal.key?.startsWith("soon"))
        .map((signal) => signal.key)
        .reverse();
    const keptNow = async () =>
      restOwnWakesSchema
        .parse(
          await (await h.request(agentPath("me", "wakes"), { headers: bearer(command) })).json(),
        )
        .items.map((wake) => wake.key);
    const [workspace] = await drizzleOf(testDatabase.database).select().from(workspaces).limit(1);
    const wakes = new BoardWakes({
      database: testDatabase.database,
      workspaceId: async () => workspace?.id ?? "",
      clock: { now: () => new Date(Date.now() + moved) },
      logger: pino({ level: "silent" }),
      ownWakesPerHour: 2,
    });
    // Four kept for a moment from now, under four names: as many as an account may arm at once.
    const soon = new Date(Date.now() + moved + 60_000).toISOString();
    for (const key of ["soon-1", "soon-2", "soon-3", "soon-4"]) {
      const kept = await send(bearer(command), "POST", agentPath("me", "wakes"), { at: soon, key });
      expect(kept.status).toBe(201);
    }
    later(2);
    await wakes.sweep();
    await wakes.sweep();
    // Two are raised, which is what the hour takes; the other two stay kept, and are no signal.
    expect(await mine()).toEqual(["soon-1", "soon-2"]);
    expect(await keptNow()).toEqual(["soon-3", "soon-4"]);
    // One raised at once in that hour is refused too: the bound is one, however a wake is raised.
    expect(
      (await send(bearer(command), "POST", agentPath("me", "wakes"), { text: "Now." })).status,
    ).toBe(429);
    // An hour on, the two that waited are raised, once each.
    later(61);
    await wakes.sweep();
    await wakes.sweep();
    expect(await mine()).toEqual(["soon-1", "soon-2", "soon-3", "soon-4"]);
    expect(await keptNow()).toEqual([]);
    await wakes.close();
  });

  it("tells the feed so many changes of an account's state within the hour, keeps how it stands meanwhile, and tells it once the hour has room", async () => {
    later(120);
    await heartbeat("running", "started");
    await heartbeat("failed", "crashed");
    await heartbeat("running", "completed");
    expect(await stateEvents()).toEqual([
      "none > running (started)",
      "running > failed (crashed)",
      "failed > running (completed)",
    ]);
    // A product that fails again and again: the feed is told no more of it within the hour.
    later(1);
    await heartbeat("failed", "crashed");
    await heartbeat("running", "completed");
    const stands = await heartbeat("failed", "crashed");
    expect(stands.state).toBe("failed");
    expect(await stateEvents()).toHaveLength(3);
    // The account's page still says how it stands: the bound is on what the feed is told.
    const page = restAgentSchema.parse(
      await (await get({ cookie: alice }, agentPath("mira"))).json(),
    );
    expect(page.state?.state).toBe("failed");
    // The same again while the hour is full tells nothing.
    later(10);
    await heartbeat("failed", "crashed");
    expect(await stateEvents()).toHaveLength(3);
    // Once the hour has room, a heartbeat that says nothing new tells how the account stands,
    // from what the feed said last: its last word of an account is how the account stands.
    later(51);
    await heartbeat("failed", "crashed");
    expect((await stateEvents()).slice(3)).toEqual(["running > failed (crashed)"]);
    // And once told, the same again tells nothing.
    await heartbeat("failed", "crashed");
    later(30);
    await heartbeat("failed", "crashed");
    expect(await stateEvents()).toHaveLength(4);
  });
});
