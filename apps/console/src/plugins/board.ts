import {
  CONSOLE_LANGUAGES,
  hasForbiddenCodePoint,
  isDocumentPath,
  MAX_BODY_LENGTH,
  MAX_COMMENTS_PER_TASK,
  MAX_DECIDERS,
  MAX_DOCUMENTS_PER_PROJECT,
  MAX_FILES_PER_COMMENT,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_VERSIONS_PER_DOCUMENT,
  MIN_OPTIONS,
  OPTION_KEY_PATTERN,
  type RestTask,
  restTaskInputSchema,
  restTaskPatchSchema,
  TASK_STATES,
} from "@skillcdn/console/api";
import {
  type CollectionDescription,
  isCalendarDay,
  PLUGIN_LIST_LIMIT,
  type PluginCaller,
  type PluginManifest,
  PluginRefusal,
} from "@skillcdn/console/plugin";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { asActedFor, personVisibleTo } from "../auth/policy.js";
import { type Database, drizzleOf } from "../db/client.js";
import { listCategories } from "../db/queries/categories.js";
import { writeComment } from "../db/queries/comments.js";
import {
  answerDecision,
  findDecision,
  findDecisionOnPlate,
  findDecisionReachable,
  listDecisions,
  raiseDecision,
} from "../db/queries/decisions.js";
import { getDocument, listDocuments, writeDocument } from "../db/queries/documents.js";
import type { Actor, Scope } from "../db/queries/events.js";
import {
  findPerson,
  listPeople,
  type PersonRecord,
  peopleWithReports,
} from "../db/queries/people.js";
import {
  findProjectByKey,
  isPluginItem,
  markPluginItem,
  type PluginItemKind,
} from "../db/queries/plugin-board.js";
import { type PluginInstallRecord, peopleGranted } from "../db/queries/plugins.js";
import {
  findProjectFor,
  listMembers,
  listProjectsFor,
  seesProject,
} from "../db/queries/projects.js";
import { findRun, listRuns } from "../db/queries/runs.js";
import { createTask, findTaskByNumber, listTasks, updateTask } from "../db/queries/tasks.js";
import { findTeam, listTeams, teamKeysByPerson } from "../db/queries/teams.js";
import { readWorkspaceSettings, type WorkspaceRecord } from "../db/queries/workspaces.js";
import { DomainError } from "../errors.js";
import {
  restCategory,
  restComment,
  restDecision,
  restDocument,
  restDocumentSummary,
  restMember,
  restPerson,
  restPersonWithEmail,
  restProject,
  restRun,
  restTask,
  restTeam,
} from "../http/rest-shapes.js";
import type { Clock } from "../ports/clock.js";
import type { RecordStore } from "./records.js";

// The board as a plugin reaches it (ADR-0052, docs/specs/plugins.md, "The board" and "The
// context"): `ctx.console`, decided by the capabilities consented to and by the console's own
// policy. A person's call reads what the person may see and acts as them; a call a plugin makes
// for a person, the same, as a member whatever the person administers (ADR-0072); a console
// caller, a job or a hook, and a plugin calling as itself act as the administrator who enabled the
// plugin, within the plugin's projects. What the plugin makes is marked as its, and it changes its
// own items alone.

/** How many items one read answers at most: a page of the board's own size. */
const READ_LIMIT = PLUGIN_LIST_LIMIT;

/** An id as the console keeps one: what plugin code names otherwise is refused here, before a query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A text a plugin writes on the board, as the API takes any: within the bound, with no control characters. */
const boardText = (max: number, { atLeast = 1, multiline = false } = {}) =>
  z
    .string()
    .trim()
    .min(atLeast)
    .max(max)
    .refine((text) => !hasForbiddenCodePoint(text, multiline), "holds control characters");

