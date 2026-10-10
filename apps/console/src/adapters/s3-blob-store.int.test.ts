import { createHash, randomBytes } from "node:crypto";
import {
  projectPath,
  REST_ROUTES,
  restErrorSchema,
  restRunSchema,
  restTaskSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import type { BlobStore } from "../ports/blob-store.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import {
  amzDate,
  createS3BlobStore,
  type S3Credentials,
  type S3Options,
  signS3Request,
} from "./s3-blob-store.js";

// The store against a real bucket with the S3 API: the one `deploy/compose.dev.yaml` runs, or
// wherever TEST_S3_URL points, as `http://<access key>:<secret>@<host>:<port>/<bucket>`. The
// unit tests check the store against a bucket in memory; this checks it against one that
// computes the signatures itself, and a file handed in through the REST API, kept there and
// read back. Without a bucket these tests fail; they do not skip.

/** Where `deploy/compose.dev.yaml` listens, with its throwaway keys and the bucket the tests make. */
export const DEV_S3_URL = "http://console:console-dev-only@127.0.0.1:7070/console";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

interface Bucket {
  readonly endpoint: string;
  readonly bucket: string;
  readonly credentials: S3Credentials;
}

function bucketOf(url: string): Bucket {
  const parsed = new URL(url);
  return {
    endpoint: parsed.origin,
    bucket: parsed.pathname.replace(/^\//, ""),
    credentials: {
      accessKeyId: decodeURIComponent(parsed.username),
      secretAccessKey: decodeURIComponent(parsed.password),
    },
  };
}

/** One signed request to the bucket, as the tests need it: to make the bucket, and to tamper with an object. */
async function sendSigned(
  at: Bucket,
  method: "PUT",
  key: string | undefined,
  body?: Uint8Array,
): Promise<Response> {
  const url = new URL(`${at.endpoint}/${at.bucket}${key === undefined ? "" : `/${key}`}`);
  const now = new Date();
  const payloadHash = body === undefined ? EMPTY : sha256(body);
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate(now),
  };
  const authorization = signS3Request({
    method,
    url,
    headers,
    payloadHash,
    now,
    credentials: at.credentials,
    region: "us-east-1",
  });
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, { method, headers: { ...sent, authorization }, body });
  } catch (error) {
    throw new Error(
      "integration tests need a bucket with the S3 API: run `docker compose -f deploy/compose.dev.yaml up -d`, or point TEST_S3_URL at one",
      { cause: error },
    );
  }
}

/** Makes the bucket, once: a bucket that is there already is the same thing. */
async function ensureBucket(at: Bucket): Promise<void> {
  const response = await sendSigned(at, "PUT", undefined);
  await response.body?.cancel();
  if (response.status !== 200 && response.status !== 409) {
    throw new Error(`the bucket could not be made: ${response.status}`);
  }
}

let at: Bucket;
/** A folder of this run's own in the shared bucket, so that runs never see each other. */
let prefix: string;

const storeOn = (overrides: Partial<S3Options> = {}) =>
  createS3BlobStore({
    endpoint: at.endpoint,
    bucket: at.bucket,
    region: "us-east-1",
    credentials: at.credentials,
    keyPrefix: prefix,
    pathStyle: true,
    clock: { now: () => new Date() },
    logger: pino({ level: "silent" }),
    userAgent: "console-test/0",
    ...overrides,
  });

const bytes = randomBytes(300_000);
const hash = sha256(bytes);

beforeAll(async () => {
  at = bucketOf(process.env.TEST_S3_URL ?? DEV_S3_URL);
  prefix = `test-${randomBytes(4).toString("hex")}/`;
  await ensureBucket(at);
});

