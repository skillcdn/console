// The mini build of zod: these schemas also run in the browser, where the full build would be
// most of what a page downloads. The server validates what it is sent with the input schemas
// and builds the output shapes; the pages and a custom console parse answers with the rest.
// Absent values are `null` on the wire, never missing keys. Changes within a version are additive.
import * as z from "zod/mini";
import { isDocumentPath } from "./documents.js";
import {
  MAX_AGENT_LENGTH,
  MAX_BODY_LENGTH,
  MAX_DOCUMENT_LENGTH,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_FILE_NAME_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_LINKS,
  MAX_NOTE_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_SKILLS_ADDRESS_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
  MAX_URL_LENGTH,
  MIN_OPTIONS,
} from "./limits.js";
import { hasForbiddenCodePoint } from "./text.js";
import {
  ARTIFACT_KINDS,
  EVENT_KINDS,
  LINK_SOURCES,
  PERSON_ROLES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  PROVIDER_KEYS,
  RUN_ENDINGS,
  RUN_STATUSES,
  SKILLS_STATUSES,
  TASK_PRIORITIES,
  TASK_STATES,
} from "./vocabulary.js";

/** A line of text a person wrote: trimmed, bounded, and free of characters that hide. */
const line = (maxLength: number) =>
  z.string().check(
    z.trim(),
    z.minLength(1),
    z.maxLength(maxLength),
    z.refine((value) => !hasForbiddenCodePoint(value), "must not contain control characters"),
  );

/** A text of a few lines: bounded, with its line breaks, and otherwise the same rule. */
const paragraphs = (maxLength: number) =>
  z.string().check(
    z.maxLength(maxLength),
    z.refine((value) => !hasForbiddenCodePoint(value, true), "must not contain control characters"),
  );

/** A body in Markdown. */
const body = paragraphs(MAX_BODY_LENGTH);

/** A link a person adds to a task: the web, over https, and nothing that runs. */
const url = z.string().check(z.trim(), z.maxLength(MAX_URL_LENGTH), z.url({ protocol: /^https$/ }));

const uuid = z.uuid();
/** An ISO 8601 instant, as the server writes it. */
const instant = z.iso.datetime();
const count = z.int().check(z.nonnegative());

/** A person of the workspace, as the pages show them. Nothing here is a secret. */
export const restPersonSchema = z.object({
  id: uuid,
  /** What the account is called at its provider: a login at the git host, an address at Google. */
  login: z.string(),
  /** The name the account goes by at the host, or `null`. */
  name: z.nullable(z.string()),
  /** The account's picture as the host serves it: an https URL loaded by the browser, or `null`. */
  avatar: z.nullable(z.string()),
  /** An administrator configures the board; a member works on it. */
  role: z.enum(PERSON_ROLES),
});
export type RestPerson = z.infer<typeof restPersonSchema>;

/** An identity provider people may sign in through, as the pages offer it. */
export const restProviderSchema = z.object({
  key: z.enum(PROVIDER_KEYS),
  /** What people read on the button. */
  label: z.string(),
});
export type RestProvider = z.infer<typeof restProviderSchema>;

/**
 * `GET /api/v1/me`: the workspace, who the session cookie says is signed in (or `null`), and
 * the identity providers people sign in through, none where nobody can.
 */
export const restMeSchema = z.object({
  workspace: z.object({ name: z.string() }),
  person: z.nullable(restPersonSchema),
  signIn: z.array(restProviderSchema),
});
export type RestMe = z.infer<typeof restMeSchema>;

/** `GET /api/v1/people`: everyone who has signed in, by login. */
export const restPeopleSchema = z.object({ items: z.array(restPersonSchema) });
export type RestPeople = z.infer<typeof restPeopleSchema>;

/** What `PATCH /api/v1/people/<id>` is sent, by an administrator: what the person is to be. */
export const restPersonPatchSchema = z.object({ role: z.enum(PERSON_ROLES) });
export type RestPersonPatch = z.infer<typeof restPersonPatchSchema>;

/** The words under `/projects/` that are the pages' own, which no project may be called. */
export const RESERVED_PROJECT_KEYS: readonly string[] = ["new"];

