import { durationMs, PLUGIN_JOB_MS, TIME_OF_DAY } from "@skillcdn/console/plugin";
import { sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../db/client.js";
import { type PluginJobRecord, readJobs, writeJob } from "../db/queries/plugin-board.js";
import { readWorkspaceSettings, type WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import type { CallResult } from "./protocol.js";
import type { Plugins } from "./registry.js";

// The jobs (docs/specs/plugins.md, "Events, hooks and jobs"): each on its schedule, `every` an
// ISO 8601 duration and `at` a time of day in the workspace's time zone, each under an advisory
// lock held for as long as the job runs, so that never two run at once, `plugin_jobs` keeping the
// last run, its outcome and the next time; a failed job is a line in the log every time and a
// `plugin.failed` event an hour at most.

/** How long a job's failure is told once as an event before another is written. */
const FAILURE_EVENT_EVERY_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/**
 * How long the transaction that holds a job's lock may sit idle before the server ends it, set
 * for that transaction alone in place of the pool's thirty seconds: the job's time, and a minute
 * for the host's fence behind it and the queries around it. The lock is not taken from a job
 * still running, and a process that vanished without closing its connection gives it up.
 */
const JOB_LOCK_IDLE_MS = PLUGIN_JOB_MS + 60_000;

export interface JobTarget {
  readonly key: string;
  readonly boardProjectId: string | undefined;
  readonly jobs: Readonly<Record<string, { readonly every: string; readonly at: string | null }>>;
}

export interface Scheduling {
  jobTargets(): Promise<JobTarget[]>;
  runJob(key: string, name: string): Promise<CallResult>;
  recordFailure(key: string, projectId: string | undefined, problem: string): Promise<void>;
}

export interface PluginSchedulerOptions {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly plugins: Scheduling | Plugins;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The lock of one job, from its plugin's key and its name: a stable number every process agrees
 * on, taken as one key. A plugin's dispatch lock is two keys (`dispatchLockOf`), which PostgreSQL
 * keeps apart from every lock of one, so that no job's name can be it.
 */
export function lockKeyOf(key: string, name: string): number {
  let hash = 2166136261;
  for (const char of `${key}:${name}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash | 0;
}

/** The zone's offset from UTC at an instant, in minutes; 0 for a zone the runtime does not know. */
function offsetMinutes(at: Date, zone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    const text = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /^GMT([+-])(\d{2}):?(\d{2})?$/.exec(text);
    if (match === null) {
      return 0;
    }
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
  } catch {
    return 0;
  }
}

/**
 * When a job runs next, after `from`: `from` plus `every`; or, with `at`, the next time of day in
 * the zone, stepping by whole days of `every` where it is a day or more.
 */
export function nextRunAfter(
  from: Date,
  every: string,
  at: string | null,
  zone: string,
): Date | undefined {
  const everyMs = durationMs(every);
  if (everyMs === undefined || everyMs <= 0) {
    return undefined;
  }
  if (at === null) {
    return new Date(from.getTime() + everyMs);
  }
  const match = /^(\d{2}):(\d{2})$/.exec(at);
  if (match === null) {
    return new Date(from.getTime() + everyMs);
  }
  const offset = offsetMinutes(from, zone) * 60_000;
  const local = from.getTime() + offset;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  let candidate = dayStart + Number(match[1]) * 60 * 60_000 + Number(match[2]) * 60_000;
  const step = Math.max(1, Math.round(everyMs / DAY_MS)) * DAY_MS;
  while (candidate <= local) {
    candidate += step;
  }
  // The zone's offset at the candidate itself, where a clock change lies between `from` and it,
  // so that the job runs at the time of day named and not an hour off.
  const guess = new Date(candidate - offset);
  return new Date(candidate - offsetMinutes(guess, zone) * 60_000);
}

/** The time of day an instant falls at in the zone, as `HH:MM`. */
export function timeOfDayIn(at: Date, zone: string): string {
  const offset = offsetMinutes(at, zone) * 60_000;
  const local = at.getTime() + offset;
  const minutes = Math.floor((local % DAY_MS) / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Whether a job's next time, kept when it last ran, no longer falls at its time of day in the
 * zone: the workspace's time zone was set or changed since, and the next run is computed again,
 * so that the first run after the change is not at the old zone's time.
 */
export function nextTimeMoved(nextAt: Date, at: string | null, zone: string): boolean {
  return at !== null && TIME_OF_DAY.test(at) && timeOfDayIn(nextAt, zone) !== at;
}

export class PluginScheduler {
  private readonly options: PluginSchedulerOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(options: PluginSchedulerOptions) {
    this.options = options;
  }

  /** One pass: every job that is due runs, under its lock. */
  tick(): Promise<void> {
    this.running = this.running.then(async () => {
      try {
        await this.pass();
      } catch (error) {
        this.options.logger.warn({ err: error }, "the plugins' jobs were not run");
      }
    });
    return this.running;
  }

  start(intervalMs: number): void {
    if (this.timer === undefined) {
      this.timer = setInterval(() => void this.tick(), intervalMs);
      this.timer.unref();
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private async pass(): Promise<void> {
    const targets = (await this.options.plugins.jobTargets()).filter(
      (target) => Object.keys(target.jobs).length > 0,
    );
    if (targets.length === 0) {
      return;
    }
    const { database, clock } = this.options;
    const workspace = await this.options.workspace();
    const zone = (await readWorkspaceSettings(database, workspace.id)).timeZone ?? "UTC";
    for (const target of targets) {
      const rows = await readJobs(database, workspace.id, target.key);
      for (const [name, job] of Object.entries(target.jobs)) {
        const row = rows.find((candidate) => candidate.name === name);
        const now = clock.now();
        if (row?.nextAt === undefined) {
          // Seen for the first time: its first run is one period from now, not now.
          await writeJob(database, {
            workspaceId: workspace.id,
            key: target.key,
            now,
            name,
            lastRunAt: row?.lastRunAt,
            lastOutcome: row?.lastOutcome,
            nextAt: nextRunAfter(now, job.every, job.at, zone),
            failedEventAt: row?.failedEventAt,
          });
          continue;
        }
        if (nextTimeMoved(row.nextAt, job.at, zone)) {
          // The workspace's time zone was set or changed since the next time was written: the
          // job runs next at its time of day in the zone it has now, not in the one it had.
          const moved = nextRunAfter(now, job.every, job.at, zone);
          if (moved !== undefined && moved.getTime() !== row.nextAt.getTime()) {
            await writeJob(database, {
              workspaceId: workspace.id,
              key: target.key,
              now,
              name,
              lastRunAt: row.lastRunAt,
              lastOutcome: row.lastOutcome,
              nextAt: moved,
              failedEventAt: row.failedEventAt,
            });
            continue;
          }
        }
        if (row.nextAt.getTime() > now.getTime()) {
          continue;
        }
        await this.run(workspace, target, name, job, row, zone);
      }
    }
  }

  private async run(
    workspace: WorkspaceRecord,
    target: JobTarget,
    name: string,
    job: { readonly every: string; readonly at: string | null },
    row: PluginJobRecord,
    zone: string,
  ): Promise<void> {
    const { database, clock, logger } = this.options;
    await drizzleOf(database).transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('idle_in_transaction_session_timeout', ${String(JOB_LOCK_IDLE_MS)}, true)`,
      );
      const locked = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${lockKeyOf(target.key, name)}) as locked`,
      );
      if (locked.rows[0]?.locked !== true) {
        return;
      }
      const result = await this.options.plugins.runJob(target.key, name);
      const ranAt = clock.now();
      const nextAt = nextRunAfter(ranAt, job.every, job.at, zone);
      if (result.ok) {
        logger.info({ plugin: target.key, job: name }, "plugin job ran");
        await writeJob(database, {
          workspaceId: workspace.id,
          key: target.key,
          now: ranAt,
          name,
          lastRunAt: ranAt,
          lastOutcome: "ok",
          nextAt,
          failedEventAt: row.failedEventAt,
        });
        return;
      }
      logger.warn({ plugin: target.key, job: name, code: result.error.code }, "plugin job failed");
      const eventDue =
        row.failedEventAt === undefined ||
        ranAt.getTime() - row.failedEventAt.getTime() >= FAILURE_EVENT_EVERY_MS;
      if (eventDue) {
        await this.options.plugins.recordFailure(
          target.key,
          target.boardProjectId,
          `the job ${name} failed (${result.error.code})`,
        );
      }
      await writeJob(database, {
        workspaceId: workspace.id,
        key: target.key,
        now: ranAt,
        name,
        lastRunAt: ranAt,
        lastOutcome: "failed",
        nextAt,
        failedEventAt: eventDue ? ranAt : row.failedEventAt,
      });
    });
  }
}
