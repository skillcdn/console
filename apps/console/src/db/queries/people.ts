import type {
  MembershipSource,
  PersonRole,
  PersonStatus,
  ProviderKey,
} from "@skillcdn/console/api";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { listings, people, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";

// The people of the workspace: everyone who signed in through an identity provider and was let
// in, and the logins an administrator let in that nobody has signed in with yet (ADR-0022).
// Identity data: every query names the person, or the workspace they are all in.

export interface PersonRecord {
  readonly id: string;
  readonly workspaceId: string;
  /** The identity provider, and its immutable id of the account: what a person is known by. */
  readonly host: ProviderKey;
  readonly hostAccountId: string;
  readonly login: string;
  readonly name: string | undefined;
  readonly avatarUrl: string | undefined;
  /** An administrator configures the board, a member works on it. */
  readonly role: PersonRole;
  /** Whether they are in; a deactivated person is kept and refused. */
  readonly status: PersonStatus;
  /** What let them in at their last sign-in. */
  readonly source: MembershipSource;
  readonly deactivatedAt: Date | undefined;
}

/** What is wrong with a change to a person. `code` is what the API answers with. */
export class PersonError extends DomainError {
  constructor(code: "person.not_found" | "person.last_admin" | "person.of_organization") {
    super(
      code,
      code === "person.not_found"
        ? "the person was not found"
        : code === "person.last_admin"
          ? "the board would be left without an administrator"
          : "the organization says who is in; the person cannot be changed here",
    );
  }
}

/** What is wrong with a listing. `code` is what the API answers with. */
export class ListingError extends DomainError {
  constructor(code: "listing.not_found" | "listing.exists") {
    super(
      code,
      code === "listing.not_found"
        ? "the listing was not found"
        : "the login is let in already, or is a member's",
    );
  }
}

/** A person as their provider told it at sign-in: what is written down about them. */
export interface HostAccount {
  readonly hostAccountId: string;
  readonly login: string;
  readonly name: string | undefined;
  readonly avatarUrl: string | undefined;
}

/** A login an administrator let in, bound to the person once someone signed in with it. */
export interface ListingRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: ProviderKey;
  readonly login: string;
  readonly personId: string | undefined;
  readonly createdAt: Date;
}

/** The `people` table, or an alias of it joined under another name. */
interface PersonTable {
  readonly id: AnyPgColumn;
  readonly workspaceId: AnyPgColumn;
  readonly host: AnyPgColumn;
  readonly hostAccountId: AnyPgColumn;
  readonly login: AnyPgColumn;
  readonly name: AnyPgColumn;
  readonly avatarUrl: AnyPgColumn;
  readonly role: AnyPgColumn;
  readonly status: AnyPgColumn;
  readonly source: AnyPgColumn;
  readonly deactivatedAt: AnyPgColumn;
}

/** For this directory only: the columns a {@link PersonRecord} is made of, from `table`. */
export const personColumns = <T extends PersonTable>(
  table: T,
): { [Column in keyof PersonTable]: T[Column] } => ({
  id: table.id,
  workspaceId: table.workspaceId,
  host: table.host,
  hostAccountId: table.hostAccountId,
  login: table.login,
  name: table.name,
  avatarUrl: table.avatarUrl,
  role: table.role,
  status: table.status,
  source: table.source,
  deactivatedAt: table.deactivatedAt,
});

type PersonRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: string;
  readonly hostAccountId: string;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly role: string;
  readonly status: string;
  readonly source: string;
  readonly deactivatedAt: Date | null;
};

export const toPerson = (row: PersonRow): PersonRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  host: row.host as ProviderKey,
  hostAccountId: row.hostAccountId,
  login: row.login,
  name: row.name ?? undefined,
  avatarUrl: row.avatarUrl ?? undefined,
  role: row.role as PersonRole,
  status: row.status as PersonStatus,
  source: row.source as MembershipSource,
  deactivatedAt: row.deactivatedAt ?? undefined,
});

const listingColumns = {
  id: listings.id,
  workspaceId: listings.workspaceId,
  host: listings.host,
  login: listings.login,
  personId: listings.personId,
  createdAt: listings.createdAt,
};

const toListing = (row: {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: string;
  readonly login: string;
  readonly personId: string | null;
  readonly createdAt: Date;
}): ListingRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  host: row.host as ProviderKey,
  login: row.login,
  personId: row.personId ?? undefined,
  createdAt: row.createdAt,
});

