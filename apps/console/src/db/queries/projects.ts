import {
  type ColorName,
  MAX_PROJECTS_PER_WORKSPACE,
  PROJECT_ICON_TYPES,
  type ProjectIconType,
  type ProjectRole,
  type ProjectVisibility,
} from "@skillcdn/console/api";
import { and, asc, count, eq, type SQL, sql } from "drizzle-orm";
import { memberOfProject, projectVisibleTo } from "../../auth/policy.js";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { decisions, people, projectMembers, projects, runs, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The projects of the workspace (ADR-0008): the unit of work and of permission. What a person
// is in a project, and whether they are in it at all, is decided on every request, from the
// project's visibility, its members and the person's role in the workspace, with the conditions
// of auth/policy.ts (ADR-0035), which every query here applies and none restates.

export { mayWorkIn } from "../../auth/policy.js";

/** A project's own image for its mark: the bytes are the blob store's, by their hash. */
export interface ProjectIcon {
  readonly sha256: string;
  readonly contentType: ProjectIconType;
}

export interface ProjectRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: ProjectVisibility;
  /** The address of the project's skills, canonical, or none for the organization's. */
  readonly skillsAddress: string | undefined;
  /** The project's mark: a colour by name and a symbol, each or none for the ones chosen from the key and the name. */
  readonly color: ColorName | undefined;
  readonly symbol: string | undefined;
  /** The project's own image for its mark, or none: then the mark is the symbol on the colour. */
  readonly icon: ProjectIcon | undefined;
  /** The pack token the project reads a private pack with (ADR-0028), sealed, and when it was set; none for a public pack. */
  readonly packToken: { readonly sealed: string; readonly setAt: Date } | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A project as one person sees it: with what they are in it, and what waits in it. */
export interface ProjectView extends ProjectRecord {
  readonly role: ProjectRole;
  readonly openDecisions: number;
  readonly openRuns: number;
}

/**
 * A member of a project: a person listed in it, or, in a project open to the workspace, anyone
 * of the workspace (ADR-0035), with what they are in it.
 */
export interface MemberRecord {
  readonly person: PersonRecord;
  /** An owner as listed or as an administrator, else a member. */
  readonly role: ProjectRole;
  /** The listing's day; for a member without one, the later of the project's making and their joining. */
  readonly addedAt: Date;
  /** Whether a listing holds them in the project. */
  readonly listed: boolean;
}

/** What is wrong with a project, or a member, a person asked for. `code` is what the API answers with. */
export class ProjectError extends DomainError {
  constructor(
    code:
      | "project.not_found"
      | "project.key_taken"
      | "project.too_many"
      | "member.not_found"
      | "member.exists"
      | "member.invalid_person"
      | "member.open_project",
  ) {
    super(code, PROJECT_ERROR_WORDS[code]);
  }
}

const PROJECT_ERROR_WORDS = {
  "project.not_found": "the project was not found",
  "project.key_taken": "a project with this key exists already",
  "project.too_many": "the workspace holds as many projects as one may",
  "member.not_found": "the person is not listed in the project",
  "member.exists": "the person is listed in the project already",
  "member.invalid_person": "the person is not one of the workspace",
  "member.open_project":
    "the project is open to the workspace, so everyone of it is a member already; an owner is listed with the role owner",
} as const;

export interface ProjectInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly visibility?: ProjectVisibility | undefined;
  readonly skillsAddress?: string | null | undefined;
  readonly color?: ColorName | null | undefined;
  readonly symbol?: string | null | undefined;
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
  color: projects.color,
  symbol: projects.symbol,
  iconSha256: projects.iconSha256,
  iconContentType: projects.iconContentType,
  packToken: projects.packToken,
  packTokenSetAt: projects.packTokenSetAt,
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
  readonly color: ColorName | null;
  readonly symbol: string | null;
  readonly iconSha256: string | null;
  readonly iconContentType: string | null;
  readonly packToken: string | null;
  readonly packTokenSetAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const isIconType = (value: string): value is ProjectIconType =>
  (PROJECT_ICON_TYPES as readonly string[]).includes(value);

/** The image a row names, when it names one of a kind the pages show; a row cannot name another. */
const iconOf = (row: ProjectRow): ProjectIcon | undefined =>
  row.iconSha256 !== null && row.iconContentType !== null && isIconType(row.iconContentType)
    ? { sha256: row.iconSha256, contentType: row.iconContentType }
    : undefined;

const toProject = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  key: row.key,
  name: row.name,
  description: row.description,
  visibility: row.visibility,
  skillsAddress: row.skillsAddress ?? undefined,
  color: row.color ?? undefined,
  symbol: row.symbol ?? undefined,
  icon: iconOf(row),
  packToken:
    row.packToken !== null && row.packTokenSetAt !== null
      ? { sealed: row.packToken, setAt: row.packTokenSetAt }
      : undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * The condition under which `person` may see the project of a row, for queries that must not
 * find what a person may not see: the policy's (auth/policy.ts).
 */
export function visibleTo(person: PersonRecord): SQL {
  return projectVisibleTo(person);
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
    /** How many projects the workspace may hold, this one included; the package's bound when left out. */
    readonly limit?: number | undefined;
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
    const [held] = await tx
      .select({ count: count() })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    if ((held?.count ?? 0) >= (input.limit ?? MAX_PROJECTS_PER_WORKSPACE)) {
      throw new ProjectError("project.too_many");
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
        color: project.color ?? null,
        symbol: project.symbol ?? null,
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
      color: patch.color === undefined ? current.color : patch.color,
      symbol: patch.symbol === undefined ? current.symbol : patch.symbol,
    };
    const changed = (
      ["name", "description", "visibility", "skillsAddress", "color", "symbol"] as const
    ).filter((field) => next[field] !== current[field]);
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

/**
 * Sets the pack token the project reads a private pack with (ADR-0028), sealed already, or takes
 * it away, and tells the board which field changed; taking away what is not there writes nothing.
 */
export async function setPackToken(
  database: Database,
  input: {
    readonly projectId: string;
    readonly actor: Actor;
    readonly person: PersonRecord;
    /** The token, sealed with the console's secret; nothing to take it away. */
    readonly sealed: string | undefined;
    readonly now: Date;
  },
): Promise<ProjectView> {
  const { projectId, actor, person, sealed, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select({
        workspaceId: projects.workspaceId,
        key: projects.key,
        name: projects.name,
        packToken: projects.packToken,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (current === undefined) {
      throw new ProjectError("project.not_found");
    }
    if (current.packToken === null && sealed === undefined) {
      return readView(tx, projectId, person);
    }
    await tx
      .update(projects)
      .set({
        packToken: sealed ?? null,
        packTokenSetAt: sealed === undefined ? null : now,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));
    await recordEvent(tx, {
      workspaceId: current.workspaceId,
      projectId,
      kind: "project.updated",
      actor,
      data: { key: current.key, name: current.name, fields: ["packToken"] },
      now,
    });
    return readView(tx, projectId, person);
  });
}

/**
 * Sets the project's own image for its mark, or takes it away, and tells the board which field
 * changed; the same image again writes nothing. The bytes are the blob store's, by their hash,
 * and stay there: the store keeps each set of bytes once, whatever refers to them.
 */
export async function setProjectIcon(
  database: Database,
  input: {
    readonly projectId: string;
    readonly actor: Actor;
    readonly person: PersonRecord;
    readonly icon: ProjectIcon | undefined;
    readonly now: Date;
  },
): Promise<ProjectView> {
  const { projectId, actor, person, icon, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select(projectColumns)
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (current === undefined) {
      throw new ProjectError("project.not_found");
    }
    const before = iconOf(current);
    if (before?.sha256 === icon?.sha256 && before?.contentType === icon?.contentType) {
      return readView(tx, projectId, person);
    }
    await tx
      .update(projects)
      .set({
        iconSha256: icon?.sha256 ?? null,
        iconContentType: icon?.contentType ?? null,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));
    await recordEvent(tx, {
      workspaceId: current.workspaceId,
      projectId,
      kind: "project.updated",
      actor,
      data: { key: current.key, name: current.name, fields: ["icon"] },
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

/** What the members are read against: the project's visibility, and when it was made. */
export interface MemberProject {
  readonly id: string;
  readonly workspaceId: string;
  readonly visibility: ProjectVisibility;
  readonly createdAt: Date;
}

const later = (one: Date, other: Date): Date => (one > other ? one : other);

/** A member without a listing, in a project open to the workspace: what everyone of it is in it. */
const unlistedMember = (
  person: PersonRecord,
  joinedAt: Date,
  project: MemberProject,
): MemberRecord => ({
  person,
  role: person.role === "admin" ? "owner" : "member",
  addedAt: later(joinedAt, project.createdAt),
  listed: false,
});

/**
 * The members of the project, by login (ADR-0035): those listed, in a private project; in one
 * open to the workspace everyone active of it, an owner where a listing or the role of
 * administrator says so, a member otherwise.
 */
export async function listMembers(
  database: Database,
  project: MemberProject,
): Promise<MemberRecord[]> {
  const handle = drizzleOf(database);
  if (project.visibility === "private") {
    const rows = await handle
      .select(members)
      .from(projectMembers)
      .innerJoin(people, eq(people.id, projectMembers.personId))
      .where(eq(projectMembers.projectId, project.id))
      .orderBy(asc(sql`lower(${people.login})`), asc(people.id));
    return rows.map((row) => ({
      person: toPerson(row.person),
      role: row.role,
      addedAt: row.addedAt,
      listed: true,
    }));
  }
  const rows = await handle
    .select({
      person: personColumns(people),
      joinedAt: people.createdAt,
      role: projectMembers.role,
      addedAt: projectMembers.createdAt,
    })
    .from(people)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, project.id), eq(projectMembers.personId, people.id)),
    )
    .where(and(eq(people.workspaceId, project.workspaceId), eq(people.status, "active")))
    .orderBy(asc(sql`lower(${people.login})`), asc(people.id));
  return rows.map((row) => {
    const person = toPerson(row.person);
    return row.role === null || row.addedAt === null
      ? unlistedMember(person, row.joinedAt, project)
      : {
          person,
          role: person.role === "admin" ? "owner" : row.role,
          addedAt: row.addedAt,
          listed: true,
        };
  });
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
    : { person: toPerson(row.person), role: row.role, addedAt: row.addedAt, listed: true };
}

/** An active person of the workspace, with when they joined it, or nothing. */
async function readActivePerson(
  handle: Handle,
  workspaceId: string,
  personId: string,
): Promise<{ readonly person: PersonRecord; readonly joinedAt: Date } | undefined> {
  const [row] = await handle
    .select({ person: personColumns(people), joinedAt: people.createdAt })
    .from(people)
    .where(
      and(
        eq(people.workspaceId, workspaceId),
        eq(people.id, personId),
        eq(people.status, "active"),
      ),
    )
    .limit(1);
  return row === undefined ? undefined : { person: toPerson(row.person), joinedAt: row.joinedAt };
}

const memberProjectColumns = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  key: projects.key,
  name: projects.name,
  visibility: projects.visibility,
  createdAt: projects.createdAt,
};

/**
 * Lists a person of the workspace in the project, and tells the board. In a project open to the
 * workspace everyone of it is a member already, so only an owner is listed (`member.open_project`).
 */
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
      .select(memberProjectColumns)
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (project === undefined) {
      throw new ProjectError("project.not_found");
    }
    if (project.visibility === "workspace" && role === "member") {
      throw new ProjectError("member.open_project");
    }
    // A person out of the workspace (ADR-0022) is listed nowhere.
    const [person] = await tx
      .select({ login: people.login })
      .from(people)
      .where(
        and(
          eq(people.workspaceId, workspaceId),
          eq(people.id, personId),
          eq(people.status, "active"),
        ),
      )
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

/**
 * Says what a person is in the project, and tells the board; a change to what is already so
 * writes nothing. In a private project the person must be listed. In a project open to the
 * workspace anyone of it may be made an owner, which lists them, and an owner made a member
 * again loses the listing and stays the member everyone is (ADR-0035); an administrator owns
 * every project whatever is asked.
 */
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
      .select(memberProjectColumns)
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (project === undefined) {
      throw new ProjectError("member.not_found");
    }
    const current = await readMember(tx, projectId, personId);
    const changed = (login: string) =>
      recordEvent(tx, {
        workspaceId,
        projectId,
        kind: "project.member_changed",
        actor,
        data: { key: project.key, name: project.name, login, role },
        now,
      });
    if (current === undefined) {
      if (project.visibility !== "workspace") {
        throw new ProjectError("member.not_found");
      }
      const found = await readActivePerson(tx, project.workspaceId, personId);
      if (found === undefined) {
        throw new ProjectError("member.not_found");
      }
      const unlisted = unlistedMember(found.person, found.joinedAt, project);
      if (role === "member" || found.person.role === "admin") {
        return unlisted;
      }
      await tx.insert(projectMembers).values({ projectId, personId, role, createdAt: now });
      await changed(found.person.login);
      return { ...unlisted, role, addedAt: now, listed: true };
    }
    if (current.role === role) {
      return current;
    }
    if (project.visibility === "workspace" && role === "member") {
      await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.personId, personId)));
      await changed(current.person.login);
      const found = await readActivePerson(tx, project.workspaceId, personId);
      return found === undefined
        ? { ...current, role, listed: false }
        : unlistedMember(found.person, found.joinedAt, project);
    }
    await tx
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.personId, personId)));
    await changed(current.person.login);
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
 * Whether `ownerId` is listed as an owner of a project `personId` is in: what the sight of
 * another person's work asks of someone who is not an administrator. Who is in a project is the
 * policy's condition (auth/policy.ts).
 */
export async function ownsProjectWith(
  database: Database,
  workspaceId: string,
  ownerId: string,
  personId: string,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.personId, ownerId),
        eq(projectMembers.role, "owner"),
      ),
    )
    .where(and(eq(projects.workspaceId, workspaceId), memberOfProject(personId)))
    .limit(1);
  return rows.length > 0;
}

/** Whether `personId` is listed as an owner of any project of the workspace: what lets them find anyone by login (ADR-0035). */
export async function ownsAProject(
  database: Database,
  workspaceId: string,
  personId: string,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.personId, personId),
        eq(projectMembers.role, "owner"),
      ),
    )
    .where(eq(projects.workspaceId, workspaceId))
    .limit(1);
  return rows.length > 0;
}