/**
 * A project's key: what its addresses and the command say. Lowercase letters, digits and
 * hyphens, beginning and ending with a letter or a digit, not a word the pages reserve;
 * immutable once the project is made.
 */
const projectKey = z.string().check(
  z.maxLength(MAX_PROJECT_KEY_LENGTH),
  z.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "must be lowercase letters, digits and hyphens"),
  z.refine((key) => !RESERVED_PROJECT_KEYS.includes(key), "is a word the pages reserve"),
);

/** The address of a project's skills, as the standard spells one; the console checks it as one. */
const skillsAddress = line(MAX_SKILLS_ADDRESS_LENGTH);

/** A project of the workspace, as the asker sees it: with what they are in it. */
export const restProjectSchema = z.object({
  id: uuid,
  key: projectKey,
  name: z.string(),
  description: z.string(),
  /** Who is a member: every member of the workspace, or only those listed. */
  visibility: z.enum(PROJECT_VISIBILITIES),
  /** The address of the project's skills at the SkillCDN deployment, canonical, or `null` for the organization's. */
  skillsAddress: z.nullable(z.string()),
  /** What the asker is in it: an owner configures the project, a member works on it. */
  role: z.enum(PROJECT_ROLES),
  /** How many decisions in it wait for a person. */
  openDecisions: count,
  /** How many agents are at work in it, or waiting. */
  openRuns: count,
  createdAt: instant,
  updatedAt: instant,
});
export type RestProject = z.infer<typeof restProjectSchema>;

/** `GET /api/v1/projects`: the projects the asker may see, by name. */
export const restProjectsSchema = z.object({ items: z.array(restProjectSchema) });
export type RestProjects = z.infer<typeof restProjectsSchema>;

/** What `POST /api/v1/projects` is sent: the key and the name; the rest has a default. */
export const restProjectInputSchema = z.object({
  key: projectKey,
  name: line(MAX_PROJECT_NAME_LENGTH),
  description: z.optional(paragraphs(MAX_PROJECT_DESCRIPTION_LENGTH)),
  /** Left out: `private`. */
  visibility: z.optional(z.enum(PROJECT_VISIBILITIES)),
  /** Left out or `null`: the organization's skills. */
  skillsAddress: z.optional(z.nullable(skillsAddress)),
});
export type RestProjectInput = z.infer<typeof restProjectInputSchema>;

/** What `PATCH /api/v1/projects/<key>` is sent: only what changes; the key does not. */
export const restProjectPatchSchema = z.object({
  name: z.optional(line(MAX_PROJECT_NAME_LENGTH)),
  description: z.optional(paragraphs(MAX_PROJECT_DESCRIPTION_LENGTH)),
  visibility: z.optional(z.enum(PROJECT_VISIBILITIES)),
  skillsAddress: z.optional(z.nullable(skillsAddress)),
});
export type RestProjectPatch = z.infer<typeof restProjectPatchSchema>;

/** A person listed in a project, with what they are in it. */
export const restMemberSchema = z.object({
  person: restPersonSchema,
  role: z.enum(PROJECT_ROLES),
  addedAt: instant,
});
export type RestMember = z.infer<typeof restMemberSchema>;

/** `GET /api/v1/projects/<key>/members`: those listed, by login. */
export const restMembersSchema = z.object({ items: z.array(restMemberSchema) });
export type RestMembers = z.infer<typeof restMembersSchema>;

/** What `POST /api/v1/projects/<key>/members` is sent: a person of the workspace, and what they are to be. */
export const restMemberInputSchema = z.object({
  personId: uuid,
  /** Left out: `member`. */
  role: z.optional(z.enum(PROJECT_ROLES)),
});
export type RestMemberInput = z.infer<typeof restMemberInputSchema>;

/** What `PATCH /api/v1/projects/<key>/members/<person id>` is sent. */
export const restMemberPatchSchema = z.object({ role: z.enum(PROJECT_ROLES) });
export type RestMemberPatch = z.infer<typeof restMemberPatchSchema>;

export const restTaskLinkSchema = z.object({
  url: z.string(),
  label: z.nullable(z.string()),
});
export type RestTaskLink = z.infer<typeof restTaskLinkSchema>;

