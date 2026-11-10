import {
  isFolderPath,
  isHandle,
  isSignInFailure,
  RESERVED_HANDLES,
  SIGN_IN_PARAM,
  type SignInFailure,
} from "./api.js";
import { isDay, isMonth } from "./dates.js";

// The addresses of the default console (ADR-0010): the router is a function from a URL to a
// route, and the hrefs below are its inverse. A project's pages live under `/projects/<key>`,
// the word the REST API uses; an address names what it shows (a task by its number, a decision
// by its id, a document by its path, a goal by its id), every form has one, and the query says
// how a page is shown (`?edit`, `?ask`, `?new`, `?version=`, `?q=`, `?month=`, `?week=`, `?page=`, and the
// board's filters). The old addresses are taken to the new.

/** How a task's page is shown: as it is, or with one of its forms open. */
export type TaskFormKind = "edit" | "ask";

/** How the documents are shown at a path: a folder or a page, a form, a version, or a search. */
export type DocsView =
  | { readonly kind: "read"; readonly version?: number | undefined }
  | { readonly kind: "new" }
  | { readonly kind: "edit" }
  | { readonly kind: "search"; readonly q: string };

/**
 * What the board is narrowed to (ADR-0019), from the query: a category by its key (`""` for
 * the tasks with none), a goal by its id (`""` for the tasks with none), a person by their id,
 * the person's own, or words (`q`), as they are typed, each of which a task's title, number,
 * owner, worker or category must contain.
 */
export interface BoardFilter {
  readonly category?: string | undefined;
  readonly goal?: string | undefined;
  readonly person?: string | undefined;
  readonly mine?: boolean | undefined;
  readonly words?: string | undefined;
}

/** As much of the words as the address keeps: enough for any search, bounded as every input is. */
const BOARD_WORDS_LENGTH = 200;

