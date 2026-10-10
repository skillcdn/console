import { documentPathsIn, type LinkSource } from "@skillcdn/console/api";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import {
  decisions,
  documentFiles,
  documentLinks,
  documents,
  documentVersions,
  people,
  projects,
  tasks,
} from "../schema.js";
import { type Actor, recordEvent, type Scope } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The documents of a project (ADR-0009): pages of Markdown under a path, each write a version,
// the links a text makes recorded both ways, archived rather than deleted, with files attached.
// Every change is one transaction with the event that records it, and every read is scoped
// to the project: a page of another is not found.

export interface DocumentSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly path: string;
  readonly title: string;
  /** The number of the latest version, from 1. */
  readonly version: number;
  readonly updatedBy: PersonRecord;
  /** The agent the latest version was written through, or none. */
  readonly agent: string | undefined;
  readonly archivedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A document the document links to: its title when there is a page there yet. */
export interface DocumentLink {
  readonly path: string;
  readonly title: string | undefined;
}

/** What refers to a document, by what people call it. */
export interface Backlink {
  readonly kind: LinkSource;
  readonly id: string;
  readonly path: string | undefined;
  readonly number: number | undefined;
  readonly title: string;
}

export interface DocumentFileRecord {
  readonly id: string;
  readonly label: string | undefined;
  readonly file: {
    readonly name: string;
    readonly size: number;
    readonly contentType: string;
    readonly sha256: string;
  };
  readonly addedBy: PersonRecord;
  readonly agent: string | undefined;
  readonly createdAt: Date;
}

export interface DocumentRecord extends DocumentSummary {
  readonly body: string;
  readonly createdBy: PersonRecord;
  readonly links: readonly DocumentLink[];
  readonly backlinks: readonly Backlink[];
  readonly files: readonly DocumentFileRecord[];
}

export interface VersionSummary {
  readonly number: number;
  readonly title: string;
  readonly author: PersonRecord;
  readonly agent: string | undefined;
  readonly createdAt: Date;
}

export interface VersionRecord extends VersionSummary {
  readonly body: string;
}

/** What is wrong with a document a person asked for. `code` is what the API answers with. */
export class DocumentError extends DomainError {
  constructor(
    code:
      | "document.not_found"
      | "document.version_not_found"
      | "document.conflict"
      | "document.archived"
      | "document.too_many_versions"
      | "document.too_many_files",
  ) {
    super(code, DOCUMENT_ERROR_WORDS[code]);
  }
}

const DOCUMENT_ERROR_WORDS = {
  "document.not_found": "the page was not found",
  "document.version_not_found": "the page has no such version",
  "document.conflict": "the page has moved on since the version the write started from",
  "document.archived": "the page is archived",
  "document.too_many_versions": "the page carries as many versions as one may",
  "document.too_many_files": "the page carries as many files as one may",
} as const;

type Handle = Transaction | ReturnType<typeof drizzleOf>;

/** A drizzle handle, as against the database it is made from. */
const isHandle = (value: Handle | Database): value is Handle => "select" in value;

const writers = alias(people, "writers");
const authors = alias(people, "authors");
const adders = alias(people, "adders");
/** The documents that link to one, as a source; the table itself is the target. */
const sources = alias(documents, "sources");
/** The documents a document links to, as targets. */
const targets = alias(documents, "targets");

const summaryColumns = {
  id: documents.id,
  workspaceId: documents.workspaceId,
  projectId: documents.projectId,
  path: documents.path,
  title: documents.title,
  version: documents.version,
  agent: documents.agent,
  archivedAt: documents.archivedAt,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
  updatedBy: personColumns(writers),
};

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number];

function selectSummaries(handle: Handle) {
  return handle
    .select(summaryColumns)
    .from(documents)
    .innerJoin(writers, eq(writers.id, documents.updatedById));
}

function toSummary(row: SummaryRow): DocumentSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    path: row.path,
    title: row.title,
    version: row.version,
    updatedBy: toPerson(row.updatedBy),
    agent: row.agent ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The condition that keeps archived pages out, unless they are asked for. */
const current = (archived: boolean) => (archived ? undefined : isNull(documents.archivedAt));

/** `%`, `_` and `\` as themselves in a `like` pattern. Paths carry none; words may. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * A folder's pages, by title, and the folders in it, by name: what the paths say, since a
 * folder exists while a page is in it. Archived pages are left out unless asked for.
 */
