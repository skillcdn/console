import { MAX_TEAM_NAME_LENGTH, MAX_TEAMS } from "@skillcdn/console/api";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { people, projects, teamMembers, teams, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";

// The teams of a workspace (ADR-0073): a name and its members, kept by an administrator. A team
// is a unit to call people by and to grant a plugin's role to, nothing more: no head, no team
// above it, since the reporting line already says who is above whom. A person is in any number.
// A team is called by its key (ADR-0074), immutable, one name among the teams' keys and the
// projects' keys alike; its name is what people read, and changes.

export interface TeamRecord {
  readonly id: string;
  readonly workspaceId: string;
  /** What the team is called by: its addresses, a grant, a plugin, the command. */
  readonly key: string;
  readonly name: string;
  /** Who is in, by id, in the order they came. */
  readonly memberIds: readonly string[];
  readonly createdAt: Date;
}

export type TeamErrorCode =
  | "team.not_found"
  | "team.key_taken"
  | "team.name_taken"
  | "team.too_many"
  | "team.invalid_member"
  | "team.not_a_member";

const MESSAGES: Record<TeamErrorCode, string> = {
  "team.not_found": "The team was not found.",
  "team.key_taken": "A team or a project of that key is there already.",
  "team.name_taken": "A team of that name is there already.",
  "team.too_many": `The workspace holds ${MAX_TEAMS} teams already.`,
  "team.invalid_member": "The person is not an active person of the workspace.",
  "team.not_a_member": "The person is not in the team.",
};

/** What is wrong with a change to a team. `code` is what the API answers with. */
export class TeamError extends DomainError {
  override readonly code: TeamErrorCode;

  constructor(code: TeamErrorCode) {
    super(code, MESSAGES[code]);
    this.code = code;
  }
}

const columns = {
  id: teams.id,
  workspaceId: teams.workspaceId,
  key: teams.key,
  name: teams.name,
  createdAt: teams.createdAt,
};

type Handle = Transaction | ReturnType<typeof drizzleOf>;

type TeamRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly createdAt: Date;
};

/** The members of the teams given, by team, in the order they came. */
async function membersOf(
  handle: Handle,
  teamIds: readonly string[],
): Promise<Map<string, string[]>> {
  const members = new Map<string, string[]>();
  if (teamIds.length === 0) {
    return members;
  }
  const rows = await handle
    .select({ teamId: teamMembers.teamId, personId: teamMembers.personId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, [...teamIds]))
    .orderBy(asc(teamMembers.addedAt), asc(teamMembers.personId));
  for (const row of rows) {
    const list = members.get(row.teamId);
    if (list === undefined) {
      members.set(row.teamId, [row.personId]);
    } else {
      list.push(row.personId);
    }
  }
  return members;
}

async function toTeams(handle: Handle, rows: readonly TeamRow[]): Promise<TeamRecord[]> {
  const members = await membersOf(
    handle,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, memberIds: members.get(row.id) ?? [] }));
}

/** The teams of the workspace, by name. */
export async function listTeams(database: Database, workspaceId: string): Promise<TeamRecord[]> {
  const handle = drizzleOf(database);
  const rows = await handle
    .select(columns)
    .from(teams)
    .where(eq(teams.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${teams.name})`), asc(teams.id));
  return toTeams(handle, rows);
}

/** One team by its key, or none. */
export async function findTeam(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<TeamRecord | undefined> {
  const handle = drizzleOf(database);
  const rows = await handle
    .select(columns)
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.key, key)))
    .limit(1);
  return (await toTeams(handle, rows))[0];
}

/** The keys of the teams each person of the workspace is in, by person, the teams by name. */
export async function teamKeysByPerson(
  database: Database,
  workspaceId: string,
): Promise<Map<string, string[]>> {
  const rows = await drizzleOf(database)
    .select({ personId: teamMembers.personId, key: teams.key })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teams.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${teams.name})`), asc(teams.id));
  const byPerson = new Map<string, string[]>();
  for (const row of rows) {
    const list = byPerson.get(row.personId);
    if (list === undefined) {
      byPerson.set(row.personId, [row.key]);
    } else {
      list.push(row.key);
    }
  }
  return byPerson;
}

/**
 * Holds the workspace's row while teams change, so that two changes never race past the bounds,
 * and a team and a project are never made under one key at once: a project is made under it too.
 */
async function lockWorkspace(tx: Transaction, workspaceId: string): Promise<void> {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update");
}

/** A team of the workspace by name, compared without regard to case; none where there is none. */
async function teamNamed(
  tx: Transaction,
  workspaceId: string,
  name: string,
): Promise<{ id: string } | undefined> {
  const [found] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), sql`lower(${teams.name}) = lower(${name})`))
    .limit(1);
  return found;
}

/** Whether a team or a project of the workspace is called by the key already (ADR-0074). */
async function keyTaken(tx: Transaction, workspaceId: string, key: string): Promise<boolean> {
  const [team] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.key, key)))
    .limit(1);
  if (team !== undefined) {
    return true;
  }
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.key, key)))
    .limit(1);
  return project !== undefined;
}

