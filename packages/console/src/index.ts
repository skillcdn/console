// What a custom console is built from (docs/architecture.md, "The package and custom consoles"):
// the schemas and the client of the console's API, the components, and the composition of the
// default console. None of it exists yet; the milestones of docs/roadmap.md bring each layer. The
// vocabulary below is the one the schema, the API and the UI will be named after.

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

/** What a run is doing: at work, waiting for a person's decision, or over in one of three ways. */
export const RUN_STATUSES = ["running", "waiting", "finished", "failed", "abandoned"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
