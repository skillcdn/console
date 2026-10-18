// The mini build of zod: these schemas also run in the browser, where the full build would be
// most of what a page downloads. The server validates what it is sent with the input schemas
// and builds the output shapes; the pages and a custom console parse answers with the rest.
// Absent values are `null` on the wire, never missing keys. Changes within a version are additive.
import {
  restBrowseSchema as packBrowseSchema,
  restFileSchema as packFileSchema,
  restFindSchema as packFindSchema,
  restMountSchema as packMountSchema,
  restSkillSchema as packSkillSchema,
} from "@skillcdn/core";
import * as z from "zod/mini";
import { isDocumentPath } from "./documents.js";
import {
  MAX_AGENT_LENGTH,
  MAX_BODY_LENGTH,
  MAX_CATEGORY_KEY_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_DOCUMENT_LENGTH,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_FILE_NAME_LENGTH,
  MAX_LANGUAGE_TAG_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_LINKS,
  MAX_LOGIN_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_SYMBOL_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_RULES_LENGTH,
  MAX_SECRET_LENGTH,
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
  CATEGORY_COLORS,
  COLOR_NAMES,
  EVENT_KINDS,
  GOAL_STATES,
  LINK_SOURCES,
  MEMBERSHIP_SOURCES,
  PACK_CONNECT_ENDINGS,
  PEOPLE_VISIBILITIES,
  PERSON_ROLES,
  PERSON_STATUSES,
  PROJECT_ICON_TYPES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  PROVIDER_KEYS,
  type ProviderKey,
  RULES_SOURCES,
  RUN_ENDINGS,
  RUN_STATUSES,
  SKILLS_STATUSES,
  TASK_PRIORITIES,
  TASK_STATES,
  WEEK_STARTS,
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
/** A calendar day (`2026-10-20`): a plan is made in days, wherever the people are (ADR-0019). */
const day = z.iso.date();
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
  /** Whether they are in: `active`, or `deactivated`, kept for what they did and shown as such (ADR-0022). */
  status: z.enum(PERSON_STATUSES),
  /** What let them in: the organization, the domain, or an administrator's listing. */
  source: z.enum(MEMBERSHIP_SOURCES),
  /** When they were deactivated, or `null`. */
  deactivatedAt: z.nullable(instant),
});
export type RestPerson = z.infer<typeof restPersonSchema>;

/** The provider a login belongs to, by its shape: an address is Google's, anything else the git host's. */
export function hostOfLogin(login: string): ProviderKey {
  return login.includes("@") ? "google" : "gh";
}

/** Whether `login` is spelled as the host spells one: a login at the git host, an address at Google. */
export function isLoginAt(host: ProviderKey, login: string): boolean {
  return host === "gh"
    ? /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login);
}

/**
 * A login an administrator let in, which has not signed in yet (ADR-0022): whoever signs in
 * with that account at that host becomes the person.
 */
export const restListingSchema = z.object({
  id: uuid,
  host: z.enum(PROVIDER_KEYS),
  /** The login at the host, as the administrator spelled it. */
  login: z.string(),
  createdAt: instant,
});
export type RestListing = z.infer<typeof restListingSchema>;

/** The organization at the git host whose members are in (ADR-0022), and when it was last read whole. */
export const restOrganizationSchema = z.object({
  host: z.enum(PROVIDER_KEYS),
  /** What the organization is called at the host. */
  name: z.string(),
  /** When the worker last read it whole, or `null` until it has. */
  syncedAt: z.nullable(instant),
});
export type RestOrganization = z.infer<typeof restOrganizationSchema>;

/** What `POST /api/v1/listings` is sent: a login at one of the providers the deployment has. */
export const restListingInputSchema = z
  .object({
    host: z.enum(PROVIDER_KEYS),
    login: z.string().check(z.trim(), z.minLength(1), z.maxLength(MAX_LOGIN_LENGTH)),
  })
  .check(z.refine((input) => isLoginAt(input.host, input.login), "must be a login at the host"));
export type RestListingInput = z.infer<typeof restListingInputSchema>;

/** An identity provider people may sign in through, as the pages offer it. */
export const restProviderSchema = z.object({
  key: z.enum(PROVIDER_KEYS),
  /** What people read on the button. */
  label: z.string(),
});
export type RestProvider = z.infer<typeof restProviderSchema>;

/**
 * A time zone's name as the IANA database spells one (`Asia/Seoul`, `UTC`): its shape here; the
 * server knows which names are zones.
 */