export const restTaskSchema = z.object({
  id: uuid,
  /** The task's number in its project, the one people say out loud. */
  number: z.int().check(z.positive()),
  title: z.string(),
  /** Markdown. Shown as text or rendered to elements, never as HTML. */
  body: z.string(),
  state: z.enum(TASK_STATES),
  priority: z.enum(TASK_PRIORITIES),
  owner: restPersonSchema,
  assignee: z.nullable(restPersonSchema),
  /** The task this one is part of, or `null`. */
  parentId: z.nullable(uuid),
  links: z.array(restTaskLinkSchema),
  /** How many decisions about this task wait for a person. */
  openDecisions: count,
  /** How many runs are at work on it, or waiting. */
  openRuns: count,
  createdAt: instant,
  updatedAt: instant,
});
export type RestTask = z.infer<typeof restTaskSchema>;

/** `GET /api/v1/projects/<key>/tasks`: the board, newest first. */
export const restTasksSchema = z.object({ items: z.array(restTaskSchema) });
export type RestTasks = z.infer<typeof restTasksSchema>;

const taskLinkInput = z.object({
  url,
  label: z.optional(z.nullable(line(MAX_LINK_LABEL_LENGTH))),
});

/** What `POST /api/v1/projects/<key>/tasks` is sent. Everything but the title has a default. */
export const restTaskInputSchema = z.object({
  title: line(MAX_TITLE_LENGTH),
  body: z.optional(body),
  state: z.optional(z.enum(TASK_STATES)),
  priority: z.optional(z.enum(TASK_PRIORITIES)),
  assigneeId: z.optional(z.nullable(uuid)),
  parentId: z.optional(z.nullable(uuid)),
  links: z.optional(z.array(taskLinkInput).check(z.maxLength(MAX_LINKS))),
});
export type RestTaskInput = z.infer<typeof restTaskInputSchema>;

/** What `PATCH /api/v1/projects/<key>/tasks/<id>` is sent: only what changes. */
export const restTaskPatchSchema = z.object({
  title: z.optional(line(MAX_TITLE_LENGTH)),
  body: z.optional(body),
  state: z.optional(z.enum(TASK_STATES)),
  priority: z.optional(z.enum(TASK_PRIORITIES)),
  assigneeId: z.optional(z.nullable(uuid)),
  parentId: z.optional(z.nullable(uuid)),
  links: z.optional(z.array(taskLinkInput).check(z.maxLength(MAX_LINKS))),
});
export type RestTaskPatch = z.infer<typeof restTaskPatchSchema>;

export const restDecisionOptionSchema = z.object({
  /** What an answer names: stable for the life of the decision. */
  id: z.string(),
  label: z.string(),
});
export type RestDecisionOption = z.infer<typeof restDecisionOptionSchema>;

export const restDecisionSchema = z.object({
  id: uuid,
  question: z.string(),
  /** Markdown: what a person needs to know to answer. */
  body: z.string(),
  options: z.array(restDecisionOptionSchema),
  /** The task the decision is about, or `null`. */
  taskId: z.nullable(uuid),
  /** The task's number, when there is a task, or `null`. */
  taskNumber: z.nullable(z.int()),
  raisedBy: restPersonSchema,
  /** The run that raised it, as the agent asked, or `null` when a person did. */
  run: z.nullable(z.object({ id: uuid, agent: z.string() })),
  /** The answer, with who gave it and when; `null` while the decision waits. */
  answer: z.nullable(
    z.object({
      /** The id of the chosen option. */
      option: z.string(),
      /** The rationale given with the answer, or `null`. */
      note: z.nullable(z.string()),
      by: restPersonSchema,
      at: instant,
    }),
  ),
  /** What followed the decision, in Markdown, written afterwards; `null` until someone does. */
  outcome: z.nullable(z.string()),
  createdAt: instant,
  updatedAt: instant,
});
export type RestDecision = z.infer<typeof restDecisionSchema>;

/** `GET /api/v1/projects/<key>/decisions`: the ones that wait first, newest first within each. */
export const restDecisionsSchema = z.object({ items: z.array(restDecisionSchema) });
export type RestDecisions = z.infer<typeof restDecisionsSchema>;

