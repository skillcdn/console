import { DEFAULT_TOKEN_DAYS } from "@skillcdn/console/api";
import type { Database } from "../db/client.js";
import type { PersonRecord } from "../db/queries/people.js";
import {
  createToken,
  deleteToken,
  findToken,
  listTokensOf,
  TokenError,
  type TokenRecord,
  touchToken,
} from "../db/queries/tokens.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { hashToken, newToken } from "./secrets.js";

// The tokens people make for their agents, scripts and consoles of their own (ADR-0004). One is
// presented as `Authorization: Bearer`; the database holds its hash, so the `api` role keeps
// nothing of it and any replica answers any request. The secret is answered once, when the
// token is made, and never again.

/** What a token begins with, so that whoever finds one knows what it found. */
export const AGENT_TOKEN_PREFIX = "cns_t_";
/** How often a token in use is noted as used: not on every request. */
const TOUCH_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

/** The token of a `Bearer` authorization header, or nothing. */
export function readBearer(header: string | null | undefined): string | undefined {
  if (header === null || header === undefined) {
    return undefined;
  }
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match?.[1];
}

export interface TokensOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How many live tokens one person may hold. */
  readonly limit: number;
  /** The most days a token may be good for, when the organization requires an expiry; else nothing. */
  readonly daysAtMost?: number | undefined;
}

export class Tokens {
  readonly #options: TokensOptions;

  constructor(options: TokensOptions) {
    this.#options = options;
  }

  /** The most days a token may be good for here, or nothing when a person chooses. */
  get daysAtMost(): number | undefined {
    return this.#options.daysAtMost;
  }

  /**
   * How many days a token asked for is good: the default when nothing is said, none for
   * `null`, within what the organization requires, or refused.
   */
  daysOf(expiresInDays: number | null | undefined): number | undefined {
    const days = expiresInDays === null ? undefined : (expiresInDays ?? DEFAULT_TOKEN_DAYS);
    const atMost = this.#options.daysAtMost;
    if (atMost !== undefined && (days === undefined || days > atMost)) {
      throw new TokenError("token.expiry_at_most", atMost);
    }
    return days;
  }

  /** Makes a token for the person and answers with it and the secret, this once. */
  async issue(
    person: PersonRecord,
    input: {
      readonly name: string;
      /** How long it is good for. Left out, it does not expire. */
      readonly ttlMs: number | undefined;
    },
  ): Promise<{ readonly token: TokenRecord; readonly secret: string }> {
    const { database, clock, limit, daysAtMost } = this.#options;
    if (
      daysAtMost !== undefined &&
      (input.ttlMs === undefined || input.ttlMs > daysAtMost * DAY_MS)
    ) {
      throw new TokenError("token.expiry_at_most", daysAtMost);
    }
    const secret = newToken(AGENT_TOKEN_PREFIX);
    const now = clock.now();
    const token = await createToken(database, {
      personId: person.id,
      name: input.name,
      tokenHash: hashToken(secret),
      expiresAt: input.ttlMs === undefined ? undefined : new Date(now.getTime() + input.ttlMs),
      now,
      limit,
    });
    return { token, secret };
  }

  /** Who the request's authorization header says is asking, or nobody. */
  async resolve(
    authorizationHeader: string | null | undefined,
  ): Promise<{ readonly person: PersonRecord; readonly token: TokenRecord } | undefined> {
    const secret = readBearer(authorizationHeader);
    if (secret === undefined || !secret.startsWith(AGENT_TOKEN_PREFIX)) {
      return undefined;
    }
    const { database, clock, logger } = this.#options;
    const now = clock.now();
    const found = await findToken(database, hashToken(secret), now);
    if (found === undefined) {
      return undefined;
    }
    const lastUsed = found.token.lastUsedAt;
    if (lastUsed === undefined || now.getTime() - lastUsed.getTime() >= TOUCH_INTERVAL_MS) {
      // The answer does not wait for the note.
      touchToken(database, found.token.id, now).catch((error: unknown) => {
        logger.warn({ err: error }, "a token could not be noted as used");
      });
    }
    return found;
  }

  /** The person's live tokens, newest first. */
  list(person: PersonRecord): Promise<TokenRecord[]> {
    const { database, clock } = this.#options;
    return listTokensOf(database, person.id, clock.now());
  }

  /** Takes one of the person's tokens away. False when it was not theirs, or not there. */
  revoke(person: PersonRecord, tokenId: string): Promise<boolean> {
    return deleteToken(this.#options.database, person.id, tokenId);
  }
}
