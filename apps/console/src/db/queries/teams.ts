import { MAX_TEAM_NAME_LENGTH, MAX_TEAMS } from "@skillcdn/console/api";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { people, teamMembers, teams, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";

// The teams of a workspace (ADR-0073): a name and its members, kept by an administrator. A team
// is a unit to call people by and to grant a plugin's role to, nothing more: no head, no team
// above it, since the reporting line already says who is above whom. A person is in any number.

export interface TeamRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  /** Who is in, by id, in the order they came. */
  readonly memberIds: readonly string[];
  readonly createdAt: Date;
}

export type TeamErrorCode =
  | "team.not_found"
  | "team.name_taken"
  | "team.too_many"
  | "team.invalid_member"
  | "team.not_a_member";

const MESSAGES: Record<TeamErrorCode, string> = {
  "team.not_found": "The team was not found.",
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
  name: teams.name,
  createdAt: teams.createdAt,
};

type Handle = Transaction | ReturnType<typeof drizzleOf>;

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

async function toTeams(
  handle: Handle,
  rows: readonly { id: string; workspaceId: string; name: string; createdAt: Date }[],
): Promise<TeamRecord[]> {
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

/** One team, or none. */
export async function findTeam(
  database: Database,
  workspaceId: string,
  teamId: string,
): Promise<TeamRecord | undefined> {
  const handle = drizzleOf(database);
  const rows = await handle
    .select(columns)
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.id, teamId)))
    .limit(1);
  return (await toTeams(handle, rows))[0];
}

/** The teams each person of the workspace is in, by person, the teams by name. */
export async function teamIdsByPerson(
  database: Database,
  workspaceId: string,
): Promise<Map<string, string[]>> {
  const rows = await drizzleOf(database)
    .select({ personId: teamMembers.personId, teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teams.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${teams.name})`), asc(teams.id));
  const byPerson = new Map<string, string[]>();
  for (const row of rows) {
    const list = byPerson.get(row.personId);
    if (list === undefined) {
      byPerson.set(row.personId, [row.teamId]);
    } else {
      list.push(row.teamId);
    }
  }
  return byPerson;
}

/** Holds the workspace's row while teams change, so that two changes never race past the bounds. */
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

/** The team to change, held for the transaction; none is `team.not_found`. */
async function lockedTeam(
  tx: Transaction,
  workspaceId: string,
  teamId: string,
): Promise<{ id: string; workspaceId: string; name: string; createdAt: Date }> {
  const [row] = await tx
    .select(columns)
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.id, teamId)))
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

/** Makes a team, named once in the workspace, and tells the board. */
export async function createTeam(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly name: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, now } = input;
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
    if ((await teamNamed(tx, workspaceId, name)) !== undefined) {
      throw new TeamError("team.name_taken");
    }
    const [row] = await tx
      .insert(teams)
      .values({ workspaceId, name, createdAt: now, createdBy: actor.id })
      .returning(columns);
    if (row === undefined) {
      throw new Error("team insert returned no row");
    }
    await recordEvent(tx, { workspaceId, kind: "team.created", actor, data: { team: name }, now });
    return { ...row, memberIds: [] };
  });
}

/** Renames a team, and tells the board the name before and after. */
export async function renameTeam(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly teamId: string;
    readonly name: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, teamId, now } = input;
  const name = nameOf(input.name);
  return drizzleOf(database).transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const current = await lockedTeam(tx, workspaceId, teamId);
    if (current.name !== name) {
      const taken = await teamNamed(tx, workspaceId, name);
      if (taken !== undefined && taken.id !== teamId) {
        throw new TeamError("team.name_taken");
      }
      await tx.update(teams).set({ name }).where(eq(teams.id, teamId));
      await recordEvent(tx, {
        workspaceId,
        kind: "team.renamed",
        actor,
        data: { team: name, name: current.name },
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
    readonly teamId: string;
    readonly now: Date;
  },
): Promise<void> {
  const { workspaceId, actor, teamId, now } = input;
  await drizzleOf(database).transaction(async (tx) => {
    const current = await lockedTeam(tx, workspaceId, teamId);
    await tx.delete(teams).where(eq(teams.id, teamId));
    await recordEvent(tx, {
      workspaceId,
      kind: "team.removed",
      actor,
      data: { team: current.name },
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
    readonly teamId: string;
    readonly personId: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, teamId, personId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const current = await lockedTeam(tx, workspaceId, teamId);
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
      .values({ teamId, personId, addedAt: now, addedBy: actor.id })
      .onConflictDoNothing()
      .returning({ personId: teamMembers.personId });
    if (added.length > 0) {
      await recordEvent(tx, {
        workspaceId,
        kind: "team.member_added",
        actor,
        data: { team: current.name, login: person.login },
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
    readonly teamId: string;
    readonly personId: string;
    readonly now: Date;
  },
): Promise<TeamRecord> {
  const { workspaceId, actor, teamId, personId, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const current = await lockedTeam(tx, workspaceId, teamId);
    const removed = await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.personId, personId)))
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
      data: { team: current.name, login: person?.login ?? personId },
      now,
    });
    const [team] = await toTeams(tx, [current]);
    if (team === undefined) {
      throw new TeamError("team.not_found");
    }
    return team;
  });
}