export type Route =
  | { readonly name: "projects" }
  | { readonly name: "new-project" }
  | { readonly name: "board"; readonly project: string; readonly filter: BoardFilter }
  | { readonly name: "new-task"; readonly project: string }
  | {
      readonly name: "task";
      readonly project: string;
      /** The task's number, or nothing when the address names it by id. */
      readonly number: number | undefined;
      readonly id: string | undefined;
      readonly form: TaskFormKind | undefined;
    }
  | {
      readonly name: "docs";
      readonly project: string;
      readonly path: string;
      readonly view: DocsView;
    }
  /** The decisions of a project: the waiting ones, and the record on one of its pages, the first when the address names none. */
  | { readonly name: "decisions"; readonly project: string; readonly page: number | undefined }
  | { readonly name: "new-decision"; readonly project: string }
  | { readonly name: "decision"; readonly project: string; readonly id: string }
  /** The calendar of a project: the month shown, or this one when the address names none, narrowed as the board is. */
  | {
      readonly name: "calendar";
      readonly project: string;
      readonly month: string | undefined;
      readonly filter: BoardFilter;
    }
  /** The roadmap of a project: the months shown from the one named, or from this one. */
  | { readonly name: "roadmap"; readonly project: string; readonly from: string | undefined }
  | { readonly name: "new-goal"; readonly project: string }
  /** One goal: its tasks as a board, a list or a calendar (on a month, or this one), or its form. */
  | {
      readonly name: "goal";
      readonly project: string;
      readonly id: string;
      readonly form: "edit" | undefined;
      readonly view: GoalTaskView;
      readonly month: string | undefined;
    }
  | { readonly name: "feed"; readonly project: string }
  /** The archive of a project's board (ADR-0029): the tasks put away, read a page at a time. */
  | { readonly name: "archive"; readonly project: string }
  | { readonly name: "skills"; readonly project: string }
  | { readonly name: "members"; readonly project: string }
  /** A project's settings, read; or one of its forms open: the project's own, or its rules (ADR-0023). */
  | {
      readonly name: "settings";
      readonly project: string;
      readonly form: "edit" | "rules" | "pack-token" | undefined;
    }
  /** The workspace's settings: its own, its rules, its categories, its skills; or the form the rules, or the settings (ADR-0035), are written on. */
  | {
      readonly name: "workspace-settings";
      readonly form: "rules" | "workspace" | "services" | "pack-token" | undefined;
    }
  /** The browsers whoever is signed in is signed in on (board #309): the settings' view of their own. */
  | { readonly name: "sessions" }
  | { readonly name: "people" }
  /** The form where an administrator lets someone in by login (ADR-0022). */
  | { readonly name: "new-listing" }
  /** The teams of the workspace (ADR-0073), a view of the people's page. */
  | { readonly name: "teams" }
  /** The form where an administrator makes a team. */
  | { readonly name: "new-team" }
  /** The agents of one person, for an administrator. */
  | { readonly name: "person-agents"; readonly id: string }
  /** Another person's plate, for whoever oversees them: a day of the week shown at the top, or today's. */
  | { readonly name: "person-work"; readonly id: string; readonly week: string | undefined }
  | { readonly name: "agents" }
  | { readonly name: "new-token" }
  /** The form where an administrator adds an agent account (ADR-0084). */
  | { readonly name: "new-agent" }
  /**
   * One agent account's page (ADR-0085, ADR-0086): what it is doing now, its sessions or one of
   * them, its plate with a day of the week shown at the top, and what is kept of it.
   */
  | {
      readonly name: "agent";
      readonly handle: string;
      readonly tab: AgentTab;
      readonly session: string | undefined;
      readonly week: string | undefined;
    }
  /** What is on the person's plate across their projects. */
  /** What is on the person's plate: a day of the week shown at the top, or today's when the address names none. */
  | { readonly name: "work"; readonly week: string | undefined }
  /** The decisions addressed to the person (ADR-0042), across the projects they may see. */
  | { readonly name: "my-decisions" }
  /** One decision wherever it is (ADR-0068), for whoever it reaches: in a project they may see or not. */
  | { readonly name: "my-decision"; readonly id: string }
  /** The categories tasks are sorted into; an administrator keeps them here. */
  | { readonly name: "categories" }
  /** Where a person approves an agent's connection, by the code it showed, or types one. */
  | { readonly name: "connect"; readonly code: string | undefined }
  /** An address that moved: the page takes the person to `to` in its place. */
  | { readonly name: "moved"; readonly to: string }
  /** A page a console adds of its own (`createConsole({ pages })`): on the workspace, or on a project. */
  | { readonly name: "custom"; readonly level: "workspace"; readonly page: string }
  | {
      readonly name: "custom";
      readonly level: "project";
      readonly project: string;
      readonly page: string;
    }
  /** A plugin's page (docs/specs/plugins.md, "Tabs, sub-tabs and addresses"): the first when the address names none; `rest` is what follows the page, handed to the frame. */
  | {
      readonly name: "plugin";
      readonly level: "workspace";
      readonly plugin: string;
      readonly page: string | undefined;
      readonly rest: string;
    }
  | {
      readonly name: "plugin";
      readonly level: "project";
      readonly project: string;
      readonly plugin: string;
      readonly page: string | undefined;
      readonly rest: string;
    }
  /** The plugins' settings, for an administrator: the list, or one plugin by its key. */
  | { readonly name: "plugins-settings"; readonly plugin: string | undefined }
  | { readonly name: "not-found" };

/** The pages of a project, after its key. */
export type ProjectPage =
  | "docs"
  | "decisions"
  | "archive"
  | "calendar"
  | "roadmap"
  | "feed"
  | "skills"
  | "members"
  | "settings";

