import {
  DEFAULT_TOKEN_DAYS,
  EVENTS_PAGE_LIMIT,
  isDocumentPath,
  isFolderPath,
  LIST_LIMIT,
  MAX_ARTIFACTS_PER_RUN,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_FILE_BYTES,
  MAX_FILES_PER_DOCUMENT,
  MAX_PROJECT_KEY_LENGTH,
  MAX_REPORTS_PER_RUN,
  MAX_SEARCH_LENGTH,
  MAX_VERSIONS_PER_DOCUMENT,
  REST_ROUTES,
  type RestDecisions,
  type RestDocuments,
  type RestEvents,
  type RestMembers,
  type RestPeople,
  type RestProjects,
  type RestRuns,
  type RestSkills,
  type RestTasks,
  type RestTokenCreated,
  type RestTokens,
  type RestVersions,
  restAnswerInputSchema,
  restArtifactInputSchema,
  restDecisionInputSchema,
  restDecisionPatchSchema,
  restDocumentInputSchema,
  restFileInputSchema,
  restMemberInputSchema,
  restMemberPatchSchema,
  restPersonPatchSchema,
  restProjectInputSchema,
  restProjectPatchSchema,
  restReportInputSchema,
  restRunEndInputSchema,
  restRunInputSchema,
  restTaskInputSchema,
  restTaskPatchSchema,
  restTokenInputSchema,
  TASK_STATES,
} from "@skillcdn/console/api";
import { formatAddress, parseAddress } from "@skillcdn/core";
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
  updateDecision,
} from "../db/queries/decisions.js";
import {
  attachFile,
  DocumentError,
  findDocumentFile,
  findDocumentId,
  getDocument,
  getVersion,
  listDocuments,
  listVersions,
  searchDocuments,
  setArchived,
  writeDocument,
} from "../db/queries/documents.js";
import { type Actor, latestEventId, listEventsAfter, type Scope } from "../db/queries/events.js";
import {
  listPeople,
  PersonError,
  type PersonRecord,
  updatePersonRole,
} from "../db/queries/people.js";
import {
  addMember,
  createProject,
  findProjectFor,
  listMembers,
  listProjectsFor,
  ProjectError,
  type ProjectView,
  removeMember,
  updateMember,
  updateProject,
} from "../db/queries/projects.js";
import {
  addArtifact,
  addReport,
  endRun,
  findArtifact,
  getRun,
  listRuns,
  OPEN_RUN_STATUSES,
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
import type { BlobStore } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import type { Skills } from "../skills.js";
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
  restDocument,
  restDocumentSummary,
  restEvent,
  restMember,
  restPerson,
  restProject,
  restRun,
  restTask,
  restToken,
  restVersion,
  restVersionSummary,
} from "./rest-shapes.js";

export interface RestDependencies {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly access: Access;
  /** The tokens people make; left out where nobody signs in, and then nobody has one. */
  readonly tokens: Tokens | undefined;
  readonly feed: LiveFeed;
  /** Where the bytes of files handed in are kept. */
  readonly blobs: BlobStore;
  /** The skills of a project, read by address. */
  readonly skills: Skills;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly agents: {
    /** How long a read of a decision may wait for its answer before answering that it still waits. */
    readonly waitMs: number;
  };
}

/** A task or a decision is a few fields and a body of bounded Markdown; this is far above both. */
const MAX_BODY_BYTES = 256 * 1024;
/** A page of Markdown as JSON, with room for every character to take several bytes. */
const MAX_DOCUMENT_BYTES = 1024 * 1024;
/** What a form carries besides the file: a label, the names of the parts, the boundaries. */
const FORM_OVERHEAD_BYTES = 64 * 1024;
/** Media types a browser may show in place; a file of any other kind is handed over as bytes. */
const INLINE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A task's number in a path: what people say out loud, where the pages say the id. */
const TASK_NUMBER = /^[1-9]\d{0,8}$/;
/** A project's key in a path, as the package's schema has it; anything else is not found. */
const PROJECT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A version's number in a path. */
const VERSION_NUMBER = /^[1-9]\d{0,8}$/;
/** The most a read of a decision may ask to wait, in seconds; the server's own bound is lower. */
const MAX_WAIT_SECONDS = 600;
const DAY_MS = 86_400_000;

