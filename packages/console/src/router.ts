import { isFolderPath, isSignInFailure, SIGN_IN_PARAM, type SignInFailure } from "./api.js";
import { isMonth } from "./dates.js";

// The addresses of the default console (ADR-0010): the router is a function from a URL to a
// route, and the hrefs below are its inverse. A project's pages live under `/projects/<key>`,
// the word the REST API uses; an address names what it shows (a task by its number, a decision
// by its id, a document by its path, a goal by its id), every form has one, and the query says
// how a page is shown (`?edit`, `?ask`, `?new`, `?version=`, `?q=`, `?month=`, and the board's
// filters). The old addresses are taken to the new.

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
 * or the person's own.
 */
export interface BoardFilter {
  readonly category?: string | undefined;
  readonly goal?: string | undefined;
  readonly person?: string | undefined;
  readonly mine?: boolean | undefined;
}

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
  | { readonly name: "decisions"; readonly project: string }
  | { readonly name: "new-decision"; readonly project: string }
  | { readonly name: "decision"; readonly project: string; readonly id: string }
  /** The calendar of a project: the month shown, or this one when the address names none, narrowed as the board is. */
  | {
      readonly name: "calendar";
      readonly project: string;
      readonly month: string | undefined;
      readonly filter: BoardFilter;
    }
  | { readonly name: "roadmap"; readonly project: string }
  | { readonly name: "new-goal"; readonly project: string }
  | {
      readonly name: "goal";
      readonly project: string;
      readonly id: string;
      readonly form: "edit" | undefined;
    }
  | { readonly name: "feed"; readonly project: string }
  | { readonly name: "skills"; readonly project: string }
  | { readonly name: "members"; readonly project: string }
  | { readonly name: "settings"; readonly project: string }
  | { readonly name: "people" }
  /** The agents of one person, for an administrator. */
  | { readonly name: "person-agents"; readonly id: string }
  | { readonly name: "agents" }
  | { readonly name: "new-token" }
  /** What is on the person's plate across their projects. */
  | { readonly name: "work" }
  /** The categories tasks are sorted into; an administrator keeps them here. */
  | { readonly name: "categories" }
  /** Where a person approves an agent's connection, by the code it showed, or types one. */
  | { readonly name: "connect"; readonly code: string | undefined }
  /** An address that moved: the page takes the person to `to` in its place. */
  | { readonly name: "moved"; readonly to: string }
  | { readonly name: "not-found" };

/** The pages of a project, after its key. */
export type ProjectPage =
  | "docs"
  | "decisions"
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
  people: "/people",
  /** The agents of whoever is signed in, which hold their tokens: their own page. */
  agents: "/agents",
  /** The form for a token made by hand, for a script or a console of one's own. */
  newToken: "/agents/new",
  /** The categories tasks are sorted into, kept by an administrator. */
  categories: "/categories",
  /** Where an agent's connection is approved (ADR-0011): `/connect/<code>`, or the code typed. */
  connect: "/connect",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const NUMBER = /^[1-9][0-9]{0,8}$/;
/** A code as it may be typed into an address: checked for what it is by the page. */
const CODE_TEXT = /^[A-Za-z0-9-]{1,16}$/;
/** The pages of a project that take nothing after their name. */
const PLAIN_PAGES: readonly Exclude<ProjectPage, "docs" | "calendar" | "roadmap">[] = [
  "decisions",
  "feed",
  "skills",
  "members",
  "settings",
];
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
  return {
    ...(category !== null && (category === "" || PROJECT_KEY.test(category)) ? { category } : {}),
    ...(goal !== null && (goal === "" || UUID.test(goal)) ? { goal } : {}),
    ...(person !== null && UUID.test(person) ? { person } : {}),
    ...(params.has("mine") ? { mine: true } : {}),
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
    return { name: "work" };
  }
  if (path === PATHS.people) {
    return { name: "people" };
  }
  if (path === PATHS.agents) {
    return { name: "agents" };
  }
  if (path === PATHS.newToken) {
    return { name: "new-token" };
  }
  if (path === PATHS.categories) {
    return { name: "categories" };
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
    return id !== undefined && UUID.test(id) && page === "agents" && more.length === 0
      ? { name: "person-agents", id }
      : NOT_FOUND;
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
    return UUID.test(third)
      ? { name: "goal", project, id: third, form: params.has("edit") ? "edit" : undefined }
      : NOT_FOUND;
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
    return { name: "roadmap", project };
  }
  const found = PLAIN_PAGES.find((candidate) => candidate === page);
  return found === undefined ? NOT_FOUND : { name: found, project };
}

/** Where a person approves an agent's connection by its code, or types one. */
export function connectHref(code?: string): string {
  return code === undefined ? PATHS.connect : `${PATHS.connect}/${encodeURIComponent(code)}`;
}

/** Where an administrator sees one person's agents. */
export function personAgentsHref(personId: string): string {
  return `${PATHS.people}/${personId}/agents`;
}

/** Where a project's board is, or one of its pages. */
export function projectHref(key: string, page?: ProjectPage): string {
  const base = `${PATHS.project}/${key}`;
  return page === undefined ? base : `${base}/${page}`;
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

/** Where a project's calendar is, on a month, or on this one when none is named, narrowed as the filter says. */
export function calendarHref(key: string, month?: string, filter: BoardFilter = {}): string {
  const base = projectHref(key, "calendar");
  const parts = [...(month === undefined ? [] : [`month=${month}`]), ...filterParts(filter)];
  return parts.length === 0 ? base : `${base}?${parts.join("&")}`;
}

/** Where a goal is set: the form. */
export function newGoalHref(key: string): string {
  return `${PATHS.project}/${key}/roadmap/new`;
}

/** Where one goal is read, or changed. */
export function goalHref(key: string, id: string, form?: "edit"): string {
  const base = `${PATHS.project}/${key}/roadmap/${id}`;
  return form === undefined ? base : `${base}?${form}`;
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