export const PATHS = {
  /** The projects the person may see: the front page. */
  projects: "/",
  /** Where a project's pages are: `/projects/<key>`, then the page. */
  project: "/projects",
  newProject: "/projects/new",
  /** What is on the person's plate, across the projects they may see. */
  work: "/work",
  /** The decisions addressed to the person (ADR-0042), across the projects they may see. */
  decisions: "/decisions",
  people: "/people",
  /** The form where an administrator lets someone in by login. */
  newListing: "/people/new",
  /** The teams of the workspace, a view of the people's page. */
  teams: "/people/teams",
  /** The form where an administrator makes a team. */
  newTeam: "/people/teams/new",
  /** The agents of whoever is signed in, which hold their tokens: their own page. */
  agents: "/agents",
  /** The form for a token made by hand, for a script or a console of one's own. */
  newToken: "/agents/new",
  /** The form where an administrator adds an agent account (ADR-0084): under `new`, which no account's handle may be. */
  newAgent: "/agents/new/account",
  /** The categories tasks are sorted into, kept by an administrator; reached from the settings. */
  categories: "/categories",
  /** The workspace's settings: the rules, the categories, the skills (ADR-0023). */
  settings: "/settings",
  /** The browsers whoever is signed in is signed in on: the settings' view of their own (board #309). */
  sessions: "/settings/sessions",
  /** Where the pages a console adds of its own are: `/pages/<key>`, and `/projects/<key>/pages/<page>` on a project. */
  pages: "/pages",
  /** Where the plugins' pages are: `/plugins/<key>[/<page>[/<rest>]]`, and `/projects/<key>/plugins/<key>...` on a project (ADR-0054). */
  plugins: "/plugins",
  /** The plugins' settings, for an administrator: the list, and `/settings/plugins/<key>` for one. */
  pluginSettings: "/settings/plugins",
  /** Where an agent's connection is approved (ADR-0011): `/connect/<code>`, or the code typed. */
  connect: "/connect",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A plugin's key, and a page's: as the manifest spells them. */
const PLUGIN_KEY = /^[a-z][a-z0-9-]{1,31}$/;

/** A plugin's address after its key: the page, if any, and what follows it for the frame. */
function pluginRouteOf(
  segments: readonly string[],
):
  | { readonly plugin: string; readonly page: string | undefined; readonly rest: string }
  | undefined {
  const [plugin, page, ...rest] = segments;
  if (plugin === undefined || !PLUGIN_KEY.test(plugin)) {
    return undefined;
  }
  if (page !== undefined && !PLUGIN_KEY.test(page)) {
    return undefined;
  }
  return { plugin, page, rest: rest.length === 0 ? "" : `/${rest.join("/")}` };
}
const NUMBER = /^[1-9][0-9]{0,8}$/;
/** A code as it may be typed into an address: checked for what it is by the page. */
const CODE_TEXT = /^[A-Za-z0-9-]{1,16}$/;
/** The pages of a project that take nothing after their name. */
const PLAIN_PAGES: readonly Exclude<
  ProjectPage,
  "docs" | "decisions" | "calendar" | "roadmap" | "settings"
>[] = ["archive", "feed", "skills", "members"];
const NOT_FOUND: Route = { name: "not-found" };

/** Where an address of the 0.1 line before this one leads now, or nothing for a current one. */
export function movedFrom(pathname: string): string | undefined {
  if (pathname === "/tokens") {
    return PATHS.agents;
  }
  if (pathname === "/p" || pathname.startsWith("/p/")) {
    return `${PATHS.project}${pathname.slice(2)}`;
  }
  if (pathname === PATHS.project) {
    return PATHS.projects;
  }
  return undefined;
}

const taskFormOf = (params: URLSearchParams): TaskFormKind | undefined =>
  params.has("edit") ? "edit" : params.has("ask") ? "ask" : undefined;

/** The board's filters, as the query names them; a value that is not one is left out. */
const boardFilterOf = (params: URLSearchParams): BoardFilter => {
  const category = params.get("category");
  const goal = params.get("goal");
  const person = params.get("person");
  const q = params.get("q");
  return {
    ...(category !== null && (category === "" || PROJECT_KEY.test(category)) ? { category } : {}),
    ...(goal !== null && (goal === "" || UUID.test(goal)) ? { goal } : {}),
    ...(person !== null && UUID.test(person) ? { person } : {}),
    ...(params.has("mine") ? { mine: true } : {}),
    ...(q !== null && q.trim() !== "" ? { words: q.slice(0, BOARD_WORDS_LENGTH) } : {}),
  };
};

/** The view the query asks for at a path, or nothing for one the path cannot be shown as. */
const docsViewOf = (params: URLSearchParams, path: string): DocsView | undefined => {
  const q = params.get("q");
  if (q !== null && q.trim().length > 0) {
    return { kind: "search", q: q.trim() };
  }
  if (params.has("new")) {
    return { kind: "new" };
  }
  if (params.has("edit")) {
    return path === "" ? undefined : { kind: "edit" };
  }
  const version = params.get("version");
  if (version !== null) {
    return path !== "" && NUMBER.test(version)
      ? { kind: "read", version: Number(version) }
      : undefined;
  }
  return { kind: "read" };
};

/** The week a plate's address names, or none for this week's; a value that is not a day is nobody's address. */
function weekShown(params: URLSearchParams): { readonly week: string | undefined } | undefined {
  const week = params.get("week");
  return week !== null && !isDay(week) ? undefined : { week: week ?? undefined };
}

export function matchRoute(pathname: string, search = ""): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const moved = movedFrom(path);
  if (moved !== undefined) {
    return { name: "moved", to: `${moved}${search}` };
  }
  const params = new URLSearchParams(search);
  if (path === PATHS.projects) {
    return { name: "projects" };
  }
  if (path === PATHS.newProject) {
    return { name: "new-project" };
  }
  if (path === PATHS.work) {
    const shown = weekShown(params);
    return shown === undefined ? NOT_FOUND : { name: "work", ...shown };
  }
  if (path === PATHS.decisions) {
    return { name: "my-decisions" };
  }
  if (path.startsWith(`${PATHS.decisions}/`)) {
    const id = path.slice(PATHS.decisions.length + 1);
    return UUID.test(id) ? { name: "my-decision", id } : NOT_FOUND;
  }
  if (path === PATHS.people) {
    return { name: "people" };
  }
  if (path === PATHS.newListing) {
    return { name: "new-listing" };
  }
  if (path === PATHS.teams) {
    return { name: "teams" };
  }
  if (path === PATHS.newTeam) {
    return { name: "new-team" };
  }
  if (path === PATHS.agents) {
    return { name: "agents" };
  }
  if (path === PATHS.newToken) {
    return { name: "new-token" };
  }
  if (path === PATHS.newAgent) {
    return { name: "new-agent" };
  }
  if (path.startsWith(`${PATHS.agents}/`)) {
    // Under the agents' own page, by the handle an account is called by; `new` is none.
    const [handle, tab, session, ...more] = path.slice(PATHS.agents.length + 1).split("/");
    if (
      handle === undefined ||
      !isHandle(handle) ||
      RESERVED_HANDLES.includes(handle) ||
      more.length > 0
    ) {
      return NOT_FOUND;
    }
    const agent = { name: "agent", handle, session: undefined, week: undefined } as const;
    if (tab === undefined) {
      return { ...agent, tab: "live" };
    }
    if (tab === "sessions") {
      return session === undefined || UUID.test(session)
        ? { ...agent, tab: "sessions", session: session?.toLowerCase() }
        : NOT_FOUND;
    }
    if (session !== undefined) {
      return NOT_FOUND;
    }
    if (tab === "work") {
      const shown = weekShown(params);
      return shown === undefined ? NOT_FOUND : { ...agent, tab: "work", ...shown };
    }
    return tab === "settings" ? { ...agent, tab: "settings" } : NOT_FOUND;
  }
  if (path === PATHS.categories) {
    return { name: "categories" };
  }
  if (path === PATHS.sessions) {
    return { name: "sessions" };
  }
  if (path === PATHS.pluginSettings) {
    return { name: "plugins-settings", plugin: undefined };
  }
  if (path.startsWith(`${PATHS.pluginSettings}/`)) {
    const [plugin, ...more] = path.slice(PATHS.pluginSettings.length + 1).split("/");
    return plugin !== undefined && PLUGIN_KEY.test(plugin) && more.length === 0
      ? { name: "plugins-settings", plugin }
      : NOT_FOUND;
  }
  if (path === PATHS.settings) {
    return {
      name: "workspace-settings",
      form: params.has("workspace")
        ? "workspace"
        : params.has("services")
          ? "services"
          : params.has("rules")
            ? "rules"
            : params.has("pack-token")
              ? "pack-token"
              : undefined,
    };
  }
  if (path === PATHS.connect) {
    return { name: "connect", code: undefined };
  }
  if (path.startsWith(`${PATHS.connect}/`)) {
    const code = path.slice(PATHS.connect.length + 1);
    return CODE_TEXT.test(code) ? { name: "connect", code } : NOT_FOUND;
  }
  if (path.startsWith(`${PATHS.people}/`)) {
    const [id, page, ...more] = path.slice(PATHS.people.length + 1).split("/");
    if (id === undefined || !UUID.test(id) || more.length > 0) {
      return NOT_FOUND;
    }
    if (page === "agents") {
      return { name: "person-agents", id };
    }
    if (page === "work") {
      const shown = weekShown(params);
      return shown === undefined ? NOT_FOUND : { name: "person-work", id, ...shown };
    }
    return NOT_FOUND;
  }
  if (path.startsWith(`${PATHS.pages}/`)) {
    const [page, ...more] = path.slice(PATHS.pages.length + 1).split("/");
    return page !== undefined && PROJECT_KEY.test(page) && more.length === 0
      ? { name: "custom", level: "workspace", page }
      : NOT_FOUND;
  }
  if (path.startsWith(`${PATHS.plugins}/`)) {
    const found = pluginRouteOf(path.slice(PATHS.plugins.length + 1).split("/"));
    return found === undefined ? NOT_FOUND : { name: "plugin", level: "workspace", ...found };
  }
  if (!path.startsWith(`${PATHS.project}/`)) {
    return NOT_FOUND;
  }
  const [project, page, third, ...rest] = path.slice(PATHS.project.length + 1).split("/");
  if (project === undefined || !PROJECT_KEY.test(project)) {
    return NOT_FOUND;
  }
  if (page === undefined) {
    return { name: "board", project, filter: boardFilterOf(params) };
  }
  if (page === "docs") {
    // The rest of the path is the document's, or a folder's, or nothing for the root.
    const docPath = [third, ...rest].filter((segment) => segment !== undefined).join("/");
    if (!isFolderPath(docPath)) {
      return NOT_FOUND;
    }
    const view = docsViewOf(params, docPath);
    return view === undefined ? NOT_FOUND : { name: "docs", project, path: docPath, view };
  }
  if (page === "pages") {
    return third !== undefined && PROJECT_KEY.test(third) && rest.length === 0
      ? { name: "custom", level: "project", project, page: third }
      : NOT_FOUND;
  }
  if (page === "plugins") {
    const found = pluginRouteOf([third, ...rest].filter((segment) => segment !== undefined));
    return found === undefined
      ? NOT_FOUND
      : { name: "plugin", level: "project", project, ...found };
  }
  if (rest.length > 0) {
    return NOT_FOUND;
  }
  if (page === "tasks") {
    if (third === "new") {
      return { name: "new-task", project };
    }
    if (third !== undefined && NUMBER.test(third)) {
      return {
        name: "task",
        project,
        number: Number(third),
        id: undefined,
        form: taskFormOf(params),
      };
    }
    if (third !== undefined && UUID.test(third)) {
      return { name: "task", project, number: undefined, id: third, form: taskFormOf(params) };
    }
    return NOT_FOUND;
  }
  if (page === "decisions" && third !== undefined) {
    if (third === "new") {
      return { name: "new-decision", project };
    }
    return UUID.test(third) ? { name: "decision", project, id: third } : NOT_FOUND;
  }
  if (page === "roadmap" && third !== undefined) {
    if (third === "new") {
      return { name: "new-goal", project };
    }
    if (!UUID.test(third)) {
      return NOT_FOUND;
    }
    const named = params.get("view");
    const view = named === null ? "board" : isGoalTaskView(named) ? named : undefined;
    const month = params.get("month");
    if (view === undefined || (month !== null && !isMonth(month))) {
      return NOT_FOUND;
    }
    return {
      name: "goal",
      project,
      id: third,
      form: params.has("edit") ? "edit" : undefined,
      view,
      month: month ?? undefined,
    };
  }
  if (third !== undefined) {
    return NOT_FOUND;
  }
  if (page === "calendar") {
    const month = params.get("month");
    if (month !== null && !isMonth(month)) {
      return NOT_FOUND;
    }
    return { name: "calendar", project, month: month ?? undefined, filter: boardFilterOf(params) };
  }
  if (page === "roadmap") {
    const from = params.get("from");
    if (from !== null && !isMonth(from)) {
      return NOT_FOUND;
    }
    return { name: "roadmap", project, from: from ?? undefined };
  }
  if (page === "settings") {
    return {
      name: "settings",
      project,
      form: params.has("edit")
        ? "edit"
        : params.has("rules")
          ? "rules"
          : params.has("pack-token")
            ? "pack-token"
            : undefined,
    };
  }
  if (page === "decisions") {
    const turned = params.get("page");
    if (turned !== null && !NUMBER.test(turned)) {
      return NOT_FOUND;
    }
    return { name: "decisions", project, page: turned === null ? undefined : Number(turned) };
  }
  const found = PLAIN_PAGES.find((candidate) => candidate === page);
  return found === undefined ? NOT_FOUND : { name: found, project };
}

