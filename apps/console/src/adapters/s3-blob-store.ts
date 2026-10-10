import { createHash, createHmac } from "node:crypto";
import { MAX_FILE_BYTES } from "@skillcdn/console/api";
import type { Logger } from "../logger.js";
import { type BlobStore, BlobStoreError, type StoredBlob } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import { type FetchLike, readBody } from "./upstream.js";

// The blob store in a bucket, through the S3 API (ADR-0016): one object per file, under the
// SHA-256 of its bytes, with a prefix the operator chooses. The console signs its own requests
// (Signature Version 4, the way every store with the S3 API checks them) with the one pair of
// keys it is configured with, so that nothing here names a cloud and no SDK comes along. What
// the bucket answers is bounded and checked: the bytes read back must be the bytes of the hash
// they were asked by.

/** The SHA-256 of nothing, which a request without a body is signed with. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/** A file is at most `MAX_FILE_BYTES`; an upload of one over a slow link may take a while. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** An error from the bucket is a short XML document; this bounds what is read of one for the log. */
const MAX_ERROR_BYTES = 4096;

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** With temporary credentials, the token that comes with them. */
  readonly sessionToken?: string | undefined;
}

export interface S3Options {
  /** The origin of the store, such as `https://s3.us-east-1.amazonaws.com` or `http://127.0.0.1:7070`. */
  readonly endpoint: string;
  readonly bucket: string;
  /** The region the signature names; `us-east-1` where the store has none. */
  readonly region: string;
  readonly credentials: S3Credentials;
  /** What every key begins with: empty, or folders ending with a slash. */
  readonly keyPrefix: string;
  /** The bucket in the path (`endpoint/bucket/key`), or in the host (`bucket.endpoint/key`). */
  readonly pathStyle: boolean;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly userAgent: string;
  /** Where the bytes were kept before the bucket: read from there when the bucket has nothing under a hash. */
  readonly before?: BlobStore | undefined;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface S3BlobStore extends BlobStore {
  /**
   * Asks the bucket whether it is there, for boot: `bucket_not_found` and `misplaced` are
   * settings to fix; `forbidden` may be credentials that cannot list the bucket but can read
   * and write in it; `unavailable` is the store, or the way to it, not answering.
   */
  probe(): Promise<void>;
}

export interface SigningInput {
  readonly method: string;
  readonly url: URL;
  /** The headers to sign, by lowercase name, `host` among them, as they will be sent. */
  readonly headers: Readonly<Record<string, string>>;
  /** The SHA-256 of the body, in hex, as `x-amz-content-sha256` carries it. */
  readonly payloadHash: string;
  readonly now: Date;
  readonly credentials: S3Credentials;
  readonly region: string;
}

const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** `20130524T000000Z`, as `x-amz-date` carries the time. */
export function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** RFC 3986 unreserved characters only: what the store encodes a segment to when it checks. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** The path as the store canonicalizes it: each segment decoded, then encoded once. */
function canonicalPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeSegment(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQuery(search: URLSearchParams): string {
  return [...search.entries()]
    .map(([name, value]) => [encodeSegment(name), encodeSegment(value)] as const)
    .sort(([a, aValue], [b, bValue]) =>
      a < b ? -1 : a > b ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0,
    )
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

/**
 * The `Authorization` header of a request, as Signature Version 4 computes it for the S3 API:
 * the canonical request hashed into a string to sign, signed with a key derived from the secret
 * for the day, the region and the service. Pure, so that the documented examples check it.
 */
export function signS3Request(input: SigningInput): string {
  const names = Object.keys(input.headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${(input.headers[name] ?? "").trim().replace(/ +/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.url.pathname),
    canonicalQuery(input.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const date = amzDate(input.now);
  const day = date.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), "s3"),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** The code of an error the store answered with, out of its XML, for the log; never the rest. */
async function errorCodeOf(response: Response): Promise<string | undefined> {
  try {
    const bytes = await readBody(response, MAX_ERROR_BYTES);
    if (bytes === undefined) {
      return undefined;
    }
    const match = /<Code>([A-Za-z0-9._-]{1,64})<\/Code>/.exec(new TextDecoder().decode(bytes));
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function createS3BlobStore(options: S3Options): S3BlobStore {
  const { logger, clock, credentials, region } = options;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const urlOf = (key: string | undefined): URL => {
    const url = new URL(options.endpoint);
    const path = key === undefined ? "" : `/${key}`;
    if (options.pathStyle) {
      url.pathname = `/${options.bucket}${path}`;
    } else {
      url.hostname = `${options.bucket}.${url.hostname}`;
      url.pathname = path === "" ? "/" : path;
    }
    return url;
  };

  /**
   * One signed request. What came back is the caller's to read; a refusal, a redirection or
   * no answer at all is already an error, named for what it says about the settings.
   */
  const request = async (
    method: "GET" | "PUT" | "HEAD",
    key: string | undefined,
    body: Uint8Array | undefined,
    payloadHash: string,
  ): Promise<Response> => {
    const url = urlOf(key);
    const now = clock.now();
    const signed: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate(now),
    };
    if (credentials.sessionToken !== undefined) {
      signed["x-amz-security-token"] = credentials.sessionToken;
    }
    if (body !== undefined) {
      signed["content-type"] = "application/octet-stream";
    }
    const authorization = signS3Request({
      method,
      url,
      headers: signed,
      payloadHash,
      now,
      credentials,
      region,
    });
    // The platform sets `host` from the URL itself, exactly as it was signed.
    const { host: _host, ...headers } = signed;
    let response: Response;
    try {
      response = await send(url.href, {
        method,
        headers: { ...headers, authorization, "user-agent": options.userAgent },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BlobStoreError("unavailable", "the bucket could not be reached", { cause: error });
    }
    if (response.ok || response.status === 404) {
      return response;
    }
    const code = await errorCodeOf(response);
    const status = response.status;
    if (status === 301 || status === 307 || status === 308) {
      const elsewhere = response.headers.get("x-amz-bucket-region");
      throw new BlobStoreError(
        "misplaced",
        `the bucket is served from elsewhere (${status}${elsewhere === null ? "" : `, region ${elsewhere}`}): check S3_ENDPOINT and S3_REGION`,
      );
    }
    if (status === 403 || status === 401) {
      throw new BlobStoreError(
        "forbidden",
        `the bucket refused the credentials (${status}${code === undefined ? "" : `, ${code}`})`,
      );
    }
    throw new BlobStoreError(
      "unavailable",
      `the bucket answered ${status}${code === undefined ? "" : ` (${code})`}`,
    );
  };

  return {
    async put(bytes, _now) {
      const sha256 = sha256Hex(bytes);
      // The hash travels with the bytes, so the store keeps nothing it did not receive whole.
      const response = await request("PUT", `${options.keyPrefix}${sha256}`, bytes, sha256);
      await response.body?.cancel();
      if (response.status === 404) {
        throw new BlobStoreError("bucket_not_found", "there is no such bucket at the endpoint");
      }
      const kept: StoredBlob = { sha256, size: bytes.byteLength };
      return kept;
    },

    async get(sha256) {
      const response = await request(
        "GET",
        `${options.keyPrefix}${sha256}`,
        undefined,
        EMPTY_SHA256,
      );
      if (response.status === 404) {
        await response.body?.cancel();
        return options.before?.get(sha256);
      }
      const bytes = await readBody(response, MAX_FILE_BYTES);
      if (bytes === undefined || sha256Hex(bytes) !== sha256) {
        logger.error({ sha256 }, "the bucket holds other bytes under a hash than the hash's");
        throw new BlobStoreError(
          "corrupt",
          "the bytes in the bucket are not the bytes of their hash",
        );
      }
      return bytes;
    },

    async probe() {
      const response = await request("HEAD", undefined, undefined, EMPTY_SHA256);
      await response.body?.cancel();
      if (response.status === 404) {
        throw new BlobStoreError("bucket_not_found", "there is no such bucket at the endpoint");
      }
    },
  };
}
