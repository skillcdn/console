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
        port: 11199,
        shutdownGraceMs: 20_000,
        keepAliveMs: 65_000,
        requestTimeoutMs: 60_000,
        accessLog: true,
        trustedProxies: [],
        clientIpHeader: "x-forwarded-for",
        requestIdHeader: "x-request-id",
      },
      database: { url: DATABASE_URL, poolMax: 10, ca: undefined },
      workspace: { name: "Console" },
      worker: { inProcess: false, archiveAfterDays: 30, endRunsAfterHours: 12 },
      quotas: { fileBytesPerProject: undefined },
      auth: undefined,
      web: { root: undefined },
      skills: { source: "https://skillcdn.ai", address: undefined, directory: undefined },
      blobs: { bucket: undefined },
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
        TASK_ARCHIVE_AFTER_DAYS: "0",
        RUN_ENDED_AFTER_HOURS: "48",
        DATABASE_POOL_MAX: "4",
      },
      noFiles,
    );
    expect(config.environment).toBe("development");
    expect(config.http.port).toBe(9090);
    expect(config.logLevel).toBe("info");
    expect(config.workspace.name).toBe("Acme");
    expect(config.worker.inProcess).toBe(true);
    expect(config.worker.archiveAfterDays).toBe(0);
    expect(config.worker.endRunsAfterHours).toBe(48);
    expect(config.database.poolMax).toBe(4);
    expect(loadConfig({ DATABASE_URL, WEB_ROOT: "/app/web" }, noFiles).web.root).toBe("/app/web");
    expect(loadConfig({ DATABASE_URL, SKILLS_DIR: "/app/packs" }, noFiles).skills.directory).toBe(
      "/app/packs",
    );
  });

  it("reads the bound on a project's files in bytes, and refuses what is not a count of them", () => {
    expect(
      loadConfig({ DATABASE_URL, PROJECT_FILE_BYTES_AT_MOST: "1073741824" }, noFiles).quotas,
    ).toEqual({ fileBytesPerProject: 1_073_741_824 });
    for (const value of ["0", "-1", "1.5", "1GB"]) {
      expect(problemsOf({ DATABASE_URL, PROJECT_FILE_BYTES_AT_MOST: value }).problems[0]).toContain(
        "PROJECT_FILE_BYTES_AT_MOST",
      );
    }
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

  it("names the organization's skills by address, canonical, and refuses what is not one", () => {
    const { skills } = loadConfig(
      {
        DATABASE_URL,
        SKILLCDN_URL: "https://skillcdn.example.test/",
        SKILLS_ADDRESS: " /gh/Acme/Skills@v1/marketing ",
      },
      noFiles,
    );
    expect(skills.source).toBe("https://skillcdn.example.test");
    expect(skills.address).toMatchObject({
      host: "gh",
      owner: "acme",
      repo: "skills",
      ref: { kind: "name", name: "v1" },
      path: "marketing",
    });
    expect(problemsOf({ DATABASE_URL, SKILLS_ADDRESS: "gh/acme" }).problems[0]).toContain(
      "SKILLS_ADDRESS",
    );
    expect(problemsOf({ DATABASE_URL, SKILLCDN_URL: "skillcdn.ai" }).problems[0]).toContain(
      "SKILLCDN_URL",
    );
  });
});

