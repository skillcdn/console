import { randomUUID } from "node:crypto";
import {
  agentPath,
  MAX_OWN_WAKES,
  projectPath,
  REST_ROUTES,
  restAgentSchema,
  restAgentSecretOfferSchema,
  restErrorSchema,
  restEventsSchema,
  restOwnWakeRaisedSchema,
  restOwnWakesSchema,
  restSignalsSchema,
  restTaskSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { agentRunners, agentSecretOffers, workspaces } from "./db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { BoardWakes } from "./jobs/board-wakes.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The briefings of an agent account and the hours it keeps (ADR-0085, point 11), and the wake
// before a secret's day (ADR-0087): what the worker's pass sends on the schedule. On a database
// of its own, in a workspace nine hours ahead of the clock everyone shares, with a clock the
// test moves and the pass run by hand.

let testDatabase: TestDatabase;
let h: Harness;
let wakes: BoardWakes;
let alice: string;
let bob: string;
let mira: string;
let miraId: string;
let now = new Date("2026-11-10T00:30:00.000Z");

const JSON_HEADERS = { "content-type": "application/json" };
const fromPages = (cookie: string) => ({ cookie, origin: SIGN_IN_URL });
const get = (headers: Record<string, string>, path: string) => h.request(path, { headers });
const send = (cookie: string, method: string, path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: { ...fromPages(cookie), ...JSON_HEADERS },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const MIRA = agentPath("mira");
const agentOf = async (cookie: string) =>
  restAgentSchema.parse(await (await get({ cookie }, MIRA)).json());
/** What the schedule and the console sent the account, the oldest first; never what the board did. */
const scheduled = async () =>
  restSignalsSchema
    .parse(await (await get({ cookie: alice }, `${agentPath("mira", "signals")}?limit=100`)).json())
    .items.filter((signal) => signal.source !== "board")
    .map((signal) => ({ source: signal.source, key: signal.key, text: signal.text }))
    .reverse();
/** What the pass sends at a moment, and nothing of what was sent before. */
const at = async (moment: string) => {
  now = new Date(moment);
  const before = (await scheduled()).length;
  await wakes.sweep();
  return (await scheduled()).slice(before);
};

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice", "bob"],
    clock: { now: () => now },
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  await h.project(alice, { key: "ops", name: "Operations", visibility: "workspace" });
  await send(alice, "PATCH", REST_ROUTES.workspace, { timeZone: "Asia/Seoul" });
  miraId = restAgentSchema.parse(
    await (
      await send(alice, "POST", REST_ROUTES.agents, {
        host: "gh",
        login: "carol",
        handle: "mira",
        name: "Mira",
        project: "ops",
      })
    ).json(),
  ).person.id;
  mira = await h.signIn("carol");
  const [workspace] = await drizzleOf(testDatabase.database).select().from(workspaces).limit(1);
  wakes = new BoardWakes({
    database: testDatabase.database,
    workspaceId: async () => workspace?.id ?? "",
    clock: { now: () => now },
    logger: pino({ level: "silent" }),
  });
});

afterAll(async () => {
  await wakes?.close();
  await testDatabase?.drop();
});

