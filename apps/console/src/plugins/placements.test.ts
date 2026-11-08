import { describe, expect, it } from "vitest";
import { placeSecret, readPath, sealAnswer, validateSeal } from "./placements.js";

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const at = (headers: Record<string, string> = {}, body?: string) => ({
  url: new URL("https://api.example.test/token?x=1"),
  headers,
  body: body === undefined ? undefined : new TextEncoder().encode(body),
});

describe("where a secret goes", () => {
  it("into a header, as a bearer, into the query, as basic authentication", () => {
    expect(placeSecret(at(), "header:x-token", "t").headers).toEqual({ "x-token": "t" });
    expect(placeSecret(at(), "bearer", "xoxb-1").headers).toEqual({
      authorization: "Bearer xoxb-1",
    });
    expect(placeSecret(at(), "query:key", "k").url.href).toBe(
      "https://api.example.test/token?x=1&key=k",
    );
    expect(placeSecret(at(), "basic", "u:p").headers).toEqual({
      authorization: `Basic ${Buffer.from("u:p").toString("base64")}`,
    });
  });

  it("into a field of a JSON body, or of a form, and nowhere else", () => {
    const json = placeSecret(
      at({ "content-type": "application/json" }, '{"code":"c"}'),
      "body:client_secret",
      "s",
    );
    expect(JSON.parse(text(json.body))).toEqual({ code: "c", client_secret: "s" });
    const empty = placeSecret(at(), "body:client_secret", "s");
    expect(JSON.parse(text(empty.body))).toEqual({ client_secret: "s" });
    expect(empty.headers["content-type"]).toBe("application/json");
    const form = placeSecret(
      at({ "content-type": "application/x-www-form-urlencoded" }, "code=c&grant_type=x"),
      "body:client_secret",
      "s&s",
    );
    expect(text(form.body)).toBe("code=c&grant_type=x&client_secret=s%26s");
    expect(() => placeSecret(at({ "content-type": "text/plain" }, "hi"), "body:f", "s")).toThrow(
      /JSON object or a form/,
    );
    expect(() =>
      placeSecret(at({ "content-type": "application/json" }, "[1]"), "body:f", "s"),
    ).toThrow(/JSON object or a form/);
    expect(() => placeSecret(at(), "header:host", "s")).toThrow(/not one to set/);
    expect(() => placeSecret(at(), "elsewhere" as never, "s")).toThrow(/placement/);
  });
});

describe("what of an answer is sealed", () => {
  const now = new Date("2026-11-08T12:00:00.000Z");
  const answer = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  it("takes the values named out, with their expiry, and hands the plugin the answer without them", () => {
    const { bytes, sealed } = sealAnswer(
      answer({
        ok: true,
        access_token: "xoxb-1",
        expires_in: 3600,
        credentials: { signing_secret: "sig", client_id: "id" },
      }),
      {
        botToken: { path: "$.access_token", expiresIn: "$.expires_in" },
        signingSecret: "$.credentials.signing_secret",
        configToken: { path: "$.nowhere", expiresIn: 60 },
      },
      now,
      4096,
    );
    expect(sealed).toEqual([
      { name: "botToken", value: "xoxb-1", expiresAt: new Date("2026-11-08T13:00:00.000Z") },
      { name: "signingSecret", value: "sig", expiresAt: undefined },
    ]);
    expect(JSON.parse(text(bytes))).toEqual({
      ok: true,
      access_token: "[sealed]",
      expires_in: 3600,
      credentials: { signing_secret: "[sealed]", client_id: "id" },
    });
  });

  it("seals nothing of an answer that is no JSON, a value that is no string, or one over the bound", () => {
    const plain = new TextEncoder().encode("not json");
    expect(sealAnswer(plain, { a: "$.a" }, now, 10)).toEqual({ bytes: plain, sealed: [] });
    expect(
      sealAnswer(answer({ a: 1, b: "x".repeat(11) }), { a: "$.a", b: "$.b" }, now, 10).sealed,
    ).toEqual([]);
    expect(readPath({ a: [{ b: "c" }] }, "$.a.0.b")).toBe("c");
    expect(readPath({ a: [{ b: "c" }] }, "$.a.1.b")).toBeUndefined();
    expect(() => readPath({}, "a.b")).toThrow(/path/);
  });

  it("reads the seals before the request goes out, refuses what is no seal, and bounds a life to ten years", () => {
    expect(validateSeal(undefined)).toEqual({});
    const seals = {
      a: "$.a",
      b: { path: "$.b", expiresIn: 60 },
      c: { path: "$.c", expiresIn: "$.exp" },
    };
    expect(validateSeal(seals)).toEqual(seals);
    expect(() => validateSeal([])).toThrow(/names the secret settings/);
    expect(() => validateSeal({ a: "a" })).toThrow(/no path/);
    expect(() => validateSeal({ a: { expiresIn: 60 } })).toThrow(/no path/);
    expect(() => validateSeal({ a: { path: "$.a", expiresIn: -1 } })).toThrow(/how long/);
    expect(() => validateSeal({ a: { path: "$.a", expiresIn: "soon" } })).toThrow(/how long/);
    expect(() =>
      validateSeal(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`s${i}`, "$.a"]))),
    ).toThrow(/at most 5/);
    const { sealed } = sealAnswer(
      answer({ t: "x", exp: 1e12 }),
      { t: { path: "$.t", expiresIn: "$.exp" } },
      now,
      10,
    );
    expect(sealed[0]?.expiresAt).toEqual(new Date(now.getTime() + 3650 * 86_400_000));
  });
});
