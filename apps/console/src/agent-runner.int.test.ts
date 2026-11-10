import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  MAX_RUNNER_LINE_LENGTH,
  MAX_RUNNER_OFFERS,
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
} from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noteUnheardRunners } from "./db/queries/agent-runners.js";
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
  runner: "0.4.8",
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
      runner: "0.4.8",
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
    await refused(beat({ runner: `0.4.8${String.fromCodePoint(0x202e)}` }));
    await refused(beat({ runner: "0.4.8\n<script>" }));
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
      { kind: "interrupt", text: "   " },
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
    const page = restSignalsSchema.parse(
      await (await get({ cookie: alice }, `${SIGNALS}?limit=1`)).json(),
    );
    expect(page.items.map((item) => item.number)).toEqual([2]);
    expect(page.more).toBe(true);
    const before = restSignalsSchema.parse(
      await (await get({ cookie: alice }, `${SIGNALS}?before=2`)).json(),
    );
    expect(before.items.map((item) => item.number)).toEqual([1]);
    for (const query of ["limit=0", "limit=1000", "limit=x", "before=0", "before=1.5"]) {
      expect((await get({ cookie: alice }, `${SIGNALS}?${query}`)).status, query).toBe(400);
    }
    expect((await get({ cookie: bob }, SIGNALS)).status).toBe(403);
    for (const headers of [bearer(command), { cookie: mira }]) {
      const mine = restSignalsSchema.parse(await (await get(headers, OWN_SIGNALS)).json());
      expect(mine.items.map((item) => item.number)).toEqual([2, 1]);
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
    for (const after of ["-1", "x", "1.5"]) {
      expect((await get(bearer(command), `${STREAM}?after=${after}`)).status, after).toBe(400);
    }
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

  it("carries the pictures a supervisor sends with a tell, read by the account's runner and its supervisors", async () => {
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
    const sent = await form({ kind: "tell", text: "Look at these." }, [
      [PNG, "screen.png", "image/png"],
      // What it is is read off its bytes, whatever the form called it.
      [GIF, "moving.bin", "application/octet-stream"],
    ]);
    expect(sent.status).toBe(201);
    const told = restSignalSchema.parse(await sent.json());
    expect(told).toMatchObject({ kind: "tell", text: "Look at these." });
    expect(told.attachments).toMatchObject([
      { name: "screen.png", size: PNG.byteLength, contentType: "image/png" },
      { name: "moving.bin", size: GIF.byteLength, contentType: "image/gif" },
    ]);
    expect(JSON.stringify(told)).not.toContain("sha256");
    const [first, second] = told.attachments;
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

    // A few pictures, pictures by their bytes, with a tell or an interrupt, and what says which.
    for (const [signal, files] of [
      [
        { kind: "tell", text: "Too many." },
        Array.from({ length: 5 }, () => [PNG, "a.png", "image/png"]),
      ],
      [
        { kind: "tell", text: "Not a picture." },
        [[new TextEncoder().encode("<script>alert(1)</script>"), "page.png", "image/png"]],
      ],
      [
        { kind: "tell", text: "A drawing that runs." },
        [[new TextEncoder().encode("<svg onload=alert(1)>"), "x.svg", "image/svg+xml"]],
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
});
