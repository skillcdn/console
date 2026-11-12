// The concepts the schema, the API and the UI are named after (docs/architecture.md,
// "Vocabulary"). A list here is a check constraint in the database, an enum in the schemas, and
// a column or a badge on the board: one source for all three.

/** The states a task moves through, in the order it usually does. */
export const TASK_STATES = [
  "idea",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "dropped",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** The states a task is still open in: not done, not dropped. */
export const OPEN_TASK_STATES: readonly TaskState[] = ["idea", "ready", "in_progress", "in_review"];

/** How much a task matters next to the others, in rising order. */
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * The states of a goal on the roadmap (ADR-0019): planned for later, being worked towards,
 * reached, or let go. A person says which; the tasks under it say how far it is.
 */
export const GOAL_STATES = ["planned", "active", "done", "dropped"] as const;

export type GoalState = (typeof GOAL_STATES)[number];

/** The states a goal is still open in: planned, or being worked towards. */
export const OPEN_GOAL_STATES: readonly GoalState[] = ["planned", "active"];

/**
 * The colours a category, or a project's mark, may be shown in: names, so that a custom console
 * paints them in its own tokens and no value a person typed reaches a stylesheet.
 */
export const COLOR_NAMES = [
  "gray",
  "blue",
  "green",
  "orange",
  "pink",
  "purple",
  "teal",
  "yellow",
] as const;

export type ColorName = (typeof COLOR_NAMES)[number];

/** The colours of the categories: the same names. */
export const CATEGORY_COLORS = COLOR_NAMES;

export type CategoryColor = ColorName;

/** The kinds of image a project's own mark may be: what a browser shows in place, and nothing that can run. */
export const PROJECT_ICON_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ProjectIconType = (typeof PROJECT_ICON_TYPES)[number];

/** The identity providers people may sign in through: the git host, and Google (Workspace). */
/** The languages the console's pages speak, and a plugin's words are given in. */
export const CONSOLE_LANGUAGES = ["en", "ko"] as const;
export type ConsoleLanguage = (typeof CONSOLE_LANGUAGES)[number];

/**
 * The languages the console speaks with one of them first: the workspace's (ADR-0081), so that
 * the first of what a plugin reads as `languages` is the language for whoever has none of their own.
 */
export function languagesFirst(first: string): string[] {
  return [first, ...CONSOLE_LANGUAGES.filter((tag) => tag !== first)];
}

export const PROVIDER_KEYS = ["gh", "google"] as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export function isProviderKey(value: string | null | undefined): value is ProviderKey {
  return (PROVIDER_KEYS as readonly string[]).includes(value ?? "");
}

/** What a person may do: an administrator configures the board, a member works on it. */
export const PERSON_ROLES = ["admin", "member"] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

/**
 * What a member is (ADR-0084): a person, as every member has been, or an agent account, an
 * agent that is a member of its own. The rules make no difference between them but one: an
 * agent account is never a workspace administrator.
 */
export const PERSON_KINDS = ["person", "agent"] as const;

export type PersonKind = (typeof PERSON_KINDS)[number];

/**
 * What holds a session (ADR-0084): a browser a member is signed in on, or the command signed in
 * as the account itself, which presents its session as a token is presented and is held to what
 * a token may ask.
 */
export const SESSION_KINDS = ["browser", "command"] as const;

export type SessionKind = (typeof SESSION_KINDS)[number];

/**
 * Why an agent account stands as it does (ADR-0085), one of a short list and never what was
 * said: the runner's word for what it reports, `stop` for a supervisor's, `no_heartbeat` for an
 * account the console has not heard from.
 */
export const AGENT_STATE_REASONS = [
  "started",
  "resumed",
  "reset",
  "completed",
  "stop",
  "model_refused",
  "sign_in",
  "start",
  "crashed",
  "no_heartbeat",
] as const;

export type AgentStateReason = (typeof AGENT_STATE_REASONS)[number];

/**
 * What the console sends an agent account's runner (ADR-0085): a wake, a supervisor's words, an
 * interruption with words, a stop, a start with the same conversation or with a new one, and
 * the model and the level of effort to run with.
 */
export const SIGNAL_KINDS = [
  "wake",
  "tell",
  "interrupt",
  "stop",
  "restart",
  "reset",
  "set",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/**
 * What a service is to a workspace's agents (ADR-0089): the one their accounts sign in through,
 * the git host, the messenger.
 */
export const SERVICE_ROLES = ["identity", "git", "messenger"] as const;

export type ServiceRole = (typeof SERVICE_ROLES)[number];

/** Where a signal came from: a supervisor's own, the board, the schedule, a messenger, or the console's own housekeeping. */
export const SIGNAL_SOURCES = ["person", "board", "schedule", "messenger", "console"] as const;

export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/**
 * How a runner's session ended (ADR-0085, ADR-0086): a supervisor stopped the agent, restarted
 * it or reset it; the product's process died, or exited by itself; or a session begun after it
 * took it over, which is the console's word and never the runner's.
 */
export const SESSION_ENDS = [
  "stopped",
  "restarted",
  "reset",
  "crashed",
  "exited",
  "taken_over",
] as const;

export type SessionEnd = (typeof SESSION_ENDS)[number];

/**
 * What an event of a session's transcript is (ADR-0086): what the agent was sent, `wake` by the
 * console and `person` by a supervisor; what it said and what it thought; a tool it called and
 * what came back; a permission asked and how it was answered; a status of the product or of the
 * session; an error.
 */
export const TRANSCRIPT_KINDS = [
  "wake",
  "person",
  "assistant",
  "thinking",
  "tool_call",
  "tool_result",
  "permission",
  "status",
  "error",
] as const;

export type TranscriptKind = (typeof TRANSCRIPT_KINDS)[number];

/** The kinds of picture a transcript keeps: what an agent's tools returned, shown in place and never run. */
export const TRANSCRIPT_PICTURE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type TranscriptPictureType = (typeof TRANSCRIPT_PICTURE_TYPES)[number];

/**
 * What was done to a secret of an agent account's store (ADR-0087), as the account's record
 * says it: set, by the account or seeded by a supervisor; read, by the account; or removed.
 */
export const SECRET_ACCESSES = ["set", "read", "removed"] as const;

export type SecretAccess = (typeof SECRET_ACCESSES)[number];

/**
 * How an agent account stands, in one word (ADR-0085): `running`, its runner heard from and the
 * agent at work or ready for it; `stopped`, by a supervisor, until one starts it again; `refused`,
 * the model would not answer; `failed`, its product could not start or sign in; `unheard`, its
 * runner not heard from for a while. `null` where no runner has ever said.
 */
export const AGENT_STATES = ["running", "stopped", "refused", "failed", "unheard"] as const;

export type AgentState = (typeof AGENT_STATES)[number];

/**
 * Whether a person is in: `active`, or `deactivated`, which is kept rather than deleted so that
 * what they did stays theirs (ADR-0022). A deactivated person is refused on every request.
 */
export const PERSON_STATUSES = ["active", "deactivated"] as const;

export type PersonStatus = (typeof PERSON_STATUSES)[number];

/**
 * What let a person in (ADR-0022): the organization at the git host the deployment names,
 * whose members come and go with it; the Workspace domain the deployment names; or an
 * administrator, who listed their login on the People page.
 */
export const MEMBERSHIP_SOURCES = ["organization", "domain", "listed"] as const;

export type MembershipSource = (typeof MEMBERSHIP_SOURCES)[number];

/** What a person is within a project: an owner configures it, a member works on it. */
export const PROJECT_ROLES = ["owner", "member"] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Who is a member of a project: every member of the workspace, or only those listed. */
export const PROJECT_VISIBILITIES = ["workspace", "private"] as const;

export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

/**
 * Who sees whom on the People page and in the pickers (ADR-0035): everyone of the workspace,
 * or only the people one shares a project with; an administrator always sees everyone.
 */
export const PEOPLE_VISIBILITIES = ["everyone", "shared_projects"] as const;

export type PeopleVisibility = (typeof PEOPLE_VISIBILITIES)[number];

/**
 * The day the calendars begin a week on (ADR-0035): as the language of the pages has it, or
 * Monday, or Sunday, for the whole workspace.
 */
export const WEEK_STARTS = ["auto", "monday", "sunday"] as const;

export type WeekStart = (typeof WEEK_STARTS)[number];

/**
 * How a private pack's connection ended short of a token (ADR-0036): the code expired before
 * anyone approved, the person declined at the deployment, or the deployment refused the request.
 */
export const PACK_CONNECT_ENDINGS = ["expired", "declined", "refused"] as const;

export type PackConnectEnding = (typeof PACK_CONNECT_ENDINGS)[number];

/** What a run is doing: at work, waiting for a person's decision, or over in one of three ways. */
export const RUN_STATUSES = ["running", "waiting", "finished", "failed", "abandoned"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** How a run is over, as the agent says: the work is done, it could not be, or it was left. */
export const RUN_ENDINGS = ["finished", "failed", "abandoned"] as const;

export type RunEnding = (typeof RUN_ENDINGS)[number];

/** What links to a document by its path: another document, a task, or a decision. */
export const LINK_SOURCES = ["document", "task", "decision"] as const;

export type LinkSource = (typeof LINK_SOURCES)[number];

/** What a run hands in: a link to the web, or a file the console keeps. */
export const ARTIFACT_KINDS = ["link", "file"] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * What the console says of the organization's skills: that it has no address for them, or what
 * the SkillCDN deployment answered for the address.
 */
export const SKILLS_STATUSES = [
  "none",
  "ready",
  "indexing",
  "failed",
  "not_found",
  "token_invalid",
  "unavailable",
] as const;

export type SkillsStatus = (typeof SKILLS_STATUSES)[number];

/**
 * Where the rules that hold on a board come from (ADR-0023): the console's own, since the
 * organization wrote none; a page the organization or the project wrote; or none, for a
 * project that adds nothing to the workspace's.
 */
export const RULES_SOURCES = ["reference", "written", "none"] as const;

export type RulesSource = (typeof RULES_SOURCES)[number];

/**
 * What can happen to the board. Every change of state is one of these, written down once with
 * who did it: the live feed shows them as they happen, and the audit trail keeps them.
 */
export const EVENT_KINDS = [
  "person.joined",
  "person.role_changed",
  "person.listed",
  "person.unlisted",
  "person.deactivated",
  "person.reactivated",
  "person.manager_changed",
  "person.email_changed",
  "person.updated",
  "agent.state_changed",
  "team.created",
  "team.renamed",
  "team.removed",
  "team.member_added",
  "team.member_removed",
  "workspace.updated",
  "category.created",
  "category.updated",
  "category.removed",
  "project.created",
  "project.updated",
  "project.member_added",
  "project.member_changed",
  "project.member_removed",
  "goal.created",
  "goal.updated",
  "task.created",
  "task.updated",
  "task.moved",
  "task.commented",
  "task.archived",
  "task.restored",
  "decision.raised",
  "decision.answered",
  "decision.addressed",
  "decision.updated",
  "run.started",
  "run.reported",
  "run.handed_in",
  "run.taken_over",
  "run.ended",
  "document.written",
  "document.archived",
  "document.restored",
  "document.file_attached",
  "plugin.enabled",
  "plugin.disabled",
  "plugin.configured",
  "plugin.granted",
  "plugin.revoked",
  "plugin.upgraded",
  "plugin.command",
  "plugin.failed",
  "plugin.purged",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * The states of a plugin (docs/specs/plugins.md, "Lifecycle"): in the directory and loading;
 * failed to read or load; enabled by an administrator; a new version waiting for consent to
 * what it asks; disabled; the install kept while the package left the directory.
 */
export const PLUGIN_STATES = [
  "installed",
  "failed",
  "enabled",
  "needs_consent",
  "disabled",
  "orphaned",
] as const;

export type PluginState = (typeof PLUGIN_STATES)[number];

/** How a plugin's command ended, as its event records it. */
export const PLUGIN_COMMAND_OUTCOMES = ["ok", "refused", "waiting", "failed"] as const;

export type PluginCommandOutcome = (typeof PLUGIN_COMMAND_OUTCOMES)[number];
