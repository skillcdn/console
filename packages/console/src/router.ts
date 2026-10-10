import { isFolderPath, isSignInFailure, SIGN_IN_PARAM, type SignInFailure } from "./api.js";

// A few kinds of page and one level of nesting, the project, so the router is a function from
// a URL to a route. A project's pages live under `/p/<key>` (ADR-0008), its documents under
// `/p/<key>/docs/<path>` (ADR-0009); the workspace's own, the projects, the people and the
// tokens, at the top.

export type Route =
  | { readonly name: "projects" }
  | { readonly name: "board"; readonly project: string }
  | { readonly name: "task"; readonly project: string; readonly id: string }
  | { readonly name: "docs"; readonly project: string; readonly path: string }
  | { readonly name: "decisions"; readonly project: string }
  | { readonly name: "feed"; readonly project: string }
  | { readonly name: "skills"; readonly project: string }
  | { readonly name: "members"; readonly project: string }
  | { readonly name: "settings"; readonly project: string }
  | { readonly name: "tokens" }
  | { readonly name: "people" }
  | { readonly name: "not-found" };

/** The pages of a project, after its key. */
export type ProjectPage = "docs" | "decisions" | "feed" | "skills" | "members" | "settings";

export const PATHS = {
  /** The projects the person may see: the front page. */
  projects: "/",
  /** Where a project's pages are: `/p/<key>`, then the page. */
  project: "/p",
  /** The tokens of whoever is signed in: their own page. */
  tokens: "/tokens",
  people: "/people",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** The pages of a project that take nothing after their name; the docs take a path. */
const PLAIN_PAGES: readonly Exclude<ProjectPage, "docs">[] = [
  "decisions",
  "feed",
  "skills",
  "members",
  "settings",
];

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === PATHS.projects) {
    return { name: "projects" };
  }
  if (path === PATHS.tokens) {
    return { name: "tokens" };
  }
  if (path === PATHS.people) {
    return { name: "people" };
  }
  if (path.startsWith(`${PATHS.project}/`)) {
    const [project, page, id, ...rest] = path.slice(PATHS.project.length + 1).split("/");
    if (project === undefined || !PROJECT_KEY.test(project)) {
      return { name: "not-found" };
    }
    if (page === "docs") {
      // The rest of the path is the document's, or a folder's, or nothing for the root.
      const docPath = [id, ...rest].filter((segment) => segment !== undefined).join("/");
      return isFolderPath(docPath)
        ? { name: "docs", project, path: docPath }
        : { name: "not-found" };
    }
    if (rest.length > 0) {
      return { name: "not-found" };
    }
    if (page === undefined) {
      return { name: "board", project };
    }
    if (page === "tasks" && id !== undefined && UUID.test(id)) {
      return { name: "task", project, id };
    }
    const found = PLAIN_PAGES.find((candidate) => candidate === page);
    return found !== undefined && id === undefined
      ? { name: found, project }
      : { name: "not-found" };
  }
  return { name: "not-found" };
}

/** Where a project's board is, or one of its pages. */
export function projectHref(key: string, page?: ProjectPage): string {
  const base = `${PATHS.project}/${key}`;
  return page === undefined ? base : `${base}/${page}`;
}

export function taskHref(key: string, id: string): string {
  return `${PATHS.project}/${key}/tasks/${id}`;
}

/** Where a document of a project is read, or a folder of them listed; `""` for the root. */
export function docHref(key: string, path: string): string {
  return path === "" ? projectHref(key, "docs") : `${PATHS.project}/${key}/docs/${path}`;
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
