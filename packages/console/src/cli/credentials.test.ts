import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Credentials,
  CredentialsError,
  createFileStore,
  defaultConfigDir,
  type Login,
  parseCredentials,
  resolveLogin,
  withLogin,
  withoutLogin,
} from "./credentials.js";

const A = "https://a.test";
const B = "https://b.test";
const login = (url: string, account: string | undefined, token: string): Login => ({
  url,
  account,
  token,
  agent: undefined,
  since: undefined,
});
const kept: Credentials = {
  default: A,
  logins: [
    login(A, "alice", "cns_t_a"),
    login(B, "alice", "cns_t_b"),
    login(B, "bob", "cns_t_bob"),
  ],
};

describe("the credentials the command keeps", () => {
  it("read the current shape, the first shape as one login that is the default, and nothing else", () => {
    expect(
      parseCredentials({
        version: 2,
        default: A,
        logins: [
          {
            url: A,
            account: "alice",
            token: "cns_t_a",
            agent: "Codex",
            since: "2026-10-14T00:00:00.000Z",
          },
        ],
      }),
    ).toEqual({
      default: A,
      logins: [
        {
          url: A,
          account: "alice",
          token: "cns_t_a",
          agent: "Codex",
          since: "2026-10-14T00:00:00.000Z",
        },
      ],
    });
    expect(parseCredentials({ url: A, token: "cns_t_old" })).toEqual({
      default: A,
      logins: [login(A, undefined, "cns_t_old")],
    });
    for (const hostile of [
      null,
      7,
      "x",
      [],
      {},
      { version: 3, logins: [] },
      { url: "", token: "t" },
      { version: 2, logins: [{ url: A }] },
    ]) {
      expect(parseCredentials(hostile)).toBeUndefined();
    }
  });

  it("keep a login per console and account, the first as the default, and let one go", () => {
    const first = withLogin({ default: undefined, logins: [] }, login(A, "alice", "cns_t_a"));
    expect(first).toEqual({ default: A, logins: [login(A, "alice", "cns_t_a")] });
    const second = withLogin(first, login(B, "alice", "cns_t_b"));
    expect(second.default).toBe(A);
    expect(second.logins).toHaveLength(2);
    const asDefault = withLogin(second, login(B, "bob", "cns_t_bob"), { default: true });
    expect(asDefault.default).toBe(B);
    // The same console and account again: the token replaced, nothing added.
    const again = withLogin(asDefault, login(A, "alice", "cns_t_a2"));
    expect(again.logins.filter((entry) => entry.url === A)).toEqual([
      login(A, "alice", "cns_t_a2"),
    ]);
    expect(again.logins).toHaveLength(3);
    // Letting go: one account at a console, or every account there; the default moves when it must.
    expect(withoutLogin(again, B, "bob").logins.map((entry) => entry.token)).toEqual([
      "cns_t_b",
      "cns_t_a2",
    ]);
    expect(withoutLogin(again, B).default).toBe(A);
    expect(withoutLogin(withoutLogin(again, B), A)).toEqual({ default: undefined, logins: [] });
  });

  it("resolve the console first and the token for it alone, in the order the flag, the environment, the directory, the default", () => {
    expect(resolveLogin({ credentials: kept })).toMatchObject({
      ok: true,
      url: A,
      token: "cns_t_a",
      source: "default",
      via: "login",
    });
    expect(
      resolveLogin({ credentials: kept, directoryUrl: B, directoryAccount: "bob" }),
    ).toMatchObject({
      ok: true,
      url: B,
      token: "cns_t_bob",
      account: "bob",
      source: "directory",
    });
    expect(resolveLogin({ credentials: kept, directoryUrl: B })).toEqual({
      ok: false,
      reason: "ambiguous",
      url: B,
      accounts: ["alice", "bob"],
    });
    expect(
      resolveLogin({ credentials: kept, directoryUrl: B, flagAccount: "alice" }),
    ).toMatchObject({ ok: true, token: "cns_t_b" });
    expect(resolveLogin({ credentials: kept, flagUrl: A, directoryUrl: B })).toMatchObject({
      ok: true,
      url: A,
      source: "flag",
    });
    expect(resolveLogin({ credentials: kept, flagUrl: "https://c.test" })).toEqual({
      ok: false,
      reason: "no_login",
      url: "https://c.test",
      account: undefined,
      source: "flag",
    });
    expect(
      resolveLogin({ credentials: kept, directoryUrl: A, directoryAccount: "carol" }),
    ).toMatchObject({
      ok: false,
      reason: "no_login",
      account: "carol",
      source: "directory",
    });
    // The environment: a pair, for its own address; half a pair is nothing.
    expect(resolveLogin({ credentials: kept, envUrl: B, envToken: "cns_t_env" })).toMatchObject({
      ok: true,
      url: B,
      token: "cns_t_env",
      via: "environment",
    });
    expect(
      resolveLogin({ credentials: kept, envUrl: B, envToken: "cns_t_env", flagUrl: A }),
    ).toMatchObject({ ok: true, url: A, token: "cns_t_a", via: "login" });
    expect(resolveLogin({ credentials: undefined, envUrl: A })).toEqual({
      ok: false,
      reason: "environment_half",
      have: "CONSOLE_URL",
    });
    expect(resolveLogin({ credentials: undefined, envToken: "cns_t_env" })).toEqual({
      ok: false,
      reason: "environment_half",
      have: "CONSOLE_TOKEN",
    });
    // Nothing anywhere; and the one console signed in to stands as the default when none is marked.
    expect(resolveLogin({ credentials: undefined })).toEqual({ ok: false, reason: "nothing" });
    expect(
      resolveLogin({ credentials: { default: undefined, logins: [login(B, "bob", "cns_t_bob")] } }),
    ).toMatchObject({ ok: true, url: B, token: "cns_t_bob" });
    // A login kept before accounts were known answers for the console, as nobody in particular.
    expect(
      resolveLogin({ credentials: { default: A, logins: [login(A, undefined, "cns_t_old")] } }),
    ).toMatchObject({ ok: true, token: "cns_t_old", account: undefined });
  });

  it("name the directory the file lives in", () => {
    expect(defaultConfigDir({ XDG_CONFIG_HOME: "/xdg" })).toBe(join("/xdg", "skillcdn-console"));
    expect(defaultConfigDir({})).toContain(join(".config", "skillcdn-console"));
  });
});

