import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client.js";
import { ensureWorkspace, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { PluginScheduler, type Scheduling } from "./scheduler.js";

// The scheduler against a real database: a job's lock held for as long as the job runs, whatever
// the server lets a transaction idle, so that two processes never run one job at once.

let testDatabase: TestDatabase;
let workspace: WorkspaceRecord;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the scheduler", () => {
  it("holds a job's lock for as long as the job runs, past the server's idle timeout", async () => {
    // Two processes, each with a pool whose idle transactions the server ends after a second,
    // and a job that runs longer: the lock went with the session, and the second process ran the
    // job again while the first was still at it.
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
      let ran = 0;
      const jobs: Scheduling = {
        jobTargets: async () => [
          { key: "long", boardProjectId: undefined, jobs: { report: { every: "PT5M", at: null } } },
        ],
        runJob: async () => {
          running += 1;
          overlapped ||= running > 1;
          await sleep(2_500);
          ran += 1;
          running -= 1;
          return { ok: true, value: null };
        },
        recordFailure: async () => {},
      };
      const warnings: string[] = [];
      const logger = pino(
        { level: "warn" },
        { write: (line: string) => warnings.push((JSON.parse(line) as { msg: string }).msg) },
      );
      let at = new Date("2026-11-08T09:00:00.000Z");
      const clock = { now: () => at };
      const one = new PluginScheduler({
        database: first,
        workspace: async () => workspace,
        plugins: jobs,
        clock,
        logger,
      });
      const two = new PluginScheduler({
        database: second,
        workspace: async () => workspace,
        plugins: jobs,
        clock,
        logger,
      });
      // The job is seen, and runs a period later.
      await one.tick();
      at = new Date(at.getTime() + 5 * 60_000);
      const ticking = one.tick();
      await sleep(1_500);
      await two.tick();
      await ticking;
      expect(overlapped).toBe(false);
      expect(ran).toBe(1);
      expect(warnings).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
