import { DomainError } from "../errors.js";

/**
 * Where the bytes of files handed in are kept, by their content hash (docs/architecture.md,
 * "Data and storage"). One implementation keeps them in PostgreSQL, so that the smallest
 * install has one dependency; the other in a bucket through the S3 API, where the bytes do not
 * belong in rows (ADR-0016). A hash reaches `get` from an artifact row the caller may see,
 * never from input: holding a hash is not permission to read what it names.
 */
export interface BlobStore {
  /**
   * Keeps the bytes and answers their hash and size. Keeping the same bytes twice keeps one
   * copy. On the shelf named, or among the board's files where none is.
   */
  put(bytes: Uint8Array, now: Date, shelf?: BlobShelf): Promise<StoredBlob>;
  /** The bytes kept under the hash, on the shelf named or among the board's files, or nothing. */
  get(sha256: string, shelf?: BlobShelf): Promise<Uint8Array | undefined>;
  /**
   * Takes the bytes under a hash off a shelf, where they are: what a sealed event held
   * (ADR-0086). Nothing of the board's files is ever removed this way.
   */
  remove(sha256: string, shelf: BlobShelf): Promise<void>;
}

/**
 * A part of the store kept apart from the board's files, so that whoever keeps the store moves it
 * alone (ADR-0086): a month of the transcript, as `2026-11`. A table of the month in the store
 * the database keeps, a prefix of the month in a bucket.
 */
export interface BlobShelf {
  readonly transcript: string;
}

const MONTH = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/;

/** Whether `value` is spelled as a month is, `2026-11`: what names a shelf, a table and a prefix. */
export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** The shelf's month, or an error: a month goes into a key and a table's name, and is never input. */
export function monthOfShelf(shelf: BlobShelf): string {
  if (!isMonth(shelf.transcript)) {
    throw new Error("a shelf of the blob store is named by a month");
  }
  return shelf.transcript;
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
