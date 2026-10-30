import { describe, expect, it } from "vitest";
import { pictureUrlOf } from "../ports/picture-source.js";
import { createHttpsPictures, isPublicAddress, type Send, type Sent } from "./https-pictures.js";

// The guard and the exchange, with the resolver and the wire answered from here: what reaches
// the real resolver and the real wire is one function each, which these tests do not run.

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An answer as the wire would carry it, its body in the chunks given. */
function answer(
  status: number,
  headers: Record<string, string>,
  chunks: readonly Uint8Array[] = [],
): Sent {
  let closed = false;
  return {
    status,
    headers,
    body: (async function* () {
      for (const chunk of chunks) {
        if (closed) {
          return;
        }
        yield chunk;
      }
    })(),
    close: () => {
      closed = true;
    },
  };
}

function source(
  answers: Record<string, Sent | (() => Sent)>,
  resolve: (host: string) => Promise<readonly string[]> = async () => ["100.128.0.1"],
) {
  const asked: { url: string; address: string; headers: Record<string, string> }[] = [];
  const send: Send = async ({ url, address, headers }) => {
    asked.push({ url: url.href, address, headers: { ...headers } });
    const found = answers[url.href];
    if (found === undefined) {
      throw new Error(`nothing answers ${url.href}`);
    }
    return typeof found === "function" ? found() : found;
  };
  const pictures = createHttpsPictures({
    userAgent: "console-test/1",
    maxBytes: 16,
    maxRedirects: 2,
    resolve,
    send,
  });
  return { pictures, asked };
}

describe("the picture guard", () => {
  it("names a URL the console fetches from: https, the default port, no credentials", () => {
    expect(pictureUrlOf("https://img.example/x.png")?.href).toBe("https://img.example/x.png");
    for (const text of [
      "http://img.example/x.png",
      "https://img.example:8443/x.png",
      "https://user:pass@img.example/x.png",
      "ftp://img.example/x.png",
      "not a url",
      "",
    ]) {
      expect(pictureUrlOf(text), text).toBeUndefined();
    }
  });

  it("knows a public address from the console's own networks", () => {
    for (const address of ["100.128.0.1", "11.0.0.1", "2a01:4f8::1", "::ffff:11.0.0.1"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.9",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "not an address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe("fetching a picture over https", () => {
  it("fetches a picture from the address the host resolves to, asking for pictures and naming itself", async () => {
    const { pictures, asked } = source({
      "https://img.example/x.png": answer(
        200,
        { "content-type": "image/png; charset=binary", etag: '"v1"', "last-modified": "then" },
        [PNG.slice(0, 4), PNG.slice(4)],
      ),
    });
    const fetched = await pictures.fetch({ url: "https://img.example/x.png" });
    expect(fetched).toMatchObject({ kind: "picture", contentType: "image/png", etag: '"v1"' });
    if (fetched.kind === "picture") {
      expect(fetched.bytes).toEqual(PNG);
      expect(fetched.lastModified).toBe("then");
    }
    expect(asked).toEqual([
      {
        url: "https://img.example/x.png",
        address: "100.128.0.1",
        headers: { accept: "image/*", "user-agent": "console-test/1" },
      },
    ]);
  });

  it("asks with what the picture was last fetched as, and takes an unchanged answer", async () => {
    const { pictures, asked } = source({ "https://img.example/x.png": answer(304, {}) });
    expect(
      await pictures.fetch({
        url: "https://img.example/x.png",
        etag: '"v1"',
        lastModified: "then",
      }),
    ).toEqual({ kind: "unchanged" });
    expect(asked[0]?.headers).toMatchObject({
      "if-none-match": '"v1"',
      "if-modified-since": "then",
    });
  });

  it("refuses the console's own networks, by any address the host resolves to", async () => {
    const { pictures, asked } = source({}, async () => ["100.128.0.1", "10.0.0.5"]);
    expect(await pictures.fetch({ url: "https://inside.example/x.png" })).toEqual({
      kind: "refused",
      reason: "private_address",
    });
    expect(asked).toHaveLength(0);
    const unresolved = source({}, async () => []);
    expect(await unresolved.pictures.fetch({ url: "https://nowhere.example/x.png" })).toEqual({
      kind: "refused",
      reason: "private_address",
    });
    expect(await source({}).pictures.fetch({ url: "http://img.example/x.png" })).toEqual({
      kind: "refused",
      reason: "not_https",
    });
  });

  it("follows a redirect a few times, over https and under the same guard, without the validators", async () => {
    const { pictures, asked } = source({
      "https://img.example/a.png": answer(302, { location: "/b.png" }),
      "https://img.example/b.png": answer(301, { location: "https://cdn.example/c.png" }),
      "https://cdn.example/c.png": answer(200, { "content-type": "image/webp" }, [PNG]),
    });
    expect(await pictures.fetch({ url: "https://img.example/a.png", etag: '"v1"' })).toMatchObject({
      kind: "picture",
      contentType: "image/webp",
    });
    expect(asked.map((call) => call.url)).toEqual([
      "https://img.example/a.png",
      "https://img.example/b.png",
      "https://cdn.example/c.png",
    ]);
    expect(asked[0]?.headers["if-none-match"]).toBe('"v1"');
    expect(asked[1]?.headers["if-none-match"]).toBeUndefined();
    const insecure = source({
      "https://img.example/a.png": answer(302, { location: "http://img.example/b.png" }),
    });
    expect(await insecure.pictures.fetch({ url: "https://img.example/a.png" })).toEqual({
      kind: "refused",
      reason: "upstream",
    });
    const forever = source({
      "https://img.example/a.png": answer(302, { location: "https://img.example/a.png" }),
    });
    expect(await forever.pictures.fetch({ url: "https://img.example/a.png" })).toEqual({
      kind: "refused",
      reason: "upstream",
    });
    expect(forever.asked).toHaveLength(3);
  });

  it("takes nothing but a picture of a bounded size, and says why not otherwise", async () => {
    const big = new Uint8Array(17);
    const { pictures } = source({
      "https://img.example/page": answer(200, { "content-type": "text/html" }, [PNG]),
      "https://img.example/declared": answer(
        200,
        { "content-type": "image/png", "content-length": "17" },
        [big],
      ),
      "https://img.example/streamed": answer(200, { "content-type": "image/png" }, [PNG, big]),
      "https://img.example/gone": answer(404, { "content-type": "image/png" }),
      "https://img.example/down": () => {
        throw new Error("connection refused");
      },
    });
    const reasons: Record<string, string> = {};
    for (const path of ["page", "declared", "streamed", "gone", "down"]) {
      const fetched = await pictures.fetch({ url: `https://img.example/${path}` });
      reasons[path] = fetched.kind === "refused" ? fetched.reason : fetched.kind;
    }
    expect(reasons).toEqual({
      page: "not_a_picture",
      declared: "too_large",
      streamed: "too_large",
      gone: "upstream",
      down: "unreachable",
    });
  });
});