/** Tables joined for the owner and the assignee of a task, the raiser of a decision. */
export const owners = alias(people, "owners");
export const assignees = alias(people, "assignees");
export const raisers = alias(people, "raisers");
export const answerers = alias(people, "answerers");
export const actors = alias(people, "actors");

/** Logins are compared as the hosts compare them: without regard to case. */
const sameLogin = (column: AnyPgColumn, login: string) => sql`lower(${column}) = lower(${login})`;

/**
 * The listing that admits an account signing in, or nothing: one bound to this very account,
 * whatever it is called now, else one nobody has signed in with that is spelled as the
 * account's login. A listing bound to another account admits nobody else: a login the host let
 * someone else take is not theirs here.
 */
export async function findListingFor(
  database: Database,
  workspaceId: string,
  host: ProviderKey,
  account: { readonly accountId: string; readonly login: string },
): Promise<ListingRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(listingColumns)
    .from(listings)
    .leftJoin(people, eq(people.id, listings.personId))
    .where(
      and(
        eq(listings.workspaceId, workspaceId),
        eq(listings.host, host),
        or(
          eq(people.hostAccountId, account.accountId),
          and(isNull(listings.personId), sameLogin(listings.login, account.login)),
        ),
      ),
    )
    // A listing bound to the account before one merely spelled as its login.
    .orderBy(asc(sql`${listings.personId} is null`))
    .limit(1);
  return row === undefined ? undefined : toListing(row);
}

/**
 * Binds the listing the person came in on to them, or lists them when the operator's own
 * naming let them in: from then on the listing is theirs, under whatever login they carry.
 */
async function bindListing(
  tx: Transaction,
  person: PersonRecord,
  listing: ListingRecord | undefined,
): Promise<void> {
  if (listing !== undefined) {
    if (listing.personId === undefined) {
      await tx
        .update(listings)
        .set({ personId: person.id })
        .where(and(eq(listings.id, listing.id), isNull(listings.personId)));
    }
    return;
  }
  const [bound] = await tx
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.personId, person.id))
    .limit(1);
  if (bound !== undefined) {
    return;
  }
  await tx
    .insert(listings)
    .values({
      workspaceId: person.workspaceId,
      host: person.host,
      login: person.login,
      personId: person.id,
      listedById: null,
    })
    .onConflictDoNothing();
}

/**
 * Records that a person signed in: keyed by the provider's immutable id, so a renamed account
 * stays the same person, with the login, the name and the picture as the provider says now, and
 * what let them in this time. The first time is a joining, which the board is told about. A
 * `role` given is written; left out, a person keeps what they are, and a new one is a member.
 * A listing the person came in on is bound to them. A person deactivated by an administrator
 * stays out while their domain is what admits them (`"deactivated"`, and nothing is written);
 * one a listing admits again is reactivated, since an administrator listed them again.
 */
export async function savePerson(
  database: Database,
  login: {
    readonly workspaceId: string;
    readonly host: ProviderKey;
    readonly account: HostAccount;
    readonly role?: PersonRole | undefined;
    readonly source: MembershipSource;
    readonly listing?: ListingRecord | undefined;
    readonly now: Date;
  },
): Promise<{ readonly person: PersonRecord; readonly joined: boolean } | "deactivated"> {
  const { workspaceId, host, account, role, source, listing, now } = login;
  return drizzleOf(database).transaction(async (tx) => {
    const [before] = await tx
      .select({ status: people.status })
      .from(people)
      .where(
        and(
          eq(people.workspaceId, workspaceId),
          eq(people.host, host),
          eq(people.hostAccountId, account.hostAccountId),
        ),
      )
      .for("update");
    const reactivated = before?.status === "deactivated";
    if (reactivated && source === "domain") {
      return "deactivated";
    }
    const [row] = await tx
      .insert(people)
      .values({
        workspaceId,
        host,
        hostAccountId: account.hostAccountId,
        login: account.login,
        name: account.name ?? null,
        avatarUrl: account.avatarUrl ?? null,
        role: role ?? "member",
        source,
        lastLoginAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [people.workspaceId, people.host, people.hostAccountId],
        set: {
          login: account.login,
          name: account.name ?? null,
          avatarUrl: account.avatarUrl ?? null,
          ...(role === undefined ? {} : { role }),
          source,
          status: "active",
          deactivatedAt: null,
          lastLoginAt: now,
          updatedAt: now,
        },
      })
      .returning({
        ...personColumns(people),
        // A row an upsert inserted has no transaction that ever updated it.
        inserted: sql<boolean>`(xmax = 0)`,
      });
    if (row === undefined) {
      throw new Error("person upsert returned no row");
    }
    const person = toPerson(row);
    if (source === "listed") {
      await bindListing(tx, person, listing);
    }
    if (row.inserted) {
      await recordEvent(tx, {
        workspaceId,
        kind: "person.joined",
        actor: { id: person.id },
        data: {},
        now,
      });
    } else if (reactivated) {
      await recordEvent(tx, {
        workspaceId,
        kind: "person.reactivated",
        actor: undefined,
        data: { login: person.login },
        now,
      });
    }
    return { person, joined: row.inserted };
  });
}

