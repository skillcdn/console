import { randomInt } from "node:crypto";
import { CONNECT_CODE_ALPHABET, CONNECT_CODE_LENGTH } from "@skillcdn/console/api";
import type { Database } from "../db/client.js";
import {
  approveConnectRequest,
  type ConnectRequestRecord,
  claimConnectRequest,
  createConnectRequest,
  deleteConnectRequest,
  findConnectRequest,
} from "../db/queries/connect.js";
import { findPerson, type PersonRecord } from "../db/queries/people.js";
import type { TokenRecord } from "../db/queries/tokens.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { hashToken, newToken } from "./secrets.js";
import type { Tokens } from "./tokens.js";

// Connecting an agent without a token to copy (ADR-0011): the command asks as nobody and gets
// a code for a person and a secret for itself; the person approves on the console's own pages;
// the command claims the token with its secret, and the token is made then and handed over
// once. The database holds the hash of the secret and never a token.

/** What the command's secret begins with, so that whoever finds one knows what it found. */
export const CONNECT_SECRET_PREFIX = "cns_c_";
/** How long a person has to approve. */
const REQUEST_TTL_MS = 10 * 60_000;
/** How many seconds the command waits between claims. */
const CLAIM_INTERVAL_SECONDS = 3;
/** How many requests a workspace holds at once: an unauthenticated route is bounded. */
const MAX_WAITING = 100;
const DAY_MS = 86_400_000;
const GROUP = CONNECT_CODE_LENGTH / 2;

/** A code as the alphabet spells one: two groups, from the system's randomness. */
function newCode(): string {
  const letters = Array.from(
    { length: CONNECT_CODE_LENGTH },
    () => CONNECT_CODE_ALPHABET[randomInt(CONNECT_CODE_ALPHABET.length)] ?? "A",
  ).join("");
  return `${letters.slice(0, GROUP)}-${letters.slice(GROUP)}`;
}

/** PostgreSQL's word for a row that would repeat a unique key. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505";

/** What the command is answered when it begins. */
export interface Connection {
  readonly code: string;
  /** The console's own page for the code, for a person to open. */
  readonly url: string;
  readonly secret: string;
  readonly expiresAt: Date;
  readonly interval: number;
}

/** What the command is answered when it claims: wait, or the token this once. */
export type ClaimAnswer =
  | { readonly status: "pending"; readonly expiresAt: Date }
  | { readonly status: "connected"; readonly token: TokenRecord; readonly secret: string };

export interface ConnectionsOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly tokens: Tokens;
  readonly workspaceId: () => Promise<string>;
  /** The console's own page for a code: what the command shows and a person opens. */
  readonly pageFor: (code: string) => string;
}

export class Connections {
  readonly #options: ConnectionsOptions;

  constructor(options: ConnectionsOptions) {
    this.#options = options;
  }

  /** Begins a connection for an agent that says what it calls itself and where it runs. */
  async begin(agent: string): Promise<Connection> {
    const { database, clock, pageFor } = this.#options;
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
    const secret = newToken(CONNECT_SECRET_PREFIX);
    const workspaceId = await this.#options.workspaceId();
    // A code a live request holds already fails the insert; the space is large, so another try is enough.
    for (let attempt = 0; ; attempt += 1) {
      const code = newCode();
      try {
        const made = await createConnectRequest(database, {
          workspaceId,
          code,
          secretHash: hashToken(secret),
          agent,
          expiresAt,
          now,
          limit: MAX_WAITING,
        });
        return {
          code: made.code,
          url: pageFor(made.code),
          secret,
          expiresAt: made.expiresAt,
          interval: CLAIM_INTERVAL_SECONDS,
        };
      } catch (error) {
        if (attempt < 2 && isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /** What asks to connect under a code, for the person who approves it, or nothing. */
  async look(code: string): Promise<ConnectRequestRecord | undefined> {
    const { database, clock } = this.#options;
    return findConnectRequest(database, await this.#options.workspaceId(), code, clock.now());
  }

  /**
   * Notes that the person approves: the agent will act as them, under the name given, for the
   * days given or without end. Nothing for a code no live request has.
   */
  async approve(
    code: string,
    person: PersonRecord,
    input: { readonly name: string; readonly days: number | undefined },
  ): Promise<ConnectRequestRecord | undefined> {
    const { database, clock, logger } = this.#options;
    const approved = await approveConnectRequest(database, {
      workspaceId: person.workspaceId,
      code,
      personId: person.id,
      name: input.name,
      tokenDays: input.days,
      now: clock.now(),
    });
    if (approved !== undefined) {
      logger.info({ person: person.id, code }, "a connection was approved");
    }
    return approved;
  }

  /** The person says the request is not theirs: it goes. True when there was one. */
  async deny(code: string): Promise<boolean> {
    const { database, clock } = this.#options;
    return deleteConnectRequest(database, await this.#options.workspaceId(), code, clock.now());
  }

  /**
   * What the command gets for its secret: wait while nobody approved; the token this once, made
   * now for the approver as any token is; nothing for a secret no live request has.
   */
  async claim(secret: string): Promise<ClaimAnswer | undefined> {
    if (!secret.startsWith(CONNECT_SECRET_PREFIX)) {
      return undefined;
    }
    const { database, clock, logger, tokens } = this.#options;
    const claim = await claimConnectRequest(database, hashToken(secret), clock.now());
    if (claim === undefined || claim.status === "pending") {
      return claim;
    }
    const person = await findPerson(database, await this.#options.workspaceId(), claim.personId);
    if (person === undefined) {
      return undefined;
    }
    const made = await tokens.issue(person, {
      name: claim.name,
      ttlMs: claim.tokenDays === undefined ? undefined : claim.tokenDays * DAY_MS,
    });
    logger.info({ person: person.id, tokenId: made.token.id }, "an agent connected");
    return { status: "connected", token: made.token, secret: made.secret };
  }
}
