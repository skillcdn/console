import {
  AGENT_STATES,
  ARTIFACT_KINDS,
  CATEGORY_COLORS,
  COLOR_NAMES,
  CONNECT_AS,
  GOAL_STATES,
  LINK_SOURCES,
  MEMBERSHIP_SOURCES,
  PEOPLE_VISIBILITIES,
  PERSON_KINDS,
  PERSON_ROLES,
  PERSON_STATUSES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  PROVIDER_KEYS,
  type RestAvatarParts,
  type RestDecisionOption,
  type RestEventData,
  type RestHome,
  type RestTaskLink,
  RUN_STATUSES,
  SECRET_ACCESSES,
  SESSION_KINDS,
  SIGNAL_KINDS,
  SIGNAL_SOURCES,
  TASK_PRIORITIES,
  TASK_STATES,
  WEEK_STARTS,
} from "@skillcdn/console/api";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
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
    /** When the organization at the git host was last read whole (ADR-0022); null until it is. */
    membersSyncedAt: instant(),
    /** Who sees whom on the People page (ADR-0035): everyone, or those one shares a project with. */
    peopleVisibility: text({ enum: PEOPLE_VISIBILITIES }).notNull().default("everyone"),
    /** The day the calendars begin a week on (ADR-0035): as the language has it, Monday or Sunday. */
    weekStart: text({ enum: WEEK_STARTS }).notNull().default("auto"),
    /** The workspace's time zone, an IANA name the command prints moments in; null for none. */
    timeZone: text(),
    /**
     * The workspace's language (ADR-0081), the tag of one the console speaks, for whoever has no
     * language of their own; null for none, English then.
     */
    language: text(),
    /**
     * The SkillCDN token the organization's pack is read with (ADR-0036), sealed with the
     * console's secret, and when it was set; null for none. A project that names no address and
     * holds no token of its own reads with it.
     */
    packToken: text(),
    packTokenSetAt: instant(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("workspaces_key_key").on(table.key),
    check(
      "workspaces_people_visibility_check",
      sql`${table.peopleVisibility} in (${sql.raw(literals(PEOPLE_VISIBILITIES))})`,
    ),
    check(
      "workspaces_week_start_check",
      sql`${table.weekStart} in (${sql.raw(literals(WEEK_STARTS))})`,
    ),
    check(
      "workspaces_pack_token_check",
      sql`(${table.packToken} is null) = (${table.packTokenSetAt} is null)`,
    ),
  ],
);

/**
 * A member of the workspace: someone who signed in through an identity provider, or an agent
 * account an administrator made (ADR-0084), which is a row before anyone signed in with it.
 */
