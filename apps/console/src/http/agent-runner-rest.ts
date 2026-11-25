// The routes between the console and an agent account's runner (docs/specs/runner.md;
// ADR-0085): the heartbeat, the signals a supervisor sends and the record of them, and the
// stream the runner receives them on. What a runner sends is untrusted data, parsed by schema,
// bounded, and stored as data.

import {
  MAX_FILE_BYTES,
  MAX_OWN_WAKE_DAYS,
  MAX_OWN_WAKES,
  MAX_SIGNAL_ATTACHMENTS,
  MAX_SIGNALS_PAGE_LIMIT,
  OWN_WAKE_KEY,
  REST_ROUTES,
  type RestOwnWake,
  type RestOwnWakeRaised,
  type RestOwnWakes,
  type RestRunnerHeartbeat,
  type RestSignal,
  type RestSignals,
  type RestWriters,
  restFileInputSchema,
  restOwnResetInputSchema,
  restOwnWakeInputSchema,
  restRunnerHeartbeatInputSchema,
  restRunnerWakeSchema,
  restSignalInputSchema,
  restWritersInputSchema,
  SIGNALS_PAGE_LIMIT,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { Database } from "../db/client.js";
import {
  findRunner,
  findSignalFile,
  listSignals,
  listSignalsAfter,
  RunnerError,
  recordHeartbeat,
  type SignalRecord,
  StoppedError,
  sendSignal,
} from "../db/queries/agent-runners.js";
import {
  cancelOwnWake,
  keepOwnWake,
  listOwnWakes,
  OwnWakeError,
  type OwnWakeRecord,
} from "../db/queries/agent-wakes.js";
import type { Actor } from "../db/queries/events.js";
import { writersFor } from "../db/queries/messenger-accounts.js";
import { readWorkspaceSettings } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Plugins } from "../plugins/registry.js";
import type { BlobStore } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import { createAgentGuards } from "./agent-guards.js";
import { errorBody } from "./app.js";
import { type Access, type AccessCaller, foreignOrigin } from "./auth.js";
import {
  downloadResponse,
  type KeptPictureType,
  keptTypeOf,
  pictureResponse,
} from "./kept-pictures.js";
import type { LiveFeed } from "./live-feed.js";
import { type Quotas, tooManyStreams } from "./quotas.js";
import type { AppEnv } from "./request-context.js";
import { restPerson } from "./rest-shapes.js";

export interface AgentRunnerRestDependencies {
  readonly database: Database;
  readonly access: Access;
  /** Where the files sent with a tell are kept, among the board's files. */
  readonly blobs: BlobStore;
  /** The streams of this process: whoever waits for something new of an agent account, and how many streams a person holds. */
  readonly feed: LiveFeed;
  readonly quotas: Quotas;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The plugins, for which of them are here to have said whose account at a messenger is whose. */
  readonly plugins: Pick<Plugins, "loaded">;
}

const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The kinds of picture a signal carries, as they were read off the bytes when it was sent: shown in place, where any other file is handed over to save. */
const PICTURE_TYPES: ReadonlyMap<string, KeptPictureType> = new Map([
  ["image/png", "image/png"],
  ["image/jpeg", "image/jpeg"],
  ["image/gif", "image/gif"],
  ["image/webp", "image/webp"],
]);
/** How many signals one look of a stream sends before it looks again. */
const STREAM_PAGE = 100;
/** The largest number a signal has: what the column that keeps it takes. */
const MAX_NUMBER = 2_147_483_647;
/** A number of a record as a query or a path names one: whole, and no larger than any is. */
const numberOf = (value: string | undefined): number | undefined => {
  const number = Number(value);
  return value !== undefined && /^[0-9]+$/.test(value) && number <= MAX_NUMBER ? number : undefined;
};

export const restSignal = (signal: SignalRecord): RestSignal => ({
  number: signal.number,
  kind: signal.kind,
  by: signal.by === undefined ? null : restPerson(signal.by),
  agent: signal.agent ?? null,
  plugin: signal.plugin ?? null,
  source: signal.source,
  key: signal.key ?? null,
  text: signal.text,
  set: signal.set ?? null,
  attachments: signal.attachments.map((file) => ({
    id: file.id,
    name: file.name,
    size: file.size,
    contentType: file.contentType,
  })),
  at: signal.at.toISOString(),
});

