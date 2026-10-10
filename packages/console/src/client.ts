import { AUTH_ROUTES, projectPath, REST_ROUTES, restPath } from "./routes.js";
import {
  type RestAnswerInput,
  type RestArtifactInput,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisionPatch,
  type RestDecisions,
  type RestDocument,
  type RestDocumentInput,
  type RestDocuments,
  type RestEvents,
  type RestMe,
  type RestMember,
  type RestMemberInput,
  type RestMemberPatch,
  type RestMembers,
  type RestPeople,
  type RestPerson,
  type RestPersonPatch,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
  type RestProjects,
  type RestReportInput,
  type RestRun,
  type RestRunEndInput,
  type RestRunInput,
  type RestRuns,
  type RestSkills,
  type RestTask,
  type RestTaskInput,
  type RestTaskPatch,
  type RestTasks,
  type RestTokenCreated,
  type RestTokenInput,
  type RestTokens,
  type RestVersion,
  type RestVersions,
  restDecisionSchema,
  restDecisionsSchema,
  restDocumentSchema,
  restDocumentsSchema,
  restErrorSchema,
  restEventsSchema,
  restMemberSchema,
  restMembersSchema,
  restMeSchema,
  restPeopleSchema,
  restPersonSchema,
  restProjectSchema,
  restProjectsSchema,
  restRunSchema,
  restRunsSchema,
  restSkillsSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
  restTokensSchema,
  restVersionSchema,
  restVersionsSchema,
} from "./schemas.js";
import type { TaskState } from "./vocabulary.js";

// The client of the console's REST API: what the default console and a custom one talk to the
// server with, and what the command line, a script or a console of a person's own talks to it
// with, holding a token of theirs. It takes a `fetch` and a base URL and reads nothing else;
// every answer is parsed with the schemas the server is tested against. The board is a
// project's (ADR-0008): `client.project(key)` is the client of one project.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A file to hand in: its bytes, what to call it, and what it is. */
export interface FileUpload {
  /** The file's name, without a path. */
  readonly name: string;
  readonly bytes: Uint8Array | Blob;
  /** The media type; `application/octet-stream` when left out. */
  readonly contentType?: string | undefined;
  readonly label?: string | undefined;
}

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

/** What the events of a project are filtered by: those about one task, one run, one decision or one document. */
export interface EventFilter {
  readonly task?: string | undefined;
  readonly run?: string | undefined;
  readonly decision?: string | undefined;
  readonly document?: string | undefined;
}

/** What a folder's listing, or a search, of the documents is narrowed to. */
export interface DocumentFilter {
  /** The folder to list, `""` or left out for the root. */
  readonly folder?: string | undefined;
  /** Words to find pages by; given, the folder is not looked at. */
  readonly q?: string | undefined;
  /** Whether archived pages are listed too. */
  readonly archived?: boolean | undefined;
}

/** The board of one project, as the asker may see and change it. */
export interface ProjectClient {
  /** The key the project is reached by. */
  readonly key: string;
  /** The project, with what the asker is in it. */
  get(signal?: AbortSignal): Promise<RestProject>;
  /** Changes the project's settings; for an owner. */
  update(patch: RestProjectPatch): Promise<RestProject>;
  /** Those listed in the project, by login. */
  members(signal?: AbortSignal): Promise<RestMembers>;
  /** Lists a person of the workspace in the project; for an owner. */
  addMember(input: RestMemberInput): Promise<RestMember>;
  updateMember(personId: string, patch: RestMemberPatch): Promise<RestMember>;
  removeMember(personId: string): Promise<void>;
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
  /** Grows a decision's record: its context, or what followed. */
  updateDecision(id: string, patch: RestDecisionPatch): Promise<RestDecision>;
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
  /** Hands in a file, on a run of the asker's: the console keeps the bytes. */
  handInFile(runId: string, input: FileUpload): Promise<RestRun>;
  /** Where the bytes of a file handed in are read, by the artifact's id. */
  fileUrl(artifactId: string): string;
  /** Ends a run: finished or failed by the agent; abandoned by the person it is for, or an administrator. */
  endRun(runId: string, input: RestRunEndInput): Promise<RestRun>;
  /** What happened in the project after event number `after`; `0` for the beginning. Narrowed by `filter`. */
  events(after: number, filter?: EventFilter, signal?: AbortSignal): Promise<RestEvents>;
  /** Where an `EventSource` subscribes to what happens in the project after event number `after`. */
  eventStreamUrl(after: number): string;
  /** The project's skills, as SkillCDN serves them at its address, or the organization's. */
  skills(signal?: AbortSignal): Promise<RestSkills>;
  /** A folder's pages and folders, or the pages a search finds. */
  documents(filter?: DocumentFilter, signal?: AbortSignal): Promise<RestDocuments>;
  /** One document, by its path: its latest version, its links both ways, its files. */
  document(path: string, signal?: AbortSignal): Promise<RestDocument>;
  /** Writes a document at its path, as a new version, or the first one. */
  writeDocument(path: string, input: RestDocumentInput): Promise<RestDocument>;
  /** Puts a document away: kept out of the folders and the search, readable, not written to. */
  archiveDocument(path: string): Promise<RestDocument>;
  /** Brings an archived document back. */
  restoreDocument(path: string): Promise<RestDocument>;
  /** The versions of a document, newest first, each with who wrote it and when. */
  documentVersions(path: string, signal?: AbortSignal): Promise<RestVersions>;
  /** One version of a document, with its body as it was. */
  documentVersion(path: string, number: number, signal?: AbortSignal): Promise<RestVersion>;
  /** Attaches a file to a document: the console keeps the bytes. */
  attachFile(path: string, input: FileUpload): Promise<RestDocument>;
  /** Where the bytes of a file attached to a document are read, by the file's id. */
  documentFileUrl(path: string, fileId: string): string;
}