export const people = pgTable(
  "people",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    /**
     * What the member is (ADR-0084): a person, or an agent account, a member of its own under the
     * same rules, which is never an administrator and always has a manager. It never goes back.
     */
    kind: text({ enum: PERSON_KINDS }).notNull().default("person"),
    /**
     * The identity provider (`gh`, `google`), and its immutable id of the account: what a member is
     * known by. The id is null for an agent account nobody has signed in with yet: its first
     * sign-in, with the login it was made with, binds the provider's account to the row.
     */
    host: text().notNull(),
    hostAccountId: text(),
    /** As the provider spells it now (a login, an address); a renamed account stays the same person. */
    login: text().notNull(),
    /** As the provider says at each sign-in; an agent account's is the console's own, kept by its supervisors. */
    name: text(),
    /** The account's picture as the host serves it, an https URL; none for an agent account, whose picture is drawn from its parts. */
    avatarUrl: text(),
    /** An agent account's handle (ADR-0084): what the pages and the command call it by, one per workspace, immutable; null for a person. */
    handle: text(),
    /** What the member does, in a line: every member's, kept by an administrator; null for none. */
    title: text(),
    /** What an agent account's avatar was rolled from, and the parts it is drawn from (ADR-0084): indexes into a set of shapes of the package, with the set's version. Nothing drawn is kept. */
    avatarSeed: text(),
    avatarParts: jsonb().$type<RestAvatarParts>(),
    /** An administrator configures the board, a member works on it: the console's own record. */
    role: text({ enum: PERSON_ROLES }).notNull().default("member"),
    /** Whether they are in (ADR-0022): a deactivated person is kept, for what they did, and refused. */
    status: text({ enum: PERSON_STATUSES }).notNull().default("active"),
    /** What let them in at their last sign-in: the organization, the domain, or a listing. */
    source: text({ enum: MEMBERSHIP_SOURCES }).notNull().default("listed"),
    deactivatedAt: instant(),
    /** The language the person reads in (ADR-0065), a tag: the one they chose, else the one the pages first saw them in; null until then. */
    language: text(),
    /** Whom the person reports to, another person of the workspace, set by an administrator; null for nobody. */
    managerId: uuid().references((): AnyPgColumn => people.id),
    /**
     * The person's work email, lowercase, one per workspace: the address they sign in with at
     * Google, else what an administrator wrote; read by a plugin with `people:read:email` to
     * match them to an account elsewhere, and by nobody else but an administrator and
     * themselves. Null until known.
     */
    email: text(),
    /** The person's own front page (ADR-0061), what they took off it and what they arranged at each width; null while they have arranged nothing. */
    home: jsonb().$type<RestHome>(),
    /** When the member last signed in; null for an agent account nobody has signed in with yet. */
    lastLoginAt: instant(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("people_host_account_key").on(table.workspaceId, table.host, table.hostAccountId),
    // A row nobody has signed in with is found by its login at its sign-in: one per login.
    uniqueIndex("people_unbound_login_key")
      .on(table.workspaceId, table.host, sql`lower(${table.login})`)
      .where(sql`${table.hostAccountId} is null`),
    uniqueIndex("people_handle_key")
      .on(table.workspaceId, table.handle)
      .where(sql`${table.handle} is not null`),
    check("people_kind_check", sql`${table.kind} in (${sql.raw(literals(PERSON_KINDS))})`),
    // An agent account has a handle, a manager and no administration; a person has signed in.
    check(
      "people_agent_check",
      sql`(${table.kind} = 'agent') = (${table.handle} is not null) and (${table.kind} = 'agent') = (${table.avatarParts} is not null)`,
    ),
    check(
      "people_agent_standing_check",
      sql`${table.kind} <> 'agent' or (${table.role} = 'member' and ${table.managerId} is not null)`,
    ),
    check(
      "people_signed_in_check",
      sql`${table.kind} = 'agent' or (${table.hostAccountId} is not null and ${table.lastLoginAt} is not null)`,
    ),
    uniqueIndex("people_email_key")
      .on(table.workspaceId, table.email)
      .where(sql`${table.email} is not null`),
    index("people_manager_idx").on(table.managerId),
    check("people_role_check", sql`${table.role} in (${sql.raw(literals(PERSON_ROLES))})`),
    check("people_status_check", sql`${table.status} in (${sql.raw(literals(PERSON_STATUSES))})`),
    check(
      "people_source_check",
      sql`${table.source} in (${sql.raw(literals(MEMBERSHIP_SOURCES))})`,
    ),
    check(
      "people_deactivated_check",
      sql`(${table.status} = 'deactivated') = (${table.deactivatedAt} is not null)`,
    ),
  ],
);

/**
 * A team of the workspace (ADR-0073): a name and its members, a unit to call people by and to
 * grant a plugin's role to; no head and no team above it, since the reporting line says who is
 * above whom.
 */
export const teams = pgTable(
  "teams",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    /**
     * What the team is called by in an address, a grant, a plugin and the command (ADR-0074):
     * lowercase letters, digits and hyphens, as a project's key is, and one per workspace among
     * the teams' keys and the projects' keys alike; immutable once the team is made.
     */
    key: text().notNull(),
    /** As the administrator spelled it; one per workspace without regard to case. */
    name: text().notNull(),
    createdAt: createdAt(),
    createdBy: uuid().references(() => people.id),
  },
  (table) => [
    uniqueIndex("teams_key_key").on(table.workspaceId, table.key),
    uniqueIndex("teams_name_key").on(table.workspaceId, sql`lower(${table.name})`),
  ],
);

/** Who is in a team: a person is in any number of them. */
export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    addedAt: instant().notNull(),
    addedBy: uuid().references(() => people.id),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.personId] }),
    index("team_members_person_idx").on(table.personId),
  ],
);

/**
 * A login an administrator let in (ADR-0022): whoever signs in with that account at that host
 * becomes the person, and the row is bound to them from then on, so that a renamed account
 * stays let in and no other account can take the login. Deactivating a listed person takes the
 * row away with their standing; reactivating them lists them again. Rows go with their person.
 */
export const listings = pgTable(
  "listings",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    host: text().notNull(),
    /** As the administrator spelled it; compared without regard to case. */
    login: text().notNull(),
    /** The person who signed in with it, once someone has. */
    personId: uuid().references(() => people.id, { onDelete: "cascade" }),
    /** The administrator who listed it; nobody when the console listed a person again on their reactivation. */
    listedById: uuid().references(() => people.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("listings_login_key").on(table.workspaceId, table.host, sql`lower(${table.login})`),
    index("listings_person_idx").on(table.personId),
    check("listings_host_check", sql`${table.host} in (${sql.raw(literals(PROVIDER_KEYS))})`),
  ],
);

