import { AUTH_ROUTES } from "@skillcdn/console/api";
import type { Hono } from "hono";
import { pino } from "pino";
import type { TestDatabase } from "../db/testing.js";
import type { AppEnv } from "../http/request-context.js";
import type { Clock } from "../ports/clock.js";
import { createApi } from "../roles/api.js";
import type { FixtureLogin } from "./fixture-login.js";

// Test support: the `api` role wired to a test database, and to a fixture git host when people
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
  request(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Signs a person of the fixture login in as their browser would, and answers with the Cookie
   * header that carries the session.
   */
  signIn(person: string): Promise<string>;
}

export interface HarnessOptions {
  /** The git host's side of signing in. Given, people can sign in; left out, nobody can. */
  readonly login?: FixtureLogin;
  /** The logins the operator lists. Everyone of the fixture when left out. */
  readonly members?: readonly string[];
  /** The time everything is told; the system's when left out. */
  readonly clock?: Clock;
  readonly sessionTtlMs?: number;
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
  const origin = options.login === undefined ? BASE_URL : SIGN_IN_URL;
  const { app } = createApi(
    {
      workspace: { name: "Acme" },
      http: {
        trustedProxies: [],
        clientIpHeader: "x-forwarded-for",
        requestIdHeader: "x-request-id",
        accessLog: true,
      },
      ...(options.login === undefined
        ? {}
        : {
            auth: {
              publicUrl: origin,
              secret: "a secret for tests, long enough to be one",
              members: options.members ?? ["alice", "bob", "carol"],
              sessionTtlMs: options.sessionTtlMs ?? 30 * 86_400_000,
            },
          }),
    },
    {
      database: testDatabase.database,
      login: options.login,
      clock: options.clock ?? { now: () => new Date() },
      logger: pino(
        { level: "info" },
        { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      ),
      isShuttingDown: () => false,
    },
  );
  const request = async (path: string, init?: RequestInit) =>
    app.fetch(new Request(`${origin}${path}`, init));
  return {
    app,
    origin,
    logs,
    request,
    async signIn(person) {
      const { login } = options;
      if (login === undefined) {
        throw new Error("nobody can sign in on this harness");
      }
      const begun = await request(AUTH_ROUTES.login);
      const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
      const done = await request(
        `${AUTH_ROUTES.callback}?code=${login.codeFor(person, state)}&state=${state}`,
        { headers: { cookie: cookieOf(begun, "console_login") } },
      );
      return cookieOf(done, "console_session");
    },
  };
}
