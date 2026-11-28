import {
  BOARD_PARTS_FROM,
  compareVersions,
  parseVersion,
  type SecretOfferState,
  wakeTextOf,
} from "@skillcdn/console/api";
import { and, count, desc, eq, gt, inArray, lte, ne, notInArray, sql } from "drizzle-orm";
import type { Secrets } from "../../auth/secrets.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { agentRunners, agentSecretOffers, people } from "../schema.js";
import { keepSecret, lockStore, SecretError, type SecretRecord } from "./agent-secrets.js";
import type { Actor } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The secrets a member offers an agent account (ADR-0169): a value sealed at once and kept apart
// from the account's store, which nothing uses and nobody is answered, until the account takes
// it into its store itself or leaves it, or its days run out. Only an offer that waits holds a
// value: one taken, left or run out keeps its line of the account's record, the name, who
// offered it and how it ended, and the value is gone from it. A value is opened here once, to be
// sealed again for the store, and is never logged.

/** A secret offered to an account, as its listing says it: never its value. */
export interface SecretOfferRecord {
  readonly id: string;
  /** The name the offerer proposed. */
  readonly name: string;
  /** What the offerer said it is for, in a line; none where they said nothing. */
  readonly note: string | undefined;
  /** Who offered it; nobody for one whose account is gone. */
  readonly by: PersonRecord | undefined;
  /** The agent they offered it through, when they acted with a token. */
  readonly agent: string | undefined;
  /** The day the value ends on, where the offerer said. */
  readonly expiresOn: string | undefined;
  readonly state: SecretOfferState;
  readonly at: Date;
  /** Until when it waits. */
  readonly endsAt: Date;
  /** When the account took or left it, or its days ran out; none while it waits. */
  readonly decidedAt: Date | undefined;
  /** The name the account keeps it under, once taken. */
  readonly takenAs: string | undefined;
}

const columns = {
  id: agentSecretOffers.id,
  name: agentSecretOffers.name,
  note: agentSecretOffers.note,
  agent: agentSecretOffers.agent,
  expiresOn: agentSecretOffers.expiresOn,
  state: agentSecretOffers.state,
  takenAs: agentSecretOffers.takenAs,
  endsAt: agentSecretOffers.endsAt,
  decidedAt: agentSecretOffers.decidedAt,
  createdAt: agentSecretOffers.createdAt,
  by: personColumns(people),
};

/**
 * A row as its listing says it at a moment. An offer whose days ran out and which no pass has
 * ended yet reads as run out already, at the moment it did, so that a reading writes nothing
 * and says the same as the next one will.
 */
function toRecord(
  row: {
    readonly id: string;
    readonly name: string;
    readonly note: string | null;
    readonly agent: string | null;
    readonly expiresOn: string | null;
    readonly state: SecretOfferState;
    readonly takenAs: string | null;
    readonly endsAt: Date;
    readonly decidedAt: Date | null;
    readonly createdAt: Date;
    readonly by: Parameters<typeof toPerson>[0] | null;
  },
  now: Date,
): SecretOfferRecord {
  const ranOut = row.state === "waiting" && row.endsAt.getTime() <= now.getTime();
  return {
    id: row.id,
    name: row.name,
    note: row.note ?? undefined,
    by: row.by === null ? undefined : toPerson(row.by),
    agent: row.agent ?? undefined,
    expiresOn: row.expiresOn ?? undefined,
    state: ranOut ? "lapsed" : row.state,
    at: row.createdAt,
    endsAt: row.endsAt,
    decidedAt: ranOut ? row.endsAt : (row.decidedAt ?? undefined),
    takenAs: row.takenAs ?? undefined,
  };
}

/** What is sealed: the value with the account and the offer it is of, so that a row moved to another, or into the store, opens for nobody. */
const sealedFor = (accountId: string, offerId: string, value: string): string =>
  JSON.stringify({ a: accountId, o: offerId, v: value });

/** The value a sealed offer holds, when it was sealed for this account and this offer under this key. */
function opened(
  secrets: Secrets,
  accountId: string,
  offerId: string,
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
      "o" in parsed &&
      parsed.o === offerId &&
      "v" in parsed &&
      typeof parsed.v === "string"
      ? parsed.v
      : undefined;
  } catch {
    return undefined;
  }
}

