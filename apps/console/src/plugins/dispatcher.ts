import type { PluginHookEvent } from "@skillcdn/console/plugin";
import { PLUGIN_HOOK_MS, PLUGIN_HOOK_RETRIES } from "@skillcdn/console/plugin";
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
import { lockKeyOf } from "./scheduler.js";

// The hooks (docs/specs/plugins.md, "Events, hooks and jobs"): the console's events and the
// plugins' events, read from a cursor per plugin, each plugin under an advisory lock of its own,
// held for as long as its delivery takes, so that one process dispatches to a plugin at a time;
// a few plugins at once, so that a slow or failing plugin holds up few others and the pool keeps
// room for everything else; delivered to the handler that named each kind. A console event
// reaches a plugin for its board projects, the projects it is on, and the items it made. Delivery
// is at least once: a handler that fails is tried again with backoff, five times, then the event
// is skipped with a `plugin.failed` event. Runs in the worker role, or in the api role when it
// carries the worker.

/** How many events of each stream one pass reads for one plugin. */
const BATCH = 100;
/** How long one pass spends on one plugin before leaving the rest of its events to the next pass. */
const PLUGIN_PASS_MS = 20_000;
/**
 * How long the transaction that holds a plugin's lock may sit idle before the server ends it, set
 * for that transaction alone in place of the pool's thirty seconds: the pass's time on the plugin,
 * the hook begun just before it ran out, and a minute for the host's fence behind the hook and the
 * queries around it. The lock is not taken from a pass still delivering, and a process that
 * vanished without closing its connection gives it up within two minutes.
 */
const LOCK_IDLE_MS = PLUGIN_PASS_MS + PLUGIN_HOOK_MS + 60_000;
/** The most plugins one process delivers to at once, however large its pool. */
const LANES_AT_MOST = 4;
/**
 * The first of the two keys of a plugin's dispatch lock, "hook" in ASCII: PostgreSQL keeps the
 * locks taken with two keys apart from those taken with one, as a job's is.
 */
const DISPATCH_LOCK_SPACE = 0x686f6f6b;
/** The longest a hook may ask the next try to wait, by `retryAfterMs` on its refusal. */
const RETRY_AFTER_MS_AT_MOST = 60 * 60_000;

/**
 * How many plugins one process delivers to at once: a quarter of its pool's connections, at least
 * one and at most four. Each holds a connection for its lock and takes another for its queries, and
 * its hook's calls on `ctx` take more of the same pool, which the API shares where the process
 * carries the worker; every plugin with hooks at once took the whole pool, and every pass then
 * waited out the pool's timeout.
 */
export function lanesFor(connections: number): number {
  return Math.max(1, Math.min(LANES_AT_MOST, Math.floor(connections / 4)));
}

/**
 * The lock one plugin's delivery is under, as two keys: the dispatcher's space and the plugin's.
 * A job's lock is one key (`lockKeyOf`), and PostgreSQL keeps the two kinds apart, so that a job,
 * whatever it is called, never holds up its plugin's hooks, nor they it.
 */
