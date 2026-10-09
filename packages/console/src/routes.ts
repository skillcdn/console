// Where the console answers (docs/architecture.md). The REST API is for the pages and for a
// custom console; signing in and out are navigations and one form post, not part of it.
import type { ProviderKey } from "./vocabulary.js";

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
  /** The tokens of whoever asks: what their agents, scripts and consoles act as them with. */
  tokens: "/api/v1/tokens",
  /** The runs: agents at work, and what they did. */
  runs: "/api/v1/runs",
  /** The bytes of a file a run handed in: `/api/v1/files/<artifact id>`. */
  files: "/api/v1/files",
} as const;

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

/** The REST path of one task, decision, token, person, run or file: the collection, then the id. */
export function restPath(
  collection: "tasks" | "decisions" | "tokens" | "people" | "runs" | "files",
  id: string,
): string {
  return `${REST_ROUTES[collection]}/${encodeURIComponent(id)}`;
}