/**
 * Where a member is signed in: a browser, by the SHA-256 of the cookie's token, or the command
 * signed in as the account itself (ADR-0084), by the SHA-256 of the secret it presents as a
 * token is presented; never the token or the secret. The end moves while the session is used,
 * and the member sees each of theirs, what it is and where it was last used from (board #309).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** What holds it: a browser, whose cookie carries it, or the command, which presents it in the authorization header. Neither is read as the other. */
    kind: text({ enum: SESSION_KINDS }).notNull().default("browser"),
    /** For the command's: what it called itself when it signed in, and where it runs; null for a browser's. */
    name: text(),
    tokenHash: text().notNull(),
    expiresAt: instant().notNull(),
    lastSeenAt: instant().notNull(),
    /** What the browser called itself when the session began, cut to a line; null for one begun before this was kept. */
    userAgent: text(),
    /** Where the browser last came from, as the server saw it (deploy/README.md); null until seen. */
    address: text(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_person_idx").on(table.personId),
    index("sessions_expires_idx").on(table.expiresAt),
    check("sessions_kind_check", sql`${table.kind} in (${sql.raw(literals(SESSION_KINDS))})`),
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
    /** The version of the command that last presented it (ADR-0025); null when the last to present it named none. */
    client: text(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("tokens_token_hash_key").on(table.tokenHash),
    index("tokens_person_idx").on(table.personId),
    index("tokens_expires_idx").on(table.expiresAt),
  ],
);

/**
 * What the console knows of an agent account's runner (ADR-0085): how the agent stands and why,
 * when the runner was last heard from, the last signal it delivered, what it said of its machine
 * and its product, and what its supervisors chose for it to run with. A row from the first
 * heartbeat, or the first signal, on.
 */
export const agentRunners = pgTable(
  "agent_runners",
  {
    personId: uuid()
      .primaryKey()
      .references(() => people.id, { onDelete: "cascade" }),
    /** How the agent stands; null until a runner has said, or the console has noted. */
    state: text({ enum: AGENT_STATES }),
    reason: text(),
    stateAt: instant(),
    heardAt: instant(),
    /** The number of the last signal the runner handed to its product. */
    delivered: integer().notNull().default(0),
    /** The number the next signal of the account takes. */
    nextSignal: integer().notNull().default(1),
    /** The number of a supervisor's `stop` that stands, until a `restart` or a `reset` is sent; null for none. */
    stopSignal: integer(),
    /** The open session, as the runner last said. */
    sessionId: uuid(),
    machine: jsonb().$type<{ name: string; os: string; user: string }>(),
    runner: text(),
    product: jsonb().$type<{
      driver: string;
      name: string;
      version: string | null;
      tried: boolean;
    }>(),
    offers: jsonb().$type<{
      models: string[];
      efforts: string[];
      steer: boolean;
      images: boolean;
      resume: boolean;
    }>(),
    running: jsonb().$type<{ model: string | null; effort: string | null }>(),
    /** What its supervisors or the account chose for it to run with; null each for the product's own. */
    model: text(),
    effort: text(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "agent_runners_state_check",
      sql`${table.state} is null or ${table.state} in (${sql.raw(literals(AGENT_STATES))})`,
    ),
    index("agent_runners_heard_idx").on(table.heardAt),
  ],
);

/**
 * A signal (ADR-0085): what the console sends an agent account's runner, numbered per account,
 * with who sent it and where it came from. The account's record of what its agent was told;
 * not an event of the board's feed.
 */
export const agentSignals = pgTable(
  "agent_signals",
  {
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    kind: text({ enum: SIGNAL_KINDS }).notNull(),
    /** Who sent it; null for the console itself. */
    byId: uuid().references(() => people.id),
    agent: text(),
    plugin: text(),
    source: text({ enum: SIGNAL_SOURCES }).notNull(),
    key: text(),
    text: text().notNull().default(""),
    /** For `set`: the model and the effort to run with. */
    set: jsonb().$type<{ model: string | null; effort: string | null }>(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.personId, table.number] }),
    check("agent_signals_kind_check", sql`${table.kind} in (${sql.raw(literals(SIGNAL_KINDS))})`),
    check(
      "agent_signals_source_check",
      sql`${table.source} in (${sql.raw(literals(SIGNAL_SOURCES))})`,
    ),
  ],
);

/**
 * A secret of an agent account's store (ADR-0087): a named value, sealed with the console's
 * key, which the account alone reads back; a supervisor seeds one write-only and removes one.
 * The value is never here in the clear, and never in a log.
 */