/** The team to change, by its key, held for the transaction; none is `team.not_found`. */
async function lockedTeam(tx: Transaction, workspaceId: string, key: string): Promise<TeamRow> {
  const [row] = await tx
    .select(columns)
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.key, key)))
    .for("update");
  if (row === undefined) {
    throw new TeamError("team.not_found");
  }
  return row;
}

/** The name as it is kept: trimmed, within the bound; the pages and the command hold it to that already. */
function nameOf(given: string): string {
  const name = given.trim();
  if (name.length === 0 || name.length > MAX_TEAM_NAME_LENGTH) {
    throw new TeamError("team.name_taken");
  }
  return name;
}

/** Makes a team under a key no team and no project has, named once in the workspace, and tells the board. */
export async function createTeam(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    /** As the edge checked it: a project key's shape. */
    readonly key: string;
    readonly name: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, key, now } = input;
  const name = nameOf(input.name);
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const [counted] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(teams)
      .where(eq(teams.workspaceId, workspaceId));
    if ((counted?.count ?? 0) >= MAX_TEAMS) {
      throw new TeamError("team.too_many");
    }
    if (await keyTaken(tx, workspaceId, key)) {
      throw new TeamError("team.key_taken");
    }
    if ((await teamNamed(tx, workspaceId, name)) !== undefined) {
      throw new TeamError("team.name_taken");
    }
    const [row] = await tx
      .insert(teams)
      .values({ workspaceId, key, name, createdAt: now, createdBy: actor.id })
      .returning(columns);
    if (row === undefined) {
      throw new Error("team insert returned no row");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "team.created",
      actor,
      data: { team: name, key },
      now,
    });
    return { ...row, memberIds: [] };
  });
}

/** Renames a team, its key staying as it is, and tells the board the name before and after. */
export async function renameTeam(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly key: string;
    readonly name: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, key, now } = input;
  const name = nameOf(input.name);
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const current = await lockedTeam(tx, workspaceId, key);
    if (current.name !== name) {
      const taken = await teamNamed(tx, workspaceId, name);
      if (taken !== undefined && taken.id !== current.id) {
        throw new TeamError("team.name_taken");
      }
      await tx.update(teams).set({ name }).where(eq(teams.id, current.id));
      await recordEvent(tx, {
        workspaceId,
        kind: "team.renamed",
        actor,
        data: { team: name, name: current.name, key },
        now,
      });
    }
    const [team] = await toTeams(tx, [{ ...current, name }]);
    if (team === undefined) {
      throw new TeamError("team.not_found");
    }
    return team;
  });
}

/** Removes a team, with its memberships and the roles granted to it, and tells the board. */
export async function removeTeam(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly key: string;
    readonly now: Date;
  },
): Promise<void> {
  const { workspaceId, actor, key, now } = input;
  await drizzleOf(database).transaction(async (tx) => {
    const current = await lockedTeam(tx, workspaceId, key);
    await tx.delete(teams).where(eq(teams.id, current.id));
    await recordEvent(tx, {
      workspaceId,
      kind: "team.removed",
      actor,
      data: { team: current.name, key },
      now,
    });
  });
}

/** Puts an active person of the workspace in a team, once; tells the board whom. */
export async function addTeamMember(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly key: string;
    readonly personId: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, key, personId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const current = await lockedTeam(tx, workspaceId, key);
    const [person] = await tx
      .select({ id: people.id, login: people.login })
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
      throw new TeamError("team.invalid_member");
    }
    const added = await tx
      .insert(teamMembers)
      .values({ teamId: current.id, personId, addedAt: now, addedBy: actor.id })
      .onConflictDoNothing()
      .returning({ personId: teamMembers.personId });
    if (added.length > 0) {
      await recordEvent(tx, {
        workspaceId,
        kind: "team.member_added",
        actor,
        data: { team: current.name, key, login: person.login },
        now,
      });
    }
    const [team] = await toTeams(tx, [current]);
    if (team === undefined) {
      throw new TeamError("team.not_found");
    }
    return team;
  });
}

/** Takes a person out of a team, and tells the board whom. */
export async function removeTeamMember(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly key: string;
    readonly personId: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, key, personId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const current = await lockedTeam(tx, workspaceId, key);
    const removed = await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, current.id), eq(teamMembers.personId, personId)))
      .returning({ personId: teamMembers.personId });
    if (removed.length === 0) {
      throw new TeamError("team.not_a_member");
    }
    const [person] = await tx
      .select({ login: people.login })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);
    await recordEvent(tx, {
      workspaceId,
      kind: "team.member_removed",
      actor,
      data: { team: current.name, key, login: person?.login ?? personId },
      now,
    });
    const [team] = await toTeams(tx, [current]);
    if (team === undefined) {
      throw new TeamError("team.not_found");
    }
    return team;
  });
}
