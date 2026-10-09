// The mini build of zod: these schemas also run in the browser, where the full build would be
// most of what a page downloads. The server validates what it is sent with the input schemas
// and builds the output shapes; the pages and a custom console parse answers with the rest.
// Absent values are `null` on the wire, never missing keys. Changes within a version are additive.
import * as z from "zod/mini";
import {
  MAX_AGENT_LENGTH,
  MAX_BODY_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_LINKS,
  MAX_NOTE_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
  MAX_URL_LENGTH,
  MIN_OPTIONS,
} from "./limits.js";
import { hasForbiddenCodePoint } from "./text.js";
import {
  EVENT_KINDS,
  PERSON_ROLES,
  PROVIDER_KEYS,
  RUN_ENDINGS,
  RUN_STATUSES,
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

/** A body in Markdown: bounded, with its line breaks, and otherwise the same rule. */
const body = z.string().check(
  z.maxLength(MAX_BODY_LENGTH),
  z.refine((value) => !hasForbiddenCodePoint(value, true), "must not contain control characters"),
);

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

export const restTaskLinkSchema = z.object({
  url: z.string(),
  label: z.nullable(z.string()),
});
export type RestTaskLink = z.infer<typeof restTaskLinkSchema>;

export const restTaskSchema = z.object({
  id: uuid,
  /** The task's number in the workspace, the one people say out loud. */
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

/** `GET /api/v1/tasks`: the board, newest first. */
export const restTasksSchema = z.object({ items: z.array(restTaskSchema) });
export type RestTasks = z.infer<typeof restTasksSchema>;

const taskLinkInput = z.object({
  url,
  label: z.optional(z.nullable(line(MAX_LINK_LABEL_LENGTH))),
});

/** What `POST /api/v1/tasks` is sent. Everything but the title has a default. */
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

/** What `PATCH /api/v1/tasks/<id>` is sent: only what changes. */
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
      note: z.nullable(z.string()),
      by: restPersonSchema,
      at: instant,
    }),
  ),
  createdAt: instant,
  updatedAt: instant,
});
export type RestDecision = z.infer<typeof restDecisionSchema>;

/** `GET /api/v1/decisions`: the ones that wait first, newest first within each. */
export const restDecisionsSchema = z.object({ items: z.array(restDecisionSchema) });
export type RestDecisions = z.infer<typeof restDecisionsSchema>;

/** What `POST /api/v1/decisions` is sent: the question, its context, and the options. */
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

/** What `POST /api/v1/decisions/<id>/answer` is sent: an option, and a word about it. */
export const restAnswerInputSchema = z.object({
  option: z.string().check(z.minLength(1), z.maxLength(64)),
  note: z.optional(
    z.string().check(
      z.maxLength(MAX_NOTE_LENGTH),
      z.refine(
        (value) => !hasForbiddenCodePoint(value, true),
        "must not contain control characters",
      ),
    ),
  ),
});
export type RestAnswerInput = z.infer<typeof restAnswerInputSchema>;

/**
 * What an event says about its subject, so that a feed can show a line without asking for the
 * task or the decision: every field is there only when the kind has it.
 */
export const restEventDataSchema = z.object({
  number: z.optional(z.int()),
  title: z.optional(z.string()),
  /** For `task.updated`: which fields changed. */
  fields: z.optional(z.array(z.string())),
  /** For `task.moved`. */
  from: z.optional(z.enum(TASK_STATES)),
  to: z.optional(z.enum(TASK_STATES)),
  question: z.optional(z.string()),
  /** For `decision.answered`: the label of the chosen option. */
  option: z.optional(z.string()),
  /** For `person.role_changed`: whose role, and what it became. */
  login: z.optional(z.string()),
  role: z.optional(z.enum(PERSON_ROLES)),
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
  taskId: z.nullable(uuid),
  decisionId: z.nullable(uuid),
  runId: z.nullable(uuid),
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

/** What a run handed in: a link to a branch, a pull request, a page. */
export const restArtifactSchema = z.object({
  id: uuid,
  url: z.string(),
  label: z.nullable(z.string()),
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

/** `GET /api/v1/runs?task=`: the runs, newest first. */
export const restRunsSchema = z.object({ items: z.array(restRunSchema) });
export type RestRuns = z.infer<typeof restRunsSchema>;

/** `GET /api/v1/events?after=`: what happened after that number, oldest first. */
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
const summary = z.string().check(
  z.maxLength(MAX_SUMMARY_LENGTH),
  z.refine((value) => !hasForbiddenCodePoint(value, true), "must not contain control characters"),
);

/** What `POST /api/v1/runs` is sent: the task to take, and what the agent calls itself. */
export const restRunInputSchema = z.object({
  taskId: uuid,
  /** Left out, the agent is called what its person called the token, or by the person's login. */
  agent: z.optional(line(MAX_AGENT_LENGTH)),
});
export type RestRunInput = z.infer<typeof restRunInputSchema>;

/** What `POST /api/v1/runs/<id>/reports` is sent: how the work goes, in Markdown. */
export const restReportInputSchema = z.object({
  body: body.check(z.refine((value) => value.trim().length > 0, "must say something")),
});
export type RestReportInput = z.infer<typeof restReportInputSchema>;

/** What `POST /api/v1/runs/<id>/artifacts` is sent: a link to what was made. */
export const restArtifactInputSchema = z.object({
  url,
  label: z.optional(line(MAX_LINK_LABEL_LENGTH)),
});
export type RestArtifactInput = z.infer<typeof restArtifactInputSchema>;

/** What `POST /api/v1/runs/<id>/end` is sent: how the run ended, and what was done and left. */
export const restRunEndInputSchema = z.object({
  status: z.enum(RUN_ENDINGS),
  summary: z.optional(summary),
});
export type RestRunEndInput = z.infer<typeof restRunEndInputSchema>;
