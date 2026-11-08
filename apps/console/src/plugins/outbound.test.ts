import { type PluginFetchInit, PluginRefusal } from "@skillcdn/console/plugin";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { Outbound, type OutboundAnswer, type OutboundSend, type SecretAccess } from "./outbound.js";

// A plugin's outbound request with the wire answered from here (docs/specs/plugins.md, "The
// context", `ctx.fetch`; ADR-0070): the methods it may use, what a plugin reads of an answer to a
// request the console put a secret into or was to seal one out of, and the hosts a secret is
// sealed from. What a server sends back of the request never hands the plugin a secret.

type Sent = Parameters<OutboundSend>[0];

const encode = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The plugin's secret settings as the registry answers them: a value where one is set, and the hosts it is pinned to. */
const SETTINGS: Readonly<
  Record<string, { readonly value?: string; readonly hosts?: readonly string[] }>
> = {
  apiToken: { value: "t0k/3n" },
  pair: { value: "client:s3cr3t" },
  botToken: { hosts: ["api.example.test"] },
  pinned: { value: "p1n", hosts: ["*.elsewhere.test"] },
};

function harness(answer: (input: Sent) => OutboundAnswer) {
  const sent: Sent[] = [];
  const sealed: { name: string; value: string; host: string }[] = [];
  const outbound = new Outbound({
    clock: { now: () => new Date("2026-11-08T12:00:00.000Z") },
    logger: pino({ level: "silent" }),
    resolve: async () => ["93.184.216.34"],
    send: async (input) => {
      sent.push(input);
      return answer(input);
    },
  });
  const secrets: SecretAccess = {
    sealable: (name) => {
      const setting = SETTINGS[name];
      if (setting === undefined) {
        throw new PluginRefusal("plugin.invalid_args", `${name} is not a secret setting`);
      }
      return { hosts: setting.hosts };
    },
    open: async (name) => {
      const setting = SETTINGS[name];
      return setting?.value === undefined
        ? undefined
        : { value: setting.value, expiresAt: undefined, hosts: setting.hosts };
    },
    seal: async (name, value, _expiresAt, host) => {
      sealed.push({ name, value, host });
    },
  };
  const fetch = (url: string, init: PluginFetchInit) =>
    outbound.fetch(
      "leave",
      ["outbound:api.example.test", "outbound:*.elsewhere.test"],
      url,
      init,
      secrets,
    );
  return { fetch, sent, sealed };
}

/** A server that sends the request back, as one answering TRACE does, or an endpoint made to echo. */
const echo = (input: Sent): OutboundAnswer => ({
  status: 200,
  headers: {
    "content-type": "application/json",
    "x-echo-authorization": input.headers.authorization ?? "",
  },
  bytes: encode(
    JSON.stringify({
      method: input.method,
      url: input.url.href,
      headers: input.headers,
      body: input.body === undefined ? null : text(input.body),
    }),
  ),
});

async function codeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
    return "sent";
  } catch (error) {
    return (error as { readonly code?: string }).code;
  }
}

