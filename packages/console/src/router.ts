import { isFolderPath, isSignInFailure, SIGN_IN_PARAM, type SignInFailure } from "./api.js";

// The addresses of the default console (ADR-0010): the router is a function from a URL to a
// route, and the hrefs below are its inverse. A project's pages live under `/projects/<key>`,
// the word the REST API uses; an address names what it shows (a task by its number, a decision
// by its id, a document by its path), every form has one, and the query says how a page is
// shown (`?edit`, `?ask`, `?new`, `?version=`, `?q=`). The old addresses are taken to the new.

/** How a task's page is shown: as it is, or with one of its forms open. */
export type TaskFormKind = "edit" | "ask";

/** How the documents are shown at a path: a folder or a page, a form, a version, or a search. */
export type DocsView =
  | { readonly kind: "read"; readonly version?: number | undefined }
  | { readonly kind: "new" }
  | { readonly kind: "edit" }
  | { readonly kind: "search"; readonly q: string };

export type Route =
  | { readonly name: "projects" }
  | { readonly name: "new-project" }
  | { readonly name: "board"; readonly project: string }
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
  | { readonly name: "feed"; readonly project: string }
  | { readonly name: "skills"; readonly project: string }
  | { readonly name: "members"; readonly project: string }
  | { readonly name: "settings"; readonly project: string }
  | { readonly name: "people" }
  /** The agents of one person, for an administrator. */
  | { readonly name: "person-agents"; readonly id: string }
  | { readonly name: "agents" }
  | { readonly name: "new-token" }
  /** Where a person approves an agent's connection, by the code it showed, or types one. */
  | { readonly name: "connect"; readonly code: string | undefined }
  /** An address that moved: the page takes the person to `to` in its place. */
  | { readonly name: "moved"; readonly to: string }
  | { readonly name: "not-found" };

/** The pages of a project, after its key. */
export type ProjectPage = "docs" | "decisions" | "feed" | "skills" | "members" | "settings";

export const PATHS = {
  /** The projects the person may see: the front page. */
  projects: "/",
  /** Where a project's pages are: `/projects/<key>`, then the page. */
  project: "/projects",
  newProject: "/projects/new",
  people: "/people",
  /** The agents of whoever is signed in, which hold their tokens: their own page. */
  agents: "/agents",
  /** The form for a token made by hand, for a script or a console of one's own. */
  newToken: "/agents/new",
  /** Where an agent's connection is approved (ADR-0011): `/connect/<code>`, or the code typed. */
  connect: "/connect",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const NUMBER = /^[1-9][0-9]{0,8}$/;
/** A code as it may be typed into an address: checked for what it is by the page. */
const CODE_TEXT = /^[A-Za-z0-9-]{1,16}$/;
/** The pages of a project that take nothing after their name. */
const PLAIN_PAGES: readonly Exclude<ProjectPage, "docs">[] = [
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
  if (path === PATHS.people) {
    return { name: "people" };
  }
  if (path === PATHS.agents) {
    return { name: "agents" };
  }
  if (path === PATHS.newToken) {
    return { name: "new-token" };
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
    return { name: "board", project };
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
  if (third !== undefined) {
    return NOT_FOUND;
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
