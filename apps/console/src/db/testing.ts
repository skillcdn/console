import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { createDatabase, type Database } from "./client.js";
import { migrateDatabase } from "./migrate.js";

// Support for integration tests: a database of their own per test file. Not compiled into dist.

/** Where `deploy/compose.dev.yaml` listens. Tests use it unless TEST_DATABASE_URL says otherwise. */
export const DEV_DATABASE_URL = "postgres://console:console-dev-only@127.0.0.1:5433/console";

export interface TestDatabase {
  readonly database: Database;
  readonly connectionString: string;
  /** Closes the pool and drops the database; leaves the database where it was made to be kept. */
  drop(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** A name to use as it is, made when it is not there: for a preview that starts from where it left off. */
  readonly name?: string | undefined;
  /** Whether `drop` leaves the database, for the next run to start from. */
  readonly keep?: boolean | undefined;
}

/**
 * Creates a database of its own for one test file and migrates it with the real migrations, so
 * files run in parallel without seeing each other. `adminUrl` needs the right to create databases.
 * A database named is used as it is, made when it is not there and migrated up to date.
 */
export async function createTestDatabase(
  adminUrl: string,
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  const name = options.name ?? `console_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      "integration tests need PostgreSQL: run `docker compose -f deploy/compose.dev.yaml up -d`, or point TEST_DATABASE_URL at a server",
      { cause: error },
    );
  }
  try {
    const found = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (found.rowCount === 0) {
      // Identifiers cannot be bound as parameters; escaping is the supported way to pass one.
      await admin.query(`create database ${admin.escapeIdentifier(name)}`);
    }
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const connectionString = url.href;
  await migrateDatabase(connectionString);
  const database = createDatabase({ connectionString, maxConnections: 4 });

  return {
    database,
    connectionString,
    drop: async () => {
      await database.close();
      if (options.keep === true) {
        return;
      }
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(
          `drop database if exists ${cleanup.escapeIdentifier(name)} with (force)`,
        );
      } finally {
        await cleanup.end();
      }
    },
  };
}