/** What `POST /api/v1/projects/<key>/decisions` is sent: the question, its context, and the options. */
export const restDecisionInputSchema = z.object({
  question: line(MAX_QUESTION_LENGTH),
  body: z.optional(body),
  options: z
    .array(z.object({ label: line(MAX_OPTION_LABEL_LENGTH) }))
    .check(z.minLength(MIN_OPTIONS), z.maxLength(MAX_OPTIONS)),
  taskId: z.optional(z.nullable(uuid)),
  /** The run that asks, when an agent does: the decision is about its task, and it waits for the answer. */
  runId: z.optional(z.nullable(uuid)),
});
export type RestDecisionInput = z.infer<typeof restDecisionInputSchema>;

/** What `PATCH .../decisions/<id>` is sent: the record growing, its context or what followed; only what changes. */
export const restDecisionPatchSchema = z.object({
  body: z.optional(body),
  /** What followed the decision; empty clears it. */
  outcome: z.optional(body),
});
export type RestDecisionPatch = z.infer<typeof restDecisionPatchSchema>;

/** What `POST .../decisions/<id>/answer` is sent: an option, and a word about it. */
export const restAnswerInputSchema = z.object({
  option: z.string().check(z.minLength(1), z.maxLength(64)),
  note: z.optional(paragraphs(MAX_NOTE_LENGTH)),
});
export type RestAnswerInput = z.infer<typeof restAnswerInputSchema>;

/**
 * What an event says about its subject, so that a feed can show a line without asking for the
 * task or the decision: every field is there only when the kind has it.
 */
export const restEventDataSchema = z.object({
  number: z.optional(z.int()),
  title: z.optional(z.string()),
  /** For `task.updated`, `project.updated` and `decision.updated`: which fields changed. */
  fields: z.optional(z.array(z.string())),
  /** For the events about a document: its path, and the version written. */
  path: z.optional(z.string()),
  version: z.optional(z.int()),
  /** For `task.moved`. */
  from: z.optional(z.enum(TASK_STATES)),
  to: z.optional(z.enum(TASK_STATES)),
  question: z.optional(z.string()),
  /** For `decision.answered`: the label of the chosen option. */
  option: z.optional(z.string()),
  /** For `person.role_changed` and the events about a project's members: whose role, and what it became. */
  login: z.optional(z.string()),
  role: z.optional(z.string()),
  /** For the events about a project: its key and its name. */
  key: z.optional(z.string()),
  name: z.optional(z.string()),
  /** For what an agent did: what it calls itself. */
  agent: z.optional(z.string()),
  /** For `run.ended`: how. */
  status: z.optional(z.enum(RUN_STATUSES)),
  /** For `run.handed_in`: what the artifact is called. */
  label: z.optional(z.string()),
  /** For `run.reported`: the first words of the report. */
  excerpt: z.optional(z.string()),
});
export type RestEventData = z.infer<typeof restEventDataSchema>;

export const restEventSchema = z.object({
  /** Events are numbered in the order they were written; the feed is read from a number on. */
  id: z.int().check(z.positive()),
  kind: z.enum(EVENT_KINDS),
  /** Who did it; `null` for the console itself. */
  actor: z.nullable(restPersonSchema),
  /** The agent the actor acted as, when they acted with a token; `null` when a person did it themselves. */
  agent: z.nullable(z.string()),
  /** The project it happened in, or `null` for what happened to the workspace itself. */
  projectId: z.nullable(uuid),
  taskId: z.nullable(uuid),
  decisionId: z.nullable(uuid),
  runId: z.nullable(uuid),
  /** The document it is about, or `null`. */
  documentId: z.nullable(uuid),
  data: restEventDataSchema,
  createdAt: instant,
});
export type RestEvent = z.infer<typeof restEventSchema>;

/** What an agent reported while at work: Markdown, shown as text or rendered to elements. */
export const restReportSchema = z.object({
  id: uuid,
  body: z.string(),
  createdAt: instant,
});
export type RestReport = z.infer<typeof restReportSchema>;