export const agentSecrets = pgTable(
  "agent_secrets",
  {
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** What the account calls it: lowercase letters, digits, dots, hyphens and underscores (`git.token`). */
    name: text().notNull(),
    /** The value, sealed for this account and this name: moved to another row, it opens for nobody. */
    sealed: text().notNull(),
    /** The day the value ends on, where it is known to: a product's long-lived token, say; null otherwise. */
    expiresOn: date(),
    /** Whether a supervisor set it, where the account did otherwise. */
    seeded: boolean().notNull().default(false),
    setById: uuid().references(() => people.id),
    setAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.personId, table.name] })],
);

/**
 * The account's record of its secret store (ADR-0087): every time a secret was set, read or
 * removed, by whom and through which agent, and whether it was seeded; the name, never the
 * value. Read by the account's supervisors. Not an event of the board's feed.
 */
export const agentSecretAccesses = pgTable(
  "agent_secret_accesses",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    name: text().notNull(),
    action: text({ enum: SECRET_ACCESSES }).notNull(),
    /** Who did it: the account itself, or a supervisor. */
    actorId: uuid().references(() => people.id),
    /** The agent a supervisor did it through, when they acted with a token (ADR-0056); null when they did it themselves. */
    agent: text(),
    seeded: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index("agent_secret_accesses_person_idx").on(table.personId, table.id),
    check(
      "agent_secret_accesses_action_check",
      sql`${table.action} in (${sql.raw(literals(SECRET_ACCESSES))})`,
    ),
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
    /** The project's mark: a colour by name, and a symbol; null for the ones chosen from its key and its name. */
    color: text({ enum: COLOR_NAMES }),
    symbol: text(),
    /** The project's own image for its mark: the hash the blob store keeps it by, and its media type; null for none. */
    iconSha256: text(),
    iconContentType: text(),
    /** The pack token a person made at the deployment for a private pack (ADR-0028), sealed with the console's secret, and when it was set; null for none. */
    packToken: text(),
    packTokenSetAt: instant(),
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
    check(
      "projects_color_check",
      sql`${table.color} is null or ${table.color} in (${sql.raw(literals(COLOR_NAMES))})`,
    ),
    check(
      "projects_icon_check",
      sql`(${table.iconSha256} is null) = (${table.iconContentType} is null)`,
    ),
    check(
      "projects_pack_token_check",
      sql`(${table.packToken} is null) = (${table.packTokenSetAt} is null)`,
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

/**
 * A category tasks are sorted into (ADR-0019): the workspace's own word for a kind of work,
 * engineering, product, design, kept by an administrator. Its key is what the command and the
 * filters say, and does not change; a category no task uses may be removed.
 */
export const categories = pgTable(
  "categories",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    key: text().notNull(),
    name: text().notNull(),
    /** One of the names the pages paint a category in; never a value typed by hand. */
    color: text({ enum: CATEGORY_COLORS }).notNull().default("gray"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("categories_key_key").on(table.workspaceId, table.key),
    check("categories_color_check", sql`${table.color} in (${sql.raw(literals(CATEGORY_COLORS))})`),
  ],
);

/**
 * A goal of a project's roadmap (ADR-0019): what the project works towards, by when, and how it
 * stands; the tasks that work towards it say how far it is. Set and changed by an owner.
 */
export const goals = pgTable(
  "goals",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    title: text().notNull(),
    /** Markdown, bounded at the edge; shown as text, never as HTML. */
    body: text().notNull().default(""),
    state: text({ enum: GOAL_STATES }).notNull().default("planned"),
    /** The day the work towards the goal is meant to begin, or none: a goal is planned in days as a task is (ADR-0026). */
    startsOn: date({ mode: "string" }),
    /** The day the goal is meant to be reached by, or none: a plan is made in days. */
    dueOn: date({ mode: "string" }),
    /** The category the goal is sorted into, as a task is; null for none. */
    categoryId: uuid().references(() => categories.id),
    createdById: uuid()
      .notNull()
      .references(() => people.id),
    /** The agent the goal was set through (ADR-0056), or null when a person set it themselves. */
    agent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("goals_project_state_idx").on(table.projectId, table.state),
    index("goals_category_idx").on(table.categoryId),
    check("goals_state_check", sql`${table.state} in (${sql.raw(literals(GOAL_STATES))})`),
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
    /** The person the task is on, which is who wrote it unless it is handed over: one, where the workers (`task_workers`) are any number. */
    ownerId: uuid()
      .notNull()
      .references(() => people.id),
    /** The agent the task was written through (ADR-0056), or null when a person wrote it themselves; the owner may have changed since. */
    agent: text(),
    /** The task this one is part of, for a breakdown. */
    parentId: uuid().references((): AnyPgColumn => tasks.id),
    /** The category the task is sorted into, or none; a category in use cannot be removed. */
    categoryId: uuid().references(() => categories.id),
    /** The goal of the project's roadmap the task works towards, or none. */
    goalId: uuid().references(() => goals.id),
    /** The plan (ADR-0019): the day the work is meant to begin, and the day it is due, in days. */
    startsOn: date({ mode: "string" }),
    dueOn: date({ mode: "string" }),
    /**
     * What happened, kept by the board itself: when the task was first moved past ready, and
     * when it was moved to done, cleared when it is moved back out of done.
     */
    startedAt: instant(),
    doneAt: instant(),
    /** When the task was put away (ADR-0029): out of the listings, the board and the calendar, open by its number; null while current. */
    archivedAt: instant(),
    /** Repositories, pull requests, documents: `https` URLs with a label, as the API checked them. */
    links: jsonb().$type<RestTaskLink[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("tasks_project_number_key").on(table.projectId, table.number),
    index("tasks_project_state_idx").on(table.projectId, table.state),
    index("tasks_parent_idx").on(table.parentId),
    index("tasks_project_due_idx").on(table.projectId, table.dueOn),
    index("tasks_goal_idx").on(table.goalId),
    index("tasks_category_idx").on(table.categoryId),
    index("tasks_project_archived_idx").on(table.projectId, table.archivedAt),
    check("tasks_state_check", sql`${table.state} in (${sql.raw(literals(TASK_STATES))})`),
    check(
      "tasks_priority_check",
      sql`${table.priority} in (${sql.raw(literals(TASK_PRIORITIES))})`,
    ),
  ],
);

/**
 * The people at work on a task (ADR-0037): any number, each once, in the order they came to
 * it; the owner stays one, on the task's row. A person who may work in the project, checked
 * when they are put on the task; a run taking the task puts its person on it.
 */
export const taskWorkers = pgTable(
  "task_workers",
  {
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => people.id),
    addedAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: "task_workers_pkey", columns: [table.taskId, table.personId] }),
    index("task_workers_person_idx").on(table.personId),
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
    /**
     * When the agent was last heard from: the start, a report, a hand-in, a question. The board
     * cannot know whether an agent still runs (ADR-0020); this is what it knows.
     */
    lastHeardAt: instant().notNull().defaultNow(),
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
 * A word in the discussion on a task (ADR-0024): Markdown by a person, or by their agent, in
 * the task's project. Never rewritten and never deleted: a mistake is corrected in the next one.
 */
export const comments = pgTable(
  "comments",
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
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid()
      .notNull()
      .references(() => people.id),
    /** The agent the author wrote through, when they did; null when a person wrote it themselves. */
    agent: text(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("comments_task_idx").on(table.taskId, table.createdAt)],
);

/** A file put in a comment, kept as a run's file is: its name, its size, its media type and its hash. */
export const commentFiles = pgTable(
  "comment_files",
  {
    id: id(),
    commentId: uuid()
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    fileName: text().notNull(),
    fileSize: integer().notNull(),
    contentType: text().notNull(),
    sha256: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("comment_files_comment_idx").on(table.commentId)],
);

/**
 * The bytes of files handed in, put in comments or on decisions, or attached to pages, under their SHA-256: the
 * PostgreSQL implementation of the blob-store port, for the smallest install. The rows that
 * name a hash are what refers to a row here; the table is not the model, and the bucket writes
 * nothing here, reading only what was kept before it (ADR-0016).
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
    /** The first of those to answer (ADR-0042): the raiser, unless others of the project were named; kept beside the list for the readers of before. */
    deciderId: uuid()
      .notNull()
      .references(() => people.id),
    /** Everyone the decision is addressed to (ADR-0057), the first being `deciderId`: each finds it among their decisions, and the first answer ends it. */
    deciderIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    answeredById: uuid().references(() => people.id),
    /** The agent the answer came through (ADR-0056), or null when the person answered themselves. */
    answeredAgent: text(),
    /** The id of the chosen option. */
    answer: text(),
    /** The rationale given with the answer: Markdown. */
    answerNote: text(),
    answeredAt: instant(),
    /** What followed the decision, written afterwards: Markdown; null until someone writes it (ADR-0009). */
    outcome: text(),
    /** Who wrote what followed, the agent they wrote it through (null when themselves) and when (ADR-0056); null until written, cleared with it. */
    outcomeById: uuid().references(() => people.id),
    outcomeAgent: text(),
    outcomeAt: instant(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("decisions_project_open_idx").on(table.projectId, table.answeredAt),
    index("decisions_decider_open_idx").on(table.deciderId, table.answeredAt),
    index("decisions_deciders_idx").using("gin", table.deciderIds),
    index("decisions_task_idx").on(table.taskId),
    index("decisions_run_idx").on(table.runId),
  ],
);