export async function listDocuments(
  database: Database,
  scope: Scope,
  filter: {
    readonly folder: string;
    readonly archived?: boolean | undefined;
    readonly limit: number;
  },
): Promise<{ readonly folders: string[]; readonly items: DocumentSummary[] }> {
  const prefix = filter.folder === "" ? "" : `${filter.folder}/`;
  const archived = filter.archived === true;
  /** The path after the folder's prefix: the page's name, or a folder and more. */
  const rest = sql`substr(${documents.path}, ${prefix.length + 1})`;
  const inFolder = and(
    eq(documents.projectId, scope.projectId),
    prefix === "" ? undefined : sql`${documents.path} like ${`${prefix}%`}`,
    current(archived),
  );
  const [rows, folderRows] = await Promise.all([
    selectSummaries(drizzleOf(database))
      .where(and(inFolder, sql`strpos(${rest}, '/') = 0`))
      .orderBy(asc(sql`lower(${documents.title})`), asc(documents.path))
      .limit(filter.limit),
    drizzleOf(database)
      // Sorted here: PostgreSQL will not order a distinct select by an expression it cannot
      // match to the select list, which a second parameter in it defeats.
      .selectDistinct({ name: sql<string>`split_part(${rest}, '/', 1)` })
      .from(documents)
      .where(and(inFolder, sql`strpos(${rest}, '/') > 0`))
      .limit(filter.limit),
  ]);
  return {
    folders: folderRows.map((row) => `${prefix}${row.name}`).sort(),
    items: rows.map(toSummary),
  };
}

/**
 * The pages found by words, the best first: the database's own text search over the title
 * and the body, and the title and the path by substring for a word half typed.
 */
export async function searchDocuments(
  database: Database,
  scope: Scope,
  filter: {
    readonly query: string;
    readonly archived?: boolean | undefined;
    readonly limit: number;
  },
): Promise<DocumentSummary[]> {
  const query = sql`websearch_to_tsquery('simple', ${filter.query})`;
  const pattern = `%${escapeLike(filter.query.toLowerCase())}%`;
  const rows = await selectSummaries(drizzleOf(database))
    .where(
      and(
        eq(documents.projectId, scope.projectId),
        current(filter.archived === true),
        sql`(${documents.search} @@ ${query} or lower(${documents.title}) like ${pattern} escape '\\' or ${documents.path} like ${pattern} escape '\\')`,
      ),
    )
    .orderBy(
      desc(sql`ts_rank(${documents.search}, ${query})`),
      asc(sql`lower(${documents.title})`),
      asc(documents.path),
    )
    .limit(filter.limit);
  return rows.map(toSummary);
}

/** The documents a document links to, by path, with the title of the page there when there is one. */
async function linksOf(handle: Handle, scope: Scope, documentId: string): Promise<DocumentLink[]> {
  const rows = await handle
    .select({ path: documentLinks.targetPath, title: targets.title })
    .from(documentLinks)
    .leftJoin(
      targets,
      and(
        eq(targets.projectId, documentLinks.projectId),
        eq(targets.path, documentLinks.targetPath),
      ),
    )
    .where(
      and(
        eq(documentLinks.projectId, scope.projectId),
        eq(documentLinks.sourceKind, "document"),
        eq(documentLinks.sourceId, documentId),
      ),
    )
    .orderBy(asc(documentLinks.targetPath));
  return rows.map((row) => ({ path: row.path, title: row.title ?? undefined }));
}

