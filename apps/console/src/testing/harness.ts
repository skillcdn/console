import {
  AUTH_ROUTES,
  hostOfLogin,
  REST_ROUTES,
  type RestProject,
  type RestProjectInput,
  restMeSchema,
  restProjectSchema,
} from "@skillcdn/console/api";
import { formatAddress, parseAddress } from "@skillcdn/core";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { pino } from "pino";
import { drizzleOf } from "../db/client.js";
import { type EventListener, startEventListener } from "../db/listener.js";
import { findPerson } from "../db/queries/people.js";
import { createProject } from "../db/queries/projects.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { listings } from "../db/schema.js";
import type { TestDatabase } from "../db/testing.js";
import type { LiveFeed } from "../http/live-feed.js";
import type { Quotas } from "../http/quotas.js";
import type { AppEnv } from "../http/request-context.js";
import { restProject } from "../http/rest-shapes.js";
import type { BlobStore } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";
import type { OrganizationDirectory } from "../ports/organization.js";
import type { PictureSource } from "../ports/picture-source.js";
import type { PackConnector, PackSource } from "../ports/skill-source.js";
import { createApi } from "../roles/api.js";
import type { FixtureProvider } from "./fixture-provider.js";

// Test support: the `api` role wired to a test database, and to fixture providers when people
// are to sign in. Not compiled.

/** The origin of a harness where nobody signs in. */
export const BASE_URL = "http://console.test";
/** The origin of a harness where people can sign in: signing in wants one origin, and a secure one. */
export const SIGN_IN_URL = "https://console.test";
/** The console's version a harness runs as (ADR-0025), fixed so that the tests do not move with the package's. */
export const HARNESS_VERSION = "0.1.18";

export interface Harness {
  readonly app: Hono<AppEnv>;
  /** The origin requests are made to: {@link SIGN_IN_URL} where people can sign in. */
  readonly origin: string;
  /** Access-log lines and everything else the server logged, as parsed JSON. */
  readonly logs: Record<string, unknown>[];
  /** The subscribers of the feed, for a test to close or count. */
  readonly feed: LiveFeed;
  /** A request to the API; `peer` is the address it comes from, as a socket would carry it, none when left out. */
  request(path: string, init?: RequestInit, options?: RequestOptions): Promise<Response>;
  /**
   * Signs a person of a fixture provider in as their browser would, and answers with the Cookie
   * header that carries the session.
   */
  signIn(person: string): Promise<string>;
  /**
   * Makes a project for the person whose session the cookie carries, whatever their role,
   * written as an administrator's `POST /api/v1/projects` writes one (ADR-0045), and answers
   * it: what every test of the board needs first, without making everyone an administrator.
   */
  project(cookie: string, input: RestProjectInput): Promise<RestProject>;
  /** Ends the feed and the listener, for a harness that was given `live`. */
  close(): Promise<void>;
}

export interface RequestOptions {
  /** The address of the peer on the socket; without it, the console cannot tell where a request came from. */
  readonly peer?: string | undefined;
}

export interface HarnessOptions {
  /** The providers' side of signing in. Given, people can sign in; left out, nobody can. */
  readonly providers?: readonly FixtureProvider[];
  /** The Workspace domains the operator names. None when left out. */
  readonly domains?: readonly string[];
  /** The git host's organization the operator names, as the host answers for it. None when left out. */
  readonly organization?: OrganizationDirectory | undefined;
  /**
   * The logins an administrator let in and nobody signed in with yet, as rows of the database
   * (ADR-0022), made exactly so before the first sign-in: one of another harness on the same
   * database that nobody signed in with goes. The git host's three when left out; empty lets
   * nobody in but a domain's accounts and the administrators named.
   */
  readonly listed?: readonly string[];
  /** The logins the operator names administrators. Nobody when left out. */
  readonly admins?: readonly string[];
  /** The time everything is told; the system's when left out. */
  readonly clock?: Clock;
  readonly sessionTtlMs?: number;
  /** The most days a token may be good for, when the organization requires an expiry. */
  readonly tokenDaysAtMost?: number;
  /** Listen on the database's channel, so that the feed is woken as a deployment's is. */
  readonly live?: boolean;
  readonly feed?: { readonly heartbeatMs?: number; readonly pollMs?: number };
  /** How long an agent's `ask` waits for an answer. */
  readonly agents?: { readonly waitMs?: number };
  /** How much of the board a workspace, a project, a task or a person holds at once; the package's bounds where left out. */
  readonly quotas?: Partial<Quotas> | undefined;
  /** The organization's skills: their address, and the deployment's side of reading them. None when left out. */
  readonly skills?:
    | {
        readonly address: string;
        readonly source: PackSource;
        /** Where `local` addresses are read; none when left out. */
        readonly directory?: PackSource | undefined;
      }
    | undefined;
  /** Where the bytes of files go. The database when left out. */
  readonly blobs?: BlobStore | undefined;
  /** The deployment's side of connecting a pack with a code (ADR-0036). None when left out. */
  readonly packConnector?: PackConnector | undefined;
  /** Where a picture from elsewhere is fetched (ADR-0048). Over HTTPS when left out, which no test wants. */
  readonly pictures?: PictureSource | undefined;
}