export const timeZoneName = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(64),
    z.regex(/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/, "must be a time zone name"),
  );

/** A language tag as a browser sends one (`en`, `ko-KR`): what the pages speak, by the person's choice. */
const languageTag = z
  .string()
  .check(
    z.maxLength(MAX_LANGUAGE_TAG_LENGTH),
    z.regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, "must be a language tag"),
  );

/** What `PATCH /api/v1/me` is sent: the language the person chose, or `null` to choose none. */
export const restMePatchSchema = z.object({ language: z.nullable(languageTag) });
export type RestMePatch = z.infer<typeof restMePatchSchema>;

/**
 * The workspace as `GET /api/v1/me` describes it, and as `PATCH /api/v1/workspace` answers: what
 * the board is called, what the deployment's configuration says of it, and the settings an
 * administrator keeps on the Settings page (ADR-0035).
 */
export const restWorkspaceSchema = z.object({
  name: z.string(),
  /** The most days a token may be good for here, or `null` when a person chooses. */
  tokenDaysAtMost: z.nullable(z.int().check(z.positive())),
  /**
   * The organization's skills: the origin of the SkillCDN deployment they are read through,
   * and the address a project without one of its own reads, canonical, or `null` for none.
   */
  skills: z.object({ source: z.string(), address: z.nullable(z.string()) }),
  /**
   * Who sees whom on the People page (ADR-0035): everyone, or the people one shares a project
   * with. Read as optional, so that a console older than this setting still answers; `everyone`
   * then, which is what it does.
   */
  peopleVisibility: z.optional(z.enum(PEOPLE_VISIBILITIES)),
  /** The day the calendars begin a week on: the language's, Monday or Sunday. Optional as above; `auto` then. */
  weekStart: z.optional(z.enum(WEEK_STARTS)),
  /**
   * The workspace's time zone, an IANA name, in which the command prints moments; `null` for
   * none, when they stay as the API gives them, in UTC. Optional as above; none then.
   */
  timeZone: z.optional(z.nullable(timeZoneName)),
});
export type RestWorkspace = z.infer<typeof restWorkspaceSchema>;

/** What `PATCH /api/v1/workspace` is sent, by an administrator: the settings to change, at least one. */
export const restWorkspacePatchSchema = z
  .object({
    peopleVisibility: z.optional(z.enum(PEOPLE_VISIBILITIES)),
    weekStart: z.optional(z.enum(WEEK_STARTS)),
    /** A zone's name, or `null` for none. */
    timeZone: z.optional(z.nullable(timeZoneName)),
  })
  .check(
    z.refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: "names nothing to change",
    }),
  );
export type RestWorkspacePatch = z.infer<typeof restWorkspacePatchSchema>;

/**
 * `GET /api/v1/me`: the workspace, who the session cookie says is signed in (or `null`), the
 * language they chose (or `null`), and the identity providers people sign in through, none
 * where nobody can.
 */
export const restMeSchema = z.object({
  workspace: restWorkspaceSchema,
  person: z.nullable(restPersonSchema),
  /**
   * What the token asking is called by its person, when a token asks: how a console of a
   * person's own knows it holds one. `null` on a session, and for nobody.
   */
  agent: z.nullable(z.string()),
  /** The language the person chose for the pages (ADR-0012), or `null` for the browser's. */
  language: z.nullable(languageTag),
  signIn: z.array(restProviderSchema),
  /**
   * The console's version and the range of command versions it takes, as npm spells one
   * (ADR-0025): what a console of a person's own compares the package it was built on with.
   * Every console answers it from 0.1.18; read as optional, so that a command or a console
   * built on this package still reads an older console's answer, and says it is older.
   */
  console: z.optional(z.object({ version: z.string(), clientRange: z.string() })),
});
export type RestMe = z.infer<typeof restMeSchema>;

/**
 * `GET /api/v1/people`: everyone who has signed in, by login, the logins let in that have not,
 * and the organization that says who is in, where the deployment names one.
 */
export const restPeopleSchema = z.object({
  items: z.array(restPersonSchema),
  listed: z.array(restListingSchema),
  organization: z.nullable(restOrganizationSchema),
});
export type RestPeople = z.infer<typeof restPeopleSchema>;

/**
 * What `PATCH /api/v1/people/<id>` is sent, by an administrator: what the person is to be, and
 * whether they are in; either, or both.
 */
