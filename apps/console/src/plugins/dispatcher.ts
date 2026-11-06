import type { PluginHookEvent } from "@skillcdn/console/plugin";
import { PLUGIN_HOOK_RETRIES } from "@skillcdn/console/plugin";
import { sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../db/client.js";
import { type EventRecord, latestEventId, listAllEventsAfter } from "../db/queries/events.js";
import {
  beginCursor,
  findProjectByKey,
  latestPluginEventId,
  listPluginEventsAfter,
  type PluginCursor,
  type PluginEventRecord,
  pluginsOfItems,
  readCursor,
  writeCursor,
} from "../db/queries/plugin-board.js";
import { findProjectBrief } from "../db/queries/plugins.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import type { CallResult } from "./protocol.js";
import type { Plugins } from "./registry.js";

// The hooks (docs/specs/plugins.md, "Events, hooks and jobs"): the console's events and the
// plugins' events, read from a cursor per plugin under one advisory lock, so that one process
// dispatches, and delivered to the handler that named each kind. A console event reaches a plugin
// for its board projects, the projects it is on, and the items it made. Delivery is at least once:
// a handler that fails is tried again with backoff, five times, then the event is skipped with a
// `plugin.failed` event. Runs in the worker role, or in the api role when it carries the worker.

/** The one lock the dispatcher holds for a pass: every process shares the number. */
const DISPATCH_LOCK_KEY = 5_434_003;
/** How many events of each stream one pass reads for one plugin. */
const BATCH = 100;

/** A plugin as the dispatcher delivers to it. */
export interface DispatchTarget {
  readonly key: string;
  /** The hooks the plugin defines: `console:<kind>` and `plugin:<key>:<kind>`. */
  readonly hooks: readonly string[];
  readonly consent: readonly string[];
  readonly boardProjectId: string | undefined;
  /** The projects the plugin is on: all, or their keys. */
  readonly projects: "all" | readonly string[];
}

/** What the dispatcher asks of the registry: who listens, and the delivery itself. */
export interface Dispatching {
  hookTargets(): Promise<DispatchTarget[]>;
  runHook(key: string, name: string, event: PluginHookEvent): Promise<CallResult>;
  recordFailure(key: string, projectId: string | undefined, problem: string): Promise<void>;
}

export interface PluginDispatcherOptions {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly plugins: Dispatching | Plugins;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How many times a handler is tried before the event is skipped; the package's bound when left out. */
  readonly retries?: number | undefined;
  /** How long to wait before the next try, by the number of tries so far; doubling seconds when left out. */
  readonly backoffMs?: ((attempts: number) => number) | undefined;
}

const defaultBackoff = (attempts: number): number => 2 ** Math.min(attempts, 8) * 1000;

export class PluginDispatcher {
  private readonly options: PluginDispatcherOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(options: PluginDispatcherOptions) {
    this.options = options;
  }

  /** One pass: every plugin with hooks is brought up to date with both streams, as far as its handlers allow. */
  dispatch(): Promise<void> {
    this.running = this.running.then(async () => {
      try {
        await this.pass();
      } catch (error) {
        this.options.logger.warn({ err: error }, "the plugins' hooks were not dispatched");
      }
    });
    return this.running;
  }

  start(intervalMs: number): void {
    if (this.timer === undefined) {
      this.timer = setInterval(() => void this.dispatch(), intervalMs);
      this.timer.unref();
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private async pass(): Promise<void> {
    const targets = (await this.options.plugins.hookTargets()).filter(
      (target) => target.hooks.length > 0,
    );
    if (targets.length === 0) {
      return;
    }
    const workspace = await this.options.workspace();
    await drizzleOf(this.options.database).transaction(async (tx) => {
      // One dispatcher at a time: whoever does not get the lock leaves the pass to the one who has it.
      const locked = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${DISPATCH_LOCK_KEY}) as locked`,
      );
      if (locked.rows[0]?.locked !== true) {
        return;
      }
      for (const target of targets) {
        try {
          await this.deliverTo(workspace, target);
        } catch (error) {
          this.options.logger.warn(
            { err: error, plugin: target.key },
            "a plugin's hooks were not delivered to",
          );
        }
      }
    });
  }

  private async deliverTo(workspace: WorkspaceRecord, target: DispatchTarget): Promise<void> {
    const { database, clock } = this.options;
    const now = clock.now();
    let cursor = await readCursor(database, workspace.id, target.key);
    if (cursor === undefined) {
      // A plugin that was never told of anything begins at the end of the streams: it is not
      // told of everything that ever happened.
      await beginCursor(database, {
        workspaceId: workspace.id,
        key: target.key,
        consoleAfter: await latestEventId(database, workspace.id),
        pluginAfter: await latestPluginEventId(database, workspace.id),
        now,
      });
      return;
    }
    if (cursor.nextAttemptAt !== undefined && cursor.nextAttemptAt.getTime() > now.getTime()) {
      return;
    }
    const projectIds = await this.projectIdsOf(workspace, target);
    if (
      target.consent.includes("events:console") &&
      target.hooks.some((h) => h.startsWith("console:"))
    ) {
      const events = await listAllEventsAfter(database, workspace.id, cursor.consoleAfter, BATCH);
      for (const event of events) {
        const hook = `console:${event.kind}`;
        const wanted =
          target.hooks.includes(hook) &&
          (await this.concerns(workspace, target, projectIds, event));
        const outcome = wanted
          ? await this.deliver(
              workspace,
              target,
              cursor,
              hook,
              await this.payloadOf(workspace, target, event, hook),
              event.projectId,
              `event ${event.id}`,
            )
          : "delivered";
        if (outcome === "waiting") {
          return;
        }
        cursor = { ...cursor, consoleAfter: event.id, attempts: 0, nextAttemptAt: undefined };
        await writeCursor(database, {
          workspaceId: workspace.id,
          key: target.key,
          now: clock.now(),
          ...cursor,
        });
      }
    }
    if (
      target.consent.includes("events:plugins") &&
      target.hooks.some((h) => h.startsWith("plugin:"))
    ) {
      const events = await listPluginEventsAfter(database, workspace.id, cursor.pluginAfter, BATCH);
      for (const event of events) {
        const hook = `plugin:${event.plugin}:${event.kind}`;
        const outcome = target.hooks.includes(hook)
          ? await this.deliver(
              workspace,
              target,
              cursor,
              hook,
              this.pluginPayloadOf(event, hook),
              target.boardProjectId,
              `plugin event ${event.id}`,
            )
          : "delivered";
        if (outcome === "waiting") {
          return;
        }
        cursor = { ...cursor, pluginAfter: event.id, attempts: 0, nextAttemptAt: undefined };
        await writeCursor(database, {
          workspaceId: workspace.id,
          key: target.key,
          now: clock.now(),
          ...cursor,
        });
      }
    }
  }

  /**
   * One delivery, with its retries: delivered, or skipped after the last try with a `plugin.failed`
   * event, both of which move the cursor on; or waiting for the next try, which leaves it.
   */
  private async deliver(
    workspace: WorkspaceRecord,
    target: DispatchTarget,
    cursor: PluginCursor,
    hook: string,
    payload: PluginHookEvent,
    projectId: string | undefined,
    what: string,
  ): Promise<"delivered" | "waiting"> {
    const { database, clock, logger } = this.options;
    const retries = this.options.retries ?? PLUGIN_HOOK_RETRIES;
    const result = await this.options.plugins.runHook(target.key, hook, payload);
    if (result.ok) {
      return "delivered";
    }
    const attempts = cursor.attempts + 1;
    logger.warn(
      { plugin: target.key, hook, what, attempts, code: result.error.code },
      "a plugin's hook failed",
    );
    if (attempts >= retries) {
      await this.options.plugins.recordFailure(
        target.key,
        projectId,
        `the hook ${hook} failed ${attempts} times on ${what} (${result.error.code}); the event was skipped`,
      );
      return "delivered";
    }
    const now = clock.now();
    await writeCursor(database, {
      workspaceId: workspace.id,
      key: target.key,
      now,
      ...cursor,
      attempts,
      nextAttemptAt: new Date(now.getTime() + (this.options.backoffMs ?? defaultBackoff)(attempts)),
    });
    return "waiting";
  }

  /** The ids of the projects the plugin is on, by key, read once a pass. */
  private async projectIdsOf(
    workspace: WorkspaceRecord,
    target: DispatchTarget,
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    if (target.boardProjectId !== undefined) {
      ids.add(target.boardProjectId);
    }
    if (target.projects !== "all") {
      for (const key of target.projects) {
        const project = await findProjectByKey(this.options.database, workspace.id, key);
        if (project !== undefined) {
          ids.add(project.id);
        }
      }
    }
    return ids;
  }

  /** Whether a console event concerns the plugin: caused by it, in one of its projects, or about an item it made. */
  private async concerns(
    workspace: WorkspaceRecord,
    target: DispatchTarget,
    projectIds: Set<string>,
    event: EventRecord,
  ): Promise<boolean> {
    if (event.plugin === target.key) {
      return true;
    }
    if (
      event.projectId !== undefined &&
      (target.projects === "all" || projectIds.has(event.projectId))
    ) {
      return true;
    }
    const items = [
      ...(event.taskId === undefined ? [] : [{ kind: "task" as const, id: event.taskId }]),
      ...(event.decisionId === undefined
        ? []
        : [{ kind: "decision" as const, id: event.decisionId }]),
      ...(event.documentId === undefined
        ? []
        : [{ kind: "document" as const, id: event.documentId }]),
    ];
    if (items.length === 0) {
      return false;
    }
    return (await pluginsOfItems(this.options.database, workspace.id, items)).has(target.key);
  }

  /**
   * A console event as a hook receives it: the kind, the ids and the time; the content with
   * `board:read`; and the answer to the plugin's own decision with `board:decisions`.
   */
  private async payloadOf(
    workspace: WorkspaceRecord,
    target: DispatchTarget,
    event: EventRecord,
    hook: string,
  ): Promise<PluginHookEvent> {
    const ids = {
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      ...(event.decisionId === undefined ? {} : { decisionId: event.decisionId }),
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.documentId === undefined ? {} : { documentId: event.documentId }),
      ...(event.goalId === undefined ? {} : { goalId: event.goalId }),
    };
    const content = target.consent.includes("board:read")
      ? {
          ...event.data,
          actor:
            event.actor === undefined
              ? null
              : { id: event.actor.id, login: event.actor.login, name: event.actor.name ?? null },
          agent: event.agent ?? null,
        }
      : {};
    // The answer to a decision the plugin raised is its own to read (`board:decisions`): the
    // chosen option's label and key, without `board:read` and without a second call.
    const own =
      event.kind === "decision.answered" &&
      event.decisionId !== undefined &&
      !target.consent.includes("board:read") &&
      target.consent.includes("board:decisions") &&
      (
        await pluginsOfItems(this.options.database, workspace.id, [
          { kind: "decision", id: event.decisionId },
        ])
      ).has(target.key);
    const answer = ownAnswerOf(target.consent, event.kind, event.data, own);
    const project =
      event.projectId === undefined
        ? undefined
        : await findProjectBrief(this.options.database, workspace.id, event.projectId);
    return {
      source: "console",
      kind: hook,
      at: event.createdAt.toISOString(),
      plugin: event.plugin ?? null,
      project: project === undefined ? null : { id: project.id, key: project.key },
      data: { ...ids, ...content, ...answer },
    };
  }

  private pluginPayloadOf(event: PluginEventRecord, hook: string): PluginHookEvent {
    return {
      source: "plugin",
      kind: hook,
      at: event.createdAt.toISOString(),
      plugin: event.plugin,
      project: null,
      data: event.data,
    };
  }
}

/**
 * What a hook is told of the answer to the plugin's own decision: the chosen option's label and
 * its key, with `board:decisions`, since the answers to its own decisions are the plugin's to
 * read; nothing for another's decision, another kind of event, or without the capability.
 */
export function ownAnswerOf(
  consent: readonly string[],
  kind: string,
  data: { readonly option?: string | undefined; readonly optionKey?: string | undefined },
  own: boolean,
): { readonly option?: string; readonly optionKey?: string } {
  if (!own || kind !== "decision.answered" || !consent.includes("board:decisions")) {
    return {};
  }
  return {
    ...(data.option === undefined ? {} : { option: data.option }),
    ...(data.optionKey === undefined ? {} : { optionKey: data.optionKey }),
  };
}
