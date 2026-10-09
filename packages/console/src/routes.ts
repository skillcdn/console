// Where the console answers (docs/architecture.md). The REST API is for the pages and for a
// custom console; signing in and out are navigations and one form post, not part of it.

/** One prefix per resource; an id follows where one is needed. */
export const REST_ROUTES = {
  /** Who is signed in, what the workspace is called, and whether anyone can sign in. */
  me: "/api/v1/me",
  /** The people of the workspace: everyone who has signed in. */
  people: "/api/v1/people",
  tasks: "/api/v1/tasks",
  decisions: "/api/v1/decisions",
  /** The feed, from a point on; and `/stream` under it, the same as it happens. */
  events: "/api/v1/events",
} as const;

/** Where a browser signs in and out. */
export const AUTH_ROUTES = {
  /** Sends the browser to the git host to sign in, and afterwards to `return_to`. */
  login: "/auth/gh/login",
  /** Where the git host sends the browser back to. */
  callback: "/auth/gh/callback",
  /** A POST from the pages that ends the session. */
  logout: "/auth/logout",
} as const;

/** The parameter of the login route naming the page to come back to: a path of this origin. */
export const RETURN_TO_PARAM = "return_to";

/**
 * The parameter by which the server tells a page that a sign-in did not complete: the person
 * said no at the git host, the attempt was not finished in time or in the browser that began
 * it, the host did not confirm it, or the account is not a member of the workspace.
 */
export const SIGN_IN_PARAM = "sign_in";
export const SIGN_IN_FAILURES = ["denied", "expired", "failed", "refused"] as const;
export type SignInFailure = (typeof SIGN_IN_FAILURES)[number];

export function isSignInFailure(value: string | null | undefined): value is SignInFailure {
  return (SIGN_IN_FAILURES as readonly string[]).includes(value ?? "");
}

/** Where a browser leaves for the git host to sign in and come back to `returnTo`. */
export function loginPath(returnTo: string): string {
  return `${AUTH_ROUTES.login}?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/** A page of this origin, told why the sign-in it was waiting for did not complete. */
export function signInPath(page: string, failure: SignInFailure): string {
  return `${page}${page.includes("?") ? "&" : "?"}${SIGN_IN_PARAM}=${failure}`;
}

/** The REST path of one task, one decision: the collection, then the id. */
export function restPath(collection: "tasks" | "decisions", id: string): string {
  return `${REST_ROUTES[collection]}/${encodeURIComponent(id)}`;
}
