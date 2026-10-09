import {
  AUTH_ROUTES,
  isProviderKey,
  type ProviderKey,
  REST_ROUTES,
  RETURN_TO_PARAM,
  type RestMe,
  type RestProvider,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import type { Login, LoginStep } from "../auth/login.js";
import { safeReturnTo } from "../auth/login.js";
import type { Membership } from "../auth/membership.js";
import type { Sessions } from "../auth/sessions.js";
import type { Tokens } from "../auth/tokens.js";
import type { PersonRecord } from "../db/queries/people.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import { errorBody } from "./app.js";
import type { AppEnv } from "./request-context.js";
import { restPerson } from "./rest-shapes.js";

/** What signing in is made of, on a deployment where people can. */
export interface AppAuth {
  /** The origin people use: where a provider sends people back, and where requests that change something come from. */
  readonly origin: string;
  readonly sessions: Sessions;
  /** The tokens people made for their agents, scripts and consoles of their own. */
  readonly tokens: Tokens;
  /** Signing in, per provider the deployment has. */
  readonly logins: ReadonlyMap<ProviderKey, Login>;
  /** The providers, as the pages offer them. */
  readonly providers: readonly RestProvider[];
  readonly membership: Membership;
}

// The sign-in paths of the package, with the provider as a parameter of the route.
const LOGIN_PATTERN = "/auth/:provider/login";
const CALLBACK_PATTERN = "/auth/:provider/callback";

/**
 * Who a request is for, and whether it may change anything: what every route of the REST API
 * asks before it does its work. A request carries a session cookie, which a browser attaches on
 * its own, or a token in its authorization header, which whoever holds it attaches on purpose.
 * On a deployment where nobody signs in, every request is nobody's.
 */
export interface Access {
  /**
   * The person the token or the session cookie names, while the operator still lists them;
   * else nobody. A token presented is the credential, and a cookie beside it is not looked at,
   * so that a token that is nothing never stands in for a session.
   */
  person(c: Context<AppEnv>): Promise<PersonRecord | undefined>;
  /** Whether the request presents a token, whatever the token is worth. */
  presentsToken(c: Context<AppEnv>): boolean;
  /** A session the operator no longer honours is taken away with the answer. */
  signedOut(c: Context<AppEnv>): void;
  /**
   * A request that changes something for the person signed in has to come from this
   * deployment's own pages. The session cookie is not sent with another site's requests in the
   * first place; this is the second fence, and browsers name the origin of every such request.
   */
  fromOwnPages(c: Context<AppEnv>): boolean;
}

export function createAccess(auth: AppAuth | undefined): Access {
  return {
    async person(c) {
      if (auth === undefined) {
        return undefined;
      }
      const authorization = c.req.header("authorization");
      if (authorization !== undefined) {
        const found = await auth.tokens.resolve(authorization);
        // Membership is decided on every request, for a token as for a session.
        return found === undefined || !auth.membership.allows(found.person)
          ? undefined
          : found.person;
      }
      const person = await auth.sessions.resolve(c.req.header("cookie"));
      if (person === undefined) {
        return undefined;
      }
      // A login taken off the list is out at once, and the browser's cookie goes with the answer.
      if (!auth.membership.allows(person)) {
        this.signedOut(c);
        return undefined;
      }
      return person;
    },
    presentsToken(c) {
      return auth !== undefined && c.req.header("authorization") !== undefined;
    },
    signedOut(c) {
      if (auth !== undefined) {
        c.header("set-cookie", auth.sessions.clear());
      }
    },
    fromOwnPages(c) {
      return auth !== undefined && c.req.header("origin") === auth.origin;
    },
  };
}

export const signInRequired = (c: Context<AppEnv>): Response =>
  c.json(errorBody("auth.required", "Sign in to continue."), 401);

export const foreignOrigin = (c: Context<AppEnv>): Response =>
  c.json(
    errorBody("auth.forbidden_origin", "This request must come from the console itself."),
    403,
  );

/** What a member is answered when they ask for what only an administrator may do. */
export const administratorRequired = (c: Context<AppEnv>): Response =>
  c.json(errorBody("auth.forbidden", "Only an administrator may do this."), 403);

/** What a token is answered when it asks for what only a person signed in may do. */
export const sessionRequired = (c: Context<AppEnv>): Response =>
  c.json(
    errorBody(
      "auth.session_required",
      "This is done on the console's own pages, by a person signed in, not with a token.",
    ),
    403,
  );

export interface AuthDependencies {
  readonly auth: AppAuth | undefined;
  readonly access: Access;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly logger: Logger;
}

/**
 * Signing in and out, and who is signed in. Signing in exists only on a deployment configured
 * for it, and only through the providers it has; elsewhere its paths are nothing, and `me`
 * says that nobody can sign in.
 */
export function registerAuth(app: Hono<AppEnv>, dependencies: AuthDependencies): void {
  const { auth, access, workspace } = dependencies;

  // Whoever is signed in, for the pages. Nobody is an answer too.
  app.get(REST_ROUTES.me, async (c) => {
    c.header("cache-control", "no-store");
    const [found, person] = await Promise.all([workspace(), access.person(c)]);
    const body: RestMe = {
      workspace: { name: found.name },
      person: person === undefined ? null : restPerson(person),
      signIn: auth === undefined ? [] : [...auth.providers],
    };
    return c.json(body);
  });

  if (auth === undefined) {
    return;
  }
  const { origin, sessions, logins } = auth;

  const follow = (c: Context<AppEnv>, step: LoginStep): Response => {
    for (const cookie of step.cookies) {
      c.header("set-cookie", cookie, { append: true });
    }
    c.header("cache-control", "no-store");
    return c.redirect(step.redirect, 302);
  };

  /**
   * A sign-in begins on the deployment's own pages, where a person sees which host they
   * continue with. A browser says where a navigation comes from, and one that comes from
   * anywhere else, a link on another site or an address typed, is not a person pressing that
   * button. A request that says nothing is from a browser too old to say, which could not sign
   * in at all if silence were refused.
   */
  const begunOnOwnPages = (c: Context<AppEnv>): boolean => {
    const site = c.req.header("sec-fetch-site");
    return site === undefined || site === "same-origin";
  };

  /** The sign-in of the provider the path names, or nothing for one this deployment has not. */
  const loginOf = (c: Context<AppEnv>): Login | undefined => {
    const key = c.req.param("provider");
    return isProviderKey(key) ? logins.get(key) : undefined;
  };

  // Signing in and out. Navigations, so they answer with redirects; nothing here is cached.
  app.get(LOGIN_PATTERN, (c) => {
    const login = loginOf(c);
    if (login === undefined) {
      return c.notFound();
    }
    const returnTo = c.req.query(RETURN_TO_PARAM);
    if (!begunOnOwnPages(c)) {
      // To the page it was for, which offers it over itself: following a link signs nobody in.
      c.header("cache-control", "no-store");
      return c.redirect(safeReturnTo(returnTo, origin), 302);
    }
    return follow(c, login.begin(returnTo));
  });

  app.get(CALLBACK_PATTERN, async (c) => {
    const login = loginOf(c);
    if (login === undefined) {
      return c.notFound();
    }
    const { code, state, error } = c.req.query();
    return follow(
      c,
      await login.complete(
        {
          ...(code === undefined ? {} : { code }),
          ...(state === undefined ? {} : { state }),
          ...(error === undefined ? {} : { error }),
        },
        c.req.header("cookie"),
      ),
    );
  });

  app.post(AUTH_ROUTES.logout, async (c) => {
    if (!access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    c.header("set-cookie", await sessions.end(c.req.header("cookie")));
    c.header("cache-control", "no-store");
    return c.body(null, 204);
  });
}
