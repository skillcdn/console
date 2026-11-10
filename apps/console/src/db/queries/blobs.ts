import { and, eq } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { blobs, transcriptBlobs } from "../schema.js";

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

// The bytes of a month of the transcript (ADR-0086), in a table of the month, apart from the
// board's files: the long texts and the pictures of the sessions that began in it.

/** Keeps the bytes under their hash in the month. The same bytes kept twice are one row. */
export async function putTranscriptBlob(
  database: Database,
  input: {
    readonly month: string;
    readonly sha256: string;
    readonly bytes: Uint8Array;
    readonly size: number;
    readonly now: Date;
  },
): Promise<void> {
  await drizzleOf(database)
    .insert(transcriptBlobs)
    .values({
      month: input.month,
      sha256: input.sha256,
      size: input.size,
      bytes: Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength),
      createdAt: input.now,
    })
    .onConflictDoNothing();
}

/** The bytes kept under the hash in the month, or nothing. */
export async function getTranscriptBlob(
  database: Database,
  month: string,
  sha256: string,
): Promise<Uint8Array | undefined> {
  const [row] = await drizzleOf(database)
    .select({ bytes: transcriptBlobs.bytes })
    .from(transcriptBlobs)
    .where(and(eq(transcriptBlobs.month, month), eq(transcriptBlobs.sha256, sha256)))
    .limit(1);
  return row?.bytes;
}

/** Takes the bytes under the hash out of the month. */
export async function removeTranscriptBlob(
  database: Database,
  month: string,
  sha256: string,
): Promise<void> {
  await drizzleOf(database)
    .delete(transcriptBlobs)
    .where(and(eq(transcriptBlobs.month, month), eq(transcriptBlobs.sha256, sha256)));
}
