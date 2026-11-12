import {
  agentPath,
  CLAIM_PATH,
  connectPath,
  createClient,
  REST_ROUTES,
  restAgentSchema,
  restAgentSessionsSchema,
  restClaimSchema,
  restConnectionSchema,
  restSignalSchema,
  restTranscriptEventsSchema,
} from "@skillcdn/console/api";
import {
  createRunner,
  DEFAULT_RUNNER_CONFIG,
  type Driver,
  type DriverEvent,
  type DriverMessage,
  type StartOptions,
  WITHHELD,
} from "@skillcdn/console/runner";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// The runner the package ships against the console itself (ADR-0085, ADR-0086): a supervisor's
// signal travels the stream to the runner, reaches a product the test speaks for, and what the
// product does comes back as the session's transcript. The two halves are tested apart
// elsewhere; this is the proof that they are halves of one thing. On a database of its own.

let testDatabase: TestDatabase;
let h: Harness;
let alice: string;
let command: string;

const TOKEN = "not-a-real-token-4f9a2c71";
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(what: string, read: () => Promise<T | undefined>, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`waited in vain for ${what}`);
    }
    await sleep(20);
  }
}
const tell = async (body: unknown) =>
  restSignalSchema.parse(
    await (await send(fromPages(alice), "POST", agentPath("mira", "signals"), body)).json(),
  );
const agent = async () =>
  restAgentSchema.parse(await (await get({ cookie: alice }, agentPath("mira"))).json());
const sessions = async () =>
  restAgentSessionsSchema.parse(
    await (await get({ cookie: alice }, agentPath("mira", "sessions"))).json(),
  ).items;
const transcript = async (id: string) =>
  restTranscriptEventsSchema
    .parse(await (await get({ cookie: alice }, agentPath("mira", "sessions", id, "events"))).json())
    .items.map((event) => [event.kind, event.text] as const);

/** A product the test speaks for: it answers every message with what it was told, and says its turn is done. */
function echoingDriver() {
  const started: { options: StartOptions; sent: DriverMessage[] }[] = [];
  const driver: Driver = {
    name: "claude",
    product: { name: "Claude Code", tried: ["2.1.0"] },
    can: { steer: true, images: true, resume: true, set: false },
    permissions: { modes: ["auto", "dontAsk"], unattended: "auto", least: "dontAsk" },
    probe: async () => ({ version: "2.1.0", models: ["opus", "sonnet"], efforts: ["low", "high"] }),
    start(options) {
      const sent: DriverMessage[] = [];
      started.push({ options, sent });
      const queue: DriverEvent[] = [
        { type: "running", model: options.model, effort: options.effort, version: "2.1.0" },
        { type: "conversation", id: "c-1" },
      ];
      let wake: (() => void) | undefined;
      const emit = (...events: DriverEvent[]) => {
        queue.push(...events);
        wake?.();
      };
      return {
        send: async (message) => {
          sent.push(message);
          const said = message.text.split("\n").at(-1) ?? "";
          emit(
            {
              type: "event",
              kind: "tool_result",
              text: `GIT_TOKEN=${options.env.GIT_TOKEN ?? "none"}`,
            },
            { type: "event", kind: "assistant", text: `Heard: ${said}` },
            { type: "turn_completed" },
          );
        },
        interrupt: async () => undefined,
        set: async () => false,
        stop: async () => emit({ type: "ended", how: "exited" }),
        events: (async function* () {
          for (;;) {
            while (queue.length === 0) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
            const event = queue.shift();
            if (event === undefined) {
              continue;
            }
            yield event;
            if (event.type === "ended") {
              return;
            }
          }
        })(),
      };
    },
  };
  return { driver, started };
}

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
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  await send(fromPages(alice), "POST", REST_ROUTES.agents, {
    host: "gh",
    login: "carol",
    handle: "mira",
    name: "Mira",
    project: "ops",
  });
  const mira = await h.signIn("carol");
  const begun = await send({}, "POST", REST_ROUTES.connect, { agent: "console", as: "self" });
  const connection = restConnectionSchema.parse(await begun.json());
  await send(fromPages(mira), "POST", connectPath(connection.code, "approve"));
  const claim = restClaimSchema.parse(
    await (await send({}, "POST", CLAIM_PATH, { secret: connection.secret })).json(),
  );
  command = claim.status === "signed_in" ? claim.secret : "";
  // A secret of the account's own, which its sessions are handed and its transcript never carries.
  await send(bearer(command), "PUT", agentPath("me", "secrets", "git.token"), { value: TOKEN });
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

