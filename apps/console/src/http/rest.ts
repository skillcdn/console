import {
  CLAIM_PATH,
  EVENTS_PAGE_LIMIT,
  GOAL_STATES,
  hasForbiddenCodePoint,
  isDocumentPath,
  isFolderPath,
  LIST_LIMIT,
  MAX_ARTIFACTS_PER_RUN,
  MAX_CATEGORY_KEY_LENGTH,
  MAX_COMMENTS_PER_TASK,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_FILE_BYTES,
  MAX_FILES_PER_COMMENT,
  MAX_FILES_PER_DOCUMENT,
  MAX_LOGIN_LENGTH,
  MAX_PROJECT_ICON_BYTES,
  MAX_PROJECT_KEY_LENGTH,
  MAX_REPORTS_PER_RUN,
  MAX_RULES_LENGTH,
  MAX_SEARCH_LENGTH,
  MAX_VERSIONS_PER_DOCUMENT,
  normalizeConnectCode,
  type ProjectIconType,
  type ProviderKey,
  REST_ROUTES,
  type RestArchivedTasks,
  type RestCategories,
  type RestClaim,
  type RestComments,
  type RestConnection,
  type RestConnectRequest,
  type RestDecisions,
  type RestDocuments,
  type RestEvents,
  type RestGoals,
  type RestMembers,
  type RestMyDecisions,
  type RestPackConnect,
  type RestPackConnectStarted,
  type RestPeople,
  type RestPersonWork,
  type RestProjectRules,
  type RestProjects,
  type RestRuns,
  type RestSkillBrowse,
  type RestSkillFile,
  type RestSkillFind,
  type RestSkillLoad,
  type RestSkills,
  type RestTasks,
  type RestTokenCreated,
  type RestTokens,
  type RestVersions,
  type RestWork,
  type RestWorkspace,
  type RestWorkspacePackConnect,
  RULES_PATH,
  RULES_TITLE,
  restAnswerInputSchema,
  restArchiveTasksInputSchema,
  restArtifactInputSchema,
  restCategoryInputSchema,
  restCategoryPatchSchema,
  restClaimInputSchema,
  restCommentInputSchema,
  restConnectInputSchema,
  restDecisionInputSchema,
  restDecisionPatchSchema,
  restDocumentInputSchema,
  restFileInputSchema,
  restGoalInputSchema,
  restGoalPatchSchema,
  restListingInputSchema,
  restMemberInputSchema,
  restMemberPatchSchema,
  restPackTokenInputSchema,
  restPersonPatchSchema,
  restProjectInputSchema,
  restProjectPatchSchema,
  restReportInputSchema,
  restRulesInputSchema,
  restRunEndInputSchema,
  restRunInputSchema,
  restTaskInputSchema,
  restTaskPatchSchema,
  restTokenInputSchema,
  rulesPath,
  TASK_STATES,
} from "@skillcdn/console/api";
import {
  CONNECT_AGENT_MAX_LENGTH,
  formatAddress,
  LOCAL_HOST_KEY,
  parseAddress,
  type RestConnectClaimed,
  type RestConnectStarted,
} from "@skillcdn/core";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import * as z from "zod";
import type { Connections } from "../auth/connect.js";
import {
  configuresWorkspace,
  personFindableBy,
  personVisibleTo,
  readsListings,
  readsWorkspaceEvents,
} from "../auth/policy.js";
import type { Secrets } from "../auth/secrets.js";
import type { Tokens } from "../auth/tokens.js";
import type { Database } from "../db/client.js";
import {
  CategoryError,
  createCategory,
  listCategories,
  removeCategory,
  updateCategory,
} from "../db/queries/categories.js";
import {
  CommentError,
  findCommentFile,
  listComments,
  writeComment,
} from "../db/queries/comments.js";
import { ConnectError, type ConnectRequestRecord } from "../db/queries/connect.js";
import {
  answerDecision,
  DecisionError,
  type DecisionRecord,
  getDecision,
  listDecisions,
  listDecisionsFor,
  listWaitingDecisionsFor,
  raiseDecision,
  updateDecision,
} from "../db/queries/decisions.js";
import {
  attachFile,
  DocumentError,
  findDocumentFile,
  findDocumentFileById,
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
import { createGoal, GoalError, getGoal, listGoals, updateGoal } from "../db/queries/goals.js";
import {
  endPackConnect,
  type PackConnectRecord,
  readPackConnect,
  startPackConnect,
} from "../db/queries/pack-connects.js";
import {
  createListing,
  deleteListing,
  findPerson,
  ListingError,
  listListings,
  listPeople,
  PersonError,
  type PersonRecord,
  updatePersonRole,
  updatePersonStatus,
} from "../db/queries/people.js";
import {
  addMember,
  createProject,
  findProjectFor,
  listMembers,
  listProjectsFor,
  ownsAProject,
  ownsProjectWith,
  ProjectError,
  type ProjectRecord,
  type ProjectView,
  removeMember,
  setPackToken,
  setProjectIcon,
  updateMember,
  updateProject,
} from "../db/queries/projects.js";
import { archiveRules, readRules, writeRules } from "../db/queries/rules.js";
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
  archiveTask,
  archiveTasksOfGoal,
  createTask,
  findTaskByNumber,
  getTask,
  listClosedTasksOf,
  listTasks,
  listTasksOf,
  restoreTask,
  TaskError,
  type TaskRecord,
  updateTask,
} from "../db/queries/tasks.js";
import { TokenError, type TokenRecord } from "../db/queries/tokens.js";
import {
  membersSyncedAt,
  readWorkspacePackToken,
  readWorkspaceSettings,
  setWorkspacePackToken,
  type WorkspaceRecord,
  type WorkspaceSettings,
} from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import { type BlobStore, BlobStoreError } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import { type PackConnector, PackError } from "../ports/skill-source.js";
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
  restCategory,
  restComment,
  restDecision,
  restDocument,
  restDocumentSummary,
  restEvent,
  restGoal,
  restListing,
  restMember,
  restPerson,
  restProject,
  restRules,
  restRun,
  restTask,
  restToken,
  restVersion,
  restVersionSummary,
} from "./rest-shapes.js";
import { restWorkspace } from "./workspace.js";

