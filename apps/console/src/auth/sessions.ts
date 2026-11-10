import type { SessionKind } from "@skillcdn/console/api";
import type { Database } from "../db/client.js";
import type { PersonRecord } from "../db/queries/people.js";
import {
  createSession,
  deleteOtherSessionsOf,
  deleteSession,
  deleteSessionById,
  deleteSessionOf,
  findSession,
  listSessionsOf,
  type SessionRow,
  touchSession,
} from "../db/queries/sessions.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { hashToken, newToken } from "./secrets.js";
import { readBearer } from "./tokens.js";

// Where a member is signed in. A browser's cookie holds a random token and the database its
// hash, so the `api` role keeps no session of its own and any replica answers any request. The
// member sees each of theirs, what it is, where it last came from and when it was last used,
// and ends any of them (board #309). The command signed in as the account itself (ADR-0084)
// holds a session too: kept while it is used and ended when left unused, as a browser's is, and
// presented in the authorization header as a token is, so that it is held to what a token may
// ask. Neither kind is ever read as the other.

/** How often a session in use is noted as used, and its end moved: not on every request. */
const TOUCH_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
/** How much of what a browser calls itself is kept: a line, whatever a header may carry. */
const MAX_USER_AGENT_LENGTH = 512;
const COOKIE_NAME = "console_session";
/** What a session token begins with, so that whoever finds one knows what it found. */
export const SESSION_TOKEN_PREFIX = "cns_s_";
/** What the secret of a command's session begins with: the account's own sign-in on a machine. */
export const COMMAND_SESSION_PREFIX = "cns_a_";

/** What a request says of the browser it comes from, noted on the session it begins or uses. */
export interface SessionClient {
  readonly userAgent: string | undefined;
  /** The client's address as the server saw it, behind a trusted proxy or not (deploy/README.md). */
  readonly address: string | undefined;
}

/** One of a person's sessions as they see it: never the token, nor its hash. */
export interface SessionView {
  readonly id: string;
  /** Whether it is the session the request was made on. */
  readonly current: boolean;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly address: string | null;
  /** What holds it: a browser, or the command signed in as the account itself. */
  readonly kind: SessionKind;
  /** For the command's: what it called itself when it signed in; null for a browser's. */
  readonly name: string | null;
}

/** The command's session a request was made on: what the request is attributed by, and what it gives up when it signs out. */
export interface CommandSession {
  readonly id: string;
  /** What the command called itself when it signed in, and where it runs. */
  readonly name: string;
}

const viewOf = (row: SessionRow, current: boolean): SessionView => ({
  id: row.id,
  current,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  expiresAt: row.expiresAt,
  userAgent: row.userAgent,
  address: row.address,
  kind: row.kind,
  name: row.name,
});

/** The value of the cookie `name` in a Cookie header, or nothing. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (header === null || header === undefined) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length === 0 ? undefined : value;
    }
  }
  return undefined;
}

/**
 * A Set-Cookie value for a cookie only this server reads: not for scripts, not for other sites'
 * requests, and only over TLS when the deployment is served over it. A `maxAgeSeconds` of zero
 * takes the cookie away.
 */
