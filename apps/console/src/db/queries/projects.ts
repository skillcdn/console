import type { ProjectRole, ProjectVisibility } from "@skillcdn/console/api";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { decisions, people, projectMembers, projects, runs, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The projects of the workspace (ADR-0008): the unit of work and of permission. What a person
// is in a project, and whether they are in it at all, is decided here, on every request, from
// the project's visibility, its members and the person's role in the workspace.

export interface ProjectRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: ProjectVisibility;
  /** The address of the project's skills, canonical, or none for the organization's. */
  readonly skillsAddress: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A project as one person sees it: with what they are in it, and what waits in it. */
export interface ProjectView extends ProjectRecord {
  readonly role: ProjectRole;
  readonly openDecisions: number;
  readonly openRuns: number;
}

export interface MemberRecord {
  readonly person: PersonRecord;
  readonly role: ProjectRole;
  readonly addedAt: Date;
}

/** What is wrong with a project, or a member, a person asked for. `code` is what the API answers with. */
export class ProjectError extends DomainError {
  constructor(
    code:
      | "project.not_found"
      | "project.key_taken"
      | "member.not_found"
      | "member.exists"
      | "member.invalid_person",
  ) {
    super(code, PROJECT_ERROR_WORDS[code]);
  }
}

const PROJECT_ERROR_WORDS = {
  "project.not_found": "the project was not found",
  "project.key_taken": "a project with this key exists already",
  "member.not_found": "the person is not listed in the project",
  "member.exists": "the person is listed in the project already",
  "member.invalid_person": "the person is not one of the workspace",
} as const;

export interface ProjectInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly visibility?: ProjectVisibility | undefined;
  readonly skillsAddress?: string | null | undefined;
}

/** Only what changes; a key that is absent leaves the field as it is. */
export type ProjectPatch = Omit<Partial<ProjectInput>, "key">;

type Handle = Transaction | ReturnType<typeof drizzleOf>;

const openDecisionsOf = sql<number>`(select count(*) from ${decisions} where ${decisions.projectId} = ${projects.id} and ${decisions.answeredAt} is null)`;
const openRunsOf = sql<number>`(select count(*) from ${runs} where ${runs.projectId} = ${projects.id} and ${runs.status} in ('running', 'waiting'))`;

const projectColumns = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  key: projects.key,
  name: projects.name,
  description: projects.description,
  visibility: projects.visibility,
  skillsAddress: projects.skillsAddress,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

type ProjectRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: ProjectVisibility;
  readonly skillsAddress: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const toProject = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  key: row.key,
  name: row.name,
  description: row.description,
  visibility: row.visibility,
  skillsAddress: row.skillsAddress ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * The condition under which `person` may see the project of a row: an administrator sees
 * every project; a project open to the workspace is seen by everyone of it; a private one by
 * those listed. For queries that must not find what a person may not see.
 */
export function visibleTo(person: PersonRecord): SQL {
  if (person.role === "admin") {
    return sql`true`;
  }
  return sql`(${projects.visibility} = 'workspace' or exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.personId} = ${person.id}))`;
}

/** The role `person` has in a project they may see: an owner, as listed or as an administrator, or a member. */
function roleOf(
  person: PersonRecord,
  project: { readonly visibility: ProjectVisibility },
  listed: ProjectRole | null,
): ProjectRole | undefined {
  if (person.role === "admin") {
    return "owner";
  }
  if (listed !== null) {
    return listed;
  }
  return project.visibility === "workspace" ? "member" : undefined;
}

/** The projects as `person` sees them: each with their role and what waits in it. */
function selectViews(handle: Handle, person: PersonRecord) {
  return handle
    .select({
      ...projectColumns,
      listed: projectMembers.role,
      openDecisions: openDecisionsOf.mapWith(Number),
      openRuns: openRunsOf.mapWith(Number),
    })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.personId, person.id)),
    );
}

type ViewRow = Awaited<ReturnType<typeof selectViews>>[number];

function toView(row: ViewRow, person: PersonRecord): ProjectView | undefined {
  const role = roleOf(person, row, row.listed);
  return role === undefined
    ? undefined
    : { ...toProject(row), role, openDecisions: row.openDecisions, openRuns: row.openRuns };
}

