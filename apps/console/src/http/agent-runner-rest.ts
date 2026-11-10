// The routes between the console and an agent account's runner (docs/specs/runner.md;
// ADR-0085): the heartbeat, the signals a supervisor sends and the record of them, and the
// stream the runner receives them on. What a runner sends is untrusted data, parsed by schema,
// bounded, and stored as data.

import {
  MAX_SIGNALS_PAGE_LIMIT,
  REST_ROUTES,
  type RestRunnerHeartbeat,
  type RestSignal,
  type RestSignals,
  restRunnerHeartbeatInputSchema,
  restSignalInputSchema,
  SIGNALS_PAGE_LIMIT,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { Database } from "../db/client.js";
import {
  findRunner,
  listSignals,
  listSignalsAfter,
  recordHeartbeat,
  type SignalRecord,
  sendSignal,
} from "../db/queries/agent-runners.js";
import type { Actor } from "../db/queries/events.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { createAgentGuards } from "./agent-guards.js";
import { errorBody } from "./app.js";
import type { Access, AccessCaller } from "./auth.js";
import type { AgentWakes } from "./live-feed.js";
import type { AppEnv } from "./request-context.js";
import { restPerson } from "./rest-shapes.js";

export interface AgentRunnerRestDependencies {
  readonly database: Database;
  readonly access: Access;
  /** Whoever waits in this process for something new of an agent account. */
  readonly wakes: AgentWakes;
  readonly clock: Clock;
  readonly logger: Logger;
}

const MAX_BODY_BYTES = 64 * 1024;
/** How many signals one look of a stream sends before it looks again. */
const STREAM_PAGE = 100;

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
  attachments: [],
  at: signal.at.toISOString(),
});

/** Who a signal is sent by: the member, and the agent they act as when with a token. */
const actorOf = (caller: AccessCaller): Actor =>
  caller.token === undefined
    ? { id: caller.person.id }
    : { id: caller.person.id, agent: caller.token.name };

export function registerAgentRunnerRest(
  app: Hono<AppEnv>,
  dependencies: AgentRunnerRestDependencies,
): void {
  const { database, access, wakes, clock, logger } = dependencies;
  const OWN = `${REST_ROUTES.agents}/me`;

  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
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
    const page = {
      before: before === undefined ? undefined : Number(before),
      limit: limit === undefined ? SIGNALS_PAGE_LIMIT : Number(limit),
    };
    return (page.before !== undefined && (!Number.isSafeInteger(page.before) || page.before < 1)) ||
      !Number.isInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > MAX_SIGNALS_PAGE_LIMIT
      ? undefined
      : page;
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
      now: clock.now(),
    });
    const body: RestRunnerHeartbeat = {
      latest: runner.latest,
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
    const asked = Number(c.req.query("after") ?? "0");
    const lastSeen = Number(c.req.header("last-event-id"));
    if (!Number.isSafeInteger(asked) || asked < 0) {
      return invalid(c, "after: the number of a signal, or 0.");
    }
    let cursor = Number.isSafeInteger(lastSeen) && lastSeen > asked ? lastSeen : asked;
    const accountId = caller.person.id;
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
          wakes.nudge(accountId);
        });
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
      },
      async (error) => {
        logger.warn({ err: error, requestId: c.get("requestId") }, "a signals stream failed");
      },
    );
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
    const listed = await listSignals(database, caller.person.id, page);
    const body: RestSignals = { items: listed.items.map(restSignal), more: listed.more };
    return c.json(body);
  });

  // A supervisor sends a signal: a tell, an interruption, a stop, a start, the model and the
  // effort, a wake. In their own name, on the account's record.
  app.post(`${REST_ROUTES.agents}/:handle/signals`, tooLarge, async (c) => {
    const found = await supervising(c, true);
    if (found instanceof Response) {
      return found;
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = restSignalInputSchema.safeParse(json);
    if (!parsed.success) {
      return invalid(c, problemOf(parsed.error.issues));
    }
    const input = parsed.data;
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
    const signal = await sendSignal(database, {
      account: found.agent,
      kind: input.kind,
      by: actorOf(found.caller),
      source: "person",
      key: undefined,
      text: (input.text ?? "").trim(),
      set: input.kind === "set" ? input.set : undefined,
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

  app.get(`${REST_ROUTES.agents}/:handle/signals`, async (c) => {
    const found = await supervising(c, false);
    if (found instanceof Response) {
      return found;
    }
    const page = pageOf(c);
    if (page === undefined) {
      return invalid(c, `before: a signal's number; limit: from 1 to ${MAX_SIGNALS_PAGE_LIMIT}.`);
    }
    const listed = await listSignals(database, found.agent.id, page);
    const body: RestSignals = { items: listed.items.map(restSignal), more: listed.more };
    return c.json(body);
  });
}
