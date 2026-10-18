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
export const PROVIDER_KEYS = ["gh", "google"] as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export function isProviderKey(value: string | null | undefined): value is ProviderKey {
  return (PROVIDER_KEYS as readonly string[]).includes(value ?? "");
}

/** What a person may do: an administrator configures the board, a member works on it. */
export const PERSON_ROLES = ["admin", "member"] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

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
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];
