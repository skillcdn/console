import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  MAX_TRANSCRIPT_BATCH,
  MAX_TRANSCRIPT_FACT_LENGTH,
  MAX_TRANSCRIPT_FACT_NAME_LENGTH,
  MAX_TRANSCRIPT_FACTS,
  MAX_TRANSCRIPT_FILES_PER_MINUTE,
  MAX_TRANSCRIPT_TEXT_BYTES,
  projectPath,
  REST_ROUTES,
  restAgentSchema,
  restAgentSessionSchema,
  restAgentSessionsSchema,
  restClaimSchema,
  restConnectionSchema,
  restErrorSchema,
  restMeSchema,
  restRunSchema,
  restTaskSchema,
  restTokenCreatedSchema,
  restTranscriptBatchSchema,
  restTranscriptEventSchema,
  restTranscriptEventsSchema,
  restTranscriptFileSchema,
  restTranscriptTextSchema,
  TRANSCRIPT_INLINE_BYTES,
} from "@skillcdn/console/api";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { attachedMonths } from "./db/queries/transcript.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { RunnerWatch } from "./jobs/runner-watch.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The sessions of an agent account's runner and their transcript (ADR-0086,
// docs/specs/runner.md): begun and ended by the runner, reported in numbered batches that may be
// sent twice, the long texts and the pictures kept under the session's month, read by the
// account's supervisors and the account a page at a time and as they happen, sealed by an
// administrator, and still listed when their month is put away. On a database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let bob: string;
let mira: string;
let miraId: string;
let bobId: string;
/** The secret of Mira's command, signed in as the account itself: her runner's one credential. */
let command: string;
/** Another agent account's command, which is nobody's supervisor and no runner of Mira's. */
let noorCommand: string;
/** The session the tests write to, begun second. */
let session: string;

const MONTH = new Date().toISOString().slice(0, 7);
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
const raw = (statement: string) => drizzleOf(testDatabase.database).execute(sql.raw(statement));

const OWN = agentPath("me", "sessions");
const THEIRS = agentPath("mira", "sessions");
const own = (id: string, ...parts: string[]) => agentPath("me", "sessions", id, ...parts);
const theirs = (id: string, ...parts: string[]) => agentPath("mira", "sessions", id, ...parts);

/** What a runner says a session runs. */
const beginning = (over: Record<string, unknown> = {}) => ({
  product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
  model: "opus",
  effort: null,
  resumed: false,
  machine: { name: "mac-mini", os: "macOS 15.1", user: "mira" },
  ...over,
});
const begin = async (secret = command, over: Record<string, unknown> = {}) =>
  restAgentSessionSchema.parse(
    await (await send(bearer(secret), "POST", OWN, beginning(over))).json(),
  );
/** One event as a runner reports it. */
const event = (n: number, over: Record<string, unknown> = {}) => ({
  n,
  kind: "assistant",
  at: "2026-11-10T14:02:15.120Z",
  text: `Event ${n}.`,
  ...over,
});
const append = (id: string, events: unknown[], secret = command) =>
  send(bearer(secret), "POST", own(id, "events"), { events });
const lastOf = async (response: Response) =>
  restTranscriptBatchSchema.parse(await response.json()).last;
const eventsOf = async (headers: Record<string, string>, id: string, query = "") =>
  restTranscriptEventsSchema.parse(
    await (await get(headers, `${theirs(id, "events")}${query}`)).json(),
  );
const sessionOf = async (headers: Record<string, string>, id: string) =>
  restAgentSessionSchema.parse(await (await get(headers, theirs(id))).json());
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const upload = (id: string, bytes: Uint8Array, name: string, type: string, secret = command) => {
  const form = new FormData();
  form.set("file", new File([Uint8Array.from(bytes)], name, { type }));
  return h.request(own(id, "files"), { method: "POST", headers: bearer(secret), body: form });
};

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

