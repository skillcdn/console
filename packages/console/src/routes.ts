// Where the console answers (docs/architecture.md). The REST API is for the pages and for a
// custom console; signing in and out are navigations and one form post, not part of it. The
// board is nested under the project it belongs to (ADR-0008).
import type { ProviderKey } from "./vocabulary.js";

/** One prefix per resource of the workspace; an id follows where one is needed. */
export const REST_ROUTES = {
  /** Who is signed in, what the workspace is called, and whether anyone can sign in. */
  me: "/api/v1/me",
  /** The people of the workspace: everyone who has signed in. */
  people: "/api/v1/people",
  /** The projects the asker may see; the board of each is under its key. */
  projects: "/api/v1/projects",
  /** The workspace's own events, the ones about no project: who joined, who was made what. */
  events: "/api/v1/events",
  /** The tokens of whoever asks: what their agents, scripts and consoles act as them with. */
  tokens: "/api/v1/tokens",
} as const;

/** What a project holds, each under `/api/v1/projects/<key>/<collection>`. */
export const PROJECT_COLLECTIONS = [
  "tasks",
  "decisions",
  "runs",
  "files",
  "events",
  "skills",
  "members",
] as const;

export type ProjectCollection = (typeof PROJECT_COLLECTIONS)[number];

/** Where a browser signs in and out. Signing in is per provider: `/auth/<provider>/...`. */
export const AUTH_ROUTES = {
  /** Sends the browser to the provider to sign in, and afterwards to `return_to`. */
  login: (provider: ProviderKey): string => `/auth/${provider}/login`,
  /** Where the provider sends the browser back to. */
  callback: (provider: ProviderKey): string => `/auth/${provider}/callback`,
  /** A POST from the pages that ends the session. */
  logout: "/auth/logout",
} as const;

/** The parameter of the login route naming the page to come back to: a path of this origin. */
export const RETURN_TO_PARAM = "return_to";

/**
 * The parameter by which the server tells a page that a sign-in did not complete: the person
 * said no at the provider, the attempt was not finished in time or in the browser that began
 * it, the provider did not confirm it, or the account is not a member of the workspace.
 */
export const SIGN_IN_PARAM = "sign_in";
export const SIGN_IN_FAILURES = ["denied", "expired", "failed", "refused"] as const;
export type SignInFailure = (typeof SIGN_IN_FAILURES)[number];

export function isSignInFailure(value: string | null | undefined): value is SignInFailure {
  return (SIGN_IN_FAILURES as readonly string[]).includes(value ?? "");
}

/** Where a browser leaves for the provider to sign in and come back to `returnTo`. */
export function loginPath(provider: ProviderKey, returnTo: string): string {
  return `${AUTH_ROUTES.login(provider)}?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/** A page of this origin, told why the sign-in it was waiting for did not complete. */
export function signInPath(page: string, failure: SignInFailure): string {
  return `${page}${page.includes("?") ? "&" : "?"}${SIGN_IN_PARAM}=${failure}`;
}

/** The REST path of one person, token or project: the collection, then the id or the key. */
export function restPath(collection: "people" | "tokens" | "projects", id: string): string {
  return `${REST_ROUTES[collection]}/${encodeURIComponent(id)}`;
}

/**
 * The REST path of a project, of one of its collections, or of one item in it: the tasks of
 * `web` are at `projectPath("web", "tasks")`, task 7 at `projectPath("web", "tasks", "7")`.
 */
export function projectPath(key: string, collection?: ProjectCollection, id?: string): string {
  const base = restPath("projects", key);
  if (collection === undefined) {
    return base;
  }
  return id === undefined
    ? `${base}/${collection}`
    : `${base}/${collection}/${encodeURIComponent(id)}`;
}