/** Where a person approves an agent's connection by its code, or types one. */
export function connectHref(code?: string): string {
  return code === undefined ? PATHS.connect : `${PATHS.connect}/${encodeURIComponent(code)}`;
}

/** The views of an agent account's page. */
export type AgentTab = "live" | "sessions" | "work" | "settings";

/** Where an agent account's page is, by its handle: what it is doing now, another of its views, or one session. */
export function agentHref(handle: string, tab: AgentTab = "live", session?: string): string {
  const base = `${PATHS.agents}/${handle}`;
  if (tab === "live") {
    return base;
  }
  return tab === "sessions" && session !== undefined
    ? `${base}/sessions/${session}`
    : `${base}/${tab}`;
}

/** Where an agent account's plate is, with the week of a day at the top, or this week's. */
export function agentWorkHref(handle: string, week?: string): string {
  const base = agentHref(handle, "work");
  return week === undefined ? base : `${base}?week=${week}`;
}

/** Where an administrator sees one person's agents. */
export function personAgentsHref(personId: string): string {
  return `${PATHS.people}/${personId}/agents`;
}

/** Where another person's work is seen, with the week of a day at the top, or this week's when none is named. */
export function personWorkHref(personId: string, week?: string): string {
  const base = `${PATHS.people}/${personId}/work`;
  return week === undefined ? base : `${base}?week=${week}`;
}

