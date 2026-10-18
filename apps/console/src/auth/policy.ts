import type { PeopleVisibility } from "@skillcdn/console/api";
import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { PersonRecord } from "../db/queries/people.js";
import { people, projectMembers, projects } from "../db/schema.js";

// Who may see whom, and what (ADR-0035). Every decision about people and projects is made here
// and nowhere else: a query takes its condition from this module and applies it in SQL, so that
// a listing, a lookup and a reference always agree and nothing is filtered after the fact; a
// route names its guard (who is asking, with what) and asks nothing of its own. The settings a
// decision depends on are the workspace's, read on every request. What cannot be decided is
// denied. A new rule is a function here, with its row in the table test beside it.

/** The settings of the workspace a decision depends on, as its row has them. */
export interface AccessSettings {
  /** Who sees whom on the People page and in the pickers. */
  readonly peopleVisibility: PeopleVisibility;
}

/** A person in a predicate: their id, or the column of the row being read. */
export type PersonRef = string | AnyPgColumn;

/** Whether `person` is listed in the project of the `projects` row being read. */
const listedIn = (person: PersonRef): SQL =>
  sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.personId} = ${person})`;

/**
 * The one condition of membership, on a `projects` row: a project open to the workspace has
 * everyone of the workspace as a member, a private one those listed. Everything that asks who is
 * in a project asks this, and only this.
 */
export function memberOfProject(person: PersonRef): SQL {
  return sql`(${projects.visibility} = 'workspace' or ${listedIn(person)})`;
}

/** Whether `person` administers the workspace: sees every project and everyone, and configures it. */
export function administers(person: PersonRecord): boolean {
  return person.role === "admin";
}

/** On a `projects` row: whether `person` may see the project. An administrator sees every one. */
export function projectVisibleTo(person: PersonRecord): SQL {
  return administers(person) ? sql`true` : memberOfProject(person.id);
}

/**
 * Whether `person` may work in `projectId`, which is what a worker of a task in it must
 * satisfy: an active person of the workspace who is a member of the project, or an administrator.
 * Nobody out of the workspace (ADR-0022). Given a column, it is one of an alias of `people`,
 * since the condition reads `people` itself.
 */
export function mayWorkIn(projectId: string, person: PersonRef): SQL {
  return sql`exists (select 1 from ${people} where ${people.id} = ${person} and ${people.status} = 'active') and exists (select 1 from ${projects} where ${projects.id} = ${projectId} and (${memberOfProject(person)} or exists (select 1 from ${people} where ${people.id} = ${person} and ${people.role} = 'admin')))`;
}

/**
 * Whether the people `person` sees are narrowed to those they share a project with: the
 * workspace says so, and the person is not an administrator, who sees everyone whatever it says.
 */
export function peopleNarrowedFor(person: PersonRecord, settings: AccessSettings): boolean {
  return settings.peopleVisibility === "shared_projects" && !administers(person);
}

/**
 * On a `people` row: whether `asker` may see the person. Everyone, unless the people are
 * narrowed: then the active people who are in a project the asker is in, the asker themselves,
 * and the administrators, whom anyone may need to turn to. A project open to the workspace has
 * everyone in it, so an asker in one sees everyone.
 */
export function personVisibleTo(asker: PersonRecord, settings: AccessSettings): SQL {
  if (!peopleNarrowedFor(asker, settings)) {
    return sql`true`;
  }
  return sql`(${people.status} = 'active' and (${people.id} = ${asker.id} or ${people.role} = 'admin' or exists (select 1 from ${projects} where ${projects.workspaceId} = ${people.workspaceId} and ${memberOfProject(asker.id)} and ${memberOfProject(people.id)})))`;
}

/**
 * On a `people` row: whether `asker` may find the person by their exact login, so as to list
 * them in a project they configure: everyone they see, and, for an owner of a project, anyone
 * active of the workspace, since an owner must be able to list someone the page does not show.
 * An owner thereby learns that a login is one of the workspace, and nothing more.
 */
export function personFindableBy(
  asker: PersonRecord,
  settings: AccessSettings,
  ownsAProject: boolean,
): SQL {
  if (!peopleNarrowedFor(asker, settings)) {
    return sql`true`;
  }
  return ownsAProject ? sql`${people.status} = 'active'` : personVisibleTo(asker, settings);
}

/**
 * Whether `asker` reads the logins let in that nobody has signed in with yet, and when the
 * organization at the git host was last read: everyone, unless the people are narrowed, since
 * both say who is in beyond the projects the asker shares.
 */
export function readsListings(asker: PersonRecord, settings: AccessSettings): boolean {
  return !peopleNarrowedFor(asker, settings);
}

/**
 * Whether `asker` reads the workspace's own events, which are about its people: who joined, who
 * was made what. Everyone, unless the people are narrowed.
 */
export function readsWorkspaceEvents(asker: PersonRecord, settings: AccessSettings): boolean {
  return !peopleNarrowedFor(asker, settings);
}

/** Whether `person` configures the workspace: its settings, its categories, who is in and what they are. */
export function configuresWorkspace(person: PersonRecord): boolean {
  return administers(person);
}