export const restPersonPatchSchema = z
  .object({
    role: z.optional(z.enum(PERSON_ROLES)),
    status: z.optional(z.enum(PERSON_STATUSES)),
  })
  .check(
    z.refine(
      (patch) => patch.role !== undefined || patch.status !== undefined,
      "must name a role or a status",
    ),
  );
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

/** A project's mark: a letter or two, or a symbol, with no space in it; shown on the project's colour. */
const projectSymbol = line(MAX_PROJECT_SYMBOL_LENGTH).check(
  z.refine((value) => !/\s/.test(value), "must have no space in it"),
);

/** A project of the workspace, as the asker sees it: with what they are in it. */
/** A project's own image for its mark: the hash it is kept by, which `projectIconPath` reads it with, and its kind. */
export const restProjectIconSchema = z.object({
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  contentType: z.enum(PROJECT_ICON_TYPES),
});
export type RestProjectIcon = z.infer<typeof restProjectIconSchema>;

export const restProjectSchema = z.object({
  id: uuid,
  key: projectKey,
  name: z.string(),
  description: z.string(),
  /** Who is a member: every member of the workspace, or only those listed. */
  visibility: z.enum(PROJECT_VISIBILITIES),
  /** The address of the project's skills at the SkillCDN deployment, canonical, or `null` for the organization's. */
  skillsAddress: z.nullable(z.string()),
  /** The colour of the project's mark, one of the names, or `null` for one chosen from its key. */
  color: z.nullable(z.enum(COLOR_NAMES)),
  /** The project's mark, a letter or two or a symbol, or `null` for the first letter of its name. */
  symbol: z.nullable(z.string()),
  /** The project's own image for its mark, shown in place of the symbol, or `null` for none. */
  icon: z.nullable(restProjectIconSchema),
  /** The pack token the project reads a private pack with (ADR-0028): when it was set, never the token; `null` for none. */
  packToken: z.nullable(z.object({ setAt: instant })),
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
  /** Left out or `null`: a colour chosen from the key, and the first letter of the name. */
  color: z.optional(z.nullable(z.enum(COLOR_NAMES))),
  symbol: z.optional(z.nullable(projectSymbol)),
});
export type RestProjectInput = z.infer<typeof restProjectInputSchema>;

/** What `PATCH /api/v1/projects/<key>` is sent: only what changes; the key does not. */
export const restProjectPatchSchema = z.object({
  name: z.optional(line(MAX_PROJECT_NAME_LENGTH)),
  description: z.optional(paragraphs(MAX_PROJECT_DESCRIPTION_LENGTH)),
  visibility: z.optional(z.enum(PROJECT_VISIBILITIES)),
  skillsAddress: z.optional(z.nullable(skillsAddress)),
  color: z.optional(z.nullable(z.enum(COLOR_NAMES))),
  symbol: z.optional(z.nullable(projectSymbol)),
});
export type RestProjectPatch = z.infer<typeof restProjectPatchSchema>;

/**
 * A member of a project, with what they are in it: a person listed in it, or, in a project open
 * to the workspace, anyone of the workspace, who is a member of it without a listing (ADR-0035).
 */
export const restMemberSchema = z.object({
  person: restPersonSchema,
  /** What they are in it: an owner as listed or as an administrator, else a member. */
  role: z.enum(PROJECT_ROLES),
  /** Since when: the listing's day, or, for a member without one, the later of the project's making and their joining. */
  addedAt: instant,
  /**
   * Whether a listing holds them in the project. Read as optional, so that a console older than
   * this field still answers; everyone it lists is listed.
   */
  listed: z.optional(z.boolean()),
});
export type RestMember = z.infer<typeof restMemberSchema>;

/** `GET /api/v1/projects/<key>/members`: the members, by login; everyone of the workspace in a project open to it. */
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

/**
 * A category's key: what the command and the filters say, as a project's key is. Lowercase
 * letters, digits and hyphens; immutable once the category is made.
 */
const categoryKey = z
  .string()
  .check(
    z.maxLength(MAX_CATEGORY_KEY_LENGTH),
    z.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "must be lowercase letters, digits and hyphens"),
  );

/** A category tasks are sorted into (ADR-0019): the workspace's own word for a kind of work. */
export const restCategorySchema = z.object({
  key: categoryKey,
  name: z.string(),
  /** One of the names the pages paint a category in. */
  color: z.enum(CATEGORY_COLORS),
  createdAt: instant,
  updatedAt: instant,
});
export type RestCategory = z.infer<typeof restCategorySchema>;