/** What a stream carried, a block each: the id it was sent under, what it is called, and its data. */
const blocksOf = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => block.includes("data:"))
    .map((block) => ({
      id: /^id: (\d+)$/m.exec(block)?.[1],
      event: /^event: (.*)$/m.exec(block)?.[1],
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null") as unknown,
    }));

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh"), createFixtureProvider("google")],
    admins: ["alice"],
    listed: ["alice", "bob"],
    live: true,
    feed: { heartbeatMs: 300, pollMs: 60_000 },
  });
  alice = await h.signIn("alice");
  bob = await h.signIn("bob");
  bobId =
    restMeSchema.parse(await (await get({ cookie: bob }, REST_ROUTES.me)).json()).person?.id ?? "";
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  // Alice makes both accounts and is whom they report to. Bob sees them and supervises neither.
  const made = await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "gh",
    login: "carol",
    handle: "mira",
    name: "Mira",
    project: "ops",
  });
  miraId = restAgentSchema.parse(await made.json()).person.id;
  await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "google",
    login: "erin@mail.test",
    handle: "noor",
    name: "Noor",
    project: "ops",
  });
  mira = await h.signIn("carol");
  command = await commandOf(mira);
  noorCommand = await commandOf(await h.signIn("erin"));
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

describe("the sessions of an agent account and their transcript (ADR-0086)", () => {
  it("begins a session for the account's runner, one at a time: a new one takes the open one over", async () => {
    const begun = await send(bearer(command), "POST", OWN, beginning());
    expect(begun.status).toBe(201);
    const first = restAgentSessionSchema.parse(await begun.json());
    expect(first).toMatchObject({
      month: MONTH,
      endedAt: null,
      ended: null,
      product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: true },
      model: "opus",
      effort: null,
      resumed: false,
      machine: { name: "mac-mini", os: "macOS 15.1", user: "mira" },
      events: 0,
      lastEventAt: null,
      away: false,
    });
    expect(await lastOf(await append(first.id, [event(1)]))).toBe(1);

    session = (await begin(command, { resumed: true })).id;
    expect(session).not.toBe(first.id);
    const taken = await sessionOf({ cookie: alice }, first.id);
    expect(taken.ended).toBe("taken_over");
    expect(taken.endedAt).not.toBeNull();
    expect(taken.events).toBe(1);
    // Nothing more is added to the one taken over.
    const late = await append(first.id, [event(2)]);
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe("transcript.session_over");

    // Its runner begins one, and nothing else: not its browser, not a token it made, not a person.
    const browser = await send(fromPages(mira), "POST", OWN, beginning());
    expect(browser.status).toBe(403);
    expect(await errorOf(browser)).toBe("agent.own_command");
    const made = await send(fromPages(mira), "POST", REST_ROUTES.tokens, { name: "a helper" });
    const helper = restTokenCreatedSchema.parse(await made.json()).secret;
    expect((await send(bearer(helper), "POST", OWN, beginning())).status).toBe(403);
    const person = await send(bearer(await commandOf(bob)), "POST", OWN, beginning());
    expect(person.status).toBe(404);
    expect((await send({}, "POST", OWN, beginning())).status).toBe(401);
    for (const body of [
      {},
      beginning({ model: "--dangerously" }),
      beginning({ resumed: "yes" }),
      beginning({ machine: { name: "m".repeat(500), os: "x", user: "y" } }),
      beginning({ product: { driver: "claude" } }),
    ]) {
      const refused = await send(bearer(command), "POST", OWN, body);
      expect(refused.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it("appends numbered batches in order, takes one twice without harm, and refuses a gap", async () => {
    expect(await lastOf(await append(session, [event(1), event(2), event(3)]))).toBe(3);
    // The same batch again, whatever it says now, changes nothing.
    expect(
      await lastOf(await append(session, [event(1), event(2, { text: "Rewritten." }), event(3)])),
    ).toBe(3);
    // A batch that overlaps what is there goes on from where the session is.
    expect(await lastOf(await append(session, [event(3, { text: "Again." }), event(4)]))).toBe(4);
    const read = await eventsOf({ cookie: alice }, session);
    expect(read.items.map((item) => [item.n, item.text])).toEqual([
      [1, "Event 1."],
      [2, "Event 2."],
      [3, "Event 3."],
      [4, "Event 4."],
    ]);
    expect(read.more).toBe(false);

    // A number that would leave a gap is refused, with the number expected.
    const gap = await append(session, [event(6)]);
    expect(gap.status).toBe(409);
    const said = restErrorSchema.parse(await gap.json()).error;
    expect(said.code).toBe("transcript.gap");
    expect(said.message).toContain("The next is 5.");
    const within = await append(session, [event(5), event(7)]);
    expect(within.status).toBe(409);
    expect(await errorOf(within)).toBe("transcript.gap");
    for (const batch of [
      [event(6), event(5)],
      [event(5), event(5)],
    ]) {
      const refused = await append(session, batch);
      expect(refused.status).toBe(400);
      expect(await errorOf(refused)).toBe("transcript.out_of_order");
    }
    // None of it was kept.
    expect((await sessionOf({ cookie: alice }, session)).events).toBe(4);

    // A session is its account's: another's runner neither writes to it nor learns that it is.
    const other = await append(session, [event(5)], noorCommand);
    expect(other.status).toBe(404);
    expect(await errorOf(other)).toBe("transcript.session_not_found");
    expect((await append("0199c4d8-0000-7000-8000-00000000dead", [event(1)])).status).toBe(404);
    expect((await append("not-an-id", [event(1)])).status).toBe(404);
    expect(
      (await send(fromPages(mira), "POST", own(session, "events"), { events: [] })).status,
    ).toBe(403);
  });

  it("takes what a runner sends as data: bounded, of the kinds it knows, kept as text and never run", async () => {
    const refused = async (events: unknown) => {
      const response = await send(bearer(command), "POST", own(session, "events"), { events });
      expect(response.status, JSON.stringify(events).slice(0, 70)).toBe(400);
      expect(await errorOf(response)).toBe("request.invalid");
    };
    await refused([]);
    await refused("everything");
    await refused([event(5, { kind: "shell" })]);
    await refused([event(0)]);
    await refused([event(5, { at: "yesterday" })]);
    await refused([event(5, { text: "x".repeat(MAX_TRANSCRIPT_TEXT_BYTES + 1) })]);
    // Counted in bytes, as it is kept: a text of fewer characters than the bound may be over it.
    await refused([
      event(5, {
        text: String.fromCodePoint(0xac00).repeat(Math.ceil(MAX_TRANSCRIPT_TEXT_BYTES / 3) + 1),
      }),
    ]);
    await refused([event(5, { data: { nested: { a: 1 } } })]);
    await refused([event(5, { data: { list: [1, 2] } })]);
    await refused([event(5, { data: { [`n${"a".repeat(MAX_TRANSCRIPT_FACT_NAME_LENGTH)}`]: 1 } })]);
    await refused([event(5, { data: { long: "x".repeat(MAX_TRANSCRIPT_FACT_LENGTH + 1) } })]);
    await refused([
      event(5, {
        data: Object.fromEntries(
          Array.from({ length: MAX_TRANSCRIPT_FACTS + 1 }, (_, index) => [`f${index}`, index]),
        ),
      }),
    ]);
    await refused([event(5, { files: ["not-an-id"] })]);
    await refused(Array.from({ length: MAX_TRANSCRIPT_BATCH + 1 }, (_, index) => event(index + 5)));
    const large = await append(
      session,
      Array.from({ length: 9 }, (_, index) => event(index + 5, { text: "x".repeat(250 * 1024) })),
    );
    expect(large.status).toBe(413);
    const unreadable = await h.request(own(session, "events"), {
      method: "POST",
      headers: { ...bearer(command), ...JSON_HEADERS },
      body: "{",
    });
    expect(unreadable.status).toBe(400);

    // What the product said is kept as it said it, markup, escapes and all, but for the two
    // things no text of the database's takes: a NUL, and half of a surrogate pair.
    const nul = String.fromCodePoint(0);
    const half = String.fromCharCode(0xd800);
    const gone = String.fromCodePoint(0xfffd);
    const said = `<script>alert(1)</script>${String.fromCodePoint(0x1b)}[31m${String.fromCodePoint(0x202e)}`;
    expect(
      await lastOf(
        await append(session, [
          event(5, {
            kind: "tool_result",
            text: `${said}${nul}${half}`,
            data: { tool: "Bash", id: `toolu_${nul}01`, ok: true, code: 0, cwd: null },
          }),
        ]),
      ),
    ).toBe(5);
    const read = await get({ cookie: alice }, `${theirs(session, "events")}?after=4`);
    expect(read.headers.get("content-type")).toContain("application/json");
    const [kept] = restTranscriptEventsSchema.parse(await read.json()).items;
    expect(kept).toMatchObject({
      n: 5,
      kind: "tool_result",
      text: `${said}${gone}${gone}`,
      whole: null,
      data: { tool: "Bash", id: `toolu_${gone}01`, ok: true, code: 0, cwd: null },
      files: [],
      sealed: null,
    });
    expect((await sessionOf({ cookie: alice }, session)).events).toBe(5);
  });

  it("keeps the beginning of a long text in the row and the whole under the session's month", async () => {
    // Three bytes a character, so that the bound falls inside one: the row is cut before it.
    const long = String.fromCodePoint(0xac00).repeat(20_000);
    expect(await lastOf(await append(session, [event(6, { kind: "thinking", text: long })]))).toBe(
      6,
    );
    const [kept] = (await eventsOf({ cookie: alice }, session, "?after=5")).items;
    expect(kept?.whole).toBe(60_000);
    expect(Buffer.byteLength(kept?.text ?? "")).toBe(TRANSCRIPT_INLINE_BYTES - 1);
    expect(long.startsWith(kept?.text ?? "x")).toBe(true);
    const whole = await get({ cookie: alice }, theirs(session, "events", "6", "text"));
    expect(restTranscriptTextSchema.parse(await whole.json())).toEqual({ n: 6, text: long });
    // A text that is whole in its row reads the same way.
    expect(
      restTranscriptTextSchema.parse(
        await (await get({ cookie: alice }, theirs(session, "events", "1", "text"))).json(),
      ).text,
    ).toBe("Event 1.");
    expect((await get({ cookie: alice }, theirs(session, "events", "99", "text"))).status).toBe(
      404,
    );
    expect((await get({ cookie: alice }, theirs(session, "events", "x", "text"))).status).toBe(404);
    // The bytes are on the month's shelf, apart from the board's files.
    const shelf = await raw(`select month, size from transcript.blobs`);
    expect(shelf.rows).toEqual([{ month: MONTH, size: 60_000 }]);
    expect((await raw(`select 1 from blobs`)).rows).toEqual([]);
  });

  it("keeps the pictures a session hands in, for the events of that session to name", async () => {
    const handed = await upload(session, PNG, "screen.png", "image/png");
    expect(handed.status).toBe(201);
    const picture = restTranscriptFileSchema.parse(await handed.json());
    expect(picture).toMatchObject({
      name: "screen.png",
      size: PNG.byteLength,
      contentType: "image/png",
    });
    expect(JSON.stringify(picture)).not.toContain("sha256");
    // Pictures, of the kinds a transcript keeps, and nothing that runs.
    for (const [bytes, name, type] of [
      [PNG, "page.html", "text/html"],
      [PNG, "drawing.svg", "image/svg+xml"],
      [PNG, "screen.png", ""],
      [new Uint8Array(), "empty.png", "image/png"],
      [PNG, "../screen.png", "image/png"],
      // Said to be a picture and not one by its bytes; and one kind said, another sent.
      [new TextEncoder().encode("<script>alert(1)</script>"), "screen.png", "image/png"],
      [PNG, "screen.gif", "image/gif"],
    ] as const) {
      const refused = await upload(session, bytes, name, type);
      expect(refused.status, `${name} ${type}`).toBe(400);
    }
    expect((await upload(session, PNG, "screen.png", "image/png", noorCommand)).status).toBe(404);

    expect(
      await lastOf(
        await append(session, [event(7, { kind: "tool_result", text: "", files: [picture.id] })]),
      ),
    ).toBe(7);
    const [kept] = (await eventsOf({ cookie: alice }, session, "?after=6")).items;
    expect(kept?.files).toEqual([picture]);
    // An event names its own session's pictures: not one never handed in, not another session's.
    const unknown = await append(session, [
      event(8, { files: ["0199c4d8-0000-7000-8000-00000000dead"] }),
    ]);
    expect(unknown.status).toBe(400);
    expect(await errorOf(unknown)).toBe("transcript.unknown_file");
    const elsewhere = await begin(noorCommand);
    const theirPicture = restTranscriptFileSchema.parse(
      await (await upload(elsewhere.id, PNG, "theirs.png", "image/png", noorCommand)).json(),
    );
    const borrowed = await append(session, [event(8, { files: [theirPicture.id] })]);
    expect(borrowed.status).toBe(400);
    expect(await errorOf(borrowed)).toBe("transcript.unknown_file");

    // Read back as a picture shown in place, never sniffed and never run.
    const read = await get({ cookie: alice }, theirs(session, "files", picture.id));
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(read.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
    expect((await get({ cookie: bob }, theirs(session, "files", picture.id))).status).toBe(403);
    expect((await get({ cookie: alice }, theirs(session, "files", theirPicture.id))).status).toBe(
      404,
    );
    expect((await get({ cookie: alice }, theirs(session, "files", "x"))).status).toBe(404);
  });

  it("is read by the account's supervisors and by the account, and by nobody else", async () => {
    const listed = restAgentSessionsSchema.parse(
      await (await get({ cookie: alice }, THEIRS)).json(),
    );
    expect(listed.items.map((item) => [item.id === session, item.ended, item.events])).toEqual([
      [true, null, 7],
      [false, "taken_over", 1],
    ]);
    expect(listed.more).toBe(false);
    const page = restAgentSessionsSchema.parse(
      await (await get({ cookie: alice }, `${THEIRS}?limit=1`)).json(),
    );
    expect(page.items.map((item) => item.id)).toEqual([session]);
    expect(page.more).toBe(true);
    const before = restAgentSessionsSchema.parse(
      await (
        await get(
          { cookie: alice },
          `${THEIRS}?before=${encodeURIComponent(page.items[0]?.startedAt ?? "")}`,
        )
      ).json(),
    );
    expect(before.items.map((item) => item.ended)).toEqual(["taken_over"]);
    for (const query of ["limit=0", "limit=1000", "limit=x", "before=yesterday"]) {
      expect((await get({ cookie: alice }, `${THEIRS}?${query}`)).status, query).toBe(400);
    }

    // A page of the events, from a number on.
    const some = await eventsOf({ cookie: alice }, session, "?after=2&limit=2");
    expect(some.items.map((item) => item.n)).toEqual([3, 4]);
    expect(some.more).toBe(true);
    for (const query of ["after=-1", "after=x", "limit=0", "limit=100000"]) {
      expect(
        (await get({ cookie: alice }, `${theirs(session, "events")}?${query}`)).status,
        query,
      ).toBe(400);
    }

    // The account reads its own, as `me` or by its handle, on a session of its own.
    for (const [headers, path] of [
      [bearer(command), OWN],
      [{ cookie: mira }, OWN],
      [{ cookie: mira }, THEIRS],
      [bearer(command), agentPath("me", "sessions", session, "events")],
    ] as const) {
      expect((await get(headers, path)).status, path).toBe(200);
    }
    const made = await send(fromPages(mira), "POST", REST_ROUTES.tokens, { name: "a reader" });
    const helper = restTokenCreatedSchema.parse(await made.json()).secret;
    const withToken = await get(bearer(helper), OWN);
    expect(withToken.status).toBe(403);
    expect(await errorOf(withToken)).toBe("agent.own_command");
    expect((await get(bearer(helper), THEIRS)).status).toBe(403);

    // Whoever sees the account and does not supervise it reads none of it; nor does another account.
    for (const path of [
      THEIRS,
      theirs(session),
      theirs(session, "events"),
      theirs(session, "events", "stream"),
      theirs(session, "events", "1", "text"),
    ]) {
      const refused = await get({ cookie: bob }, path);
      expect(refused.status, path).toBe(403);
      expect(await errorOf(refused)).toBe("auth.forbidden");
      expect((await get(bearer(noorCommand), path)).status, path).toBe(403);
      expect((await get({}, path)).status, path).toBe(401);
    }
    expect((await get({ cookie: bob }, OWN)).status).toBe(404);
    // A session is found under its own account alone.
    expect((await get({ cookie: alice }, agentPath("noor", "sessions", session))).status).toBe(404);
    expect((await get({ cookie: alice }, theirs("not-an-id"))).status).toBe(404);
    expect((await get({ cookie: alice }, agentPath("nobody", "sessions"))).status).toBe(404);

    // Nothing of a transcript is on the board's feed.
    const feed = await (await get({ cookie: alice }, `${REST_ROUTES.events}?after=0`)).text();
    expect(feed).not.toContain("Event 1.");
    expect(feed).not.toContain("session");
  });

  it("names the session on a run the account's command begins while one is open", async () => {
    const task = restTaskSchema.parse(
      await (
        await send(fromPages(alice), "POST", `${projectPath("ops")}/tasks`, {
          title: "Check the release",
        })
      ).json(),
    );
    const runs = `${projectPath("ops")}/runs`;
    const begun = await send(bearer(command), "POST", runs, { taskId: task.id });
    expect(begun.status).toBe(201);
    expect(restRunSchema.parse(await begun.json()).sessionId).toBe(session);
    // A person's agent works in no session of a runner.
    const made = await send(fromPages(alice), "POST", REST_ROUTES.tokens, { name: "Claude Code" });
    const alicesAgent = restTokenCreatedSchema.parse(await made.json()).secret;
    const theirsRun = await send(bearer(alicesAgent), "POST", runs, { taskId: task.id });
    expect(restRunSchema.parse(await theirsRun.json()).sessionId).toBeNull();
  });

  it("streams the events of a session as they are appended, and says when it is over", async () => {
    const stream = await h.request(`${theirs(session, "events", "stream")}?after=5`, {
      headers: { cookie: alice, accept: "text/event-stream" },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reading = tail(stream);
    const first = blocksOf(await reading.until((text) => text.includes("id: 7")));
    expect(first.map((block) => [block.id, block.event])).toEqual([
      ["6", "event"],
      ["7", "event"],
    ]);
    expect(restTranscriptEventSchema.parse(first[0]?.data)).toMatchObject({ n: 6, whole: 60_000 });

    await append(session, [
      event(8, { kind: "person", text: "Hold the release.", data: { signal: 3 } }),
    ]);
    const carried = blocksOf(await reading.until((text) => text.includes("id: 8")));
    expect(restTranscriptEventSchema.parse(carried.at(-1)?.data)).toMatchObject({
      n: 8,
      kind: "person",
      text: "Hold the release.",
      data: { signal: 3 },
    });
    await reading.until((text) => text.includes(": ping"));

    // Where the reader says it was wins over the query, as a connection made again says it.
    const again = await h.request(`${theirs(session, "events", "stream")}?after=0`, {
      headers: { ...bearer(command), "last-event-id": "7" },
    });
    const resumed = tail(again);
    expect(
      blocksOf(await resumed.until((text) => text.includes("data:"))).map((block) => block.id),
    ).toEqual(["8"]);
    await resumed.cancel();
    expect(
      (await get({ cookie: alice }, `${theirs(session, "events", "stream")}?after=x`)).status,
    ).toBe(400);

    // The runner ends the session: the stream carries what was left, says so, and ends.
    await append(session, [event(9, { kind: "status", text: "The session ended." })]);
    const ended = await send(bearer(command), "POST", own(session, "end"), { how: "stopped" });
    expect(ended.status).toBe(200);
    expect(restAgentSessionSchema.parse(await ended.json())).toMatchObject({
      id: session,
      ended: "stopped",
      events: 9,
    });
    const rest = blocksOf(await reading.until((text) => text.includes("event: end")));
    expect(rest.map((block) => block.event).slice(-2)).toEqual(["event", "end"]);
    expect(restAgentSessionSchema.parse(rest.at(-1)?.data)).toMatchObject({
      id: session,
      ended: "stopped",
    });
    await reading.until(() => false).catch(() => undefined);
    expect(reading.ended).toBe(true);

    // Ended already, it stays as it ended, and takes nothing more.
    const twice = await send(bearer(command), "POST", own(session, "end"), { how: "crashed" });
    expect(restAgentSessionSchema.parse(await twice.json()).ended).toBe("stopped");
    const late = await append(session, [event(10)]);
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe("transcript.session_over");
    expect((await upload(session, PNG, "late.png", "image/png")).status).toBe(409);
    for (const body of [{}, { how: "taken_over" }, { how: "bored" }]) {
      expect((await send(bearer(command), "POST", own(session, "end"), body)).status).toBe(400);
    }
    expect(
      (await send(bearer(noorCommand), "POST", own(session, "end"), { how: "exited" })).status,
    ).toBe(404);
    // A stream of a session that is over carries it whole and ends.
    const whole = tail(
      await h.request(theirs(session, "events", "stream"), { headers: { cookie: alice } }),
    );
    const all = blocksOf(await whole.until((text) => text.includes("event: end")));
    expect(all).toHaveLength(10);
  });

  it("is sealed by an administrator alone: what an event held is replaced by who sealed it and why", async () => {
    // Its manager supervises it and reads its transcript, and seals nothing.
    await send(fromPages(alice), "PATCH", `${REST_ROUTES.people}/${miraId}`, { managerId: bobId });
    expect((await get({ cookie: bob }, theirs(session, "events"))).status).toBe(200);
    const seal = (n: number | string) => theirs(session, "events", String(n), "seal");
    const byManager = await send(fromPages(bob), "POST", seal(6), { reason: "A token in it." });
    expect(byManager.status).toBe(403);
    expect(await errorOf(byManager)).toBe("auth.forbidden");
    const elsewhere = await send({ cookie: alice }, "POST", seal(6), { reason: "A token in it." });
    expect(elsewhere.status).toBe(403);
    expect(await errorOf(elsewhere)).toBe("auth.forbidden_origin");
    for (const body of [{}, { reason: "   " }, { reason: "x".repeat(600) }]) {
      expect((await send(fromPages(alice), "POST", seal(6), body)).status).toBe(400);
    }
    expect((await send(fromPages(alice), "POST", seal(99), { reason: "None." })).status).toBe(404);
    expect((await send(fromPages(alice), "POST", seal("x"), { reason: "None." })).status).toBe(404);

    // The long text of event 6, and the picture of event 7.
    const picture = (await eventsOf({ cookie: alice }, session, "?after=6&limit=1")).items[0]
      ?.files[0];
    const sealed = await send(fromPages(alice), "POST", seal(6), { reason: "A token in it." });
    expect(sealed.status).toBe(200);
    expect(restTranscriptEventSchema.parse(await sealed.json())).toMatchObject({
      n: 6,
      kind: "thinking",
      text: "",
      whole: null,
      data: {},
      files: [],
      sealed: { by: { login: "Alice" }, reason: "A token in it." },
    });
    expect(
      restTranscriptTextSchema.parse(
        await (await get({ cookie: alice }, theirs(session, "events", "6", "text"))).json(),
      ).text,
    ).toBe("");
    // Its bytes are off the month's shelf, since nothing else named them.
    expect((await raw(`select size from transcript.blobs where size = 60000`)).rows).toEqual([]);
    await send(fromPages(alice), "POST", seal(7), { reason: "A customer's screen." });
    expect(
      (await get({ cookie: alice }, theirs(session, "files", picture?.id ?? "x"))).status,
    ).toBe(404);
    // Sealed already, it stays as it was sealed.
    const again = await send(fromPages(alice), "POST", seal(6), { reason: "Something else." });
    expect(restTranscriptEventSchema.parse(await again.json()).sealed?.reason).toBe(
      "A token in it.",
    );
    // The rest of the session is as it was, in its numbers.
    const read = await eventsOf({ cookie: bob }, session);
    expect(read.items.map((item) => [item.n, item.sealed === null])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
      [5, true],
      [6, false],
      [7, false],
      [8, true],
      [9, true],
    ]);
  });

  it("keeps the bytes two events share until neither is left, and bounds how fast pictures come", async () => {
    const next = (await begin()).id;
    const long = `A long answer. ${"x".repeat(40_000)}`;
    await append(next, [event(1, { text: long }), event(2, { text: long })]);
    const kept = () => raw(`select size from transcript.blobs where size = ${long.length}`);
    expect((await kept()).rows).toHaveLength(1);
    const seal = (n: number) =>
      send(
        fromPages(alice),
        "POST",
        agentPath("mira", "sessions", next, "events", String(n), "seal"),
        {
          reason: "Said twice.",
        },
      );
    await seal(1);
    expect((await kept()).rows).toHaveLength(1);
    expect(
      restTranscriptTextSchema.parse(
        await (
          await get({ cookie: alice }, agentPath("mira", "sessions", next, "events", "2", "text"))
        ).json(),
      ).text,
    ).toBe(long);
    await seal(2);
    expect((await kept()).rows).toHaveLength(0);

    // So many pictures a minute and no more.
    for (let index = 0; index < MAX_TRANSCRIPT_FILES_PER_MINUTE; index += 1) {
      const handed = await upload(next, PNG, `shot-${index}.png`, "image/png");
      expect(handed.status).toBe(201);
    }
    const over = await upload(next, PNG, "one-more.png", "image/png");
    expect(over.status).toBe(429);
    expect(await errorOf(over)).toBe("transcript.too_fast");
  });

  it("still lists a session whose month is put away, and reads it again when the month is back", async () => {
    const suffix = MONTH.replace("-", "_");
    await raw(`alter table transcript.events detach partition transcript.events_${suffix}`);
    try {
      const away = await sessionOf({ cookie: alice }, session);
      expect(away).toMatchObject({ id: session, events: 9, ended: "stopped", away: true });
      expect(await eventsOf({ cookie: alice }, session)).toEqual({ items: [], more: false });
      const listed = restAgentSessionsSchema.parse(
        await (await get({ cookie: alice }, THEIRS)).json(),
      );
      expect(listed.items.every((item) => item.away)).toBe(true);
      // An open session of that month takes nothing more, and says why.
      const open = listed.items.find((item) => item.ended === null);
      const refused = await append(open?.id ?? "", [event(3)]);
      expect(refused.status).toBe(409);
      expect(await errorOf(refused)).toBe("transcript.away");
    } finally {
      await raw(
        `alter table transcript.events attach partition transcript.events_${suffix} for values in ('${MONTH}')`,
      );
    }
    expect((await sessionOf({ cookie: alice }, session)).away).toBe(false);
    expect((await eventsOf({ cookie: alice }, session)).items).toHaveLength(9);
  });

  it("has its months made ahead of time by the worker", async () => {
    const watch = new RunnerWatch({
      database: testDatabase.database,
      clock: { now: () => new Date("2031-12-15T00:00:00.000Z") },
      logger: pino({ level: "silent" }),
    });
    await watch.sweep();
    await watch.close();
    const months = await attachedMonths(testDatabase.database);
    expect([...months].sort()).toEqual([MONTH, "2031-12", "2032-01"]);
    // Each month a table of the events, of the pictures and of the bytes.
    const tables = await raw(
      `select relname from pg_class join pg_namespace on pg_namespace.oid = relnamespace where nspname = 'transcript' and relname like '%_2032_01' order by relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual([
      "blobs_2032_01",
      "events_2032_01",
      "files_2032_01",
    ]);
  });
});