export async function findPerson(
  database: Database,
  workspaceId: string,
  personId: string,
): Promise<PersonRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(personColumns(people))
    .from(people)
    .where(and(eq(people.workspaceId, workspaceId), eq(people.id, personId)))
    .limit(1);
  return row === undefined ? undefined : toPerson(row);
}

/** The person as the transaction sees them, under the lock on the workspace row. */
async function lockedPerson(
  tx: Transaction,
  workspaceId: string,
  personId: string,
): Promise<PersonRecord> {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update");
  const [current] = await tx
    .select(personColumns(people))
    .from(people)
    .where(and(eq(people.workspaceId, workspaceId), eq(people.id, personId)))
    .limit(1);
  if (current === undefined) {
    throw new PersonError("person.not_found");
  }
  return toPerson(current);
}

/** Whether taking this administrator away, or out, would leave the board without one in. */
async function lastAdministrator(
  tx: Transaction,
  workspaceId: string,
  person: PersonRecord,
): Promise<boolean> {
  if (person.role !== "admin" || person.status !== "active") {
    return false;
  }
  const [admins] = await tx
    .select({ count: count() })
    .from(people)
    .where(
      and(
        eq(people.workspaceId, workspaceId),
        eq(people.role, "admin"),
        eq(people.status, "active"),
      ),
    );
  return (admins?.count ?? 0) <= 1;
}

/**
 * Says what a person is and tells the board. The board keeps at least one administrator in: the
 * count is taken under the lock on the workspace row, so that two changes at once cannot both
 * take the last one away. A change to what is already so writes nothing.
 */
export async function updatePersonRole(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly personId: string;
    readonly role: PersonRole;
    readonly now: Date;
  },
): Promise<PersonRecord> {
  const { workspaceId, actor, personId, role, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const person = await lockedPerson(tx, workspaceId, personId);
    if (person.role === role) {
      return person;
    }
    if (await lastAdministrator(tx, workspaceId, person)) {
      throw new PersonError("person.last_admin");
    }
    const [row] = await tx
      .update(people)
      .set({ role, updatedAt: now })
      .where(eq(people.id, personId))
      .returning(personColumns(people));
    if (row === undefined) {
      throw new PersonError("person.not_found");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "person.role_changed",
      actor,
      data: { login: person.login, role },
      now,
    });
    return toPerson(row);
  });
}

/**
 * Takes a person out, or back in, and tells the board (ADR-0022). Only a person the domain or
 * a listing let in: one the organization let in comes and goes with it. Deactivating takes the
 * listing they came in on away, so that signing in again admits nobody; reactivating lists them
 * again. The board keeps at least one administrator in. What is already so writes nothing.
 */
