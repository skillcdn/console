import type { SecretAccess } from "@skillcdn/console/api";
import { and, asc, count, desc, eq, lt } from "drizzle-orm";
import type { Secrets } from "../../auth/secrets.js";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { agentSecretAccesses, agentSecrets, people } from "../schema.js";
import type { Actor } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// An agent account's secret store (ADR-0087): named values, sealed with the console's key, which
// the account alone reads back. A supervisor seeds one, write-only, and removes one. Every time
// a secret is set, read or removed is written on the account's record, with who did it, and the
// name, never the value. The value is opened here and nowhere else, and is never logged.

/** What is wrong with what was asked of a secret. `code` is what the API answers with. */
export class SecretError extends DomainError {
  constructor(code: "secret.not_found" | "secret.too_many" | "secret.unreadable") {
    super(code, SECRET_ERROR_WORDS[code]);
  }
}

const SECRET_ERROR_WORDS = {
  "secret.not_found": "the account keeps no secret of that name",
  "secret.too_many": "the account keeps as many secrets as one may",
  "secret.unreadable":
    "the value cannot be opened with this deployment's key; it is set again by whoever has it",
} as const;

/** A secret as its listing says it: never its value. */
export interface SecretRecord {
  readonly name: string;
  /** The day the value ends on, where it is known to (`2027-11-10`); none otherwise. */
  readonly expiresOn: string | undefined;
  /** Whether a supervisor set it, where the account did otherwise. */
  readonly seeded: boolean;
  readonly setAt: Date;
}

/** One line of the account's record of its store. */
export interface SecretAccessRecord {
  readonly id: number;
  readonly name: string;
  readonly action: SecretAccess;
  /** Who did it; nobody for one whose account is gone. */
  readonly by: PersonRecord | undefined;
  /** The agent they did it through, when they acted with a token. */
  readonly agent: string | undefined;
  readonly seeded: boolean;
  readonly at: Date;
}

const columns = {
  name: agentSecrets.name,
  expiresOn: agentSecrets.expiresOn,
  seeded: agentSecrets.seeded,
  setAt: agentSecrets.setAt,
};

const toRecord = (row: {
  readonly name: string;
  readonly expiresOn: string | null;
  readonly seeded: boolean;
  readonly setAt: Date;
}): SecretRecord => ({
  name: row.name,
  expiresOn: row.expiresOn ?? undefined,
  seeded: row.seeded,
  setAt: row.setAt,
});

/** What is sealed: the value with the account and the name it is for, so that a row moved to another opens for nobody. */
const sealedFor = (accountId: string, name: string, value: string): string =>
  JSON.stringify({ a: accountId, n: name, v: value });

/** The value a sealed row holds, when it was sealed for this account and this name under this key. */
function opened(
  secrets: Secrets,
  accountId: string,
  name: string,
  sealed: string,
): string | undefined {
  const text = secrets.open("agent-secret", sealed);
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      "a" in parsed &&
      parsed.a === accountId &&
      "n" in parsed &&
      parsed.n === name &&
      "v" in parsed &&
      typeof parsed.v === "string"
      ? parsed.v
      : undefined;
  } catch {
    return undefined;
  }
}

async function note(
  tx: Transaction,
  access: {
    readonly accountId: string;
    readonly name: string;
    readonly action: SecretAccess;
    readonly actor: Actor;
    readonly seeded: boolean;
    readonly now: Date;
  },
): Promise<void> {
  await tx.insert(agentSecretAccesses).values({
    personId: access.accountId,
    name: access.name,
    action: access.action,
    actorId: access.actor.id,
    agent: access.actor.agent ?? null,
    seeded: access.seeded,
    createdAt: access.now,
  });
}

/** The names of the account's secrets, with when each was set, by name: no value, and nothing noted. */
export async function listSecrets(database: Database, accountId: string): Promise<SecretRecord[]> {
  const rows = await drizzleOf(database)
    .select(columns)
    .from(agentSecrets)
    .where(eq(agentSecrets.personId, accountId))
    .orderBy(asc(agentSecrets.name));
  return rows.map(toRecord);
}

/**
 * Sets a secret, a new one or over the one there was, and notes it on the account's record:
 * by the account itself, or seeded by a supervisor. An account keeps a bounded number.
 */