/** What ends an offer whose days ran out: its value gone, and the moment it ran out at. */
const RAN_OUT = {
  state: "lapsed",
  sealed: null,
  decidedAt: sql`${agentSecretOffers.endsAt}`,
} as const;

/** Ends the offers of one account whose days ran out, in a transaction that holds the account's row. */
async function lapse(tx: Transaction, accountId: string, now: Date): Promise<void> {
  await tx
    .update(agentSecretOffers)
    .set(RAN_OUT)
    .where(
      and(
        eq(agentSecretOffers.personId, accountId),
        eq(agentSecretOffers.state, "waiting"),
        lte(agentSecretOffers.endsAt, now),
      ),
    );
}

/**
 * Ends every offer of a workspace's accounts whose days ran out, the worker's pass: the value
 * is gone from the row from then on, whoever reads the listing or does not. How many it ended.
 */
export async function lapseSecretOffers(
  database: Database,
  workspaceId: string,
  now: Date,
): Promise<number> {
  const db = drizzleOf(database);
  const ended = await db
    .update(agentSecretOffers)
    .set(RAN_OUT)
    .where(
      and(
        eq(agentSecretOffers.state, "waiting"),
        lte(agentSecretOffers.endsAt, now),
        inArray(
          agentSecretOffers.personId,
          db.select({ id: people.id }).from(people).where(eq(people.workspaceId, workspaceId)),
        ),
      ),
    )
    .returning({ id: agentSecretOffers.id });
  return ended.length;
}

async function found(
  tx: Transaction,
  offerId: string,
  now: Date,
): Promise<SecretOfferRecord | undefined> {
  const [row] = await tx
    .select(columns)
    .from(agentSecretOffers)
    .leftJoin(people, eq(people.id, agentSecretOffers.offeredById))
    .where(eq(agentSecretOffers.id, offerId))
    .limit(1);
  return row === undefined ? undefined : toRecord(row, now);
}

/**
 * Keeps a secret offered to an account: the value sealed at once, for the account and this
 * offer, and nothing of the account's store touched. An account has a bounded number of offers
 * waiting, and a bounded number of them from one member: one more is refused,
 * `secret.too_many_offers`. What no longer waits is kept as the account's record of what it
 * was offered, the latest `kept` of it.
 */
export async function offerSecret(
  database: Database,
  secrets: Secrets,
  input: {
    readonly accountId: string;
    readonly name: string;
    readonly value: string;
    /** What it is for, in a line, or null for nothing said. */
    readonly note: string | null;
    /** The day the value ends on, or null for none. */
    readonly expiresOn: string | null;
    /** Who offers it, and the agent they offer it through. */
    readonly actor: Actor;
    /** How many offers wait for one account at once, and how many of them one member's. */
    readonly waiting: number;
    readonly byOne: number;
    /** For how many days it waits. */
    readonly days: number;
    /** How many offers that no longer wait the account's record keeps. */
    readonly kept: number;
    readonly now: Date;
  },
): Promise<SecretOfferRecord> {
  const { accountId, actor, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    // The account's row, so that two offers made at once cannot both be the last one allowed.
    await lockStore(tx, accountId);
    await lapse(tx, accountId, now);
    const waits = and(
      eq(agentSecretOffers.personId, accountId),
      eq(agentSecretOffers.state, "waiting"),
    );
    const [all] = await tx.select({ count: count() }).from(agentSecretOffers).where(waits);
    const [theirs] = await tx
      .select({ count: count() })
      .from(agentSecretOffers)
      .where(and(waits, eq(agentSecretOffers.offeredById, actor.id)));
    if ((all?.count ?? 0) >= input.waiting || (theirs?.count ?? 0) >= input.byOne) {
      throw new SecretError("secret.too_many_offers");
    }
    // The offer's id before its row, since the value is sealed for it.
    const made = await tx.execute<{ id: string }>(sql`select uuidv7() as id`);
    const id = made.rows[0]?.id;
    if (id === undefined) {
      throw new Error("no id was made for the offer");
    }
    await tx.insert(agentSecretOffers).values({
      id,
      personId: accountId,
      name: input.name,
      sealed: secrets.seal("agent-secret", sealedFor(accountId, id, input.value)),
      note: input.note,
      expiresOn: input.expiresOn,
      offeredById: actor.id,
      agent: actor.agent ?? null,
      state: "waiting",
      endsAt: new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000),
      createdAt: now,
    });
    // The record of what no longer waits is bounded: its oldest lines go first.
    const latest = tx
      .select({ id: agentSecretOffers.id })
      .from(agentSecretOffers)
      .where(and(eq(agentSecretOffers.personId, accountId), ne(agentSecretOffers.state, "waiting")))
      .orderBy(desc(agentSecretOffers.createdAt), desc(agentSecretOffers.id))
      .limit(input.kept);
    await tx
      .delete(agentSecretOffers)
      .where(
        and(
          eq(agentSecretOffers.personId, accountId),
          ne(agentSecretOffers.state, "waiting"),
          notInArray(agentSecretOffers.id, latest),
        ),
      );
    const offer = await found(tx, id, now);
    if (offer === undefined) {
      throw new Error("the offer written was not found");
    }
    return offer;
  });
}

