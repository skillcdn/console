import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, drizzleOf } from "./client.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

// The pool against a real server: what it says of itself, and a session the server ends under a
// transaction that waits on other work.

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the pool", () => {
  it("says how many connections it opens at most, ten unless told", async () => {
    expect(testDatabase.database.maxConnections).toBe(4);
    const pool = createDatabase({ connectionString: testDatabase.connectionString });
    try {
      expect(pool.maxConnections).toBe(10);
    } finally {
      await pool.close();
    }
  });

  it("fails the transaction whose session the server ended while it waited, and goes on", async () => {
    const database = createDatabase({
      connectionString: testDatabase.connectionString,
      maxConnections: 2,
      idleInTransactionMs: 200,
    });
    try {
      // Idle in the transaction past its bound: the server ends the session under it. Without a
      // listener on the checked-out client, that ended the process.
      await expect(
        drizzleOf(database).transaction(async (tx) => {
          await tx.execute(sql`select 1`);
          await sleep(1_000);
        }),
      ).rejects.toThrow();
      expect(await database.ping()).toBe(true);
    } finally {
      await database.close();
    }
  });
});
