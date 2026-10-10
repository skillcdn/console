import {
  ARTIFACT_KINDS,
  LINK_SOURCES,
  PERSON_ROLES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  type RestDecisionOption,
  type RestEventData,
  type RestTaskLink,
  RUN_STATUSES,
  TASK_PRIORITIES,
  TASK_STATES,
} from "@skillcdn/console/api";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// One file on purpose: drizzle-kit reads it directly. The data model is documented in the
// workspace's README.md; the vocabulary the constraints are made of is the package's.

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const instant = () => timestamp({ withTimezone: true, mode: "date" });
const createdAt = () => instant().notNull().defaultNow();
const updatedAt = () => instant().notNull().defaultNow();
/** Bytes as they are: the driver hands a `Buffer` in and out. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
/** The database's own text-search vector, which it fills in itself from the columns it is made of. */
const tsvector = customType<{ data: string; driverData: string }>({ dataType: () => "tsvector" });

/** `'a', 'b'`: a list of constants for a check constraint. They are the package's, never input. */
const literals = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

/**
 * An organization's board. A deployment holds one, found by its key, until a need for several
 * appears (docs/architecture.md, open question 5); every row that belongs to a board names it.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    key: text().notNull(),
    name: text().notNull(),
    /**
     * Tasks were numbered per workspace until projects came (ADR-0008); the number is the
     * project's now. The column stays until the next release, as the rollout contract asks
     * (expand, then contract), and is dropped then.
     */
    nextTaskNumber: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("workspaces_key_key").on(table.key)],
);

/** Someone who signed in through an identity provider and is a member of the workspace. */
export const people = pgTable(
  "people",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    /** The identity provider (`gh`, `google`), and its immutable id of the account: what a person is known by. */
    host: text().notNull(),
    hostAccountId: text().notNull(),
    /** As the provider spells it now (a login, an address); a renamed account stays the same person. */
    login: text().notNull(),
    name: text(),
    /** The account's picture as the host serves it, an https URL. */
    avatarUrl: text(),
    /** An administrator configures the board, a member works on it: the console's own record. */
    role: text({ enum: PERSON_ROLES }).notNull().default("member"),
    /** The language the person chose for the pages (ADR-0012), a tag; null for the browser's. */
    language: text(),
    lastLoginAt: instant().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("people_host_account_key").on(table.workspaceId, table.host, table.hostAccountId),
    check("people_role_check", sql`${table.role} in (${sql.raw(literals(PERSON_ROLES))})`),
  ],
);

/**
 * A browser a person is signed in on: the SHA-256 of the cookie's token, never the token. The
 * end moves while the session is used.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    tokenHash: text().notNull(),
    expiresAt: instant().notNull(),
    lastSeenAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_person_idx").on(table.personId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

/**
 * A token a person made for an agent, a script or a console of their own: the SHA-256 of the
 * secret, never the secret. It is its person for the board's purposes until it expires or is
 * taken away, which is its row going.
 */
export const tokens = pgTable(
  "tokens",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** What the person calls it: the agent it is for, where it runs. */
    name: text().notNull(),
    tokenHash: text().notNull(),
    /** When it stops being good; null for one that does not expire. */
    expiresAt: instant(),
    /** When it was last presented; null until it is. */
    lastUsedAt: instant(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("tokens_token_hash_key").on(table.tokenHash),
    index("tokens_person_idx").on(table.personId),
    index("tokens_expires_idx").on(table.expiresAt),
  ],
);

/**
 * The unit of work and of permission (ADR-0008): a project holds its board, names its skills,
 * and lists its people with a role each. Its key is what paths and the command say, and does
 * not change.
 */
export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    /** Who is a member: every member of the workspace, or only those listed. */
    visibility: text({ enum: PROJECT_VISIBILITIES }).notNull().default("private"),
    /** The address of the project's skills at the SkillCDN deployment, canonical; null for the organization's. */
    skillsAddress: text(),
    /** The number the next task gets: tasks are numbered per project, for people to say. */
    nextTaskNumber: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("projects_key_key").on(table.workspaceId, table.key),
    check(
      "projects_visibility_check",
      sql`${table.visibility} in (${sql.raw(literals(PROJECT_VISIBILITIES))})`,
    ),
  ],
);

/** A person listed in a project, with what they are in it. Rows go with their project or their person. */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** An owner configures the project, a member works on it. */
    role: text({ enum: PROJECT_ROLES }).notNull().default("member"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: "project_members_pkey", columns: [table.projectId, table.personId] }),
    index("project_members_person_idx").on(table.personId),
    check(
      "project_members_role_check",
      sql`${table.role} in (${sql.raw(literals(PROJECT_ROLES))})`,
    ),
  ],
);

