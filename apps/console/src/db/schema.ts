import {
  ARTIFACT_KINDS,
  PERSON_ROLES,
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
    /** The number the next task gets: tasks are numbered per workspace, for people to say. */
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

/** A unit of work on the board. */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
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
    uniqueIndex("tasks_number_key").on(table.workspaceId, table.number),
    index("tasks_state_idx").on(table.workspaceId, table.state),
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
    index("runs_status_idx").on(table.workspaceId, table.status),
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
    answerNote: text(),
    answeredAt: instant(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("decisions_open_idx").on(table.workspaceId, table.answeredAt),
    index("decisions_task_idx").on(table.taskId),
    index("decisions_run_idx").on(table.runId),
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
    kind: text().notNull(),
    /** Who did it; nobody for the console itself. */
    actorId: uuid().references(() => people.id),
    taskId: uuid().references(() => tasks.id),
    decisionId: uuid().references(() => decisions.id),
    /** The run it is about, for what an agent did. */
    runId: uuid().references(() => runs.id),
    /** What a feed shows without asking for the subject, as the API describes it. */
    data: jsonb().$type<RestEventData>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index("events_workspace_idx").on(table.workspaceId, table.id)],
);