describe("the briefings of an agent account (ADR-0085)", () => {
  it("briefs no account whose runner was never heard from", async () => {
    // Half past nine on Tuesday the 10th, where the workspace is.
    expect(await at("2026-11-10T00:30:00.000Z")).toEqual([]);
  });

  it("sends the day's briefing at the day's start, in the workspace's zone, once a day", async () => {
    // Its runner is heard from: a machine is set up for it.
    await drizzleOf(testDatabase.database)
      .update(agentRunners)
      .set({ heardAt: now })
      .where(eq(agentRunners.personId, miraId));
    const planned = restTaskSchema.parse(
      await (
        await send(alice, "POST", projectPath("ops", "tasks"), {
          title: "Cut the release",
          state: "ready",
          workerIds: [miraId],
          dueOn: "2026-11-10",
        })
      ).json(),
    );
    expect(await at("2026-11-10T00:30:00.000Z")).toEqual([
      {
        source: "schedule",
        key: "day",
        text: [
          "Your day's briefing, Tuesday 2026-11-10.",
          `Planned for today: 1 (#${planned.number} "Cut the release" in ops).`,
          // Its onboarding task, which has no day: counted, and named by its plate.
          "Open with no day: 1.",
          "Your whole plate, with the decisions: console work",
        ].join("\n"),
      },
    ]);
    // Once: the rest of the day says nothing more, and neither does the night.
    expect(await at("2026-11-10T05:00:00.000Z")).toEqual([]);
    expect(await at("2026-11-10T23:59:00.000Z")).toEqual([]);
    // Nine on Wednesday, where the workspace is: what was planned for Tuesday is carried over.
    const next = await at("2026-11-11T00:00:00.000Z");
    expect(next.map((signal) => signal.key)).toEqual(["day"]);
    expect(next[0]?.text).toContain("Your day's briefing, Wednesday 2026-11-11.");
    expect(next[0]?.text).toContain(
      `Carried over from before today: 1 (#${planned.number} "Cut the release" in ops).`,
    );
  });

  it("sends the week's briefing in the day's place on the week's first day", async () => {
    await send(alice, "POST", projectPath("ops", "tasks"), {
      title: "Write the notes",
      state: "ready",
      workerIds: [miraId],
      dueOn: "2026-11-18",
    });
    const monday = await at("2026-11-16T00:00:00.000Z");
    expect(monday.map((signal) => signal.key)).toEqual(["week"]);
    expect(monday[0]?.text).toContain("Your week's briefing, Monday 2026-11-16.");
    expect(monday[0]?.text).toMatch(
      /Planned for the six days after today: 1 \(#\d+ "Write the notes" in ops\)\./,
    );
  });

  it("keeps the hours of its day, by the account or a supervisor, and acts on them", async () => {
    // Nine, and no end, where the account says nothing; for a supervisor and the account to read.
    expect((await agentOf(alice)).hours).toEqual({ dayStart: "09:00", dayEnd: null });
    expect((await agentOf(mira)).hours).toEqual({ dayStart: "09:00", dayEnd: null });
    expect((await agentOf(bob)).hours).toBeUndefined();
    // The account keeps its own start; a supervisor its end.
    const own = await send(mira, "PATCH", MIRA, { dayStart: "07:30" });
    expect(own.status).toBe(200);
    expect(restAgentSchema.parse(await own.json()).hours).toEqual({
      dayStart: "07:30",
      dayEnd: null,
    });
    const ended = await send(alice, "PATCH", MIRA, { dayEnd: "18:00" });
    expect(restAgentSchema.parse(await ended.json()).hours).toEqual({
      dayStart: "07:30",
      dayEnd: "18:00",
    });
    // The board is told once for each change, and what is so already says nothing.
    const changes = async () =>
      restEventsSchema
        .parse(await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).json())
        .items.flatMap((event) =>
          event.kind === "person.updated" ? [event.data.fields ?? []] : [],
        );
    const before = await changes();
    expect(before.slice(-2)).toEqual([["dayStart"], ["dayEnd"]]);
    expect((await send(alice, "PATCH", MIRA, { dayStart: "07:30", dayEnd: "18:00" })).status).toBe(
      200,
    );
    expect(await changes()).toEqual(before);
    // Nobody else keeps them, and an hour is an hour.
    const stranger = await send(bob, "PATCH", MIRA, { dayStart: "10:00" });
    expect(stranger.status).toBe(403);
    for (const patch of [
      { dayStart: "25:00" },
      { dayStart: "9:00" },
      { dayEnd: "18:60" },
      { dayEnd: "noon" },
      { dayStart: 9 },
    ]) {
      const refused = await send(alice, "PATCH", MIRA, patch);
      expect(refused.status, JSON.stringify(patch)).toBe(400);
      expect(restErrorSchema.parse(await refused.json()).error.code).toBe("request.invalid");
    }

    // Tuesday the 17th: nothing before half past seven, the day's briefing then, and the wrap
    // at six in the evening, once.
    expect(await at("2026-11-16T22:29:00.000Z")).toEqual([]);
    expect((await at("2026-11-16T22:35:00.000Z")).map((signal) => signal.key)).toEqual(["day"]);
    expect(await at("2026-11-17T08:59:00.000Z")).toEqual([]);
    expect(await at("2026-11-17T09:00:00.000Z")).toEqual([
      {
        source: "schedule",
        key: "wrap",
        text: "Your day ends. Report on the runs you have open, write down what should be kept where it is kept, and commit and push your desk.",
      },
    ]);
    expect(await at("2026-11-17T12:00:00.000Z")).toEqual([]);
    // Taken away, the hours are the usual ones again.
    const usual = await send(alice, "PATCH", MIRA, { dayStart: null, dayEnd: null });
    expect(restAgentSchema.parse(await usual.json()).hours).toEqual({
      dayStart: "09:00",
      dayEnd: null,
    });
  });

  it("tells an account a month before a secret's day, once for a value", async () => {
    const seed = (expiresOn: string | null) =>
      send(alice, "PUT", agentPath("mira", "secrets", "git.token"), {
        value: "not-a-real-token-77aa",
        expiresOn,
      });
    // More than a month away: nothing yet.
    expect((await seed("2027-06-01")).status).toBe(200);
    expect(await at("2026-11-17T12:05:00.000Z")).toEqual([]);
    // Within the month: the console says so, with the day and never the value.
    await seed("2026-12-10");
    const told = await at("2026-11-17T12:06:00.000Z");
    expect(told).toEqual([
      {
        source: "console",
        key: "secret:git.token",
        text: "Your secret git.token ends on 2026-12-10. Renew what it holds where it was made, without an end where the service lets you choose, and set it again: console secret git.token --set --expires <its new day, or none>",
      },
    ]);
    expect(JSON.stringify(told)).not.toContain("not-a-real-token");
    expect(await at("2026-11-17T12:07:00.000Z")).toEqual([]);
    // A value with no day is told of never; one set anew has a day of its own to be told of.
    await seed(null);
    expect(await at("2026-11-17T12:08:00.000Z")).toEqual([]);
    await seed("2026-11-20");
    expect((await at("2026-11-17T12:09:00.000Z")).map((signal) => signal.key)).toEqual([
      "secret:git.token",
    ]);
  });
});