/** Where a project's board is, or one of its pages. */
export function projectHref(key: string, page?: ProjectPage): string {
  const base = `${PATHS.project}/${key}`;
  return page === undefined ? base : `${base}/${page}`;
}

/** Where a project's settings are read, or one of their forms is open: the project's own, or its rules. */
export function projectSettingsHref(key: string, form?: "edit" | "rules" | "pack-token"): string {
  const base = projectHref(key, "settings");
  return form === undefined ? base : `${base}?${form}`;
}

/** Where the workspace's settings are, or the form its rules, or its own settings, are written on. */
export function settingsHref(form?: "rules" | "workspace" | "services" | "pack-token"): string {
  return form === undefined ? PATHS.settings : `${PATHS.settings}?${form}`;
}

/** Where a project's board is, narrowed as the filter says; the plain board for an empty one. */
export function boardHref(key: string, filter: BoardFilter = {}): string {
  const parts = filterParts(filter);
  return parts.length === 0 ? projectHref(key) : `${projectHref(key)}?${parts.join("&")}`;
}

/** The filter as the query carries it, a part per narrowing; nothing for the plain board. */
function filterParts(filter: BoardFilter): string[] {
  const parts: string[] = [];
  // An empty value means "none": it keeps its sign; "mine" is a flag and has no value.
  if (filter.category !== undefined) {
    parts.push(`category=${encodeURIComponent(filter.category)}`);
  }
  if (filter.goal !== undefined) {
    parts.push(`goal=${encodeURIComponent(filter.goal)}`);
  }
  if (filter.person !== undefined) {
    parts.push(`person=${encodeURIComponent(filter.person)}`);
  }
  if (filter.mine === true) {
    parts.push("mine");
  }
  if (filter.words !== undefined) {
    parts.push(`q=${encodeURIComponent(filter.words)}`);
  }
  return parts;
}

