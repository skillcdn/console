import { AUTH_ROUTES } from "@skillcdn/console/api";
import type { Hono } from "hono";
import { pino } from "pino";
import { type EventListener, startEventListener } from "../db/listener.js";
import type { TestDatabase } from "../db/testing.js";
import type { LiveFeed } from "../http/live-feed.js";
import type { AppEnv } from "../http/request-context.js";
import type { Clock } from "../ports/clock.js";
import { createApi } from "../roles/api.js";
import type { FixtureProvider } from "./fixture-provider.js";

// Test support: the `api` role wired to a test database, and to fixture providers when people
// are to sign in. Not compiled.

/** The origin of a harness where nobody signs in. */
export const BASE_URL = "http://console.test";
/** The origin of a harness where people can sign in: signing in wants one origin, and a secure one. */
export const SIGN_IN_URL = "https://console.test";

export interface Harness {
  readonly app: Hono<AppEnv>;
  /** The origin requests are made to: {@link SIGN_IN_URL} where people can sign in. */
  readonly origin: string;
  /** Access-log lines and everything else the server logged, as parsed JSON. */
  readonly logs: Record<string, unknown>[];
  /** The subscribers of the feed, for a test to close or count. */
  readonly feed: LiveFeed;
  request(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Signs a person of a fixture provider in as their browser would, and answers with the Cookie
   * header that carries the session.
   */
  signIn(person: string): Promise<string>;
  /** Ends the feed and the listener, for a harness that was given `live`. */
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** The providers' side of signing in. Given, people can sign in; left out, nobody can. */
  readonly providers?: readonly FixtureProvider[];
  /** The Workspace domains the operator names. None when left out. */
  readonly domains?: readonly string[];
  /** The logins the operator lists. Everyone of the fixture when left out. */
  readonly members?: readonly string[];
  /** The logins the operator names administrators. Nobody when left out. */
  readonly admins?: readonly string[];
  /** The time everything is told; the system's when left out. */
  readonly clock?: Clock;
  readonly sessionTtlMs?: number;
  /** Listen on the database's channel, so that the feed is woken as a deployment's is. */
  readonly live?: boolean;
  readonly feed?: { readonly heartbeatMs?: number; readonly pollMs?: number };
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
      ...(providers.length === 0
        ? {}
        : {
            auth: {
              publicUrl: origin,
              secret: "a secret for tests, long enough to be one",
              members: options.members ?? ["alice", "bob", "carol"],
              admins: options.admins ?? [],
              domains: options.domains ?? [],
              sessionTtlMs: options.sessionTtlMs ?? 30 * 86_400_000,
            },
          }),
    },
    {
      database: testDatabase.database,
      providers,
      clock: options.clock ?? { now: () => new Date() },
      logger,
      isShuttingDown: () => false,
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
  const request = async (path: string, init?: RequestInit) =>
    app.fetch(new Request(`${origin}${path}`, init));
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
    async close() {
      feed.close();
      await listener?.close();
    },
  };
}