/** What links to a path: documents, tasks and decisions of the project, each by what people call it. */
async function backlinksOf(handle: Handle, scope: Scope, path: string): Promise<Backlink[]> {
  const rows = await handle
    .select({
      kind: documentLinks.sourceKind,
      id: documentLinks.sourceId,
      documentPath: sources.path,
      documentTitle: sources.title,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      question: decisions.question,
    })
    .from(documentLinks)
    .leftJoin(
      sources,
      and(eq(documentLinks.sourceKind, "document"), eq(sources.id, documentLinks.sourceId)),
    )
    .leftJoin(
      tasks,
      and(eq(documentLinks.sourceKind, "task"), eq(tasks.id, documentLinks.sourceId)),
    )
    .leftJoin(
      decisions,
      and(eq(documentLinks.sourceKind, "decision"), eq(decisions.id, documentLinks.sourceId)),
    )
    .where(and(eq(documentLinks.projectId, scope.projectId), eq(documentLinks.targetPath, path)))
    .orderBy(asc(documentLinks.sourceKind), asc(documentLinks.createdAt));
  const backlinks: Backlink[] = [];
  for (const row of rows) {
    if (row.kind === "document" && row.documentPath !== null && row.documentTitle !== null) {
      backlinks.push({
        kind: "document",
        id: row.id,
        path: row.documentPath,
        number: undefined,
        title: row.documentTitle,
      });
    } else if (row.kind === "task" && row.taskNumber !== null && row.taskTitle !== null) {
      backlinks.push({
        kind: "task",
        id: row.id,
        path: undefined,
        number: row.taskNumber,
        title: row.taskTitle,
      });
    } else if (row.kind === "decision" && row.question !== null) {
      backlinks.push({
        kind: "decision",
        id: row.id,
        path: undefined,
        number: undefined,
        title: row.question,
      });
    }
  }
  return backlinks;
}

async function filesOf(handle: Handle, documentId: string): Promise<DocumentFileRecord[]> {
  const rows = await handle
    .select({
      id: documentFiles.id,
      label: documentFiles.label,
      fileName: documentFiles.fileName,
      fileSize: documentFiles.fileSize,
      contentType: documentFiles.contentType,
      sha256: documentFiles.sha256,
      agent: documentFiles.agent,
      createdAt: documentFiles.createdAt,
      addedBy: personColumns(adders),
    })
    .from(documentFiles)
    .innerJoin(adders, eq(adders.id, documentFiles.addedById))
    .where(eq(documentFiles.documentId, documentId))
    .orderBy(asc(documentFiles.createdAt), asc(documentFiles.id));
  return rows.map((row) => ({
    id: row.id,
    label: row.label ?? undefined,
    file: {
      name: row.fileName,
      size: row.fileSize,
      contentType: row.contentType,
      sha256: row.sha256,
    },
    addedBy: toPerson(row.addedBy),
    agent: row.agent ?? undefined,
    createdAt: row.createdAt,
  }));
}

async function readDocument(
  handle: Handle,
  scope: Scope,
  path: string,
): Promise<DocumentRecord | undefined> {
  const [row] = await handle
    .select({
      ...summaryColumns,
      body: documents.body,
      createdBy: personColumns(authors),
    })
    .from(documents)
    .innerJoin(writers, eq(writers.id, documents.updatedById))
    .innerJoin(authors, eq(authors.id, documents.createdById))
    .where(and(eq(documents.projectId, scope.projectId), eq(documents.path, path)))
    .limit(1);
  if (row === undefined) {
    return undefined;
  }
  const [links, backlinks, files] = await Promise.all([
    linksOf(handle, scope, row.id),
    backlinksOf(handle, scope, path),
    filesOf(handle, row.id),
  ]);
  return {
    ...toSummary(row),
    body: row.body,
    createdBy: toPerson(row.createdBy),
    links,
    backlinks,
    files,
  };
}

/** One document by its path, with what it links to, what refers to it, and its files. */
export function getDocument(
  database: Database,
  scope: Scope,
  path: string,
): Promise<DocumentRecord | undefined> {
  return readDocument(drizzleOf(database), scope, path);
}

/**
 * Records the documents a text links to, in place of what the same source linked to before:
 * the links are kept both ways, so that a page says what refers to it. For a document, a task
 * or a decision of the project, with every text of its that may carry a link.
 */
export async function recordLinks(
  tx: Transaction,
  scope: Scope,
  source: { readonly kind: LinkSource; readonly id: string },
  texts: readonly string[],
  now: Date,
): Promise<string[]> {
  const paths = [...new Set(texts.flatMap((text) => documentPathsIn(text)))].sort();
  await tx
    .delete(documentLinks)
    .where(
      and(
        eq(documentLinks.projectId, scope.projectId),
        eq(documentLinks.sourceKind, source.kind),
        eq(documentLinks.sourceId, source.id),
      ),
    );
  if (paths.length > 0) {
    await tx.insert(documentLinks).values(
      paths.map((targetPath) => ({
        projectId: scope.projectId,
        sourceKind: source.kind,
        sourceId: source.id,
        targetPath,
        createdAt: now,
      })),
    );
  }
  return paths;
}