/** `GET /api/v1/categories`: the workspace's categories, by name. */
export const restCategoriesSchema = z.object({ items: z.array(restCategorySchema) });
export type RestCategories = z.infer<typeof restCategoriesSchema>;

/** What `POST /api/v1/categories` is sent, by an administrator: the key, the name, and a colour or the plain one. */
export const restCategoryInputSchema = z.object({
  key: categoryKey,
  name: line(MAX_CATEGORY_NAME_LENGTH),
  /** Left out: `gray`. */
  color: z.optional(z.enum(CATEGORY_COLORS)),
});
export type RestCategoryInput = z.infer<typeof restCategoryInputSchema>;

/** What `PATCH /api/v1/categories/<key>` is sent: only what changes; the key does not. */
export const restCategoryPatchSchema = z.object({
  name: z.optional(line(MAX_CATEGORY_NAME_LENGTH)),
  color: z.optional(z.enum(CATEGORY_COLORS)),
});
export type RestCategoryPatch = z.infer<typeof restCategoryPatchSchema>;

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
  /** The category the task is sorted into, as the workspace keeps it, or `null`. */
  category: z.nullable(
    z.object({ key: z.string(), name: z.string(), color: z.enum(CATEGORY_COLORS) }),
  ),
  /** The goal of the project's roadmap the task works towards, or `null`. */
  goalId: z.nullable(uuid),
  /** The plan (ADR-0019): the day the work is meant to begin, and the day it is due, each or `null`. */
  startsOn: z.nullable(day),
  dueOn: z.nullable(day),
  /** What happened: when the task was first moved past ready, and when it was moved to done; each or `null`. The board keeps both. */
  startedAt: z.nullable(instant),
  doneAt: z.nullable(instant),
  /** When the task was put away (ADR-0029): out of the listings, the board and the calendar, open by its number; `null` while current. */
  archivedAt: z.nullable(instant),
  links: z.array(restTaskLinkSchema),
  /** How many decisions about this task wait for a person. */
  openDecisions: count,
  /** How many runs are at work on it, or waiting. */
  openRuns: count,
  createdAt: instant,
  updatedAt: instant,
});
export type RestTask = z.infer<typeof restTaskSchema>;

/** `POST .../tasks/archive`: every done or dropped task of a goal put away at once (ADR-0029). */
export const restArchiveTasksInputSchema = z.object({ goalId: uuid });
export type RestArchiveTasksInput = z.infer<typeof restArchiveTasksInputSchema>;
/** What it answers: how many were put away. */
export const restArchivedTasksSchema = z.object({ archived: count });
export type RestArchivedTasks = z.infer<typeof restArchivedTasksSchema>;

/** `GET /api/v1/projects/<key>/tasks`: a page of the board, newest first, and whether there is more after it. */
export const restTasksSchema = z.object({ items: z.array(restTaskSchema), more: z.boolean() });
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
  /** The key of a category of the workspace, or `null` for none. */
  category: z.optional(z.nullable(categoryKey)),
  /** A goal of the project, or `null` for none. */
  goalId: z.optional(z.nullable(uuid)),
  /** The plan, in days; the due day is not before the start. */
  startsOn: z.optional(z.nullable(day)),
  dueOn: z.optional(z.nullable(day)),
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
  category: z.optional(z.nullable(categoryKey)),
  goalId: z.optional(z.nullable(uuid)),
  startsOn: z.optional(z.nullable(day)),
  dueOn: z.optional(z.nullable(day)),
  links: z.optional(z.array(taskLinkInput).check(z.maxLength(MAX_LINKS))),
});
export type RestTaskPatch = z.infer<typeof restTaskPatchSchema>;

/** How many tasks a goal has in each state: what its progress is read from, live. */
export const restTaskCountsSchema = z.object({
  idea: count,
  ready: count,
  in_progress: count,
  in_review: count,
  done: count,
  dropped: count,
});
export type RestTaskCounts = z.infer<typeof restTaskCountsSchema>;

/**
 * A goal of a project's roadmap (ADR-0019): what the project works towards, with the day it is
 * meant to be reached by, and how far the tasks under it are.
 */