/**
 * A file put on a decision when it was raised (ADR-0055), kept as a comment's file is: its
 * name, its size, its media type and its hash. Rows go with their decision.
 */
export const decisionFiles = pgTable(
  "decision_files",
  {
    id: id(),
    decisionId: uuid()
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    fileName: text().notNull(),
    fileSize: integer().notNull(),
    contentType: text().notNull(),
    sha256: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("decision_files_decision_idx").on(table.decisionId)],
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
    /** The project the page belongs to; null for a page of the workspace's own, which is its rules alone (ADR-0023). */
    projectId: uuid().references(() => projects.id),
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
    // One page of the workspace's own per path: the index above lets nulls repeat.
    uniqueIndex("documents_workspace_path_key")
      .on(table.workspaceId, table.path)
      .where(sql`${table.projectId} is null`),
    index("documents_project_archived_idx").on(table.projectId, table.archivedAt),
    index("documents_search_idx").using("gin", table.search),
    // The workspace's own pages are its rules, until a decision widens them.
    check(
      "documents_workspace_page_check",
      sql`${table.projectId} is not null or ${table.path} = 'rules'`,
    ),
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
 * secret the command claims the token with (`secret_hash`), what the agent calls itself, the
 * address the request came from (`client_address`, as the trusted proxies resolve it; null when
 * the console could not tell), by which the requests are bounded (ADR-0047), and the approval
 * once given: who, what the token is to be called, and for how many days (null, once approved,
 * for a token that does not expire). The row goes when the token is claimed or the request
 * expires; the token itself is never here.
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
    /** What it asks to be (ADR-0084): an agent of whoever approves it, with a token of theirs, or the approver themselves, the command signed in as the account with a session of its own. */
    as: text({ enum: CONNECT_AS }).notNull().default("agent"),
    clientAddress: text(),
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
    check("connect_requests_as_check", sql`${table.as} in (${sql.raw(literals(CONNECT_AS))})`),
  ],
);

