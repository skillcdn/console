import {
  AUTH_ROUTES,
  clientVersionOf,
  formatVersion,
  isProviderKey,
  type ProviderKey,
  REST_ROUTES,
  RETURN_TO_PARAM,
  type RestMe,
  type RestProvider,
  type RestWorkspace,
  restMePatchSchema,
  restWorkspacePatchSchema,
  SERVICE_ROLES,
  serviceProblem,
  serviceProviderOf,
} from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Connections } from "../auth/connect.js";
import type { Login, LoginStep } from "../auth/login.js";
import { safeReturnTo } from "../auth/login.js";
import { type Membership, refusalOf } from "../auth/membership.js";
import { configuresWorkspace } from "../auth/policy.js";
import type { Secrets } from "../auth/secrets.js";
import type { CommandSession, SessionClient, Sessions } from "../auth/sessions.js";
import type { Tokens } from "../auth/tokens.js";
import type { Database } from "../db/client.js";
import { countWaitingDecisionsFor } from "../db/queries/decisions.js";
import {
  homeOf,
  languageOf,
  type PersonRecord,
  setHome,
  setLanguage,
} from "../db/queries/people.js";
import type { TokenRecord } from "../db/queries/tokens.js";
import {
  readWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceRecord,
  type WorkspaceSettings,
} from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import type { OrganizationDirectory } from "../ports/organization.js";
import { errorBody } from "./app.js";
import type { AppEnv } from "./request-context.js";
import { restPersonWithEmail } from "./rest-shapes.js";
import { restWorkspace } from "./workspace.js";

/** What signing in is made of, on a deployment where people can. */
export interface AppAuth {
  /** The origin people use: where a provider sends people back, and where requests that change something come from. */
  readonly origin: string;
  readonly sessions: Sessions;
  /** The tokens people made for their agents, scripts and consoles of their own. */
  readonly tokens: Tokens;
  /** Seals what the console keeps for people: the pack token of a project (ADR-0028). */
  readonly secrets: Secrets;
  /** Agents connecting with a code a person approves (ADR-0011). */
  readonly connections: Connections;
  /** Signing in, per provider the deployment has. */
  readonly logins: ReadonlyMap<ProviderKey, Login>;
  /** The providers, as the pages offer them. */
  readonly providers: readonly RestProvider[];
  readonly membership: Membership;
  /** The organization at the git host whose members are in (ADR-0022), when one is named. */
  readonly organization: OrganizationDirectory | undefined;
}

// The sign-in paths of the package, with the provider as a parameter of the route.
/** The most a patch of the person or the workspace reads, as the rest of the API does. */
const MAX_BODY_BYTES = 256 * 1024;

const LOGIN_PATTERN = "/auth/:provider/login";
const CALLBACK_PATTERN = "/auth/:provider/callback";

/**
 * Who is asking, and with what. A token when one is presented, so that an agent is told apart
 * from its person's browser; the command's session when the command is signed in as the account
 * itself (ADR-0084), which names no agent, since the account does it itself; neither on a
 * browser's session.
 */
export interface AccessCaller {
  readonly person: PersonRecord;
  readonly token: TokenRecord | undefined;
  readonly command?: CommandSession | undefined;
}

/**
 * Who a request is for, and whether it may change anything: what every route of the REST API
 * asks before it does its work. A request carries a session cookie, which a browser attaches on
 * its own, or a credential in its authorization header, which whoever holds it attaches on
 * purpose: a token a person made, or the secret of a command's session. On a deployment where
 * nobody signs in, every request is nobody's.
 */
