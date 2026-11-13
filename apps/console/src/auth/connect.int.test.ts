import { CONNECT_CODE_ALPHABET } from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { Connections } from "./connect.js";
import type { Sessions } from "./sessions.js";
import type { Tokens } from "./tokens.js";

// A connection's code (ADR-0011) is one among the workspace's, and a code drawn that a waiting
// request holds already is drawn again. On a database of its own, with the codes the test says.

let testDatabase: TestDatabase;
let workspaceId: string;
const NOW = new Date("2026-11-10T09:00:00.000Z");

/** A code of the alphabet, the same letter eight times. */
const codeOf = (at: number): string => {
  const letter = CONNECT_CODE_ALPHABET[at] ?? "A";
  return `${letter.repeat(4)}-${letter.repeat(4)}`;
};

/** Connections that draw their codes from a list, in order. */
function drawing(codes: readonly string[]): Connections {
  const left = [...codes];
  return new Connections({
    database: testDatabase.database,
    clock: { now: () => NOW },
    logger: pino({ level: "silent" }),
    // Beginning a connection makes no token and no session.
    tokens: undefined as unknown as Tokens,
    sessions: undefined as unknown as Sessions,
    workspaceId: async () => workspaceId,
    pageFor: (code) => `https://console.test/connect/${code}`,
    newCode: () => {
      const next = left.shift();
      if (next === undefined) {
        throw new Error("the test has no code left to draw");
      }
      return next;
    },
  });
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  workspaceId = (await ensureWorkspace(testDatabase.database, { name: "Acme", now: NOW })).id;
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("a connection's code", () => {
  it("is drawn again where a waiting request holds the one drawn", async () => {
    const connections = drawing([codeOf(0), codeOf(0), codeOf(1)]);
    const first = await connections.begin("an agent on one machine", undefined);
    expect(first.code).toBe(codeOf(0));
    // The same code drawn for another: the database refuses it, and the next one is taken.
    const second = await connections.begin("an agent on another", undefined);
    expect(second.code).toBe(codeOf(1));
    expect(second.url).toBe(`https://console.test/connect/${codeOf(1)}`);
    expect(second.secret).not.toBe(first.secret);
  });

  it("gives up after three draws that are all taken", async () => {
    const connections = drawing([codeOf(0), codeOf(1), codeOf(0), codeOf(2)]);
    await expect(connections.begin("an agent out of luck", undefined)).rejects.toThrow();
    // The draw after is free, and a connection begins as ever.
    expect((await connections.begin("an agent after it", undefined)).code).toBe(codeOf(2));
  });
});