describe("signing in", () => {
  const signIn = {
    DATABASE_URL,
    PUBLIC_URL: "https://console.example.test",
    GITHUB_CLIENT_ID: "Iv23liExampleClientId",
    GITHUB_CLIENT_SECRET: "client-secret-of-the-app",
    AUTH_SECRET: "an-auth-secret-of-at-least-32-characters",
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
      google: undefined,
      secret: "an-auth-secret-of-at-least-32-characters",
      admins: [],
      domains: [],
      sessionTtlMs: 30 * 86_400_000,
    });
  });

  it("takes Google as a provider, alone or beside GitHub, with a Workspace domain", () => {
    const google = {
      DATABASE_URL,
      PUBLIC_URL: signIn.PUBLIC_URL,
      AUTH_SECRET: signIn.AUTH_SECRET,
      GOOGLE_CLIENT_ID: "123-example.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client-secret-of-the-client",
      GOOGLE_WORKSPACE_DOMAIN: " Acme.Test ",
    };
    const { auth } = loadConfig(google, noFiles);
    expect(auth?.github).toBeUndefined();
    expect(auth?.google).toEqual({
      clientId: "123-example.apps.googleusercontent.com",
      clientSecret: "client-secret-of-the-client",
      domain: "acme.test",
    });
    expect(auth?.domains).toEqual(["acme.test"]);
    const both = loadConfig(
      {
        ...signIn,
        GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: google.GOOGLE_CLIENT_SECRET,
        ADMINS: "dave@acme.test",
      },
      noFiles,
    ).auth;
    expect(both?.github).toBeDefined();
    expect(both?.google?.domain).toBeUndefined();
    expect(both?.admins).toEqual(["dave@acme.test"]);
    // An administrator of the domain need not be listed by address.
    expect(loadConfig({ ...google, ADMINS: "erin@acme.test" }, noFiles).auth?.admins).toEqual([
      "erin@acme.test",
    ]);
    expect(problemsOf({ ...google, GOOGLE_CLIENT_SECRET: undefined }).problems).toEqual([
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: set both or neither",
      "GOOGLE_WORKSPACE_DOMAIN: needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    ]);
    expect(problemsOf({ ...signIn, GOOGLE_WORKSPACE_DOMAIN: "acme.test" }).problems).toEqual([
      "GOOGLE_WORKSPACE_DOMAIN: needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    ]);
    expect(problemsOf({ ...google, GOOGLE_WORKSPACE_DOMAIN: "not a domain" }).problems).toEqual([
      "GOOGLE_WORKSPACE_DOMAIN: must be a domain such as example.com",
    ]);
  });

  it("names administrators by login or by address, who are let in by that alone", () => {
    expect(loadConfig({ ...signIn, ADMINS: " Alice ,bob" }, noFiles).auth?.admins).toEqual([
      "Alice",
      "bob",
    ]);
    expect(
      loadConfig({ ...signIn, ADMINS: "alice, Dave@acme.test" }, noFiles).auth?.admins,
    ).toEqual(["alice", "Dave@acme.test"]);
    expect(loadConfig({ ...signIn, ADMINS: "" }, noFiles).auth?.admins).toEqual([]);
    expect(problemsOf({ ...signIn, ADMINS: "alice, not a login" }).problems).toEqual([
      "ADMINS: must be a list of logins or email addresses",
    ]);
    expect(problemsOf({ DATABASE_URL, ADMINS: "alice" }).problems[0]).toContain(
      "ADMINS: names administrators",
    );
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
        TOKEN_DAYS_AT_MOST: "30",
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
      tokenDaysAtMost: 30,
    });
  });

  it("reads the organization at the git host through its app: all three or none, with the client", () => {
    // Built from parts, so that the secret scan does not take a fixture for a key.
    const armor = (what: string) => `-----${what} RSA PRIVATE KEY-----`;
    const key = `${armor("BEGIN")}\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n${armor("END")}\n`;
    const organization = {
      ...signIn,
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: key,
      GITHUB_ORG: "acme",
    };
    expect(loadConfig(organization, noFiles).auth?.github?.organization).toEqual({
      name: "acme",
      appId: "12345",
      privateKey: key,
    });
    expect(loadConfig(signIn, noFiles).auth?.github?.organization).toBeUndefined();
    expect(
      loadConfig(
        {
          ...organization,
          GITHUB_APP_PRIVATE_KEY: undefined,
          GITHUB_APP_PRIVATE_KEY_FILE: "/run/secrets/key",
        },
        (path) => (path === "/run/secrets/key" ? `${key}\n` : noFiles()),
      ).auth?.github?.organization?.privateKey,
    ).toBe(key.trim());
    expect(problemsOf({ ...organization, GITHUB_ORG: undefined }).problems).toEqual([
      "GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_ORG: set all three or none",
    ]);
    expect(problemsOf({ ...organization, GITHUB_APP_PRIVATE_KEY: "not a key" }).problems).toEqual([
      "GITHUB_APP_PRIVATE_KEY: must be the app's private key in PEM",
    ]);
    expect(problemsOf({ ...organization, GITHUB_ORG: "not an org" }).problems).toEqual([
      "GITHUB_ORG: must be the organization's login at the host",
    ]);
    const { GITHUB_CLIENT_ID: _id, GITHUB_CLIENT_SECRET: _secret, ...withoutClient } = organization;
    expect(
      problemsOf({
        ...withoutClient,
        GOOGLE_CLIENT_ID: "123-example.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "client-secret-of-the-client",
      }).problems,
    ).toEqual([
      "GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_ORG: need GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET",
    ]);
  });

  it("wants all of it or none of it, and names what is missing", () => {
    const { GITHUB_CLIENT_SECRET: _secret, AUTH_SECRET: _auth, ...partial } = signIn;
    expect(problemsOf(partial).problems).toEqual([
      "AUTH_SECRET: required once signing in is configured",
      "GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET: set both or neither",
    ]);
    expect(
      problemsOf({ DATABASE_URL, PUBLIC_URL: signIn.PUBLIC_URL, AUTH_SECRET: signIn.AUTH_SECRET })
        .problems,
    ).toEqual(["GITHUB_CLIENT_ID or GOOGLE_CLIENT_ID: signing in needs a provider"]);
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
  });
});