/**
 * A project's pack asking to be connected at the deployment (ADR-0036): what the person was
 * shown, the code and the page, the secret the deployment handed the console to claim the token
 * with, sealed with the console's secret, who asked, and until when. One at a time per project;
 * the row goes when the token is claimed, when the request ends, or when an owner gives it up.
 * The token goes to the project's row, sealed, and is never here.
 */
export const packConnects = pgTable(
  "pack_connects",
  {
    projectId: uuid()
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The address asked to connect, canonical. */
    address: text().notNull(),
    code: text().notNull(),
    url: text().notNull(),
    secret: text().notNull(),
    intervalSeconds: integer().notNull(),
    startedById: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    expiresAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("pack_connects_expires_idx").on(table.expiresAt)],
);

/** The same for the workspace's own token (ADR-0036): one request at a time for the organization's pack. */
export const workspacePackConnects = pgTable(
  "workspace_pack_connects",
  {
    workspaceId: uuid()
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    address: text().notNull(),
    code: text().notNull(),
    url: text().notNull(),
    secret: text().notNull(),
    intervalSeconds: integer().notNull(),
    startedById: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    expiresAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("workspace_pack_connects_expires_idx").on(table.expiresAt)],
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
    /** The goal it is about. */
    goalId: uuid().references(() => goals.id),
    /** The plugin that caused it (ADR-0052), by key; null for the console's own doing. */
    plugin: text(),
    /** The plugin the actor acted through (ADR-0072), by key, when one acted for them. */
    via: text(),
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
    index("events_goal_idx").on(table.goalId),
    index("events_plugin_idx").on(table.workspaceId, table.plugin, table.id),
  ],
);

/**
 * A plugin an administrator enabled (ADR-0049, docs/specs/plugins.md, "Lifecycle"): what the
 * console keeps of it while the package comes and goes with the image. The package itself is
 * read from `PLUGINS_DIR` at boot; this row says whether it is enabled, what was consented to,
 * which board project and projects it is on, its settings without the secrets, and the version
 * and data version it was last brought to. An install whose package left the directory is
 * orphaned, and offered export and purge.
 */
export const pluginInstalls = pgTable(
  "plugin_installs",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    key: text().notNull(),
    /** The package's name on the registry, by which it is installed. */
    packageName: text().notNull(),
    /** The version last enabled or upgraded to, and the data version its records are at. */
    version: text().notNull(),
    dataVersion: integer().notNull().default(1),
    /** Enabled, disabled by an administrator, or waiting for consent to what a new version asks (checked). */
    state: text().notNull(),
    /** The capabilities consented to, as the manifest spells them. */
    consent: jsonb().$type<string[]>().notNull().default([]),
    /** The project the plugin's decisions, tasks and documents go to, or none. */
    boardProjectId: uuid().references(() => projects.id),
    /** The projects the plugin is on: `"all"`, or their keys. */
    projects: jsonb().$type<"all" | string[]>().notNull().default(sql`'"all"'::jsonb`),
    /** The settings' values, by key, without the secrets, which are in `plugin_secrets`. */
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    enabledAt: instant(),
    enabledBy: uuid().references(() => people.id),
    disabledAt: instant(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("plugin_installs_key_key").on(table.workspaceId, table.key),
    index("plugin_installs_board_idx").on(table.boardProjectId),
    check(
      "plugin_installs_state_check",
      sql`${table.state} in ('enabled', 'disabled', 'needs_consent')`,
    ),
  ],
);

