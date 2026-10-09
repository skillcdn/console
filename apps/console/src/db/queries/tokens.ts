import { and, count, desc, eq, gt, lte } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf } from "../client.js";
import { people, tokens } from "../schema.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The tokens people made for their agents, scripts and consoles of their own. The holder
// presents the secret and the database holds its hash, as with sessions, so that any replica
// answers any request. A token is its person until it expires or is taken away.

export interface TokenRecord {
  readonly id: string;
  readonly personId: string;
  /** What the person calls it: the agent it is for, where it runs. */
  readonly name: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** When it was last presented, if ever. */
  readonly lastUsedAt: Date | undefined;
}

/** What is wrong with a token a person asked for. `code` is what the API answers with. */
export class TokenError extends DomainError {
  constructor(code: "token.not_found" | "token.too_many") {
    super(
      code,
      code === "token.not_found"
        ? "the token was not found"
        : "the person holds as many tokens as one may",
    );
  }
}

const tokenColumns = {
  id: tokens.id,
  personId: tokens.personId,
  name: tokens.name,
  createdAt: tokens.createdAt,
  expiresAt: tokens.expiresAt,
  lastUsedAt: tokens.lastUsedAt,
};

interface TokenRow {
  readonly id: string;
  readonly personId: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
}

const toToken = (row: TokenRow): TokenRecord => ({
  id: row.id,
  personId: row.personId,
  name: row.name,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt ?? undefined,
});

/**
 * Writes a token down for a person, unless they hold as many as one may. The count and the
 * insert happen under the lock on the person's row, so that two made at once cannot both be
 * the last one allowed.
 */
export async function createToken(
  database: Database,
  token: {
    readonly personId: string;
    readonly name: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
    /** How many live tokens the person may hold, this one included. */
    readonly limit: number;
  },
): Promise<TokenRecord> {
  return drizzleOf(database).transaction(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, token.personId))
      .for("update");
    if (person === undefined) {
      throw new Error("the person was not found");
    }
    const [held] = await tx
      .select({ count: count() })
      .from(tokens)
      .where(and(eq(tokens.personId, token.personId), gt(tokens.expiresAt, token.now)));
    if ((held?.count ?? 0) >= token.limit) {
      throw new TokenError("token.too_many");
    }
    const [row] = await tx
      .insert(tokens)
      .values({
        personId: token.personId,
        name: token.name,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        createdAt: token.now,
      })
      .returning(tokenColumns);
    if (row === undefined) {
      throw new Error("token insert returned no row");
    }
    return toToken(row);
  });
}

/** The token a hash names, with its person, while it has not expired. */
export async function findToken(
  database: Database,
  tokenHash: string,
  now: Date,
): Promise<{ readonly token: TokenRecord; readonly person: PersonRecord } | undefined> {
  const [row] = await drizzleOf(database)
    .select({ token: tokenColumns, person: personColumns(people) })
    .from(tokens)
    .innerJoin(people, eq(people.id, tokens.personId))
    .where(and(eq(tokens.tokenHash, tokenHash), gt(tokens.expiresAt, now)))
    .limit(1);
  return row === undefined
    ? undefined
    : { token: toToken(row.token), person: toPerson(row.person) };
}

/** Notes that a token was presented. */
export async function touchToken(database: Database, tokenId: string, now: Date): Promise<void> {
  await drizzleOf(database).update(tokens).set({ lastUsedAt: now }).where(eq(tokens.id, tokenId));
}

/** The live tokens of a person, newest first. */
export async function listTokensOf(
  database: Database,
  personId: string,
  now: Date,
): Promise<TokenRecord[]> {
  const rows = await drizzleOf(database)
    .select(tokenColumns)
    .from(tokens)
    .where(and(eq(tokens.personId, personId), gt(tokens.expiresAt, now)))
    .orderBy(desc(tokens.createdAt), desc(tokens.id));
  return rows.map(toToken);
}

/** Takes a token away. True when it was the person's and there. */
export async function deleteToken(
  database: Database,
  personId: string,
  tokenId: string,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(tokens)
    .where(and(eq(tokens.id, tokenId), eq(tokens.personId, personId)))
    .returning({ id: tokens.id });
  return rows.length > 0;
}

/** Removes what time has ended; every read checks the time itself, so this only keeps the table small. */
export async function deleteExpiredTokens(database: Database, now: Date): Promise<number> {
  const rows = await drizzleOf(database)
    .delete(tokens)
    .where(lte(tokens.expiresAt, now))
    .returning({ id: tokens.id });
  return rows.length;
}