describe("a bucket", () => {
  const bucket = {
    DATABASE_URL,
    S3_ENDPOINT: "https://s3.example.test",
    S3_BUCKET: "console-files",
    S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
    S3_SECRET_ACCESS_KEY: "the-secret-of-the-example-keys",
  };

  it("is off until it is configured, and then has safe defaults", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).blobs.bucket).toBeUndefined();
    expect(loadConfig(bucket, noFiles).blobs.bucket).toEqual({
      endpoint: "https://s3.example.test",
      bucket: "console-files",
      region: "us-east-1",
      credentials: {
        kind: "keys",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "the-secret-of-the-example-keys",
        sessionToken: undefined,
      },
      keyPrefix: "",
      pathStyle: true,
    });
  });

  it("reads the rest with it, the secret from a file, and ends the prefix with a slash", () => {
    const { blobs } = loadConfig(
      {
        ...bucket,
        S3_SECRET_ACCESS_KEY: undefined,
        S3_SECRET_ACCESS_KEY_FILE: "/run/secrets/bucket",
        S3_REGION: "eu-west-1",
        S3_SESSION_TOKEN: "a-temporary-token",
        S3_KEY_PREFIX: "console/files",
        S3_PATH_STYLE: "false",
      },
      (path) => (path === "/run/secrets/bucket" ? "from-file\n" : noFiles()),
    );
    expect(blobs.bucket).toMatchObject({
      region: "eu-west-1",
      credentials: { secretAccessKey: "from-file", sessionToken: "a-temporary-token" },
      keyPrefix: "console/files/",
      pathStyle: false,
    });
    expect(
      loadConfig({ ...bucket, S3_KEY_PREFIX: "files/" }, noFiles).blobs.bucket?.keyPrefix,
    ).toBe("files/");
  });

  it("wants all of it or none of it, and names what is missing or misplaced", () => {
    const { S3_SECRET_ACCESS_KEY: _secret, S3_BUCKET: _bucket, ...partial } = bucket;
    expect(problemsOf(partial).problems).toEqual([
      "S3_BUCKET, S3_SECRET_ACCESS_KEY: required once a bucket is configured",
    ]);
    expect(
      problemsOf({ DATABASE_URL, S3_REGION: "eu-west-1", S3_PATH_STYLE: "false" }).problems,
    ).toEqual(["S3_REGION, S3_PATH_STYLE: read only with S3_ENDPOINT, S3_BUCKET set"]);
    expect(problemsOf({ DATABASE_URL, S3_CREDENTIALS: "platform" }).problems).toEqual([
      "S3_CREDENTIALS: read only with S3_ENDPOINT, S3_BUCKET set",
    ]);
  });

  it("takes the platform's credentials instead of keys, from the platform's own variables", () => {
    const {
      S3_SECRET_ACCESS_KEY: _secret,
      S3_ACCESS_KEY_ID: _id,
      ...platform
    } = {
      ...bucket,
      S3_CREDENTIALS: "platform",
    };
    expect(
      loadConfig(
        { ...platform, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc-123" },
        noFiles,
      ).blobs.bucket?.credentials,
    ).toEqual({
      kind: "platform",
      url: "http://169.254.170.2/v2/credentials/abc-123",
      authorization: undefined,
      authorizationFile: undefined,
    });
    expect(
      loadConfig(
        {
          ...platform,
          AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://169.254.170.23/v1/credentials",
          AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: "/var/run/credentials/token",
        },
        noFiles,
      ).blobs.bucket?.credentials,
    ).toEqual({
      kind: "platform",
      url: "http://169.254.170.23/v1/credentials",
      authorization: undefined,
      authorizationFile: "/var/run/credentials/token",
    });
    expect(
      loadConfig(
        {
          ...platform,
          AWS_CONTAINER_CREDENTIALS_FULL_URI: "https://credentials.example.test/task",
          AWS_CONTAINER_AUTHORIZATION_TOKEN: "a-bearer-token",
        },
        noFiles,
      ).blobs.bucket?.credentials,
    ).toMatchObject({
      url: "https://credentials.example.test/task",
      authorization: "a-bearer-token",
    });
    // The relative address wins, as the platform's own tools have it.
    expect(
      loadConfig(
        {
          ...platform,
          AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc-123",
          AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:8080/creds",
        },
        noFiles,
      ).blobs.bucket?.credentials,
    ).toMatchObject({ url: "http://169.254.170.2/v2/credentials/abc-123" });
    // A console on keys does not mind the platform's variables, whatever they hold.
    expect(
      loadConfig({ ...bucket, AWS_CONTAINER_CREDENTIALS_FULL_URI: "not a url" }, noFiles).blobs
        .bucket?.credentials,
    ).toMatchObject({ kind: "keys" });
  });

  it("refuses half of the platform's address, keys beside it, and an address that is not the platform's", () => {
    const {
      S3_SECRET_ACCESS_KEY: _secret,
      S3_ACCESS_KEY_ID: _id,
      ...platform
    } = {
      ...bucket,
      S3_CREDENTIALS: "platform",
    };
    expect(problemsOf(platform).problems).toEqual([
      "S3_CREDENTIALS: the platform hands this container no credentials (neither AWS_CONTAINER_CREDENTIALS_RELATIVE_URI nor AWS_CONTAINER_CREDENTIALS_FULL_URI is set); run it with a role, or set the keys",
    ]);
    expect(
      problemsOf({ ...platform, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "v2/credentials" })
        .problems,
    ).toEqual(["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: must be a path"]);
    for (const full of [
      "not a url",
      "http://credentials.example.test/task",
      "http://169.254.169.254/latest/meta-data",
      "ftp://127.0.0.1/creds",
    ]) {
      expect(
        problemsOf({ ...platform, AWS_CONTAINER_CREDENTIALS_FULL_URI: full }).problems,
        full,
      ).toEqual([
        "AWS_CONTAINER_CREDENTIALS_FULL_URI: must be an https URL, or http to the loopback or the platform's own address",
      ]);
    }
    const error = problemsOf({
      ...bucket,
      S3_CREDENTIALS: "platform",
      S3_SESSION_TOKEN: "a-temporary-token",
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc-123",
      AWS_CONTAINER_AUTHORIZATION_TOKEN: "a-bearer-token",
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: "/var/run/credentials/token",
    });
    expect(error.problems).toEqual([
      "S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_SESSION_TOKEN: not read with S3_CREDENTIALS=platform; the keys or the platform, not both",
      "AWS_CONTAINER_AUTHORIZATION_TOKEN and AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE are both set; use one",
    ]);
    expect(error.message).not.toContain("the-secret-of-the-example-keys");
    expect(error.message).not.toContain("a-bearer-token");
    expect(problemsOf({ ...bucket, S3_CREDENTIALS: "role" }).problems[0]).toContain(
      "S3_CREDENTIALS",
    );
  });

  it("refuses what is not a bucket name, a region, an origin or a prefix, without echoing a secret", () => {
    for (const [name, value] of [
      ["S3_BUCKET", "Console Files"],
      ["S3_REGION", "EU West"],
      ["S3_ENDPOINT", "s3.example.test"],
      ["S3_ENDPOINT", "https://s3.example.test/path"],
      ["S3_KEY_PREFIX", "/console/"],
      ["S3_KEY_PREFIX", "con sole/"],
      ["S3_PATH_STYLE", "yes"],
      ["S3_ACCESS_KEY_ID", "has a space"],
    ] as const) {
      const error = problemsOf({ ...bucket, [name]: value });
      expect(error.problems, `${name}=${value}`).toHaveLength(1);
      expect(error.problems[0]).toContain(name);
      expect(error.message).not.toContain("the-secret-of-the-example-keys");
    }
  });
});