/** A unit of work on the board of a project. */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    number: integer().notNull(),
    title: text().notNull(),
    /** Markdown, bounded at the edge; shown as text, never as HTML. */
    body: text().notNull().default(""),
    state: text({ enum: TASK_STATES }).notNull().default("idea"),
    priority: text({ enum: TASK_PRIORITIES }).notNull().default("normal"),
    /** The person the task is on, which is who wrote it unless it is handed over. */
    ownerId: uuid()
      .notNull()
      .references(() => people.id),
    /** The person at work on it, or nobody. An agent acting for a person arrives later. */
    assigneeId: uuid().references(() => people.id),
    /** The task this one is part of, for a breakdown. */
    parentId: uuid().references((): AnyPgColumn => tasks.id),
    /** Repositories, pull requests, documents: `https` URLs with a label, as the API checked them. */
    links: jsonb().$type<RestTaskLink[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("tasks_project_number_key").on(table.projectId, table.number),
    index("tasks_project_state_idx").on(table.projectId, table.state),
    index("tasks_parent_idx").on(table.parentId),
    check("tasks_state_check", sql`${table.state} in (${sql.raw(literals(TASK_STATES))})`),
    check(
      "tasks_priority_check",
      sql`${table.priority} in (${sql.raw(literals(TASK_PRIORITIES))})`,
    ),
  ],
);

/**
 * One agent at work on one task for one person: begun when the agent takes the task, grown by
 * what it reports and hands in, waiting while a decision it raised waits, and over when the
 * agent says so or a person gives up on it.
 */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id),
    /** The person the agent acts for. */
    personId: uuid()
      .notNull()
      .references(() => people.id),
    /** The token the agent presented, while it exists: which of the person's agents. */
    tokenId: uuid().references(() => tokens.id, { onDelete: "set null" }),
    /** What the agent calls itself. */
    agent: text().notNull(),
    status: text({ enum: RUN_STATUSES }).notNull().default("running"),
    /** What the agent said when the run ended: Markdown. */
    summary: text(),
    startedAt: instant().notNull(),
    endedAt: instant(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("runs_task_idx").on(table.taskId),
    index("runs_project_status_idx").on(table.projectId, table.status),
    check("runs_status_check", sql`${table.status} in (${sql.raw(literals(RUN_STATUSES))})`),
  ],
);

/** What an agent reported while at work: Markdown, bounded at the edge. */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("reports_run_idx").on(table.runId)],
);

/**
 * What a run handed in: a link, as the API checked it, or a file the console keeps, whose bytes
 * are in the blob store under their hash. A link has its `url`; a file has its name, its size,
 * its media type and its hash, and nothing else.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: text({ enum: ARTIFACT_KINDS }).notNull().default("link"),
    url: text(),
    label: text(),
    fileName: text(),
    fileSize: integer(),
    contentType: text(),
    sha256: text(),
    createdAt: createdAt(),
  },
  (table) => [
    index("artifacts_run_idx").on(table.runId),
    check("artifacts_kind_check", sql`${table.kind} in (${sql.raw(literals(ARTIFACT_KINDS))})`),
    check(
      "artifacts_shape_check",
      sql`(${table.kind} = 'link' and ${table.url} is not null) or (${table.kind} = 'file' and ${table.fileName} is not null and ${table.fileSize} is not null and ${table.contentType} is not null and ${table.sha256} is not null)`,
    ),
  ],
);

/**
 * The bytes of files handed in, under their SHA-256: the PostgreSQL implementation of the
 * blob-store port, for the smallest install. The artifacts that name a hash are what refers to
 * a row; the table is not the model, and the S3 implementation does without it.
 */
export const blobs = pgTable("blobs", {
  sha256: text().primaryKey(),
  size: integer().notNull(),
  bytes: bytea().notNull(),
  createdAt: createdAt(),
});

/**
 * A question that needs a person: the options, who raised it, and the answer with who gave it
 * and when. A decision without an answer waits; the index finds those.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    /** The task the decision is about, when it is about one. */
    taskId: uuid().references(() => tasks.id),
    /** The run that raised it, when an agent asked; the run waits until the answer. */
    runId: uuid().references(() => runs.id),
    question: text().notNull(),
    /** Markdown: what a person needs to know to answer. */
    body: text().notNull().default(""),
    /** Each with an id an answer names and the label a person reads, as the API checked them. */
    options: jsonb().$type<RestDecisionOption[]>().notNull(),
    raisedById: uuid()
      .notNull()
      .references(() => people.id),
    answeredById: uuid().references(() => people.id),
    /** The id of the chosen option. */
    answer: text(),
    /** The rationale given with the answer: Markdown. */
    answerNote: text(),
    answeredAt: instant(),
    /** What followed the decision, written afterwards: Markdown; null until someone writes it (ADR-0009). */
    outcome: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("decisions_project_open_idx").on(table.projectId, table.answeredAt),
    index("decisions_task_idx").on(table.taskId),
    index("decisions_run_idx").on(table.runId),
  ],
);