/** The board of one project: `/api/v1/projects/:key/...`. */
const PROJECT = `${REST_ROUTES.projects}/:key`;

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
  task: z.string().regex(UUID).optional(),
  run: z.string().regex(UUID).optional(),
  decision: z.string().regex(UUID).optional(),
  document: z.string().regex(UUID).optional(),
});
const documentsQuery = z.object({
  folder: z
    .string()
    .max(MAX_DOCUMENT_PATH_LENGTH)
    .refine(isFolderPath, "must be a folder's path, or empty for the root")
    .default(""),
  q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
  archived: z.enum(["true", "false"]).optional(),
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

/** Who is asking, in which project, and what they are in it. */
interface InProject extends Caller {
  readonly project: ProjectView;
  readonly scope: Scope;
  /** Who the change is attributed to: the person, as the agent when they act with a token. */
  readonly actor: Actor;
}

/**
 * `filename="..."; filename*=UTF-8''...`: the name for every browser, in what every one of them
 * reads, and the exact one for those that read the second form.
 */
function filenameParameters(name: string): string {
  const plain = name.replaceAll(/[^\x20-\x7e]/g, "_").replaceAll(/["\\]/g, "_");
  const exact = encodeURIComponent(name).replaceAll(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `filename="${plain}"; filename*=UTF-8''${exact}`;
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

/** Who a change is attributed to: the person, and the agent they act as when with a token. */
const actorOf = (caller: Caller): Actor =>
  caller.token === undefined
    ? { id: caller.person.id }
    : { id: caller.person.id, agent: caller.token.name };

/**
 * The REST API of the board (docs/specs/rest.md). Every route runs in the same order: parse
 * the input, ask who is asking and whether they may, then do the work. The board is a
 * project's: every route under a project first finds the project as the asker may see it, and
 * what the asker may not see is not found. Nothing here is cached, and nothing is answered to
 * nobody.
 */
export function registerRest(app: Hono<AppEnv>, dependencies: RestDependencies): void {
  const { database, workspace, access, tokens, feed, blobs, skills, clock, logger, agents } =
    dependencies;

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

  /**
   * The person signed in on the console's own pages, or the refusal to answer with: what the
   * tokens themselves are managed by, and what configuring is done by. A token cannot make,
   * list or remove tokens, so that one which leaks cannot outlive its removal through tokens
   * of its own; and an agent works as its person does, but configuring is a person's own doing.
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
    const caller = await changingCaller(c);
    return caller instanceof Response ? caller : caller.person;
  };

  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);

  const notFound = (c: Context<AppEnv>, code: string, message: string): Response =>
    c.json(errorBody(code, message), 404);
  const noSuchProject = (c: Context<AppEnv>) =>
    notFound(c, "project.not_found", "The project was not found.");
  const noSuchRun = (c: Context<AppEnv>) => notFound(c, "run.not_found", "The run was not found.");
  const noSuchDecision = (c: Context<AppEnv>) =>
    notFound(c, "decision.not_found", "The decision was not found.");
  const noSuchTask = (c: Context<AppEnv>) =>
    notFound(c, "task.not_found", "The task was not found.");
  const noSuchDocument = (c: Context<AppEnv>) =>
    notFound(c, "document.not_found", "The page was not found.");
  const noSuchFile = (c: Context<AppEnv>) =>
    notFound(c, "file.not_found", "The file was not found.");
  /** The document's path in the URL, decoded: one segment, its slashes encoded. */
  const documentPathOf = (c: Context<AppEnv>): string | undefined => {
    const path = c.req.param("path") ?? "";
    return isDocumentPath(path) ? path : undefined;
  };
  const ownerRequired = (c: Context<AppEnv>): Response =>
    c.json(errorBody("auth.forbidden", "Only an owner of the project may do this."), 403);

  /**
   * The project the path names, as the caller may see it, with what they are in it. A project
   * they may not see, and one that is not there, are the same answer, so that nothing is
   * learned either way; the key is checked first, so that nothing odd reaches the database.
   */
  const inProject = async (
    c: Context<AppEnv>,
    caller: Caller | Response,
  ): Promise<InProject | Response> => {
    if (caller instanceof Response) {
      return caller;
    }
    const key = c.req.param("key") ?? "";
    if (key.length > MAX_PROJECT_KEY_LENGTH || !PROJECT_KEY.test(key)) {
      return noSuchProject(c);
    }
    const project = await findProjectFor(database, caller.person.workspaceId, key, caller.person);
    if (project === undefined) {
      return noSuchProject(c);
    }
    return {
      ...caller,
      project,
      scope: { workspaceId: caller.person.workspaceId, projectId: project.id },
      actor: actorOf(caller),
    };
  };

  /** Reading the project: anyone who may see it. */
  const reading = async (c: Context<AppEnv>) => inProject(c, await askingCaller(c));
  /** Changing something in it: anyone who may see it, from the console's own pages or with a token. */
  const changing = async (c: Context<AppEnv>) => inProject(c, await changingCaller(c));
  /** Configuring it: an owner, signed in on the console's own pages. */
  const configuring = async (c: Context<AppEnv>): Promise<InProject | Response> => {
    const person = await signedInOnOwnPages(c);
    const found = await inProject(
      c,
      person instanceof Response ? person : { person, token: undefined },
    );
    if (found instanceof Response) {
      return found;
    }
    return found.project.role === "owner" ? found : ownerRequired(c);
  };

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

  /** A skills address as a project names one: canonical, `null` for none, or the refusal. */
  const addressOf = (
    c: Context<AppEnv>,
    value: string | null | undefined,
  ): string | null | undefined | Response => {
    if (value === undefined || value === null) {
      return value;
    }
    const parsed = parseAddress(value);
    return parsed.ok
      ? formatAddress(parsed.value)
      : c.json(errorBody("project.invalid_address", `skillsAddress: ${parsed.error.message}`), 400);
  };

  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  const documentTooLarge = bodyLimit({
    maxSize: MAX_DOCUMENT_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The page is too large."), 413),
  });
  const fileTooLarge = (c: Context<AppEnv>): Response =>
    c.json(errorBody("request.too_large", `The file is over ${MAX_FILE_BYTES} bytes.`), 413);
  const formTooLarge = bodyLimit({
    maxSize: MAX_FILE_BYTES + FORM_OVERHEAD_BYTES,
    onError: fileTooLarge,
  });

  /** What a task, a decision, a run, a person or a project that could not be worked on answers with. */
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
    if (error instanceof ProjectError) {
      const status =
        error.code === "project.not_found" || error.code === "member.not_found"
          ? 404
          : error.code === "member.invalid_person"
            ? 400
            : 409;
      return c.json(errorBody(error.code, error.message), status);
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
    if (error instanceof DocumentError) {
      const status =
        error.code === "document.not_found" || error.code === "document.version_not_found"
          ? 404
          : 409;
      return c.json(errorBody(error.code, error.message), status);
    }
    throw error;
  };

  /** A file as the parts of a form: the part `file` with its name and type, and a `label`; or the refusal. */
  const filePartOf = async (
    c: Context<AppEnv>,
  ): Promise<
    | {
        readonly part: File;
        readonly name: string;
        readonly contentType: string;
        readonly label: string | undefined;
      }
    | Response
  > => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return invalid(c, "The request body is not a form with a file in it.");
    }
    const part = form.get("file");
    if (!(part instanceof File)) {
      return invalid(c, "file: the form needs a part called file.");
    }
    const label = form.get("label");
    const type = part.type.split(";")[0]?.trim() ?? "";
    const parsed = restFileInputSchema.safeParse({
      name: part.name,
      ...(type.length === 0 ? {} : { contentType: type }),
      ...(typeof label === "string" ? { label } : {}),
    });
    if (!parsed.success || parsed.data === undefined) {
      return invalid(c, firstProblem(parsed));
    }
    if (part.size === 0) {
      return invalid(c, "file: the file is empty.");
    }
    if (part.size > MAX_FILE_BYTES) {
      return fileTooLarge(c);
    }
    return {
      part,
      name: parsed.data.name,
      contentType: parsed.data.contentType ?? "application/octet-stream",
      label: parsed.data.label,
    };
  };

  /**
   * The bytes of a file the console keeps, for whoever may see the project. A few kinds are
   * shown in place; the rest are handed over as bytes. Never sniffed, never run: the file is
   * an agent's, or a person's.
   */
  const serveFile = async (
    c: Context<AppEnv>,
    file: { readonly name: string; readonly contentType: string; readonly sha256: string },
    about: Record<string, unknown>,
  ): Promise<Response> => {
    const bytes = await blobs.get(file.sha256);
    if (bytes === undefined) {
      logger.error(
        { ...about, requestId: c.get("requestId") },
        "the bytes of a file the console keeps are not in the blob store",
      );
      return noSuchFile(c);
    }
    const inline = INLINE_TYPES.has(file.contentType);
    const type = inline ? file.contentType : "application/octet-stream";
    c.header(
      "content-type",
      type.startsWith("text/") || type === "application/json" ? `${type}; charset=utf-8` : type,
    );
    c.header("content-length", String(bytes.byteLength));
    c.header(
      "content-disposition",
      `${inline ? "inline" : "attachment"}; ${filenameParameters(file.name)}`,
    );
    c.header("x-content-type-options", "nosniff");
    c.header("content-security-policy", "default-src 'none'; sandbox");
    c.header("cross-origin-resource-policy", "same-origin");
    // A copy of its own: what the driver hands over may be a view of a larger buffer.
    return c.body(new Uint8Array(bytes).buffer);
  };

  /**
   * The decision once answered, or as it stands when `waitMs` has passed: woken by the board's
   * own nudge, so that an answer given on a page reaches whoever waits for it at once.
   */
  const waitForAnswer = async (
    scope: Scope,
    decisionId: string,
    waitMs: number,
  ): Promise<DecisionRecord | undefined> => {
    const after = await latestEventId(database, scope.workspaceId);
    const decision = await getDecision(database, scope, decisionId);
    if (decision === undefined || decision.answer !== undefined || waitMs <= 0) {
      return decision;
    }
    const subscription = feed.subscribe(after, { ...scope, decisionId });
    const timer = setTimeout(() => subscription.end(), waitMs);
    try {
      for await (const message of subscription) {
        if (
          message.kind === "events" &&
          message.items.some((event) => event.kind === "decision.answered")
        ) {
          break;
        }
      }
    } finally {
      clearTimeout(timer);
      subscription.end();
    }
    return getDecision(database, scope, decisionId);
  };

  // The workspace: its people, its projects, its own events, and the tokens.

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
        actor: { id: person.id },
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

  app.get(REST_ROUTES.projects, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const body: RestProjects = {
      items: (await listProjectsFor(database, person.workspaceId, person)).map(restProject),
    };
    return c.json(body);
  });

  // A project is made by a person signed in on the console's own pages, who becomes its owner.
  app.post(REST_ROUTES.projects, tooLarge, async (c) => {
    const person = await signedInOnOwnPages(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restProjectInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const skillsAddress = addressOf(c, input.skillsAddress);
    if (skillsAddress instanceof Response) {
      return skillsAddress;
    }
    try {
      const project = await createProject(database, {
        workspaceId: person.workspaceId,
        actor: { id: person.id },
        person,
        project: { ...input, skillsAddress: skillsAddress ?? null },
        now: clock.now(),
      });
      logger.info(
        { person: person.id, project: project.id, key: project.key, requestId: c.get("requestId") },
        "project created",
      );
      return c.json(restProject(project), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // The workspace's own events: what happened to its people, which no project holds.
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
      { workspaceId: person.workspaceId, projectId: null },
      query.data.after,
      query.data.limit,
    );
    const body: RestEvents = { items: page.items.map(restEvent), more: page.more };
    return c.json(body);
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
        // Left out, a token is good for the default; `null` is a token that does not expire.
        ttlMs:
          input.expiresInDays === null
            ? undefined
            : (input.expiresInDays ?? DEFAULT_TOKEN_DAYS) * DAY_MS,
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

  // The project itself: what it is, and who is listed in it.

  app.get(PROJECT, async (c) => {
    const found = await reading(c);
    return found instanceof Response ? found : c.json(restProject(found.project));
  });

  app.patch(PROJECT, tooLarge, async (c) => {
    const found = await configuring(c);
    if (found instanceof Response) {
      return found;
    }
    const patch = await bodyOf(c, restProjectPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const skillsAddress = addressOf(c, patch.skillsAddress);
    if (skillsAddress instanceof Response) {
      return skillsAddress;
    }
    try {
      const project = await updateProject(database, {
        projectId: found.project.id,
        actor: found.actor,
        person: found.person,
        patch: { ...patch, skillsAddress },
        now: clock.now(),
      });
      return c.json(restProject(project));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PROJECT}/members`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const body: RestMembers = {
      items: (await listMembers(database, found.project.id)).map(restMember),
    };
    return c.json(body);
  });

  app.post(`${PROJECT}/members`, tooLarge, async (c) => {
    const found = await configuring(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restMemberInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const member = await addMember(database, {
        ...found.scope,
        actor: found.actor,
        personId: input.personId,
        role: input.role ?? "member",
        now: clock.now(),
      });
      logger.info(
        {
          person: found.person.id,
          project: found.project.id,
          subject: member.person.id,
          role: member.role,
          requestId: c.get("requestId"),
        },
        "member added",
      );
      return c.json(restMember(member), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.patch(`${PROJECT}/members/:personId`, tooLarge, async (c) => {
    const found = await configuring(c);
    if (found instanceof Response) {
      return found;
    }
    const patch = await bodyOf(c, restMemberPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const personId = c.req.param("personId");
    if (!UUID.test(personId)) {
      return notFound(c, "member.not_found", "The person is not listed in the project.");
    }
    try {
      const member = await updateMember(database, {
        ...found.scope,
        actor: found.actor,
        personId,
        role: patch.role,
        now: clock.now(),
      });
      return c.json(restMember(member));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${PROJECT}/members/:personId`, async (c) => {
    const found = await configuring(c);
    if (found instanceof Response) {
      return found;
    }
    const personId = c.req.param("personId");
    if (!UUID.test(personId)) {
      return notFound(c, "member.not_found", "The person is not listed in the project.");
    }
    try {
      await removeMember(database, {
        ...found.scope,
        actor: found.actor,
        personId,
        now: clock.now(),
      });
      logger.info(
        {
          person: found.person.id,
          project: found.project.id,
          subject: personId,
          requestId: c.get("requestId"),
        },
        "member removed",
      );
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  // The board of the project.

  app.get(`${PROJECT}/tasks`, async (c) => {
    const query = tasksQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const items = await listTasks(database, found.scope, {
      state: query.data.state,
      limit: LIST_LIMIT,
    });
    const body: RestTasks = { items: items.map(restTask) };
    return c.json(body);
  });

  app.post(`${PROJECT}/tasks`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restTaskInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const task = await createTask(database, {
        scope: found.scope,
        actor: found.actor,
        task: {
          ...input,
          links: input.links?.map((link) => ({ url: link.url, label: link.label ?? null })),
        },
        now: clock.now(),
      });
      logger.info(
        { person: found.person.id, task: task.id, requestId: c.get("requestId") },
        "task created",
      );
      return c.json(restTask(task), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // One task, by its id or by its number: the pages hold ids, people and their agents say numbers.
  app.get(`${PROJECT}/tasks/:id`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const ref = c.req.param("id");
    const task = UUID.test(ref)
      ? await getTask(database, found.scope, ref)
      : TASK_NUMBER.test(ref)
        ? await findTaskByNumber(database, found.scope, Number(ref))
        : undefined;
    return task === undefined ? noSuchTask(c) : c.json(restTask(task));
  });

  app.patch(`${PROJECT}/tasks/:id`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const patch = await bodyOf(c, restTaskPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchTask(c);
    }
    try {
      const task = await updateTask(database, {
        scope: found.scope,
        actor: found.actor,
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

  app.get(`${PROJECT}/decisions`, async (c) => {
    const query = decisionsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const items = await listDecisions(database, found.scope, {
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      taskId: query.data.task,
      limit: LIST_LIMIT,
    });
    const body: RestDecisions = { items: items.map(restDecision) };
    return c.json(body);
  });

  app.post(`${PROJECT}/decisions`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restDecisionInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const fromRun = input.runId !== undefined && input.runId !== null;
    try {
      const decision = await raiseDecision(database, {
        scope: found.scope,
        actor: found.actor,
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
          person: found.person.id,
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
  app.get(`${PROJECT}/decisions/:id`, async (c) => {
    const query = decisionQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchDecision(c);
    }
    const decision = await waitForAnswer(
      found.scope,
      id,
      Math.min(query.data.wait * 1000, agents.waitMs),
    );
    return decision === undefined ? noSuchDecision(c) : c.json(restDecision(decision));
  });

  // The record of a decision grows: its context, or what followed, by anyone who works in the project.
  app.patch(`${PROJECT}/decisions/:id`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const patch = await bodyOf(c, restDecisionPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchDecision(c);
    }
    try {
      const decision = await updateDecision(database, {
        scope: found.scope,
        actor: found.actor,
        decisionId: id,
        patch,
        now: clock.now(),
      });
      return c.json(restDecision(decision));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${PROJECT}/decisions/:id/answer`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
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
        scope: found.scope,
        actor: found.actor,
        decisionId: id,
        option: input.option,
        note: input.note,
        now: clock.now(),
      });
      logger.info(
        { person: found.person.id, decision: decision.id, requestId: c.get("requestId") },
        "decision answered",
      );
      return c.json(restDecision(decision));
    } catch (error) {
      return failure(c, error);
    }
  });

  // The runs: agents at work, and what they did. An agent writes them as its person, with its
  // token; a person reads them, and gives up on one that will not come back.
  app.get(`${PROJECT}/runs`, async (c) => {
    const query = runsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const mine = query.data.mine === "true";
    const items = await listRuns(database, found.scope, {
      taskId: query.data.task,
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      // An agent's own runs are the ones begun with its token; a person's, the ones for them.
      tokenId: mine && found.token !== undefined ? found.token.id : undefined,
      personId: mine && found.token === undefined ? found.person.id : undefined,
      limit: LIST_LIMIT,
    });
    const body: RestRuns = { items: items.map(restRun) };
    return c.json(body);
  });

  app.post(`${PROJECT}/runs`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restRunInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const { person, token } = found;
    try {
      const run = await startRun(database, {
        scope: found.scope,
        actor: found.actor,
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

  app.get(`${PROJECT}/runs/:id`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id");
    const run = UUID.test(id) ? await getRun(database, found.scope, id) : undefined;
    return run === undefined ? noSuchRun(c) : c.json(restRun(run));
  });

  app.post(`${PROJECT}/runs/:id/reports`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
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
        scope: found.scope,
        actor: found.actor,
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

  app.post(`${PROJECT}/runs/:id/artifacts`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
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
        scope: found.scope,
        actor: found.actor,
        runId: id,
        handedIn: { kind: "link", url: input.url },
        label: input.label,
        limit: MAX_ARTIFACTS_PER_RUN,
        now: clock.now(),
      });
      return c.json(restRun(run), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // A file handed in, as the parts of a form: the bytes go to the blob store under their hash,
  // the rest to the run. The run is looked at before the bytes are kept, so that a file sent to
  // another's run or to one that is over costs nothing, and again under the lock.
  app.post(`${PROJECT}/runs/:id/files`, formTooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchRun(c);
    }
    const sent = await filePartOf(c);
    if (sent instanceof Response) {
      return sent;
    }
    const run = await getRun(database, found.scope, id);
    if (run === undefined) {
      return noSuchRun(c);
    }
    if (run.person.id !== found.person.id) {
      return failure(c, new RunError("run.not_yours"));
    }
    if (!OPEN_RUN_STATUSES.includes(run.status)) {
      return failure(c, new RunError("run.over"));
    }
    const kept = await blobs.put(new Uint8Array(await sent.part.arrayBuffer()), clock.now());
    try {
      const written = await addArtifact(database, {
        scope: found.scope,
        actor: found.actor,
        runId: id,
        handedIn: {
          kind: "file",
          file: {
            name: sent.name,
            size: kept.size,
            contentType: sent.contentType,
            sha256: kept.sha256,
          },
        },
        label: sent.label,
        limit: MAX_ARTIFACTS_PER_RUN,
        now: clock.now(),
      });
      return c.json(restRun(written), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // The bytes of a file handed in, for whoever may see the project.
  app.get(`${PROJECT}/files/:id`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id");
    const artifact = UUID.test(id) ? await findArtifact(database, found.scope, id) : undefined;
    if (artifact?.file === undefined) {
      return noSuchFile(c);
    }
    return serveFile(c, artifact.file, { artifact: artifact.id });
  });

  app.post(`${PROJECT}/runs/:id/end`, tooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restRunEndInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchRun(c);
    }
    const { person, token } = found;
    try {
      const run = await endRun(database, {
        scope: found.scope,
        actor: found.actor,
        runId: id,
        status: input.status,
        summary: input.summary,
        // Giving up on anyone's run is an owner's own doing, on the console's own pages; an
        // agent, with a token, ends only the runs that are its person's.
        anyone:
          input.status === "abandoned" && found.project.role === "owner" && token === undefined,
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

  // The project's skills, as the SkillCDN deployment serves them at its address, or the organization's.
  app.get(`${PROJECT}/skills`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const body: RestSkills = await skills.read(found.project.skillsAddress);
    return c.json(body);
  });

  // The documents of the project (ADR-0009): pages under a path, read by whoever may see the
  // project, written by whoever may work in it, a person as an agent. The path is one segment
  // of the URL, its slashes encoded.

  app.get(`${PROJECT}/docs`, async (c) => {
    const query = documentsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const archived = query.data.archived === "true";
    if (query.data.q !== undefined) {
      const items = await searchDocuments(database, found.scope, {
        query: query.data.q,
        archived,
        limit: LIST_LIMIT,
      });
      const body: RestDocuments = {
        folder: "",
        folders: [],
        items: items.map(restDocumentSummary),
      };
      return c.json(body);
    }
    const listing = await listDocuments(database, found.scope, {
      folder: query.data.folder,
      archived,
      limit: LIST_LIMIT,
    });
    const body: RestDocuments = {
      folder: query.data.folder,
      folders: listing.folders,
      items: listing.items.map(restDocumentSummary),
    };
    return c.json(body);
  });

  app.get(`${PROJECT}/docs/:path`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const path = documentPathOf(c);
    const document =
      path === undefined ? undefined : await getDocument(database, found.scope, path);
    return document === undefined ? noSuchDocument(c) : c.json(restDocument(document));
  });

  // Writing a page: the first version at a new path (201), or the next version of the page there.
  app.put(`${PROJECT}/docs/:path`, documentTooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const path = documentPathOf(c);
    if (path === undefined) {
      return c.json(
        errorBody(
          "document.invalid_path",
          "The path must be segments of lowercase letters, digits and hyphens, separated by slashes.",
        ),
        400,
      );
    }
    const input = await bodyOf(c, restDocumentInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const { document, created } = await writeDocument(database, {
        scope: found.scope,
        actor: found.actor,
        path,
        title: input.title,
        body: input.body,
        baseVersion: input.baseVersion,
        maxVersions: MAX_VERSIONS_PER_DOCUMENT,
        now: clock.now(),
      });
      logger.info(
        {
          person: found.person.id,
          document: document.id,
          version: document.version,
          requestId: c.get("requestId"),
        },
        "document written",
      );
      return c.json(restDocument(document), created ? 201 : 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const) {
    app.post(`${PROJECT}/docs/:path/${action}`, async (c) => {
      const found = await changing(c);
      if (found instanceof Response) {
        return found;
      }
      const path = documentPathOf(c);
      if (path === undefined) {
        return noSuchDocument(c);
      }
      try {
        const document = await setArchived(database, {
          scope: found.scope,
          actor: found.actor,
          path,
          archived,
          now: clock.now(),
        });
        return c.json(restDocument(document));
      } catch (error) {
        return failure(c, error);
      }
    });
  }

  app.get(`${PROJECT}/docs/:path/versions`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const path = documentPathOf(c);
    const versions =
      path === undefined ? undefined : await listVersions(database, found.scope, path, LIST_LIMIT);
    if (versions === undefined) {
      return noSuchDocument(c);
    }
    const body: RestVersions = { items: versions.map(restVersionSummary) };
    return c.json(body);
  });

  app.get(`${PROJECT}/docs/:path/versions/:number`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const path = documentPathOf(c);
    const ref = c.req.param("number");
    if (path === undefined) {
      return noSuchDocument(c);
    }
    const version = VERSION_NUMBER.test(ref)
      ? await getVersion(database, found.scope, path, Number(ref))
      : undefined;
    if (version !== undefined) {
      return c.json(restVersion(version));
    }
    return (await findDocumentId(database, found.scope, path)) === undefined
      ? noSuchDocument(c)
      : notFound(c, "document.version_not_found", "The page has no such version.");
  });

  // A file attached to a page, as the parts of a form: the bytes go to the blob store under
  // their hash, the rest to the page. The page is looked at before the bytes are kept.
  app.post(`${PROJECT}/docs/:path/files`, formTooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const path = documentPathOf(c);
    if (path === undefined) {
      return noSuchDocument(c);
    }
    const sent = await filePartOf(c);
    if (sent instanceof Response) {
      return sent;
    }
    const document = await getDocument(database, found.scope, path);
    if (document === undefined) {
      return noSuchDocument(c);
    }
    if (document.archivedAt !== undefined) {
      return failure(c, new DocumentError("document.archived"));
    }
    if (document.files.length >= MAX_FILES_PER_DOCUMENT) {
      return failure(c, new DocumentError("document.too_many_files"));
    }
    const kept = await blobs.put(new Uint8Array(await sent.part.arrayBuffer()), clock.now());
    try {
      const written = await attachFile(database, {
        scope: found.scope,
        actor: found.actor,
        path,
        file: {
          name: sent.name,
          size: kept.size,
          contentType: sent.contentType,
          sha256: kept.sha256,
        },
        label: sent.label,
        limit: MAX_FILES_PER_DOCUMENT,
        now: clock.now(),
      });
      return c.json(restDocument(written), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PROJECT}/docs/:path/files/:id`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const path = documentPathOf(c);
    const id = c.req.param("id");
    const file =
      path === undefined || !UUID.test(id)
        ? undefined
        : await findDocumentFile(database, found.scope, path, id);
    if (file === undefined) {
      return noSuchFile(c);
    }
    return serveFile(c, file.file, { documentFile: file.id });
  });

  app.get(`${PROJECT}/events`, async (c) => {
    const query = eventsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const page = await listEventsAfter(
      database,
      {
        ...found.scope,
        taskId: query.data.task,
        runId: query.data.run,
        decisionId: query.data.decision,
        documentId: query.data.document,
      },
      query.data.after,
      query.data.limit,
    );
    const body: RestEvents = { items: page.items.map(restEvent), more: page.more };
    return c.json(body);
  });

  // The feed as it happens: one event per message, numbered, so that a browser that reconnects
  // says where it was (`Last-Event-ID`) and misses nothing. Heartbeats are comments.
  app.get(`${PROJECT}/events/stream`, async (c) => {
    const query = eventsQuery.safeParse({ after: c.req.query("after") ?? "0" });
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const lastSeen = Number(c.req.header("last-event-id"));
    const after =
      Number.isInteger(lastSeen) && lastSeen >= 0
        ? Math.max(lastSeen, query.data.after)
        : query.data.after;
    await workspace();
    const subscription = feed.subscribe(after, found.scope);
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
