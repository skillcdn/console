import {
  DEFAULT_TOKEN_DAYS,
  EVENTS_PAGE_LIMIT,
  LIST_LIMIT,
  MAX_ARTIFACTS_PER_RUN,
  MAX_REPORTS_PER_RUN,
  REST_ROUTES,
  type RestDecisions,
  type RestEvents,
  type RestPeople,
  type RestRuns,
  type RestTasks,
  type RestTokenCreated,
  type RestTokens,
  restAnswerInputSchema,
  restArtifactInputSchema,
  restDecisionInputSchema,
  restPersonPatchSchema,
  restReportInputSchema,
  restRunEndInputSchema,
  restRunInputSchema,
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
  type DecisionRecord,
  getDecision,
  listDecisions,
  raiseDecision,
} from "../db/queries/decisions.js";
import { latestEventId, listEventsAfter } from "../db/queries/events.js";
import {
  listPeople,
  PersonError,
  type PersonRecord,
  updatePersonRole,
} from "../db/queries/people.js";
import {
  addArtifact,
  addReport,
  endRun,
  getRun,
  listRuns,
  RunError,
  startRun,
} from "../db/queries/runs.js";
import {
  createTask,
  findTaskByNumber,
  getTask,
  listTasks,
  TaskError,
  updateTask,
} from "../db/queries/tasks.js";
import { TokenError, type TokenRecord } from "../db/queries/tokens.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { errorBody } from "./app.js";
import {
  type Access,
  administratorRequired,
  foreignOrigin,
  sessionRequired,
  signInRequired,
} from "./auth.js";
import type { LiveFeed } from "./live-feed.js";
import type { AppEnv } from "./request-context.js";
import {
  restDecision,
  restEvent,
  restPerson,
  restRun,
  restTask,
  restToken,
} from "./rest-shapes.js";

export interface RestDependencies {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly access: Access;
  /** The tokens people make; left out where nobody signs in, and then nobody has one. */
  readonly tokens: Tokens | undefined;
  readonly feed: LiveFeed;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly agents: {
    /** How long a read of a decision may wait for its answer before answering that it still waits. */
    readonly waitMs: number;
  };
}

/** A task or a decision is a few fields and a body of bounded Markdown; this is far above both. */
const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A task's number in a path: what people say out loud, where the pages say the id. */
const TASK_NUMBER = /^[1-9]\d{0,8}$/;
/** The most a read of a decision may ask to wait, in seconds; the server's own bound is lower. */
const MAX_WAIT_SECONDS = 600;
const DAY_MS = 86_400_000;