/**
 * A role of a plugin given by an administrator (docs/specs/plugins.md, "Roles and grants"): to a
 * person, to the members of a project, which follows the membership, to another plugin, which
 * holds it as itself (ADR-0072), to the members of a team, which follows the membership
 * (ADR-0073), or to everyone of the workspace. Exactly one of the five, checked. A plugin's grants are read on every call that
 * names a role; an administrator holds every role without a row.
 */
export const pluginGrants = pgTable(
  "plugin_grants",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    role: text().notNull(),
    personId: uuid().references(() => people.id, { onDelete: "cascade" }),
    projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
    /** The plugin the role went to (ADR-0072), by key: one that holds it as itself. */
    granteePluginKey: text(),
    /** The team the role went to (ADR-0073): its members hold it, following the membership. */
    teamId: uuid().references(() => teams.id, { onDelete: "cascade" }),
    everyone: boolean().notNull().default(false),
    createdAt: createdAt(),
    createdBy: uuid().references(() => people.id),
  },
  (table) => [
    index("plugin_grants_plugin_idx").on(table.workspaceId, table.pluginKey),
    index("plugin_grants_person_idx").on(table.personId),
    index("plugin_grants_project_idx").on(table.projectId),
    index("plugin_grants_grantee_idx").on(table.workspaceId, table.granteePluginKey),
    index("plugin_grants_team_idx").on(table.teamId),
    check(
      "plugin_grants_target_check",
      sql`((${table.personId} is not null)::int + (${table.projectId} is not null)::int + (${table.granteePluginKey} is not null)::int + (${table.teamId} is not null)::int + (${table.everyone})::int) = 1`,
    ),
  ],
);

/**
 * A secret setting of a plugin, sealed with the deployment's secret under the purpose
 * `plugin-secret` (docs/specs/plugins.md, "Settings"): never returned by any route, never handed
 * to plugin code, used by the console where the plugin names it. Only whether and when it was
 * set is shown.
 */
export const pluginSecrets = pgTable(
  "plugin_secrets",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    name: text().notNull(),
    sealed: text().notNull(),
    setAt: instant().notNull(),
    setBy: uuid().references(() => people.id),
    /** When the secret expires, where the answer it was sealed from said so (ADR-0070); null for one that does not. */
    expiresAt: instant(),
    /** `administrator` for one an administrator set; the host of the answer it was sealed from otherwise. */
    source: text().notNull().default("administrator"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.pluginKey, table.name] })],
);

/**
 * A plugin's record (ADR-0051, docs/specs/plugins.md, "Records"): one document of a collection
 * the plugin declared, kept by the console. `data` is the plugin's, checked against the
 * collection's schema in the plugin's thread on every write; `search_text` is what the
 * collection's search fields held at the write, which the database indexes; `project_id` is the
 * project the record is linked to, where the collection has one; `owner_id` the person the
 * collection's owner field names. Nothing is deleted but by purge: `archived_at` keeps a record
 * out of the lists.
 */
export const pluginRecords = pgTable(
  "plugin_records",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    collection: text().notNull(),
    projectId: uuid().references(() => projects.id),
    ownerId: uuid().references(() => people.id),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    searchText: text().notNull().default(""),
    search: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', "search_text")`),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Who caused the write, and through which agent; nobody for the console's own doing. */
    createdById: uuid().references(() => people.id),
    createdAgent: text(),
    updatedById: uuid().references(() => people.id),
    updatedAgent: text(),
    archivedAt: instant(),
  },
  (table) => [
    index("plugin_records_collection_idx").on(
      table.workspaceId,
      table.pluginKey,
      table.collection,
      table.id,
    ),
    index("plugin_records_project_idx").on(table.pluginKey, table.collection, table.projectId),
    index("plugin_records_owner_idx").on(table.pluginKey, table.collection, table.ownerId),
    index("plugin_records_data_idx").using("gin", sql`${table.data} jsonb_path_ops`),
    index("plugin_records_search_idx").using("gin", table.search),
  ],
);

