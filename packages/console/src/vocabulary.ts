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

/** How much a task matters next to the others, in rising order. */
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The identity providers people may sign in through: the git host, and Google (Workspace). */
export const PROVIDER_KEYS = ["gh", "google"] as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export function isProviderKey(value: string | null | undefined): value is ProviderKey {
  return (PROVIDER_KEYS as readonly string[]).includes(value ?? "");
}

/** What a person may do: an administrator configures the board, a member works on it. */
export const PERSON_ROLES = ["admin", "member"] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

/** What a run is doing: at work, waiting for a person's decision, or over in one of three ways. */
export const RUN_STATUSES = ["running", "waiting", "finished", "failed", "abandoned"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** How a run is over, as the agent says: the work is done, it could not be, or it was left. */
export const RUN_ENDINGS = ["finished", "failed", "abandoned"] as const;

export type RunEnding = (typeof RUN_ENDINGS)[number];

/**
 * What can happen to the board. Every change of state is one of these, written down once with
 * who did it: the live feed shows them as they happen, and the audit trail keeps them.
 */
export const EVENT_KINDS = [
  "person.joined",
  "person.role_changed",
  "task.created",
  "task.updated",
  "task.moved",
  "decision.raised",
  "decision.answered",
  "run.started",
  "run.reported",
  "run.handed_in",
  "run.ended",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];