/**
 * A page of Markdown in a project (ADR-0009), under a path that is its address and does not
 * change. The row is the latest version, kept here so that a folder and a search read one
 * table; every version is in `document_versions`. Archived rather than deleted.
 */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    /** Segments of lowercase letters, digits and hyphens, separated by slashes, as the package checks them. */
    path: text().notNull(),
    title: text().notNull(),
    /** Markdown, bounded at the edge; shown as text or rendered to elements, never as HTML. */
    body: text().notNull().default(""),
    /** The number of the latest version, from 1. */
    version: integer().notNull().default(1),
    createdById: uuid()
      .notNull()
      .references(() => people.id),
    /** Who wrote the latest version, and the agent they wrote it through, or null. */
    updatedById: uuid()
      .notNull()
      .references(() => people.id),
    agent: text(),
    /** When the page was archived; null while it is current. */
    archivedAt: instant(),
    /** The words of the title and the body, for the database's own search; the database keeps it. */
    search: tsvector()
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', "title" || ' ' || "body")`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("documents_path_key").on(table.projectId, table.path),
    index("documents_project_archived_idx").on(table.projectId, table.archivedAt),
    index("documents_search_idx").using("gin", table.search),
  ],
);

/** Every version of a page: the title and the body as they were, who wrote them, through which agent, when. */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    authorId: uuid()
      .notNull()
      .references(() => people.id),
    agent: text(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("document_versions_number_key").on(table.documentId, table.number)],
);

/**
 * A link to a page by its path, as a document, a task or a decision of the project made it in
 * its text: kept both ways, so that a page says what refers to it. The target is a path and
 * not a row, since a link may name a page that is not written yet. Rows are replaced whenever
 * the source's text is written.
 */
export const documentLinks = pgTable(
  "document_links",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    sourceKind: text({ enum: LINK_SOURCES }).notNull(),
    sourceId: uuid().notNull(),
    targetPath: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: "document_links_pkey",
      columns: [table.projectId, table.sourceKind, table.sourceId, table.targetPath],
    }),
    index("document_links_target_idx").on(table.projectId, table.targetPath),
    check(
      "document_links_source_check",
      sql`${table.sourceKind} in (${sql.raw(literals(LINK_SOURCES))})`,
    ),
  ],
);

/** A file attached to a page, as a run hands one in: its name, size and type, and the hash its bytes are kept under. */
export const documentFiles = pgTable(
  "document_files",
  {
    id: id(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    label: text(),
    fileName: text().notNull(),
    fileSize: integer().notNull(),
    contentType: text().notNull(),
    sha256: text().notNull(),
    addedById: uuid()
      .notNull()
      .references(() => people.id),
    agent: text(),
    createdAt: createdAt(),
  },
  (table) => [index("document_files_document_idx").on(table.documentId)],
);

/**
 * An agent asking to connect (ADR-0011): the `code` a person approves, the SHA-256 of the
 * secret the command claims the token with (`secret_hash`), what the agent calls itself, and
 * the approval once given: who, what the token is to be called, and for how many days (null,
 * once approved, for a token that does not expire). The row goes when the token is claimed or
 * the request expires; the token itself is never here.
 */
export const connectRequests = pgTable(
  "connect_requests",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    code: text().notNull(),
    secretHash: text().notNull(),
    agent: text().notNull(),
    approvedById: uuid().references(() => people.id, { onDelete: "cascade" }),
    name: text(),
    tokenDays: integer(),
    approvedAt: instant(),
    expiresAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("connect_requests_code_key").on(table.workspaceId, table.code),
    uniqueIndex("connect_requests_secret_hash_key").on(table.secretHash),
    index("connect_requests_expires_idx").on(table.expiresAt),
  ],
);

/**
 * Everything that happened to the board, in order: the live feed and the audit trail. Append
 * only. Numbered rather than keyed by uuid, since the feed is read from a point on and a number
 * says where; the row's own time is kept for people.
 */
export const events = pgTable(
  "events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    /** The project it happened in; null for what happened to the workspace itself. */
    projectId: uuid().references(() => projects.id),
    kind: text().notNull(),
    /** Who did it; nobody for the console itself. */
    actorId: uuid().references(() => people.id),
    /** The agent the actor acted as, when they acted with a token: what it calls itself. */
    agent: text(),
    taskId: uuid().references(() => tasks.id),
    decisionId: uuid().references(() => decisions.id),
    /** The run it is about, for what an agent did. */
    runId: uuid().references(() => runs.id),
    /** The document it is about. */
    documentId: uuid().references(() => documents.id),
    /** What a feed shows without asking for the subject, as the API describes it. */
    data: jsonb().$type<RestEventData>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index("events_workspace_idx").on(table.workspaceId, table.id),
    index("events_project_idx").on(table.projectId, table.id),
    index("events_task_idx").on(table.taskId),
    index("events_run_idx").on(table.runId),
    index("events_decision_idx").on(table.decisionId),
    index("events_document_idx").on(table.documentId),
  ],
);