/** A version of a record before a write, where the collection keeps history: the data as it was, when, and by whom. */
export const pluginRecordVersions = pgTable(
  "plugin_record_versions",
  {
    recordId: uuid()
      .notNull()
      .references(() => pluginRecords.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    at: instant().notNull(),
    byId: uuid().references(() => people.id),
    agent: text(),
  },
  (table) => [primaryKey({ columns: [table.recordId, table.version] })],
);

/** A file on a record, as a run hands one in: its name, size and type, and the hash its bytes are kept under in the blob store. */
export const pluginRecordFiles = pgTable(
  "plugin_record_files",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    recordId: uuid()
      .notNull()
      .references(() => pluginRecords.id, { onDelete: "cascade" }),
    fileName: text().notNull(),
    fileSize: integer().notNull(),
    contentType: text().notNull(),
    sha256: text().notNull(),
    createdAt: createdAt(),
    createdById: uuid().references(() => people.id),
    agent: text(),
  },
  (table) => [
    index("plugin_record_files_record_idx").on(table.recordId),
    index("plugin_record_files_plugin_idx").on(table.workspaceId, table.pluginKey),
  ],
);

/**
 * A file uploaded for a plugin's command and not yet attached to a record: the handle a command
 * is given, good for an hour, by the person who uploaded it. The bytes are the blob store's;
 * the janitor removes what expired.
 */
export const pluginUploads = pgTable(
  "plugin_uploads",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    fileName: text().notNull(),
    fileSize: integer().notNull(),
    contentType: text().notNull(),
    sha256: text().notNull(),
    createdAt: createdAt(),
    expiresAt: instant().notNull(),
  },
  (table) => [
    index("plugin_uploads_expires_idx").on(table.expiresAt),
    index("plugin_uploads_plugin_idx").on(table.workspaceId, table.pluginKey),
  ],
);

/**
 * What a plugin's record refers to, and what a plugin made on the board (ADR-0052): a record to
 * a task, a decision, a document, a project, a run or a record of any plugin; or, with no record,
 * an item of the board the plugin made, by which the board shows "through <plugin>" and the plugin
 * is held to its own items.
 */
export const pluginLinks = pgTable(
  "plugin_links",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    recordId: uuid().references(() => pluginRecords.id, { onDelete: "cascade" }),
    targetKind: text().notNull(),
    targetId: uuid().notNull(),
    /** For a record of another plugin: whose, and which collection. */
    targetPlugin: text(),
    targetCollection: text(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("plugin_links_record_target_key").on(
      table.recordId,
      table.targetKind,
      table.targetId,
    ),
    /** An item of the board by its kind and id: whether, and which, plugin made it (ADR-0052). */
    index("plugin_links_item_idx").on(table.targetKind, table.targetId),
    index("plugin_links_target_idx").on(
      table.workspaceId,
      table.pluginKey,
      table.targetKind,
      table.targetId,
    ),
    check(
      "plugin_links_kind_check",
      sql`${table.targetKind} in ('task', 'decision', 'document', 'project', 'run', 'record')`,
    ),
  ],
);

/**
 * An event a plugin emitted (`ctx.events.emit`, docs/specs/plugins.md, "Events, hooks and
 * jobs"): for the plugin's own frames and for other plugins' hooks, never the board's feed.
 * Numbered in one stream per workspace, which the dispatcher reads from a cursor; 100,000 kept
 * per plugin, for ninety days.
 */
export const pluginEvents = pgTable(
  "plugin_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    kind: text().notNull(),
    data: jsonb(),
    createdAt: createdAt(),
  },
  (table) => [index("plugin_events_plugin_idx").on(table.workspaceId, table.pluginKey, table.id)],
);

/**
 * Where a plugin's hooks are in the two streams, the console's events and the plugins' events
 * (docs/specs/plugins.md, "Events, hooks and jobs"): the number of the last event delivered of
 * each, and how the event at the head has gone so far, for the retries with backoff. One row per
 * plugin, written by the one dispatcher that holds the lock.
 */
export const pluginCursors = pgTable(
  "plugin_cursors",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    consoleAfter: bigint({ mode: "number" }).notNull().default(0),
    pluginAfter: bigint({ mode: "number" }).notNull().default(0),
    attempts: integer().notNull().default(0),
    nextAttemptAt: instant(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.pluginKey] })],
);

/**
 * A job of a plugin as the scheduler keeps it (docs/specs/plugins.md, "Events, hooks and jobs"):
 * when it last ran and how it went, when it runs next, and when its failure was last written as
 * an event, so that one is written an hour at most.
 */
export const pluginJobs = pgTable(
  "plugin_jobs",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    pluginKey: text().notNull(),
    name: text().notNull(),
    lastRunAt: instant(),
    lastOutcome: text(),
    nextAt: instant(),
    failedEventAt: instant(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.pluginKey, table.name] }),
    check("plugin_jobs_outcome_check", sql`${table.lastOutcome} in ('ok', 'failed')`),
  ],
);