/**
 * Writes a page: the first version at a new path, or the next version of the page there, and
 * tells the board. A write that changes nothing is no version and no event. With a base
 * version, the write is refused when the page has moved on since; an archived page is not
 * written to; and a page carries only so many versions.
 */
export async function writeDocument(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly path: string;
    readonly title: string;
    readonly body: string;
    readonly baseVersion?: number | undefined;
    readonly maxVersions: number;
    readonly now: Date;
  },
): Promise<{ readonly document: DocumentRecord; readonly created: boolean }> {
  const { scope, actor, path, title, body, baseVersion, maxVersions, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        body: documents.body,
        version: documents.version,
        archivedAt: documents.archivedAt,
      })
      .from(documents)
      .where(and(eq(documents.projectId, scope.projectId), eq(documents.path, path)))
      .for("update");
    let documentId: string;
    let version: number;
    if (existing === undefined) {
      if (baseVersion !== undefined) {
        throw new DocumentError("document.conflict");
      }
      // Two first writes at one path at once: the second waits on the project's row, then finds the first.
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, scope.projectId))
        .for("update");
      const [again] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.projectId, scope.projectId), eq(documents.path, path)))
        .limit(1);
      if (again !== undefined) {
        throw new DocumentError("document.conflict");
      }
      const [inserted] = await tx
        .insert(documents)
        .values({
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          path,
          title,
          body,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
          agent: actor.agent ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: documents.id });
      if (inserted === undefined) {
        throw new Error("document insert returned no row");
      }
      documentId = inserted.id;
      version = 1;
    } else {
      if (existing.archivedAt !== null) {
        throw new DocumentError("document.archived");
      }
      if (baseVersion !== undefined && baseVersion !== existing.version) {
        throw new DocumentError("document.conflict");
      }
      if (existing.title === title && existing.body === body) {
        const unchanged = await readDocument(tx, scope, path);
        if (unchanged === undefined) {
          throw new DocumentError("document.not_found");
        }
        return { document: unchanged, created: false };
      }
      if (existing.version >= maxVersions) {
        throw new DocumentError("document.too_many_versions");
      }
      documentId = existing.id;
      version = existing.version + 1;
      await tx
        .update(documents)
        .set({
          title,
          body,
          version,
          updatedById: actor.id,
          agent: actor.agent ?? null,
          updatedAt: now,
        })
        .where(eq(documents.id, documentId));
    }
    await tx.insert(documentVersions).values({
      documentId,
      number: version,
      title,
      body,
      authorId: actor.id,
      agent: actor.agent ?? null,
      createdAt: now,
    });
    await recordLinks(tx, scope, { kind: "document", id: documentId }, [body], now);
    await recordEvent(tx, {
      ...scope,
      kind: "document.written",
      actor,
      documentId,
      data: { path, title, version },
      now,
    });
    const written = await readDocument(tx, scope, path);
    if (written === undefined) {
      throw new DocumentError("document.not_found");
    }
    return { document: written, created: existing === undefined };
  });
}

/**
 * Puts a page away, or brings it back, and tells the board. Archived, a page is out of the
 * folders and the search, still readable, and not written to. What is already so is no event.
 */
export async function setArchived(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly path: string;
    readonly archived: boolean;
    readonly now: Date;
  },
): Promise<DocumentRecord> {
  const { scope, actor, path, archived, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: documents.id, title: documents.title, archivedAt: documents.archivedAt })
      .from(documents)
      .where(and(eq(documents.projectId, scope.projectId), eq(documents.path, path)))
      .for("update");
    if (existing === undefined) {
      throw new DocumentError("document.not_found");
    }
    if ((existing.archivedAt !== null) !== archived) {
      await tx
        .update(documents)
        .set({ archivedAt: archived ? now : null, updatedAt: now })
        .where(eq(documents.id, existing.id));
      await recordEvent(tx, {
        ...scope,
        kind: archived ? "document.archived" : "document.restored",
        actor,
        documentId: existing.id,
        data: { path, title: existing.title },
        now,
      });
    }
    const written = await readDocument(tx, scope, path);
    if (written === undefined) {
      throw new DocumentError("document.not_found");
    }
    return written;
  });
}

const versionColumns = {
  number: documentVersions.number,
  title: documentVersions.title,
  agent: documentVersions.agent,
  createdAt: documentVersions.createdAt,
  author: personColumns(authors),
};

