import { AUTH_ROUTES, REST_ROUTES, restPath } from "./routes.js";
import {
  type RestAnswerInput,
  type RestArtifactInput,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisions,
  type RestEvents,
  type RestMe,
  type RestPeople,
  type RestPerson,
  type RestPersonPatch,
  type RestReportInput,
  type RestRun,
  type RestRunEndInput,
  type RestRunInput,
  type RestRuns,
  type RestTask,
  type RestTaskInput,
  type RestTaskPatch,
  type RestTasks,
  type RestTokenCreated,
  type RestTokenInput,
  type RestTokens,
  restDecisionSchema,
  restDecisionsSchema,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restPeopleSchema,
  restPersonSchema,
  restRunSchema,
  restRunsSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
  restTokensSchema,
} from "./schemas.js";
import type { TaskState } from "./vocabulary.js";

// The client of the console's REST API: what the default console and a custom one talk to the
// server with, and what the command line, a script or a console of a person's own talks to it
// with, holding a token of theirs. It takes a `fetch` and a base URL and reads nothing else;
// every answer is parsed with the schemas the server is tested against.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** The origin of the console, without a path. Empty: the origin of the page. */
  readonly baseUrl?: string;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike;
  /**
   * A token a person made, for an agent, a script or a console of their own: sent as
   * `Authorization: Bearer`, and the browser's cookies left out. Left out, the session cookie of
   * the page's own origin is what the console answers to.
   */
  readonly token?: string;
}

export class ApiError extends Error {
  /** HTTP status, or 0 when there was no response at all. */
  readonly status: number;
  /** The stable code from the error body, `network` or `invalid_response`. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface Schema<T> {
  readonly safeParse: (data: unknown) => { success: true; data: T } | { success: false };
}

export interface ConsoleClient {
  me(signal?: AbortSignal): Promise<RestMe>;
  people(signal?: AbortSignal): Promise<RestPeople>;
  /** Changes what a person is; for an administrator. */
  updatePerson(id: string, patch: RestPersonPatch): Promise<RestPerson>;
  tasks(filter?: { readonly state?: TaskState }, signal?: AbortSignal): Promise<RestTasks>;
  /** One task, by its id or by its number. */
  task(ref: string, signal?: AbortSignal): Promise<RestTask>;
  createTask(input: RestTaskInput): Promise<RestTask>;
  updateTask(id: string, patch: RestTaskPatch): Promise<RestTask>;
  /** The decisions, or only those that wait, or only those about one task. */
  decisions(
    filter?: { readonly open?: boolean; readonly task?: string },
    signal?: AbortSignal,
  ): Promise<RestDecisions>;
  decision(id: string, signal?: AbortSignal): Promise<RestDecision>;
  /**
   * One decision, after waiting up to `waitSeconds` for its answer: the server holds the request
   * while the decision waits, for as long as it allows, and answers the decision as it stands.
   */
  awaitDecision(id: string, waitSeconds: number, signal?: AbortSignal): Promise<RestDecision>;
  raiseDecision(input: RestDecisionInput): Promise<RestDecision>;
  answerDecision(id: string, input: RestAnswerInput): Promise<RestDecision>;
  /** The runs, newest first; or only those on one task, only the open ones, only the asker's own. */
  runs(
    filter?: { readonly task?: string; readonly open?: boolean; readonly mine?: boolean },
    signal?: AbortSignal,
  ): Promise<RestRuns>;
  run(id: string, signal?: AbortSignal): Promise<RestRun>;
  /** Takes a task: a run begins, for the person the asker is or acts for. */
  startRun(input: RestRunInput): Promise<RestRun>;
  /** Says how the work goes, on a run of the asker's. */
  report(runId: string, input: RestReportInput): Promise<RestRun>;
  /** Hands in a link, on a run of the asker's. */
  handIn(runId: string, input: RestArtifactInput): Promise<RestRun>;
  /** Ends a run: finished or failed by the agent; abandoned by the person it is for, or an administrator. */
  endRun(runId: string, input: RestRunEndInput): Promise<RestRun>;
  /** What happened after event number `after`; `0` for the beginning. */
  events(after: number, signal?: AbortSignal): Promise<RestEvents>;
  /** Where an `EventSource` subscribes to what happens after event number `after`. */
  eventStreamUrl(after: number): string;
  /** The tokens of whoever asks. */
  tokens(signal?: AbortSignal): Promise<RestTokens>;
  /** Makes a token; the answer carries the secret, this once. */
  createToken(input: RestTokenInput): Promise<RestTokenCreated>;
  /** Takes a token away, whoever holds it. */
  revokeToken(id: string): Promise<void>;
  /** Ends the session on this browser. */
  signOut(): Promise<void>;
}

