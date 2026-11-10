import {
  agentPath,
  projectPath,
  REST_ROUTES,
  restAgentSchema,
  restErrorSchema,
  restEventsSchema,
  restSignalsSchema,
  restTaskSchema,
} from "@skillcdn/console/api";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { agentRunners, workspaces } from "./db/schema.js";
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
          "Carried over from before today: none.",
          'Open with no day: 1 (#1 "Set up @mira" in ops).',
          "Decisions waiting for you: 0.",
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
        text: "Your secret git.token ends on 2026-12-10. Renew what it holds where it was made, and set it again with its new day: console secret git.token --set --expires <day>",
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
