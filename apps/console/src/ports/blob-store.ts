import { DomainError } from "../errors.js";

/**
 * Where the bytes of files handed in are kept, by their content hash (docs/architecture.md,
 * "Data and storage"). One implementation keeps them in PostgreSQL, so that the smallest
 * install has one dependency; the other in a bucket through the S3 API, where the bytes do not
 * belong in rows (ADR-0016). A hash reaches `get` from an artifact row the caller may see,
 * never from input: holding a hash is not permission to read what it names.
 */
export interface BlobStore {
  /** Keeps the bytes and answers their hash and size. Keeping the same bytes twice keeps one copy. */
  put(bytes: Uint8Array, now: Date): Promise<StoredBlob>;
  /** The bytes kept under the hash, or nothing. */
  get(sha256: string): Promise<Uint8Array | undefined>;
}

export interface StoredBlob {
  /** The SHA-256 of the bytes, in hex. */
  readonly sha256: string;
  readonly size: number;
}

/**
 * What went wrong with a store that is somewhere else: it could not be reached or answered an
 * error (`unavailable`), it refused the credentials (`forbidden`), the bucket is not there
 * (`bucket_not_found`) or is served from elsewhere (`misplaced`), or the bytes it holds under a
 * hash are not the bytes of that hash (`corrupt`). The store in the database throws none of
 * these: a database that is away fails the request as any query does.
 */
export type BlobStoreErrorKind =
  | "unavailable"
  | "forbidden"
  | "bucket_not_found"
  | "misplaced"
  | "corrupt";

export class BlobStoreError extends DomainError {
  readonly kind: BlobStoreErrorKind;

  constructor(kind: BlobStoreErrorKind, message: string, options?: { readonly cause?: unknown }) {
    super(`blob_store.${kind}`, message, options);
    this.kind = kind;
  }
}