const INVALID = "The server answered unexpectedly.";

export function createClient(options: ClientOptions = {}): ConsoleClient {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const { token } = options;

  const withQuery = (path: string, params: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) {
        query.set(name, value);
      }
    }
    return query.size === 0 ? `${base}${path}` : `${base}${path}?${query}`;
  };

  /** What a response says when it is not what was asked for. */
  const failure = async (response: Response): Promise<ApiError> => {
    const parsed = restErrorSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(response.status, "invalid_response", INVALID);
  };

  const request = async <T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    body: unknown,
    schema: Schema<T> | undefined,
    signal?: AbortSignal,
  ): Promise<T> => {
    let response: Response;
    try {
      response = await send(url, {
        method,
        ...(signal === undefined ? {} : { signal }),
        // Same origin, so the session cookie goes with it; the browser names the origin of a
        // request that changes something, which the server checks. With a token, the token is
        // the credential and no cookie travels.
        credentials: token === undefined ? "same-origin" : "omit",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (signal?.aborted === true) {
        throw error;
      }
      throw new ApiError(0, "network", "The server could not be reached.");
    }
    if (!response.ok) {
      throw await failure(response);
    }
    if (schema === undefined) {
      return undefined as T;
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ApiError(response.status, "invalid_response", INVALID);
    }
    return parsed.data;
  };

  const flag = (value: boolean | undefined): string | undefined =>
    value === undefined ? undefined : String(value);

  return {
    me: (signal) => request("GET", `${base}${REST_ROUTES.me}`, undefined, restMeSchema, signal),
    people: (signal) =>
      request("GET", `${base}${REST_ROUTES.people}`, undefined, restPeopleSchema, signal),
    updatePerson: (id, patch) =>
      request("PATCH", `${base}${restPath("people", id)}`, patch, restPersonSchema),
    tasks: (filter = {}, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.tasks, { state: filter.state }),
        undefined,
        restTasksSchema,
        signal,
      ),
    task: (ref, signal) =>
      request("GET", `${base}${restPath("tasks", ref)}`, undefined, restTaskSchema, signal),
    createTask: (input) => request("POST", `${base}${REST_ROUTES.tasks}`, input, restTaskSchema),
    updateTask: (id, patch) =>
      request("PATCH", `${base}${restPath("tasks", id)}`, patch, restTaskSchema),
    decisions: (filter = {}, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.decisions, { open: flag(filter.open), task: filter.task }),
        undefined,
        restDecisionsSchema,
        signal,
      ),
    decision: (id, signal) =>
      request("GET", `${base}${restPath("decisions", id)}`, undefined, restDecisionSchema, signal),
    awaitDecision: (id, waitSeconds, signal) =>
      request(
        "GET",
        withQuery(restPath("decisions", id), { wait: String(waitSeconds) }),
        undefined,
        restDecisionSchema,
        signal,
      ),
    raiseDecision: (input) =>
      request("POST", `${base}${REST_ROUTES.decisions}`, input, restDecisionSchema),
    answerDecision: (id, input) =>
      request("POST", `${base}${restPath("decisions", id)}/answer`, input, restDecisionSchema),
    runs: (filter = {}, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.runs, {
          task: filter.task,
          open: flag(filter.open),
          mine: flag(filter.mine),
        }),
        undefined,
        restRunsSchema,
        signal,
      ),
    run: (id, signal) =>
      request("GET", `${base}${restPath("runs", id)}`, undefined, restRunSchema, signal),
    startRun: (input) => request("POST", `${base}${REST_ROUTES.runs}`, input, restRunSchema),
    report: (runId, input) =>
      request("POST", `${base}${restPath("runs", runId)}/reports`, input, restRunSchema),
    handIn: (runId, input) =>
      request("POST", `${base}${restPath("runs", runId)}/artifacts`, input, restRunSchema),
    endRun: (runId, input) =>
      request("POST", `${base}${restPath("runs", runId)}/end`, input, restRunSchema),
    events: (after, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.events, { after: String(after) }),
        undefined,
        restEventsSchema,
        signal,
      ),
    eventStreamUrl: (after) => withQuery(`${REST_ROUTES.events}/stream`, { after: String(after) }),
    tokens: (signal) =>
      request("GET", `${base}${REST_ROUTES.tokens}`, undefined, restTokensSchema, signal),
    createToken: (input) =>
      request("POST", `${base}${REST_ROUTES.tokens}`, input, restTokenCreatedSchema),
    revokeToken: (id) =>
      request("DELETE", `${base}${restPath("tokens", id)}`, undefined, undefined),
    signOut: () => request("POST", `${base}${AUTH_ROUTES.logout}`, undefined, undefined),
  };
}
