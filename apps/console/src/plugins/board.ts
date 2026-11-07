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
  MAX_TITLE_LENGTH,
  MAX_VERSIONS_PER_DOCUMENT,
  MIN_OPTIONS,
  OPTION_KEY_PATTERN,
  type RestDecisionTranslations,
  type RestTask,
  restTaskInputSchema,
  restTaskPatchSchema,
  storedText,
  type Translations,
} from "@skillcdn/console/api";
import {
  type CollectionDescription,
  PLUGIN_LIST_LIMIT,
  type PluginCaller,
  type PluginManifest,
  PluginRefusal,
} from "@skillcdn/console/plugin";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { personVisibleTo } from "../auth/policy.js";
import { type Database, drizzleOf } from "../db/client.js";
import { listCategories } from "../db/queries/categories.js";
import { writeComment } from "../db/queries/comments.js";
import { findDecision, listDecisions, raiseDecision } from "../db/queries/decisions.js";
import { getDocument, listDocuments, writeDocument } from "../db/queries/documents.js";
import type { Actor, Scope } from "../db/queries/events.js";
import { findPerson, listPeople, type PersonRecord } from "../db/queries/people.js";
import {
  findProjectByKey,
  isPluginItem,
  markPluginItem,
  type PluginItemKind,
} from "../db/queries/plugin-board.js";
import { type PluginInstallRecord, peopleGranted } from "../db/queries/plugins.js";
import { findProjectFor, listMembers, listProjectsFor } from "../db/queries/projects.js";
import { findRun, listRuns } from "../db/queries/runs.js";
import { createTask, findTaskByNumber, listTasks, updateTask } from "../db/queries/tasks.js";
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
  restProject,
  restRun,
  restTask,
} from "../http/rest-shapes.js";
import type { Clock } from "../ports/clock.js";
import type { RecordStore } from "./records.js";

// The board as a plugin reaches it (ADR-0052, docs/specs/plugins.md, "The board" and "The
// context"): `ctx.console`, decided by the capabilities consented to and by the console's own
// policy. A person's call reads what the person may see and acts as them; a console caller, a job
// or a hook, acts as the administrator who enabled the plugin, within the plugin's projects. What
// the plugin makes is marked as its, and it changes its own items alone.

/** The languages the pages speak (ADR-0012): the packs the package ships. */

/** How many items one read answers at most: a page of the board's own size. */
const READ_LIMIT = PLUGIN_LIST_LIMIT;

/** A language tag as the manifest's language maps are keyed. */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
/** How many languages one text comes in at most. */
const MAX_TEXT_LANGUAGES = 10;

/** One text as the API takes any: within the bound, with no control characters. */
const textSchema = (max: number, atLeast: number, multiline: boolean) =>
  z
    .string()
    .trim()
    .min(atLeast)
    .max(max)
    .refine((text) => !hasForbiddenCodePoint(text, multiline), "holds control characters");

/**
 * A text per language (ADR-0058): keyed by tag, each within the bound, at least one of the
 * console's languages among them, so that every reader finds a text.
 */
const textsSchema = (max: number, atLeast: number, multiline: boolean) =>
  z
    .record(z.string().regex(LANGUAGE_TAG), textSchema(max, atLeast, multiline))
    .refine(
      (texts) =>
        Object.keys(texts).length <= MAX_TEXT_LANGUAGES &&
        CONSOLE_LANGUAGES.some((language) => typeof texts[language] === "string"),
      `names none of the console's languages (${CONSOLE_LANGUAGES.join(", ")}), or too many`,
    );

/** A text a plugin writes on the board: one string, or one per language (ADR-0058). */
const boardText = (max: number, { atLeast = 1, multiline = false } = {}) =>
  z.union([textSchema(max, atLeast, multiline), textsSchema(max, atLeast, multiline)]);

/** The text the board keeps beside a map: English where the map has it, else the first of the console's languages it has. */
const plainOf = (text: string | Translations): string =>
  typeof text === "string" ? text : storedText(text, CONSOLE_LANGUAGES);

/** The map, where the text was one; nothing for a plain string. */
const mapOf = (text: string | Translations | undefined): Translations | undefined =>
  typeof text === "object" ? text : undefined;

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

/** A task as a plugin writes one: as the API takes it, the title and the body in one language or several (ADR-0058). */
const pluginTaskTextsSchema = z.object({
  title: boardText(MAX_TITLE_LENGTH),
  body: boardText(MAX_BODY_LENGTH, { atLeast: 0, multiline: true }).optional(),
});

const documentWriteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(64_000),
  baseVersion: z.number().int().positive().optional(),
});

