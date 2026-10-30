import {
  AUTH_ROUTES,
  CLAIM_PATH,
  categoryPath,
  connectPath,
  personTokensPath,
  personWorkPath,
  projectPath,
  REST_ROUTES,
  restPath,
  rulesPath,
} from "./routes.js";
import {
  type RestAnswerInput,
  type RestArchivedTasks,
  type RestArtifactInput,
  type RestCategories,
  type RestCategory,
  type RestCategoryInput,
  type RestCategoryPatch,
  type RestClaim,
  type RestComment,
  type RestComments,
  type RestConnectInput,
  type RestConnection,
  type RestConnectRequest,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisionPatch,
  type RestDecisions,
  type RestDocument,
  type RestDocumentInput,
  type RestDocuments,
  type RestEvents,
  type RestGoal,
  type RestGoalInput,
  type RestGoalPatch,
  type RestGoals,
  type RestListing,
  type RestListingInput,
  type RestMe,
  type RestMember,
  type RestMemberInput,
  type RestMemberPatch,
  type RestMembers,
  type RestMePatch,
  type RestMyDecisions,
  type RestPackConnect,
  type RestPackConnectStarted,
  type RestPackTokenInput,
  type RestPeople,
  type RestPerson,
  type RestPersonPatch,
  type RestPersonWork,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
  type RestProjectRules,
  type RestProjects,
  type RestReportInput,
  type RestRules,
  type RestRulesInput,
  type RestRun,
  type RestRunEndInput,
  type RestRunInput,
  type RestRuns,
  type RestSkillBrowse,
  type RestSkillFile,
  type RestSkillFind,
  type RestSkillLoad,
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
  type RestWork,
  type RestWorkspace,
  type RestWorkspacePackConnect,
  type RestWorkspacePatch,
  restArchivedTasksSchema,
  restCategoriesSchema,
  restCategorySchema,
  restClaimSchema,
  restCommentSchema,
  restCommentsSchema,
  restConnectionSchema,
  restConnectRequestSchema,
  restDecisionSchema,
  restDecisionsSchema,
  restDocumentSchema,
  restDocumentsSchema,
  restErrorSchema,
  restEventsSchema,
  restGoalSchema,
  restGoalsSchema,
  restListingSchema,
  restMemberSchema,
  restMembersSchema,
  restMeSchema,
  restMyDecisionsSchema,
  restPackConnectSchema,
  restPackConnectStartedSchema,
  restPeopleSchema,
  restPersonSchema,
  restPersonWorkSchema,
  restProjectRulesSchema,
  restProjectSchema,
  restProjectsSchema,
  restRulesSchema,
  restRunSchema,
  restRunsSchema,
  restSkillBrowseSchema,
  restSkillFileSchema,
  restSkillFindSchema,
  restSkillLoadSchema,
  restSkillsSchema,
  restTaskSchema,
  restTasksSchema,
  restTokenCreatedSchema,
  restTokensSchema,
  restVersionSchema,
  restVersionsSchema,
  restWorkSchema,
  restWorkspacePackConnectSchema,
  restWorkspaceSchema,
} from "./schemas.js";
import type { GoalState, TaskState } from "./vocabulary.js";

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

/** A comment to write on a task: the word, and the files put in it, which go in the one request. */
export interface CommentInput {
  /** Markdown; may be blank when a file comes with it. */
  readonly body: string;
  readonly files?: readonly FileUpload[] | undefined;
}