describe("the blob store on a bucket with the S3 API", () => {
  it("keeps bytes under their hash, reads them back whole, and has nothing under a hash it never saw", async () => {
    const store = storeOn();
    await expect(store.probe()).resolves.toBeUndefined();
    expect(await store.put(bytes, new Date())).toEqual({ sha256: hash, size: bytes.byteLength });
    expect(await store.put(bytes, new Date())).toEqual({ sha256: hash, size: bytes.byteLength });
    const read = await store.get(hash);
    expect(read).toBeDefined();
    expect(Buffer.from(read ?? []).equals(bytes)).toBe(true);
    expect(await store.get(sha256("never kept"))).toBeUndefined();
  });

  it("reads what was kept before the bucket from there, and refuses bytes that are not their hash's", async () => {
    const elsewhere = new TextEncoder().encode("kept in the rows before the bucket");
    const before: BlobStore = {
      put: () => Promise.reject(new Error("not written here")),
      get: async (asked) => (asked === sha256(elsewhere) ? elsewhere : undefined),
    };
    const store = storeOn({ before });
    expect(await store.get(sha256(elsewhere))).toEqual(elsewhere);
    expect(await store.get(sha256("nowhere"))).toBeUndefined();

    const tampered = new TextEncoder().encode("not the bytes of the hash");
    const key = `${prefix}${sha256("a hash with other bytes under it")}`;
    const written = await sendSigned(at, "PUT", key, tampered);
    await written.body?.cancel();
    expect(written.status).toBe(200);
    await expect(store.get(sha256("a hash with other bytes under it"))).rejects.toMatchObject({
      code: "blob_store.corrupt",
    });
  });

  it("says what a refusal means: the keys, the bucket, or the way to it", async () => {
    const wrongKeys = storeOn({
      credentials: { accessKeyId: at.credentials.accessKeyId, secretAccessKey: "not-the-secret" },
    });
    await expect(wrongKeys.put(bytes, new Date())).rejects.toMatchObject({
      code: "blob_store.forbidden",
    });
    const noSuchBucket = storeOn({ bucket: `${at.bucket}-${randomBytes(3).toString("hex")}` });
    await expect(noSuchBucket.probe()).rejects.toMatchObject({
      code: "blob_store.bucket_not_found",
    });
    await expect(noSuchBucket.put(bytes, new Date())).rejects.toMatchObject({
      code: "blob_store.bucket_not_found",
    });
    const nobodyListens = storeOn({ endpoint: "http://127.0.0.1:9", timeoutMs: 2000 });
    await expect(nobodyListens.get(hash)).rejects.toMatchObject({
      code: "blob_store.unavailable",
    });
  });
});

describe("a file handed in through the REST API", () => {
  let testDatabase: TestDatabase;
  let h: Harness;
  let alice: string;
  let token: string;
  const IN = projectPath("web");
  const JSON_HEADERS = { "content-type": "application/json" };

  const tokenFor = async (on: Harness, cookie: string): Promise<string> => {
    const made = await on.request(REST_ROUTES.tokens, {
      method: "POST",
      headers: { cookie, origin: SIGN_IN_URL, ...JSON_HEADERS },
      body: JSON.stringify({ name: "An agent" }),
    });
    expect(made.status).toBe(201);
    return restTokenCreatedSchema.parse(await made.json()).secret;
  };

  const upload = (on: Harness, bearer: string, runId: string, content: Uint8Array) => {
    const form = new FormData();
    form.set("file", new File([content], "report.md", { type: "text/markdown" }), "report.md");
    return on.request(`${IN}/runs/${runId}/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
      body: form,
    });
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
    h = createHarness(testDatabase, { providers: [createFixtureProvider()], blobs: storeOn() });
    alice = await h.signIn("alice");
    token = await tokenFor(h, alice);
    await h.project(alice, { key: "web", name: "The web app", visibility: "workspace" });
  });

  afterAll(async () => {
    await h?.close();
    await testDatabase?.drop();
  });

  it("is kept in the bucket and read back from it, and is refused with 503 while the bucket refuses", async () => {
    const written = await h.request(`${IN}/tasks`, {
      method: "POST",
      headers: { cookie: alice, origin: SIGN_IN_URL, ...JSON_HEADERS },
      body: JSON.stringify({ title: "Write the report" }),
    });
    const task = restTaskSchema.parse(await written.json());
    const taken = await h.request(`${IN}/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...JSON_HEADERS },
      body: JSON.stringify({ taskId: task.id }),
    });
    const run = restRunSchema.parse(await taken.json());
    const content = new TextEncoder().encode("# The report\n\nKept in the bucket.\n");

    const handed = await upload(h, token, run.id, content);
    expect(handed.status).toBe(201);
    const [artifact] = restRunSchema.parse(await handed.json()).artifacts;
    expect(artifact?.file).toMatchObject({ sha256: sha256(content), size: content.byteLength });
    const inBucket = await storeOn().get(sha256(content));
    expect(inBucket).toEqual(content);

    const read = await h.request(`${IN}/files/${artifact?.id ?? ""}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(content);

    // The same console with keys the bucket refuses: handing in and reading back both fail as
    // the bucket's unavailability, and nothing is written on the run.
    const refused = createHarness(testDatabase, {
      providers: [createFixtureProvider()],
      blobs: storeOn({
        credentials: { accessKeyId: at.credentials.accessKeyId, secretAccessKey: "wrong" },
      }),
    });
    const again = await refused.signIn("alice");
    const bearer = await tokenFor(refused, again);
    const failed = await upload(refused, bearer, run.id, new TextEncoder().encode("another"));
    expect(failed.status).toBe(503);
    expect(failed.headers.get("retry-after")).toBe("30");
    expect(restErrorSchema.parse(await failed.json()).error.code).toBe("file.store_unavailable");
    const unread = await refused.request(`${IN}/files/${artifact?.id ?? ""}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(unread.status).toBe(503);
    const after = await h.request(`${IN}/runs/${run.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(restRunSchema.parse(await after.json()).artifacts).toHaveLength(1);
    await refused.close();
  });
});
