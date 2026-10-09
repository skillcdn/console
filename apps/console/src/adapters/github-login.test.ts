import { describe, expect, it } from "vitest";
import { ProviderError } from "../ports/identity-provider.js";
import { createGitHubProvider } from "./github-login.js";
import type { FetchLike } from "./upstream.js";

function login(answer: FetchLike) {
  return createGitHubProvider({
    webUrl: "https://github.example/",
    apiUrl: "https://github.example/api/v3",
    clientId: "Iv23liExample",
    clientSecret: "client-secret-for-tests",
    userAgent: "console-test",
    fetch: answer,
    timeoutMs: 1000,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("the GitHub provider", () => {
  it("sends the browser to the host's authorize page with the challenge and the picker", () => {
    const url = new URL(
      login(async () => json({})).authorizationUrl({
        state: "st",
        redirectUri: "https://console.test/auth/gh/callback",
        codeChallenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.example/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv23liExample",
      redirect_uri: "https://console.test/auth/gh/callback",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  });

  it("exchanges a code at the token endpoint, as a form, and reads the token", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const host = login(async (url, init) => {
      sent.push({ url, init });
      return json({ access_token: "gho_token", token_type: "bearer" });
    });
    const issued = await host.exchangeCode({
      code: "code-1",
      redirectUri: "https://console.test/auth/gh/callback",
      codeVerifier: "verifier",
    });
    expect(issued).toEqual({ accessToken: "gho_token" });
    expect(sent[0]?.url).toBe("https://github.example/login/oauth/access_token");
    expect(sent[0]?.init.method).toBe("POST");
    expect(sent[0]?.init.redirect).toBe("manual");
    const form = new URLSearchParams(String(sent[0]?.init.body));
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("client_secret")).toBe("client-secret-for-tests");
  });

  it("tells a refused code from a broken host", async () => {
    await expect(
      login(async () => json({ error: "bad_verification_code" })).exchangeCode({
        code: "x",
        redirectUri: "r",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(
      login(async () => json({ error: "something_else" })).exchangeCode({
        code: "x",
        redirectUri: "r",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      login(async () => new Response("down", { status: 503 })).exchangeCode({
        code: "x",
        redirectUri: "r",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({ kind: "transient" });
    await expect(
      login(async () => new Response("slow down", { status: 429 })).exchangeCode({
        code: "x",
        redirectUri: "r",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(
      login(async () => {
        throw new TypeError("fetch failed");
      }).exchangeCode({ code: "x", redirectUri: "r", codeVerifier: "v" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("asks who holds the credential, with the token in the header and nowhere else", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const host = login(async (url, init) => {
      sent.push({ url, init });
      return json({
        id: 1001,
        login: "Alice",
        name: "  Alice Example ",
        avatar_url: "https://avatars.example/u/1001",
        extra: "ignored",
      });
    });
    expect(await host.getAccount("gho_token")).toEqual({
      accountId: "1001",
      login: "Alice",
      name: "Alice Example",
      avatarUrl: "https://avatars.example/u/1001",
      domain: undefined,
    });
    expect(sent[0]?.url).toBe("https://github.example/api/v3/user");
    expect(new Headers(sent[0]?.init.headers).get("authorization")).toBe("Bearer gho_token");
  });

  it("refuses a credential the host refuses, a picture that is not https, and nonsense", async () => {
    await expect(
      login(async () => new Response("", { status: 401 })).getAccount("gho_old"),
    ).rejects.toMatchObject({ kind: "unauthorized" });
    expect(
      (
        await login(async () =>
          json({ id: 7, login: "bob", name: null, avatar_url: "http://insecure/x.png" }),
        ).getAccount("t")
      ).avatarUrl,
    ).toBeUndefined();
    await expect(
      login(async () => new Response("<html>", { status: 200 })).getAccount("t"),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      login(async () => json({ id: "not-a-number", login: "x" })).getAccount("t"),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      login(async () => new Response("x".repeat(70_000), { status: 200 })).getAccount("t"),
    ).rejects.toMatchObject({ kind: "invalid" });
  });
});