export const restGoalSchema = z.object({
  id: uuid,
  title: z.string(),
  /** Markdown: what reaching the goal means. Shown as text or rendered to elements, never as HTML. */
  body: z.string(),
  state: z.enum(GOAL_STATES),
  /** The category the goal is sorted into, as the workspace keeps it, or `null` (ADR-0026). */
  category: z.nullable(
    z.object({ key: z.string(), name: z.string(), color: z.enum(CATEGORY_COLORS) }),
  ),
  /** The plan (ADR-0026): the day the work towards the goal is meant to begin, or `null`. */
  startsOn: z.nullable(day),
  /** The day the goal is meant to be reached by, or `null`. */
  dueOn: z.nullable(day),
  createdBy: restPersonSchema,
  /** The tasks that work towards it, counted by state. */
  taskCounts: restTaskCountsSchema,
  createdAt: instant,
  updatedAt: instant,
});
export type RestGoal = z.infer<typeof restGoalSchema>;

/** `GET /api/v1/projects/<key>/goals`: the roadmap, the active goals first. */
export const restGoalsSchema = z.object({ items: z.array(restGoalSchema) });
export type RestGoals = z.infer<typeof restGoalsSchema>;

/** What `POST /api/v1/projects/<key>/goals` is sent: the title, and the rest with defaults. */
export const restGoalInputSchema = z.object({
  title: line(MAX_TITLE_LENGTH),
  body: z.optional(body),
  /** Left out: `planned`. */
  state: z.optional(z.enum(GOAL_STATES)),
  /** The key of a category of the workspace, or `null` for none. */
  category: z.optional(z.nullable(categoryKey)),
  startsOn: z.optional(z.nullable(day)),
  dueOn: z.optional(z.nullable(day)),
});
export type RestGoalInput = z.infer<typeof restGoalInputSchema>;

/** What `PATCH /api/v1/projects/<key>/goals/<id>` is sent: only what changes. */
export const restGoalPatchSchema = z.object({
  title: z.optional(line(MAX_TITLE_LENGTH)),
  body: z.optional(body),
  state: z.optional(z.enum(GOAL_STATES)),
  category: z.optional(z.nullable(categoryKey)),
  startsOn: z.optional(z.nullable(day)),
  dueOn: z.optional(z.nullable(day)),
});
export type RestGoalPatch = z.infer<typeof restGoalPatchSchema>;

