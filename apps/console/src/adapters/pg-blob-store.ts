import { createHash } from "node:crypto";
import type { Database } from "../db/client.js";
import { getBlob, putBlob } from "../db/queries/blobs.js";
import type { BlobStore } from "../ports/blob-store.js";

/**
 * The blob store in PostgreSQL: the bytes in a row under their hash, next to everything else,
 * so that the smallest install needs nothing but the database. Where the bytes outgrow rows,
 * the S3 implementation of the port takes over (docs/roadmap.md, milestone 7).
 */
export function createPgBlobStore(database: Database): BlobStore {
  return {
    async put(bytes, now) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await putBlob(database, { sha256, bytes, size: bytes.byteLength, now });
      return { sha256, size: bytes.byteLength };
    },
    get(sha256) {
      return getBlob(database, sha256);
    },
  };
}
