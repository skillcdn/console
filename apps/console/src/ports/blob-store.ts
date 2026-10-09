/**
 * Where the bytes of files handed in are kept, by their content hash (docs/architecture.md,
 * "Data and storage"). The first implementation keeps them in PostgreSQL, so that the smallest
 * install has one dependency; an S3 one takes over where the bytes do not belong in rows. A
 * hash reaches `get` from an artifact row the caller may see, never from input: holding a hash
 * is not permission to read what it names.
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