export const restDecisionOptionSchema = z.object({
  /** What an answer names: stable once given. */
  id: z.string(),
  label: z.string(),
  /**
   * On the one option a person's own answer became, when they answered in their own words
   * instead of choosing (`POST .../answer` with `own`): added then, after the options given,
   * which carry no `own`.
   */
  own: z.optional(z.literal(true)),
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

/** `GET /api/v1/projects/<key>/decisions`: a page, the ones that wait first, newest first within each, and whether there is more. */
export const restDecisionsSchema = z.object({
  items: z.array(restDecisionSchema),
  more: z.boolean(),
});
export type RestDecisions = z.infer<typeof restDecisionsSchema>;

/** The project a thing on a person's plate belongs to, named and marked for the page to say, link and show it. */
const projectRef = z.object({
  key: projectKey,
  name: z.string(),
  color: z.nullable(z.enum(COLOR_NAMES)),
  symbol: z.nullable(z.string()),
  icon: z.nullable(restProjectIconSchema),
});

/**
 * `GET /api/v1/work`: what is on the asker's plate across the projects they may see (ADR-0019):
 * the open tasks assigned to them, and the decisions that wait for a person, each with its
 * project; and, for the week on the plate, `closed`, the tasks assigned to them that are done
 * or dropped and not yet put away. Left out by a console older than it.
 */
export const restWorkSchema = z.object({
  tasks: z.array(z.object({ project: projectRef, task: restTaskSchema })),
  closed: z.optional(z.array(z.object({ project: projectRef, task: restTaskSchema }))),
  decisions: z.array(z.object({ project: projectRef, decision: restDecisionSchema })),
});
export type RestWork = z.infer<typeof restWorkSchema>;

/**
 * What `GET /api/v1/people/<id>/work` answers: another person's open tasks, and their closed
 * ones for the week, within the projects the asker may see, for whoever oversees them. No
 * decisions, which wait for anyone.
 */
export const restPersonWorkSchema = z.object({
  tasks: restWorkSchema.shape.tasks,
  closed: restWorkSchema.shape.closed,
});
export type RestPersonWork = z.infer<typeof restPersonWorkSchema>;

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

/**
 * What `POST .../decisions/<id>/answer` is sent: one of the options by its id, or the person's
 * own answer in a line, one of the two; and a word about either.
 */
export const restAnswerInputSchema = z
  .object({
    /** The id of the chosen option. */
    option: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
    /** The person's own answer, when none of the options is it: one line, worded as an option is. */
    own: z.optional(line(MAX_OPTION_LABEL_LENGTH)),
    note: z.optional(paragraphs(MAX_NOTE_LENGTH)),
  })
  .check(
    z.refine(
      (input) => (input.option === undefined) !== (input.own === undefined),
      "must name an option or give an answer of its own, one of the two",
    ),
  );
export type RestAnswerInput = z.infer<typeof restAnswerInputSchema>;

/**
 * What an event says about its subject, so that a feed can show a line without asking for the
 * task or the decision: every field is there only when the kind has it.
 */
export const restEventDataSchema = z.object({
  number: z.optional(z.int()),
  title: z.optional(z.string()),
  /** For `task.updated`, `project.updated`, `goal.updated` and `decision.updated`: which fields changed. */
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
  /** For `run.reported` and `task.commented`: the first words of what was written. */
  excerpt: z.optional(z.string()),
  /** For `task.commented`: how many files came with it. */
  files: z.optional(z.int()),
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
  /** The goal it is about, or `null`. */
  goalId: z.nullable(uuid),
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
  /**
   * When the agent was last heard from on this run: when it began, reported, handed in or
   * asked. The board cannot know whether an agent still runs; this is what it knows.
   */
  lastHeardAt: instant,
  /** What the agent said when the run ended, in Markdown, or `null`. */
  summary: z.nullable(z.string()),
  /** Oldest first. */
  reports: z.array(restReportSchema),
  artifacts: z.array(restArtifactSchema),
  /** The id of the decision the run waits for, or `null`. */
  waitingFor: z.nullable(uuid),
});
export type RestRun = z.infer<typeof restRunSchema>;

/** `GET /api/v1/projects/<key>/runs`: a page of the runs, newest first, and whether there is more. */
export const restRunsSchema = z.object({ items: z.array(restRunSchema), more: z.boolean() });
export type RestRuns = z.infer<typeof restRunsSchema>;

/** A file put in a comment, kept as a run's file is; its bytes are at `projectPath(key, "files", <id>)`. */
export const restCommentFileSchema = z.object({
  id: uuid,
  file: restFileSchema,
});
export type RestCommentFile = z.infer<typeof restCommentFileSchema>;

/**
 * A word in the discussion on a task (ADR-0024): by a person, or by their agent, with the
 * files put in it. Never rewritten: a mistake is corrected in the next one.
 */
export const restCommentSchema = z.object({
  id: uuid,
  taskId: uuid,
  author: restPersonSchema,
  /** The agent the author wrote through, or `null` when a person wrote it themselves. */
  agent: z.nullable(z.string()),
  /** Markdown. A picture among the files is placed in it as `![words](its name)`. */
  body: z.string(),
  files: z.array(restCommentFileSchema),
  createdAt: instant,
});
export type RestComment = z.infer<typeof restCommentSchema>;

/** `GET .../tasks/<id>/comments`: the discussion on a task, oldest first, whole. */
export const restCommentsSchema = z.object({ items: z.array(restCommentSchema) });
export type RestComments = z.infer<typeof restCommentsSchema>;

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
  /** The version of the command that last presented it (`0.1.18`), or `null` when the last to present it named none. */
  client: z.nullable(z.string()),
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

/** What `POST /api/v1/connect` is sent by the command: what the agent calls itself, and where it runs. */
export const restConnectInputSchema = z.object({ agent: line(MAX_TOKEN_NAME_LENGTH) });
export type RestConnectInput = z.infer<typeof restConnectInputSchema>;

/**
 * What `POST /api/v1/connect` answers (ADR-0011): the code a person approves, the address of the
 * console's own page for it, and the secret the command claims the token with, shown nowhere.
 */
export const restConnectionSchema = z.object({
  code: z.string(),
  url: z.string(),
  secret: z.string(),
  expiresAt: instant,
  /** How many seconds the command waits between claims. */
  interval: z.int().check(z.positive()),
});
export type RestConnection = z.infer<typeof restConnectionSchema>;

/** `GET /api/v1/connect/<code>`: what asks to connect, for the person who approves it. */
export const restConnectRequestSchema = z.object({
  code: z.string(),
  /** What the agent calls itself, and where it runs. */
  agent: z.string(),
  createdAt: instant,
  expiresAt: instant,
  approved: z.boolean(),
});
export type RestConnectRequest = z.infer<typeof restConnectRequestSchema>;

/** What `POST /api/v1/connect/claim` is sent: the secret the connection began with. */
export const restClaimInputSchema = z.object({
  secret: z.string().check(z.minLength(1), z.maxLength(MAX_SECRET_LENGTH)),
});
export type RestClaimInput = z.infer<typeof restClaimInputSchema>;

/** What the claim answers: wait, or the token this once, with its secret. */
export const restClaimSchema = z.union([
  z.object({ status: z.literal("pending"), expiresAt: instant }),
  z.object({ status: z.literal("connected"), token: restTokenSchema, secret: z.string() }),
]);
export type RestClaim = z.infer<typeof restClaimSchema>;

/** Why a pack did not answer a read: the code and the words the deployment, or the console reading a directory, gave, as the main repository's API spells them. */
export const restPackRefusalSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** With a file the pack will not carry: where it is at its source, or `null`. */
  sourceUrl: z.nullable(z.string()),
  /** With `skill.ambiguous`: the directories to choose from. */
  directories: z.array(z.string()),
});
export type RestPackRefusal = z.infer<typeof restPackRefusalSchema>;

