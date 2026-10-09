import {
  DEFAULT_TOKEN_DAYS,
  EVENTS_PAGE_LIMIT,
  LIST_LIMIT,
  REST_ROUTES,
  type RestDecisions,
  type RestEvents,
  type RestPeople,
  type RestTasks,
  type RestTokenCreated,
  type RestTokens,
  restAnswerInputSchema,
  restDecisionInputSchema,
  restTaskInputSchema,
  restTaskPatchSchema,
  restTokenInputSchema,
  TASK_STATES,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import * as z from "zod";
import type { Tokens } from "../auth/tokens.js";
import type { Database } from "../db/client.js";
import {
  answerDecision,
  DecisionError,
  getDecision,
  listDecisions,
  raiseDecision,
} from "../db/queries/decisions.js";
import { listEventsAfter } from "../db/queries/events.js";
import { listPeople, type PersonRecord } from "../db/queries/people.js";
import { createTask, getTask, listTasks, TaskError, updateTask } from "../db/queries/tasks.js";
import { TokenError } from "../db/queries/tokens.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { errorBody } from "./app.js";
import { type Access, foreignOrigin, sessionRequired, signInRequired } from "./auth.js";
import type { LiveFeed } from "./live-feed.js";
import type { AppEnv } from "./request-context.js";
import { restDecision, restEvent, restPerson, restTask, restToken } from "./rest-shapes.js";

export interface RestDependencies {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly access: Access;
  /** The tokens people make; left out where nobody signs in, and then nobody has one. */
  readonly tokens: Tokens | undefined;
  readonly feed: LiveFeed;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** A task or a decision is a few fields and a body of bounded Markdown; this is far above both. */
const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

const tasksQuery = z.object({ state: z.enum(TASK_STATES).optional() });
const decisionsQuery = z.object({
  open: z.enum(["true", "false"]).optional(),
  task: z.string().regex(UUID).optional(),
});
const eventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(EVENTS_PAGE_LIMIT).default(EVENTS_PAGE_LIMIT),
});

interface ParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly issues: readonly { readonly path?: PropertyKey[]; readonly message: string }[];
  };
}

/** The first thing wrong with what was sent, for a person. */
function firstProblem(result: ParseResult<unknown>): string {
  const issue = result.error?.issues[0];
  if (issue === undefined) {
    return "The request is not readable.";
  }
  const path = (issue.path ?? []).map(String).join(".");
  return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}

/**
 * The REST API of the board (docs/specs/rest.md). Every route runs in the same order: parse
 * the input, ask who is asking and whether they may, then do the work. Nothing here is cached,
 * and nothing is answered to nobody.
 */
