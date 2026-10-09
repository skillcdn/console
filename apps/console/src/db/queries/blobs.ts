import { eq } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { blobs } from "../schema.js";

// The bytes of files handed in, under their hash: the PostgreSQL implementation of the blob
// store's port. Nothing refers to a row but the artifacts that name its hash; a row nothing
// refers to stays until a sweep removes it, which arrives with the first thing that deletes
// a run.

/** Keeps the bytes under their hash. The same bytes kept twice are one row. */
export async function putBlob(
  database: Database,
  input: {
    readonly sha256: string;
    readonly bytes: Uint8Array;
    readonly size: number;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database)
    .insert(blobs)
    .values({
      sha256: input.sha256,
      size: input.size,
      bytes: Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength),
      createdAt: input.now,
    })
    .onConflictDoNothing();
}

/** The bytes kept under the hash, or nothing. */
export async function getBlob(database: Database, sha256: string): Promise<Uint8Array | undefined> {
  const [row] = await drizzleOf(database)
    .select({ bytes: blobs.bytes })
    .from(blobs)
    .where(eq(blobs.sha256, sha256))
    .limit(1);
  return row?.bytes;
}
