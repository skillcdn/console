import type { PersonRole, ProviderKey } from "@skillcdn/console/api";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf } from "../client.js";
import { people, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";

// The people of the workspace: everyone who signed in through an identity provider and was let in.
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
}

/** What is wrong with a change to a person. `code` is what the API answers with. */
export class PersonError extends DomainError {
  constructor(code: "person.not_found" | "person.last_admin") {
    super(
      code,
      code === "person.not_found"
        ? "the person was not found"
        : "the board would be left without an administrator",
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
});

/** Tables joined for the owner and the assignee of a task, the raiser of a decision. */
export const owners = alias(people, "owners");
export const assignees = alias(people, "assignees");
export const raisers = alias(people, "raisers");
export const answerers = alias(people, "answerers");
export const actors = alias(people, "actors");

/**
 * Records that a person signed in: keyed by the provider's immutable id, so a renamed account
 * stays the same person, with the login, the name and the picture as the provider says now. The first
 * time is a joining, which the board is told about. A `role` given is written; left out, a
 * person keeps what they are, and a new one is a member.
 */
export async function savePerson(
  database: Database,
  login: {
    readonly workspaceId: string;
    readonly host: ProviderKey;
    readonly account: HostAccount;
    readonly role?: PersonRole | undefined;
    readonly now: Date;
  },
): Promise<{ readonly person: PersonRecord; readonly joined: boolean }> {
  const { workspaceId, host, account, role, now } = login;
  return drizzleOf(database).transaction(async (tx) => {
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
    if (row.inserted) {
      await recordEvent(tx, {
        workspaceId,
        kind: "person.joined",
        actor: { id: person.id },
        data: {},
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

/**
 * Says what a person is and tells the board. The board keeps at least one administrator: the
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
    const person = toPerson(current);
    if (person.role === role) {
      return person;
    }
    if (person.role === "admin") {
      const [admins] = await tx
        .select({ count: count() })
        .from(people)
        .where(and(eq(people.workspaceId, workspaceId), eq(people.role, "admin")));
      if ((admins?.count ?? 0) <= 1) {
        throw new PersonError("person.last_admin");
      }
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

/** Everyone of the workspace, by login. */
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

export async function listPeople(database: Database, workspaceId: string): Promise<PersonRecord[]> {
  const rows = await drizzleOf(database)
    .select(personColumns(people))
    .from(people)
    .where(eq(people.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${people.login})`), asc(people.id));
  return rows.map(toPerson);
}
