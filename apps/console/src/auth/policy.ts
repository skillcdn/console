import type { PeopleVisibility } from "@skillcdn/console/api";
import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { PersonRecord } from "../db/queries/people.js";
import { decisions, people, pluginLinks, projectMembers, projects } from "../db/schema.js";

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

/**
 * The person as a plugin acting for them stands (ADR-0072): a member, whatever they administer,
 * so that neither a mistake in matching them to an account elsewhere nor a bug in the plugin
 * carries an administrator's reach into what is done in their name.
 */
export function asActedFor(person: PersonRecord): PersonRecord {
  return administers(person) ? { ...person, role: "member" } : person;
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

/** On a `decisions` row: whether the decision is addressed to `person`, alone or among others (ADR-0057). */
export function decisionAddressedTo(person: PersonRef): SQL {
  return sql`(${person}::uuid = any(${decisions.deciderIds}) or ${decisions.deciderId} = ${person}::uuid)`;
}

/** On a `decisions` row: whether a plugin raised the decision (ADR-0052), which is what lets it reach past the project. */
const raisedByAPlugin = (): SQL =>
  sql`exists (select 1 from ${pluginLinks} where ${pluginLinks.targetKind} = 'decision' and ${pluginLinks.targetId} = ${decisions.id} and ${pluginLinks.recordId} is null)`;

/**
 * On a `decisions` row: whether `person` manages someone the decision is addressed to, directly
 * or up the reporting line (ADR-0068): what the nearest manager holds, everyone above holds too.
 * The line never loops (`updatePersonManager` sees to it), so the climb ends.
 */
const aboveADecider = (person: PersonRef): SQL =>
  sql`exists (with recursive above(id) as (select ${people.managerId} from ${people} where ${people.id} = any(${decisions.deciderIds}) and ${people.managerId} is not null union select p.manager_id from people p join above on p.id = above.id where p.manager_id is not null) select 1 from above where above.id = ${person}::uuid)`;

/**
 * On a `decisions` row: whether `person` is a member of the decision's project, as
 * `memberOfProject` has it: everyone for a project open to the workspace, those listed for a
 * private one.
 */
const memberOfDecisionProject = (person: PersonRef): SQL =>
  sql`exists (select 1 from ${projects} where ${projects.id} = ${decisions.projectId} and ${memberOfProject(person)})`;

/**
 * On a `decisions` row: whether the decision may reach `person` past what its project shows them
 * (ADR-0077). A plugin's reaches past its project, as ADR-0068 has it; a person's own is the
 * project's, and reaches whom it is addressed to and who raised it only while they are members of
 * the project, so that whoever leaves a private project leaves its decisions there.
 */
const stillReaches = (person: PersonRef): SQL =>
  sql`(${raisedByAPlugin()} or ${memberOfDecisionProject(person)})`;

/**
 * On a `decisions` row: whether `person` may read the decision wherever it is, in a project they
 * may see or not (ADR-0068): they raised it, it is addressed to them, or it is a plugin's and
 * addressed to someone they manage; a person's own decision only while they are a member of its
 * project (ADR-0077). An administrator reads every one.
 */
export function decisionReachableBy(person: PersonRecord): SQL {
  if (administers(person)) {
    return sql`true`;
  }
  return sql`((${decisions.raisedById} = ${person.id}::uuid or ${decisionAddressedTo(person.id)} or (${raisedByAPlugin()} and ${aboveADecider(person.id)})) and ${stillReaches(person.id)})`;
}

/**
 * On a `decisions` row: whether the decision is on `person`'s own plate, wherever it is
 * (ADR-0068): addressed to them, or a plugin's addressed to someone they manage, up the reporting
 * line; a person's own decision only while they are a member of its project (ADR-0077). Their
 * administration adds nothing to it; what a plugin answers for a person is held to it (ADR-0072).
 */
export function decisionOnPlateOf(person: PersonRef): SQL {
  return sql`((${decisionAddressedTo(person)} or (${raisedByAPlugin()} and ${aboveADecider(person)})) and ${stillReaches(person)})`;
}

/**
 * On a `decisions` row: whether the decision is addressed to `person` and is among their own, on
 * their plate and in My decisions (ADR-0042, ADR-0068): a plugin's wherever it is; a person's own
 * while they may work in its project, a member of it or an administrator (ADR-0077).
 */
export function decisionWaitsFor(person: PersonRecord): SQL {
  return administers(person)
    ? decisionAddressedTo(person.id)
    : sql`(${decisionAddressedTo(person.id)} and ${stillReaches(person.id)})`;
}

/** On a `decisions` row: whether `person` raised the decision and it is still theirs to read, as `decisionWaitsFor` has it. */
export function decisionRaisedBy(person: PersonRecord): SQL {
  return administers(person)
    ? sql`${decisions.raisedById} = ${person.id}::uuid`
    : sql`(${decisions.raisedById} = ${person.id}::uuid and ${stillReaches(person.id)})`;
}

/**
 * On a `decisions` row: whether `person` may answer the decision from outside the project
 * (ADR-0068): it is on their plate. Within the project, anyone who may work there answers, as
 * before; an administrator always.
 */
export function decisionAnswerableBy(person: PersonRecord): SQL {
  if (administers(person)) {
    return sql`true`;
  }
  return decisionOnPlateOf(person.id);
}

/** Whether `person` configures the workspace: its settings, its categories, who is in and what they are. */
export function configuresWorkspace(person: PersonRecord): boolean {
  return administers(person);
}

/**
 * Whether `person` configures the plugins (ADR-0049): enables and disables them, consents to
 * what they ask, binds their board, sets their settings and secrets, grants their roles. An
 * administrator's, and nobody else's; a plugin's roles themselves are decided from its grants.
 */
export function configuresPlugins(person: PersonRecord): boolean {
  return administers(person);
}
