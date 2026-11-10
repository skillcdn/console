import { createHash } from "node:crypto";
import type { Database } from "../db/client.js";
import {
  getBlob,
  getTranscriptBlob,
  putBlob,
  putTranscriptBlob,
  removeTranscriptBlob,
} from "../db/queries/blobs.js";
import { type BlobStore, monthOfShelf } from "../ports/blob-store.js";

/**
 * The blob store in PostgreSQL: the bytes in a row under their hash, next to everything else,
 * so that the smallest install needs nothing but the database. Where the bytes outgrow rows,
 * the bucket takes over (s3-blob-store.ts, ADR-0016) and reads from here what was kept before.
 * A shelf is a table of its month in the transcript's own schema (ADR-0086).
 */
export function createPgBlobStore(database: Database): BlobStore {
  return {
    async put(bytes, now, shelf) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const kept = { sha256, bytes, size: bytes.byteLength, now };
      if (shelf === undefined) {
        await putBlob(database, kept);
      } else {
        await putTranscriptBlob(database, { ...kept, month: monthOfShelf(shelf) });
      }
      return { sha256, size: bytes.byteLength };
    },
    get(sha256, shelf) {
      return shelf === undefined
        ? getBlob(database, sha256)
        : getTranscriptBlob(database, monthOfShelf(shelf), sha256);
    },
    remove(sha256, shelf) {
      return removeTranscriptBlob(database, monthOfShelf(shelf), sha256);
    },
  };
}