/** Where a task is written: the form. */
export function newTaskHref(key: string): string {
  return `${PATHS.project}/${key}/tasks/new`;
}

/** Where a task is read by its number, or one of its forms is open. */
export function taskHref(key: string, number: number, form?: TaskFormKind): string {
  const base = `${PATHS.project}/${key}/tasks/${number}`;
  return form === undefined ? base : `${base}?${form}`;
}

/** Where a decision is raised from the Decisions page: the form. */
export function newDecisionHref(key: string): string {
  return `${PATHS.project}/${key}/decisions/new`;
}

/** Where one decision is read, and answered. */
export function decisionHref(key: string, id: string): string {
  return `${PATHS.project}/${key}/decisions/${id}`;
}

/** Where a project's decisions are: the waiting ones and the record, on one of its pages, or on the first when none is named. */
export function decisionsHref(key: string, page?: number): string {
  const base = projectHref(key, "decisions");
  return page === undefined || page <= 1 ? base : `${base}?page=${page}`;
}

/** Where the person's own work is, with the week of a day at the top, or this week's when none is named. */
/** Where one decision is read wherever it is (ADR-0068), by whoever it reaches: a person outside its project too. */
export function myDecisionHref(id: string): string {
  return `${PATHS.decisions}/${id}`;
}

export function workHref(week?: string): string {
  return week === undefined ? PATHS.work : `${PATHS.work}?week=${week}`;
}