describe("a runner and the console, together (ADR-0085, ADR-0086)", () => {
  it("carries a supervisor's word to the agent and what the agent does back, session after session", async () => {
    const product = echoingDriver();
    const log: string[] = [];
    const runner = createRunner({
      // The command's own client, on the session of the command signed in as the account.
      client: createClient({
        baseUrl: h.origin,
        token: command,
        fetch: (input, init) => h.request(input.replace(h.origin, ""), init),
      }),
      driver: product.driver,
      config: { ...DEFAULT_RUNNER_CONFIG, secrets: { env: { GIT_TOKEN: "git.token" }, files: {} } },
      cwd: "/home/mira/desk",
      machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
      version: "0.5.0",
      now: () => Date.now(),
      random: Math.random,
      time: () => "14:02",
      files: { write: async () => undefined, remove: async () => undefined },
      state: { load: async () => undefined, save: async () => undefined },
      log: (line) => log.push(line),
      timing: { heartbeatMs: 200, batchMs: 30, groupWindowMs: 30, reconnectMs: 50 },
    });
    const done = runner.run();
    try {
      // The runner is there: the console says how the agent stands, and what its runner is.
      const there = await until("the runner's heartbeat", async () => {
        const seen = await agent();
        return seen.state?.state === "running" ? seen : undefined;
      });
      expect(there.runner).toMatchObject({
        machine: { name: "mac-mini", user: "mira" },
        product: { driver: "claude", version: "2.1.0", tried: true },
        offers: { models: ["opus", "sonnet"], efforts: ["low", "high"] },
      });

      /** The event by which the record says a turn ended: a session is read whole once it is there. */
      const turnEnded = ([kind, text]: readonly [string, string]): boolean =>
        kind === "status" && text === "The turn completed.";
      // A tell: the stream carries it, a session begins, the agent reads it under a header.
      await tell({ kind: "tell", text: "Hold the release." });
      const first = await until("the first session's transcript", async () => {
        const [open] = await sessions();
        if (open === undefined) {
          return undefined;
        }
        const events = await transcript(open.id);
        return events.some(turnEnded) ? { open, events } : undefined;
      });
      expect(first.open).toMatchObject({ ended: null, resumed: false, model: null });
      expect(first.events).toEqual([
        ["person", "Hold the release."],
        // What the product printed of the secret it was handed never left the machine.
        ["tool_result", `GIT_TOKEN=${WITHHELD}`],
        ["assistant", "Heard: Hold the release."],
        // The record says where the turn ended.
        ["status", "The turn completed."],
      ]);
      expect(product.started[0]?.options.env).toEqual({ GIT_TOKEN: TOKEN });
      expect(product.started[0]?.sent[0]?.text).toMatch(
        /^\[console [a-z0-9]{6} · session\]\n[\s\S]+\n\n\[console [a-z0-9]{6} #1 · tell · Alice Example · 14:02\]\nHold the release\.$/,
      );
      // The mark is the session's own: nothing of it is in what the console keeps.
      const mark = /^\[console ([a-z0-9]{6})/.exec(product.started[0]?.sent[0]?.text ?? "")?.[1];
      expect(JSON.stringify(first.events)).not.toContain(mark);
      await until("the delivery to be said", async () =>
        (await agent()).runner?.delivered === 1 ? true : undefined,
      );
      expect((await agent()).runner?.session).toBe(first.open.id);

      // The model is chosen: the session ends, since the product takes it when it starts, and
      // the next goes on with the conversation and runs with it.
      await tell({ kind: "set", set: { model: "sonnet" } });
      await until("the first session to end", async () =>
        (await sessions()).find((one) => one.id === first.open.id)?.ended === "restarted"
          ? true
          : undefined,
      );
      await tell({ kind: "tell", text: "Go on." });
      const second = await until("the second session", async () => {
        const [open] = await sessions();
        if (open === undefined || open.id === first.open.id) {
          return undefined;
        }
        const events = await transcript(open.id);
        return events.some(turnEnded) ? { open, events } : undefined;
      });
      expect(second.open).toMatchObject({ ended: null, resumed: true, model: "sonnet" });
      expect(product.started[1]?.options).toMatchObject({ model: "sonnet", resume: "c-1" });
      expect(second.events.slice(-2)).toEqual([
        ["assistant", "Heard: Go on."],
        ["status", "The turn completed."],
      ]);

      // A stop: the session ends as stopped, and the agent stays so.
      await tell({ kind: "stop", text: "Wait for the review." });
      const stopped = await until("the stop", async () => {
        const one = (await sessions()).find((item) => item.id === second.open.id);
        return one?.ended === "stopped" ? one : undefined;
      });
      expect((await transcript(stopped.id)).slice(-2)).toEqual([
        ["person", "Wait for the review."],
        ["status", "The session ended: stopped."],
      ]);
      await until("the state", async () =>
        (await agent()).state?.state === "stopped" ? true : undefined,
      );
      await tell({ kind: "tell", text: "Kept for later." });
      await sleep(300);
      expect(product.started).toHaveLength(2);
      // A restart: what was kept is delivered, in a third session.
      await tell({ kind: "restart" });
      await until("the third session", async () =>
        product.started.length === 3 ? true : undefined,
      );
      await until("its message", async () =>
        product.started[2]?.sent.length === 1 ? true : undefined,
      );
      expect(product.started[2]?.sent[0]?.text).toContain("Kept for later.");
    } finally {
      runner.stop();
      await done;
    }
    // Stopped, it ended what was open, and said nothing of what a signal or an event held.
    const [last] = await sessions();
    expect(last?.ended).toBe("exited");
    expect(log.join("\n")).not.toContain("Hold the release");
    expect(log.join("\n")).not.toContain(TOKEN);
  });
});