/** The id of the page at a path, or nothing. */
export async function findDocumentId(
  handle: Handle | Database,
  scope: Scope,
  path: string,
): Promise<string | undefined> {
  if (!isHandle(handle)) {
    return findDocumentId(drizzleOf(handle), scope, path);
  }
  const [row] = await handle
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.projectId, scope.projectId), eq(documents.path, path)))
    .limit(1);
  return row?.id;
}

/** The versions of a page, newest first: who wrote each, through which agent, and when. */
export async function listVersions(
  database: Database,
  scope: Scope,
  path: string,
  limit: number,
): Promise<VersionSummary[] | undefined> {
  const handle = drizzleOf(database);
  const documentId = await findDocumentId(handle, scope, path);
  if (documentId === undefined) {
    return undefined;
  }
  const rows = await handle
    .select(versionColumns)
    .from(documentVersions)
    .innerJoin(authors, eq(authors.id, documentVersions.authorId))
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.number))
    .limit(limit);
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    author: toPerson(row.author),
    agent: row.agent ?? undefined,
    createdAt: row.createdAt,
  }));
}

/** One version of a page, with its body as it was; nothing when the page or the version is not there. */
export async function getVersion(
  database: Database,
  scope: Scope,
  path: string,
  number: number,
): Promise<VersionRecord | undefined> {
  const handle = drizzleOf(database);
  const documentId = await findDocumentId(handle, scope, path);
  if (documentId === undefined) {
    return undefined;
  }
  const [row] = await handle
    .select({ ...versionColumns, body: documentVersions.body })
    .from(documentVersions)
    .innerJoin(authors, eq(authors.id, documentVersions.authorId))
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.number, number)))
    .limit(1);
  return row === undefined
    ? undefined
    : {
        number: row.number,
        title: row.title,
        body: row.body,
        author: toPerson(row.author),
        agent: row.agent ?? undefined,
        createdAt: row.createdAt,
      };
}

/**
 * Attaches a file whose bytes the blob store keeps already, and tells the board. Only so many
 * files on one page, and none on an archived one.
 */
export async function attachFile(
  database: Database,
  input: {
    readonly scope: Scope;
    readonly actor: Actor;
    readonly path: string;
    readonly file: {
      readonly name: string;
      readonly size: number;
      readonly contentType: string;
      readonly sha256: string;
    };
    readonly label: string | undefined;
    readonly limit: number;
    readonly now: Date;
  },
): Promise<DocumentRecord> {
  const { scope, actor, path, file, label, limit, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: documents.id, title: documents.title, archivedAt: documents.archivedAt })
      .from(documents)
      .where(and(eq(documents.projectId, scope.projectId), eq(documents.path, path)))
      .for("update");
    if (existing === undefined) {
      throw new DocumentError("document.not_found");
    }
    if (existing.archivedAt !== null) {
      throw new DocumentError("document.archived");
    }
    const [counted] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(documentFiles)
      .where(eq(documentFiles.documentId, existing.id));
    if ((counted?.count ?? 0) >= limit) {
      throw new DocumentError("document.too_many_files");
    }
    await tx.insert(documentFiles).values({
      documentId: existing.id,
      label: label ?? null,
      fileName: file.name,
      fileSize: file.size,
      contentType: file.contentType,
      sha256: file.sha256,
      addedById: actor.id,
      agent: actor.agent ?? null,
      createdAt: now,
    });
    await tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, existing.id));
    await recordEvent(tx, {
      ...scope,
      kind: "document.file_attached",
      actor,
      documentId: existing.id,
      data: { path, title: existing.title, label: label ?? file.name },
      now,
    });
    const written = await readDocument(tx, scope, path);
    if (written === undefined) {
      throw new DocumentError("document.not_found");
    }
    return written;
  });
}

/** A file attached to the page at a path, by its id, within the project; or nothing. */
export async function findDocumentFile(
  database: Database,
  scope: Scope,
  path: string,
  fileId: string,
): Promise<DocumentFileRecord | undefined> {
  const handle = drizzleOf(database);
  const documentId = await findDocumentId(handle, scope, path);
  if (documentId === undefined) {
    return undefined;
  }
  const files = await filesOf(handle, documentId);
  return files.find((file) => file.id === fileId);
}