export function dispatchLockOf(key: string): readonly [number, number] {
  return [DISPATCH_LOCK_SPACE, lockKeyOf(key, "dispatch")];
}

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
  /** How many plugins a pass delivers to at once, from the pool it has (`lanesFor`). */
  private readonly lanes: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(options: PluginDispatcherOptions) {
    this.options = options;
    this.lanes = lanesFor(options.database.maxConnections);
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
    // Each plugin under a lock of its own, a few side by side: a plugin whose hook calls a slow
    // service, or waits out its backoff, holds up no plugin in another lane, and two processes
    // may dispatch to two plugins at once, never to one.
    const waiting = [...targets];
    const lane = async (): Promise<void> => {
      for (let target = waiting.shift(); target !== undefined; target = waiting.shift()) {
        await this.dispatchTo(workspace, target);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.lanes, waiting.length) }, lane));
  }

  /**
   * One plugin's delivery under its lock, taken by a transaction that the server lets idle for as
   * long as the delivery may take, and given up with it. A plugin another process holds is that
   * process's to deliver to this time.
   */
  private async dispatchTo(workspace: WorkspaceRecord, target: DispatchTarget): Promise<void> {
    const [space, key] = dispatchLockOf(target.key);
    try {
      await drizzleOf(this.options.database).transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('idle_in_transaction_session_timeout', ${String(LOCK_IDLE_MS)}, true)`,
        );
        const locked = await tx.execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock(${space}, ${key}) as locked`,
        );
        if (locked.rows[0]?.locked !== true) {
          return;
        }
        await this.deliverTo(workspace, target);
      });
    } catch (error) {
      this.options.logger.warn(
        { err: error, plugin: target.key },
        "a plugin's hooks were not delivered to",
      );
    }
  }

  private async deliverTo(workspace: WorkspaceRecord, target: DispatchTarget): Promise<void> {
    const { database, clock } = this.options;
    const now = clock.now();
    // The pass leaves this plugin to the next one once it has had its time, so that a plugin with
    // a long tail of slow hooks does not keep the pass, and the others, from coming round.
    const began = performance.now();
    const outOfTime = () => performance.now() - began > PLUGIN_PASS_MS;
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
              await this.payloadOf(workspace, target, event, hook, cursor.attempts + 1),
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
        if (outOfTime()) {
          return;
        }
      }
    } else {
      cursor = await this.keptUp(workspace, target, cursor, {
        consoleAfter: await latestEventId(database, workspace.id),
      });
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
              this.pluginPayloadOf(event, hook, cursor.attempts + 1),
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
        if (outOfTime()) {
          return;
        }
      }
    } else {
      await this.keptUp(workspace, target, cursor, {
        pluginAfter: await latestPluginEventId(database, workspace.id),
      });
    }
  }

  /**
   * A stream the plugin does not hold, or has no hook on: what passes there is not its to hear of
   * later, so that the cursor keeps up, and turning it on begins from then on.
   */
  private async keptUp(
    workspace: WorkspaceRecord,
    target: DispatchTarget,
    cursor: PluginCursor,
    latest: Pick<Partial<PluginCursor>, "consoleAfter" | "pluginAfter">,
  ): Promise<PluginCursor> {
    const next = { ...cursor, ...latest };
    if (next.consoleAfter !== cursor.consoleAfter || next.pluginAfter !== cursor.pluginAfter) {
      await writeCursor(this.options.database, {
        workspaceId: workspace.id,
        key: target.key,
        now: this.options.clock.now(),
        ...next,
      });
    }
    return next;
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
    // A hook that was told to come back later by the service it called says so with
    // `retryAfterMs` on its refusal, and the next try waits that long instead of the backoff.
    const waitMs =
      retryAfterOf(result.error) ?? (this.options.backoffMs ?? defaultBackoff)(attempts);
    await writeCursor(database, {
      workspaceId: workspace.id,
      key: target.key,
      now,
      ...cursor,
      attempts,
      nextAttemptAt: new Date(now.getTime() + waitMs),
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

  /**
   * Whether a console event concerns the plugin: caused by it, in one of its projects, or about
   * an item it made; or one of the workspace's people events, for a plugin that reads the
   * directory (`people:read:all`), so that it learns who came and went as it happens.
   */
  private async concerns(
    workspace: WorkspaceRecord,
    target: DispatchTarget,
    projectIds: Set<string>,
    event: EventRecord,
  ): Promise<boolean> {
    if (event.plugin === target.key) {
      return true;
    }
    // A plugin hears when one it may call is enabled, disabled or upgraded (ADR-0072).
    const lifecycle = lifecycleOf(event);
    if (lifecycle !== undefined && target.consent.includes(`plugins:${lifecycle}`)) {
      return true;
    }
    if (isPeopleEvent(event.kind) && target.consent.includes("people:read:all")) {
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
   * A console event as a hook receives it: its id and which delivery this is, the kind, the ids
   * and the time; the content with `board:read`; and the answer to the plugin's own decision with
   * `board:decisions`.
   */
  private async payloadOf(
    workspace: WorkspaceRecord,
    target: DispatchTarget,
    event: EventRecord,
    hook: string,
    attempt: number,
  ): Promise<PluginHookEvent> {
    const ids = {
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      ...(event.decisionId === undefined ? {} : { decisionId: event.decisionId }),
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.documentId === undefined ? {} : { documentId: event.documentId }),
      ...(event.goalId === undefined ? {} : { goalId: event.goalId }),
    };
    const lifecycle = lifecycleOf(event);
    const content =
      contentFor(target.consent, event.kind) ||
      (lifecycle !== undefined && target.consent.includes(`plugins:${lifecycle}`))
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
      id: hookEventId("console", event.id),
      attempt,
      kind: hook,
      at: event.createdAt.toISOString(),
      plugin: event.plugin ?? null,
      project: project === undefined ? null : { id: project.id, key: project.key },
      data: { ...ids, ...content, ...answer },
    };
  }

  private pluginPayloadOf(
    event: PluginEventRecord,
    hook: string,
    attempt: number,
  ): PluginHookEvent {
    return {
      source: "plugin",
      id: hookEventId("plugin", event.id),
      attempt,
      kind: hook,
      at: event.createdAt.toISOString(),
      plugin: event.plugin,
      project: null,
      data: event.data,
    };
  }
}

/**
 * How long a failed hook asked the next try to wait, from `retryAfterMs` in the data of its
 * refusal (`throw new PluginError("rate_limited", message, { retryAfterMs })`), within an hour;
 * nothing where it said nothing, and the backoff holds.
 */
export function retryAfterOf(error: { readonly data?: unknown }): number | undefined {
  const data = error.data;
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const after = (data as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof after !== "number" || !Number.isFinite(after) || after <= 0) {
    return undefined;
  }
  return Math.min(Math.ceil(after), RETRY_AFTER_MS_AT_MOST);
}

/**
 * The id a hook reads an event by: the stream and the event's number in it, so that one id
 * names one event across the console's events and the plugins', and a hook that keeps the ids it
 * acted on passes over a delivery repeated.
 */
export function hookEventId(source: "console" | "plugin", number: number): string {
  return `${source}:${number}`;
}

/** Whether an event is one of the workspace's people events: someone joined, left, came back, changed role, or was listed. */
/** The plugin kinds a plugin with `plugins:<key>` hears of (ADR-0072). */
const LIFECYCLE_KINDS: readonly string[] = ["plugin.enabled", "plugin.disabled", "plugin.upgraded"];

/**
 * The plugin a lifecycle event is about, by key, or none: `plugin.enabled`, `plugin.disabled` and
 * `plugin.upgraded` reach the hooks of a plugin that holds `plugins:<key>` for it, with their
 * content, so that it follows what it depends on without a capability on the other's board.
 */
export function lifecycleOf(event: {
  readonly kind: string;
  readonly data: { readonly key?: string | undefined };
}): string | undefined {
  return LIFECYCLE_KINDS.includes(event.kind) && typeof event.data.key === "string"
    ? event.data.key
    : undefined;
}

export function isPeopleEvent(kind: string): boolean {
  return kind.startsWith("person.") || kind.startsWith("team.");
}

/**
 * Whether a hook receives the event's content and its actor: with `board:read`; or, for a
 * people event, with `people:read:all`, since the directory is the plugin's to read anyway.
 */
export function contentFor(consent: readonly string[], kind: string): boolean {
  return (
    consent.includes("board:read") || (isPeopleEvent(kind) && consent.includes("people:read:all"))
  );
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
