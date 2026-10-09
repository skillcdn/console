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
      auth: undefined,
      web: { root: undefined },
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
    expect(loadConfig({ DATABASE_URL, WEB_ROOT: "/app/web" }, noFiles).web.root).toBe("/app/web");
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

describe("signing in", () => {
  const signIn = {
    DATABASE_URL,
    PUBLIC_URL: "https://console.example.test",
    GITHUB_CLIENT_ID: "Iv23liExampleClientId",
    GITHUB_CLIENT_SECRET: "client-secret-of-the-app",
    AUTH_SECRET: "an-auth-secret-of-at-least-32-characters",
    MEMBERS: "alice, Bob,,carol",
  };

  it("is off until it is configured, and then has safe defaults", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).auth).toBeUndefined();
    expect(loadConfig(signIn, noFiles).auth).toEqual({
      publicUrl: "https://console.example.test",
      github: {
        clientId: "Iv23liExampleClientId",
        clientSecret: "client-secret-of-the-app",
        webUrl: "https://github.com",
        apiUrl: "https://api.github.com",
      },
      secret: "an-auth-secret-of-at-least-32-characters",
      members: ["alice", "Bob", "carol"],
      sessionTtlMs: 30 * 86_400_000,
    });
  });

  it("reads where the git host is, the lifetime, and the secret from a file", () => {
    const { auth } = loadConfig(
      {
        ...signIn,
        GITHUB_CLIENT_SECRET: undefined,
        GITHUB_CLIENT_SECRET_FILE: "/run/secrets/client",
        GITHUB_WEB_URL: "https://github.example.test/",
        GITHUB_API_URL: "https://github.example.test/api/v3/",
        SESSION_TTL_DAYS: "7",
      },
      (path) => (path === "/run/secrets/client" ? "from-file\n" : noFiles()),
    );
    expect(auth).toMatchObject({
      github: {
        clientSecret: "from-file",
        webUrl: "https://github.example.test",
        apiUrl: "https://github.example.test/api/v3",
      },
      sessionTtlMs: 7 * 86_400_000,
    });
  });

  it("wants all of it or none of it, and names what is missing", () => {
    const { GITHUB_CLIENT_SECRET: _secret, AUTH_SECRET: _auth, ...partial } = signIn;
    expect(problemsOf(partial).problems).toEqual([
      "GITHUB_CLIENT_SECRET, AUTH_SECRET: required once any of PUBLIC_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, AUTH_SECRET is set",
    ]);
    expect(problemsOf({ DATABASE_URL, MEMBERS: "alice" }).problems[0]).toContain(
      "MEMBERS: lists who may sign in",
    );
  });

  it("wants an origin, a secret that is not short, and logins that are logins", () => {
    for (const value of [
      "console.example.test",
      "ftp://console.example.test",
      "https://console.example.test/app",
      "https://console.example.test/?x=1",
      "https://user@console.example.test",
    ]) {
      expect(problemsOf({ ...signIn, PUBLIC_URL: value }).problems, value).toHaveLength(1);
    }
    expect(
      loadConfig({ ...signIn, PUBLIC_URL: "https://Console.Example.test/" }, noFiles).auth,
    )?.toMatchObject({ publicUrl: "https://console.example.test" });
    const short = problemsOf({ ...signIn, AUTH_SECRET: "hunter2" });
    expect(short.problems).toEqual(["AUTH_SECRET: must be at least 32 characters"]);
    expect(short.message).not.toContain("hunter2");
    expect(problemsOf({ ...signIn, MEMBERS: "alice, not a login" }).problems).toEqual([
      "MEMBERS: must be a list of logins",
    ]);
    expect(loadConfig({ ...signIn, MEMBERS: "" }, noFiles).auth?.members).toEqual([]);
  });
});
