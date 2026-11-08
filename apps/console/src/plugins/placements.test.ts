import type { SecretPlacement } from "@skillcdn/console/plugin";
import { describe, expect, it } from "vitest";
import {
  formsOf,
  placeSecret,
  readPath,
  scrubAnswer,
  sealAnswer,
  validateSeal,
} from "./placements.js";

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
    const { bytes, sealed, outcomes, taken } = sealAnswer(
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
    expect(outcomes).toEqual({
      botToken: "sealed",
      signingSecret: "sealed",
      configToken: "absent",
    });
    expect(taken).toEqual(["xoxb-1", "sig"]);
  });

  it("withholds the whole body of an answer that is no JSON object or array, and says so", () => {
    // A token endpoint that answers a form unless asked for JSON: what it holds cannot be told
    // apart from the rest, so none of it reaches the plugin.
    const form = new TextEncoder().encode("access_token=gho_s3cret&scope=repo&token_type=bearer");
    const unread = sealAnswer(form, { token: "$.access_token", scope: "$.scope" }, now, 4096);
    expect(unread).toEqual({
      bytes: new Uint8Array(0),
      sealed: [],
      outcomes: { token: "not_json", scope: "not_json" },
      taken: [],
    });
    // A JSON string or number holds no path; an empty or a broken body none either.
    for (const body of [
      '"gho_s3cret"',
      "42",
      "null",
      "",
      '{"access_token":"gho_s3cret"',
      String.fromCodePoint(0xff, 0),
    ]) {
      const { bytes, outcomes } = sealAnswer(
        new TextEncoder().encode(body),
        { token: "$.access_token" },
        now,
        4096,
      );
      expect(bytes.byteLength, body).toBe(0);
      expect(outcomes).toEqual({ token: "not_json" });
    }
    // Where nothing is to be sealed, the answer is the plugin's as it came, whatever it is.
    expect(sealAnswer(form, {}, now, 4096)).toEqual({
      bytes: form,
      sealed: [],
      outcomes: {},
      taken: [],
    });
  });

  it("withholds a value it cannot seal and says why, and says of a path that leads to nothing that it is absent", () => {
    const { bytes, sealed, outcomes } = sealAnswer(
      answer({
        long: "x".repeat(11),
        credentials: { client_secret: "cs-1", signing_secret: "sig-1" },
        count: 3,
        error: "invalid_code",
      }),
      { long: "$.long", credentials: "$.credentials", count: "$.count", token: "$.access_token" },
      now,
      10,
    );
    expect(sealed).toEqual([]);
    expect(outcomes).toEqual({
      long: "too_long",
      credentials: "not_a_string",
      count: "not_a_string",
      token: "absent",
    });
    // The service's own error stays for the plugin to read; what was named is gone, whole.
    expect(JSON.parse(text(bytes))).toEqual({
      long: "[withheld]",
      credentials: "[withheld]",
      count: "[withheld]",
      error: "invalid_code",
    });
    for (const secret of ["cs-1", "sig-1", "x".repeat(11)]) {
      expect(text(bytes)).not.toContain(secret);
    }
    // Nothing there to seal is nothing to take out: no key, null, an empty string.
    const empty = answer({ none: null, blank: "", list: [] });
    const nothing = sealAnswer(empty, { a: "$.none", b: "$.blank", c: "$.list.0" }, now, 10);
    expect(nothing.outcomes).toEqual({ a: "absent", b: "absent", c: "absent" });
    expect(nothing.bytes).toBe(empty);
    expect(readPath({ a: [{ b: "c" }] }, "$.a.0.b")).toBe("c");
    expect(readPath({ a: [{ b: "c" }] }, "$.a.1.b")).toBeUndefined();
    expect(() => readPath({}, "a.b")).toThrow(/path/);
  });

  it("reads a key the answer holds itself, never one every object inherits", () => {
    const plain = answer({ ok: false });
    const { bytes, outcomes } = sealAnswer(
      plain,
      { a: "$.constructor", b: "$.__proto__", c: "$.ok.toString", d: "$.hasOwnProperty" },
      now,
      4096,
    );
    expect(outcomes).toEqual({ a: "absent", b: "absent", c: "absent", d: "absent" });
    expect(bytes).toBe(plain);
    expect(readPath({}, "$.constructor")).toBeUndefined();
  });

  it("reads every value before it takes any out, so that no seal reads another's mark", () => {
    const { sealed, bytes } = sealAnswer(
      answer({ t: "xoxb-1", nested: { t: "xoxb-2" } }),
      { a: "$.t", b: "$.t", parent: "$.nested", child: "$.nested.t" },
      now,
      4096,
    );
    expect(sealed.map((one) => [one.name, one.value])).toEqual([
      ["a", "xoxb-1"],
      ["b", "xoxb-1"],
      ["child", "xoxb-2"],
    ]);
    expect(JSON.parse(text(bytes))).toEqual({ t: "[sealed]", nested: "[withheld]" });
  });

  it("withholds a value holding a secret the request carried from another setting, and seals one back into its own", () => {
    const carried = [
      { name: "apiToken", forms: formsOf("t0k3n", "bearer") },
      { name: "refreshToken", forms: formsOf("r-1", "body:refresh_token") },
    ];
    const { bytes, sealed, outcomes } = sealAnswer(
      answer({ echo: "Bearer t0k3n", refresh_token: "r-1", access_token: "a-2" }),
      { botToken: "$.echo", refreshToken: "$.refresh_token", accessToken: "$.access_token" },
      now,
      4096,
      carried,
    );
    expect(outcomes).toEqual({ botToken: "echoed", refreshToken: "sealed", accessToken: "sealed" });
    expect(sealed.map((one) => [one.name, one.value])).toEqual([
      ["refreshToken", "r-1"],
      ["accessToken", "a-2"],
    ]);
    expect(JSON.parse(text(bytes))).toEqual({
      echo: "[withheld]",
      refresh_token: "[sealed]",
      access_token: "[sealed]",
    });
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

describe("what of an answer is scrubbed", () => {
  it("knows a value as placed, escaped as JSON, URL-encoded both ways, and basic authentication's base64 and password", () => {
    expect(formsOf("a b/c")).toEqual([
      "a b/c",
      "a b\\/c",
      "a%20b%2Fc",
      "a+b%2Fc",
      "a%20b%2fc",
      "a+b%2fc",
    ]);
    expect(formsOf('q"\\')).toContain('q\\"\\\\');
    const basic = formsOf("client:s3cr et", "basic");
    expect(basic).toEqual(
      expect.arrayContaining([
        "client:s3cr et",
        "client%3As3cr%20et",
        "client%3As3cr+et",
        Buffer.from("client:s3cr et").toString("base64"),
        "s3cr et",
        "s3cr%20et",
      ]),
    );
    expect(formsOf("client:", "basic")).not.toContain("");
    // The pair as the header carries it, however short.
    expect(formsOf("u:p4ss", "basic")).toContain(Buffer.from("u:p4ss").toString("base64"));
    // An answer's JSON may hold a lone surrogate: its forms are spelled, never thrown on.
    const lone = `t${String.fromCharCode(0xd800)}k`;
    expect(formsOf(lone)).toEqual(expect.arrayContaining([lone, "t%EF%BF%BDk"]));
  });

  it("knows a value in the encodings a service may send it back in: small hex digits, escaped slashes, base64 anywhere", () => {
    const token = "sk_live/4f9a+Z0q";
    const forms = formsOf(token, "bearer");
    const echoed = (body: string): string =>
      text(scrubAnswer({}, new TextEncoder().encode(body), forms).bytes);
    // Percent-encoded with small hex digits, as a server that encodes again may spell it.
    expect(echoed("https://api.example.test/cb?key=sk_live%2f4f9a%2bZ0q")).toBe(
      "https://api.example.test/cb?key=[withheld]",
    );
    // In JSON that escapes its slashes.
    expect(echoed('{"echo":"sk_live\\/4f9a+Z0q"}')).toBe('{"echo":"[withheld]"}');
    // In base64, in either alphabet, alone or inside a longer run of it wherever it falls.
    for (const before of ["", "x", "xy", "xyz", "Bearer "]) {
      for (const encoding of ["base64", "base64url"] as const) {
        const run = Buffer.from(`${before}${token} and the rest`).toString(encoding);
        const left = echoed(`{"echo":"${run}"}`);
        expect(left).toContain("[withheld]");
        const rest = Buffer.from(
          left.slice('{"echo":"'.length, -2).replaceAll("[withheld]", ""),
          encoding,
        ).toString("latin1");
        expect(rest).not.toContain(token);
      }
    }
    // In base64 of what the request carried, which a service that encodes the request again
    // encodes: a query's spelling of a value in a query parameter, a JSON body's of one in its
    // field, and for basic the header's base64 of the pair.
    const spelled = 'ab/cd+ef"12345678';
    const pair = "client:s3cr et";
    const carried: readonly [string, SecretPlacement, string, string][] = [
      [
        spelled,
        "query:key",
        "ab%2Fcd%2Bef%2212345678",
        "https://api.example.test/cb?key=ab%2Fcd%2Bef%2212345678",
      ],
      [spelled, "body:secret", 'ab/cd+ef\\"12345678', JSON.stringify({ secret: spelled })],
      [
        pair,
        "basic",
        Buffer.from(pair).toString("base64"),
        `authorization: Basic ${Buffer.from(pair).toString("base64")}`,
      ],
    ];
    for (const [placed, as, asCarried, request] of carried) {
      expect(request, as).toContain(asCarried);
      const run = Buffer.from(request).toString("base64");
      const left = text(scrubAnswer({}, new TextEncoder().encode(run), formsOf(placed, as)).bytes);
      expect(left, as).toContain("[withheld]");
      const rest = Buffer.from(left.replaceAll("[withheld]", ""), "base64").toString("latin1");
      expect(rest, as).not.toContain(placed);
      expect(rest, as).not.toContain(asCarried);
    }
    // A run of base64 without it comes through as it was.
    const other = Buffer.from("nothing of the token in here").toString("base64");
    expect(echoed(other)).toBe(other);
    // A value too short to tell from chance is not looked for in base64.
    expect(formsOf("abcd")).toEqual(["abcd"]);
  });

  it("takes every form out of the headers and the body, and leaves an answer without one as it came", () => {
    const forms = formsOf("t0k/3n");
    const echo = new TextEncoder().encode(
      JSON.stringify({
        headers: { authorization: "Bearer t0k/3n" },
        url: "https://api.example.test/cb?key=t0k%2F3n&key=t0k%2F3n",
      }),
    );
    const { headers, bytes } = scrubAnswer(
      {
        location: "https://api.example.test/cb?key=t0k%2F3n",
        "x-echo": "t0k/3n, t0k/3n",
        "x-t0k/3n": "a header named after it",
      },
      echo,
      forms,
    );
    expect(headers).toEqual({
      location: "https://api.example.test/cb?key=[withheld]",
      "x-echo": "[withheld], [withheld]",
      "x-[withheld]": "a header named after it",
    });
    expect(JSON.parse(text(bytes))).toEqual({
      headers: { authorization: "Bearer [withheld]" },
      url: "https://api.example.test/cb?key=[withheld]&key=[withheld]",
    });
    // The longest form first: the password alone never leaves the rest of the pair behind.
    expect(
      text(
        scrubAnswer({}, new TextEncoder().encode("u:p4ss and p4ss"), formsOf("u:p4ss", "basic"))
          .bytes,
      ),
    ).toBe("[withheld] and [withheld]");
    const binary = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const untouched = scrubAnswer({ "content-type": "image/png" }, binary, forms);
    expect(untouched.bytes).toBe(binary);
    expect(untouched.headers).toEqual({ "content-type": "image/png" });
    expect(scrubAnswer({ a: "b" }, binary, [])).toEqual({ headers: { a: "b" }, bytes: binary });
  });
});