export async function updatePersonStatus(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly personId: string;
    readonly status: PersonStatus;
    readonly now: Date;
  },
): Promise<PersonRecord> {
  const { workspaceId, actor, personId, status, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const person = await lockedPerson(tx, workspaceId, personId);
    if (person.source === "organization") {
      throw new PersonError("person.of_organization");
    }
    if (person.status === status) {
      return person;
    }
    if (status === "deactivated") {
      if (await lastAdministrator(tx, workspaceId, person)) {
        throw new PersonError("person.last_admin");
      }
      await tx.delete(listings).where(eq(listings.personId, personId));
    }
    const [row] = await tx
      .update(people)
      .set({
        status,
        deactivatedAt: status === "deactivated" ? now : null,
        updatedAt: now,
      })
      .where(eq(people.id, personId))
      .returning(personColumns(people));
    if (row === undefined) {
      throw new PersonError("person.not_found");
    }
    const changed = toPerson(row);
    if (status === "active" && changed.source === "listed") {
      // Listed again, under the login they carry: an unbound listing spelled so is theirs now.
      const [spelled] = await tx
        .update(listings)
        .set({ personId })
        .where(
          and(
            eq(listings.workspaceId, workspaceId),
            eq(listings.host, changed.host),
            isNull(listings.personId),
            sameLogin(listings.login, changed.login),
          ),
        )
        .returning({ id: listings.id });
      if (spelled === undefined) {
        await tx.insert(listings).values({
          workspaceId,
          host: changed.host,
          login: changed.login,
          personId,
          listedById: actor.id,
        });
      }
    }
    await recordEvent(tx, {
      workspaceId,
      kind: status === "deactivated" ? "person.deactivated" : "person.reactivated",
      actor,
      data: { login: person.login },
      now,
    });
    return changed;
  });
}

/** The language the person chose for the pages, or nothing. */
export async function languageOf(
  database: Database,
  personId: string,
): Promise<string | undefined> {
  const [row] = await drizzleOf(database)
    .select({ language: people.language })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  return row?.language ?? undefined;
}

/** Keeps the person's choice of language, or none. */
export async function setLanguage(
  database: Database,
  personId: string,
  language: string | undefined,
  now: Date,
): Promise<void> {
  await drizzleOf(database)
    .update(people)
    .set({ language: language ?? null, updatedAt: now })
    .where(eq(people.id, personId));
}

/** Everyone of the workspace, those in first, by login. */
export async function listPeople(database: Database, workspaceId: string): Promise<PersonRecord[]> {
  const rows = await drizzleOf(database)
    .select(personColumns(people))
    .from(people)
    .where(eq(people.workspaceId, workspaceId))
    .orderBy(asc(people.status), asc(sql`lower(${people.login})`), asc(people.id));
  return rows.map(toPerson);
}

/** The logins let in that nobody has signed in with yet, by login. */
export async function listListings(
  database: Database,
  workspaceId: string,
): Promise<ListingRecord[]> {
  const rows = await drizzleOf(database)
    .select(listingColumns)
    .from(listings)
    .where(and(eq(listings.workspaceId, workspaceId), isNull(listings.personId)))
    .orderBy(asc(sql`lower(${listings.login})`), asc(listings.id));
  return rows.map(toListing);
}

/**
 * Lets a login in and tells the board: whoever signs in with that account at that host becomes
 * a person. A login listed already, or one an active person signs in as, is `listing.exists`:
 * a person in needs no listing, and one out is reactivated instead.
 */
export async function createListing(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly host: ProviderKey;
    readonly login: string;
    readonly now: Date;
  },
): Promise<ListingRecord> {
  const { workspaceId, actor, host, login, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    const [listed] = await tx
      .select({ id: listings.id })
      .from(listings)
      .where(
        and(
          eq(listings.workspaceId, workspaceId),
          eq(listings.host, host),
          sameLogin(listings.login, login),
        ),
      )
      .limit(1);
    if (listed !== undefined) {
      throw new ListingError("listing.exists");
    }
    const [member] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.workspaceId, workspaceId),
          eq(people.host, host),
          eq(people.status, "active"),
          sameLogin(people.login, login),
        ),
      )
      .limit(1);
    if (member !== undefined) {
      throw new ListingError("listing.exists");
    }
    const [row] = await tx
      .insert(listings)
      .values({ workspaceId, host, login, personId: null, listedById: actor.id })
      .returning(listingColumns);
    if (row === undefined) {
      throw new Error("listing insert returned no row");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "person.listed",
      actor,
      data: { login },
      now,
    });
    return toListing(row);
  });
}

/**
 * Takes a listing away before anyone signed in with it, and tells the board. One somebody
 * signed in with is the person's, and goes with their deactivation, not here.
 */
export async function deleteListing(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly listingId: string;
    readonly now: Date;
  },
): Promise<void> {
  const { workspaceId, actor, listingId, now } = input;
  await drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .delete(listings)
      .where(
        and(
          eq(listings.workspaceId, workspaceId),
          eq(listings.id, listingId),
          isNull(listings.personId),
        ),
      )
      .returning({ login: listings.login });
    if (row === undefined) {
      throw new ListingError("listing.not_found");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "person.unlisted",
      actor,
      data: { login: row.login },
      now,
    });
  });
}