const taskFilterSchema = z.object({
  state: z.string().optional(),
  open: z.boolean().optional(),
  category: z.string().optional(),
  goal: z.string().optional(),
  worker: z.string().optional(),
  unassigned: z.boolean().optional(),
  dueBy: z.string().optional(),
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
}

/** A project as the plugin reaches it: by key, within the plugin's reach. */
interface Reached {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly visibility: "workspace" | "private";
  readonly createdAt: Date;
}

/**
 * What a decision keeps of the texts per language it was asked with (ADR-0058): the question's,
 * the body's and each option's map, the options by the id the board gives them, 1 to n in order;
 * nothing where every text was plain.
 */
function decisionTranslationsOf(ask: {
  readonly question: string | Translations;
  readonly body?: string | Translations | undefined;
  readonly options: readonly { readonly label: string | Translations }[];
}): RestDecisionTranslations | undefined {
  const question = mapOf(ask.question);
  const body = mapOf(ask.body);
  const options: Record<string, Translations> = {};
  ask.options.forEach((option, index) => {
    const label = mapOf(option.label);
    if (label !== undefined) {
      options[String(index + 1)] = label;
    }
  });
  if (question === undefined && body === undefined && Object.keys(options).length === 0) {
    return undefined;
  }
  return {
    ...(question === undefined ? {} : { question }),
    ...(body === undefined ? {} : { body }),
    ...(Object.keys(options).length === 0 ? {} : { options }),
  };
}

const forbidden = (message: string): PluginRefusal =>
  new PluginRefusal("plugin.forbidden", message);
const invalid = (message: string): PluginRefusal =>
  new PluginRefusal("plugin.invalid_args", message);

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
          timeZone: settings.timeZone ?? "UTC",
          weekStart: settings.weekStart,
          categories: categories.map(restCategory).map((category) => ({
            key: category.key,
            name: category.name,
            color: category.color,
          })),
        };
      }
      case "console.people": {
        needs(context.caller.kind === "console" ? "people:read:all" : "people:read");
        const viewer = await this.actingPerson(context, workspace);
        const settings = await readWorkspaceSettings(this.options.database, workspace.id);
        const visible = context.consent.includes("people:read:all")
          ? sql`true`
          : personVisibleTo(viewer, settings);
        const people = await listPeople(this.options.database, workspace.id, { visible });
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
            .map(restPerson);
        }
        if (method === "get") {
          const id = text(args[0], "the person's id");
          const found = people.find((person) => person.id === id);
          return found === undefined ? null : restPerson(found);
        }
        if (method === "granted") {
          const role = text(args[0], "the role");
          if (context.manifest.roles[role] === undefined) {
            throw invalid(`the plugin declares no role ${role}`);
          }
          const granted =
            context.manifest.defaultRole === role
              ? undefined
              : await peopleGranted(this.options.database, workspace.id, context.key, role);
          return people
            .filter(
              (person) =>
                person.status === "active" && (granted === undefined || granted.has(person.id)),
            )
            .slice(0, READ_LIMIT)
            .map(restPerson);
        }
        break;
      }
      case "console.projects": {
        needs(context.caller.kind === "console" ? "projects:read:all" : "projects:read");
        // With `:all`, the view is the administrator's who enabled the plugin, who sees every project.
        const viewer = context.consent.includes("projects:read:all")
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
          const run = await findRun(
            this.options.database,
            workspace.id,
            text(args[0], "the run's id"),
          );
          if (run === undefined || !(await this.reaches(context, workspace, run.projectId))) {
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
          state: filter.data.state as never,
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
        return items.map((task) => restTask(task, this.languageOf(context)));
      }
      case "get": {
        needs("board:read");
        const task = await findTaskByNumber(
          this.options.database,
          scope,
          whole(args[1], "the number"),
        );
        return task === undefined ? null : restTask(task, this.languageOf(context));
      }
      case "create": {
        needs("board:tasks");
        // The title and the body may come per language (ADR-0058): the board keeps one text of
        // each as the task's own and the map beside it.
        const given =
          typeof args[1] === "object" && args[1] !== null && !Array.isArray(args[1])
            ? (args[1] as Record<string, unknown>)
            : {};
        const texts = pluginTaskTextsSchema.safeParse({ title: given.title, body: given.body });
        if (!texts.success) {
          throw invalid(`the task does not fit: ${texts.error.issues[0]?.message ?? ""}`);
        }
        const input = restTaskInputSchema.safeParse({
          ...given,
          title: plainOf(texts.data.title),
          ...(texts.data.body === undefined
            ? { body: undefined }
            : { body: plainOf(texts.data.body) }),
        });
        if (!input.success) {
          throw invalid(`the task does not fit: ${input.error.issues[0]?.message ?? ""}`);
        }
        const titleMap = mapOf(texts.data.title);
        const bodyMap = mapOf(texts.data.body);
        const translations =
          titleMap === undefined && bodyMap === undefined
            ? undefined
            : {
                ...(titleMap === undefined ? {} : { title: titleMap }),
                ...(bodyMap === undefined ? {} : { body: bodyMap }),
              };
        const actor = await this.actorOf(context, workspace);
        try {
          const task = await createTask(this.options.database, {
            scope,
            actor,
            task: {
              ...input.data,
              translations,
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
          return {
            ...restTask(task, this.languageOf(context)),
            plugin: context.key,
          } satisfies RestTask;
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
            reader: this.languageOf(context),
            patch: {
              ...patch.data,
              links: patch.data.links?.map((link) => ({
                url: link.url,
                label: link.label ?? null,
              })),
            },
            now: this.options.clock.now(),
          });
          return restTask(updated, this.languageOf(context));
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
        const bodyMap = mapOf(said.data);
        try {
          const comment = await writeComment(this.options.database, {
            scope,
            actor: await this.actorOf(context, workspace),
            taskId: task.id,
            body: plainOf(said.data),
            translations: bodyMap === undefined ? undefined : { body: bodyMap },
            files: [],
            limit: MAX_COMMENTS_PER_TASK,
            fileLimit: MAX_FILES_PER_COMMENT,
            now: this.options.clock.now(),
          });
          return restComment(comment, this.languageOf(context));
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
        return items.map((decision) => restDecision(decision, this.languageOf(context)));
      }
      case "get": {
        needs("board:read");
        const decision = await findDecision(
          this.options.database,
          workspace.id,
          text(args[0], "the decision's id"),
        );
        if (
          decision === undefined ||
          !(await this.reaches(context, workspace, decision.projectId))
        ) {
          return null;
        }
        return restDecision(decision, this.languageOf(context));
      }
      case "ask": {
        needs("board:decisions");
        const project = await this.reach(context, workspace, text(args[0], "the project's key"));
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
              question: plainOf(ask.data.question),
              body: ask.data.body === undefined ? undefined : plainOf(ask.data.body),
              options: ask.data.options.map((option) => ({
                label: plainOf(option.label),
                ...(option.key === undefined ? {} : { key: option.key }),
              })),
              translations: decisionTranslationsOf(ask.data),
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
          return { ...restDecision(decision, this.languageOf(context)), plugin: context.key };
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

  /** Whether the plugin reaches a project: its board project, one it is on, or the project a person's call is on. */
  private withinReach(context: BoardContext, project: Reached): boolean {
    const { install, caller } = context;
    return (
      install.boardProjectId === project.id ||
      install.projects === "all" ||
      install.projects.includes(project.key) ||
      (caller.kind === "person" && caller.project?.id === project.id)
    );
  }

  private async reaches(
    context: BoardContext,
    workspace: WorkspaceRecord,
    projectId: string,
  ): Promise<boolean> {
    const { install, caller } = context;
    if (install.boardProjectId === projectId || install.projects === "all") {
      return true;
    }
    if (caller.kind === "person" && caller.project?.id === projectId) {
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
   * The project a call names, as the plugin reaches it: for a person, one they may see, among the
   * plugin's or the one the call is on; for the console, one of the plugin's.
   */
  private async reach(
    context: BoardContext,
    workspace: WorkspaceRecord,
    key: string,
  ): Promise<Reached> {
    let project: Reached | undefined;
    if (context.caller.kind === "person") {
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

  /** The language a call's reader reads in (ADR-0058): the person's own; English for the console itself. */
  private languageOf(context: BoardContext): string {
    return context.caller.kind === "person" ? context.caller.person.language : "en";
  }

  /** The person a call acts as: the caller, or, for the console, the administrator who enabled the plugin. */
  private async actingPerson(
    context: BoardContext,
    workspace: WorkspaceRecord,
  ): Promise<PersonRecord> {
    if (context.caller.kind === "person") {
      const person = await findPerson(
        this.options.database,
        workspace.id,
        context.caller.person.id,
      );
      if (person === undefined) {
        throw forbidden("the caller is no longer a person of the workspace");
      }
      return person;
    }
    return this.enabler(context, workspace);
  }

  /** The administrator who enabled the plugin: who owns what the console's own calls make on the board. */
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
    return { id: person.id, ...(agent === undefined ? {} : { agent }), plugin: context.key };
  }
}