export function registerRest(app: Hono<AppEnv>, dependencies: RestDependencies): void {
  const { database, workspace, access, tokens, feed, clock, logger } = dependencies;

  /** The person asking, or the refusal to answer with. */
  const asking = async (c: Context<AppEnv>): Promise<PersonRecord | Response> =>
    (await access.person(c)) ?? signInRequired(c);

  /**
   * The person asking something that changes the board, or the refusal to answer with. A
   * session cookie travels with a browser's requests on its own, so a request on a session has
   * to come from the console's own pages; a token is attached on purpose by whoever holds it.
   */
  const changing = async (c: Context<AppEnv>): Promise<PersonRecord | Response> => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    return asking(c);
  };

  /**
   * The person signed in on the console's own pages, or the refusal to answer with: what the
   * tokens themselves are managed by. A token cannot make, list or remove tokens, so that one
   * which leaks cannot outlive its removal through tokens of its own.
   */
  const signedIn = async (c: Context<AppEnv>): Promise<PersonRecord | Response> => {
    if (access.presentsToken(c)) {
      return sessionRequired(c);
    }
    return asking(c);
  };
  const signedInOnOwnPages = async (c: Context<AppEnv>): Promise<PersonRecord | Response> => {
    if (access.presentsToken(c)) {
      return sessionRequired(c);
    }
    return changing(c);
  };

  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);

  /** What a body is, parsed once with the package's schema, or the refusal to answer with. */
  const bodyOf = async <T>(
    c: Context<AppEnv>,
    schema: { safeParse: (data: unknown) => ParseResult<T> },
  ): Promise<T | Response> => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = schema.safeParse(json);
    return parsed.success && parsed.data !== undefined
      ? parsed.data
      : invalid(c, firstProblem(parsed));
  };

  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });

  /** What a task or a decision that could not be worked on answers with. */
  const failure = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof TaskError) {
      const status = error.code === "task.not_found" ? 404 : 400;
      return c.json(errorBody(error.code, error.message), status);
    }
    if (error instanceof DecisionError) {
      const status =
        error.code === "decision.not_found" ? 404 : error.code === "decision.answered" ? 409 : 400;
      return c.json(errorBody(error.code, error.message), status);
    }
    if (error instanceof TokenError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "token.not_found" ? 404 : 409,
      );
    }
    throw error;
  };

  app.get(REST_ROUTES.people, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const body: RestPeople = {
      items: (await listPeople(database, person.workspaceId)).map(restPerson),
    };
    return c.json(body);
  });

  app.get(REST_ROUTES.tasks, async (c) => {
    const query = tasksQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const items = await listTasks(database, person.workspaceId, {
      state: query.data.state,
      limit: LIST_LIMIT,
    });
    const body: RestTasks = { items: items.map(restTask) };
    return c.json(body);
  });

  app.post(REST_ROUTES.tasks, tooLarge, async (c) => {
    const person = await changing(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restTaskInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const task = await createTask(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        task: {
          ...input,
          links: input.links?.map((link) => ({ url: link.url, label: link.label ?? null })),
        },
        now: clock.now(),
      });
      logger.info(
        { person: person.id, task: task.id, requestId: c.get("requestId") },
        "task created",
      );
      return c.json(restTask(task), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.tasks}/:id`, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const id = c.req.param("id");
    const task = UUID.test(id) ? await getTask(database, person.workspaceId, id) : undefined;
    return task === undefined
      ? c.json(errorBody("task.not_found", "The task was not found."), 404)
      : c.json(restTask(task));
  });

  app.patch(`${REST_ROUTES.tasks}/:id`, tooLarge, async (c) => {
    const person = await changing(c);
    if (person instanceof Response) {
      return person;
    }
    const patch = await bodyOf(c, restTaskPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return c.json(errorBody("task.not_found", "The task was not found."), 404);
    }
    try {
      const task = await updateTask(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        taskId: id,
        patch: {
          ...patch,
          links: patch.links?.map((link) => ({ url: link.url, label: link.label ?? null })),
        },
        now: clock.now(),
      });
      return c.json(restTask(task));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(REST_ROUTES.decisions, async (c) => {
    const query = decisionsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const items = await listDecisions(database, person.workspaceId, {
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      taskId: query.data.task,
      limit: LIST_LIMIT,
    });
    const body: RestDecisions = { items: items.map(restDecision) };
    return c.json(body);
  });

  app.post(REST_ROUTES.decisions, tooLarge, async (c) => {
    const person = await changing(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restDecisionInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const decision = await raiseDecision(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        decision: {
          question: input.question,
          body: input.body,
          options: input.options.map((option) => option.label),
          taskId: input.taskId,
        },
        now: clock.now(),
      });
      logger.info(
        { person: person.id, decision: decision.id, requestId: c.get("requestId") },
        "decision raised",
      );
      return c.json(restDecision(decision), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.decisions}/:id`, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const id = c.req.param("id");
    const decision = UUID.test(id)
      ? await getDecision(database, person.workspaceId, id)
      : undefined;
    return decision === undefined
      ? c.json(errorBody("decision.not_found", "The decision was not found."), 404)
      : c.json(restDecision(decision));
  });

  app.post(`${REST_ROUTES.decisions}/:id/answer`, tooLarge, async (c) => {
    const person = await changing(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restAnswerInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return c.json(errorBody("decision.not_found", "The decision was not found."), 404);
    }
    try {
      const decision = await answerDecision(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        decisionId: id,
        option: input.option,
        note: input.note,
        now: clock.now(),
      });
      logger.info(
        { person: person.id, decision: decision.id, requestId: c.get("requestId") },
        "decision answered",
      );
      return c.json(restDecision(decision));
    } catch (error) {
      return failure(c, error);
    }
  });

  // The tokens of whoever is signed in: made and removed on the console's own pages only.
  app.get(REST_ROUTES.tokens, async (c) => {
    const person = await signedIn(c);
    if (person instanceof Response) {
      return person;
    }
    if (tokens === undefined) {
      return signInRequired(c);
    }
    const body: RestTokens = { items: (await tokens.list(person)).map(restToken) };
    return c.json(body);
  });

  app.post(REST_ROUTES.tokens, tooLarge, async (c) => {
    const person = await signedInOnOwnPages(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restTokenInputSchema);
    if (input instanceof Response) {
      return input;
    }
    if (tokens === undefined) {
      return signInRequired(c);
    }
    try {
      const made = await tokens.issue(person, {
        name: input.name,
        ttlMs: (input.expiresInDays ?? DEFAULT_TOKEN_DAYS) * DAY_MS,
      });
      // The id and the name, never the secret.
      logger.info(
        { person: person.id, tokenId: made.token.id, requestId: c.get("requestId") },
        "token made",
      );
      const body: RestTokenCreated = { token: restToken(made.token), secret: made.secret };
      return c.json(body, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${REST_ROUTES.tokens}/:id`, async (c) => {
    const person = await signedInOnOwnPages(c);
    if (person instanceof Response) {
      return person;
    }
    const id = c.req.param("id");
    if (tokens === undefined || !UUID.test(id) || !(await tokens.revoke(person, id))) {
      return c.json(errorBody("token.not_found", "The token was not found."), 404);
    }
    logger.info({ person: person.id, tokenId: id, requestId: c.get("requestId") }, "token removed");
    return c.body(null, 204);
  });

  app.get(REST_ROUTES.events, async (c) => {
    const query = eventsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const page = await listEventsAfter(
      database,
      person.workspaceId,
      query.data.after,
      query.data.limit,
    );
    const body: RestEvents = { items: page.items.map(restEvent), more: page.more };
    return c.json(body);
  });

  // The feed as it happens: one event per message, numbered, so that a browser that reconnects
  // says where it was (`Last-Event-ID`) and misses nothing. Heartbeats are comments.
  app.get(`${REST_ROUTES.events}/stream`, async (c) => {
    const query = eventsQuery.safeParse({ after: c.req.query("after") ?? "0" });
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const lastSeen = Number(c.req.header("last-event-id"));
    const after =
      Number.isInteger(lastSeen) && lastSeen >= 0
        ? Math.max(lastSeen, query.data.after)
        : query.data.after;
    await workspace();
    const subscription = feed.subscribe(after);
    // A proxy that buffers would hold the events back; this header asks it not to.
    c.header("x-accel-buffering", "no");
    return streamSSE(
      c,
      async (stream) => {
        stream.onAbort(() => subscription.end());
        for await (const message of subscription) {
          if (message.kind === "heartbeat") {
            await stream.write(": ping\n\n");
            continue;
          }
          for (const event of message.items) {
            await stream.writeSSE({
              id: String(event.id),
              event: event.kind,
              data: JSON.stringify(restEvent(event)),
            });
          }
        }
      },
      async (error) => {
        subscription.end();
        logger.warn({ err: error, requestId: c.get("requestId") }, "the feed stream failed");
      },
    );
  });
}