describe("the database's certificate authority", () => {
  const PEM = "-----BEGIN CERTIFICATE-----\nMIIBAAAA+/==\n-----END CERTIFICATE-----\n";
  const TWO = `${PEM}${PEM}`;

  it("is read as PEM, one certificate or a bundle, and from a file", () => {
    expect(loadConfig({ DATABASE_URL }, noFiles).database.ca).toBeUndefined();
    expect(loadConfig({ DATABASE_URL, DATABASE_CA: PEM }, noFiles).database.ca).toBe(PEM);
    expect(loadConfig({ DATABASE_URL, DATABASE_CA: TWO }, noFiles).database.ca).toBe(TWO);
    expect(
      loadConfig({ DATABASE_URL, DATABASE_CA_FILE: "/run/secrets/ca" }, (path) =>
        path === "/run/secrets/ca" ? `${PEM}\n` : noFiles(),
      ).database.ca,
    ).toBe(PEM.trim());
  });

  it("refuses what is not PEM, and a URL that carries ssl parameters of its own", () => {
    expect(problemsOf({ DATABASE_URL, DATABASE_CA: "not a certificate" }).problems).toEqual([
      "DATABASE_CA: must be one or more certificates in PEM",
    ]);
    expect(
      problemsOf({
        DATABASE_URL: `${DATABASE_URL}?sslmode=verify-full&sslrootcert=/etc/ca.pem`,
        DATABASE_CA: PEM,
      }).problems,
    ).toEqual([
      "DATABASE_URL: sslmode, sslrootcert cannot be set together with DATABASE_CA; remove them from the URL",
    ]);
    expect(
      loadConfig({ DATABASE_URL: `${DATABASE_URL}?sslmode=verify-full` }, noFiles).database.ca,
    ).toBeUndefined();
  });
});
