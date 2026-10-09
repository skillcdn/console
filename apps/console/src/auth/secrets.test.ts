import { describe, expect, it } from "vitest";
import {
  createSecrets,
  hashToken,
  newToken,
  openJson,
  pkceChallenge,
  sameSecret,
  sealJson,
} from "./secrets.js";

const SECRET = "a secret for tests that is long enough to be one";

describe("secrets", () => {
  it("seal what only the same secret opens, and say nothing about why not", () => {
    const secrets = createSecrets(SECRET);
    const sealed = secrets.seal("login", "hello");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("hello");
    expect(secrets.open("login", sealed)).toBe("hello");
    expect(secrets.seal("login", "hello")).not.toBe(sealed);

    const other = createSecrets("another secret that is also long enough to be one");
    expect(other.open("login", sealed)).toBeUndefined();
    for (const bad of ["", "v1.", "v2.abc", `${sealed}.x`, `${sealed.slice(0, -2)}xx`, "v1.AAAA"]) {
      expect(secrets.open("login", bad), bad).toBeUndefined();
    }
  });

  it("seal JSON that is good until it expires", () => {
    const secrets = createSecrets(SECRET);
    const until = new Date("2026-01-01T00:10:00Z");
    const sealed = sealJson(secrets, "login", { state: "s" }, until);
    expect(openJson(secrets, "login", sealed, new Date("2026-01-01T00:09:59Z"))).toEqual({
      state: "s",
    });
    expect(openJson(secrets, "login", sealed, until)).toBeUndefined();
    expect(openJson(secrets, "login", "nonsense", new Date(0))).toBeUndefined();
    expect(openJson(secrets, "login", secrets.seal("login", "[1,2]"), new Date(0))).toBeUndefined();
  });

  it("make tokens that are long, random and prefixed, and compare them in constant shape", () => {
    const token = newToken("cns_s_");
    expect(token).toMatch(/^cns_s_[A-Za-z0-9_-]{43}$/);
    expect(newToken("cns_s_")).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(sameSecret(token, token)).toBe(true);
    expect(sameSecret(token, `${token}x`)).toBe(false);
    expect(sameSecret("", "a")).toBe(false);
    expect(pkceChallenge("verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
