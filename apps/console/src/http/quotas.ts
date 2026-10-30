import {
  MAX_DECISIONS_PER_PROJECT,
  MAX_DOCUMENTS_PER_PROJECT,
  MAX_GOALS_PER_PROJECT,
  MAX_PROJECTS_PER_WORKSPACE,
  MAX_RUNS_PER_TASK,
  MAX_STREAMS,
  MAX_STREAMS_PER_PERSON,
  MAX_TASKS_PER_PROJECT,
} from "@skillcdn/console/api";

// How much of the board a workspace, a project, a task or a person holds at once: the bounds
// the package publishes, which the server holds and the command's help says. Each count is of
// rows, those put away included, since nothing put away is deleted; a bound a runaway script
// meets, not real work. The tests narrow them to a few. The bytes of a project's files are the
// one bound the deployment sets itself, since what they cost is the deployment's to know.

export interface Quotas {
  readonly projectsPerWorkspace: number;
  readonly tasksPerProject: number;
  readonly goalsPerProject: number;
  readonly decisionsPerProject: number;
  readonly documentsPerProject: number;
  readonly runsPerTask: number;
  /** How many streams of the live feed one person holds at once, across their tabs and scripts. */
  readonly streamsPerPerson: number;
  /** How many streams this process holds for everyone: each costs a query on every change. */
  readonly streams: number;
  /**
   * How many bytes the files of one project hold together: those runs hand in, those put in
   * comments and those attached to pages, each counted by its size. `Infinity` where the
   * deployment set no bound, which is the default.
   */
  readonly fileBytesPerProject: number;
}

export const DEFAULT_QUOTAS: Quotas = {
  projectsPerWorkspace: MAX_PROJECTS_PER_WORKSPACE,
  tasksPerProject: MAX_TASKS_PER_PROJECT,
  goalsPerProject: MAX_GOALS_PER_PROJECT,
  decisionsPerProject: MAX_DECISIONS_PER_PROJECT,
  documentsPerProject: MAX_DOCUMENTS_PER_PROJECT,
  runsPerTask: MAX_RUNS_PER_TASK,
  streamsPerPerson: MAX_STREAMS_PER_PERSON,
  streams: MAX_STREAMS,
  fileBytesPerProject: Number.POSITIVE_INFINITY,
};

/** The quotas with what a deployment, or a test, set; a bound left out, or left undefined, keeps its default. */
export function quotasOf(given: Partial<Quotas> | undefined): Quotas {
  const set = Object.fromEntries(
    Object.entries(given ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<Quotas>;
  return { ...DEFAULT_QUOTAS, ...set };
}