export interface ConsoleClient {
  me(signal?: AbortSignal): Promise<RestMe>;
  people(signal?: AbortSignal): Promise<RestPeople>;
  /** Changes what a person is; for an administrator. */
  updatePerson(id: string, patch: RestPersonPatch): Promise<RestPerson>;
  /** The projects the asker may see, with what they are in each. */
  projects(signal?: AbortSignal): Promise<RestProjects>;
  /** Makes a project, whose owner the asker becomes. */
  createProject(input: RestProjectInput): Promise<RestProject>;
  /** The board of one project. */
  project(key: string): ProjectClient;
  /** The workspace's own events, the ones about no project, after event number `after`. */
  events(after: number, signal?: AbortSignal): Promise<RestEvents>;
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
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    body: unknown,
    schema: Schema<T> | undefined,
    signal?: AbortSignal,
  ): Promise<T> => {
    const form = body instanceof FormData;
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
          // A form names its own type, boundary included; everything else is JSON.
          ...(body === undefined || form ? {} : { "content-type": "application/json" }),
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
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

  /** A file as the parts of a form: the bytes with their name and type, and the label. */
  const formOf = (input: FileUpload): FormData => {
    const form = new FormData();
    const bytes =
      input.bytes instanceof Blob ? input.bytes : new Blob([Uint8Array.from(input.bytes)]);
    form.set(
      "file",
      new File([bytes], input.name, { type: input.contentType ?? "application/octet-stream" }),
      input.name,
    );
    if (input.label !== undefined) {
      form.set("label", input.label);
    }
    return form;
  };

  const projectClient = (key: string): ProjectClient => {
    const at = (collection?: Parameters<typeof projectPath>[1], id?: string) =>
      projectPath(key, collection, id);
    return {
      key,
      get: (signal) => request("GET", `${base}${at()}`, undefined, restProjectSchema, signal),
      update: (patch) => request("PATCH", `${base}${at()}`, patch, restProjectSchema),
      members: (signal) =>
        request("GET", `${base}${at("members")}`, undefined, restMembersSchema, signal),
      addMember: (input) => request("POST", `${base}${at("members")}`, input, restMemberSchema),
      updateMember: (personId, patch) =>
        request("PATCH", `${base}${at("members", personId)}`, patch, restMemberSchema),
      removeMember: (personId) =>
        request("DELETE", `${base}${at("members", personId)}`, undefined, undefined),
      tasks: (filter = {}, signal) =>
        request(
          "GET",
          withQuery(at("tasks"), { state: filter.state }),
          undefined,
          restTasksSchema,
          signal,
        ),
      task: (ref, signal) =>
        request("GET", `${base}${at("tasks", ref)}`, undefined, restTaskSchema, signal),
      createTask: (input) => request("POST", `${base}${at("tasks")}`, input, restTaskSchema),
      updateTask: (id, patch) =>
        request("PATCH", `${base}${at("tasks", id)}`, patch, restTaskSchema),
      decisions: (filter = {}, signal) =>
        request(
          "GET",
          withQuery(at("decisions"), { open: flag(filter.open), task: filter.task }),
          undefined,
          restDecisionsSchema,
          signal,
        ),
      decision: (id, signal) =>
        request("GET", `${base}${at("decisions", id)}`, undefined, restDecisionSchema, signal),
      awaitDecision: (id, waitSeconds, signal) =>
        request(
          "GET",
          withQuery(at("decisions", id), { wait: String(waitSeconds) }),
          undefined,
          restDecisionSchema,
          signal,
        ),
      raiseDecision: (input) =>
        request("POST", `${base}${at("decisions")}`, input, restDecisionSchema),
      answerDecision: (id, input) =>
        request("POST", `${base}${at("decisions", id)}/answer`, input, restDecisionSchema),
      updateDecision: (id, patch) =>
        request("PATCH", `${base}${at("decisions", id)}`, patch, restDecisionSchema),
      runs: (filter = {}, signal) =>
        request(
          "GET",
          withQuery(at("runs"), {
            task: filter.task,
            open: flag(filter.open),
            mine: flag(filter.mine),
          }),
          undefined,
          restRunsSchema,
          signal,
        ),
      run: (id, signal) =>
        request("GET", `${base}${at("runs", id)}`, undefined, restRunSchema, signal),
      startRun: (input) => request("POST", `${base}${at("runs")}`, input, restRunSchema),
      report: (runId, input) =>
        request("POST", `${base}${at("runs", runId)}/reports`, input, restRunSchema),
      handIn: (runId, input) =>
        request("POST", `${base}${at("runs", runId)}/artifacts`, input, restRunSchema),
      handInFile: (runId, input) =>
        request("POST", `${base}${at("runs", runId)}/files`, formOf(input), restRunSchema),
      fileUrl: (artifactId) => `${base}${at("files", artifactId)}`,
      endRun: (runId, input) =>
        request("POST", `${base}${at("runs", runId)}/end`, input, restRunSchema),
      events: (after, filter = {}, signal) =>
        request(
          "GET",
          withQuery(at("events"), {
            after: String(after),
            task: filter.task,
            run: filter.run,
            decision: filter.decision,
            document: filter.document,
          }),
          undefined,
          restEventsSchema,
          signal,
        ),
      eventStreamUrl: (after) => withQuery(`${at("events")}/stream`, { after: String(after) }),
      skills: (signal) =>
        request("GET", `${base}${at("skills")}`, undefined, restSkillsSchema, signal),
      documents: (filter = {}, signal) =>
        request(
          "GET",
          withQuery(at("docs"), {
            folder: filter.q === undefined ? filter.folder : undefined,
            q: filter.q,
            archived: flag(filter.archived),
          }),
          undefined,
          restDocumentsSchema,
          signal,
        ),
      document: (path, signal) =>
        request("GET", `${base}${at("docs", path)}`, undefined, restDocumentSchema, signal),
      writeDocument: (path, input) =>
        request("PUT", `${base}${at("docs", path)}`, input, restDocumentSchema),
      archiveDocument: (path) =>
        request("POST", `${base}${at("docs", path)}/archive`, undefined, restDocumentSchema),
      restoreDocument: (path) =>
        request("POST", `${base}${at("docs", path)}/restore`, undefined, restDocumentSchema),
      documentVersions: (path, signal) =>
        request(
          "GET",
          `${base}${at("docs", path)}/versions`,
          undefined,
          restVersionsSchema,
          signal,
        ),
      documentVersion: (path, number, signal) =>
        request(
          "GET",
          `${base}${at("docs", path)}/versions/${number}`,
          undefined,
          restVersionSchema,
          signal,
        ),
      attachFile: (path, input) =>
        request("POST", `${base}${at("docs", path)}/files`, formOf(input), restDocumentSchema),
      documentFileUrl: (path, fileId) =>
        `${base}${at("docs", path)}/files/${encodeURIComponent(fileId)}`,
    };
  };

  return {
    me: (signal) => request("GET", `${base}${REST_ROUTES.me}`, undefined, restMeSchema, signal),
    people: (signal) =>
      request("GET", `${base}${REST_ROUTES.people}`, undefined, restPeopleSchema, signal),
    updatePerson: (id, patch) =>
      request("PATCH", `${base}${restPath("people", id)}`, patch, restPersonSchema),
    projects: (signal) =>
      request("GET", `${base}${REST_ROUTES.projects}`, undefined, restProjectsSchema, signal),
    createProject: (input) =>
      request("POST", `${base}${REST_ROUTES.projects}`, input, restProjectSchema),
    project: projectClient,
    events: (after, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.events, { after: String(after) }),
        undefined,
        restEventsSchema,
        signal,
      ),
    tokens: (signal) =>
      request("GET", `${base}${REST_ROUTES.tokens}`, undefined, restTokensSchema, signal),
    createToken: (input) =>
      request("POST", `${base}${REST_ROUTES.tokens}`, input, restTokenCreatedSchema),
    revokeToken: (id) =>
      request("DELETE", `${base}${restPath("tokens", id)}`, undefined, undefined),
    signOut: () => request("POST", `${base}${AUTH_ROUTES.logout}`, undefined, undefined),
  };
}