describe("the credentials file", () => {
  const made: string[] = [];
  const directory = async () => {
    const path = await mkdtemp(join(tmpdir(), "console-credentials-"));
    made.push(path);
    return path;
  };
  afterEach(async () => {
    for (const path of made.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("is written whole and read back, with nothing left beside it", async () => {
    const dir = await directory();
    const store = createFileStore(dir);
    expect(await store.load()).toBeUndefined();
    const path = await store.save(kept);
    expect(path).toBe(join(dir, "credentials.json"));
    expect(await store.load()).toEqual(kept);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 2, default: A });
    expect(await readdir(dir)).toEqual(["credentials.json"]);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });

  it("reads the file of before as one login, and refuses one it cannot read without touching it", async () => {
    const dir = await directory();
    const store = createFileStore(dir);
    const path = join(dir, "credentials.json");
    await writeFile(path, JSON.stringify({ url: A, token: "cns_t_old" }));
    expect(await store.load()).toEqual({ default: A, logins: [login(A, undefined, "cns_t_old")] });
    await writeFile(path, "{ not json");
    await expect(store.load()).rejects.toBeInstanceOf(CredentialsError);
    await expect(store.load()).rejects.toMatchObject({ code: "credentials.malformed" });
    expect(await readFile(path, "utf8")).toBe("{ not json");
    await writeFile(path, JSON.stringify({ version: 2, logins: "many" }));
    await expect(store.load()).rejects.toMatchObject({ code: "credentials.malformed" });
    await writeFile(path, `{"version":2,"logins":[],"pad":"${"x".repeat(70 * 1024)}"}`);
    await expect(store.load()).rejects.toMatchObject({ code: "credentials.too_large" });
  });
});