const decisionAskSchema = z.object({
  question: boardText(MAX_QUESTION_LENGTH),
  body: boardText(20_000, { atLeast: 0, multiline: true }).optional(),
  // Each a label, and optionally a key the plugin reads the answer by (`optionKey` on the
  // answered event), spelled as its own key is; each key once.
  options: z
    .array(
      z.object({
        label: boardText(MAX_OPTION_LABEL_LENGTH),
        key: z.string().regex(OPTION_KEY_PATTERN).optional(),
      }),
    )
    .min(MIN_OPTIONS)
    .max(MAX_OPTIONS)
    .refine((options) => {
      const keys = options.flatMap((option) => (option.key === undefined ? [] : [option.key]));
      return new Set(keys).size === keys.length;
    }, "each key once"),
  deciderId: z.uuid().optional(),
  // Several to answer (ADR-0057), any one of whom may; the first answer ends the decision.
  deciderIds: z.array(z.uuid()).min(1).max(MAX_DECIDERS).optional(),
  taskId: z.uuid().optional(),
  about: z.object({ collection: z.string().min(1).max(32), id: z.uuid() }),
});

const documentWriteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(64_000),
  baseVersion: z.number().int().positive().optional(),
});

// As the REST API takes a filter: what the database would refuse to compare is the plugin's
// invalid argument, never the database's error.
const taskFilterSchema = z.object({
  state: z.enum(TASK_STATES).optional(),
  open: z.boolean().optional(),
  category: z.string().optional(),
  goal: z.string().regex(UUID, "a goal's id").optional(),
  worker: z.string().regex(UUID, "a person's id").optional(),
  unassigned: z.boolean().optional(),
  dueBy: z.string().refine(isCalendarDay, "a day as YYYY-MM-DD").optional(),
  q: z.string().max(200).optional(),
  archived: z.boolean().optional(),
  limit: z.number().int().min(1).max(READ_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
});

/** What a call on `ctx.console` carries about the plugin and its caller. */
export interface BoardContext {
  readonly key: string;
  readonly manifest: PluginManifest;
  readonly install: PluginInstallRecord;
  readonly collections: readonly CollectionDescription[];
  readonly caller: PluginCaller;
  readonly consent: readonly string[];
}

export interface PluginBoardOptions {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly clock: Clock;
  /** Where the plugins' records live, for a decision linked to the record it is about. */
  readonly records?: RecordStore | undefined;
  /** The console's public origin, answered as `workspace().url`; none where the deployment names none. */
  readonly publicUrl?: string | undefined;
}

/** A project as the plugin reaches it: by key, within the plugin's reach. */
interface Reached {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly visibility: "workspace" | "private";
  readonly createdAt: Date;
}

const forbidden = (message: string): PluginRefusal =>
  new PluginRefusal("plugin.forbidden", message);
const invalid = (message: string): PluginRefusal =>
  new PluginRefusal("plugin.invalid_args", message);

/** Whether a caller acts as a person: a person themselves, or a plugin for one (ADR-0072); the console and a plugin as itself do not. */
function actsAsPerson(caller: PluginCaller): boolean {
  return caller.kind === "person" || actsFor(caller);
}

/** Whether a plugin calls for a person who did something elsewhere (ADR-0072), and not as itself. */
function actsFor(caller: PluginCaller): boolean {
  return caller.kind === "plugin" && caller.for !== null;
}

/** An answer a plugin gives for a person (ADR-0072): the option by its key or by its label, one of the two, and a note. */
const decisionAnswerSchema = z
  .object({
    optionKey: z.string().min(1).max(64).optional(),
    option: z.string().min(1).max(500).optional(),
    note: z.string().max(4000).optional(),
  })
  .refine(
    (answer) => (answer.optionKey !== undefined) !== (answer.option !== undefined),
    "one of optionKey and option",
  );

/** A query's refusal as the plugin gets it: the console's code and words, as an invalid argument. */
function refusalOf(error: unknown): never {
  if (error instanceof PluginRefusal) {
    throw error;
  }
  if (error instanceof DomainError) {
    throw invalid(`${error.code}: ${error.message}`);
  }
  throw error;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${what} is text`);
  }
  return value;
}

function whole(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw invalid(`${what} is a whole number`);
  }
  return value;
}

export class PluginBoard {
  private readonly options: PluginBoardOptions;

  constructor(options: PluginBoardOptions) {
    this.options = options;
  }

  /** One call on `ctx.console`, decided and performed; what it answers is the REST shape, as the contract says. */
  async call(
    context: BoardContext,
    member: string,
    method: string,
    args: readonly unknown[],
  ): Promise<unknown> {
    const workspace = await this.options.workspace();
    const needs = (capability: string): void => {
      if (!context.consent.includes(capability)) {
        throw forbidden(`the plugin has not been given the capability ${capability}`);
      }
    };
    switch (member) {
      case "console.workspace": {
        const settings = await readWorkspaceSettings(this.options.database, workspace.id);
        const categories = await listCategories(this.options.database, workspace.id);
        return {
          name: workspace.name,
          languages: [...CONSOLE_LANGUAGES],
          // UTC where nobody set one, and `timeZoneSet` says so: a plugin that reads a time of
          // day tells the administrator, instead of taking UTC for a choice.
          timeZone: settings.timeZone ?? "UTC",
          timeZoneSet: settings.timeZone !== null,
          weekStart: settings.weekStart,
          url: this.options.publicUrl ?? null,
          categories: categories.map(restCategory).map((category) => ({
            key: category.key,
            name: category.name,
            color: category.color,
          })),
        };
      }
      case "console.people": {
        needs(actsAsPerson(context.caller) ? "people:read" : "people:read:all");
        const viewer = await this.actingPerson(context, workspace);
        const settings = await readWorkspaceSettings(this.options.database, workspace.id);
        const visible = context.consent.includes("people:read:all")
          ? sql`true`
          : personVisibleTo(viewer, settings);
        const people = await listPeople(this.options.database, workspace.id, { visible });
        // The work email with `people:read:email` alone, to match a person to an account elsewhere;
        // the teams each is in (ADR-0073), by their keys (ADR-0074), with every reading.
        const teamsOf = await teamKeysByPerson(this.options.database, workspace.id);
        const shape = (person: PersonRecord) => ({
          ...(context.consent.includes("people:read:email")
            ? restPersonWithEmail(person)
            : restPerson(person)),
          teams: teamsOf.get(person.id) ?? [],
        });
        if (method === "list") {
          const options = (args[0] ?? {}) as { readonly q?: unknown };
          const words = typeof options.q === "string" ? options.q.trim().toLowerCase() : "";
          return people
            .filter(
              (person) =>
                words.length === 0 ||
                person.login.toLowerCase().includes(words) ||
                (person.name ?? "").toLowerCase().includes(words),
            )
            .slice(0, READ_LIMIT)
            .map(shape);
        }
        if (method === "get") {
          const id = text(args[0], "the person's id");
          const found = people.find((person) => person.id === id);
          return found === undefined ? null : shape(found);
        }
        if (method === "granted") {
          const role = text(args[0], "the role");
          const declared = context.manifest.roles[role];
          if (declared === undefined) {
            throw invalid(`the plugin declares no role ${role}`);
          }
          // Everyone for the default role; else those granted it, and for a role that follows the
          // reporting line (ADR-0068) whoever manages someone besides, as the role is held.
          let granted: ReadonlySet<string> | undefined;
          if (context.manifest.defaultRole !== role) {
            const given = await peopleGranted(
              this.options.database,
              workspace.id,
              context.key,
              role,
            );
            granted =
              declared.follows === "reports"
                ? new Set([
                    ...given,
                    ...(await peopleWithReports(this.options.database, workspace.id)),
                  ])
                : given;
          }
          return people
            .filter(
              (person) =>
                person.status === "active" && (granted === undefined || granted.has(person.id)),
            )
            .slice(0, READ_LIMIT)
            .map(shape);
        }
        break;
      }
      case "console.teams": {
        // The teams (ADR-0073), with the members among the people the caller may see.
        needs(actsAsPerson(context.caller) ? "people:read" : "people:read:all");
        const viewer = await this.actingPerson(context, workspace);
        const settings = await readWorkspaceSettings(this.options.database, workspace.id);
        const visible = new Set(
          (
            await listPeople(this.options.database, workspace.id, {
              visible: context.consent.includes("people:read:all")
                ? sql`true`
                : personVisibleTo(viewer, settings),
            })
          ).map((person) => person.id),
        );
        if (method === "list") {
          return (await listTeams(this.options.database, workspace.id)).map((team) =>
            restTeam(team, visible),
          );
        }
        if (method === "get") {
          const team = await findTeam(
            this.options.database,
            workspace.id,
            text(args[0], "the team's key"),
          );
          return team === undefined ? null : restTeam(team, visible);
        }
        break;
      }
      case "console.projects": {
        needs(actsAsPerson(context.caller) ? "projects:read" : "projects:read:all");
        // With `:all`, the view is the administrator's who enabled the plugin, who sees every
        // project; never in a call for a person, which reads what the person may (ADR-0072).
        const viewer =
          context.consent.includes("projects:read:all") && !actsFor(context.caller)
            ? await this.enabler(context, workspace)
            : await this.actingPerson(context, workspace);
        if (method === "list") {
          return (await listProjectsFor(this.options.database, workspace.id, viewer)).map(
            restProject,
          );
        }
        const key = text(args[0], "the project's key");
        const project = await findProjectFor(this.options.database, workspace.id, key, viewer);
        if (method === "get") {
          return project === undefined ? null : restProject(project);
        }
        if (method === "members") {
          if (project === undefined) {
            return [];
          }
          return (await listMembers(this.options.database, project)).map(restMember);
        }
        break;
      }
      case "console.tasks":
        return this.tasks(context, workspace, method, args, needs);
      case "console.decisions":
        return this.decisions(context, workspace, method, args, needs);
      case "console.documents":
        return this.documents(context, workspace, method, args, needs);
      case "console.runs": {
        needs("board:read");
        if (method === "list") {
          const project = await this.reach(context, workspace, text(args[0], "the project's key"));
          const { items } = await listRuns(
            this.options.database,
            this.scopeOf(workspace, project),
            {
              limit: READ_LIMIT,
            },
          );
          return items.map(restRun);
        }
        if (method === "get") {
          const id = text(args[0], "the run's id");
          const run = UUID.test(id)
            ? await findRun(this.options.database, workspace.id, id)
            : undefined;
          if (
            run === undefined ||
            !(await this.reaches(context, workspace, run.projectId)) ||
            !(await this.seenBy(context, workspace, run.projectId))
          ) {
            return null;
          }
          return restRun(run);
        }
        break;
      }
      default:
        break;
    }
    throw invalid(`${member}.${method} is not a call on ctx`);
  }

  private async tasks(
    context: BoardContext,
    workspace: WorkspaceRecord,
    method: string,
    args: readonly unknown[],
    needs: (capability: string) => void,
  ): Promise<unknown> {
    const project = await this.reach(context, workspace, text(args[0], "the project's key"));
    const scope = this.scopeOf(workspace, project);
    switch (method) {
      case "list": {
        needs("board:read");
        const filter = taskFilterSchema.safeParse(args[1] ?? {});
        if (!filter.success) {
          throw invalid(`the filter does not fit: ${filter.error.issues[0]?.message ?? ""}`);
        }
        const { items } = await listTasks(this.options.database, scope, {
          state: filter.data.state,
          open: filter.data.open,
          category: filter.data.category,
          goalId: filter.data.goal,
          workerId: filter.data.worker,
          unassigned: filter.data.unassigned,
          dueBy: filter.data.dueBy,
          query: filter.data.q,
          archived: filter.data.archived,
          limit: filter.data.limit ?? READ_LIMIT,
          offset: filter.data.offset,
        });
        return items.map(restTask);
      }
      case "get": {
        needs("board:read");
        const task = await findTaskByNumber(
          this.options.database,
          scope,
          whole(args[1], "the number"),
        );
        return task === undefined ? null : restTask(task);
      }
      case "create": {
        needs("board:tasks");
        const input = restTaskInputSchema.safeParse(args[1]);
        if (!input.success) {
          throw invalid(`the task does not fit: ${input.error.issues[0]?.message ?? ""}`);
        }
        const actor = await this.actorOf(context, workspace);
        try {
          const task = await createTask(this.options.database, {
            scope,
            actor,
            task: {
              ...input.data,
              links: input.data.links?.map((link) => ({
                url: link.url,
                label: link.label ?? null,
              })),
            },
            now: this.options.clock.now(),
          });
          await markPluginItem(drizzleOf(this.options.database), {
            workspaceId: workspace.id,
            key: context.key,
            kind: "task",
            id: task.id,
          });
          return { ...restTask(task), plugin: context.key } satisfies RestTask;
        } catch (error) {
          return refusalOf(error);
        }
      }
      case "update": {
        needs("board:tasks");
        const task = await this.ownTask(context, workspace, scope, whole(args[1], "the number"));
        const patch = restTaskPatchSchema.safeParse(args[2]);
        if (!patch.success) {
          throw invalid(`the patch does not fit: ${patch.error.issues[0]?.message ?? ""}`);
        }
        try {
          const updated = await updateTask(this.options.database, {
            scope,
            actor: await this.actorOf(context, workspace),
            taskId: task.id,
            patch: {
              ...patch.data,
              links: patch.data.links?.map((link) => ({
                url: link.url,
                label: link.label ?? null,
              })),
            },
            now: this.options.clock.now(),
          });
          return restTask(updated);
        } catch (error) {
          return refusalOf(error);
        }
      }
      case "comment": {
        needs("board:tasks");
        const task = await this.ownTask(context, workspace, scope, whole(args[1], "the number"));
        const said = boardText(MAX_BODY_LENGTH, { multiline: true }).safeParse(args[2]);
        if (!said.success) {
          throw invalid(`the comment does not fit: ${said.error.issues[0]?.message ?? ""}`);
        }
        try {
          const comment = await writeComment(this.options.database, {
            scope,
            actor: await this.actorOf(context, workspace),
            taskId: task.id,
            body: said.data,
            files: [],
            limit: MAX_COMMENTS_PER_TASK,
            fileLimit: MAX_FILES_PER_COMMENT,
            now: this.options.clock.now(),
          });
          return restComment(comment);
        } catch (error) {
          return refusalOf(error);
        }
      }
      default:
        throw invalid(`console.tasks.${method} is not a call on ctx`);
    }
  }

  private async decisions(
    context: BoardContext,
    workspace: WorkspaceRecord,
    method: string,
    args: readonly unknown[],
    needs: (capability: string) => void,
  ): Promise<unknown> {
    switch (method) {
      case "list": {
        needs("board:read");
        const project = await this.reach(context, workspace, text(args[0], "the project's key"));
        const { items } = await listDecisions(
          this.options.database,
          this.scopeOf(workspace, project),
          {
            limit: READ_LIMIT,
          },
        );
        return items.map(restDecision);
      }
      case "get": {
        needs("board:read");
        const id = text(args[0], "the decision's id");
        const decision = UUID.test(id)
          ? await findDecision(this.options.database, workspace.id, id)
          : undefined;
        if (
          decision === undefined ||
          !(await this.reaches(context, workspace, decision.projectId))
        ) {
          return null;
        }
        if (actsAsPerson(context.caller)) {
          // For a person, as the decision's own address answers them (ADR-0068): one of a project
          // they may see, or one that reaches them past it; nothing of a project closed to them.
          const person = await this.actingPerson(context, workspace);
          if (
            (await findDecisionReachable(this.options.database, workspace.id, id, person)) ===
            undefined
          ) {
            return null;
          }
        }
        return restDecision(decision);
      }
      case "ask": {
        needs("board:decisions");
        const project = await this.reachToAsk(
          context,
          workspace,
          text(args[0], "the project's key"),
        );
        const ask = decisionAskSchema.safeParse(args[1]);
        if (!ask.success) {
          throw invalid(`the decision does not fit: ${ask.error.issues[0]?.message ?? ""}`);
        }
        const collection = context.collections.find(
          (candidate) => candidate.name === ask.data.about.collection,
        );
        if (collection === undefined) {
          throw invalid(`about: the plugin has no collection ${ask.data.about.collection}`);
        }
        const records = this.options.records;
        if (records === undefined) {
          throw new PluginRefusal(
            "plugin.unavailable",
            "this console keeps no records for plugins",
          );
        }
        const scope = this.scopeOf(workspace, project);
        try {
          const decision = await raiseDecision(this.options.database, {
            scope,
            actor: await this.actorOf(context, workspace),
            decision: {
              question: ask.data.question,
              body: ask.data.body,
              options: ask.data.options,
              taskId: ask.data.taskId,
              deciderId: ask.data.deciderId,
              deciderIds: ask.data.deciderIds,
            },
            now: this.options.clock.now(),
          });
          await markPluginItem(drizzleOf(this.options.database), {
            workspaceId: workspace.id,
            key: context.key,
            kind: "decision",
            id: decision.id,
          });
          // The record the decision is about, linked, so that the answer finds its way back.
          await records.link(
            { workspaceId: workspace.id, plugin: context.key, collection },
            ask.data.about.id,
            { kind: "decision", id: decision.id },
          );
          return { ...restDecision(decision), plugin: context.key };
        } catch (error) {
          return refusalOf(error);
        }
      }
      case "answer": {
        // For a person who answered elsewhere (ADR-0072): a decision on their own plate alone,
        // addressed to them or reaching them up the reporting line (ADR-0068), a person's own
        // while they are in its project (ADR-0077), whatever else they administer or are a member
        // of, so that a plugin's mistake about who pressed a button answers nothing that was never
        // theirs; the answer is theirs, through this plugin. A plugin answers nothing itself.
        needs("people:act");
        const id = text(args[0], "the decision's id");
        if (!UUID.test(id)) {
          throw invalid("the decision's id is not one");
        }
        const given = decisionAnswerSchema.safeParse(args[1]);
        if (!given.success) {
          throw invalid(`the answer does not fit: ${given.error.issues[0]?.message ?? ""}`);
        }
        const asked = args[2];
        const forWhom =
          typeof asked === "object" &&
          asked !== null &&
          typeof (asked as { readonly for?: unknown }).for === "string"
            ? (asked as { readonly for: string }).for
            : undefined;
        if (forWhom === undefined) {
          throw invalid(
            "answer names whom it is for, { for: <person id> }; a plugin answers no decision itself",
          );
        }
        const person = UUID.test(forWhom)
          ? await findPerson(this.options.database, workspace.id, forWhom)
          : undefined;
        if (person === undefined || person.status !== "active") {
          throw new PluginRefusal(
            "plugin.not_found",
            "the person to answer for is not an active person of the workspace",
          );
        }
        const decision = await findDecisionOnPlate(
          this.options.database,
          workspace.id,
          id,
          person.id,
        );
        if (decision === undefined) {
          throw forbidden(
            "the person may not answer this decision: it is not on their plate, addressed neither to them nor, being a plugin's, to anyone they manage, or a person's own in a project they are not in",
          );
        }
        const chosen = decision.options.find((option) =>
          given.data.optionKey !== undefined
            ? option.key === given.data.optionKey
            : option.label === given.data.option,
        );
        if (chosen === undefined) {
          throw invalid("the option is not one of the decision's");
        }
        // The plugin that acted for the person: the one that called this one for them, where one
        // did; else this one, which names them itself.
        const via =
          context.caller.kind === "plugin" && context.caller.for?.id === person.id
            ? context.caller.plugin
            : context.key;
        try {
          const answered = await answerDecision(this.options.database, {
            scope: { workspaceId: workspace.id, projectId: decision.projectId },
            actor: { id: person.id, plugin: context.key, via },
            decisionId: id,
            option: chosen.id,
            own: undefined,
            note: given.data.note,
            now: this.options.clock.now(),
          });
          return restDecision(answered);
        } catch (error) {
          return refusalOf(error);
        }
      }
      default:
        throw invalid(`console.decisions.${method} is not a call on ctx`);
    }
  }

  private async documents(
    context: BoardContext,
    workspace: WorkspaceRecord,
    method: string,
    args: readonly unknown[],
    needs: (capability: string) => void,
  ): Promise<unknown> {
    const project = await this.reach(context, workspace, text(args[0], "the project's key"));
    const scope = { workspaceId: workspace.id, projectId: project.id };
    switch (method) {
      case "list": {
        needs("board:read");
        const folder = typeof args[1] === "string" ? args[1].replace(/\/+$/, "") : "";
        const { items } = await listDocuments(this.options.database, scope, {
          folder,
          limit: READ_LIMIT,
        });
        return items.map(restDocumentSummary);
      }
      case "read": {
        needs("board:read");
        const path = text(args[1], "the path");
        if (!isDocumentPath(path)) {
          throw invalid("the path is not a document's");
        }
        const document = await getDocument(this.options.database, scope, path);
        return document === undefined ? null : restDocument(document);
      }
      case "write": {
        needs("board:documents");
        const path = text(args[1], "the path");
        const folder = `plugins/${context.key}/`;
        if (!isDocumentPath(path) || !path.startsWith(folder)) {
          throw forbidden(`the plugin writes its pages under ${folder}`);
        }
        const input = documentWriteSchema.safeParse(args[2]);
        if (!input.success) {
          throw invalid(`the page does not fit: ${input.error.issues[0]?.message ?? ""}`);
        }
        try {
          const written = await writeDocument(this.options.database, {
            scope,
            actor: await this.actorOf(context, workspace),
            path,
            title: input.data.title,
            body: input.data.body,
            baseVersion: input.data.baseVersion,
            maxVersions: MAX_VERSIONS_PER_DOCUMENT,
            maxDocuments: MAX_DOCUMENTS_PER_PROJECT,
            now: this.options.clock.now(),
          });
          if (written.created) {
            await markPluginItem(drizzleOf(this.options.database), {
              workspaceId: workspace.id,
              key: context.key,
              kind: "document",
              id: written.document.id,
            });
          }
          return { ...restDocument(written.document), plugin: context.key };
        } catch (error) {
          return refusalOf(error);
        }
      }
      default:
        throw invalid(`console.documents.${method} is not a call on ctx`);
    }
  }

  /** A task of the plugin's own in the project, or the refusal: what it may change and comment on. */
  private async ownTask(
    context: BoardContext,
    workspace: WorkspaceRecord,
    scope: Scope,
    number: number,
  ) {
    const task = await findTaskByNumber(this.options.database, scope, number);
    if (task === undefined) {
      throw new PluginRefusal("plugin.not_found", `the project has no task #${number}`);
    }
    if (!(await this.isOwn(workspace, context.key, "task", task.id))) {
      throw forbidden(`the task #${number} is not the plugin's own`);
    }
    return task;
  }

  private isOwn(
    workspace: WorkspaceRecord,
    key: string,
    kind: PluginItemKind,
    id: string,
  ): Promise<boolean> {
    return isPluginItem(this.options.database, workspace.id, key, kind, id);
  }

  private scopeOf(workspace: WorkspaceRecord, project: Reached): Scope {
    return { workspaceId: workspace.id, projectId: project.id };
  }

  /** Whether the plugin reaches a project (ADR-0080): its board project, or one it is placed on; a call takes it nowhere else. */
  private withinReach(context: BoardContext, project: Reached): boolean {
    const { install } = context;
    return (
      install.boardProjectId === project.id ||
      install.projects === "all" ||
      install.projects.includes(project.key)
    );
  }

  /**
   * Whether a call may be shown an item of `projectId` it names by its id: for a person, one of
   * a project they may see, as a listing shows them, so that a plugin's page hands a person
   * nothing of a project closed to them (ADR-0072); the console and a plugin as itself are shown
   * what the plugin reaches.
   */
  private async seenBy(
    context: BoardContext,
    workspace: WorkspaceRecord,
    projectId: string,
  ): Promise<boolean> {
    if (!actsAsPerson(context.caller)) {
      return true;
    }
    const person = await this.actingPerson(context, workspace);
    return seesProject(this.options.database, workspace.id, projectId, person);
  }

  private async reaches(
    context: BoardContext,
    workspace: WorkspaceRecord,
    projectId: string,
  ): Promise<boolean> {
    const { install } = context;
    if (install.boardProjectId === projectId || install.projects === "all") {
      return true;
    }
    if (install.projects.length === 0) {
      return false;
    }
    for (const key of install.projects) {
      const project = await findProjectByKey(this.options.database, workspace.id, key);
      if (project?.id === projectId) {
        return true;
      }
    }
    return false;
  }

  /**
   * The project a call names, as the plugin reaches it (ADR-0080): its board project or one it is
   * placed on, and for a person one of them they may see; a call takes the plugin nowhere else.
   */
  private async reach(
    context: BoardContext,
    workspace: WorkspaceRecord,
    key: string,
  ): Promise<Reached> {
    let project: Reached | undefined;
    if (actsAsPerson(context.caller)) {
      const person = await this.actingPerson(context, workspace);
      project = await findProjectFor(this.options.database, workspace.id, key, person);
    } else {
      project = await findProjectByKey(this.options.database, workspace.id, key);
    }
    if (project === undefined) {
      throw new PluginRefusal("plugin.not_found", `no project ${key} the call may see`);
    }
    if (!this.withinReach(context, project)) {
      throw forbidden(`the plugin is not on the project ${key}`);
    }
    return project;
  }

  /**
   * The project a decision is asked in: the one `reach` finds; or the plugin's board project for
   * a person who may not see it, who is a requester there (ADR-0080): the one thing they do in it
   * is raise a decision through the plugin, which reaches them as its raiser (ADR-0068), and
   * nothing else of the project opens to them.
   */
  private async reachToAsk(
    context: BoardContext,
    workspace: WorkspaceRecord,
    key: string,
  ): Promise<Reached> {
    const { install, caller } = context;
    if (actsAsPerson(caller) && install.boardProjectId !== undefined) {
      const board = await findProjectByKey(this.options.database, workspace.id, key);
      if (board !== undefined && board.id === install.boardProjectId) {
        // Still a person of the workspace to raise it as, as `reach` asks of anyone.
        await this.actingPerson(context, workspace);
        return board;
      }
    }
    return this.reach(context, workspace, key);
  }

  /**
   * The person a call acts as: the caller themselves; the person a plugin acts for, as a member
   * whatever they administer, since acting for a person never carries their administration
   * (ADR-0072); or, for the console and a plugin calling as itself, the administrator who enabled
   * the plugin.
   */
  private async actingPerson(
    context: BoardContext,
    workspace: WorkspaceRecord,
  ): Promise<PersonRecord> {
    const { caller } = context;
    if (caller.kind === "person") {
      const person = await findPerson(this.options.database, workspace.id, caller.person.id);
      if (person === undefined) {
        throw forbidden("the caller is no longer a person of the workspace");
      }
      return person;
    }
    if (caller.kind === "plugin" && caller.for !== null) {
      const person = await findPerson(this.options.database, workspace.id, caller.for.id);
      if (person === undefined || person.status !== "active") {
        throw forbidden("the caller is no longer a person of the workspace");
      }
      return asActedFor(person);
    }
    return this.enabler(context, workspace);
  }

  /**
   * The administrator who enabled the plugin: who owns what the console's own calls make on the
   * board, and whose view of every project `projects:read:all` opens; never whom a call is for.
   */
  private async enabler(context: BoardContext, workspace: WorkspaceRecord): Promise<PersonRecord> {
    const id = context.install.enabledBy;
    const person =
      id === undefined ? undefined : await findPerson(this.options.database, workspace.id, id);
    if (person === undefined) {
      throw forbidden("the plugin was not enabled by a person it could act as on the board");
    }
    return person;
  }

  /** Who a change is attributed to: the person, with the agent they act through, and always the plugin. */
  private async actorOf(context: BoardContext, workspace: WorkspaceRecord): Promise<Actor> {
    const person = await this.actingPerson(context, workspace);
    const agent =
      context.caller.kind === "person" ? (context.caller.agent ?? undefined) : undefined;
    // A plugin that acts for a person is named beside them (ADR-0072), as an agent is; one that
    // calls as itself acts for nobody, and its act is the console's own, through no one.
    const via =
      context.caller.kind === "plugin" && context.caller.for !== null
        ? context.caller.plugin
        : undefined;
    return {
      id: person.id,
      ...(agent === undefined ? {} : { agent }),
      plugin: context.key,
      ...(via === undefined ? {} : { via }),
    };
  }
}