/** What every answer about a pack says first: its address, where it is read, and how the read went. */
const packEnvelope = {
  /** The address, canonical, or `null` when neither the project nor the console names one. */
  address: z.nullable(z.string()),
  /** The origin of the SkillCDN deployment the pack is read at; `null` for a pack read from a directory on the console's machine (ADR-0031). */
  source: z.nullable(z.string()),
  /** Where a person browses the address at the deployment, or `null` without one. */
  page: z.nullable(z.string()),
  status: z.enum(SKILLS_STATUSES),
  /** Why the read did not happen, in the pack's own words, when `status` says it did not; `null` otherwise. */
  refusal: z.nullable(restPackRefusalSchema),
};

/** One of the project's skills, as the pack lists it: what the repository says of it, where a person reads it, what an agent loads it by. */
export const restSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** The skill's folder in the repository (`""` for the root), and the path of its `SKILL.md`. */
  directory: z.string(),
  path: z.string(),
  /** Where a person reads the skill: its page at the deployment, or `null` for a pack read from a directory. */
  page: z.nullable(z.string()),
  /** What an agent loads the skill by, through its own SkillCDN connection; `null` when the path is not one. */
  uri: z.nullable(z.string()),
  /** The title and the description in other languages, by language tag, as the repository gives them. */
  translations: z.record(
    z.string(),
    z.object({ title: z.nullable(z.string()), description: z.nullable(z.string()) }),
  ),
});
export type RestSkill = z.infer<typeof restSkillSchema>;

/** `GET /api/v1/projects/<key>/skills`: the project's pack, read by address (ADR-0028, ADR-0031). */
export const restSkillsSchema = z.object({
  ...packEnvelope,
  /** The pack as its manifest or its README names it, when `ready`: what it is called, what it is for, the language it is written in. */
  pack: z.optional(
    z.object({
      name: z.nullable(z.string()),
      description: z.nullable(z.string()),
      language: z.nullable(z.string()),
    }),
  ),
  /** How many skills and documents the index found at the address, when `ready`. */
  counts: z.optional(z.object({ skills: count, documents: count })),
  /** The skills, when `ready`; empty otherwise. */
  items: z.array(restSkillSchema),
  /** What the address serves, as the main repository's REST API answers it (`RestMount` of `@skillcdn/core`), for a program that renders what a model is given; `null` when nothing was answered. */
  mount: z.nullable(packMountSchema),
});
export type RestSkills = z.infer<typeof restSkillsSchema>;

/** `PUT .../pack-token`: the token a person made at the deployment for the project's pack (ADR-0028); from a field or standard input, never an argument. */
export const restPackTokenInputSchema = z.object({
  token: z
    .string()
    .check(z.minLength(8), z.maxLength(1024), z.regex(/^\S+$/, "must have no space in it")),
});
export type RestPackTokenInput = z.infer<typeof restPackTokenInputSchema>;

/**
 * `POST .../pack-token/connect` (ADR-0036): what the person is shown, as the deployment said it,
 * the code and the page to approve it on, until when, and how often the console asks again. The
 * secret the console claims the token with stays with the console.
 */
