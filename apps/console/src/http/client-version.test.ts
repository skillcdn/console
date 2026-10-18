import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientVersionGate, versionFactsOf } from "./client-version.js";
import type { AppEnv } from "./request-context.js";

/** An API of one route behind the gate, as the app has it. */
function gated(version: string) {
  const app = new Hono<AppEnv>();
  app.use("/api/*", clientVersionGate(versionFactsOf(version)));
  app.get("/api/v1/me", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  return (path: string, userAgent?: string) =>
    app.request(path, userAgent === undefined ? {} : { headers: { "user-agent": userAgent } });
}

describe("the gate on the command's version", () => {
  it("states the console's version and the range it takes, and knows a version that is not one", () => {
    expect(versionFactsOf("0.1.18")).toMatchObject({
      version: "0.1.18",
      clientRange: ">=0.1.18 <0.2.0",
    });
    expect(versionFactsOf("1.4.2").clientRange).toBe(">=1.3.0 <1.6.0");
    expect(versionFactsOf("1.4.2", { atLeast: "1.4.1" }).clientRange).toBe(">=1.4.1 <1.6.0");
    expect(() => versionFactsOf("0.0.0-dev")).toThrow("not one");
  });

  it("answers every request of the API with the version and the range, whoever asks", async () => {
    const request = gated("0.1.18");
    for (const agent of [
      undefined,
      "node",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "skillcdn-console/0.1.18 (cli; node 24.11.0; win32)",
      "skillcdn-console/0.1.19",
      "skillcdn-console/garbage",
      `skillcdn-console/0.0.1${"x".repeat(5000)}`,
    ]) {
      const answer = await request("/api/v1/me", agent);
      expect(answer.status, String(agent)).toBe(200);
      expect(answer.headers.get("console-version")).toBe("0.1.18");
      expect(answer.headers.get("console-client-range")).toBe(">=0.1.18 <0.2.0");
    }
    const probe = await request("/healthz", "skillcdn-console/0.0.1");
    expect(probe.status).toBe(200);
    expect(probe.headers.get("console-version")).toBeNull();
  });

  it("refuses a command outside the range with 426, the code, the words and the headers", async () => {
    const request = gated("0.1.18");
    const older = await request("/api/v1/me", "skillcdn-console/0.1.17 (cli)");
    expect(older.status).toBe(426);
    expect(older.headers.get("console-version")).toBe("0.1.18");
    expect(older.headers.get("console-client-range")).toBe(">=0.1.18 <0.2.0");
    expect(older.headers.get("cache-control")).toBe("no-store");
    const refused = (await older.json()) as { error: { code: string; message: string } };
    expect(refused.error.code).toBe("client.outdated");
    expect(refused.error.message).toContain("0.1.17");
    expect(refused.error.message).toContain(">=0.1.18 <0.2.0");
    expect(refused.error.message).toContain("Update it to 0.1.18");
    const newer = await request("/api/v1/me", "skillcdn-console/0.2.0");
    expect(newer.status).toBe(426);
    expect(((await newer.json()) as { error: { code: string } }).error.code).toBe("client.too_new");
    const later = gated("1.4.2");
    expect((await later("/api/v1/me", "skillcdn-console/1.3.0")).status).toBe(200);
    expect((await later("/api/v1/me", "skillcdn-console/1.5.9")).status).toBe(200);
    expect((await later("/api/v1/me", "skillcdn-console/1.2.9")).status).toBe(426);
    expect((await later("/api/v1/me", "skillcdn-console/1.6.0")).status).toBe(426);
    expect((await later("/api/v1/me", "skillcdn-console/2.0.0")).status).toBe(426);
  });
});