export interface Access {
  /**
   * The person the token or the session cookie names, while the operator still lists them;
   * else nobody. A token presented is the credential, and a cookie beside it is not looked at,
   * so that a token that is nothing never stands in for a session.
   */
  person(c: Context<AppEnv>): Promise<PersonRecord | undefined>;
  /**
   * Who is asking and with what: the token when one is presented, so that an agent is told
   * apart from its person's browser. A token the console knows, for a person who is out, is
   * nobody, and leaves why on the request for `signInRequired` to answer (ADR-0044).
   */
  caller(c: Context<AppEnv>): Promise<AccessCaller | undefined>;
  /**
   * Whether the request presents a credential in its authorization header, a token or a
   * command's session, whatever it is worth: what is held to what a token may ask (ADR-0021).
   */
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

/** What the request says of the browser it comes from: what it calls itself, and its address as the server saw it. */
export const clientOf = (c: Context<AppEnv>): SessionClient => ({
  userAgent: c.req.header("user-agent"),
  address: c.get("clientAddress"),
});

export function createAccess(auth: AppAuth | undefined): Access {
  return {
    async caller(c) {
      if (auth === undefined) {
        return undefined;
      }
      const authorization = c.req.header("authorization");
      if (authorization !== undefined) {
        // The command names its version; the token keeps it, so that the Agents page says
        // which version each agent runs (ADR-0025).
        const client = clientVersionOf(c.req.header("user-agent"));
        const found =
          (await auth.tokens.resolve(
            authorization,
            client === undefined ? undefined : formatVersion(client),
          )) ??
          // The command signed in as the account itself (ADR-0084): a session, presented as a
          // token is, and held to what a token may ask by being presented so.
          (await auth.sessions.resolveCommand(authorization, clientOf(c)));
        if (found === undefined) {
          return undefined;
        }
        // Membership is decided on every request, for a token as for a session. A token the
        // console knows, for a person who is out, is kept and refused with the reason (ADR-0044).
        if (!auth.membership.allows(found.person)) {
          c.set("refusal", refusalOf(found.person));
          return undefined;
        }
        return "token" in found
          ? { person: found.person, token: found.token }
          : { person: found.person, token: undefined, command: found.command };
      }
      const person = await auth.sessions.resolve(c.req.header("cookie"), clientOf(c));
      if (person === undefined) {
        return undefined;
      }
      // A login taken off the list is out at once, and the browser's cookie goes with the answer.
      if (!auth.membership.allows(person)) {
        this.signedOut(c);
        return undefined;
      }
      return { person, token: undefined };
    },
    async person(c) {
      return (await this.caller(c))?.person;
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

/**
 * What nobody is answered: to sign in; or, for a token the console knows whose person is out,
 * why it is refused (ADR-0044), so that the agent can tell its person.
 */
export const signInRequired = (c: Context<AppEnv>): Response => {
  const refusal = c.get("refusal");
  return refusal === undefined
    ? c.json(errorBody("auth.required", "Sign in to continue."), 401)
    : c.json(errorBody(refusal.code, refusal.message), 403);
};

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
  /** The organization's skills: the deployment they are read through, and its default address. */
  readonly skills: { readonly source: string; readonly address: string | undefined };
  /** The console's version and the range of command versions it takes (ADR-0025). */
  readonly console: { readonly version: string; readonly clientRange: string };
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Signing in and out, and who is signed in. Signing in exists only on a deployment configured
 * for it, and only through the providers it has; elsewhere its paths are nothing, and `me`
 * says that nobody can sign in.
 */
export function registerAuth(app: Hono<AppEnv>, dependencies: AuthDependencies): void {
  const { auth, access, workspace, skills, database, clock } = dependencies;
  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });

  /**
   * What the pages are told about who asks: the workspace, the person, with what (a token's
   * name, so that a console of a person's own knows it holds one), their language, the ways in,
   * and the console's version, for a console built on the package to compare itself with.
   */
  const workspaceOf = (found: WorkspaceRecord, settings: WorkspaceSettings): RestWorkspace =>
    restWorkspace(found, settings, skills, auth?.tokens.daysAtMost);
  /** Whether the runtime knows the name as a time zone: the schema has its shape, the console the list. */
  const isTimeZone = (name: string): boolean => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: name });
      return true;
    } catch {
      return false;
    }
  };
  const meOf = async (caller: AccessCaller | undefined): Promise<RestMe> => {
    const found = await workspace();
    const person = caller?.person;
    return {
      workspace: workspaceOf(found, await readWorkspaceSettings(database, found.id)),
      person: person === undefined ? null : restPersonWithEmail(person),
      agent: caller?.token?.name ?? null,
      // The session asking, where one asks: the command's, signed in as the account itself, which
      // a console served through it is told by, as it is told a token by `agent`; a browser's.
      session:
        caller === undefined || caller.token !== undefined
          ? null
          : caller.command === undefined
            ? { kind: "browser", name: null }
            : { kind: "command", name: caller.command.name },
      language: person === undefined ? null : ((await languageOf(database, person.id)) ?? null),
      // The person's own arrangement of the front page's widgets (ADR-0059), or the manifests'.
      home: person === undefined ? null : ((await homeOf(database, person.id)) ?? null),
      // The decisions waiting for the person across the projects they may see (ADR-0042),
      // counted for the pages to say beside My decisions; nobody has none to answer.
      decisions:
        person === undefined
          ? null
          : { waiting: await countWaitingDecisionsFor(database, found.id, person) },
      signIn: auth === undefined ? [] : [...auth.providers],
      console: {
        version: dependencies.console.version,
        clientRange: dependencies.console.clientRange,
      },
    };
  };

  // Whoever is signed in, for the pages. Nobody is an answer too; a token refused for its
  // person's sake is told why instead (ADR-0044).
  app.get(REST_ROUTES.me, async (c) => {
    c.header("cache-control", "no-store");
    const caller = await access.caller(c);
    if (caller === undefined && c.get("refusal") !== undefined) {
      return signInRequired(c);
    }
    return c.json(await meOf(caller));
  });

  // The person's own choice of language (ADR-0012): theirs to keep, from the console's own
  // pages or through their token (ADR-0021).
  app.patch(REST_ROUTES.me, tooLarge, async (c) => {
    c.header("cache-control", "no-store");
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const person = await access.person(c);
    if (person === undefined) {
      return signInRequired(c);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json(errorBody("request.invalid", "The request body is not readable JSON."), 400);
    }
    const parsed = restMePatchSchema.safeParse(json);
    if (!parsed.success) {
      return c.json(
        errorBody(
          "request.invalid",
          "The patch names no language tag and no arrangement of the front page that reads.",
        ),
        400,
      );
    }
    if (parsed.data.language !== undefined) {
      await setLanguage(database, person.id, parsed.data.language ?? undefined, clock.now());
    }
    if (parsed.data.home !== undefined) {
      await setHome(database, person.id, parsed.data.home ?? undefined, clock.now());
    }
    // Asked again: the person as they are now, and the token that asked, as `GET` answers.
    return c.json(await meOf(await access.caller(c)));
  });

  /**
   * What a patch of the workspace's settings that does not read is answered with. Where one of
   * its services is why, the answer says which and what is wrong with it, in the schema's own
   * few words: an administrator who misspelled a parameter is told so, and not that the patch
   * names nothing. Of what was sent it says back a parameter's name at most, a word.
   */
  const patchProblem = (json: unknown): string => {
    const services =
      typeof json === "object" && json !== null
        ? (json as { services?: unknown }).services
        : undefined;
    if (typeof services === "object" && services !== null) {
      for (const role of SERVICE_ROLES) {
        const service = (services as Record<string, unknown>)[role];
        if (
          typeof service === "object" &&
          service !== null &&
          !Array.isArray(service) &&
          Object.values(service).every((value) => typeof value === "string")
        ) {
          const problem = serviceProblem(role, service as Record<string, string>);
          if (problem !== undefined) {
            return `services.${role}: ${problem}.`;
          }
        }
      }
    }
    return "The patch names nothing to change, or no setting.";
  };

  // The workspace's settings (ADR-0035): an administrator's, from the console's own pages or
  // through their agent's token (ADR-0021); answered as `me` describes the workspace.
  app.patch(REST_ROUTES.workspace, tooLarge, async (c) => {
    c.header("cache-control", "no-store");
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await access.caller(c);
    if (caller === undefined) {
      return signInRequired(c);
    }
    if (!configuresWorkspace(caller.person)) {
      return administratorRequired(c);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json(errorBody("request.invalid", "The request body is not readable JSON."), 400);
    }
    const parsed = restWorkspacePatchSchema.safeParse(json);
    if (!parsed.success) {
      return c.json(errorBody("request.invalid", patchProblem(json)), 400);
    }
    const zone = parsed.data.timeZone;
    if (typeof zone === "string" && !isTimeZone(zone)) {
      return c.json(
        errorBody("request.invalid", "timeZone: not a time zone the console knows."),
        400,
      );
    }
    // The identity service is one the deployment signs people in through (ADR-0089): an agent
    // account signs in with it, so one nobody can sign in with here is none.
    const identity = parsed.data.services?.identity;
    if (identity !== undefined && identity !== null) {
      const through = serviceProviderOf(identity.kind ?? "").signsInThrough;
      const offered = auth?.providers.map((provider) => provider.key) ?? [];
      if (through === undefined || !offered.includes(through)) {
        return c.json(
          errorBody(
            "workspace.identity_unavailable",
            "services.identity: nobody signs in to this console through that service.",
          ),
          400,
        );
      }
    }
    const found = await workspace();
    const settings = await updateWorkspaceSettings(database, {
      workspaceId: found.id,
      actor:
        caller.token === undefined
          ? { id: caller.person.id }
          : { id: caller.person.id, agent: caller.token.name },
      patch: parsed.data,
      now: clock.now(),
    });
    return c.json(workspaceOf(found, settings));
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
        clientOf(c),
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