export const restPackConnectStartedSchema = z.object({
  code: z.string(),
  url: z.string(),
  expiresAt: instant,
  intervalSeconds: z.int().check(z.positive()),
});
export type RestPackConnectStarted = z.infer<typeof restPackConnectStartedSchema>;

/**
 * `GET .../pack-token/connect`: how the connection stands. Nothing asked; waiting for the
 * person, with what they were shown; connected, the token kept and the project as it stands; or
 * ended short of a token, and why.
 */
export const restPackConnectSchema = z.union([
  z.object({ status: z.literal("none") }),
  z.object({
    status: z.literal("pending"),
    code: z.string(),
    url: z.string(),
    expiresAt: instant,
    intervalSeconds: z.int().check(z.positive()),
  }),
  z.object({ status: z.literal("connected"), project: restProjectSchema }),
  z.object({ status: z.literal("ended"), reason: z.enum(PACK_CONNECT_ENDINGS) }),
]);
export type RestPackConnect = z.infer<typeof restPackConnectSchema>;

/** `GET .../skills/one?path=&cursor=`: a page of a skill's context, as the pack answers `load_skill` (`RestSkill` of `@skillcdn/core`); `read` is `null` unless `ready`. */
export const restSkillLoadSchema = z.object({
  ...packEnvelope,
  read: z.nullable(packSkillSchema),
});
export type RestSkillLoad = z.infer<typeof restSkillLoadSchema>;

/** `GET .../skills/file?path=&offset=&limit=`: a page of a file, or what a folder holds, as the pack answers `read_repo_file` (`RestFile` of `@skillcdn/core`); `read` is `null` unless `ready`. */
export const restSkillFileSchema = z.object({
  ...packEnvelope,
  read: z.nullable(packFileSchema),
});
export type RestSkillFile = z.infer<typeof restSkillFileSchema>;

/** `GET .../skills/browse?path=&cursor=&limit=`: what a folder holds, a page of it, as the pack answers `browse_repo` (`RestBrowse` of `@skillcdn/core`); `read` is `null` unless `ready`. */
export const restSkillBrowseSchema = z.object({
  ...packEnvelope,
  read: z.nullable(packBrowseSchema),
});
export type RestSkillBrowse = z.infer<typeof restSkillBrowseSchema>;

/** `GET .../skills/find?query=&path=&cursor=&limit=`: what words find, a page of it in relevance order, as the pack answers `search_repo` (`RestFind` of `@skillcdn/core`); `read` is `null` unless `ready`. */
export const restSkillFindSchema = z.object({
  ...packEnvelope,
  read: z.nullable(packFindSchema),
});
export type RestSkillFind = z.infer<typeof restSkillFindSchema>;

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

/**
 * `GET /api/v1/rules`, and each half of a project's (ADR-0023): the rules that hold, and where
 * they come from. `reference`: the console's own, since the organization wrote none;
 * `written`: the page written, with its facts; `none`: a project that adds none.
 */
export const restRulesSchema = z.object({
  source: z.enum(RULES_SOURCES),
  /** The rules as they hold, Markdown; `null` for a project that adds none. */
  body: z.nullable(z.string()),
  /** The page they are written on, or `null` for the console's own and for none. */
  page: z.nullable(restDocumentSummarySchema),
});
export type RestRules = z.infer<typeof restRulesSchema>;

/** `GET /api/v1/projects/<key>/rules`: the workspace's rules, and what the project adds to them. */
export const restProjectRulesSchema = z.object({
  workspace: restRulesSchema,
  project: restRulesSchema,
});
export type RestProjectRules = z.infer<typeof restProjectRulesSchema>;

/** What `PUT /api/v1/rules` is sent: the rules as they are to be. */
export const restRulesInputSchema = z.object({
  body: paragraphs(MAX_RULES_LENGTH),
  /** The version the writer started from; the write is refused when the rules have moved on. */
  baseVersion: z.optional(z.int().check(z.positive())),
});
export type RestRulesInput = z.infer<typeof restRulesInputSchema>;

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

/**
 * What `POST .../tasks/<id>/comments` is sent as JSON: the word, in Markdown. As a form, the
 * part `body` says the same and the parts `file` carry the files; then the body may be blank.
 */
export const restCommentInputSchema = z.object({
  body,
});
export type RestCommentInput = z.infer<typeof restCommentInputSchema>;

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
