import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import {
  type PictureFetch,
  type PictureRequest,
  type PictureSource,
  pictureUrlOf,
} from "../ports/picture-source.js";

// Fetches a picture over HTTPS from a public address (ADR-0048). The host is resolved first, and
// every address it resolves to is checked against the networks nobody fetches from: the
// console's own machine and its network, and the link-local range where a platform hands a
// container its credentials; the connection is then made to the address checked, under the
// host's name, so that a name resolved again cannot lead elsewhere. A redirect is followed a
// few times under the same rule, over https only. What comes back must say it is a picture,
// and be no larger than a file handed in.

export interface HttpsPicturesOptions {
  readonly userAgent: string;
  /** How many bytes a picture may be; what is larger is refused, read no further. */
  readonly maxBytes: number;
  readonly timeoutMs?: number | undefined;
  readonly maxRedirects?: number | undefined;
  /** The addresses of a host, as the resolver answers; the system's when left out. */
  readonly resolve?: ((host: string) => Promise<readonly string[]>) | undefined;
  /** Sends one request to one address and answers what arrives; over https when left out. */
  readonly send?: Send | undefined;
}

/** What one exchange answered: the status, the headers (lowercase names) and the body as it arrives. */
export interface Sent {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  /** Ends the exchange before the body is read whole. */
  readonly close: () => void;
}

export type Send = (input: {
  readonly url: URL;
  /** The address the host resolved to, which is where the connection goes. */
  readonly address: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}) => Promise<Sent>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** The networks nobody fetches from: unspecified, loopback, private, link-local, shared, test, multicast and reserved. */
const PRIVATE = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(address, prefix, "ipv6");
}

/** Whether an address is one the console fetches from: public, as far as the ranges say. An address that is not one is not. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const plain = mapped?.[1] ?? address;
  const version = isIP(plain);
  if (version === 0) {
    return false;
  }
  return !PRIVATE.check(plain, version === 6 ? "ipv6" : "ipv4");
}

/** The body up to `maxBytes`, or nothing once it is over; the exchange is closed either way. */
async function readBody(sent: Sent, maxBytes: number): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of sent.body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        sent.close();
        return undefined;
      }
      chunks.push(chunk);
    }
  } finally {
    sent.close();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const systemResolve = async (host: string): Promise<readonly string[]> =>
  (await lookup(host, { all: true })).map((found) => found.address);

/** One request over https to the address given, the host's name on the connection and in the request. */
const httpsSend: Send = ({ url, address, headers, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const family = isIP(address) === 6 ? 6 : 4;
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers,
        servername: url.hostname,
        timeout: timeoutMs,
        // The address was checked; a name resolved again could lead elsewhere.
        lookup: (_host, options, callback) => {
          if (options.all === true) {
            (callback as (err: null, addresses: { address: string; family: number }[]) => void)(
              null,
              [{ address, family }],
            );
          } else {
            (callback as (err: null, address: string, family: number) => void)(
              null,
              address,
              family,
            );
          }
        },
      },
      (response) => {
        const flat: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          flat[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
        }
        resolve({
          status: response.statusCode ?? 0,
          headers: flat,
          body: response as AsyncIterable<Uint8Array>,
          close: () => response.destroy(),
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("the origin did not answer in time")));
    request.on("error", reject);
    request.end();
  });

export function createHttpsPictures(options: HttpsPicturesOptions): PictureSource {
  const resolve = options.resolve ?? systemResolve;
  const send = options.send ?? httpsSend;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  return {
    async fetch(request: PictureRequest): Promise<PictureFetch> {
      let url = pictureUrlOf(request.url);
      if (url === undefined) {
        return { kind: "refused", reason: "not_https" };
      }
      for (let hop = 0; ; hop += 1) {
        let addresses: readonly string[];
        try {
          addresses = await resolve(url.hostname);
        } catch {
          return { kind: "refused", reason: "unreachable" };
        }
        const address = addresses[0];
        if (address === undefined || !addresses.every(isPublicAddress)) {
          return { kind: "refused", reason: "private_address" };
        }
        const headers: Record<string, string> = {
          accept: "image/*",
          "user-agent": options.userAgent,
        };
        // The validators are the first address's; a redirect leads to another picture.
        if (hop === 0 && request.etag !== undefined) {
          headers["if-none-match"] = request.etag;
        }
        if (hop === 0 && request.lastModified !== undefined) {
          headers["if-modified-since"] = request.lastModified;
        }
        let sent: Sent;
        try {
          sent = await send({ url, address, headers, timeoutMs });
        } catch {
          return { kind: "refused", reason: "unreachable" };
        }
        if (REDIRECTS.has(sent.status)) {
          sent.close();
          let next: URL | undefined;
          try {
            next =
              sent.headers.location === undefined
                ? undefined
                : pictureUrlOf(new URL(sent.headers.location, url).href);
          } catch {
            next = undefined;
          }
          if (next === undefined || hop >= maxRedirects) {
            return { kind: "refused", reason: "upstream" };
          }
          url = next;
          continue;
        }
        if (sent.status === 304) {
          sent.close();
          return { kind: "unchanged" };
        }
        if (sent.status !== 200) {
          sent.close();
          return { kind: "refused", reason: "upstream" };
        }
        const contentType = (sent.headers["content-type"] ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase();
        if (contentType === undefined || !contentType.startsWith("image/")) {
          sent.close();
          return { kind: "refused", reason: "not_a_picture" };
        }
        const declared = Number(sent.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          sent.close();
          return { kind: "refused", reason: "too_large" };
        }
        let bytes: Uint8Array | undefined;
        try {
          bytes = await readBody(sent, options.maxBytes);
        } catch {
          return { kind: "refused", reason: "unreachable" };
        }
        if (bytes === undefined) {
          return { kind: "refused", reason: "too_large" };
        }
        return {
          kind: "picture",
          bytes,
          contentType,
          etag: sent.headers.etag,
          lastModified: sent.headers["last-modified"],
        };
      }
    },
  };
}