/**
 * What an account was offered, the newest first, and never a value: the offers that wait
 * (`waiting`), which is what the account itself reads, or its record of them whole, for a
 * supervisor; with `by`, those of one member alone, which is what that member may read of an
 * account they do not supervise. Nothing is written by a reading.
 */
export async function listSecretOffers(
  database: Database,
  accountId: string,
  which: {
    readonly waiting: boolean;
    readonly by?: string | undefined;
    readonly limit: number;
    readonly now: Date;
  },
): Promise<SecretOfferRecord[]> {
  const rows = await drizzleOf(database)
    .select(columns)
    .from(agentSecretOffers)
    .leftJoin(people, eq(people.id, agentSecretOffers.offeredById))
    .where(
      and(
        eq(agentSecretOffers.personId, accountId),
        which.waiting
          ? and(eq(agentSecretOffers.state, "waiting"), gt(agentSecretOffers.endsAt, which.now))
          : undefined,
        which.by === undefined ? undefined : eq(agentSecretOffers.offeredById, which.by),
      ),
    )
    .orderBy(desc(agentSecretOffers.createdAt), desc(agentSecretOffers.id))
    .limit(which.limit);
  return rows.map((row) => toRecord(row, which.now));
}

/**
 * The account takes an offer that waits for it: the value moves into its store, under the name
 * offered or another, as a secret the account set itself, and is gone from the offer in the
 * same transaction. Where the account keeps a secret of that name already it is refused,
 * `secret.exists`, unless the account says the value takes its place (`replace`). An offer that
 * is not the account's, or no longer waits, is `secret.offer_not_found`; a value this
 * deployment's key does not open is `secret.unreadable`, and the offer stays as it was.
 */
export async function takeSecretOffer(
  database: Database,
  secrets: Secrets,
  input: {
    readonly accountId: string;
    readonly offerId: string;
    /** The name to keep it under, where another than the one offered. */
    readonly as: string | undefined;
    readonly replace: boolean;
    /** The account itself. */
    readonly actor: Actor;
    /** How many secrets an account keeps. */
    readonly limit: number;
    readonly now: Date;
  },
): Promise<{ readonly secret: SecretRecord; readonly offer: SecretOfferRecord }> {
  const { accountId, offerId, actor, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    await lockStore(tx, accountId);
    await lapse(tx, accountId, now);
    const [row] = await tx
      .select({
        name: agentSecretOffers.name,
        sealed: agentSecretOffers.sealed,
        expiresOn: agentSecretOffers.expiresOn,
      })
      .from(agentSecretOffers)
      .where(
        and(
          eq(agentSecretOffers.id, offerId),
          eq(agentSecretOffers.personId, accountId),
          eq(agentSecretOffers.state, "waiting"),
        ),
      )
      .for("update");
    if (row === undefined || row.sealed === null) {
      throw new SecretError("secret.offer_not_found");
    }
    const value = opened(secrets, accountId, offerId, row.sealed);
    if (value === undefined) {
      throw new SecretError("secret.unreadable");
    }
    const name = input.as ?? row.name;
    const secret = await keepSecret(tx, secrets, {
      accountId,
      name,
      value,
      expiresOn: row.expiresOn,
      actor,
      // The account takes it itself: no supervisor set it.
      seeded: false,
      limit: input.limit,
      fresh: !input.replace,
      now,
    });
    await tx
      .update(agentSecretOffers)
      .set({ state: "taken", sealed: null, takenAs: name, decidedAt: now })
      .where(eq(agentSecretOffers.id, offerId));
    const offer = await found(tx, offerId, now);
    if (offer === undefined) {
      throw new Error("the offer taken was not found");
    }
    return { secret, offer };
  });
}

