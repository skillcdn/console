import { createHash } from "node:crypto";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { type BlobStore, BlobStoreError } from "../ports/blob-store.js";
import { amzDate, createS3BlobStore, type S3Options, signS3Request } from "./s3-blob-store.js";

// The signing against the examples Amazon publishes for Signature Version 4 with the S3 API
// (the API reference, "Authenticating Requests: Using the Authorization Header"), and the
// store against a bucket that never leaves the process: what is sent, what is checked of what
// comes back, and what each refusal becomes.

/** The example credentials of the documentation, which belong to nobody. */
const EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const EXAMPLE_TIME = new Date("2013-05-24T00:00:00Z");
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

describe("signS3Request", () => {
  const signatureOf = (authorization: string) =>
    /Signature=([0-9a-f]{64})$/.exec(authorization)?.[1];

  it("signs a GET of an object as the documentation's example does", () => {
    const authorization = signS3Request({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        range: "bytes=0-9",
        "x-amz-content-sha256": EMPTY,
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: EMPTY,
      now: EXAMPLE_TIME,
      credentials: EXAMPLE,
      region: "us-east-1",
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("signs a PUT of an object, with a character to encode in its key", () => {
    const body = "Welcome to Amazon S3.";
    const authorization = signS3Request({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-content-sha256": sha256(body),
        "x-amz-date": "20130524T000000Z",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      payloadHash: sha256(body),
      now: EXAMPLE_TIME,
      credentials: EXAMPLE,
      region: "us-east-1",
    });
    expect(signatureOf(authorization)).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("signs a query without a value, and a query of several parameters, in canonical order", () => {
    const headers = {
      host: "examplebucket.s3.amazonaws.com",
      "x-amz-content-sha256": EMPTY,
      "x-amz-date": "20130524T000000Z",
    };
    const common = {
      method: "GET",
      headers,
      payloadHash: EMPTY,
      now: EXAMPLE_TIME,
      credentials: EXAMPLE,
      region: "us-east-1",
    };
    expect(
      signatureOf(
        signS3Request({
          ...common,
          url: new URL("https://examplebucket.s3.amazonaws.com/?lifecycle"),
        }),
      ),
    ).toBe("fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
    expect(
      signatureOf(
        signS3Request({
          ...common,
          url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"),
        }),
      ),
    ).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("writes the time as x-amz-date carries it", () => {
    expect(amzDate(EXAMPLE_TIME)).toBe("20130524T000000Z");
    expect(amzDate(new Date("2026-10-11T09:08:07.654Z"))).toBe("20261011T090807Z");
  });
});

/** A bucket in memory that checks every request as a store with the S3 API would. */
function createBucket(options: {
  readonly bucket: string;
  readonly credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  readonly region?: string;
  readonly pathStyle?: boolean;
  readonly endpointHost?: string;
}) {
  const objects = new Map<string, Uint8Array>();
  const requests: { method: string; url: string; headers: Record<string, string> }[] = [];
  let answerWith: ((request: Request) => Response | undefined) | undefined;
  const region = options.region ?? "us-east-1";
  const fetchLike = async (input: string, init: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    requests.push({ method: request.method, url: request.url, headers });
    const forced = answerWith?.(request);
    if (forced !== undefined) {
      return forced;
    }
    // The bucket is in the path or in the host; either way the key is the rest of the path.
    const pathStyle = options.pathStyle ?? true;
    const expectedHost = pathStyle
      ? (options.endpointHost ?? "store.test")
      : `${options.bucket}.${options.endpointHost ?? "store.test"}`;
    const inPath =
      url.pathname.startsWith(`/${options.bucket}/`) || url.pathname === `/${options.bucket}`;
    if (url.host !== expectedHost || (pathStyle && !inPath)) {
      return new Response(`<Error><Code>NoSuchBucket</Code></Error>`, { status: 404 });
    }
    const path = pathStyle ? url.pathname.slice(options.bucket.length + 1) : url.pathname;
    const key = path.replace(/^\//, "");
    // The signature is checked by signing the same request with the keys the bucket knows.
    const authorization = headers.authorization ?? "";
    const signedHeaders = /SignedHeaders=([^,]+),/.exec(authorization)?.[1]?.split(";") ?? [];
    const signed: Record<string, string> = {};
    for (const name of signedHeaders) {
      signed[name] = name === "host" ? url.host : (headers[name] ?? "");
    }
    const payloadHash = headers["x-amz-content-sha256"] ?? "";
    const expected = signS3Request({
      method: request.method,
      url,
      headers: signed,
      payloadHash,
      now: new Date(
        (headers["x-amz-date"] ?? "").replace(
          /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
          "$1-$2-$3T$4:$5:$6Z",
        ),
      ),
      credentials: options.credentials,
      region,
    });
    const token = options.credentials.sessionToken;
    if (
      authorization !== expected ||
      !signedHeaders.includes("host") ||
      !signedHeaders.includes("x-amz-date") ||
      !signedHeaders.includes("x-amz-content-sha256") ||
      (token !== undefined && headers["x-amz-security-token"] !== token)
    ) {
      return new Response(`<Error><Code>SignatureDoesNotMatch</Code></Error>`, { status: 403 });
    }
    if (request.method === "HEAD" && key === "") {
      return new Response(null, { status: 200 });
    }
    if (request.method === "PUT") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (sha256(bytes) !== payloadHash) {
        return new Response(`<Error><Code>XAmzContentSHA256Mismatch</Code></Error>`, {
          status: 400,
        });
      }
      objects.set(key, bytes);
      return new Response(null, { status: 200 });
    }
    const found = objects.get(key);
    if (found === undefined) {
      return new Response(`<Error><Code>NoSuchKey</Code></Error>`, { status: 404 });
    }
    return new Response(new Uint8Array(found), { status: 200 });
  };
  return {
    objects,
    requests,
    fetch: fetchLike,
    answer(handler: ((request: Request) => Response | undefined) | undefined) {
      answerWith = handler;
    },
  };
}

const CREDENTIALS = { accessKeyId: "console", secretAccessKey: "console-dev-only" };

function storeOn(
  bucket: ReturnType<typeof createBucket>,
  overrides: Partial<S3Options> = {},
): ReturnType<typeof createS3BlobStore> {
  return createS3BlobStore({
    endpoint: "https://store.test",
    bucket: "files",
    region: "us-east-1",
    credentials: CREDENTIALS,
    keyPrefix: "console/",
    pathStyle: true,
    clock: { now: () => new Date("2026-10-11T10:00:00Z") },
    logger: pino({ level: "silent" }),
    userAgent: "console-test/0",
    fetch: bucket.fetch,
    ...overrides,
  });
}

describe("the blob store in a bucket", () => {
  const bytes = new TextEncoder().encode("# The report\n");
  const hash = sha256(bytes);

  it("keeps the bytes under their hash with the hash on the request, and reads them back as they were", async () => {
    const bucket = createBucket({ bucket: "files", credentials: CREDENTIALS });
    const store = storeOn(bucket);
    expect(await store.put(bytes, new Date())).toEqual({ sha256: hash, size: bytes.byteLength });
    expect(bucket.objects.get(`console/${hash}`)).toEqual(bytes);
    const [sent] = bucket.requests;
    expect(sent).toMatchObject({
      method: "PUT",
      url: `https://store.test/files/console/${hash}`,
    });
    expect(sent?.headers).toMatchObject({
      "content-type": "application/octet-stream",
      "x-amz-content-sha256": hash,
      "x-amz-date": "20261011T100000Z",
      "user-agent": "console-test/0",
    });
    expect(sent?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=console\/20261011\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(sent?.headers).not.toHaveProperty("x-amz-security-token");
    // The same bytes again are the same object; nothing is read first.
    expect(await store.put(bytes, new Date())).toEqual({ sha256: hash, size: bytes.byteLength });
    expect(bucket.requests.map((request) => request.method)).toEqual(["PUT", "PUT"]);

    expect(await store.get(hash)).toEqual(bytes);
    expect(bucket.requests[2]).toMatchObject({ method: "GET" });
    expect(bucket.requests[2]?.headers["x-amz-content-sha256"]).toBe(EMPTY);
    expect(await store.get(sha256("something else"))).toBeUndefined();
  });

  it("puts the bucket in the host when told to, and signs a session token with the rest", async () => {
    const credentials = { ...CREDENTIALS, sessionToken: "a-temporary-token" };
    const bucket = createBucket({ bucket: "files", credentials, pathStyle: false });
    const store = storeOn(bucket, { credentials, pathStyle: false, keyPrefix: "" });
    await store.put(bytes, new Date());
    expect(bucket.requests[0]).toMatchObject({ url: `https://files.store.test/${hash}` });
    expect(bucket.requests[0]?.headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token,",
    );
    expect(await store.get(hash)).toEqual(bytes);
    await expect(store.probe()).resolves.toBeUndefined();
    expect(bucket.requests[2]).toMatchObject({ method: "HEAD", url: "https://files.store.test/" });
  });

  it("reads from where the bytes were kept before the bucket, when the bucket has nothing", async () => {
    const bucket = createBucket({ bucket: "files", credentials: CREDENTIALS });
    const before: BlobStore = {
      put: () => Promise.reject(new Error("not written")),
      get: async (sha256) => (sha256 === hash ? bytes : undefined),
    };
    const store = storeOn(bucket, { before });
    expect(await store.get(hash)).toEqual(bytes);
    expect(await store.get(sha256("never kept"))).toBeUndefined();
    expect(bucket.requests).toHaveLength(2);
  });

  it("refuses bytes that are not the bytes of their hash, and more than a file may be", async () => {
    const bucket = createBucket({ bucket: "files", credentials: CREDENTIALS });
    bucket.objects.set(`console/${hash}`, new TextEncoder().encode("tampered"));
    const store = storeOn(bucket);
    await expect(store.get(hash)).rejects.toMatchObject({ code: "blob_store.corrupt" });
    bucket.answer(() => new Response(new Uint8Array(11 * 1024 * 1024), { status: 200 }));
    await expect(store.get(hash)).rejects.toMatchObject({ code: "blob_store.corrupt" });
  });

  it("names what a refusal says about the settings, and never throws anything else", async () => {
    const bucket = createBucket({ bucket: "files", credentials: CREDENTIALS });
    const wrongKeys = storeOn(bucket, {
      credentials: { accessKeyId: "console", secretAccessKey: "not-the-secret" },
    });
    await expect(wrongKeys.put(bytes, new Date())).rejects.toMatchObject({
      code: "blob_store.forbidden",
      message: "the bucket refused the credentials (403, SignatureDoesNotMatch)",
    });
    const wrongBucket = storeOn(bucket, { bucket: "elsewhere" });
    await expect(wrongBucket.put(bytes, new Date())).rejects.toMatchObject({
      code: "blob_store.bucket_not_found",
    });
    await expect(wrongBucket.probe()).rejects.toMatchObject({
      code: "blob_store.bucket_not_found",
    });

    const store = storeOn(bucket);
    bucket.answer(
      () => new Response(null, { status: 301, headers: { "x-amz-bucket-region": "eu-west-1" } }),
    );
    await expect(store.probe()).rejects.toMatchObject({
      code: "blob_store.misplaced",
      message:
        "the bucket is served from elsewhere (301, region eu-west-1): check S3_ENDPOINT and S3_REGION",
    });
    bucket.answer(() => new Response("<Error><Code>SlowDown</Code></Error>", { status: 503 }));
    await expect(store.get(hash)).rejects.toMatchObject({
      code: "blob_store.unavailable",
      message: "the bucket answered 503 (SlowDown)",
    });
    bucket.answer(() => {
      throw new TypeError("fetch failed");
    });
    const unreachable = await store.put(bytes, new Date()).catch((error: unknown) => error);
    expect(unreachable).toBeInstanceOf(BlobStoreError);
    expect(unreachable).toMatchObject({ code: "blob_store.unavailable" });
    expect((unreachable as BlobStoreError).cause).toBeInstanceOf(TypeError);
  });
});