export async function setSecret(
  database: Database,
  secrets: Secrets,
  input: {
    readonly accountId: string;
    readonly name: string;
    readonly value: string;
    /** The day the value ends on, or null for none. */
    readonly expiresOn: string | null;
    readonly actor: Actor;
    /** Whether a supervisor sets it, where the account does otherwise. */
    readonly seeded: boolean;
    readonly limit: number;
    readonly now: Date;
  },
): Promise<SecretRecord> {
  const { accountId, name, actor, seeded, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    // The account's row, so that two secrets set at once cannot both be the last one allowed.
    await tx.select({ id: people.id }).from(people).where(eq(people.id, accountId)).for("update");
    const [held] = await tx
      .select({ count: count() })
      .from(agentSecrets)
      .where(eq(agentSecrets.personId, accountId));
    const [there] = await tx
      .select({ name: agentSecrets.name })
      .from(agentSecrets)
      .where(and(eq(agentSecrets.personId, accountId), eq(agentSecrets.name, name)))
      .limit(1);
    if (there === undefined && (held?.count ?? 0) >= input.limit) {
      throw new SecretError("secret.too_many");
    }
    const written = {
      sealed: secrets.seal("agent-secret", sealedFor(accountId, name, input.value)),
      expiresOn: input.expiresOn,
      seeded,
      setById: actor.id,
      setAt: now,
      // A value set anew has a day of its own to be told of.
      warnedOn: null,
    };
    const [row] = await tx
      .insert(agentSecrets)
      .values({ personId: accountId, name, ...written, createdAt: now })
      .onConflictDoUpdate({ target: [agentSecrets.personId, agentSecrets.name], set: written })
      .returning(columns);
    if (row === undefined) {
      throw new Error("secret upsert returned no row");
    }
    await note(tx, { accountId, name, action: "set", actor, seeded, now });
    return toRecord(row);
  });
}

/**
 * The value of a secret, for the account itself, and the reading noted on its record. A value
 * this deployment's key does not open, or one sealed for another account or name, is
 * `secret.unreadable`, and nothing is read.
 */
export async function readSecret(
  database: Database,
  secrets: Secrets,
  input: {
    readonly accountId: string;
    readonly name: string;
    readonly actor: Actor;
    readonly now: Date;
  },
): Promise<SecretRecord & { readonly value: string }> {
  const { accountId, name, actor, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .select({ ...columns, sealed: agentSecrets.sealed })
      .from(agentSecrets)
      .where(and(eq(agentSecrets.personId, accountId), eq(agentSecrets.name, name)))
      .limit(1);
    if (row === undefined) {
      throw new SecretError("secret.not_found");
    }
    const value = opened(secrets, accountId, name, row.sealed);
    if (value === undefined) {
      throw new SecretError("secret.unreadable");
    }
    await note(tx, { accountId, name, action: "read", actor, seeded: row.seeded, now });
    return { ...toRecord(row), value };
  });
}

/** Removes a secret, and notes it on the account's record; `secret.not_found` for one that is not there. */
export async function removeSecret(
  database: Database,
  input: {
    readonly accountId: string;
    readonly name: string;
    readonly actor: Actor;
    /** Whether a supervisor removes it, where the account does otherwise. */
    readonly seeded: boolean;
    readonly now: Date;
  },
): Promise<void> {
  const { accountId, name, actor, seeded, now } = input;
  await drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .delete(agentSecrets)
      .where(and(eq(agentSecrets.personId, accountId), eq(agentSecrets.name, name)))
      .returning({ name: agentSecrets.name });
    if (row === undefined) {
      throw new SecretError("secret.not_found");
    }
    await note(tx, { accountId, name, action: "removed", actor, seeded, now });
  });
}

/** The account's record of its store, the newest first: a page of it, from before `before` on. */
export async function listSecretAccesses(
  database: Database,
  accountId: string,
  page: { readonly before: number | undefined; readonly limit: number },
): Promise<{ readonly items: SecretAccessRecord[]; readonly more: boolean }> {
  const rows = await drizzleOf(database)
    .select({
      id: agentSecretAccesses.id,
      name: agentSecretAccesses.name,
      action: agentSecretAccesses.action,
      agent: agentSecretAccesses.agent,
      seeded: agentSecretAccesses.seeded,
      createdAt: agentSecretAccesses.createdAt,
      by: personColumns(people),
    })
    .from(agentSecretAccesses)
    .leftJoin(people, eq(people.id, agentSecretAccesses.actorId))
    .where(
      and(
        eq(agentSecretAccesses.personId, accountId),
        page.before === undefined ? undefined : lt(agentSecretAccesses.id, page.before),
      ),
    )
    .orderBy(desc(agentSecretAccesses.id))
    .limit(page.limit + 1);
  return {
    items: rows.slice(0, page.limit).map((row) => ({
      id: row.id,
      name: row.name,
      action: row.action,
      by: row.by === null ? undefined : toPerson(row.by),
      agent: row.agent ?? undefined,
      seeded: row.seeded,
      at: row.createdAt,
    })),
    more: rows.length > page.limit,
  };
}