/** What a read of the pack is asked with: a path from the repository's root, bounded, and where to go on. */
const skillQuerySchema = z.object({
  path: z.string().min(1).max(500),
  cursor: z.string().max(4000).optional(),
});
const fileQuerySchema = z.object({
  path: z.string().min(1).max(500),
  offset: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
});
/** What a folder is browsed with, and what a search is asked with: the bounds the deployment states. */
const browseQuerySchema = z.object({
  path: z.string().max(500).optional(),
  cursor: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const findQuerySchema = z.object({
  query: z.string().min(1).max(500),
  path: z.string().max(500).optional(),
  cursor: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export interface RestDependencies {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly access: Access;
  /** The tokens people make; left out where nobody signs in, and then nobody has one. */
  readonly tokens: Tokens | undefined;
  /** Agents connecting with a code (ADR-0011); left out where nobody signs in. */
  readonly connections: Connections | undefined;
  readonly feed: LiveFeed;
  /** Where the bytes of files handed in are kept. */
  readonly blobs: BlobStore;
  /** The skills of a project, read by address. */
  readonly skills: Skills;
  /** Connecting a project's pack with a code at the deployment (ADR-0036); left out where no deployment is reached. */
  readonly packConnector: PackConnector | undefined;
  /** Seals the pack token a project holds (ADR-0028); left out where nobody signs in, and then no project holds one. */
  readonly secrets: Secrets | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly agents: {
    /** How long a read of a decision may wait for its answer before answering that it still waits. */
    readonly waitMs: number;
  };
  /** The providers people sign in through: what a listing may name. None where nobody signs in. */
  readonly signIn: readonly ProviderKey[];
  /** The organization at the git host whose members are in (ADR-0022), when one is named. */
  readonly organization: { readonly host: ProviderKey; readonly name: string } | undefined;
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
/**
 * The kind of image bytes begin as, by their first bytes, or nothing: an image for a project's
 * mark is one the pages show in place, and what the file says of itself is not believed.
 */
function imageTypeOf(bytes: Uint8Array): ProjectIconType | undefined {
  const at = (index: number, ...expected: number[]) =>
    expected.every((byte, offset) => bytes[index + offset] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (at(0, 0xff, 0xd8, 0xff)) {
    return "image/jpeg";
  }
  if (
    at(0, 0x47, 0x49, 0x46, 0x38) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return "image/webp";
  }
  return undefined;
}
const ICON_EXTENSIONS: Readonly<Record<ProjectIconType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Whether a request carries a form, with files in it, rather than JSON. */
const isForm = (c: Context<AppEnv>): boolean =>
  (c.req.header("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
/** A task's number in a path: what people say out loud, where the pages say the id. */
const TASK_NUMBER = /^[1-9]\d{0,8}$/;
/** A project's key in a path, as the package's schema has it; anything else is not found. */
const PROJECT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A category's key in a path, spelled the same way. */
const CATEGORY_KEY = PROJECT_KEY;
/** A day as the plan is made in: `2026-10-20`. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A version's number in a path. */
const VERSION_NUMBER = /^[1-9]\d{0,8}$/;
/** The most a read of a decision may ask to wait, in seconds; the server's own bound is lower. */
const MAX_WAIT_SECONDS = 600;
const DAY_MS = 86_400_000;

/** The board of one project: `/api/v1/projects/:key/...`. */
const PROJECT = `${REST_ROUTES.projects}/:key`;

/** One page of a listing: at most `LIST_LIMIT`, the whole listing when nothing is asked. */
const page = {
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT).default(LIST_LIMIT),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
};
const tasksQuery = z.object({
  state: z.enum(TASK_STATES).optional(),
  open: z.enum(["true", "false"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
  category: z.string().max(MAX_CATEGORY_KEY_LENGTH).regex(CATEGORY_KEY).optional(),
  goal: z.string().regex(UUID).optional(),
  worker: z.string().regex(UUID).optional(),
  unassigned: z.enum(["true", "false"]).optional(),
  dueBy: z.string().regex(DAY).optional(),
  q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
  ...page,
});
const decisionsQuery = z.object({
  open: z.enum(["true", "false"]).optional(),
  task: z.string().regex(UUID).optional(),
  ...page,
});
const myDecisionsQuery = z.object({
  open: z.enum(["true", "false"]).optional(),
  ...page,
});
const goalsQuery = z.object({
  state: z.enum(GOAL_STATES).optional(),
  open: z.enum(["true", "false"]).optional(),
  category: z.string().max(MAX_CATEGORY_KEY_LENGTH).regex(CATEGORY_KEY).optional(),
  q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
  ...page,
});
const decisionQuery = z.object({
  wait: z.coerce.number().int().min(0).max(MAX_WAIT_SECONDS).default(0),
});
const runsQuery = z.object({
  task: z.string().regex(UUID).optional(),
  open: z.enum(["true", "false"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  ...page,
});
const eventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(EVENTS_PAGE_LIMIT).default(EVENTS_PAGE_LIMIT),
  task: z.string().regex(UUID).optional(),
  run: z.string().regex(UUID).optional(),
  decision: z.string().regex(UUID).optional(),
  document: z.string().regex(UUID).optional(),
  goal: z.string().regex(UUID).optional(),
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
  const {
    database,
    workspace,
    access,
    tokens,
    connections,
    feed,
    blobs,
    skills,
    packConnector,
    secrets,
    clock,
    logger,
    agents,
    signIn,
    organization,
  } = dependencies;

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
   * The person signed in, or the refusal to answer with: what the tokens themselves are managed
   * by, and what an agent's connection is approved by, which makes one. A token cannot make,
   * list or remove tokens, so that one which leaks cannot outlive its removal through tokens of
   * its own; everything else a person may do, their agent may do with their token (ADR-0021).
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
  const noSuchGoal = (c: Context<AppEnv>) =>
    notFound(c, "goal.not_found", "The goal was not found.");
  const noSuchCategory = (c: Context<AppEnv>) =>
    notFound(c, "category.not_found", "The category was not found.");
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
  /**
   * Configuring it, and setting its roadmap: an owner, from the console's own pages or with a
   * token, since an owner's agent configures as its owner does (ADR-0021).
   */
  const owning = async (c: Context<AppEnv>): Promise<InProject | Response> => {
    const found = await changing(c);
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
  // A comment comes as JSON, bounded as a body is, or as a form with its files, bounded as a
  // file is: the files of one comment are together what one file may be.
  const commentFormTooLarge = bodyLimit({
    maxSize: MAX_FILE_BYTES + FORM_OVERHEAD_BYTES,
    onError: (c) =>
      c.json(
        errorBody(
          "request.too_large",
          `The files of a comment are over ${MAX_FILE_BYTES} bytes together.`,
        ),
        413,
      ),
  });
  const commentTooLarge: MiddlewareHandler<AppEnv> = (c, next) =>
    isForm(c) ? commentFormTooLarge(c, next) : tooLarge(c, next);
  const iconTooLarge = (c: Context<AppEnv>): Response =>
    c.json(
      errorBody("request.too_large", `The image is over ${MAX_PROJECT_ICON_BYTES} bytes.`),
      413,
    );
  const iconFormTooLarge = bodyLimit({
    maxSize: MAX_PROJECT_ICON_BYTES + FORM_OVERHEAD_BYTES,
    onError: iconTooLarge,
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
    if (error instanceof ListingError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "listing.not_found" ? 404 : 409,
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
            : error.code === "run.over" || error.code === "run.task_closed"
              ? 409
              : 400;
      return c.json(errorBody(error.code, error.message), status);
    }
    if (error instanceof TokenError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "token.not_found" ? 404 : error.code === "token.expiry_at_most" ? 400 : 409,
      );
    }
    if (error instanceof ConnectError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "connect.not_found" ? 404 : error.code === "connect.too_many" ? 429 : 409,
      );
    }
    if (error instanceof DocumentError) {
      const status =
        error.code === "document.not_found" || error.code === "document.version_not_found"
          ? 404
          : 409;
      return c.json(errorBody(error.code, error.message), status);
    }
    if (error instanceof CommentError) {
      return c.json(errorBody(error.code, error.message), 400);
    }
    if (error instanceof GoalError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "goal.not_found" ? 404 : 400,
      );
    }
    if (error instanceof CategoryError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "category.not_found" ? 404 : 409,
      );
    }
    if (error instanceof BlobStoreError) {
      // The store is the deployment's to fix; a client can only try again later.
      logger.error({ err: error, requestId: c.get("requestId") }, "the blob store failed");
      c.header("retry-after", "30");
      return c.json(
        errorBody(
          "file.store_unavailable",
          "The files of the console could not be reached. Try again later.",
        ),
        503,
      );
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
   * A comment as the parts of a form: the part `body`, and a part `file` for each file put in
   * it, each checked as a file handed in is; or the refusal. The parts are read before any
   * byte is kept, so that a form with one bad file keeps nothing.
   */
  const commentPartsOf = async (
    c: Context<AppEnv>,
  ): Promise<
    | {
        readonly body: string;
        readonly files: readonly {
          readonly part: File;
          readonly name: string;
          readonly contentType: string;
        }[];
      }
    | Response
  > => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return invalid(c, "The request body is not a form.");
    }
    const bodyPart = form.get("body");
    const parsedBody = restCommentInputSchema.safeParse({
      body: typeof bodyPart === "string" ? bodyPart : "",
    });
    if (!parsedBody.success) {
      return invalid(c, firstProblem(parsedBody));
    }
    const parts = form.getAll("file");
    if (parts.length > MAX_FILES_PER_COMMENT) {
      return invalid(c, `file: at most ${MAX_FILES_PER_COMMENT} files on one comment.`);
    }
    const files: { part: File; name: string; contentType: string }[] = [];
    for (const part of parts) {
      if (!(part instanceof File)) {
        return invalid(c, "file: every part called file is a file.");
      }
      const type = part.type.split(";")[0]?.trim() ?? "";
      const parsed = restFileInputSchema.safeParse({
        name: part.name,
        ...(type.length === 0 ? {} : { contentType: type }),
      });
      if (!parsed.success || parsed.data === undefined) {
        return invalid(c, firstProblem(parsed));
      }
      if (part.size === 0) {
        return invalid(c, `file: ${parsed.data.name} is empty.`);
      }
      if (part.size > MAX_FILE_BYTES) {
        return fileTooLarge(c);
      }
      files.push({
        part,
        name: parsed.data.name,
        contentType: parsed.data.contentType ?? "application/octet-stream",
      });
    }
    return { body: parsedBody.data.body, files };
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
    let bytes: Uint8Array | undefined;
    try {
      bytes = await blobs.get(file.sha256);
    } catch (error) {
      return failure(c, error);
    }
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

  // Who sees whom is the policy's (ADR-0035): the people the asker may see, or, with `login`, the
  // one person they may find by that login, so as to list them in a project they configure. The
  // logins let in and the organization's reading say who is in beyond that, so they go with the
  // listing only, and only to whom the policy shows everyone.
  app.get(REST_ROUTES.people, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const login = c.req.query("login");
    if (
      login !== undefined &&
      (login.trim().length === 0 || login.length > MAX_LOGIN_LENGTH || hasForbiddenCodePoint(login))
    ) {
      return invalid(c, "login: must be a login");
    }
    const settings = await readWorkspaceSettings(database, person.workspaceId);
    const visible =
      login === undefined
        ? personVisibleTo(person, settings)
        : personFindableBy(
            person,
            settings,
            await ownsAProject(database, person.workspaceId, person.id),
          );
    const whole = login === undefined && readsListings(person, settings);
    const [items, listed, syncedAt] = await Promise.all([
      listPeople(database, person.workspaceId, { visible, login: login?.trim() }),
      whole ? listListings(database, person.workspaceId) : [],
      whole && organization !== undefined
        ? membersSyncedAt(database, person.workspaceId)
        : undefined,
    ]);
    const body: RestPeople = {
      items: items.map(restPerson),
      listed: listed.map(restListing),
      organization:
        organization === undefined || !whole
          ? null
          : {
              host: organization.host,
              name: organization.name,
              syncedAt: syncedAt?.toISOString() ?? null,
            },
    };
    return c.json(body);
  });

  // What a person is, and whether they are in: said by an administrator, themselves or through
  // their agent (ADR-0021, ADR-0022).
  app.patch(`${REST_ROUTES.people}/:id`, tooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
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
      let changed: PersonRecord | undefined;
      if (patch.role !== undefined) {
        changed = await updatePersonRole(database, {
          workspaceId: person.workspaceId,
          actor: actorOf(caller),
          personId: id,
          role: patch.role,
          now: clock.now(),
        });
      }
      if (patch.status !== undefined) {
        changed = await updatePersonStatus(database, {
          workspaceId: person.workspaceId,
          actor: actorOf(caller),
          personId: id,
          status: patch.status,
          now: clock.now(),
        });
      }
      if (changed === undefined) {
        return invalid(c, "The patch names nothing to change.");
      }
      logger.info(
        {
          person: person.id,
          subject: changed.id,
          role: changed.role,
          status: changed.status,
          requestId: c.get("requestId"),
        },
        "person changed",
      );
      return c.json(restPerson(changed));
    } catch (error) {
      return failure(c, error);
    }
  });

  // Who may sign in, by login (ADR-0022): an administrator lets a login in, and takes one away
  // that nobody signed in with; a person who did is deactivated instead.
  app.post(REST_ROUTES.listings, tooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    if (person.role !== "admin") {
      return administratorRequired(c);
    }
    const input = await bodyOf(c, restListingInputSchema);
    if (input instanceof Response) {
      return input;
    }
    if (!signIn.includes(input.host)) {
      return c.json(
        errorBody("listing.unknown_host", "Nobody signs in through that provider here."),
        400,
      );
    }
    try {
      const listing = await createListing(database, {
        workspaceId: person.workspaceId,
        actor: actorOf(caller),
        host: input.host,
        login: input.login,
        now: clock.now(),
      });
      logger.info(
        { person: person.id, listing: listing.id, requestId: c.get("requestId") },
        "a login was let in",
      );
      return c.json(restListing(listing), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${REST_ROUTES.listings}/:id`, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    if (person.role !== "admin") {
      return administratorRequired(c);
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return notFound(c, "listing.not_found", "The listing was not found.");
    }
    try {
      await deleteListing(database, {
        workspaceId: person.workspaceId,
        actor: actorOf(caller),
        listingId: id,
        now: clock.now(),
      });
      return c.body(null, 204);
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

  // A project is made by a person, themselves or through their agent, who becomes its owner.
  app.post(REST_ROUTES.projects, tooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
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
        actor: actorOf(caller),
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

  // The categories tasks are sorted into (ADR-0019): read by anyone, kept by an administrator,
  // themselves or through their agent (ADR-0021).
  app.get(REST_ROUTES.categories, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const body: RestCategories = {
      items: (await listCategories(database, person.workspaceId)).map(restCategory),
    };
    return c.json(body);
  });

  app.post(REST_ROUTES.categories, tooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    if (person.role !== "admin") {
      return administratorRequired(c);
    }
    const input = await bodyOf(c, restCategoryInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const category = await createCategory(database, {
        workspaceId: person.workspaceId,
        actor: actorOf(caller),
        category: input,
        now: clock.now(),
      });
      logger.info(
        { person: person.id, category: category.key, requestId: c.get("requestId") },
        "category created",
      );
      return c.json(restCategory(category), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  /** The category's key in the path, or nothing for text that is not one. */
  const categoryKeyOf = (c: Context<AppEnv>): string | undefined => {
    const key = c.req.param("key") ?? "";
    return key.length <= MAX_CATEGORY_KEY_LENGTH && CATEGORY_KEY.test(key) ? key : undefined;
  };

  app.patch(`${REST_ROUTES.categories}/:key`, tooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    if (person.role !== "admin") {
      return administratorRequired(c);
    }
    const patch = await bodyOf(c, restCategoryPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const key = categoryKeyOf(c);
    if (key === undefined) {
      return noSuchCategory(c);
    }
    try {
      const category = await updateCategory(database, {
        workspaceId: person.workspaceId,
        actor: actorOf(caller),
        key,
        patch,
        now: clock.now(),
      });
      return c.json(restCategory(category));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${REST_ROUTES.categories}/:key`, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    const { person } = caller;
    if (person.role !== "admin") {
      return administratorRequired(c);
    }
    const key = categoryKeyOf(c);
    if (key === undefined) {
      return noSuchCategory(c);
    }
    try {
      await removeCategory(database, {
        workspaceId: person.workspaceId,
        actor: actorOf(caller),
        key,
        now: clock.now(),
      });
      logger.info(
        { person: person.id, category: key, requestId: c.get("requestId") },
        "category removed",
      );
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  /** The projects a plate's tasks are in, as a page says and links them; nothing for one the asker may not see. */
  const projectRefsOf = (
    found: readonly Pick<ProjectRecord, "id" | "key" | "name" | "color" | "symbol" | "icon">[],
  ) => {
    const named = new Map(found.map((project) => [project.id, project]));
    return (projectId: string) => {
      const project = named.get(projectId);
      return project === undefined
        ? undefined
        : {
            key: project.key,
            name: project.name,
            color: project.color ?? null,
            symbol: project.symbol ?? null,
            icon: project.icon ?? null,
          };
    };
  };

  // What is on the asker's plate, across the projects they may see: their open tasks, what of
  // theirs was done or dropped and is not put away yet, for the week on the plate, and the
  // decisions waiting for a person. Each with its project, for the page to say and link.
  // The decisions addressed to the asker (ADR-0042) across the projects they may see: a page,
  // the waiting first, each with its project, for the person's own page of them.
  app.get(REST_ROUTES.decisions, async (c) => {
    const query = myDecisionsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const [projects, page] = await Promise.all([
      listProjectsFor(database, person.workspaceId, person),
      listDecisionsFor(database, person.workspaceId, person, {
        open: query.data.open === undefined ? undefined : query.data.open === "true",
        limit: query.data.limit,
        offset: query.data.offset,
      }),
    ]);
    const projectOf = projectRefsOf(projects);
    const body: RestMyDecisions = {
      items: page.items.flatMap((decision) => {
        const project = projectOf(decision.projectId);
        return project === undefined ? [] : [{ project, decision: restDecision(decision) }];
      }),
      more: page.more,
    };
    return c.json(body);
  });

  app.get(REST_ROUTES.work, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const [projects, tasks, closed, decisions] = await Promise.all([
      listProjectsFor(database, person.workspaceId, person),
      listTasksOf(database, person.workspaceId, person, person, LIST_LIMIT),
      listClosedTasksOf(database, person.workspaceId, person, person, LIST_LIMIT),
      listWaitingDecisionsFor(database, person.workspaceId, person, LIST_LIMIT),
    ]);
    const projectOf = projectRefsOf(projects);
    const withProject = (task: TaskRecord) => {
      const project = projectOf(task.projectId);
      return project === undefined ? [] : [{ project, task: restTask(task) }];
    };
    const body: RestWork = {
      tasks: tasks.flatMap(withProject),
      closed: closed.flatMap(withProject),
      decisions: decisions.flatMap((decision) => {
        const project = projectOf(decision.projectId);
        return project === undefined ? [] : [{ project, decision: restDecision(decision) }];
      }),
    };
    return c.json(body);
  });

  // Another person's plate, for whoever oversees them: an administrator, or an owner of a
  // project the person is in; the tasks within the projects the asker may see and no other.
  // The decisions are left out, since they wait for anyone.
  app.get(`${REST_ROUTES.people}/:id/work`, async (c) => {
    const asker = await asking(c);
    if (asker instanceof Response) {
      return asker;
    }
    const id = c.req.param("id") ?? "";
    const subject = UUID.test(id) ? await findPerson(database, asker.workspaceId, id) : undefined;
    if (subject === undefined) {
      return notFound(c, "person.not_found", "The person was not found.");
    }
    if (
      asker.role !== "admin" &&
      !(await ownsProjectWith(database, asker.workspaceId, asker.id, subject.id))
    ) {
      return c.json(
        errorBody(
          "auth.forbidden",
          "Only an administrator, or an owner of a project the person is in, sees their work.",
        ),
        403,
      );
    }
    const [projects, tasks, closed] = await Promise.all([
      listProjectsFor(database, asker.workspaceId, asker),
      listTasksOf(database, asker.workspaceId, subject, asker, LIST_LIMIT),
      listClosedTasksOf(database, asker.workspaceId, subject, asker, LIST_LIMIT),
    ]);
    const projectOf = projectRefsOf(projects);
    const withProject = (task: TaskRecord) => {
      const project = projectOf(task.projectId);
      return project === undefined ? [] : [{ project, task: restTask(task) }];
    };
    const body: RestPersonWork = {
      tasks: tasks.flatMap(withProject),
      closed: closed.flatMap(withProject),
    };
    return c.json(body);
  });

  // The workspace's own events: what happened to its people, which no project holds; read by
  // whom the policy shows everyone (ADR-0035).
  app.get(REST_ROUTES.events, async (c) => {
    const query = eventsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    if (!readsWorkspaceEvents(person, await readWorkspaceSettings(database, person.workspaceId))) {
      return administratorRequired(c);
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
      // Left out, a token is good for the default; `null` is a token that does not expire,
      // where the organization allows one.
      const days = tokens.daysOf(input.expiresInDays);
      const made = await tokens.issue(person, {
        name: input.name,
        ttlMs: days === undefined ? undefined : days * DAY_MS,
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

  // A token gives itself up: what `console logout` does, so that a token forgotten on a machine
  // does not outlive it. The one thing a token does about the tokens; a session has none to give.
  app.delete(REST_ROUTES.meToken, async (c) => {
    const caller = await askingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    if (caller.token === undefined) {
      return invalid(
        c,
        "A session has no token to give up: a token is removed on the Agents page.",
      );
    }
    if (tokens === undefined || !(await tokens.revoke(caller.person, caller.token.id))) {
      return notFound(c, "token.not_found", "The token was not found.");
    }
    logger.info(
      { person: caller.person.id, tokenId: caller.token.id, requestId: c.get("requestId") },
      "token given up",
    );
    return c.body(null, 204);
  });

  // An administrator's sight of everyone's agents: another person's tokens, listed and taken
  // away on the console's own pages (ADR-0011).
  const administering = async (
    c: Context<AppEnv>,
    changing: boolean,
  ): Promise<{ readonly admin: PersonRecord; readonly subject: PersonRecord } | Response> => {
    const admin = changing ? await signedInOnOwnPages(c) : await signedIn(c);
    if (admin instanceof Response) {
      return admin;
    }
    if (admin.role !== "admin") {
      return administratorRequired(c);
    }
    const id = c.req.param("id") ?? "";
    const subject = UUID.test(id) ? await findPerson(database, admin.workspaceId, id) : undefined;
    return subject === undefined
      ? notFound(c, "person.not_found", "The person was not found.")
      : { admin, subject };
  };

  app.get(`${REST_ROUTES.people}/:id/tokens`, async (c) => {
    const found = await administering(c, false);
    if (found instanceof Response) {
      return found;
    }
    if (tokens === undefined) {
      return signInRequired(c);
    }
    const body: RestTokens = { items: (await tokens.list(found.subject)).map(restToken) };
    return c.json(body);
  });

  app.delete(`${REST_ROUTES.people}/:id/tokens/:tokenId`, async (c) => {
    const found = await administering(c, true);
    if (found instanceof Response) {
      return found;
    }
    const tokenId = c.req.param("tokenId") ?? "";
    if (
      tokens === undefined ||
      !UUID.test(tokenId) ||
      !(await tokens.revoke(found.subject, tokenId))
    ) {
      return notFound(c, "token.not_found", "The token was not found.");
    }
    logger.info(
      {
        person: found.admin.id,
        subject: found.subject.id,
        tokenId,
        requestId: c.get("requestId"),
      },
      "token removed by an administrator",
    );
    return c.body(null, 204);
  });

  // Connecting an agent (ADR-0011): the command asks as nobody, a person approves signed in on
  // the console's own pages, and the command claims the token with its secret.
  const noSuchConnection = (c: Context<AppEnv>) =>
    notFound(
      c,
      "connect.not_found",
      "No agent asks to connect under this code: it was never asked, it expired, the person said no, or the token was handed over already.",
    );
  const restConnectRequest = (request: ConnectRequestRecord): RestConnectRequest => ({
    code: request.code,
    agent: request.agent,
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    approved: request.approvedAt !== undefined,
  });
  /** The code in the path, as it is written, or nothing for text that is not one. */
  const codeOf = (c: Context<AppEnv>): string | undefined =>
    normalizeConnectCode(c.req.param("code") ?? "");

  app.post(REST_ROUTES.connect, tooLarge, async (c) => {
    if (connections === undefined) {
      return signInRequired(c);
    }
    const input = await bodyOf(c, restConnectInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const begun = await connections.begin(input.agent);
      logger.info({ code: begun.code, requestId: c.get("requestId") }, "an agent asked to connect");
      const body: RestConnection = {
        code: begun.code,
        url: begun.url,
        secret: begun.secret,
        expiresAt: begun.expiresAt.toISOString(),
        interval: begun.interval,
      };
      return c.json(body, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(CLAIM_PATH, tooLarge, async (c) => {
    if (connections === undefined) {
      return signInRequired(c);
    }
    const input = await bodyOf(c, restClaimInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const claim = await connections.claim(input.secret);
      if (claim === undefined) {
        return noSuchConnection(c);
      }
      if (claim.status === "pending") {
        const body: RestClaim = { status: "pending", expiresAt: claim.expiresAt.toISOString() };
        return c.json(body, 202);
      }
      const body: RestClaim = {
        status: "connected",
        token: restToken(claim.token),
        secret: claim.secret,
      };
      return c.json(body);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.connect}/:code`, async (c) => {
    const person = await signedIn(c);
    if (person instanceof Response) {
      return person;
    }
    const code = codeOf(c);
    const found = code === undefined ? undefined : await connections?.look(code);
    return found === undefined ? noSuchConnection(c) : c.json(restConnectRequest(found));
  });

  app.post(`${REST_ROUTES.connect}/:code/approve`, tooLarge, async (c) => {
    const person = await signedInOnOwnPages(c);
    if (person instanceof Response) {
      return person;
    }
    const input = await bodyOf(c, restTokenInputSchema);
    if (input instanceof Response) {
      return input;
    }
    const code = codeOf(c);
    if (code === undefined || connections === undefined || tokens === undefined) {
      return noSuchConnection(c);
    }
    try {
      const approved = await connections.approve(code, person, {
        name: input.name,
        days: tokens.daysOf(input.expiresInDays),
      });
      return approved === undefined ? noSuchConnection(c) : c.json(restConnectRequest(approved));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${REST_ROUTES.connect}/:code/deny`, async (c) => {
    const person = await signedInOnOwnPages(c);
    if (person instanceof Response) {
      return person;
    }
    const code = codeOf(c);
    if (code === undefined || connections === undefined || !(await connections.deny(code))) {
      return noSuchConnection(c);
    }
    logger.info(
      { person: person.id, code, requestId: c.get("requestId") },
      "a connection was denied",
    );
    return c.body(null, 204);
  });

  // The project itself: what it is, and who is listed in it.

  app.get(PROJECT, async (c) => {
    const found = await reading(c);
    return found instanceof Response ? found : c.json(restProject(found.project));
  });

  app.patch(PROJECT, tooLarge, async (c) => {
    const found = await owning(c);
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

  // The project's own image for its mark: set and taken away by an owner; read by whoever may
  // see the project.
  app.post(`${PROJECT}/icon`, iconFormTooLarge, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    const sent = await filePartOf(c);
    if (sent instanceof Response) {
      return sent;
    }
    if (sent.part.size > MAX_PROJECT_ICON_BYTES) {
      return iconTooLarge(c);
    }
    const bytes = new Uint8Array(await sent.part.arrayBuffer());
    const contentType = imageTypeOf(bytes);
    if (contentType === undefined) {
      return c.json(
        errorBody(
          "project.invalid_icon",
          "file: the image must be a PNG, a JPEG, a GIF or a WebP.",
        ),
        400,
      );
    }
    try {
      const kept = await blobs.put(bytes, clock.now());
      const project = await setProjectIcon(database, {
        projectId: found.project.id,
        actor: found.actor,
        person: found.person,
        icon: { sha256: kept.sha256, contentType },
        now: clock.now(),
      });
      return c.json(restProject(project));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${PROJECT}/icon`, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    try {
      const project = await setProjectIcon(database, {
        projectId: found.project.id,
        actor: found.actor,
        person: found.person,
        icon: undefined,
        now: clock.now(),
      });
      return c.json(restProject(project));
    } catch (error) {
      return failure(c, error);
    }
  });

  // The image's bytes, kept by their hash: a browser keeps them for a day, and asks again by the hash.
  app.get(`${PROJECT}/icon`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const { icon } = found.project;
    if (icon === undefined) {
      return notFound(c, "project.no_icon", "The project has no image.");
    }
    const tag = `"${icon.sha256}"`;
    c.header("etag", tag);
    // The address carries the hash, so a browser's copy is good as long as it is kept.
    c.header("cache-control", "private, max-age=86400, immutable");
    if (c.req.header("if-none-match") === tag) {
      return c.body(null, 304);
    }
    return serveFile(
      c,
      {
        name: `icon.${ICON_EXTENSIONS[icon.contentType]}`,
        contentType: icon.contentType,
        sha256: icon.sha256,
      },
      { project: found.project.id },
    );
  });

  app.get(`${PROJECT}/members`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const body: RestMembers = {
      items: (await listMembers(database, found.project)).map(restMember),
    };
    return c.json(body);
  });

  app.post(`${PROJECT}/members`, tooLarge, async (c) => {
    const found = await owning(c);
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
    const found = await owning(c);
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
    const found = await owning(c);
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
    const page = await listTasks(database, found.scope, {
      state: query.data.state,
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      category: query.data.category,
      goalId: query.data.goal,
      workerId: query.data.worker,
      unassigned: query.data.unassigned === "true",
      dueBy: query.data.dueBy,
      query: query.data.q,
      archived: query.data.archived === "true",
      limit: query.data.limit,
      offset: query.data.offset,
    });
    const body: RestTasks = { items: page.items.map(restTask), more: page.more };
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

  /** One task, by its id or by its number: the pages hold ids, people and their agents say numbers. */
  const taskOf = (scope: Scope, ref: string) =>
    UUID.test(ref)
      ? getTask(database, scope, ref)
      : TASK_NUMBER.test(ref)
        ? findTaskByNumber(database, scope, Number(ref))
        : Promise.resolve(undefined);

  app.get(`${PROJECT}/tasks/:id`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const task = await taskOf(found.scope, c.req.param("id"));
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

  // Putting a task away (ADR-0029): one done or dropped, by whoever may work in the project, and
  // back again the same way; every closed task of a goal at once, by an owner. A task put away is
  // out of the listings, the board and the calendar, and open by its id or its number still.
  const archiving = async (c: Context<AppEnv>, archive: boolean): Promise<Response> => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    // The helper is not bound to a route, so the parameter may be missing to the types; it is not.
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) {
      return noSuchTask(c);
    }
    const input = { scope: found.scope, actor: found.actor, taskId: id, now: clock.now() };
    try {
      const task = archive
        ? await archiveTask(database, input)
        : await restoreTask(database, input);
      return c.json(restTask(task));
    } catch (error) {
      return failure(c, error);
    }
  };
  app.post(`${PROJECT}/tasks/archive`, tooLarge, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restArchiveTasksInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const archived = await archiveTasksOfGoal(database, {
        scope: found.scope,
        actor: found.actor,
        goalId: input.goalId,
        now: clock.now(),
      });
      const body: RestArchivedTasks = { archived };
      return c.json(body);
    } catch (error) {
      return failure(c, error);
    }
  });
  app.post(`${PROJECT}/tasks/:id/archive`, (c) => archiving(c, true));
  app.post(`${PROJECT}/tasks/:id/restore`, (c) => archiving(c, false));

  // The discussion on a task (ADR-0024), oldest first and whole; the task by its id or its number.
  app.get(`${PROJECT}/tasks/:id/comments`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const task = await taskOf(found.scope, c.req.param("id"));
    if (task === undefined) {
      return noSuchTask(c);
    }
    const items = await listComments(database, found.scope, task.id);
    const body: RestComments = { items: items.map(restComment) };
    return c.json(body);
  });

  // A word in the discussion, with the files put in it: as JSON, the body alone; as a form,
  // the part `body` and the parts `file`, whose bytes go to the blob store under their hash
  // once the whole form has been read and found good. One request, one comment, one event.
  app.post(`${PROJECT}/tasks/:id/comments`, commentTooLarge, async (c) => {
    const found = await changing(c);
    if (found instanceof Response) {
      return found;
    }
    const task = await taskOf(found.scope, c.req.param("id"));
    if (task === undefined) {
      return noSuchTask(c);
    }
    let body: string;
    let sent: readonly {
      readonly part: File;
      readonly name: string;
      readonly contentType: string;
    }[];
    if (isForm(c)) {
      const parts = await commentPartsOf(c);
      if (parts instanceof Response) {
        return parts;
      }
      body = parts.body;
      sent = parts.files;
    } else {
      const input = await bodyOf(c, restCommentInputSchema);
      if (input instanceof Response) {
        return input;
      }
      body = input.body;
      sent = [];
    }
    if (body.trim().length === 0 && sent.length === 0) {
      return invalid(c, "body: say something, or put a file in.");
    }
    try {
      const files = [];
      for (const file of sent) {
        const kept = await blobs.put(new Uint8Array(await file.part.arrayBuffer()), clock.now());
        files.push({
          name: file.name,
          size: kept.size,
          contentType: file.contentType,
          sha256: kept.sha256,
        });
      }
      const written = await writeComment(database, {
        scope: found.scope,
        actor: found.actor,
        taskId: task.id,
        body,
        files,
        limit: MAX_COMMENTS_PER_TASK,
        fileLimit: MAX_FILES_PER_COMMENT,
        now: clock.now(),
      });
      return c.json(restComment(written), 201);
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
    const page = await listDecisions(database, found.scope, {
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      taskId: query.data.task,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    const body: RestDecisions = { items: page.items.map(restDecision), more: page.more };
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
          deciderId: input.deciderId,
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
        own: input.own,
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
    const page = await listRuns(database, found.scope, {
      taskId: query.data.task,
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      // An agent's own runs are the ones begun with its token; a person's, the ones for them.
      tokenId: mine && found.token !== undefined ? found.token.id : undefined,
      personId: mine && found.token === undefined ? found.person.id : undefined,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    const body: RestRuns = { items: page.items.map(restRun), more: page.more };
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
    try {
      const kept = await blobs.put(new Uint8Array(await sent.part.arrayBuffer()), clock.now());
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

  // The bytes of a file of the project, whichever way it came: handed in by a run, put in a
  // comment, or attached to a page; one address for all of them, for whoever may see the project.
  app.get(`${PROJECT}/files/:id`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchFile(c);
    }
    const artifact = await findArtifact(database, found.scope, id);
    if (artifact?.file !== undefined) {
      return serveFile(c, artifact.file, { artifact: artifact.id });
    }
    const commented = await findCommentFile(database, found.scope, id);
    if (commented !== undefined) {
      return serveFile(c, commented.file, { commentFile: commented.id });
    }
    const attached = await findDocumentFileById(database, found.scope, id);
    if (attached !== undefined) {
      return serveFile(c, attached.file, { documentFile: attached.id });
    }
    return noSuchFile(c);
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
    const { person } = found;
    try {
      const run = await endRun(database, {
        scope: found.scope,
        actor: found.actor,
        runId: id,
        status: input.status,
        summary: input.summary,
        // Giving up on anyone's run is an owner's doing, themselves or through their agent;
        // a run is finished or failed only by its own person.
        anyone: input.status === "abandoned" && found.project.role === "owner",
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

  // The roadmap (ADR-0019): the project's goals, read by whoever may see it, set by an owner.
  app.get(`${PROJECT}/goals`, async (c) => {
    const query = goalsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, firstProblem(query));
    }
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const page = await listGoals(database, found.scope, {
      state: query.data.state,
      open: query.data.open === undefined ? undefined : query.data.open === "true",
      category: query.data.category,
      query: query.data.q,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    const body: RestGoals = { items: page.items.map(restGoal), more: page.more };
    return c.json(body);
  });

  app.post(`${PROJECT}/goals`, tooLarge, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restGoalInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const goal = await createGoal(database, {
        scope: found.scope,
        actor: found.actor,
        goal: input,
        now: clock.now(),
      });
      logger.info(
        { person: found.person.id, goal: goal.id, requestId: c.get("requestId") },
        "goal created",
      );
      return c.json(restGoal(goal), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PROJECT}/goals/:id`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const id = c.req.param("id");
    const goal = UUID.test(id) ? await getGoal(database, found.scope, id) : undefined;
    return goal === undefined ? noSuchGoal(c) : c.json(restGoal(goal));
  });

  app.patch(`${PROJECT}/goals/:id`, tooLarge, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    const patch = await bodyOf(c, restGoalPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    const id = c.req.param("id");
    if (!UUID.test(id)) {
      return noSuchGoal(c);
    }
    try {
      const goal = await updateGoal(database, {
        scope: found.scope,
        actor: found.actor,
        goalId: id,
        patch,
        now: clock.now(),
      });
      return c.json(restGoal(goal));
    } catch (error) {
      return failure(c, error);
    }
  });

  // The project's pack (ADR-0028): its skills as the SkillCDN deployment serves them at the
  // project's address, or the organization's; one skill whole; a file of it. A private pack is
  // read with the pack token the project holds, sealed in its row and shown to nobody; a read
  // is logged, never what it read.
  // The token a pack is read with: the project's own; else, for a project that reads the
  // organization's pack, the workspace's (ADR-0036); nothing for a pack that needs none.
  const packTokenFor = async (project: ProjectRecord): Promise<string | undefined> => {
    if (secrets === undefined) {
      return undefined;
    }
    if (project.packToken !== undefined) {
      return secrets.open("pack-token", project.packToken.sealed);
    }
    if (project.skillsAddress !== undefined) {
      return undefined;
    }
    const held = await readWorkspacePackToken(database, project.workspaceId);
    return held === undefined ? undefined : secrets.open("pack-token", held.sealed);
  };
  app.get(`${PROJECT}/skills`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const body: RestSkills = await skills.read(
      found.project.skillsAddress,
      await packTokenFor(found.project),
    );
    return c.json(body);
  });
  app.get(`${PROJECT}/skills/one`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const query = skillQuerySchema.safeParse({
      path: c.req.query("path"),
      cursor: c.req.query("cursor"),
    });
    if (!query.success) {
      return c.json(errorBody("request.invalid", `query: ${query.error.message}`), 400);
    }
    const body: RestSkillLoad = await skills.load(
      found.project.skillsAddress,
      query.data.path,
      query.data.cursor,
      await packTokenFor(found.project),
    );
    logger.info(
      {
        person: found.person.id,
        project: found.project.key,
        address: body.address,
        path: query.data.path,
        status: body.status,
        requestId: c.get("requestId"),
      },
      "a skill of the pack was read",
    );
    return c.json(body);
  });
  app.get(`${PROJECT}/skills/file`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const query = fileQuerySchema.safeParse({
      path: c.req.query("path"),
      offset: c.req.query("offset"),
      limit: c.req.query("limit"),
    });
    if (!query.success) {
      return c.json(errorBody("request.invalid", `query: ${query.error.message}`), 400);
    }
    const body: RestSkillFile = await skills.file(
      found.project.skillsAddress,
      query.data,
      await packTokenFor(found.project),
    );
    logger.info(
      {
        person: found.person.id,
        project: found.project.key,
        address: body.address,
        path: query.data.path,
        status: body.status,
        requestId: c.get("requestId"),
      },
      "a file of the pack was read",
    );
    return c.json(body);
  });

  app.get(`${PROJECT}/skills/browse`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const query = browseQuerySchema.safeParse({
      path: c.req.query("path"),
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    if (!query.success) {
      return c.json(errorBody("request.invalid", `query: ${query.error.message}`), 400);
    }
    const body: RestSkillBrowse = await skills.browse(
      found.project.skillsAddress,
      query.data,
      await packTokenFor(found.project),
    );
    logger.info(
      {
        person: found.person.id,
        project: found.project.key,
        address: body.address,
        path: query.data.path ?? "",
        status: body.status,
        requestId: c.get("requestId"),
      },
      "a folder of the pack was browsed",
    );
    return c.json(body);
  });
  app.get(`${PROJECT}/skills/find`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const query = findQuerySchema.safeParse({
      query: c.req.query("query"),
      path: c.req.query("path"),
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    if (!query.success) {
      return c.json(errorBody("request.invalid", `query: ${query.error.message}`), 400);
    }
    const body: RestSkillFind = await skills.find(
      found.project.skillsAddress,
      query.data,
      await packTokenFor(found.project),
    );
    // The words searched for are the agent's own and stay out of the log; the folder and the outcome go in.
    logger.info(
      {
        person: found.person.id,
        project: found.project.key,
        address: body.address,
        path: query.data.path ?? "",
        status: body.status,
        requestId: c.get("requestId"),
      },
      "the pack was searched",
    );
    return c.json(body);
  });

  // The pack token (ADR-0028): set by an owner from a token a person made at the deployment, tried
  // there once, kept sealed, and answered as nothing but the day it was set.
  app.put(`${PROJECT}/pack-token`, tooLarge, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    const input = await bodyOf(c, restPackTokenInputSchema);
    if (input instanceof Response) {
      return input;
    }
    if (secrets === undefined) {
      return c.json(
        errorBody(
          "project.pack_token_unsupported",
          "The console keeps no secret to seal a pack token with: AUTH_SECRET is not set.",
        ),
        409,
      );
    }
    const tried = await skills.read(found.project.skillsAddress, input.token);
    if (
      tried.status === "none" ||
      tried.status === "not_found" ||
      tried.status === "token_invalid"
    ) {
      return c.json(
        errorBody(
          "project.pack_token_refused",
          tried.status === "none"
            ? "The project names no pack to read with the token."
            : "The deployment does not serve the pack to this token.",
        ),
        400,
      );
    }
    if (tried.status === "unavailable") {
      return c.json(
        errorBody(
          "skills.unavailable",
          "The SkillCDN deployment could not be reached; try again later.",
        ),
        503,
      );
    }
    try {
      const project = await setPackToken(database, {
        projectId: found.project.id,
        actor: found.actor,
        person: found.person,
        sealed: secrets.seal("pack-token", input.token),
        now: clock.now(),
      });
      return c.json(restProject(project));
    } catch (error) {
      return failure(c, error);
    }
  });
  app.delete(`${PROJECT}/pack-token`, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    try {
      const project = await setPackToken(database, {
        projectId: found.project.id,
        actor: found.actor,
        person: found.person,
        sealed: undefined,
        now: clock.now(),
      });
      return c.json(restProject(project));
    } catch (error) {
      return failure(c, error);
    }
  });

  // A private pack connected with a code a person approves (ADR-0036): the console asks the
  // deployment to connect, as the skillcdn command does, shows the owner the code and the page,
  // and claims the pack token once the person approved there. The deployment's secret is kept
  // sealed while the request stands, the token sealed on the project once claimed, and neither
  // is answered or logged.
  const connectUnsupported = (c: Context<AppEnv>): Response =>
    c.json(
      errorBody(
        "project.pack_connect_unsupported",
        packConnector === undefined
          ? "The console reads packs at no deployment it could connect to."
          : "The console keeps no secret to seal a pack token with: AUTH_SECRET is not set.",
      ),
      409,
    );
  const connectRefused = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("project.pack_connect_refused", message), 400);
  /**
   * What the console calls itself at the deployment, shown to the person who approves there:
   * the workspace's name, and Console after it once, since a workspace is conventionally
   * named `<Organization> Console` already.
   */
  const consoleAgentName = (name: string): string => {
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    const named =
      lower === "console" || lower.endsWith(" console") ? trimmed : `${trimmed} Console`;
    return named.slice(0, CONNECT_AGENT_MAX_LENGTH);
  };
  const deploymentAway = (c: Context<AppEnv>): Response =>
    c.json(
      errorBody(
        "skills.unavailable",
        "The SkillCDN deployment could not be reached; try again later.",
      ),
      503,
    );
  const isAway = (error: PackError): boolean =>
    error.code === "network" || error.code === "invalid_response";
  const pendingOf = (row: PackConnectRecord): Extract<RestPackConnect, { status: "pending" }> => ({
    status: "pending",
    code: row.code,
    url: row.url,
    expiresAt: row.expiresAt.toISOString(),
    intervalSeconds: row.intervalSeconds,
  });
  /** Reading how the connection stands, or giving it up, is an owner's, as beginning it is. */
  const owningRead = async (c: Context<AppEnv>): Promise<InProject | Response> => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    return found.project.role === "owner" ? found : ownerRequired(c);
  };

  app.post(`${PROJECT}/pack-token/connect`, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    if (packConnector === undefined || secrets === undefined) {
      return connectUnsupported(c);
    }
    const address = skills.addressOf(found.project.skillsAddress);
    if (address === undefined) {
      return connectRefused(c, "The project names no pack to connect.");
    }
    if (address.host === LOCAL_HOST_KEY) {
      return connectRefused(c, "A pack on the console's machine is read with no token.");
    }
    const name = (await workspace()).name;
    let started: RestConnectStarted;
    try {
      started = await packConnector.connect(address, consoleAgentName(name));
    } catch (error) {
      if (error instanceof PackError) {
        return isAway(error) ? deploymentAway(c) : connectRefused(c, error.message);
      }
      throw error;
    }
    const row = await startPackConnect(database, {
      holder: { project: found.project.id },
      address: formatAddress(address),
      code: started.code,
      url: started.url,
      sealedSecret: secrets.seal("pack-connect", started.secret),
      intervalSeconds: started.intervalSeconds,
      startedById: found.person.id,
      expiresAt: new Date(started.expiresAt),
      now: clock.now(),
    });
    logger.info(
      {
        person: found.person.id,
        project: found.project.id,
        address: row.address,
        requestId: c.get("requestId"),
      },
      "pack connect begun",
    );
    const body: RestPackConnectStarted = {
      code: row.code,
      url: row.url,
      expiresAt: row.expiresAt.toISOString(),
      intervalSeconds: row.intervalSeconds,
    };
    return c.json(body, 201);
  });

  app.get(`${PROJECT}/pack-token/connect`, async (c) => {
    const found = await owningRead(c);
    if (found instanceof Response) {
      return found;
    }
    if (packConnector === undefined || secrets === undefined) {
      return connectUnsupported(c);
    }
    const row = await readPackConnect(database, { project: found.project.id });
    if (row === undefined) {
      const body: RestPackConnect = { status: "none" };
      return c.json(body);
    }
    const now = clock.now();
    const ended = async (reason: "expired" | "declined" | "refused") => {
      await endPackConnect(database, { project: found.project.id });
      const body: RestPackConnect = { status: "ended", reason };
      return c.json(body);
    };
    if (row.expiresAt.getTime() <= now.getTime()) {
      return ended("expired");
    }
    const secret = secrets.open("pack-connect", row.sealedSecret);
    if (secret === undefined) {
      return ended("refused");
    }
    let claim: RestConnectClaimed;
    try {
      claim = await packConnector.claim(secret);
    } catch (error) {
      if (error instanceof PackError) {
        if (isAway(error)) {
          return deploymentAway(c);
        }
        return ended(error.code === "connect.not_found" ? "declined" : "refused");
      }
      throw error;
    }
    if (claim.status === "pending") {
      return c.json(pendingOf(row));
    }
    const project = await setPackToken(database, {
      projectId: found.project.id,
      actor: found.actor,
      person: found.person,
      sealed: secrets.seal("pack-token", claim.token),
      now,
    });
    await endPackConnect(database, { project: found.project.id });
    logger.info(
      {
        person: found.person.id,
        project: found.project.id,
        address: row.address,
        requestId: c.get("requestId"),
      },
      "pack token connected",
    );
    const body: RestPackConnect = { status: "connected", project: restProject(project) };
    return c.json(body);
  });

  app.delete(`${PROJECT}/pack-token/connect`, async (c) => {
    const found = await owning(c);
    if (found instanceof Response) {
      return found;
    }
    await endPackConnect(database, { project: found.project.id });
    return c.body(null, 204);
  });

  // The workspace's SkillCDN token (ADR-0036): what reads the organization's pack for every
  // project that names no address of its own and holds no token of its own. An administrator's,
  // from the console's own pages or through their agent's token, kept sealed on the workspace's
  // row, answered as the day it was set and logged never; connected with a code as a project's is.
  const configuring = async (c: Context<AppEnv>): Promise<Caller | Response> => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    return configuresWorkspace(caller.person) ? caller : administratorRequired(c);
  };
  const configuringRead = async (c: Context<AppEnv>): Promise<Caller | Response> => {
    const caller = await askingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    return configuresWorkspace(caller.person) ? caller : administratorRequired(c);
  };
  const workspaceBody = (found: WorkspaceRecord, settings: WorkspaceSettings): RestWorkspace =>
    restWorkspace(found, settings, skills, tokens?.daysAtMost);
  const workspaceConnectUnsupported = (c: Context<AppEnv>): Response =>
    c.json(
      errorBody(
        "workspace.pack_connect_unsupported",
        packConnector === undefined
          ? "The console reads packs at no deployment it could connect to."
          : "The console keeps no secret to seal a SkillCDN token with: AUTH_SECRET is not set.",
      ),
      409,
    );
  const workspaceConnectRefused = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("workspace.pack_connect_refused", message), 400);
  const WORKSPACE_PACK_CONNECT = `${REST_ROUTES.workspacePackToken}/connect`;

  app.put(REST_ROUTES.workspacePackToken, tooLarge, async (c) => {
    const caller = await configuring(c);
    if (caller instanceof Response) {
      return caller;
    }
    const input = await bodyOf(c, restPackTokenInputSchema);
    if (input instanceof Response) {
      return input;
    }
    if (secrets === undefined) {
      return c.json(
        errorBody(
          "workspace.pack_token_unsupported",
          "The console keeps no secret to seal a SkillCDN token with: AUTH_SECRET is not set.",
        ),
        409,
      );
    }
    const tried = await skills.read(undefined, input.token);
    if (
      tried.status === "none" ||
      tried.status === "not_found" ||
      tried.status === "token_invalid"
    ) {
      return c.json(
        errorBody(
          "workspace.pack_token_refused",
          tried.status === "none"
            ? "The console names no address for the organization's skills to read with the token."
            : "The deployment does not serve the organization's pack to this token.",
        ),
        400,
      );
    }
    if (tried.status === "unavailable") {
      return deploymentAway(c);
    }
    const found = await workspace();
    const settings = await setWorkspacePackToken(database, {
      workspaceId: found.id,
      actor: actorOf(caller),
      sealed: secrets.seal("pack-token", input.token),
      now: clock.now(),
    });
    return c.json(workspaceBody(found, settings));
  });
  app.delete(REST_ROUTES.workspacePackToken, async (c) => {
    const caller = await configuring(c);
    if (caller instanceof Response) {
      return caller;
    }
    const found = await workspace();
    const settings = await setWorkspacePackToken(database, {
      workspaceId: found.id,
      actor: actorOf(caller),
      sealed: undefined,
      now: clock.now(),
    });
    return c.json(workspaceBody(found, settings));
  });

  app.post(WORKSPACE_PACK_CONNECT, async (c) => {
    const caller = await configuring(c);
    if (caller instanceof Response) {
      return caller;
    }
    if (packConnector === undefined || secrets === undefined) {
      return workspaceConnectUnsupported(c);
    }
    const address = skills.addressOf(undefined);
    if (address === undefined) {
      return workspaceConnectRefused(
        c,
        "The console names no address for the organization's skills.",
      );
    }
    if (address.host === LOCAL_HOST_KEY) {
      return workspaceConnectRefused(c, "A pack on the console's machine is read with no token.");
    }
    const found = await workspace();
    let started: RestConnectStarted;
    try {
      started = await packConnector.connect(address, consoleAgentName(found.name));
    } catch (error) {
      if (error instanceof PackError) {
        return isAway(error) ? deploymentAway(c) : workspaceConnectRefused(c, error.message);
      }
      throw error;
    }
    const row = await startPackConnect(database, {
      holder: { workspace: found.id },
      address: formatAddress(address),
      code: started.code,
      url: started.url,
      sealedSecret: secrets.seal("pack-connect", started.secret),
      intervalSeconds: started.intervalSeconds,
      startedById: caller.person.id,
      expiresAt: new Date(started.expiresAt),
      now: clock.now(),
    });
    logger.info(
      { person: caller.person.id, address: row.address, requestId: c.get("requestId") },
      "workspace pack connect begun",
    );
    const body: RestPackConnectStarted = {
      code: row.code,
      url: row.url,
      expiresAt: row.expiresAt.toISOString(),
      intervalSeconds: row.intervalSeconds,
    };
    return c.json(body, 201);
  });
  app.get(WORKSPACE_PACK_CONNECT, async (c) => {
    const caller = await configuringRead(c);
    if (caller instanceof Response) {
      return caller;
    }
    if (packConnector === undefined || secrets === undefined) {
      return workspaceConnectUnsupported(c);
    }
    const found = await workspace();
    const holder = { workspace: found.id };
    const row = await readPackConnect(database, holder);
    if (row === undefined) {
      const body: RestWorkspacePackConnect = { status: "none" };
      return c.json(body);
    }
    const now = clock.now();
    const ended = async (reason: "expired" | "declined" | "refused") => {
      await endPackConnect(database, holder);
      const body: RestWorkspacePackConnect = { status: "ended", reason };
      return c.json(body);
    };
    if (row.expiresAt.getTime() <= now.getTime()) {
      return ended("expired");
    }
    const secret = secrets.open("pack-connect", row.sealedSecret);
    if (secret === undefined) {
      return ended("refused");
    }
    let claim: RestConnectClaimed;
    try {
      claim = await packConnector.claim(secret);
    } catch (error) {
      if (error instanceof PackError) {
        if (isAway(error)) {
          return deploymentAway(c);
        }
        return ended(error.code === "connect.not_found" ? "declined" : "refused");
      }
      throw error;
    }
    if (claim.status === "pending") {
      const body: RestWorkspacePackConnect = pendingOf(row);
      return c.json(body);
    }
    const settings = await setWorkspacePackToken(database, {
      workspaceId: found.id,
      actor: actorOf(caller),
      sealed: secrets.seal("pack-token", claim.token),
      now,
    });
    await endPackConnect(database, holder);
    logger.info(
      { person: caller.person.id, address: row.address, requestId: c.get("requestId") },
      "workspace pack token connected",
    );
    const body: RestWorkspacePackConnect = {
      status: "connected",
      workspace: workspaceBody(found, settings),
    };
    return c.json(body);
  });
  app.delete(WORKSPACE_PACK_CONNECT, async (c) => {
    const caller = await configuring(c);
    if (caller instanceof Response) {
      return caller;
    }
    await endPackConnect(database, { workspace: (await workspace()).id });
    return c.body(null, 204);
  });

  // The documents of the project (ADR-0009): pages under a path, read by whoever may see the
  // project, written by whoever may work in it, a person as an agent. The path is one segment
  // of the URL, its slashes encoded.

  // The rules of the board (ADR-0023): the workspace's, the console's own until an administrator
  // writes the organization's, read by everyone of the workspace and kept by an administrator,
  // signed in or through their agent; and a project's, read with the workspace's by whoever may
  // see the project, written as the page `rules` by an owner.
  const workspacePages = (person: PersonRecord) => ({
    workspaceId: person.workspaceId,
    projectId: null,
  });

  app.get(REST_ROUTES.rules, async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    return c.json(restRules(await readRules(database, workspacePages(person))));
  });

  app.put(REST_ROUTES.rules, documentTooLarge, async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    if (caller.person.role !== "admin") {
      return administratorRequired(c);
    }
    const input = await bodyOf(c, restRulesInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const rules = await writeRules(database, {
        scope: workspacePages(caller.person),
        actor: actorOf(caller),
        body: input.body,
        baseVersion: input.baseVersion,
        maxVersions: MAX_VERSIONS_PER_DOCUMENT,
        now: clock.now(),
      });
      return c.json(restRules(rules));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(rulesPath("archive"), async (c) => {
    const caller = await changingCaller(c);
    if (caller instanceof Response) {
      return caller;
    }
    if (caller.person.role !== "admin") {
      return administratorRequired(c);
    }
    const rules = await archiveRules(database, {
      scope: workspacePages(caller.person),
      actor: actorOf(caller),
      now: clock.now(),
    });
    return c.json(restRules(rules));
  });

  app.get(rulesPath("versions"), async (c) => {
    const person = await asking(c);
    if (person instanceof Response) {
      return person;
    }
    const versions = await listVersions(database, workspacePages(person), RULES_PATH, LIST_LIMIT);
    const body: RestVersions = { items: (versions ?? []).map(restVersionSummary) };
    return c.json(body);
  });

  app.get(`${PROJECT}/rules`, async (c) => {
    const found = await reading(c);
    if (found instanceof Response) {
      return found;
    }
    const [workspace, project] = await Promise.all([
      readRules(database, { workspaceId: found.scope.workspaceId, projectId: null }),
      readRules(database, found.scope),
    ]);
    const body: RestProjectRules = { workspace: restRules(workspace), project: restRules(project) };
    return c.json(body);
  });

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
    // The rules are the project's configuration (ADR-0023): an owner's, kept short, with the
    // one title, and written again when they were put away.
    const rules = path === RULES_PATH;
    if (rules && found.project.role !== "owner") {
      return ownerRequired(c);
    }
    if (rules && input.body.length > MAX_RULES_LENGTH) {
      return invalid(c, `body: the rules are at most ${MAX_RULES_LENGTH} characters`);
    }
    try {
      const { document, created } = await writeDocument(database, {
        scope: found.scope,
        actor: found.actor,
        path,
        title: rules ? RULES_TITLE : input.title,
        body: input.body,
        baseVersion: input.baseVersion,
        restoreArchived: rules,
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
      if (path === RULES_PATH && found.project.role !== "owner") {
        return ownerRequired(c);
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
    if (path === RULES_PATH && found.project.role !== "owner") {
      return ownerRequired(c);
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
    try {
      const kept = await blobs.put(new Uint8Array(await sent.part.arrayBuffer()), clock.now());
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
        goalId: query.data.goal,
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
