import { isSignInFailure, SIGN_IN_PARAM, type SignInFailure } from "./api.js";

// A few kinds of page and no nesting, so the router is a function from a URL to a route.

export type Route =
  | { readonly name: "board" }
  | { readonly name: "task"; readonly id: string }
  | { readonly name: "decisions" }
  | { readonly name: "feed" }
  | { readonly name: "skills" }
  | { readonly name: "tokens" }
  | { readonly name: "people" }
  | { readonly name: "not-found" };

export const PATHS = {
  board: "/",
  tasks: "/tasks",
  decisions: "/decisions",
  feed: "/feed",
  /** The organization's skills, as SkillCDN serves them. */
  skills: "/skills",
  /** The tokens of whoever is signed in: their own page. */
  tokens: "/tokens",
  people: "/people",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === PATHS.board) {
    return { name: "board" };
  }
  if (path === PATHS.decisions) {
    return { name: "decisions" };
  }
  if (path === PATHS.feed) {
    return { name: "feed" };
  }
  if (path === PATHS.skills) {
    return { name: "skills" };
  }
  if (path === PATHS.tokens) {
    return { name: "tokens" };
  }
  if (path === PATHS.people) {
    return { name: "people" };
  }
  if (path.startsWith(`${PATHS.tasks}/`)) {
    const id = path.slice(PATHS.tasks.length + 1);
    return UUID.test(id) ? { name: "task", id } : { name: "not-found" };
  }
  return { name: "not-found" };
}

export function taskHref(id: string): string {
  return `${PATHS.tasks}/${id}`;
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