describe("the methods a plugin's request may use", () => {
  it("takes GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS, and refuses TRACE and any other before anything is sent", async () => {
    const { fetch, sent } = harness(echo);
    for (const method of ["get", "HEAD", "post", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(await codeOf(fetch("https://api.example.test/", { method })), method).toBe("sent");
    }
    expect(sent.map((one) => one.method)).toEqual([
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ]);
    sent.length = 0;
    for (const method of ["TRACE", "trace", "TRACK", "CONNECT", "PROPFIND", "GET ", "", 7, null]) {
      expect(
        await codeOf(
          fetch("https://api.example.test/", {
            method: method as string,
            secret: { name: "apiToken", as: "bearer" },
          }),
        ),
        String(method),
      ).toBe("plugin.invalid_args");
    }
    expect(sent).toEqual([]);
    expect(await codeOf(fetch("https://api.example.test/", {}))).toBe("sent");
    expect(sent[0]?.method).toBe("GET");
  });
});

describe("what a plugin reads of an answer", () => {
  it("never a secret the console put in, sent back in the answer's headers or its body", async () => {
    const { fetch, sent } = harness(echo);
    const answer = await fetch("https://api.example.test/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "there" }),
      secrets: [
        { name: "apiToken", as: "bearer" },
        { name: "pair", as: "body:credentials" },
      ],
    });
    expect(sent[0]?.headers.authorization).toBe("Bearer t0k/3n");
    const read = `${JSON.stringify(answer.headers)} ${text(answer.bytes)}`;
    for (const secret of ["t0k/3n", "t0k%2F3n", "s3cr3t"]) {
      expect(read).not.toContain(secret);
    }
    expect(answer.headers["x-echo-authorization"]).toBe("Bearer [withheld]");
    const echoed = JSON.parse(text(answer.bytes)) as {
      headers: Record<string, string>;
      body: string;
    };
    expect(echoed.headers.authorization).toBe("Bearer [withheld]");
    expect(JSON.parse(echoed.body)).toEqual({ hello: "there", credentials: "[withheld]" });
    expect(answer.sealed).toBeUndefined();
  });

  it("never basic authentication's pair, in the base64 the header carried it in", async () => {
    const { fetch } = harness(echo);
    const answer = await fetch("https://api.example.test/echo", {
      secret: { name: "pair", as: "basic" },
    });
    expect(answer.headers["x-echo-authorization"]).toBe("Basic [withheld]");
    expect(text(answer.bytes)).not.toContain(Buffer.from("client:s3cr3t").toString("base64"));
    expect(JSON.parse(text(answer.bytes)).headers.authorization).toBe("Basic [withheld]");
  });

  it("a redirect as it came, never followed, without the query secret its location carries", async () => {
    const { fetch, sent } = harness((input) => ({
      status: 302,
      headers: { location: input.url.href, "content-type": "text/html" },
      bytes: encode(`<a href="${input.url.href}">Moved</a>`),
    }));
    const answer = await fetch("https://api.example.test/authorize?x=1", {
      secret: { name: "apiToken", as: "query:key" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url.href).toBe("https://api.example.test/authorize?x=1&key=t0k%2F3n");
    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe("https://api.example.test/authorize?x=1&key=[withheld]");
    expect(text(answer.bytes)).toBe(
      '<a href="https://api.example.test/authorize?x=1&key=[withheld]">Moved</a>',
    );
  });

  it("no body of an answer to a seal that is no JSON, and what became of the seal, sealing nothing", async () => {
    // A token endpoint that answers a form unless the request asks for JSON.
    const { fetch, sealed } = harness(() => ({
      status: 200,
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      bytes: encode("access_token=gho_s3cret&scope=repo&token_type=bearer"),
    }));
    const answer = await fetch("https://api.example.test/login/oauth/access_token", {
      method: "POST",
      seal: { botToken: "$.access_token" },
    });
    expect(answer.status).toBe(200);
    expect(answer.bytes.byteLength).toBe(0);
    expect(answer.sealed).toEqual({ botToken: "not_json" });
    expect(sealed).toEqual([]);
  });

  it("the answer without what was sealed or withheld, wherever else it held it", async () => {
    const { fetch, sealed } = harness(() => ({
      status: 200,
      headers: { "content-type": "application/json", "x-token": "xoxb-1" },
      bytes: encode(
        JSON.stringify({
          access_token: "xoxb-1",
          authed_user: { access_token: "xoxb-1" },
          credentials: { signing_secret: "s1gn" },
        }),
      ),
    }));
    const answer = await fetch("https://api.example.test/oauth/token", {
      method: "POST",
      seal: { botToken: "$.access_token", apiToken: "$.credentials" },
    });
    expect(answer.sealed).toEqual({ botToken: "sealed", apiToken: "not_a_string" });
    expect(sealed).toEqual([{ name: "botToken", value: "xoxb-1", host: "api.example.test" }]);
    expect(JSON.parse(text(answer.bytes))).toEqual({
      access_token: "[sealed]",
      authed_user: { access_token: "[withheld]" },
      credentials: "[withheld]",
    });
    expect(answer.headers["x-token"]).toBe("[withheld]");
  });

  it("no seal of an echo of a secret the request carried, as another setting", async () => {
    const { fetch, sealed } = harness(echo);
    const answer = await fetch("https://api.example.test/echo", {
      secret: { name: "apiToken", as: "bearer" },
      seal: { botToken: "$.headers.authorization" },
    });
    expect(answer.sealed).toEqual({ botToken: "echoed" });
    expect(sealed).toEqual([]);
    expect(JSON.parse(text(answer.bytes)).headers.authorization).toBe("[withheld]");
  });
});

describe("the hosts a secret is sealed from", () => {
  it("those its setting pins it to alone, refused before the request goes out", async () => {
    const { fetch, sent, sealed } = harness(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      bytes: encode(JSON.stringify({ token: "from-elsewhere" })),
    }));
    expect(await codeOf(fetch("https://api.example.test/", { seal: { pinned: "$.token" } }))).toBe(
      "plugin.forbidden",
    );
    expect(sent).toEqual([]);
    const answer = await fetch("https://hooks.elsewhere.test/", { seal: { pinned: "$.token" } });
    expect(answer.sealed).toEqual({ pinned: "sealed" });
    // A setting that names no hosts is sealed from any the plugin reaches; a name that is no
    // secret setting is refused before anything is sent.
    expect(
      (await fetch("https://api.example.test/", { seal: { apiToken: "$.token" } })).sealed,
    ).toEqual({ apiToken: "sealed" });
    expect(sealed).toEqual([
      { name: "pinned", value: "from-elsewhere", host: "hooks.elsewhere.test" },
      { name: "apiToken", value: "from-elsewhere", host: "api.example.test" },
    ]);
    expect(await codeOf(fetch("https://api.example.test/", { seal: { nothing: "$.token" } }))).toBe(
      "plugin.invalid_args",
    );
    expect(sent).toHaveLength(2);
  });
});