/**
 * The project `key` names as `person` sees it, or nothing when there is no such project or
 * the person may not see it: both are the same answer, so that nothing is learned either way.
 */
export async function findProjectFor(
  database: Database,
  workspaceId: string,
  key: string,
  person: PersonRecord,
): Promise<ProjectView | undefined> {
  const [row] = await selectViews(drizzleOf(database), person)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.key, key)))
    .limit(1);
  return row === undefined ? undefined : toView(row, person);
}

/** The projects `person` may see, by name. */
export async function listProjectsFor(
  database: Database,
  workspaceId: string,
  person: PersonRecord,
): Promise<ProjectView[]> {
  const rows = await selectViews(drizzleOf(database), person)
    .where(and(eq(projects.workspaceId, workspaceId), visibleTo(person)))
    .orderBy(asc(sql`lower(${projects.name})`), asc(projects.key));
  return rows.flatMap((row) => {
    const view = toView(row, person);
    return view === undefined ? [] : [view];
  });
}

/** The project as `person` sees it, read again after a change. */
async function readView(
  tx: Transaction,
  projectId: string,
  person: PersonRecord,
): Promise<ProjectView> {
  const [row] = await selectViews(tx, person).where(eq(projects.id, projectId)).limit(1);
  const view = row === undefined ? undefined : toView(row, person);
  if (view === undefined) {
    throw new ProjectError("project.not_found");
  }
  return view;
}

/**
 * Makes a project, with the actor as its owner, and tells the board. The key is unique in the
 * workspace, checked under the lock on the workspace row, so that two projects made at once
 * cannot share one.
 */
export async function createProject(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly person: PersonRecord;
    readonly project: ProjectInput;
    readonly now: Date;
  },
): Promise<ProjectView> {
  const { workspaceId, actor, person, project, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    const [taken] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.key, project.key)))
      .limit(1);
    if (taken !== undefined) {
      throw new ProjectError("project.key_taken");
    }
    const [inserted] = await tx
      .insert(projects)
      .values({
        workspaceId,
        key: project.key,
        name: project.name,
        description: project.description ?? "",
        visibility: project.visibility ?? "private",
        skillsAddress: project.skillsAddress ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: projects.id });
    if (inserted === undefined) {
      throw new Error("project insert returned no row");
    }
    await tx.insert(projectMembers).values({
      projectId: inserted.id,
      personId: actor.id,
      role: "owner",
      createdAt: now,
    });
    await recordEvent(tx, {
      workspaceId,
      projectId: inserted.id,
      kind: "project.created",
      actor,
      data: { key: project.key, name: project.name },
      now,
    });
    return readView(tx, inserted.id, person);
  });
}

/** Changes what the patch names and tells the board which fields; a patch that changes nothing writes nothing. */
export async function updateProject(
  database: Database,
  input: {
    readonly projectId: string;
    readonly actor: Actor;
    readonly person: PersonRecord;
    readonly patch: ProjectPatch;
    readonly now: Date;
  },
): Promise<ProjectView> {
  const { projectId, actor, person, patch, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select(projectColumns)
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (current === undefined) {
      throw new ProjectError("project.not_found");
    }
    const next = {
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      visibility: patch.visibility ?? current.visibility,
      skillsAddress:
        patch.skillsAddress === undefined ? current.skillsAddress : patch.skillsAddress,
    };
    const changed = (["name", "description", "visibility", "skillsAddress"] as const).filter(
      (field) => next[field] !== current[field],
    );
    if (changed.length === 0) {
      return readView(tx, projectId, person);
    }
    await tx
      .update(projects)
      .set({ ...next, updatedAt: now })
      .where(eq(projects.id, projectId));
    await recordEvent(tx, {
      workspaceId: current.workspaceId,
      projectId,
      kind: "project.updated",
      actor,
      data: { key: current.key, name: next.name, fields: changed },
      now,
    });
    return readView(tx, projectId, person);
  });
}

const members = {
  role: projectMembers.role,
  addedAt: projectMembers.createdAt,
  person: personColumns(people),
};

