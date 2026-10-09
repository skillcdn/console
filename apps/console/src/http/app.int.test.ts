import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { createApi } from "../roles/api.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

/** The app of an `api` role, wired to the test database, with its log lines kept. */
function harness(options: { readonly shuttingDown?: boolean; readonly broken?: boolean } = {}) {
  const logs: Record<string, unknown>[] = [];
  const database = options.broken
    ? createDatabase({
        connectionString: "postgres://nobody:nothing@127.0.0.1:1/nowhere",
        maxConnections: 1,
      })
    : testDatabase.database;
  const { app } = createApi(
    {
      workspace: { name: "Acme" },
      http: {
        trustedProxies: [{ address: "10.0.0.0", prefix: 8, family: "ipv4" }],
        clientIpHeader: "x-forwarded-for",
        requestIdHeader: "x-request-id",
        accessLog: true,
      },
    },
    {
      database,
      clock: { now: () => new Date("2026-01-01T00:00:00Z") },
      logger: pino(
        { level: "info" },
        { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      ),
      isShuttingDown: () => options.shuttingDown === true,
    },
  );
  return {
    logs,
    request: (path: string, init?: RequestInit, peer?: string) =>
      app.fetch(
        new Request(`http://console.test${path}`, init),
        peer === undefined ? undefined : { incoming: { socket: { remoteAddress: peer } } },
      ),
    close: () => (options.broken ? database.close() : Promise.resolve()),
  };
}

describe("the api role", () => {
  it("is alive, and ready once the database answers with the schema of this build", async () => {
    const h = harness();
    const alive = await h.request("/healthz");
    expect(alive.status).toBe(200);
    expect(await alive.json()).toEqual({ status: "ok" });
    const ready = await h.request("/readyz");
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    expect(await ready.json()).toEqual({ status: "ready" });
    // Probes are not logged; everything else is, with the id the response carries.
    expect(h.logs.filter((line) => line.msg === "request")).toEqual([]);
  });

  it("is not ready while shutting down, nor when the database cannot be reached", async () => {
    const stopping = harness({ shuttingDown: true });
    expect(await (await stopping.request("/readyz")).json()).toEqual({ status: "shutting_down" });
    const broken = harness({ broken: true });
    try {
      const response = await broken.request("/readyz");
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "database_unreachable" });
    } finally {
      await broken.close();
    }
  });

  it("gives every request an id, a client address, and one log line without the query", async () => {
    const h = harness();
    const response = await h.request(
      "/nothing/here?token=hunter2",
      { headers: { "x-forwarded-for": "203.0.113.5", "x-request-id": "req-from-proxy" } },
      "10.1.1.1",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "There is nothing at this path." },
    });
    expect(response.headers.get("x-request-id")).toBe("req-from-proxy");
    const [line] = h.logs.filter((entry) => entry.msg === "request");
    expect(line).toMatchObject({
      requestId: "req-from-proxy",
      method: "GET",
      path: "/nothing/here",
      status: 404,
      clientAddress: "203.0.113.5",
    });
    expect(line).not.toHaveProperty("query");
    expect(JSON.stringify(h.logs)).not.toContain("hunter2");

    // From a stranger, the headers are noise: the id is made here and the address is the peer's.
    const stranger = await h.request(
      "/nothing",
      { headers: { "x-forwarded-for": "203.0.113.5", "x-request-id": "forged" } },
      "198.51.100.7",
    );
    expect(stranger.headers.get("x-request-id")).not.toBe("forged");
    expect(h.logs.at(-1)).toMatchObject({ clientAddress: "198.51.100.7" });
  });
});