const tasksQuery = z.object({ state: z.enum(TASK_STATES).optional() });
const decisionsQuery = z.object({
  open: z.enum(["true", "false"]).optional(),
  task: z.string().regex(UUID).optional(),
});
const decisionQuery = z.object({
  wait: z.coerce.number().int().min(0).max(MAX_WAIT_SECONDS).default(0),
});
const runsQuery = z.object({
  task: z.string().regex(UUID).optional(),
  open: z.enum(["true", "false"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
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

/** Who is asking, and with what: the token when one is presented. */
interface Caller {
  readonly person: PersonRecord;
  readonly token: TokenRecord | undefined;
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
  const { database, workspace, access, tokens, feed, clock, logger, agents } = dependencies;

  /** Who is asking and with what, or the refusal to answer with. */
  const askingCaller = async (c: Context<AppEnv>): Promise<Caller | Response> =>
    (await access.caller(c)) ?? signInRequired(c);

  /** The person asking, or the refusal to answer with. */
  const asking = async (c: Context<AppEnv>): Promise<PersonRecord | Response> => {
    const caller = await askingCaller(c);
    return caller instanceof Response ? caller : caller.person;
  };

  /**
   * Who is asking something that changes the board, or the refusal to answer with. A session
   * cookie travels with a browser's requests on its own, so a request on a session has to come
   * from the console's own pages; a token is attached on purpose by whoever holds it.
   */
  const changingCaller = async (c: Context<AppEnv>): Promise<Caller | Response> => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    return askingCaller(c);
  };
  const changing = async (c: Context<AppEnv>): Promise<PersonRecord | Response> => {
    const caller = await changingCaller(c);
    return caller instanceof Response ? caller : caller.person;
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

  /** What a task, a decision, a run or a person that could not be worked on answers with. */
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
    if (error instanceof PersonError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "person.not_found" ? 404 : 409,
      );
    }
    if (error instanceof RunError) {
      const status =
        error.code === "run.not_found" || error.code === "run.task_not_found"
          ? 404
          : error.code === "run.not_yours"
            ? 403
            : error.code === "run.over" ||
                error.code === "run.task_taken" ||
                error.code === "run.task_closed"
              ? 409
              : 400;
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

  const notFound = (c: Context<AppEnv>, code: string, message: string): Response =>
    c.json(errorBody(code, message), 404);
  const noSuchRun = (c: Context<AppEnv>) => notFound(c, "run.not_found", "The run was not found.");
  const noSuchDecision = (c: Context<AppEnv>) =>
    notFound(c, "decision.not_found", "The decision was not found.");

  /**
   * The decision once answered, or as it stands when `waitMs` has passed: woken by the board's
   * own nudge, so that an answer given on a page reaches whoever waits for it at once.
   */
  const waitForAnswer = async (
    workspaceId: string,
    decisionId: string,
    waitMs: number,
  ): Promise<DecisionRecord | undefined> => {
    const after = await latestEventId(database, workspaceId);
    const decision = await getDecision(database, workspaceId, decisionId);
    if (decision === undefined || decision.answer !== undefined || waitMs <= 0) {
      return decision;
    }
    const subscription = feed.subscribe(after);
    const timer = setTimeout(() => subscription.end(), waitMs);
    try {
      for await (const message of subscription) {
        if (
          message.kind === "events" &&
          message.items.some(
            (event) => event.kind === "decision.answered" && event.decisionId === decisionId,
          )
        ) {
          break;
        }
      }
    } finally {
      clearTimeout(timer);
      subscription.end();
    }
    return getDecision(database, workspaceId, decisionId);
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

  // What a person is: said by an administrator signed in on the console's own pages. An agent
  // works as its person does; configuring is a person's own doing.
  app.patch(`${REST_ROUTES.people}/:id`, tooLarge, async (c) => {
    const person = await signedInOnOwnPages(c);
    if (person instanceof Response) {
      return person;
    }
    if (person.role !== "admin") {
      return administratorRequired(c);
    }
    const patch = await bodyOf(c, restPersonPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return notFound(c, "person.not_found", "The person was not found.");
    }
    try {
      const changed = await updatePersonRole(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        personId: id,
        role: patch.role,
        now: clock.now(),
      });
      logger.info(
        {
          person: person.id,
          subject: changed.id,
          role: changed.role,
          requestId: c.get("requestId"),
        },
        "role changed",
      );
      return c.json(restPerson(changed));
    } catch (error) {
      return failure(c, error);
    }
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

  // One task, by its id or by its number: the pages hold ids, people and their agents say numbers.
  app.get(`${REST_ROUTES.tasks}/:id`, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const ref = c.req.param("id");
    const task = UUID.test(ref)
      ? await getTask(database, person.workspaceId, ref)
      : TASK_NUMBER.test(ref)
        ? await findTaskByNumber(database, person.workspaceId, Number(ref))
        : undefined;
    return task === undefined
      ? notFound(c, "task.not_found", "The task was not found.")
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
      return notFound(c, "task.not_found", "The task was not found.");
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
    const fromRun = input.runId !== undefined && input.runId !== null;
    try {
      const decision = await raiseDecision(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        decision: {
          question: input.question,
          body: input.body,
          options: input.options.map((option) => option.label),
          // Raised from a run, the decision is about the run's task and nothing else.
          taskId: fromRun ? undefined : input.taskId,
          runId: fromRun ? (input.runId ?? undefined) : undefined,
        },
        now: clock.now(),
      });
      logger.info(
        {
          person: person.id,
          decision: decision.id,
          run: decision.run?.id,
          requestId: c.get("requestId"),
        },
        "decision raised",
      );
      return c.json(restDecision(decision), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // One decision; with `wait`, the request is held while the decision waits, up to what the
  // server allows, so that an agent learns the answer without asking again and again.
  app.get(`${REST_ROUTES.decisions}/:id`, async (c) => {
    const query = decisionQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchDecision(c);
    }
    const decision = await waitForAnswer(
      person.workspaceId,
      id,
      Math.min(query.data.wait * 1000, agents.waitMs),
    );
    return decision === undefined ? noSuchDecision(c) : c.json(restDecision(decision));
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
      return noSuchDecision(c);
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
      return notFound(c, "token.not_found", "The token was not found.");
    }
    logger.info({ person: person.id, tokenId: id, requestId: c.get("requestId") }, "token removed");
    return c.body(null, 204);
  });

  // The runs: agents at work, and what they did. An agent writes them as its person, with its
  // token; a person reads them, and gives up on one that will not come back.
  app.get(REST_ROUTES.runs, async (c) => {
    const query = runsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const caller = await askingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const mine = query.data.mine === "true";
    const items = await listRuns(database, caller.person.workspaceId, {
      taskId: query.data.task,
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      // An agent's own runs are the ones begun with its token; a person's, the ones for them.
      tokenId: mine && caller.token !== undefined ? caller.token.id : undefined,
      personId: mine && caller.token === undefined ? caller.person.id : undefined,
      limit: LIST_LIMIT,
    });
    const body: RestRuns = { items: items.map(restRun) };
    return c.json(body);
  });

  app.post(REST_ROUTES.runs, tooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const input = await bodyOf(c, restRunInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const { person, token } = caller;
    try {
      const run = await startRun(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        tokenId: token?.id,
        taskId: input.taskId,
        // What people see at work: what the agent says it is, else what its person called the token.
        agent: input.agent ?? token?.name ?? person.login,
        now: clock.now(),
      });
      logger.info(
        { person: person.id, run: run.id, task: run.taskId, requestId: c.get("requestId") },
        "run started",
      );
      return c.json(restRun(run), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.runs}/:id`, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const id = c.req.param("id");
    const run = UUID.test(id) ? await getRun(database, person.workspaceId, id) : undefined;
    return run === undefined ? noSuchRun(c) : c.json(restRun(run));
  });

  app.post(`${REST_ROUTES.runs}/:id/reports`, tooLarge, async (c) => {
    const person = await changing(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restReportInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchRun(c);
    }
    try {
      const run = await addReport(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        runId: id,
        body: input.body,
        limit: MAX_REPORTS_PER_RUN,
        now: clock.now(),
      });
      return c.json(restRun(run), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${REST_ROUTES.runs}/:id/artifacts`, tooLarge, async (c) => {
    const person = await changing(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restArtifactInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchRun(c);
    }
    try {
      const run = await addArtifact(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        runId: id,
        url: input.url,
        label: input.label,
        limit: MAX_ARTIFACTS_PER_RUN,
        now: clock.now(),
      });
      return c.json(restRun(run), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${REST_ROUTES.runs}/:id/end`, tooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const input = await bodyOf(c, restRunEndInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchRun(c);
    }
    const { person, token } = caller;
    try {
      const run = await endRun(database, {
        workspaceId: person.workspaceId,
        actorId: person.id,
        runId: id,
        status: input.status,
        summary: input.summary,
        // Giving up on anyone's run is an administrator's own doing, on the console's own pages;
        // an agent, with a token, ends only the runs that are its person's.
        anyone: input.status === "abandoned" && person.role === "admin" && token === undefined,
        now: clock.now(),
      });
      logger.info(
        { person: person.id, run: run.id, status: run.status, requestId: c.get("requestId") },
        "run ended",
      );
      return c.json(restRun(run));
    } catch (error) {
      return failure(c, error);
    }
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
