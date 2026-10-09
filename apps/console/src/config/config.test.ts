import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const DATABASE_URL = "postgres://user:not-a-real-password@db.internal:5432/console";
const noFiles = (): string => {
  throw new Error("no file expected");
};

function problemsOf(environment: Record<string, string | undefined>, readFile = noFiles) {
  try {
    loadConfig(environment, readFile);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the configuration to be rejected");
}

describe("loadConfig", () => {
  it("needs only a database and fills in safe defaults", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles)).toEqual({
      environment: "production",
      logLevel: "info",
      http: {
        host: "0.0.0.0",
        port: 11190,
        shutdownGraceMs: 20_000,
        keepAliveMs: 65_000,
        requestTimeoutMs: 60_000,
        accessLog: true,
        trustedProxies: [],
        clientIpHeader: "x-forwarded-for",
        requestIdHeader: "x-request-id",
      },
      database: { url: DATABASE_URL, poolMax: 10 },
      workspace: { name: "Console" },
      worker: { inProcess: false },
    });
  });

  it("reads overrides and treats empty variables as unset", () => {
    const config = loadConfig(
      {
        DATABASE_URL,
        NODE_ENV: "development",
        PORT: "9090",
        LOG_LEVEL: "",
        WORKSPACE_NAME: "  Acme  ",
        WORKER_IN_PROCESS: "true",
        DATABASE_POOL_MAX: "4",
      },
      noFiles,
    );
    expect(config.environment).toBe("development");
    expect(config.http.port).toBe(9090);
    expect(config.logLevel).toBe("info");
    expect(config.workspace.name).toBe("Acme");
    expect(config.worker.inProcess).toBe(true);
    expect(config.database.poolMax).toBe(4);
  });

  it("reads the reverse-proxy settings, and trusts no proxy unless told to", () => {
    const config = loadConfig(
      {
        DATABASE_URL,
        TRUSTED_PROXIES: "127.0.0.1, 10.0.0.0/8,::1/128,",
        CLIENT_IP_HEADER: "X-Real-IP",
        REQUEST_ID_HEADER: "X-Trace-Id",
        ACCESS_LOG: "false",
        HTTP_KEEP_ALIVE_SECONDS: "620",
      },
      noFiles,
    );
    expect(config.http).toMatchObject({
      keepAliveMs: 620_000,
      accessLog: false,
      clientIpHeader: "x-real-ip",
      requestIdHeader: "x-trace-id",
      trustedProxies: [
        { address: "127.0.0.1", prefix: 32, family: "ipv4" },
        { address: "10.0.0.0", prefix: 8, family: "ipv4" },
        { address: "::1", prefix: 128, family: "ipv6" },
      ],
    });
    const error = problemsOf({
      DATABASE_URL,
      TRUSTED_PROXIES: "10.0.0.0/8, proxy.internal",
      CLIENT_IP_HEADER: "x forwarded for",
      ACCESS_LOG: "yes",
    });
    expect(error.problems.map((problem) => problem.split(":")[0]).sort()).toEqual([
      "ACCESS_LOG",
      "CLIENT_IP_HEADER",
      "TRUSTED_PROXIES",
    ]);
  });

  it("refuses a workspace name that is empty, too long or hides characters", () => {
    for (const name of ["   ", "n".repeat(101), `a${String.fromCodePoint(0x200b)}b`]) {
      expect(problemsOf({ DATABASE_URL, WORKSPACE_NAME: name }).problems[0]).toContain(
        "WORKSPACE_NAME",
      );
    }
  });

  it("reads secrets from files, and refuses one given both ways or unreadable", () => {
    const config = loadConfig({ DATABASE_URL_FILE: "/run/secrets/db" }, (path) => {
      if (path !== "/run/secrets/db") {
        throw new Error("ENOENT");
      }
      return `${DATABASE_URL}\n`;
    });
    expect(config.database.url).toBe(DATABASE_URL);
    expect(problemsOf({ DATABASE_URL, DATABASE_URL_FILE: "/run/secrets/db" }).problems).toContain(
      "DATABASE_URL and DATABASE_URL_FILE are both set; use one",
    );
    expect(
      problemsOf({ DATABASE_URL_FILE: "/missing" }, () => {
        throw new Error("ENOENT");
      }).problems,
    ).toContain("DATABASE_URL_FILE: cannot read /missing");
  });

  it("lists every problem at once, by variable name, and never repeats a value", () => {
    const error = problemsOf({
      PORT: "eighty",
      NODE_ENV: "staging",
      SHUTDOWN_GRACE_SECONDS: "0",
    });
    expect(error.problems.map((problem) => problem.split(":")[0]).sort()).toEqual([
      "DATABASE_URL",
      "NODE_ENV",
      "PORT",
      "SHUTDOWN_GRACE_SECONDS",
    ]);
    expect(error.problems).toContain("DATABASE_URL: required");

    const leak = problemsOf({ DATABASE_URL: "mysql://user:hunter2-secret@db/console" });
    expect(leak.message).not.toContain("hunter2-secret");
    expect(leak.message).toContain("DATABASE_URL");
  });
});