/** The account leaves an offer that waits for it: the value is gone, and the offer's line says it was left. */
export async function leaveSecretOffer(
  database: Database,
  input: { readonly accountId: string; readonly offerId: string; readonly now: Date },
): Promise<SecretOfferRecord> {
  const { accountId, offerId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    await lockStore(tx, accountId);
    await lapse(tx, accountId, now);
    const [left] = await tx
      .update(agentSecretOffers)
      .set({ state: "left", sealed: null, decidedAt: now })
      .where(
        and(
          eq(agentSecretOffers.id, offerId),
          eq(agentSecretOffers.personId, accountId),
          eq(agentSecretOffers.state, "waiting"),
        ),
      )
      .returning({ id: agentSecretOffers.id });
    if (left === undefined) {
      throw new SecretError("secret.offer_not_found");
    }
    const offer = await found(tx, offerId, now);
    if (offer === undefined) {
      throw new Error("the offer left was not found");
    }
    return offer;
  });
}

/**
 * Whether an account's runner reads a wake of the console's in parts (ADR-0166, ADR-0169): the
 * console's lines under the session's mark, and what a member wrote in a block. A runner of
 * before prints the text whole as the console's own words, so what the offerer wrote is sent
 * only to an account whose runner last said a version from the one that does on.
 */
export async function readsWakesInParts(database: Database, accountId: string): Promise<boolean> {
  const from = parseVersion(BOARD_PARTS_FROM);
  const [row] = await drizzleOf(database)
    .select({ runner: agentRunners.runner })
    .from(agentRunners)
    .where(eq(agentRunners.personId, accountId))
    .limit(1);
  const said = row?.runner ?? undefined;
  const version = said === undefined ? undefined : parseVersion(said);
  return from !== undefined && version !== undefined && compareVersions(version, from) >= 0;
}

/** A member as a wake of the console's names them: by what they are found by, a login or a handle, never by a name they chose. */
function known(person: PersonRecord): string {
  const by = (person.kind === "agent" ? person.handle : undefined) ?? person.login;
  return `@${by.replaceAll(/[\s[\]]+/g, "")}`;
}

/**
 * What the wake of an offer says (ADR-0169): who offers, under which name, and the commands that
 * take it and leave it. Never the value. What the offerer wrote of it is their words and not the
 * console's: it is carried, in a part of its own, only where the account's runner reads a wake
 * in parts (`inParts`), and is left to the account's listing otherwise.
 */
export function secretOfferWake(
  offer: SecretOfferRecord,
  by: PersonRecord,
  inParts: boolean,
): string {
  const who = by.kind === "agent" ? `The agent account ${known(by)}` : known(by);
  const offers = `${who} offers you a secret, under the name ${offer.name}`;
  const yours = `It is yours to take or to leave. Take it: console secret --accept ${offer.id} (with --as <name>, under a name of your own). Leave it: console secret --decline ${offer.id}. It waits until ${offer.endsAt.toISOString().slice(0, 16)}Z.`;
  if (offer.note === undefined) {
    return `${offers}. ${yours}`;
  }
  if (!inParts) {
    return `${offers}. ${yours} What they say it is for: console secrets --offered`;
  }
  return wakeTextOf([
    { says: `${offers}, and says of it` },
    { words: offer.note },
    { says: yours },
  ]);
}