/** A file a run handed in, as the console keeps it; its bytes are at `projectPath(key, "files", <artifact id>)`. */
export const restFileSchema = z.object({
  /** What the agent called it: one line, without a path. */
  name: z.string(),
  /** In bytes. */
  size: count,
  /** The media type the agent said, or `application/octet-stream`. */
  contentType: z.string(),
  /** The SHA-256 of the bytes, in hex: what the console keeps them under. */
  sha256: z.string(),
});
export type RestFile = z.infer<typeof restFileSchema>;

/** What a run handed in: a link to a branch, a pull request, a page; or a file the console keeps. */
export const restArtifactSchema = z.object({
  id: uuid,
  kind: z.enum(ARTIFACT_KINDS),
  /** The link, for a link; `null` for a file. */
  url: z.nullable(z.string()),
  label: z.nullable(z.string()),
  /** The file, for a file; `null` for a link. */
  file: z.nullable(restFileSchema),
  createdAt: instant,
});
export type RestArtifact = z.infer<typeof restArtifactSchema>;

/** One agent at work on one task for one person: what it did, and what it waits for. */
export const restRunSchema = z.object({
  id: uuid,
  taskId: uuid,
  /** The task's number, as people say it. */
  taskNumber: z.int().check(z.positive()),
  /** The person the agent acts for. */
  person: restPersonSchema,
  /** What the agent calls itself. */
  agent: z.string(),
  status: z.enum(RUN_STATUSES),
  startedAt: instant,
  endedAt: z.nullable(instant),
  /** What the agent said when the run ended, in Markdown, or `null`. */
  summary: z.nullable(z.string()),
  /** Oldest first. */
  reports: z.array(restReportSchema),
  artifacts: z.array(restArtifactSchema),
  /** The id of the decision the run waits for, or `null`. */
  waitingFor: z.nullable(uuid),
});
export type RestRun = z.infer<typeof restRunSchema>;

/** `GET /api/v1/projects/<key>/runs`: the runs, newest first. */
export const restRunsSchema = z.object({ items: z.array(restRunSchema) });
export type RestRuns = z.infer<typeof restRunsSchema>;

/** `GET .../events?after=`: what happened after that number, oldest first. */
export const restEventsSchema = z.object({
  items: z.array(restEventSchema),
  /** True when there is more after the last item than one page carries. */
  more: z.boolean(),
});
export type RestEvents = z.infer<typeof restEventsSchema>;

/**
 * A token a person made for an agent, a script or a console of their own, as their own page
 * lists it. The secret itself is answered once, when the token is made, and never kept.
 */
export const restTokenSchema = z.object({
  id: uuid,
  /** What the person calls it: the agent it is for, where it runs. */
  name: z.string(),
  createdAt: instant,
  /** When it stops being good, or `null` for a token that does not expire. */
  expiresAt: z.nullable(instant),
  /** When it was last presented, or `null` if never. */
  lastUsedAt: z.nullable(instant),
});
export type RestToken = z.infer<typeof restTokenSchema>;

/** `GET /api/v1/tokens`: the tokens of whoever asks, newest first. */
export const restTokensSchema = z.object({ items: z.array(restTokenSchema) });
export type RestTokens = z.infer<typeof restTokensSchema>;

/** What `POST /api/v1/tokens` is sent: a name, and for how many days it is good. */
export const restTokenInputSchema = z.object({
  name: line(MAX_TOKEN_NAME_LENGTH),
  /** Left out: `DEFAULT_TOKEN_DAYS`. `null`: the token does not expire. */
  expiresInDays: z.optional(z.nullable(z.int().check(z.gte(1), z.lte(MAX_TOKEN_DAYS)))),
});
export type RestTokenInput = z.infer<typeof restTokenInputSchema>;

/** What `POST /api/v1/tokens` answers: the token, and its secret, this once. */
export const restTokenCreatedSchema = z.object({
  token: restTokenSchema,
  /** Presented as `Authorization: Bearer <secret>`. The server keeps its hash, and never shows it again. */
  secret: z.string(),
});
export type RestTokenCreated = z.infer<typeof restTokenCreatedSchema>;

