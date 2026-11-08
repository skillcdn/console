import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import type { PluginHookEvent } from "@skillcdn/console/plugin";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { emitPluginEvent } from "../db/queries/plugin-board.js";
import { ensureWorkspace, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import type { Logger } from "../logger.js";
import { type Dispatching, type DispatchTarget, PluginDispatcher } from "./dispatcher.js";
import type { CallResult } from "./protocol.js";
import { PluginScheduler } from "./scheduler.js";

// The dispatcher against a real database, with plugins of its own making: a few delivered to at
// a time, so that more plugins than the pool has connections are all delivered to and the pool
// keeps room for the rest; each plugin's lock held for as long as its delivery takes, whatever
// the server lets a transaction idle; and that lock apart from every job's.

let testDatabase: TestDatabase;
let workspace: WorkspaceRecord;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
});

afterAll(async () => {
  await testDatabase?.drop();
});

const clock = { now: () => new Date() };
const delivered: CallResult = { ok: true, value: null };

/** A plugin that hears `ping` from `source`, and nothing else. */
function target(key: string, source: string): DispatchTarget {
  return {
    key,
    hooks: [`plugin:${source}:ping`],
    consent: ["events:plugins"],
    boardProjectId: undefined,
    projects: [],
  };
}

function plugins(
  targets: readonly DispatchTarget[],
  hook: (key: string, event: PluginHookEvent) => Promise<CallResult>,
): Dispatching {
  return {
    hookTargets: async () => [...targets],
    runHook: (key, _name, event) => hook(key, event),
    recordFailure: async () => {},
  };
}

/** A logger whose warnings the test reads. */
function capture(): { logger: Logger; warnings: () => string[] } {
  const lines: { msg?: string }[] = [];
  const logger = pino(
    { level: "warn" },
    { write: (line: string) => lines.push(JSON.parse(line) as { msg?: string }) },
  );
  return { logger, warnings: () => lines.map((line) => line.msg ?? "") };
}

async function ping(source: string): Promise<number> {
  return emitPluginEvent(testDatabase.database, {
    workspaceId: workspace.id,
    key: source,
    kind: "ping",
    data: null,
    now: new Date(),
  });
}

function dispatcherOn(database: Database, through: Dispatching, logger: Logger): PluginDispatcher {
  return new PluginDispatcher({
    database,
    workspace: async () => workspace,
    plugins: through,
    clock,
    logger,
  });
}

describe("the dispatcher", () => {
  it("delivers to more plugins with hooks than the pool has connections, each hook free to use the pool", async () => {
    // Six plugins on a pool of four. Side by side, each held a connection for its lock and waited
    // for another for its queries, until every one of them ran out of time.
    const keys = ["pool-a", "pool-b", "pool-c", "pool-d", "pool-e", "pool-f"];
    const heard: string[] = [];
    const { logger, warnings } = capture();
    const dispatcher = dispatcherOn(
      testDatabase.database,
      plugins(
        keys.map((key) => target(key, "pool-source")),
        async (key) => {
          // A hook's calls on ctx take connections of the same pool.
          if (await testDatabase.database.ping()) {
            heard.push(key);
          }
          return delivered;
        },
      ),
      logger,
    );
    await dispatcher.dispatch();
    await ping("pool-source");
    await dispatcher.dispatch();
    expect(heard.sort()).toEqual(keys);
    expect(warnings()).toEqual([]);
  });

  it("delivers to a quarter of the pool's connections at once, at least one", async () => {
    const keys = ["lane-a", "lane-b", "lane-c", "lane-d", "lane-e", "lane-f"];
    for (const [connections, lanes] of [
      [4, 1],
      [10, 2],
    ] as const) {
      const database = createDatabase({
        connectionString: testDatabase.connectionString,
        maxConnections: connections,
      });
      try {
        let inFlight = 0;
        let most = 0;
        const { logger } = capture();
        const dispatcher = dispatcherOn(
          database,
          plugins(
            keys.map((key) => target(`${key}-${connections}`, `lane-source-${connections}`)),
            async () => {
              inFlight += 1;
              most = Math.max(most, inFlight);
              await sleep(150);
              inFlight -= 1;
              return delivered;
            },
          ),
          logger,
        );
        await dispatcher.dispatch();
        await ping(`lane-source-${connections}`);
        await dispatcher.dispatch();
        expect({ connections, most }).toEqual({ connections, most: lanes });
      } finally {
        await database.close();
      }
    }
  });

  it("holds a plugin's lock for as long as its delivery takes, past the server's idle timeout", async () => {
    // Two processes, each with a pool whose idle transactions the server ends after a second,
    // and a hook that takes longer: the lock went with the session, and the second process
    // delivered the same event while the first was still at it.
    const first = createDatabase({
      connectionString: testDatabase.connectionString,
      maxConnections: 4,
      idleInTransactionMs: 1_000,
    });
    const second = createDatabase({
      connectionString: testDatabase.connectionString,
      maxConnections: 4,
      idleInTransactionMs: 1_000,
    });
    try {
      let running = 0;
      let overlapped = false;
      const heard: string[] = [];
      const through = plugins([target("slow", "slow-source")], async (_key, event) => {
        running += 1;
        overlapped ||= running > 1;
        await sleep(2_500);
        heard.push(event.id);
        running -= 1;
        return delivered;
      });
      const { logger, warnings } = capture();
      const one = dispatcherOn(first, through, logger);
      const two = dispatcherOn(second, through, logger);
      await one.dispatch();
      const id = await ping("slow-source");
      const delivering = one.dispatch();
      await sleep(1_500);
      await two.dispatch();
      await delivering;
      expect(overlapped).toBe(false);
      expect(heard).toEqual([`plugin:${id}`]);
      expect(warnings()).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("delivers to a plugin while its job named dispatch runs: no job shares a plugin's lock", async () => {
    const heard: string[] = [];
    let entered: () => void = () => {};
    const jobEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish: () => void = () => {};
    const jobDone = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let at = new Date("2026-11-08T09:00:00.000Z");
    const { logger, warnings } = capture();
    const scheduler = new PluginScheduler({
      database: testDatabase.database,
      workspace: async () => workspace,
      plugins: {
        jobTargets: async () => [
          {
            key: "both",
            boardProjectId: undefined,
            jobs: { dispatch: { every: "PT5M", at: null } },
          },
        ],
        runJob: async () => {
          entered();
          await jobDone;
          return delivered;
        },
        recordFailure: async () => {},
      },
      clock: { now: () => at },
      logger,
    });
    const dispatcher = dispatcherOn(
      testDatabase.database,
      plugins([target("both", "both-source")], async (_key, event) => {
        heard.push(event.id);
        return delivered;
      }),
      logger,
    );
    await dispatcher.dispatch();
    // The scheduler sees the job, which runs a period later, and holds its lock while it runs.
    await scheduler.tick();
    at = new Date(at.getTime() + 5 * 60_000);
    const running = scheduler.tick();
    await jobEntered;
    const id = await ping("both-source");
    await dispatcher.dispatch();
    finish();
    await running;
    expect(heard).toEqual([`plugin:${id}`]);
    expect(warnings()).toEqual([]);
  });
});