/** A wake kept for later as the API answers it. */
const restOwnWake = (wake: OwnWakeRecord): RestOwnWake => ({
  key: wake.key,
  at: wake.at.toISOString(),
  text: wake.text,
  createdAt: wake.createdAt.toISOString(),
});

const DAY_MS = 24 * 60 * 60_000;

/** Who a signal is sent by: the member, and the agent they act as when with a token. */
const actorOf = (caller: AccessCaller): Actor =>
  caller.token === undefined
    ? { id: caller.person.id }
    : { id: caller.person.id, agent: caller.token.name };

export function registerAgentRunnerRest(
  app: Hono<AppEnv>,
  dependencies: AgentRunnerRestDependencies,
): void {
  const { database, access, blobs, feed, quotas, clock, logger, plugins } = dependencies;
  const wakes = feed.agents;
  const OWN = `${REST_ROUTES.agents}/me`;

  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  /** A signal with pictures is a form: as large as its pictures may be together, and what wraps them. */
  const formTooLarge = bodyLimit({
    maxSize: MAX_FILE_BYTES + MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);
  const problemOf = (
    issues: readonly { readonly path?: PropertyKey[]; readonly message: string }[],
  ): string => {
    const issue = issues[0];
    if (issue === undefined) {
      return "The request is not readable.";
    }
    const path = (issue.path ?? []).map(String).join(".");
    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  };
  /** A page of a record: from before a number on, a bounded number of lines; or nothing for what does not read. */
  const pageOf = (
    c: Context<AppEnv>,
  ): { readonly before: number | undefined; readonly limit: number } | undefined => {
    const before = c.req.query("before");
    const limit = c.req.query("limit");
    // A number past what any signal has is no number of one: refused here, not by the database.
    const page = {
      before: before === undefined ? undefined : (numberOf(before) ?? 0),
      limit: limit === undefined ? SIGNALS_PAGE_LIMIT : (numberOf(limit) ?? 0),
    };
    return (page.before !== undefined && page.before < 1) ||
      page.limit < 1 ||
      page.limit > MAX_SIGNALS_PAGE_LIMIT
      ? undefined
      : page;
  };
  /**
   * A page of an account's record, with how far the record is delivered (ADR-0131): the number
   * its runner last said, so that whoever reads the record tells a signal the product took from
   * one that waits, signal by signal, where the account's line says only how many.
   */
  const recordOf = async (
    accountId: string,
    page: { readonly before: number | undefined; readonly limit: number },
  ): Promise<RestSignals> => {
    const listed = await listSignals(database, accountId, page);
    const runner = await findRunner(database, accountId);
    return {
      items: listed.items.map(restSignal),
      more: listed.more,
      delivered: runner?.delivered ?? 0,
    };
  };

  const { running, own, supervising } = createAgentGuards(database, access);

  // The heartbeat: how the agent stands, what its runner is, and where the record stands.
  app.put(`${OWN}/runner`, tooLarge, async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restRunnerHeartbeatInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const runner = await recordHeartbeat(database, {
      account: caller.person,
      heartbeat: parsed.data,
      changesPerHour: quotas.agentStateChangesPerHour,
      now: clock.now(),
    });
    const body: RestRunnerHeartbeat = {
      latest: runner.latest,
      delivered: runner.delivered,
      settings: { model: runner.model ?? null, effort: runner.effort ?? null },
      state: runner.state ?? parsed.data.state,
    };
    return c.json(body);
  });

  // The runner's stream of signals, from the number after `after` on, in order.
  app.get(`${OWN}/signals/stream`, async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    const asked = numberOf(c.req.query("after") ?? "0");
    const lastSeen = numberOf(c.req.header("last-event-id"));
    if (asked === undefined) {
      return invalid(c, "after: the number of a signal, or 0.");
    }
    let cursor = lastSeen !== undefined && lastSeen > asked ? lastSeen : asked;
    const accountId = caller.person.id;
    // Counted with the streams the account holds, as a stream of the feed is: a runner holds one.
    const refused = tooManyStreams(c, feed, quotas, accountId);
    if (refused !== undefined) {
      return refused;
    }
    const release = feed.hold(accountId);
    /** Whether the stream is still the account's command's: asked again before every delivery, since a stream outlives the request that opened it. */
    const stillRuns = async (): Promise<boolean> => {
      try {
        const again = await running(c);
        return !(again instanceof Response) && again.person.id === accountId;
      } catch {
        return false;
      }
    };
    c.header("x-accel-buffering", "no");
    return streamSSE(
      c,
      async (stream) => {
        let open = true;
        stream.onAbort(() => {
          open = false;
          release();
          wakes.nudge(accountId);
        });
        try {
          while (open && !wakes.closed) {
            // Taken before the look, so that a signal sent while looking wakes the wait after it.
            const mark = wakes.mark;
            if (!(await stillRuns())) {
              break;
            }
            const signals = await listSignalsAfter(database, accountId, cursor, STREAM_PAGE);
            for (const signal of signals) {
              cursor = signal.number;
              await stream.writeSSE({
                id: String(signal.number),
                event: "signal",
                data: JSON.stringify(restSignal(signal)),
              });
            }
            if (signals.length === STREAM_PAGE) {
              continue;
            }
            const how = await wakes.wait(accountId, mark);
            if (how === "timeout" && open) {
              await stream.write(": ping\n\n");
            }
          }
        } finally {
          release();
        }
      },
      async (error) => {
        release();
        logger.warn({ err: error, requestId: c.get("requestId") }, "a signals stream failed");
      },
    );
  });

  // A wake the runner raises itself (ADR-0085), from a wake source on its machine: a messenger
  // said something to its agent. It is recorded as any signal is, by nobody, and comes back to
  // the runner on its stream in order. A wake alone, and from the messenger alone: a runner
  // tells its own agent nothing in a supervisor's name, the board's or the console's.
  app.post(`${OWN}/signals`, tooLarge, async (c) => {
    const caller = await running(c);
    if (caller instanceof Response) {
      return caller;
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restRunnerWakeSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    let sent: SignalRecord;
    try {
      sent = await sendSignal(database, {
        account: caller.person,
        kind: "wake",
        by: undefined,
        source: "messenger",
        key: parsed.data.key,
        text: parsed.data.text ?? "",
        set: undefined,
        perHour: quotas.runnerWakesPerHour,
        now: clock.now(),
      });
    } catch (error) {
      if (error instanceof RunnerError) {
        // The hour's bound on what a runner raises itself (ADR-0132): said with when it has room.
        c.header("retry-after", String(error.retryAfter));
        return c.json(
          errorBody(
            "signal.too_many",
            "The account's runner raised as many wakes within the hour as it may. What is raised later is taken.",
          ),
          429,
        );
      }
      throw error;
    }
    return c.json(restSignal(sent), 201);
  });

  // Who wrote at a messenger, for the account that asks (ADR-0164): of each account there, the
  // member it is, as a plugin that holds `people:accounts` said it, and whether that member
  // supervises the account. Asked by the account itself, of nobody's supervisors but its own;
  // it reads the login of whoever the account may see or has in its line, and changes nothing.
  app.post(`${OWN}/writers`, tooLarge, async (c) => {
    const caller = await own(c);
    if (caller instanceof Response) {
      return caller;
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restWritersInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const found = await writersFor(
      database,
      caller.person,
      await readWorkspaceSettings(database, caller.person.workspaceId),
      plugins.loaded(),
      parsed.data.messenger,
      parsed.data.accounts,
    );
    const answer: RestWriters = {
      items: found.map((one) => ({
        workspace: one.workspace,
        account: one.account,
        told: one.told,
        member:
          one.member === undefined
            ? null
            : {
                login: one.member.seen ? one.member.person.login : null,
                kind: one.member.person.kind,
                supervisor: one.member.supervisor,
                administrator: one.member.administrator,
                line: one.member.line ?? null,
              },
      })),
    };
    return c.json(answer);
  });

  // The account's own record of what it was told.
  app.get(`${OWN}/signals`, async (c) => {
    const caller = await own(c);
    if (caller instanceof Response) {
      return caller;
    }
    const page = pageOf(c);
    if (page === undefined) {
      return invalid(c, `before: a signal's number; limit: from 1 to ${MAX_SIGNALS_PAGE_LIMIT}.`);
    }
    return c.json(await recordOf(caller.person.id, page));
  });

  // A wake the account raises for itself (ADR-0145), signed in as itself: now, as a signal of its
  // record sent by the account, so many within an hour; or kept for a moment to come, one under
  // a name, which the worker raises then. A wake and nothing else: what tells, stops or starts
  // an agent is its supervisors' to send.
  app.post(`${OWN}/wakes`, tooLarge, async (c) => {
    // A browser's session changes something from the console's own pages alone, as everywhere.
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await own(c);
    if (caller instanceof Response) {
      return caller;
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restOwnWakeInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const now = clock.now();
    const text = parsed.data.text ?? "";
    if (parsed.data.at === undefined) {
      try {
        const sent = await sendSignal(database, {
          account: caller.person,
          kind: "wake",
          by: actorOf(caller),
          source: "person",
          key: parsed.data.key,
          text,
          set: undefined,
          perHour: quotas.ownWakesPerHour,
          now,
        });
        const body: RestOwnWakeRaised = { signal: { number: sent.number }, kept: null };
        return c.json(body, 201);
      } catch (error) {
        if (error instanceof RunnerError) {
          c.header("retry-after", String(error.retryAfter));
          return c.json(
            errorBody(
              "signal.too_many",
              "The account raised as many wakes for itself within the hour as it may. What is raised later is taken.",
            ),
            429,
          );
        }
        throw error;
      }
    }
    const at = new Date(parsed.data.at);
    if (
      !(at.getTime() > now.getTime()) ||
      at.getTime() > now.getTime() + MAX_OWN_WAKE_DAYS * DAY_MS
    ) {
      return invalid(c, `at: a moment to come, within ${MAX_OWN_WAKE_DAYS} days.`);
    }
    try {
      const kept = await keepOwnWake(database, {
        account: caller.person,
        key: parsed.data.key ?? OWN_WAKE_KEY,
        at,
        text,
        agent: actorOf(caller).agent,
        most: MAX_OWN_WAKES,
        now,
      });
      const body: RestOwnWakeRaised = { signal: null, kept: restOwnWake(kept) };
      return c.json(body, 201);
    } catch (error) {
      if (error instanceof OwnWakeError) {
        return c.json(
          errorBody(
            "wake.too_many",
            `An account keeps at most ${MAX_OWN_WAKES} wakes for later. Take one away first.`,
          ),
          409,
        );
      }
      throw error;
    }
  });

  // A new conversation the account begins for itself (ADR-0154), signed in as itself: a reset
  // of its record, sent by the account with why, which its runner takes when the turn under
  // way is over. So many within an hour, and nothing of how the agent stands changes by it:
  // while a supervisor's stop stands it is refused, and it takes no stop away.
  app.post(`${OWN}/reset`, tooLarge, async (c) => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await own(c);
    if (caller instanceof Response) {
      return caller;
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restOwnResetInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    let sent: SignalRecord;
    try {
      sent = await sendSignal(database, {
        account: caller.person,
        kind: "reset",
        by: actorOf(caller),
        source: "person",
        key: undefined,
        text: parsed.data.text.trim(),
        set: undefined,
        own: true,
        perHour: quotas.ownResetsPerHour,
        now: clock.now(),
      });
    } catch (error) {
      if (error instanceof StoppedError) {
        return c.json(
          errorBody(
            "agent.stopped",
            "A supervisor stopped the agent: it begins no conversation for itself until a supervisor starts it again.",
          ),
          409,
        );
      }
      if (error instanceof RunnerError) {
        c.header("retry-after", String(error.retryAfter));
        return c.json(
          errorBody(
            "signal.too_many",
            "The account began as many conversations for itself within the hour as it may. One asked for later is taken.",
          ),
          429,
        );
      }
      throw error;
    }
    wakes.nudge(caller.person.id);
    logger.info(
      { agent: caller.person.id, signal: sent.number, requestId: c.get("requestId") },
      "an account began a conversation anew for itself",
    );
    return c.json(restSignal(sent), 201);
  });

  /** The wakes an account keeps for later, the soonest first. */
  const wakesOf = async (accountId: string): Promise<RestOwnWakes> => ({
    items: (await listOwnWakes(database, accountId)).map(restOwnWake),
  });

  app.get(`${OWN}/wakes`, async (c) => {
    const caller = await own(c);
    return caller instanceof Response ? caller : c.json(await wakesOf(caller.person.id));
  });

  app.delete(`${OWN}/wakes/:key`, async (c) => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await own(c);
    if (caller instanceof Response) {
      return caller;
    }
    if (!(await cancelOwnWake(database, caller.person.id, c.req.param("key")))) {
      return c.json(errorBody("wake.not_found", "The account keeps no wake of that name."), 404);
    }
    return c.json(await wakesOf(caller.person.id));
  });

  // What an account keeps for later is read by its supervisors too, beside its record.
  app.get(`${REST_ROUTES.agents}/:handle/wakes`, async (c) => {
    const found = await supervising(c, false);
    return found instanceof Response ? found : c.json(await wakesOf(found.agent.id));
  });

  /**
   * The files of a form, kept among the board's files: a few, of any kind, within the bound on
   * a file together. A picture is one by its bytes; what is called one and is none is kept as
   * bytes of no kind. What they were kept as, or the refusal.
   */
  const filesOf = async (
    c: Context<AppEnv>,
    form: FormData,
  ): Promise<
    | {
        readonly name: string;
        readonly size: number;
        readonly contentType: string;
        readonly sha256: string;
      }[]
    | Response
  > => {
    const parts = form.getAll("file");
    if (parts.length > MAX_SIGNAL_ATTACHMENTS) {
      return invalid(c, `file: at most ${MAX_SIGNAL_ATTACHMENTS} files with one signal.`);
    }
    const read: { name: string; contentType: string; bytes: Uint8Array }[] = [];
    let total = 0;
    for (const part of parts) {
      if (!(part instanceof File)) {
        return invalid(c, "file: every part called file is a file.");
      }
      const declared = part.type.split(";")[0]?.trim() ?? "";
      const named = restFileInputSchema.safeParse({
        name: part.name,
        ...(declared.length === 0 ? {} : { contentType: declared }),
      });
      if (!named.success || named.data === undefined) {
        return invalid(c, problemOf(named.success ? [] : named.error.issues));
      }
      total += part.size;
      if (part.size === 0 || total > MAX_FILE_BYTES) {
        return part.size === 0
          ? invalid(c, `file: ${named.data.name} is empty.`)
          : c.json(errorBody("request.too_large", "The files are too large together."), 413);
      }
      const bytes = new Uint8Array(await part.arrayBuffer());
      // A picture is read off its bytes, whatever the form called it.
      read.push({
        name: named.data.name,
        contentType: keptTypeOf(bytes, named.data.contentType),
        bytes,
      });
    }
    const kept = [];
    for (const file of read) {
      const stored = await blobs.put(file.bytes, clock.now());
      kept.push({
        name: file.name,
        size: stored.size,
        contentType: file.contentType,
        sha256: stored.sha256,
      });
    }
    return kept;
  };

  // A supervisor sends a signal: a tell, an interruption, a stop, a start, the model and the
  // effort, a wake. In their own name, on the account's record. As JSON, or as a form where a
  // tell or an interruption carries files: the part `signal` with what the JSON would say,
  // and a part `file` for each file.
  app.post(`${REST_ROUTES.agents}/:handle/signals`, formTooLarge, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    let json: unknown;
    let form: FormData | undefined;
    try {
      if ((c.req.header("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
        form = await c.req.formData();
        const part = form.get("signal");
        json = typeof part === "string" && part.length <= MAX_BODY_BYTES ? JSON.parse(part) : null;
      } else {
        const raw = await c.req.text();
        if (raw.length > MAX_BODY_BYTES) {
          return c.json(errorBody("request.too_large", "The request body is too large."), 413);
        }
        json = JSON.parse(raw);
      }
    } catch {
      return invalid(c, "The request body is not readable.");
    }
    const parsed = restSignalInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const input = parsed.data;
    const carries = form !== undefined && form.getAll("file").length > 0;
    if (carries && input.kind !== "tell" && input.kind !== "interrupt") {
      return invalid(c, "file: files go with a tell or an interrupt.");
    }
    if (input.kind === "set" && input.set !== undefined) {
      // A model or an effort is one of those the runner last offered, where it offered any.
      const offers = (await findRunner(database, found.agent.id))?.offers;
      const unknown = (chosen: string | null | undefined, offered: string[] | undefined) =>
        typeof chosen === "string" &&
        offered !== undefined &&
        offered.length > 0 &&
        !offered.includes(chosen);
      if (unknown(input.set.model, offers?.models) || unknown(input.set.effort, offers?.efforts)) {
        return c.json(
          errorBody(
            "signal.not_offered",
            "The model or the effort is none of those the agent's product offers.",
          ),
          400,
        );
      }
    }
    const files = form === undefined || !carries ? [] : await filesOf(c, form);
    if (files instanceof Response) {
      return files;
    }
    const signal = await sendSignal(database, {
      account: found.agent,
      kind: input.kind,
      by: actorOf(found.caller),
      source: "person",
      key: undefined,
      text: (input.text ?? "").trim(),
      set: input.kind === "set" ? input.set : undefined,
      files,
      now: clock.now(),
    });
    // In this process at once; in the others through the database's own channel.
    wakes.nudge(found.agent.id);
    logger.info(
      {
        person: found.caller.person.id,
        agent: found.agent.id,
        signal: signal.number,
        kind: signal.kind,
        requestId: c.get("requestId"),
      },
      "a signal was sent",
    );
    return c.json(restSignal(signal), 201);
  });

  /**
   * A file sent with a signal of an account, as its bytes: a picture shown in place, any other
   * handed over to save; nothing for one that is not that signal's.
   */
  const fileOf = async (c: Context<AppEnv>, accountId: string): Promise<Response> => {
    const number = numberOf(c.req.param("number"));
    const fileId = c.req.param("file") ?? "";
    const file =
      number !== undefined && number > 0 && UUID.test(fileId)
        ? await findSignalFile(database, accountId, number, fileId)
        : undefined;
    const bytes = file === undefined ? undefined : await blobs.get(file.sha256);
    if (file === undefined || bytes === undefined) {
      return c.json(errorBody("file.not_found", "The file was not found."), 404);
    }
    const picture = PICTURE_TYPES.get(file.contentType);
    return picture === undefined
      ? downloadResponse(c, file.name, bytes)
      : pictureResponse(c, picture, bytes);
  };

  // The files of a signal: for the account, whose runner hands them to the product, and for
  // its supervisors, who sent them.
  app.get(`${OWN}/signals/:number/files/:file`, async (c) => {
    const caller = await own(c);
    return caller instanceof Response ? caller : fileOf(c, caller.person.id);
  });

  app.get(`${REST_ROUTES.agents}/:handle/signals/:number/files/:file`, async (c) => {
    const found = await supervising(c, false);
    return found instanceof Response ? found : fileOf(c, found.agent.id);
  });

  app.get(`${REST_ROUTES.agents}/:handle/signals`, async (c) => {
    const found = await supervising(c, false);
    if (found instanceof Response) {
      return found;
    }
    const page = pageOf(c);
    if (page === undefined) {
      return invalid(c, `before: a signal's number; limit: from 1 to ${MAX_SIGNALS_PAGE_LIMIT}.`);
    }
    return c.json(await recordOf(found.agent.id, page));
  });
}