/** One of the project's skills, as the SkillCDN deployment lists it at the project's address. */
export const restSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** The skill's folder in the repository (`""` for the root), and the path of its `SKILL.md`. */
  directory: z.string(),
  path: z.string(),
  /** Where a person reads the skill: its page at the deployment. */
  page: z.string(),
  /** What an agent loads the skill by, through its own SkillCDN connection; `null` when the path is not one. */
  uri: z.nullable(z.string()),
  /** The title and the description in other languages, by language tag, as the repository gives them. */
  translations: z.record(
    z.string(),
    z.object({ title: z.nullable(z.string()), description: z.nullable(z.string()) }),
  ),
});
export type RestSkill = z.infer<typeof restSkillSchema>;

/** `GET /api/v1/projects/<key>/skills`: the project's skills, read by address through SkillCDN. */
export const restSkillsSchema = z.object({
  /** The address, canonical, or `null` when neither the project nor the deployment names one. */
  address: z.nullable(z.string()),
  /** The origin of the SkillCDN deployment the skills are read through. */
  source: z.string(),
  /** Where a person browses the address, or `null` without one. */
  page: z.nullable(z.string()),
  status: z.enum(SKILLS_STATUSES),
  /** The skills, when `ready`; empty otherwise. */
  items: z.array(restSkillSchema),
});
export type RestSkills = z.infer<typeof restSkillsSchema>;

/**
 * A document's path (ADR-0009): segments of lowercase letters, digits and hyphens, separated
 * by slashes, as a repository keeps files; the document's address, which does not change.
 */
const documentPath = z
  .string()
  .check(
    z.maxLength(MAX_DOCUMENT_PATH_LENGTH),
    z.refine(
      isDocumentPath,
      "must be segments of lowercase letters, digits and hyphens, separated by slashes",
    ),
  );

/** A document as a folder or a search lists it: everything but the body. */
export const restDocumentSummarySchema = z.object({
  id: uuid,
  path: documentPath,
  title: z.string(),
  /** The number of the latest version, from 1. */
  version: z.int().check(z.positive()),
  /** Who wrote the latest version, and the agent they wrote it through, or `null`. */
  updatedBy: restPersonSchema,
  agent: z.nullable(z.string()),
  /** When the document was archived, or `null` while it is current. */
  archivedAt: z.nullable(instant),
  createdAt: instant,
  updatedAt: instant,
});
export type RestDocumentSummary = z.infer<typeof restDocumentSummarySchema>;

/** `GET /api/v1/projects/<key>/docs?folder=`: a folder's pages and folders; with `q=`, the pages found. */
export const restDocumentsSchema = z.object({
  /** The folder listed, `""` for the root; `""` for a search. */
  folder: z.string(),
  /** The folders in it, as paths, by name; none for a search. */
  folders: z.array(z.string()),
  /** The pages in it, by title; or the pages found, the best first. */
  items: z.array(restDocumentSummarySchema),
});
export type RestDocuments = z.infer<typeof restDocumentsSchema>;

/** A document the document links to: its path, and its title when there is a document there yet. */
export const restDocumentLinkSchema = z.object({
  path: z.string(),
  title: z.nullable(z.string()),
});
export type RestDocumentLink = z.infer<typeof restDocumentLinkSchema>;

/** What refers to the document: another document, a task, or a decision, each by what people call it. */
export const restBacklinkSchema = z.object({
  kind: z.enum(LINK_SOURCES),
  id: uuid,
  /** The document's path, for a document. */
  path: z.nullable(z.string()),
  /** The task's number, for a task. */
  number: z.nullable(z.int()),
  /** The document's title, the task's title, or the decision's question. */
  title: z.string(),
});
export type RestBacklink = z.infer<typeof restBacklinkSchema>;

/** A file attached to a document; its bytes are at `projectPath(key, "docs", path)/files/<id>`. */
export const restDocumentFileSchema = z.object({
  id: uuid,
  label: z.nullable(z.string()),
  file: restFileSchema,
  addedBy: restPersonSchema,
  agent: z.nullable(z.string()),
  createdAt: instant,
});
export type RestDocumentFile = z.infer<typeof restDocumentFileSchema>;