export function writeCookie(
  name: string,
  value: string,
  options: { readonly path: string; readonly maxAgeSeconds: number; readonly secure: boolean },
): string {
  return [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

export interface SessionsOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How long a session lasts without being used. */
  readonly ttlMs: number;
  /** Whether the deployment is served over TLS, which is what the cookie is then bound to. */
  readonly secure: boolean;
}

export class Sessions {
  readonly #options: SessionsOptions;
  /** With the `__Host-` prefix a browser only accepts the cookie from this very host, over TLS. */
  readonly #cookie: string;

  constructor(options: SessionsOptions) {
    this.#options = options;
    this.#cookie = options.secure ? `__Host-${COOKIE_NAME}` : COOKIE_NAME;
  }

  /** How many days a session lasts without being used, for the person's page to say. */
  get idleDays(): number {
    return Math.max(1, Math.round(this.#options.ttlMs / DAY_MS));
  }

  /** Starts a session for the person, from the browser the request names, and answers with the cookie that carries it. */
  async start(person: PersonRecord, client: SessionClient): Promise<string> {
    const { database, clock, ttlMs, secure } = this.#options;
    const token = newToken(SESSION_TOKEN_PREFIX);
    const now = clock.now();
    await createSession(database, {
      personId: person.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + ttlMs),
      now,
      userAgent:
        client.userAgent === undefined ? null : client.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
      address: client.address ?? null,
    });
    return writeCookie(this.#cookie, token, {
      path: "/",
      maxAgeSeconds: Math.floor(ttlMs / 1000),
      secure,
    });
  }

  /**
   * Signs the command in as the account itself (ADR-0084): a session of the command's, which it
   * presents as a token is presented, and its secret, this once. Kept while it is used and ended
   * when left unused, as a browser's is.
   */
  async startCommand(
    person: PersonRecord,
    name: string,
    client: SessionClient,
  ): Promise<{ readonly session: SessionView; readonly secret: string }> {
    const { database, clock, ttlMs } = this.#options;
    const secret = newToken(COMMAND_SESSION_PREFIX);
    const now = clock.now();
    const row = await createSession(database, {
      personId: person.id,
      tokenHash: hashToken(secret),
      expiresAt: new Date(now.getTime() + ttlMs),
      now,
      userAgent:
        client.userAgent === undefined ? null : client.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
      address: client.address ?? null,
      kind: "command",
      name,
    });
    return { session: viewOf(row, false), secret };
  }

  /**
   * Who the request's authorization header says is signed in with a command's session, or
   * nobody: the account, and the session, by which the command gives it up when it signs out.
   */
  async resolveCommand(
    authorizationHeader: string | null | undefined,
    client: SessionClient,
  ): Promise<{ readonly person: PersonRecord; readonly command: CommandSession } | undefined> {
    const secret = readBearer(authorizationHeader);
    if (secret === undefined || !secret.startsWith(COMMAND_SESSION_PREFIX)) {
      return undefined;
    }
    const session = await this.#find(hashToken(secret), "command", client);
    return session === undefined
      ? undefined
      : { person: session.person, command: { id: session.id, name: session.name ?? "" } };
  }

  /** Who the request's cookie says is signed in, or nobody. */
  async resolve(
    cookieHeader: string | null | undefined,
    client: SessionClient,
  ): Promise<PersonRecord | undefined> {
    const token = readCookie(cookieHeader, this.#cookie);
    if (token === undefined) {
      return undefined;
    }
    return (await this.#find(hashToken(token), "browser", client))?.person;
  }

  /** The live session of one kind a token's hash names, noted as used when it has not been for a while. */
  async #find(tokenHash: string, kind: SessionKind, client: SessionClient) {
    const { database, clock, ttlMs, logger } = this.#options;
    const now = clock.now();
    const session = await findSession(database, tokenHash, now, kind);
    if (session === undefined) {
      return undefined;
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      // A session lives as long as it is used, and is noted as used from where. The answer
      // does not wait for the note.
      touchSession(database, session.id, {
        now,
        expiresAt: new Date(now.getTime() + ttlMs),
        address: client.address ?? session.address,
      }).catch((error: unknown) => {
        logger.warn({ err: error }, "a session could not be noted as used");
      });
    }
    return session;
  }

  /** The command's session ends: what `console logout` does of one. True when it was there. */
  endCommand(command: CommandSession): Promise<boolean> {
    return deleteSessionById(this.#options.database, command.id);
  }

  /** The person's live sessions: the one the request was made on first, then the last used first. */
  async list(
    person: PersonRecord,
    cookieHeader: string | null | undefined,
  ): Promise<SessionView[]> {
    const current = this.#hashOf(cookieHeader);
    const rows = await listSessionsOf(this.#options.database, person.id, this.#options.clock.now());
    return rows
      .map((row) => viewOf(row, row.tokenHash === current))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) ||
          b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
  }

  /** A member's live sessions as another reads them, the last used first: none is the reader's own. */
  async listOf(person: PersonRecord): Promise<SessionView[]> {
    const rows = await listSessionsOf(this.#options.database, person.id, this.#options.clock.now());
    return rows.map((row) => viewOf(row, false));
  }

  /**
   * Ends one of the person's sessions by its id: whether it was there, and whether it was the
   * one the request was made on, whose cookie the caller then takes away.
   */
  async endOne(
    person: PersonRecord,
    sessionId: string,
    cookieHeader: string | null | undefined,
  ): Promise<{ readonly ended: boolean; readonly current: boolean }> {
    const ended = await deleteSessionOf(
      this.#options.database,
      person.id,
      sessionId,
      this.#options.clock.now(),
    );
    return {
      ended: ended !== undefined,
      current: ended !== undefined && ended === this.#hashOf(cookieHeader),
    };
  }

  /** Ends every session of the person but the one the request was made on; how many went. */
  async endOthers(person: PersonRecord, cookieHeader: string | null | undefined): Promise<number> {
    return deleteOtherSessionsOf(this.#options.database, person.id, this.#hashOf(cookieHeader));
  }

  /** Ends the session the cookie names, and answers with the cookie that takes it away. */
  async end(cookieHeader: string | null | undefined): Promise<string> {
    const token = readCookie(cookieHeader, this.#cookie);
    if (token !== undefined) {
      await deleteSession(this.#options.database, hashToken(token));
    }
    return this.clear();
  }

  /** The cookie that takes a session away from the browser, whatever it was. */
  clear(): string {
    return writeCookie(this.#cookie, "", {
      path: "/",
      maxAgeSeconds: 0,
      secure: this.#options.secure,
    });
  }

  /** The hash of the token the request's cookie carries, which is what the table knows a session by. */
  #hashOf(cookieHeader: string | null | undefined): string | undefined {
    const token = readCookie(cookieHeader, this.#cookie);
    return token === undefined ? undefined : hashToken(token);
  }
}
