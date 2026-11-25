import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import type { PluginHookEvent } from "@skillcdn/console/plugin";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database, drizzleOf } from "../db/client.js";
import { moveWakeCursor, takeWakeCursor } from "../db/queries/board-wakes.js";
import { holdEventOrder } from "../db/queries/event-order.js";
import { recordEvent } from "../db/queries/events.js";
import { makeNotification } from "../db/queries/notifications.js";
import { emitPluginEvent } from "../db/queries/plugin-board.js";
import { ensureWorkspace, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { people, pluginEvents, projects } from "../db/schema.js";
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

/**
 * A change that is given its event's number and is slow to commit: resolves `numbered` once the
 * number is given, and commits when `commit` is called.
 */
function slowChange(write: (tx: Parameters<typeof recordEvent>[0]) => Promise<unknown>) {
  let commit: () => void = () => {};
  let wasNumbered: () => void = () => {};
  const mayCommit = new Promise<void>((resolve) => {
    commit = resolve;
  });
  const numbered = new Promise<void>((resolve) => {
    wasNumbered = resolve;
  });
  const done = drizzleOf(testDatabase.database).transaction(async (tx) => {
    await write(tx);
    wasNumbered();
    await mayCommit;
  });
  return { numbered, commit, done };
}

describe("the order of the streams the dispatcher reads (ADR-0125)", () => {
  it("delivers a plugin's event numbered before another and committed after it, in the order they were numbered", async () => {
    const heard: unknown[] = [];
    const { logger } = capture();
    const dispatcher = dispatcherOn(
      testDatabase.database,
      plugins([target("order-listener", "order-source")], async (_key, event) => {
        heard.push(event.data);
        return delivered;
      }),
      logger,
    );
    await dispatcher.dispatch();
    // As `emitPluginEvent` writes one, in a transaction held open past the next event's.
    const slow = slowChange(async (tx) => {
      await holdEventOrder(tx, "plugin");
      await tx.insert(pluginEvents).values({
        workspaceId: workspace.id,
        pluginKey: "order-source",
        kind: "ping",
        data: "numbered first",
        createdAt: new Date(),
      });
    });
    try {
      await slow.numbered;
      await emitPluginEvent(testDatabase.database, {
        workspaceId: workspace.id,
        key: "order-source",
        kind: "ping",
        data: "numbered second",
        now: new Date(),
      });
      await dispatcher.dispatch();
      // Nothing yet: the second is committed, and beyond what has settled.
      expect(heard).toEqual([]);
    } finally {
      slow.commit();
      await slow.done;
    }
    await dispatcher.dispatch();
    await dispatcher.dispatch();
    expect(heard).toEqual(["numbered first", "numbered second"]);
  });

  it("delivers a console event numbered before another and committed after it, the same", async () => {
    const heard: string[] = [];
    const { logger } = capture();
    const listener: DispatchTarget = {
      key: "order-console",
      hooks: ["console:plugin.failed"],
      consent: ["events:console"],
      boardProjectId: undefined,
      projects: [],
    };
    const dispatcher = dispatcherOn(
      testDatabase.database,
      plugins([listener], async (_key, event) => {
        heard.push(event.id);
        return delivered;
      }),
      logger,
    );
    await dispatcher.dispatch();
    // Two events the plugin itself caused, which concern it whatever it may read.
    const failure = (tx: Parameters<typeof recordEvent>[0], problem: string) =>
      recordEvent(tx, {
        workspaceId: workspace.id,
        kind: "plugin.failed",
        actor: undefined,
        plugin: "order-console",
        data: { key: "order-console", problem },
        now: new Date(),
      });
    let first = 0;
    const slow = slowChange(async (tx) => {
      first = await failure(tx, "numbered first");
    });
    let second = 0;
    try {
      await slow.numbered;
      second = await drizzleOf(testDatabase.database).transaction((tx) =>
        failure(tx, "numbered second"),
      );
      expect(second).toBeGreaterThan(first);
      await dispatcher.dispatch();
      expect(heard).toEqual([]);
    } finally {
      slow.commit();
      await slow.done;
    }
    await dispatcher.dispatch();
    await dispatcher.dispatch();
    expect(heard).toEqual([`console:${first}`, `console:${second}`]);
  });

  it("counts a hook the console could not call as a try that failed, and skips the event after the last with the failure recorded", async () => {
    const failures: string[] = [];
    const heard: unknown[] = [];
    const { logger, warnings } = capture();
    const dispatcher = new PluginDispatcher({
      database: testDatabase.database,
      workspace: async () => workspace,
      plugins: {
        hookTargets: async () => [target("gone-listener", "gone-source")],
        runHook: async (_key, _name, event) => {
          if (event.data === "never ready") {
            throw new Error("the host is gone");
          }
          heard.push(event.data);
          return delivered;
        },
        recordFailure: async (_key, _projectId, problem) => {
          failures.push(problem);
        },
      },
      clock,
      logger,
      retries: 2,
      backoffMs: () => 0,
    });
    await dispatcher.dispatch();
    for (const data of ["never ready", "after it"]) {
      await emitPluginEvent(testDatabase.database, {
        workspaceId: workspace.id,
        key: "gone-source",
        kind: "ping",
        data,
        now: new Date(),
      });
    }
    // The first try leaves the plugin at the event; the second skips it and goes on.
    await dispatcher.dispatch();
    expect([heard, failures]).toEqual([[], []]);
    await dispatcher.dispatch();
    expect(heard).toEqual(["after it"]);
    expect(failures).toEqual([
      expect.stringMatching(
        /^the hook plugin:gone-source:ping failed 2 times on plugin event \d+ \(plugin\.failed\); the event was skipped$/,
      ),
    ]);
    expect(warnings().filter((line) => line === "a hook could not be called")).toHaveLength(2);
  });
});

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

describe("the projects a plugin is on", () => {
  it("are those the administrator named, and it hears what happens there with no page of its own in one", async () => {
    const database = testDatabase.database;
    const made = await drizzleOf(database)
      .insert(projects)
      .values(
        ["placed-on", "elsewhere"].map((key) => ({
          workspaceId: workspace.id,
          key,
          name: key,
        })),
      )
      .returning({ id: projects.id, key: projects.key });
    const idOf = (key: string) => made.find((project) => project.key === key)?.id ?? "";
    const heard = new Map<string, string[]>();
    const { logger, warnings } = capture();
    // A target names no page and no collection: where the plugin is placed is all there is.
    const listener = (key: string, on: DispatchTarget["projects"]): DispatchTarget => ({
      key,
      hooks: ["console:task.created"],
      consent: ["events:console"],
      boardProjectId: undefined,
      projects: on,
    });
    const dispatcher = dispatcherOn(
      database,
      plugins(
        [listener("on-all", "all"), listener("on-one", ["placed-on"]), listener("on-none", [])],
        async (key, event) => {
          heard.set(key, [...(heard.get(key) ?? []), event.id]);
          return delivered;
        },
      ),
      logger,
    );
    await dispatcher.dispatch();
    const created = (key: string) =>
      drizzleOf(database).transaction((tx) =>
        recordEvent(tx, {
          workspaceId: workspace.id,
          projectId: idOf(key),
          kind: "task.created",
          actor: undefined,
          data: {},
          now: new Date(),
        }),
      );
    const here = await created("placed-on");
    const there = await created("elsewhere");
    await dispatcher.dispatch();
    expect(heard.get("on-all")).toEqual([`console:${here}`, `console:${there}`]);
    expect(heard.get("on-one")).toEqual([`console:${here}`]);
    expect(heard.get("on-none")).toBeUndefined();
    expect(warnings()).toEqual([]);
  });
});

describe("whom the console told of an event, for a plugin that carries it elsewhere (ADR-0157)", () => {
  it("hands it with the event once the board's pass has read it, and hears nothing of it before", async () => {
    const database = testDatabase.database;
    const [person] = await drizzleOf(database)
      .insert(people)
      .values({
        workspaceId: workspace.id,
        host: "gh",
        hostAccountId: "9001",
        login: "told-of-it",
        lastLoginAt: new Date(),
      })
      .returning({ id: people.id });
    const personId = person?.id ?? "";
    const heard = new Map<string, unknown[]>();
    const { logger, warnings } = capture();
    const listener = (key: string, consent: readonly string[]): DispatchTarget => ({
      key,
      hooks: ["console:plugin.enabled"],
      consent: [...consent],
      boardProjectId: undefined,
      projects: [],
    });
    const dispatcher = dispatcherOn(
      database,
      plugins(
        [
          listener("told-carrier", ["events:console", "notifications:read"]),
          listener("told-plain", ["events:console"]),
        ],
        async (key, event) => {
          heard.set(key, [...(heard.get(key) ?? []), event.data]);
          return delivered;
        },
      ),
      logger,
    );
    // The first pass begins each plugin at the end of the streams.
    await dispatcher.dispatch();
    const happened = (key: string) =>
      drizzleOf(database).transaction((tx) =>
        recordEvent(tx, {
          workspaceId: workspace.id,
          kind: "plugin.enabled",
          actor: undefined,
          plugin: key,
          data: {},
          now: new Date(),
        }),
      );
    const first = await happened("told-carrier");
    const second = await happened("told-plain");
    await dispatcher.dispatch();
    // The one that is handed whom the console told waits for the board's pass; the other does not.
    expect(heard.get("told-carrier")).toBeUndefined();
    expect(heard.get("told-plain")).toEqual([{}]);
    // The board's pass reads the first event, and tells someone of it: woken by the console
    // itself, and told because they turned the thing on themselves, which the list says too.
    await drizzleOf(database).transaction(async (tx) => {
      await takeWakeCursor(tx, workspace.id, new Date());
      await makeNotification(tx, {
        workspaceId: workspace.id,
        personId,
        eventId: first,
        kind: "agent",
        followed: true,
        woken: true,
        projectId: undefined,
        taskId: undefined,
        decisionId: undefined,
        aboutId: undefined,
        createdAt: new Date(),
      });
      await moveWakeCursor(tx, workspace.id, first, new Date());
    });
    await dispatcher.dispatch();
    expect(heard.get("told-carrier")).toEqual([
      { told: [{ personId, kind: "agent", woken: true, followed: true }] },
    ]);
    // The next waits for the pass in its turn, and is handed an empty list where nobody was
    // told of it: a list, and not one left out.
    await drizzleOf(database).transaction((tx) =>
      moveWakeCursor(tx, workspace.id, second, new Date()),
    );
    const third = await happened("told-carrier");
    await dispatcher.dispatch();
    expect(heard.get("told-carrier")).toHaveLength(1);
    await drizzleOf(database).transaction((tx) =>
      moveWakeCursor(tx, workspace.id, third, new Date()),
    );
    await dispatcher.dispatch();
    expect(heard.get("told-carrier")?.[1]).toEqual({ told: [] });
    // Whoever is not handed it is handed none, whatever the pass has read.
    expect(heard.get("told-plain")).toEqual([{}]);
    expect(warnings()).toEqual([]);
  });
});