/** Those listed in the project, by login. */
export async function listMembers(database: Database, projectId: string): Promise<MemberRecord[]> {
  const rows = await drizzleOf(database)
    .select(members)
    .from(projectMembers)
    .innerJoin(people, eq(people.id, projectMembers.personId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(sql`lower(${people.login})`), asc(people.id));
  return rows.map((row) => ({
    person: toPerson(row.person),
    role: row.role,
    addedAt: row.addedAt,
  }));
}

async function readMember(
  handle: Handle,
  projectId: string,
  personId: string,
): Promise<MemberRecord | undefined> {
  const [row] = await handle
    .select(members)
    .from(projectMembers)
    .innerJoin(people, eq(people.id, projectMembers.personId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.personId, personId)))
    .limit(1);
  return row === undefined
    ? undefined
    : { person: toPerson(row.person), role: row.role, addedAt: row.addedAt };
}

/** Lists a person of the workspace in the project, and tells the board. */
export async function addMember(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actor: Actor;
    readonly personId: string;
    readonly role: ProjectRole;
    readonly now: Date;
  },
): Promise<MemberRecord> {
  const { workspaceId, projectId, actor, personId, role, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [project] = await tx
      .select({ key: projects.key, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (project === undefined) {
      throw new ProjectError("project.not_found");
    }
    const [person] = await tx
      .select({ login: people.login })
      .from(people)
      .where(and(eq(people.workspaceId, workspaceId), eq(people.id, personId)))
      .limit(1);
    if (person === undefined) {
      throw new ProjectError("member.invalid_person");
    }
    if ((await readMember(tx, projectId, personId)) !== undefined) {
      throw new ProjectError("member.exists");
    }
    await tx.insert(projectMembers).values({ projectId, personId, role, createdAt: now });
    await recordEvent(tx, {
      workspaceId,
      projectId,
      kind: "project.member_added",
      actor,
      data: { key: project.key, name: project.name, login: person.login, role },
      now,
    });
    const written = await readMember(tx, projectId, personId);
    if (written === undefined) {
      throw new ProjectError("member.not_found");
    }
    return written;
  });
}

/** Says what a listed person is in the project, and tells the board; a change to what is already so writes nothing. */
export async function updateMember(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actor: Actor;
    readonly personId: string;
    readonly role: ProjectRole;
    readonly now: Date;
  },
): Promise<MemberRecord> {
  const { workspaceId, projectId, actor, personId, role, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [project] = await tx
      .select({ key: projects.key, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    const current = await readMember(tx, projectId, personId);
    if (project === undefined || current === undefined) {
      throw new ProjectError("member.not_found");
    }
    if (current.role === role) {
      return current;
    }
    await tx
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.personId, personId)));
    await recordEvent(tx, {
      workspaceId,
      projectId,
      kind: "project.member_changed",
      actor,
      data: { key: project.key, name: project.name, login: current.person.login, role },
      now,
    });
    return { ...current, role };
  });
}

/** Takes a person off the project's list, and tells the board. */
export async function removeMember(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actor: Actor;
    readonly personId: string;
    readonly now: Date;
  },
): Promise<void> {
  const { workspaceId, projectId, actor, personId, now } = input;
  await drizzleOf(database).transaction(async (tx) => {
    const [project] = await tx
      .select({ key: projects.key, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    const current = await readMember(tx, projectId, personId);
    if (project === undefined || current === undefined) {
      throw new ProjectError("member.not_found");
    }
    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.personId, personId)));
    await recordEvent(tx, {
      workspaceId,
      projectId,
      kind: "project.member_removed",
      actor,
      data: { key: project.key, name: project.name, login: current.person.login },
      now,
    });
  });
}

/**
 * The condition under which `personId` may work in `projectId`: what an assignee of a task
 * in it must satisfy. An administrator may everywhere; everyone of the workspace in a project
 * open to it; those listed in a private one.
 */
export function mayWorkIn(projectId: string, personId: string): SQL {
  return sql`exists (select 1 from ${projects} where ${projects.id} = ${projectId} and (${projects.visibility} = 'workspace' or exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.personId} = ${personId}) or exists (select 1 from ${people} where ${people.id} = ${personId} and ${people.role} = 'admin')))`;
}
