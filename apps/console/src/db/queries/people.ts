import { and, asc, eq, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { type Database, drizzleOf } from "../client.js";
import { people } from "../schema.js";
import { recordEvent } from "./events.js";

// The people of the workspace: everyone who signed in through the git host and was let in.
// Identity data: every query names the person, or the workspace they are all in.

/** The one git host there is; a second one arrives with its adapter and its key. */
export type GitHostKey = "gh";

export interface PersonRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: GitHostKey;
  readonly hostAccountId: string;
  readonly login: string;
  readonly name: string | undefined;
  readonly avatarUrl: string | undefined;
}

/** A person as the git host told it at sign-in: what is written down about them. */
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
});

type PersonRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: string;
  readonly hostAccountId: string;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
};

export const toPerson = (row: PersonRow): PersonRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  host: row.host as GitHostKey,
  hostAccountId: row.hostAccountId,
  login: row.login,
  name: row.name ?? undefined,
  avatarUrl: row.avatarUrl ?? undefined,
});

/** Tables joined for the owner and the assignee of a task, the raiser of a decision. */
export const owners = alias(people, "owners");
export const assignees = alias(people, "assignees");
export const raisers = alias(people, "raisers");
export const answerers = alias(people, "answerers");
export const actors = alias(people, "actors");

/**
 * Records that a person signed in: keyed by the host's immutable id, so a renamed account stays
 * the same person, with the login, the name and the picture as the host says now. The first
 * time is a joining, which the board is told about.
 */
export async function savePerson(
  database: Database,
  login: {
    readonly workspaceId: string;
    readonly host: GitHostKey;
    readonly account: HostAccount;
    readonly now: Date;
  },
): Promise<{ readonly person: PersonRecord; readonly joined: boolean }> {
  const { workspaceId, host, account, now } = login;
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
        lastLoginAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [people.workspaceId, people.host, people.hostAccountId],
        set: {
          login: account.login,
          name: account.name ?? null,
          avatarUrl: account.avatarUrl ?? null,
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
        actorId: person.id,
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

/** Everyone of the workspace, by login. */
export async function listPeople(database: Database, workspaceId: string): Promise<PersonRecord[]> {
  const rows = await drizzleOf(database)
    .select(personColumns(people))
    .from(people)
    .where(eq(people.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${people.login})`), asc(people.id));
  return rows.map(toPerson);
}