/** The bytes of a file of the project, as the console hands them back, with what it calls them. */
export interface FileRead {
  /** The file's name, as the console says it; the id when it says none. */
  readonly name: string;
  /** The media type the console answered with, without its parameters. */
  readonly contentType: string;
  readonly bytes: Uint8Array;
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
  /**
   * What the client calls itself, sent as `user-agent` where the platform lets a client say
   * (Node; a browser keeps its own): the command sends its product token, by which the console
   * holds it to the versions it takes (ADR-0025).
   */
  readonly userAgent?: string;
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

/** One page of a listing: how many items, from which one on; the server's bounds apply. */
export interface Page {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

/** What the roadmap is narrowed by: the goals in one state, the open ones, those sorted into one category (ADR-0026), or those whose title has some words; and which page of it. */
export interface GoalFilter extends Page {
  readonly state?: GoalState | undefined;
  /** True for the goals planned or active; false for the reached and the dropped. */
  readonly open?: boolean | undefined;
  /** The key of a category of the workspace. */
  readonly category?: string | undefined;
  /** Words of the title, each found in it whatever the case. */
  readonly q?: string | undefined;
}

/** What the board is narrowed to: one state, the open ones, a category, a goal, a worker, what is due by a day, or words of the title; and which page of it. */
export interface TaskFilter extends Page {
  readonly state?: TaskState | undefined;
  /** True for the tasks not done or dropped; false for the rest. */
  readonly open?: boolean | undefined;
  /** The key of a category. */
  readonly category?: string | undefined;
  /** The id of a goal. */
  readonly goal?: string | undefined;
  /** The id of a person among the workers of the tasks. */
  readonly worker?: string | undefined;
  /** True for the tasks with no worker. */
  readonly unassigned?: boolean | undefined;
  /** Words of the title, each found in it whatever the case; `#12` or `12` finds the task of that number too. */
  readonly q?: string | undefined;
  /** A day (`2026-10-20`): the tasks due on it or before it. */
  readonly dueBy?: string | undefined;
  /** True for the tasks put away alone (ADR-0029); false, or left out, for the current ones. */
  readonly archived?: boolean | undefined;
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
  /** Sets the project's own image for its mark, sent as a form; for an owner on the console's own pages. */
  setIcon(input: FileUpload): Promise<RestProject>;
  /** Takes the image away: the mark is the symbol on the colour again. */
  removeIcon(): Promise<RestProject>;
  /** Those listed in the project, by login. */
  members(signal?: AbortSignal): Promise<RestMembers>;
  /** Lists a person of the workspace in the project; for an owner. */
  addMember(input: RestMemberInput): Promise<RestMember>;
  updateMember(personId: string, patch: RestMemberPatch): Promise<RestMember>;
  removeMember(personId: string): Promise<void>;
  tasks(filter?: TaskFilter, signal?: AbortSignal): Promise<RestTasks>;
  /** One task, by its id or by its number. */
  task(ref: string, signal?: AbortSignal): Promise<RestTask>;
  createTask(input: RestTaskInput): Promise<RestTask>;
  updateTask(id: string, patch: RestTaskPatch): Promise<RestTask>;
  /** Puts a done or dropped task away (ADR-0029), or brings one back. */
  archiveTask(id: string): Promise<RestTask>;
  restoreTask(id: string): Promise<RestTask>;
  /** Puts every done or dropped task of a goal away at once; for an owner. Answers how many. */
  archiveTasksOfGoal(goalId: string): Promise<RestArchivedTasks>;
  /** The decisions, or only those that wait, or only those about one task; a page of them. */
  decisions(
    filter?: { readonly open?: boolean; readonly task?: string } & Page,
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
  /** The runs, newest first; or only those on one task, only the open ones, only the asker's own; a page of them. */
  runs(
    filter?: { readonly task?: string; readonly open?: boolean; readonly mine?: boolean } & Page,
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
  /** Where the bytes of a file of the project are read, by its id: handed in by a run, put in a comment, or attached to a page. */
  fileUrl(fileId: string): string;
  /** The bytes of a file of the project, by its id, with the name and the type the console says. */
  readFile(fileId: string, signal?: AbortSignal): Promise<FileRead>;
  /** The discussion on a task: its comments, oldest first, whole. */
  comments(taskId: string, signal?: AbortSignal): Promise<RestComments>;
  /** Writes a comment on a task, with its files when given, in one request. */
  comment(taskId: string, input: CommentInput): Promise<RestComment>;
  /** Ends a run: finished or failed by the agent; abandoned by the person it is for, or an administrator. */
  endRun(runId: string, input: RestRunEndInput): Promise<RestRun>;
  /** What happened in the project after event number `after`; `0` for the beginning. Narrowed by `filter`. */
  events(after: number, filter?: EventFilter, signal?: AbortSignal): Promise<RestEvents>;
  /** Where an `EventSource` subscribes to what happens in the project after event number `after`. */
  eventStreamUrl(after: number): string;
  /** The project's skills, as SkillCDN serves them at its address, or the organization's. */
  skills(signal?: AbortSignal): Promise<RestSkills>;
  /** One skill of the pack, a page of it (`load_skill`), read by the console with the pack token the project holds (ADR-0028). */
  skill(path: string, cursor?: string, signal?: AbortSignal): Promise<RestSkillLoad>;
  /** A file of the pack, a page of it, or what a folder holds (`read_repo_file`). */
  skillFile(
    path: string,
    page?: { readonly offset?: number | undefined; readonly limit?: number | undefined },
    signal?: AbortSignal,
  ): Promise<RestSkillFile>;
  /** What a folder of the pack holds, a page of it (`browse_repo`): the mounted folder when `path` is left out. */
  skillBrowse(
    page?: {
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
    signal?: AbortSignal,
  ): Promise<RestSkillBrowse>;
  /** The skills and the documents of the pack that words find, a page of them in relevance order (`search_repo`), within `path` when given. */
  skillFind(
    query: string,
    options?: {
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
    signal?: AbortSignal,
  ): Promise<RestSkillFind>;
  /** Sets the pack token the project reads a private pack with; for an owner. The token travels once and is answered never. */
  setPackToken(input: RestPackTokenInput): Promise<RestProject>;
  /** Takes the pack token away; for an owner. */
  removePackToken(): Promise<RestProject>;
  /** Asks the deployment to connect the project's pack with a code a person approves (ADR-0036); for an owner. */
  connectPackToken(): Promise<RestPackConnectStarted>;
  /** How that connection stands, read and changed nothing: pending, ended, or none; for an owner. */
  packTokenConnection(signal?: AbortSignal): Promise<RestPackConnect>;
  /**
   * Asks the console to claim the token at the deployment (ADR-0046): pending while the person
   * has not approved, connected once, the token kept and the project as it stands, or ended;
   * for an owner.
   */
  claimPackTokenConnection(signal?: AbortSignal): Promise<RestPackConnect>;
  /** Gives the connection up; for an owner. */
  cancelPackTokenConnection(): Promise<void>;
  /** The rules that hold in the project (ADR-0023): the workspace's, and what the project adds. */
  rules(signal?: AbortSignal): Promise<RestProjectRules>;
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
  /** The roadmap (ADR-0019), or what the filter keeps of it, a page at a time: the active goals first, each with its tasks counted by state. */
  goals(filter?: GoalFilter, signal?: AbortSignal): Promise<RestGoals>;
  goal(id: string, signal?: AbortSignal): Promise<RestGoal>;
  /** Sets a goal; for an owner, with a session or a token. */
  createGoal(input: RestGoalInput): Promise<RestGoal>;
  updateGoal(id: string, patch: RestGoalPatch): Promise<RestGoal>;
}

export interface ConsoleClient {
  me(signal?: AbortSignal): Promise<RestMe>;
  /** Gives up the token this client acts with, so that it is good for nothing from now on: what `console logout` does. For a token; a session has none. */
  giveUpToken(): Promise<void>;
  /** Keeps the person's choice of language, or none; for a person signed in. */
  updateMe(patch: RestMePatch): Promise<RestMe>;
  /** Changes the workspace's settings (ADR-0035); for an administrator, with a session or a token. */
  updateWorkspace(patch: RestWorkspacePatch): Promise<RestWorkspace>;
  /**
   * The workspace's SkillCDN token (ADR-0036), which reads the organization's pack for every
   * project that names no address and holds no token of its own; an administrator's. Set from
   * a token made by hand, taken away, or connected with a code a person approves at SkillCDN,
   * asked after until the token is kept or the request ended.
   */
  setWorkspacePackToken(input: RestPackTokenInput): Promise<RestWorkspace>;
  removeWorkspacePackToken(): Promise<RestWorkspace>;
  connectWorkspacePackToken(): Promise<RestPackConnectStarted>;
  workspacePackTokenConnection(signal?: AbortSignal): Promise<RestWorkspacePackConnect>;
  claimWorkspacePackTokenConnection(signal?: AbortSignal): Promise<RestWorkspacePackConnect>;
  cancelWorkspacePackTokenConnection(): Promise<void>;
  /** The people the asker may see: everyone, or those they share a project with (ADR-0035). */
  people(signal?: AbortSignal): Promise<RestPeople>;
  /**
   * One person of the workspace by their exact login, compared without regard to case, or
   * nobody: what an owner lists someone by when the People page does not show them.
   */
  findPerson(login: string, signal?: AbortSignal): Promise<RestPerson | undefined>;
  /** Changes what a person is, or whether they are in; for an administrator. */
  updatePerson(id: string, patch: RestPersonPatch): Promise<RestPerson>;
  /** Lets a login in (ADR-0022): whoever signs in with that account becomes a person; for an administrator. */
  createListing(input: RestListingInput): Promise<RestListing>;
  /** Takes a listing away before anyone signed in with it; for an administrator. */
  removeListing(id: string): Promise<void>;
  /** The projects the asker may see, with what they are in each. */
  projects(signal?: AbortSignal): Promise<RestProjects>;
  /** Makes a project, whose owner the asker becomes. */
  createProject(input: RestProjectInput): Promise<RestProject>;
  /** The board of one project. */
  project(key: string): ProjectClient;
  /** The workspace's own events, the ones about no project, after event number `after`. */
  events(after: number, signal?: AbortSignal): Promise<RestEvents>;
  /** Where a picture from elsewhere is read through the console (ADR-0048), given the https URL that names it. */
  pictureUrl(url: string): string;
  /** The categories tasks are sorted into (ADR-0019), by name. */
  categories(signal?: AbortSignal): Promise<RestCategories>;
  /** The workspace's rules (ADR-0023): the console's own until an administrator writes the organization's. */
  rules(signal?: AbortSignal): Promise<RestRules>;
  /** Writes the organization's rules; for an administrator. The console's own, sent as they are, write nothing. */
  writeRules(input: RestRulesInput): Promise<RestRules>;
  /** Puts the organization's rules away, so that the console's own hold again; for an administrator. */
  archiveRules(): Promise<RestRules>;
  /** The versions of the organization's rules, newest first; none while the console's own hold. */
  rulesVersions(signal?: AbortSignal): Promise<RestVersions>;
  /** Makes a category; for an administrator signed in. */
  createCategory(input: RestCategoryInput): Promise<RestCategory>;
  updateCategory(key: string, patch: RestCategoryPatch): Promise<RestCategory>;
  /** Removes a category no task uses; for an administrator signed in. */
  removeCategory(key: string): Promise<void>;
  /** What is on the asker's plate across the projects they may see: their open tasks, and the decisions waiting for them. */
  work(signal?: AbortSignal): Promise<RestWork>;
  /** The decisions addressed to the asker (ADR-0042) across the projects they may see, or with `raised` those they raised for someone else: a page, the waiting first; or only those. */
  myDecisions(
    filter?: { readonly open?: boolean; readonly raised?: boolean } & Page,
    signal?: AbortSignal,
  ): Promise<RestMyDecisions>;
  /** Another person's plate, within what the asker may see: for an administrator, or an owner of a project they are in. */
  personWork(personId: string, signal?: AbortSignal): Promise<RestPersonWork>;
  /** The tokens of whoever asks. */
  tokens(signal?: AbortSignal): Promise<RestTokens>;
  /** The tokens of another person: for an administrator. */
  personTokens(personId: string, signal?: AbortSignal): Promise<RestTokens>;
  /** Takes another person's token away: for an administrator. */
  revokePersonToken(personId: string, tokenId: string): Promise<void>;
  /**
   * Begins connecting an agent (ADR-0011), as nobody: answered with a code for a person to
   * approve and a secret for the command to claim the token with.
   */
  connect(input: RestConnectInput): Promise<RestConnection>;
  /** What asks to connect under a code, for the person who approves it. */
  connectRequest(code: string, signal?: AbortSignal): Promise<RestConnectRequest>;
  /** Approves a connection as oneself: the agent's name, and for how long its token is good. */
  approveConnection(code: string, input: RestTokenInput): Promise<RestConnectRequest>;
  /** Says the connection is not one's own: it goes. */
  denyConnection(code: string): Promise<void>;
  /** Claims the token of a connection with its secret: pending until approved, then the token this once. */
  claimConnection(secret: string): Promise<RestClaim>;
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
  const { token, userAgent } = options;
  const named: Record<string, string> = userAgent === undefined ? {} : { "user-agent": userAgent };

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
          ...named,
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

  /** The bytes at `url`, with the name and the type the console says, for a file of the project. */
  const read = async (
    url: string,
    fallbackName: string,
    signal?: AbortSignal,
  ): Promise<FileRead> => {
    let response: Response;
    try {
      response = await send(url, {
        method: "GET",
        ...(signal === undefined ? {} : { signal }),
        credentials: token === undefined ? "same-origin" : "omit",
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...named,
        },
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
    const type = response.headers.get("content-type") ?? "application/octet-stream";
    return {
      name: fileNameOf(response.headers.get("content-disposition") ?? "") ?? fallbackName,
      contentType: type.split(";")[0]?.trim() ?? "application/octet-stream",
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  };

  const flag = (value: boolean | undefined): string | undefined =>
    value === undefined ? undefined : String(value);
  const number = (value: number | undefined): string | undefined =>
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

  /** A comment with files as the parts of a form: the part `body`, and a part `file` for each file. */
  const commentFormOf = (input: CommentInput): FormData => {
    const form = new FormData();
    form.set("body", input.body);
    for (const file of input.files ?? []) {
      const bytes =
        file.bytes instanceof Blob ? file.bytes : new Blob([Uint8Array.from(file.bytes)]);
      form.append(
        "file",
        new File([bytes], file.name, { type: file.contentType ?? "application/octet-stream" }),
        file.name,
      );
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
      setIcon: (input) => request("POST", `${base}${at()}/icon`, formOf(input), restProjectSchema),
      removeIcon: () => request("DELETE", `${base}${at()}/icon`, undefined, restProjectSchema),
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
          withQuery(at("tasks"), {
            state: filter.state,
            archived: flag(filter.archived),
            open: flag(filter.open),
            category: filter.category,
            goal: filter.goal,
            worker: filter.worker,
            unassigned: flag(filter.unassigned),
            dueBy: filter.dueBy,
            q: filter.q,
            limit: number(filter.limit),
            offset: number(filter.offset),
          }),
          undefined,
          restTasksSchema,
          signal,
        ),
      task: (ref, signal) =>
        request("GET", `${base}${at("tasks", ref)}`, undefined, restTaskSchema, signal),
      createTask: (input) => request("POST", `${base}${at("tasks")}`, input, restTaskSchema),
      updateTask: (id, patch) =>
        request("PATCH", `${base}${at("tasks", id)}`, patch, restTaskSchema),
      archiveTask: (id) =>
        request("POST", `${base}${at("tasks", id)}/archive`, undefined, restTaskSchema),
      restoreTask: (id) =>
        request("POST", `${base}${at("tasks", id)}/restore`, undefined, restTaskSchema),
      archiveTasksOfGoal: (goalId) =>
        request("POST", `${base}${at("tasks")}/archive`, { goalId }, restArchivedTasksSchema),
      decisions: (filter = {}, signal) =>
        request(
          "GET",
          withQuery(at("decisions"), {
            open: flag(filter.open),
            task: filter.task,
            limit: number(filter.limit),
            offset: number(filter.offset),
          }),
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
            limit: number(filter.limit),
            offset: number(filter.offset),
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
      fileUrl: (fileId) => `${base}${at("files", fileId)}`,
      readFile: (fileId, signal) => read(`${base}${at("files", fileId)}`, fileId, signal),
      comments: (taskId, signal) =>
        request(
          "GET",
          `${base}${at("tasks", taskId)}/comments`,
          undefined,
          restCommentsSchema,
          signal,
        ),
      comment: (taskId, input) =>
        request(
          "POST",
          `${base}${at("tasks", taskId)}/comments`,
          (input.files?.length ?? 0) > 0 ? commentFormOf(input) : { body: input.body },
          restCommentSchema,
        ),
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
      skill: (path, cursor, signal) =>
        request(
          "GET",
          withQuery(`${at("skills")}/one`, { path, cursor }),
          undefined,
          restSkillLoadSchema,
          signal,
        ),
      skillFile: (path, page = {}, signal) =>
        request(
          "GET",
          withQuery(`${at("skills")}/file`, {
            path,
            offset: page.offset === undefined ? undefined : String(page.offset),
            limit: page.limit === undefined ? undefined : String(page.limit),
          }),
          undefined,
          restSkillFileSchema,
          signal,
        ),
      skillBrowse: (page = {}, signal) =>
        request(
          "GET",
          withQuery(`${at("skills")}/browse`, {
            path: page.path,
            cursor: page.cursor,
            limit: page.limit === undefined ? undefined : String(page.limit),
          }),
          undefined,
          restSkillBrowseSchema,
          signal,
        ),
      skillFind: (query, options = {}, signal) =>
        request(
          "GET",
          withQuery(`${at("skills")}/find`, {
            query,
            path: options.path,
            cursor: options.cursor,
            limit: options.limit === undefined ? undefined : String(options.limit),
          }),
          undefined,
          restSkillFindSchema,
          signal,
        ),
      setPackToken: (input) =>
        request("PUT", `${base}${at()}/pack-token`, input, restProjectSchema),
      removePackToken: () =>
        request("DELETE", `${base}${at()}/pack-token`, undefined, restProjectSchema),
      connectPackToken: () =>
        request(
          "POST",
          `${base}${at()}/pack-token/connect`,
          undefined,
          restPackConnectStartedSchema,
        ),
      packTokenConnection: (signal) =>
        request(
          "GET",
          `${base}${at()}/pack-token/connect`,
          undefined,
          restPackConnectSchema,
          signal,
        ),
      claimPackTokenConnection: (signal) =>
        request(
          "POST",
          `${base}${at()}/pack-token/connect/claim`,
          undefined,
          restPackConnectSchema,
          signal,
        ),
      cancelPackTokenConnection: () =>
        request("DELETE", `${base}${at()}/pack-token/connect`, undefined, undefined),
      rules: (signal) =>
        request("GET", `${base}${at("rules")}`, undefined, restProjectRulesSchema, signal),
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
      goals: (filter = {}, signal) =>
        request(
          "GET",
          withQuery(at("goals"), {
            state: filter.state,
            open: flag(filter.open),
            category: filter.category,
            q: filter.q,
            limit: number(filter.limit),
            offset: number(filter.offset),
          }),
          undefined,
          restGoalsSchema,
          signal,
        ),
      goal: (id, signal) =>
        request("GET", `${base}${at("goals", id)}`, undefined, restGoalSchema, signal),
      createGoal: (input) => request("POST", `${base}${at("goals")}`, input, restGoalSchema),
      updateGoal: (id, patch) =>
        request("PATCH", `${base}${at("goals", id)}`, patch, restGoalSchema),
    };
  };

  return {
    me: (signal) => request("GET", `${base}${REST_ROUTES.me}`, undefined, restMeSchema, signal),
    giveUpToken: () => request("DELETE", `${base}${REST_ROUTES.meToken}`, undefined, undefined),
    people: (signal) =>
      request("GET", `${base}${REST_ROUTES.people}`, undefined, restPeopleSchema, signal),
    findPerson: async (login, signal) => {
      const found = await request(
        "GET",
        withQuery(REST_ROUTES.people, { login }),
        undefined,
        restPeopleSchema,
        signal,
      );
      return found.items[0];
    },
    updateWorkspace: (patch) =>
      request("PATCH", `${base}${REST_ROUTES.workspace}`, patch, restWorkspaceSchema),
    setWorkspacePackToken: (input) =>
      request("PUT", `${base}${REST_ROUTES.workspacePackToken}`, input, restWorkspaceSchema),
    removeWorkspacePackToken: () =>
      request("DELETE", `${base}${REST_ROUTES.workspacePackToken}`, undefined, restWorkspaceSchema),
    connectWorkspacePackToken: () =>
      request(
        "POST",
        `${base}${REST_ROUTES.workspacePackToken}/connect`,
        undefined,
        restPackConnectStartedSchema,
      ),
    workspacePackTokenConnection: (signal) =>
      request(
        "GET",
        `${base}${REST_ROUTES.workspacePackToken}/connect`,
        undefined,
        restWorkspacePackConnectSchema,
        signal,
      ),
    claimWorkspacePackTokenConnection: (signal) =>
      request(
        "POST",
        `${base}${REST_ROUTES.workspacePackToken}/connect/claim`,
        undefined,
        restWorkspacePackConnectSchema,
        signal,
      ),
    cancelWorkspacePackTokenConnection: () =>
      request("DELETE", `${base}${REST_ROUTES.workspacePackToken}/connect`, undefined, undefined),
    updatePerson: (id, patch) =>
      request("PATCH", `${base}${restPath("people", id)}`, patch, restPersonSchema),
    createListing: (input) =>
      request("POST", `${base}${REST_ROUTES.listings}`, input, restListingSchema),
    removeListing: (id) =>
      request("DELETE", `${base}${restPath("listings", id)}`, undefined, undefined),
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
    pictureUrl: (url) => withQuery(REST_ROUTES.pictures, { src: url }),
    categories: (signal) =>
      request("GET", `${base}${REST_ROUTES.categories}`, undefined, restCategoriesSchema, signal),
    rules: (signal) =>
      request("GET", `${base}${REST_ROUTES.rules}`, undefined, restRulesSchema, signal),
    writeRules: (input) => request("PUT", `${base}${REST_ROUTES.rules}`, input, restRulesSchema),
    archiveRules: () =>
      request("POST", `${base}${rulesPath("archive")}`, undefined, restRulesSchema),
    rulesVersions: (signal) =>
      request("GET", `${base}${rulesPath("versions")}`, undefined, restVersionsSchema, signal),
    createCategory: (input) =>
      request("POST", `${base}${REST_ROUTES.categories}`, input, restCategorySchema),
    updateCategory: (key, patch) =>
      request("PATCH", `${base}${categoryPath(key)}`, patch, restCategorySchema),
    removeCategory: (key) => request("DELETE", `${base}${categoryPath(key)}`, undefined, undefined),
    work: (signal) =>
      request("GET", `${base}${REST_ROUTES.work}`, undefined, restWorkSchema, signal),
    myDecisions: (filter = {}, signal) =>
      request(
        "GET",
        withQuery(REST_ROUTES.decisions, {
          open: flag(filter.open),
          raised: filter.raised === true ? "true" : undefined,
          limit: number(filter.limit),
          offset: number(filter.offset),
        }),
        undefined,
        restMyDecisionsSchema,
        signal,
      ),
    personWork: (personId, signal) =>
      request("GET", `${base}${personWorkPath(personId)}`, undefined, restPersonWorkSchema, signal),
    tokens: (signal) =>
      request("GET", `${base}${REST_ROUTES.tokens}`, undefined, restTokensSchema, signal),
    createToken: (input) =>
      request("POST", `${base}${REST_ROUTES.tokens}`, input, restTokenCreatedSchema),
    revokeToken: (id) =>
      request("DELETE", `${base}${restPath("tokens", id)}`, undefined, undefined),
    updateMe: (patch) => request("PATCH", `${base}${REST_ROUTES.me}`, patch, restMeSchema),
    personTokens: (personId, signal) =>
      request("GET", `${base}${personTokensPath(personId)}`, undefined, restTokensSchema, signal),
    revokePersonToken: (personId, tokenId) =>
      request("DELETE", `${base}${personTokensPath(personId, tokenId)}`, undefined, undefined),
    connect: (input) =>
      request("POST", `${base}${REST_ROUTES.connect}`, input, restConnectionSchema),
    connectRequest: (code, signal) =>
      request("GET", `${base}${connectPath(code)}`, undefined, restConnectRequestSchema, signal),
    approveConnection: (code, input) =>
      request("POST", `${base}${connectPath(code, "approve")}`, input, restConnectRequestSchema),
    denyConnection: (code) =>
      request("POST", `${base}${connectPath(code, "deny")}`, undefined, undefined),
    claimConnection: (secret) =>
      request("POST", `${base}${CLAIM_PATH}`, { secret }, restClaimSchema),
    signOut: () => request("POST", `${base}${AUTH_ROUTES.logout}`, undefined, undefined),
  };
}

/**
 * The file's name as a `content-disposition` header says it: the exact one (`filename*`, UTF-8,
 * percent-encoded) when it is readable, else the plain one in quotes; nothing when neither is.
 */
export function fileNameOf(disposition: string): string | undefined {
  const exact = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (exact?.[1] !== undefined) {
    try {
      const decoded = decodeURIComponent(exact[1].trim());
      if (decoded.length > 0) {
        return decoded;
      }
    } catch {
      // Not percent-encoded as it should be: the plain name below is what there is.
    }
  }
  const plain = /filename="([^"]*)"/i.exec(disposition);
  return plain?.[1] === undefined || plain[1].length === 0 ? undefined : plain[1];
}
