import { and, asc, count, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { commentFiles, comments, people, tasks } from "../schema.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";
import { excerptOf, type FileRecord } from "./runs.js";
import { TaskError } from "./tasks.js";

// The discussion on a task (ADR-0024): comments by people and by their agents, each with the
// files put in it, whose bytes the blob store keeps under their hash. A comment is written
// whole, with its files, in one transaction with the event that tells the board; it is never
// rewritten. Every read is scoped to the project: a comment of another is not found.

/** A file put in a comment: the bytes are in the blob store under the hash. */
export interface CommentFileRecord {
  readonly id: string;
  readonly file: FileRecord;
}

export interface CommentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly author: PersonRecord;
  /** The agent the author wrote through, when they did. */
  readonly agent: string | undefined;
  readonly body: string;
  readonly files: readonly CommentFileRecord[];
  readonly createdAt: Date;
}

/** What is wrong with a comment asked for. `code` is what the API answers with. */
export class CommentError extends DomainError {
  constructor(code: "comment.too_many" | "comment.too_many_files" | "comment.empty") {
    super(code, COMMENT_ERROR_WORDS[code]);
  }
}

const COMMENT_ERROR_WORDS = {
  "comment.too_many": "the task carries as many comments as one may",
  "comment.too_many_files": "the comment carries more files than one may",
  "comment.empty": "the comment says nothing and carries no file",
} as const;

type Handle = Transaction | ReturnType<typeof drizzleOf>;

const authors = alias(people, "authors");

/**
 * Writes a comment on a task, with its files, whose bytes the blob store keeps already; tells
 * the board. The task is locked while the comments are counted, so that two written at once
 * do not take it past the limit together.
 */
export async function writeComment(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly taskId: string;
    readonly body: string;
    readonly files: readonly FileRecord[];
    readonly limit: number;
    readonly fileLimit: number;
    readonly now: Date;
  },
): Promise<CommentRecord> {
  const { scope, actor, taskId, body, files, limit, fileLimit, now } = input;
  if (body.trim().length === 0 && files.length === 0) {
    throw new CommentError("comment.empty");
  }
  if (files.length > fileLimit) {
    throw new CommentError("comment.too_many_files");
  }
  return drizzleOf(database).transaction(async (tx) => {
    const [task] = await tx
      .select({ id: tasks.id, number: tasks.number, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.projectId, scope.projectId), eq(tasks.id, taskId)))
      .for("update");
    if (task === undefined) {
      throw new TaskError("task.not_found");
    }
    const [held] = await tx
      .select({ count: count() })
      .from(comments)
      .where(eq(comments.taskId, taskId));
    if ((held?.count ?? 0) >= limit) {
      throw new CommentError("comment.too_many");
    }
    const [written] = await tx
      .insert(comments)
      .values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        taskId,
        authorId: actor.id,
        agent: actor.agent ?? null,
        body,
        createdAt: now,
      })
      .returning({ id: comments.id });
    if (written === undefined) {
      throw new Error("comment insert returned no row");
    }
    if (files.length > 0) {
      await tx.insert(commentFiles).values(
        files.map((file) => ({
          commentId: written.id,
          fileName: file.name,
          fileSize: file.size,
          contentType: file.contentType,
          sha256: file.sha256,
          createdAt: now,
        })),
      );
    }
    await recordEvent(tx, {
      ...scope,
      kind: "task.commented",
      actor,
      taskId,
      data: {
        number: task.number,
        title: task.title,
        excerpt: excerptOf(body),
        files: files.length,
      },
      now,
    });
    const [record] = await readComments(tx, scope, { commentId: written.id });
    if (record === undefined) {
      throw new Error("the comment written was not read back");
    }
    return record;
  });
}

/** The discussion on a task, oldest first, whole. */
export function listComments(
  database: Database,
  scope: Scope,
  taskId: string,
): Promise<CommentRecord[]> {
  return readComments(drizzleOf(database), scope, { taskId });
}

/** A file put in a comment of the project, by the file's id. */
export async function findCommentFile(
  database: Database,
  scope: Scope,
  fileId: string,
): Promise<CommentFileRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select({
      id: commentFiles.id,
      fileName: commentFiles.fileName,
      fileSize: commentFiles.fileSize,
      contentType: commentFiles.contentType,
      sha256: commentFiles.sha256,
    })
    .from(commentFiles)
    .innerJoin(comments, eq(comments.id, commentFiles.commentId))
    .where(and(eq(comments.projectId, scope.projectId), eq(commentFiles.id, fileId)))
    .limit(1);
  return row === undefined ? undefined : toCommentFile(row);
}

async function readComments(
  handle: Handle,
  scope: Scope,
  by: { readonly taskId: string } | { readonly commentId: string },
): Promise<CommentRecord[]> {
  const rows = await handle
    .select({
      id: comments.id,
      projectId: comments.projectId,
      taskId: comments.taskId,
      agent: comments.agent,
      body: comments.body,
      createdAt: comments.createdAt,
      author: personColumns(authors),
    })
    .from(comments)
    .innerJoin(authors, eq(authors.id, comments.authorId))
    .where(
      and(
        eq(comments.projectId, scope.projectId),
        "taskId" in by ? eq(comments.taskId, by.taskId) : eq(comments.id, by.commentId),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id));
  if (rows.length === 0) {
    return [];
  }
  const files = await handle
    .select({
      id: commentFiles.id,
      commentId: commentFiles.commentId,
      fileName: commentFiles.fileName,
      fileSize: commentFiles.fileSize,
      contentType: commentFiles.contentType,
      sha256: commentFiles.sha256,
    })
    .from(commentFiles)
    .where(
      inArray(
        commentFiles.commentId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(commentFiles.createdAt), asc(commentFiles.id));
  const filesOf = new Map<string, CommentFileRecord[]>();
  for (const file of files) {
    const held = filesOf.get(file.commentId) ?? [];
    held.push(toCommentFile(file));
    filesOf.set(file.commentId, held);
  }
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    author: toPerson(row.author),
    agent: row.agent ?? undefined,
    body: row.body,
    files: filesOf.get(row.id) ?? [],
    createdAt: row.createdAt,
  }));
}

function toCommentFile(row: {
  readonly id: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly contentType: string;
  readonly sha256: string;
}): CommentFileRecord {
  return {
    id: row.id,
    file: {
      name: row.fileName,
      size: row.fileSize,
      contentType: row.contentType,
      sha256: row.sha256,
    },
  };
}