/** The skills as the api role is configured with them, at a deployment of the tests' own. */
function skillsOf(skills: HarnessOptions["skills"]) {
  if (skills === undefined) {
    return undefined;
  }
  const parsed = parseAddress(skills.address);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return { source: "https://skillcdn.test", address: parsed.value };
}

/** The cookie a response set, as a Cookie header would carry it. */
export function cookieOf(response: Response, name: string): string {
  const found = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0] ?? "")
    .find((pair) => pair.split("=")[0]?.endsWith(name) === true);
  if (found === undefined) {
    throw new Error(`the response set no ${name} cookie`);
  }
  return found;
}

export function createHarness(testDatabase: TestDatabase, options: HarnessOptions = {}): Harness {
  const logs: Record<string, unknown>[] = [];
  const providers = options.providers ?? [];
  const origin = providers.length === 0 ? BASE_URL : SIGN_IN_URL;
  const logger = pino(
    { level: "info" },
    { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
  );
  const { app, feed } = createApi(
    {
      workspace: { name: "Acme" },
      http: {
        trustedProxies: [],
        clientIpHeader: "x-forwarded-for",
        requestIdHeader: "x-request-id",
        accessLog: true,
      },
      feed: options.feed,
      agents: options.agents,
      quotas: options.quotas,
      skills: skillsOf(options.skills),
      ...(providers.length === 0
        ? {}
        : {
            auth: {
              publicUrl: origin,
              secret: "a secret for tests, long enough to be one",
              admins: options.admins ?? [],
              domains: options.domains ?? [],
              sessionTtlMs: options.sessionTtlMs ?? 30 * 86_400_000,
              tokenDaysAtMost: options.tokenDaysAtMost,
            },
          }),
    },
    {
      database: testDatabase.database,
      providers,
      organization: options.organization,
      clock: options.clock ?? { now: () => new Date() },
      logger,
      isShuttingDown: () => false,
      skillSource: options.skills?.source,
      packDirectory: options.skills?.directory,
      packConnector: options.packConnector,
      pictures: options.pictures,
      blobs: options.blobs,
      version: HARNESS_VERSION,
    },
  );
  const listener: EventListener | undefined =
    options.live === true
      ? startEventListener({
          connectionString: testDatabase.connectionString,
          logger,
          onNudge: () => feed.nudge(),
        })
      : undefined;
  /** The listings an administrator would have made, written once, before the first request. */
  let seeded: Promise<void> | undefined;
  const seed = (): Promise<void> => {
    seeded ??= (async () => {
      const workspace = await ensureWorkspace(testDatabase.database, {
        name: "Acme",
        now: new Date(),
      });
      const logins = options.listed ?? ["alice", "bob", "carol"];
      const handle = drizzleOf(testDatabase.database);
      await handle.delete(listings).where(
        and(
          eq(listings.workspaceId, workspace.id),
          isNull(listings.personId),
          notInArray(
            sql`lower(${listings.login})`,
            logins.map((login) => login.toLowerCase()),
          ),
        ),
      );
      for (const login of logins) {
        await handle
          .insert(listings)
          .values({ workspaceId: workspace.id, host: hostOfLogin(login), login, personId: null })
          .onConflictDoNothing();
      }
    })();
    return seeded;
  };
  const request = async (path: string, init?: RequestInit, options?: RequestOptions) => {
    if (providers.length > 0) {
      await seed();
    }
    const env =
      options?.peer === undefined
        ? undefined
        : { incoming: { socket: { remoteAddress: options.peer } } };
    return app.fetch(new Request(`${origin}${path}`, init), env);
  };
  return {
    app,
    origin,
    logs,
    feed,
    request,
    async signIn(person) {
      const provider = providers.find((candidate) => candidate.people[person] !== undefined);
      if (provider === undefined) {
        throw new Error(`nobody called ${person} can sign in on this harness`);
      }
      const begun = await request(AUTH_ROUTES.login(provider.key));
      const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
      const done = await request(
        `${AUTH_ROUTES.callback(provider.key)}?code=${provider.codeFor(person, state)}&state=${state}`,
        { headers: { cookie: cookieOf(begun, "console_login") } },
      );
      return cookieOf(done, "console_session");
    },
    async project(cookie, input) {
      const me = await request(REST_ROUTES.me, { headers: { cookie } });
      const { person } = restMeSchema.parse(await me.json());
      if (person === null) {
        throw new Error("the cookie carries nobody's session");
      }
      const workspace = await ensureWorkspace(testDatabase.database, {
        name: "Acme",
        now: new Date(),
      });
      const owner = await findPerson(testDatabase.database, workspace.id, person.id);
      if (owner === undefined) {
        throw new Error(`nobody of the workspace has the id ${person.id}`);
      }
      let skillsAddress: string | null = null;
      if (typeof input.skillsAddress === "string") {
        const parsed = parseAddress(input.skillsAddress);
        if (!parsed.ok) {
          throw new Error(parsed.error.message);
        }
        skillsAddress = formatAddress(parsed.value);
      }
      const made = await createProject(testDatabase.database, {
        workspaceId: workspace.id,
        actor: { id: owner.id },
        person: owner,
        project: { ...input, skillsAddress },
        now: (options.clock ?? { now: () => new Date() }).now(),
      });
      return restProjectSchema.parse(restProject(made));
    },
    async close() {
      feed.close();
      await listener?.close();
    },
  };
}