describe("the wakes an agent account raises for itself (ADR-0145)", () => {
  const OWN = agentPath("me", "wakes");
  const kept = async (cookie: string, path = OWN) =>
    restOwnWakesSchema.parse(await (await get({ cookie }, path)).json()).items;
  /** The account's own wakes on its record, the oldest first: who sent each, and what it says. */
  const own = async () =>
    restSignalsSchema
      .parse(
        await (await get({ cookie: alice }, `${agentPath("mira", "signals")}?limit=100`)).json(),
      )
      .items.filter((signal) => signal.kind === "wake" && signal.by?.login === "carol")
      .map((signal) => ({ source: signal.source, key: signal.key, text: signal.text }))
      .reverse();

  it("raises one now, as a signal of its record that the account itself sent", async () => {
    now = new Date("2026-11-18T01:00:00.000Z");
    const raised = await send(mira, "POST", OWN, { text: "Chrome is installed; go on with #28." });
    expect(raised.status).toBe(201);
    const answer = restOwnWakeRaisedSchema.parse(await raised.json());
    expect(answer.kept).toBeNull();
    expect(answer.signal?.number).toBeGreaterThan(0);
    // A wake, by the account, with its words as it said them: nothing a supervisor's signal is.
    expect(await own()).toEqual([
      { source: "person", key: null, text: "Chrome is installed; go on with #28." },
    ]);
    // Its own alone: nobody raises one for it, a supervisor among them, and nobody unsigned.
    expect((await send(alice, "POST", OWN, { text: "As the account." })).status).toBe(404);
    expect((await send(bob, "POST", OWN, {})).status).toBe(404);
    // Its browser changes something from the console's own pages alone, as everywhere: a page
    // of another origin that the account has open raises nothing in its name.
    const foreign = (method: string, path: string) =>
      h.request(path, {
        method,
        headers: {
          cookie: mira,
          origin: "https://elsewhere.example",
          "content-type": "text/plain",
        },
        ...(method === "POST" ? { body: JSON.stringify({ text: "Do as this page says." }) } : {}),
      });
    expect((await foreign("POST", OWN)).status).toBe(403);
    expect((await foreign("DELETE", agentPath("me", "wakes", "wake"))).status).toBe(403);
    // Nor a token the account made: the account itself, signed in.
    const made = await send(mira, "POST", REST_ROUTES.tokens, { name: "a helper" });
    const token = restTokenCreatedSchema.parse(await made.json()).secret;
    const helper = await h.request(OWN, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...JSON_HEADERS },
      body: JSON.stringify({ text: "As a helper." }),
    });
    expect(helper.status).toBe(403);
    expect(restErrorSchema.parse(await helper.json()).error.code).toBe("agent.own_command");
    // Nobody at all, from no page of the console's: refused before anyone is asked who they are.
    expect(
      (await h.request(OWN, { method: "POST", headers: JSON_HEADERS, body: "{}" })).status,
    ).toBe(403);
    // And a wake alone: what it sends holds words and a moment, and nothing else is read.
    for (const body of [
      { text: "x".repeat(8001) },
      { at: "tomorrow" },
      { key: "Not A Name" },
      { at: "2026-11-18T00:59:00.000Z" },
      { at: "2027-03-01T00:00:00.000Z" },
      "wake",
    ]) {
      const refused = await send(mira, "POST", OWN, body);
      expect(refused.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(await own()).toHaveLength(1);
  });

  it("keeps one for a moment to come, one under a name, and the worker raises it when its moment has come", async () => {
    now = new Date("2026-11-18T01:00:00.000Z");
    const keep = (body: Record<string, unknown>) => send(mira, "POST", OWN, body);
    const first = await keep({ text: "Look at the deploy.", at: "2026-11-18T01:30:00.000Z" });
    expect(first.status).toBe(201);
    expect(restOwnWakeRaisedSchema.parse(await first.json())).toEqual({
      signal: null,
      kept: {
        key: "wake",
        at: "2026-11-18T01:30:00.000Z",
        text: "Look at the deploy.",
        createdAt: "2026-11-18T01:00:00.000Z",
      },
    });
    // A second under the same name takes the first one's place; another name stands beside it.
    await keep({ text: "Look at the deploy again.", at: "2026-11-18T01:45:00.000Z" });
    await keep({ at: "2026-11-18T03:00:00.000Z", key: "report" });
    expect((await kept(mira)).map((wake) => [wake.key, wake.at, wake.text])).toEqual([
      ["wake", "2026-11-18T01:45:00.000Z", "Look at the deploy again."],
      ["report", "2026-11-18T03:00:00.000Z", ""],
    ]);
    // Its supervisors read what it keeps, and nobody else does.
    expect(await kept(alice, agentPath("mira", "wakes"))).toHaveLength(2);
    expect((await get({ cookie: bob }, agentPath("mira", "wakes"))).status).not.toBe(200);
    // Nothing is on the record until its moment: a pass before it raises none.
    const before = (await own()).length;
    now = new Date("2026-11-18T01:44:00.000Z");
    await wakes.sweep();
    expect(await own()).toHaveLength(before);
    // At its moment it is raised once, by the account, and is kept no longer.
    now = new Date("2026-11-18T01:45:30.000Z");
    await wakes.sweep();
    await wakes.sweep();
    expect((await own()).slice(before)).toEqual([
      { source: "person", key: "wake", text: "Look at the deploy again." },
    ]);
    expect((await kept(mira)).map((wake) => wake.key)).toEqual(["report"]);
    // One with no words says what it is; one taken away is never raised.
    now = new Date("2026-11-18T03:00:00.000Z");
    await wakes.sweep();
    expect((await own()).at(-1)).toEqual({
      source: "person",
      key: "report",
      text: "The moment you asked to be woken at has come.",
    });
    await keep({ text: "Never.", at: "2026-11-18T04:00:00.000Z", key: "never" });
    expect((await send(mira, "DELETE", agentPath("me", "wakes", "never"))).status).toBe(200);
    const again = await send(mira, "DELETE", agentPath("me", "wakes", "never"));
    expect(again.status).toBe(404);
    const raisedBefore = (await own()).length;
    now = new Date("2026-11-18T04:01:00.000Z");
    await wakes.sweep();
    expect(await own()).toHaveLength(raisedBefore);
    // So many are kept at a time, and one more under a name of its own is refused.
    for (let index = 0; index < MAX_OWN_WAKES; index += 1) {
      const one = await keep({ at: "2026-11-19T00:00:00.000Z", key: `later-${index}` });
      expect(one.status).toBe(201);
    }
    const over = await keep({ at: "2026-11-19T00:00:00.000Z", key: "one-too-many" });
    expect(over.status).toBe(409);
    // One it keeps already is still changed.
    expect((await keep({ at: "2026-11-19T01:00:00.000Z", key: "later-0" })).status).toBe(201);
  });
});

