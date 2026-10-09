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

/** What a person may do: an administrator configures the board, a member works on it. */
export const PERSON_ROLES = ["admin", "member"] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

/** What a run is doing: at work, waiting for a person's decision, or over in one of three ways. */
export const RUN_STATUSES = ["running", "waiting", "finished", "failed", "abandoned"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

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
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];
