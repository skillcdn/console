import { AUTH_ROUTES, REST_ROUTES, restPath } from "./routes.js";
import {
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisions,
  type RestEvents,
  type RestMe,
  type RestPeople,
  type RestTask,
  type RestTaskInput,
  type RestTaskPatch,
  type RestTasks,
  restDecisionSchema,
  restDecisionsSchema,
  restErrorSchema,
  restEventsSchema,
  restMeSchema,
  restPeopleSchema,
  restTaskSchema,
  restTasksSchema,
} from "./schemas.js";
import type { TaskState } from "./vocabulary.js";

// The client of the console's REST API: what the default console and a custom one talk to the
// server with. It takes a `fetch` and a base URL and reads nothing else; every answer is parsed
// with the schemas the server is tested against.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** The origin of the console, without a path. Empty: the origin of the page. */
  readonly baseUrl?: string;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike;
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
  tasks(filter?: { readonly state?: TaskState }, signal?: AbortSignal): Promise<RestTasks>;
  task(id: string, signal?: AbortSignal): Promise<RestTask>;
  createTask(input: RestTaskInput): Promise<RestTask>;
  updateTask(id: string, patch: RestTaskPatch): Promise<RestTask>;
  decisions(filter?: { readonly open?: boolean }, signal?: AbortSignal): Promise<RestDecisions>;
  decision(id: string, signal?: AbortSignal): Promise<RestDecision>;
  raiseDecision(input: RestDecisionInput): Promise<RestDecision>;
  answerDecision(id: string, input: RestAnswerInput): Promise<RestDecision>;
  /** What happened after event number `after`; `0` for the beginning. */
  events(after: number, signal?: AbortSignal): Promise<RestEvents>;
  /** Where an `EventSource` subscribes to what happens after event number `after`. */
  eventStreamUrl(after: number): string;
  /** Ends the session on this browser. */
  signOut(): Promise<void>;
}

const INVALID = "The server answered unexpectedly.";

export function createClient(options: ClientOptions = {}): ConsoleClient {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  const send = options.fetch ?? ((input, init) => fetch(input, init));

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
    method: "GET" | "POST" | "PATCH",
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
        // request that changes something, which the server checks.
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
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

  return {
    me: (signal) => request("GET", `${base}${REST_ROUTES.me}`, undefined, restMeSchema, signal),
    people: (signal) =>
      request("GET", `${base}${REST_ROUTES.people}`, undefined, restPeopleSchema, signal),
    tasks: (filter = {}, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.tasks, { state: filter.state }),
        undefined,
        restTasksSchema,
        signal,
      ),
    task: (id, signal) =>
      request("GET", `${base}${restPath("tasks", id)}`, undefined, restTaskSchema, signal),
    createTask: (input) => request("POST", `${base}${REST_ROUTES.tasks}`, input, restTaskSchema),
    updateTask: (id, patch) =>
      request("PATCH", `${base}${restPath("tasks", id)}`, patch, restTaskSchema),
    decisions: (filter = {}, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.decisions, {
          open: filter.open === undefined ? undefined : String(filter.open),
        }),
        undefined,
        restDecisionsSchema,
        signal,
      ),
    decision: (id, signal) =>
      request("GET", `${base}${restPath("decisions", id)}`, undefined, restDecisionSchema, signal),
    raiseDecision: (input) =>
      request("POST", `${base}${REST_ROUTES.decisions}`, input, restDecisionSchema),
    answerDecision: (id, input) =>
      request("POST", `${base}${restPath("decisions", id)}/answer`, input, restDecisionSchema),
    events: (after, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.events, { after: String(after) }),
        undefined,
        restEventsSchema,
        signal,
      ),
    eventStreamUrl: (after) => withQuery(`${REST_ROUTES.events}/stream`, { after: String(after) }),
    signOut: () => request("POST", `${base}${AUTH_ROUTES.logout}`, undefined, undefined),
  };
}