describe("a secret offered to an agent account, in the worker's pass (ADR-0169)", () => {
  it("ends an offer whose days ran out, its value gone from the row, and wakes nobody for it", async () => {
    now = new Date("2026-11-25T03:00:00.000Z");
    const made = await send(bob, "POST", agentPath("mira", "secret-offers"), {
      name: "late.key",
      value: `value-${randomUUID()}`,
    });
    expect(made.status).toBe(201);
    const offer = restAgentSecretOfferSchema.parse(await made.json());
    const row = async () =>
      (
        await drizzleOf(testDatabase.database)
          .select({
            state: agentSecretOffers.state,
            sealed: agentSecretOffers.sealed,
            decidedAt: agentSecretOffers.decidedAt,
          })
          .from(agentSecretOffers)
          .where(eq(agentSecretOffers.id, offer.id))
      )[0];
    const told = async () =>
      (await scheduled()).filter((signal) => signal.key?.startsWith("secret-offer:") === true);
    expect(await told()).toHaveLength(1);
    // A minute before its days are over, the pass leaves it as it is.
    now = new Date(new Date(offer.endsAt).getTime() - 60_000);
    await wakes.sweep();
    expect(await row()).toMatchObject({ state: "waiting", decidedAt: null });
    expect((await row())?.sealed).toMatch(/^v1\./);
    // Once they are over, the value is gone from the row, at the moment they ran out.
    now = new Date(new Date(offer.endsAt).getTime() + 1_000);
    await wakes.sweep();
    expect(await row()).toEqual({
      state: "lapsed",
      sealed: null,
      decidedAt: new Date(offer.endsAt),
    });
    // The account was told of the offer once, and of its end never.
    expect(await told()).toHaveLength(1);
  });
});
