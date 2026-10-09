import { describe, expect, it } from "vitest";
import { ProviderError } from "../ports/identity-provider.js";
import { createGoogleProvider } from "./google-login.js";
import type { FetchLike } from "./upstream.js";

function provider(answer: FetchLike, domain?: string) {
  return createGoogleProvider({
    clientId: "example-client-id.apps.test",
    clientSecret: "client-secret-for-tests",
    userAgent: "console-test",
    domain,
    fetch: answer,
    timeoutMs: 1000,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const exchange = {
  code: "code-1",
  redirectUri: "https://console.test/auth/google/callback",
  codeVerifier: "verifier",
};

describe("the Google provider", () => {
  it("sends the browser to the account picker, asking for identity only, with the domain as a hint", () => {
    const url = new URL(
      provider(async () => json({}), "acme.test").authorizationUrl({
        state: "st",
        redirectUri: "https://console.test/auth/google/callback",
        codeChallenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "example-client-id.apps.test",
      redirect_uri: "https://console.test/auth/google/callback",
      response_type: "code",
      scope: "openid email profile",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      prompt: "select_account",
      hd: "acme.test",
    });
    const withoutDomain = new URL(
      provider(async () => json({})).authorizationUrl({
        state: "st",
        redirectUri: "r",
        codeChallenge: "ch",
      }),
    );
    expect(withoutDomain.searchParams.has("hd")).toBe(false);
  });

  it("exchanges a code at the token endpoint, as a form, and reads the token", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const google = provider(async (url, init) => {
      sent.push({ url, init });
      return json({ access_token: "ya29.token", token_type: "Bearer", id_token: "not.read.here" });
    });
    expect(await google.exchangeCode(exchange)).toEqual({ accessToken: "ya29.token" });
    expect(sent[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(sent[0]?.init.method).toBe("POST");
    expect(sent[0]?.init.redirect).toBe("manual");
    const form = new URLSearchParams(String(sent[0]?.init.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("client_secret")).toBe("client-secret-for-tests");
  });

  it("tells a refused code from a broken provider", async () => {
    await expect(
      provider(async () =>
        json({ error: "invalid_grant", error_description: "Bad Request" }, 400),
      ).exchangeCode(exchange),
    ).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(
      provider(async () => new Response("not json", { status: 400 })).exchangeCode(exchange),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      provider(async () => json({ error: "something_else" })).exchangeCode(exchange),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      provider(async () => new Response("down", { status: 503 })).exchangeCode(exchange),
    ).rejects.toMatchObject({ kind: "transient" });
    await expect(
      provider(async () => new Response("slow down", { status: 429 })).exchangeCode(exchange),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(
      provider(async () => {
        throw new TypeError("fetch failed");
      }).exchangeCode(exchange),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("asks who holds the credential, and reads the account with its domain", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const google = provider(async (url, init) => {
      sent.push({ url, init });
      return json({
        sub: "110248495921238986420",
        email: "Dave@Acme.test",
        email_verified: true,
        hd: "acme.test",
        name: "  Dave Example ",
        picture: "https://pictures.example/dave.png",
        extra: "ignored",
      });
    });
    expect(await google.getAccount("ya29.token")).toEqual({
      accountId: "110248495921238986420",
      login: "dave@acme.test",
      name: "Dave Example",
      avatarUrl: "https://pictures.example/dave.png",
      domain: "acme.test",
    });
    expect(sent[0]?.url).toBe("https://openidconnect.googleapis.com/v1/userinfo");
    expect(new Headers(sent[0]?.init.headers).get("authorization")).toBe("Bearer ya29.token");
    // A plain account belongs to no domain.
    const plain = await provider(async () =>
      json({ sub: "7", email: "erin@mail.test", email_verified: true }),
    ).getAccount("t");
    expect(plain).toEqual({
      accountId: "7",
      login: "erin@mail.test",
      name: undefined,
      avatarUrl: undefined,
      domain: undefined,
    });
  });

  it("refuses an address that is not verified, a credential it refuses, and nonsense", async () => {
    await expect(
      provider(async () =>
        json({ sub: "7", email: "erin@mail.test", email_verified: false }),
      ).getAccount("t"),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      provider(async () => json({ sub: "7", email: "erin@mail.test" })).getAccount("t"),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      provider(async () => new Response("", { status: 401 })).getAccount("old"),
    ).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(
      provider(async () => new Response("<html>", { status: 200 })).getAccount("t"),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      provider(async () => new Response("x".repeat(70_000), { status: 200 })).getAccount("t"),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(
      (
        await provider(async () =>
          json({
            sub: "7",
            email: "e@m.test",
            email_verified: true,
            picture: "http://insecure/x.png",
          }),
        ).getAccount("t")
      ).avatarUrl,
    ).toBeUndefined();
  });
});