/** Where a project's calendar is, on a month, or on this one when none is named, narrowed as the filter says. */
export function calendarHref(key: string, month?: string, filter: BoardFilter = {}): string {
  const base = projectHref(key, "calendar");
  const parts = [...(month === undefined ? [] : [`month=${month}`]), ...filterParts(filter)];
  return parts.length === 0 ? base : `${base}?${parts.join("&")}`;
}

/** Where a page a console adds of its own is: on the workspace, or on a project when its key is given. */
export function customPageHref(page: string, project?: string): string {
  return project === undefined ? `${PATHS.pages}/${page}` : `${projectHref(project)}/pages/${page}`;
}

/** Where a plugin's page is (ADR-0054): its first page, or the one named, with what follows it; on a project when its key is given. */
export function pluginHref(plugin: string, page?: string, project?: string, rest = ""): string {
  const base =
    project === undefined
      ? `${PATHS.plugins}/${plugin}`
      : `${projectHref(project)}/plugins/${plugin}`;
  return page === undefined ? base : `${base}/${page}${rest}`;
}

/** Where the plugins' settings are, or one plugin's. */
export function pluginSettingsHref(plugin?: string): string {
  return plugin === undefined ? PATHS.pluginSettings : `${PATHS.pluginSettings}/${plugin}`;
}

/** Where a goal is set: the form. */
/** Where a project's roadmap is, from a month on, or from this one when none is named. */
export function roadmapHref(key: string, from?: string): string {
  const base = projectHref(key, "roadmap");
  return from === undefined ? base : `${base}?from=${from}`;
}

export function newGoalHref(key: string): string {
  return `${PATHS.project}/${key}/roadmap/new`;
}

/** The views of a goal's tasks: the board of them, the list by state, or the calendar. */
export const GOAL_TASK_VIEWS = ["board", "list", "calendar"] as const;
export type GoalTaskView = (typeof GOAL_TASK_VIEWS)[number];

function isGoalTaskView(value: string): value is GoalTaskView {
  return (GOAL_TASK_VIEWS as readonly string[]).includes(value);
}

/** What a goal's address may say besides the goal: its form, the view of its tasks, the calendar's month. */
export interface GoalPageOptions {
  readonly form?: "edit" | undefined;
  /** The board is the view an address without one shows. */
  readonly view?: GoalTaskView | undefined;
  readonly month?: string | undefined;
}

/** Where one goal is read, in a view of its tasks, or changed. */
export function goalHref(key: string, id: string, options: GoalPageOptions = {}): string {
  const base = `${PATHS.project}/${key}/roadmap/${id}`;
  const parts = [
    ...(options.form === undefined ? [] : [options.form]),
    ...(options.view === undefined || options.view === "board" ? [] : [`view=${options.view}`]),
    ...(options.month === undefined ? [] : [`month=${options.month}`]),
  ];
  return parts.length === 0 ? base : `${base}?${parts.join("&")}`;
}

/**
 * Where a document of a project is read, or a folder of them listed (`""` for the root), and
 * how: a form, a version, or a search over all of them.
 */
export function docHref(key: string, path: string, view?: DocsView): string {
  const base = path === "" ? projectHref(key, "docs") : `${PATHS.project}/${key}/docs/${path}`;
  if (view === undefined) {
    return base;
  }
  switch (view.kind) {
    case "search":
      return `${base}?q=${encodeURIComponent(view.q)}`;
    case "new":
      return `${base}?new`;
    case "edit":
      return `${base}?edit`;
    case "read":
      return view.version === undefined ? base : `${base}?version=${view.version}`;
  }
}

/** The ways a page moves the person: to an address, in place of the one shown, or back. */
export interface Navigation {
  /** Shows the address, as one more step in the history. */
  go(href: string): void;
  /** Shows the address in place of the one shown: for a redirect, or for what a form made. */
  replace(href: string): void;
  /** Goes back to where the page was reached from, or to `fallback` when there is no such place. */
  back(fallback: string): void;
}

/** Why the last sign-in did not complete, as the page's URL says it, or nothing. */
export function signInFailureOf(search: string): SignInFailure | undefined {
  const value = new URLSearchParams(search).get(SIGN_IN_PARAM);
  return isSignInFailure(value) ? value : undefined;
}

/** The URL without the sign-in parameter, once the page has read it. */
export function withoutSignInParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SIGN_IN_PARAM);
  const query = params.toString();
  return query.length === 0 ? pathname : `${pathname}?${query}`;
}
