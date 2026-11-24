import {
  MAX_AGENT_SESSIONS_PER_HOUR,
  MAX_AGENT_STATE_CHANGES_PER_HOUR,
  MAX_DECISIONS_PER_PROJECT,
  MAX_DOCUMENTS_PER_PROJECT,
  MAX_GOALS_PER_PROJECT,
  MAX_OWN_RESETS_PER_HOUR,
  MAX_OWN_WAKES_PER_HOUR,
  MAX_PROJECTS_PER_WORKSPACE,
  MAX_RUNNER_WAKES_PER_HOUR,
  MAX_RUNS_PER_TASK,
  MAX_STREAMS,
  MAX_STREAMS_PER_PERSON,
  MAX_TASKS_PER_PROJECT,
  MAX_TRANSCRIPT_EVENTS_PER_HOUR,
} from "@skillcdn/console/api";
import type { Context } from "hono";
import type { LiveFeed } from "./live-feed.js";

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
  /** How many streams one person holds at once, across their tabs and scripts: of the live feed, of an agent account's signals, of a session's transcript. */
  readonly streamsPerPerson: number;
  /** How many streams this process holds for everyone: each costs a query on every change. */
  readonly streams: number;
  /**
   * What an agent account's runner writes in an hour (ADR-0132): the events one session's
   * transcript takes, the sessions the account begins, the wakes its runner raises itself, and
   * the changes of its state its runner has the workspace's feed told.
   */
  readonly transcriptEventsPerHour: number;
  readonly agentSessionsPerHour: number;
  readonly runnerWakesPerHour: number;
  /** The wakes an agent account raises for itself within an hour (ADR-0145). */
  readonly ownWakesPerHour: number;
  /** The new conversations an agent account begins for itself within an hour (ADR-0154). */
  readonly ownResetsPerHour: number;
  readonly agentStateChangesPerHour: number;
  /**
   * How many bytes the files of one project hold together: those runs hand in, those put in
   * comments and on decisions, and those attached to pages, each counted by its size. `Infinity` where the
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
  transcriptEventsPerHour: MAX_TRANSCRIPT_EVENTS_PER_HOUR,
  agentSessionsPerHour: MAX_AGENT_SESSIONS_PER_HOUR,
  runnerWakesPerHour: MAX_RUNNER_WAKES_PER_HOUR,
  ownWakesPerHour: MAX_OWN_WAKES_PER_HOUR,
  ownResetsPerHour: MAX_OWN_RESETS_PER_HOUR,
  agentStateChangesPerHour: MAX_AGENT_STATE_CHANGES_PER_HOUR,
  fileBytesPerProject: Number.POSITIVE_INFINITY,
};

/**
 * The refusal of one stream more than `owner` may hold, or than the process holds for everyone:
 * a browser with a tab too many, or a script that opens streams and never closes them, is told
 * to close one or try again later. Nothing where there is room. Asked of every stream there is,
 * the feed's and an agent account's alike, so that all of them count against the one bound.
 */
export function tooManyStreams(
  c: Context,
  feed: Pick<LiveFeed, "streams" | "streamsOf">,
  quotas: Pick<Quotas, "streams" | "streamsPerPerson">,
  owner: string,
): Response | undefined {
  if (feed.streamsOf(owner) < quotas.streamsPerPerson && feed.streams < quotas.streams) {
    return undefined;
  }
  c.header("retry-after", "30");
  return c.json(
    {
      error: {
        code: "feed.too_many",
        message:
          "As many streams of the feed are open as one may hold at once. Close one, or try again later.",
      },
    },
    429,
  );
}

/**
 * The refusal of a read of a feed in a process that never saw the feed settle while a writer is
 * under way (ADR-0125): it cannot say where the feed stands, and an empty page would be taken
 * for a feed with nothing in it, whose reader then goes on from the beginning and is sent the
 * whole history. The reader asks again in a second, by when the writer has ended or another
 * process answers.
 */
export function feedUnsettled(c: Context): Response {
  c.header("retry-after", "1");
  return c.json(
    {
      error: {
        code: "feed.unsettled",
        message: "The feed cannot be read yet. Try again in a moment.",
      },
    },
    503,
  );
}

/** The quotas with what a deployment, or a test, set; a bound left out, or left undefined, keeps its default. */
export function quotasOf(given: Partial<Quotas> | undefined): Quotas {
  const set = Object.fromEntries(
    Object.entries(given ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<Quotas>;
  return { ...DEFAULT_QUOTAS, ...set };
}