/** A document in full: its latest version, what it links to, what refers to it, and its files. */
export const restDocumentSchema = z.object({
  ...restDocumentSummarySchema.shape,
  /** Markdown. Shown as text or rendered to elements, never as HTML. */
  body: z.string(),
  createdBy: restPersonSchema,
  /** The documents it links to, by path. */
  links: z.array(restDocumentLinkSchema),
  /** What links to it. */
  backlinks: z.array(restBacklinkSchema),
  files: z.array(restDocumentFileSchema),
});
export type RestDocument = z.infer<typeof restDocumentSchema>;

/** What `PUT /api/v1/projects/<key>/docs/<path>` is sent: the page as it is to be. */
export const restDocumentInputSchema = z.object({
  title: line(MAX_TITLE_LENGTH),
  body: paragraphs(MAX_DOCUMENT_LENGTH),
  /** The version the writer started from; the write is refused when the document has moved on. */
  baseVersion: z.optional(z.int().check(z.positive())),
});
export type RestDocumentInput = z.infer<typeof restDocumentInputSchema>;

/** One version of a document, as the list of them says it: who wrote it, through which agent, when. */
export const restVersionSummarySchema = z.object({
  number: z.int().check(z.positive()),
  title: z.string(),
  author: restPersonSchema,
  agent: z.nullable(z.string()),
  createdAt: instant,
});
export type RestVersionSummary = z.infer<typeof restVersionSummarySchema>;

/** `GET .../docs/<path>/versions`: newest first. */
export const restVersionsSchema = z.object({ items: z.array(restVersionSummarySchema) });
export type RestVersions = z.infer<typeof restVersionsSchema>;

/** `GET .../docs/<path>/versions/<number>`: the version with its body. */
export const restVersionSchema = z.object({
  ...restVersionSummarySchema.shape,
  body: z.string(),
});
export type RestVersion = z.infer<typeof restVersionSchema>;

export const restErrorSchema = z.object({
  error: z.object({
    /** Stable; what a client branches on. */
    code: z.string(),
    /** For a person, in English. */
    message: z.string(),
  }),
});
export type RestError = z.infer<typeof restErrorSchema>;

/** What an agent says when it ends a run: Markdown, bounded. */
const summary = paragraphs(MAX_SUMMARY_LENGTH);

/** What `POST /api/v1/projects/<key>/runs` is sent: the task to take, and what the agent calls itself. */
export const restRunInputSchema = z.object({
  taskId: uuid,
  /** Left out, the agent is called what its person called the token, or by the person's login. */
  agent: z.optional(line(MAX_AGENT_LENGTH)),
});
export type RestRunInput = z.infer<typeof restRunInputSchema>;

/** What `POST .../runs/<id>/reports` is sent: how the work goes, in Markdown. */
export const restReportInputSchema = z.object({
  body: body.check(z.refine((value) => value.trim().length > 0, "must say something")),
});
export type RestReportInput = z.infer<typeof restReportInputSchema>;

/** What `POST .../runs/<id>/artifacts` is sent: a link to what was made. */
export const restArtifactInputSchema = z.object({
  url,
  label: z.optional(line(MAX_LINK_LABEL_LENGTH)),
});
export type RestArtifactInput = z.infer<typeof restArtifactInputSchema>;

/** A media type as a client says one: `type/subtype`, lowercase, without parameters. */
const mediaType = z
  .string()
  .check(
    z.trim(),
    z.toLowerCase(),
    z.maxLength(120),
    z.regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/, "must be a media type"),
  );

/**
 * What `POST .../runs/<id>/files` is sent beside the bytes, as the parts of a form: the
 * file's name and media type come with the `file` part, the `label` is a part of its own.
 */
export const restFileInputSchema = z.object({
  name: line(MAX_FILE_NAME_LENGTH).check(
    z.refine(
      (value) => !/[\\/]/.test(value) && value !== "." && value !== "..",
      "must be a file name, not a path",
    ),
  ),
  contentType: z.optional(mediaType),
  label: z.optional(line(MAX_LINK_LABEL_LENGTH)),
});
export type RestFileInput = z.infer<typeof restFileInputSchema>;

/** What `POST .../runs/<id>/end` is sent: how the run ended, and what was done and left. */
export const restRunEndInputSchema = z.object({
  status: z.enum(RUN_ENDINGS),
  summary: z.optional(summary),
});
export type RestRunEndInput = z.infer<typeof restRunEndInputSchema>;
