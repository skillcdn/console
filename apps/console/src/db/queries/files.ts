import { and, eq, sum } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { artifacts, commentFiles, comments, documentFiles, documents, runs } from "../schema.js";
import type { Scope } from "./events.js";

// The files of a project, wherever they are kept: handed in by a run, put in a comment, or
// attached to a page. Each row names its bytes by their hash and its size; the bytes themselves
// are the blob store's. What is counted here is what the project holds, those put away included,
// since nothing is deleted.

/**
 * How many bytes the files of the project hold together, each file counted by its own size, the
 * same bytes in two files counted twice: what a bound on a project's files is held to, asked
 * before a file's bytes are kept.
 */
export async function fileBytesOf(database: Database, scope: Scope): Promise<number> {
  const db = drizzleOf(database);
  const [handedIn] = await db
    .select({ bytes: sum(artifacts.fileSize) })
    .from(artifacts)
    .innerJoin(runs, eq(runs.id, artifacts.runId))
    .where(
      and(
        eq(runs.workspaceId, scope.workspaceId),
        eq(runs.projectId, scope.projectId),
        eq(artifacts.kind, "file"),
      ),
    );
  const [inComments] = await db
    .select({ bytes: sum(commentFiles.fileSize) })
    .from(commentFiles)
    .innerJoin(comments, eq(comments.id, commentFiles.commentId))
    .where(
      and(eq(comments.workspaceId, scope.workspaceId), eq(comments.projectId, scope.projectId)),
    );
  const [onPages] = await db
    .select({ bytes: sum(documentFiles.fileSize) })
    .from(documentFiles)
    .innerJoin(documents, eq(documents.id, documentFiles.documentId))
    .where(
      and(eq(documents.workspaceId, scope.workspaceId), eq(documents.projectId, scope.projectId)),
    );
  return bytesOf(handedIn?.bytes) + bytesOf(inComments?.bytes) + bytesOf(onPages?.bytes);
}

/** A sum as the database answers it, a string of digits or nothing, as a number. */
function bytesOf(sum: string | null | undefined): number {
  return sum === null || sum === undefined ? 0 : Number(sum);
}
