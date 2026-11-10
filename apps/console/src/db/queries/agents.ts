import type { ProviderKey, RestAvatarParts } from "@skillcdn/console/api";
import { and, asc, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { listings, people, projectMembers, projects, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// The agent accounts of the workspace (ADR-0084): members of their own, rows of the directory
// with `kind = 'agent'`, made by an administrator and bound to their provider's account at
// their first sign-in. Everything a member is, they are by the directory's own queries; what is
// here is what only an agent account has: how one is made, and how they are listed.

/** What is wrong with a change to an agent account. `code` is what the API answers with. */
export class AgentError extends DomainError {
  constructor(
    code:
      | "agent.not_found"
      | "agent.handle_taken"
      | "agent.exists"
      | "agent.administrator"
      | "agent.invalid_manager"
      | "agent.invalid_project",
  ) {
    super(code, AGENT_ERROR_WORDS[code]);
  }
}

const AGENT_ERROR_WORDS = {
  "agent.not_found": "the agent account was not found",
  "agent.handle_taken": "another agent account has this handle",
  "agent.exists": "the login is an agent account already",
  "agent.administrator": "an administrator is not made an agent account",
  "agent.invalid_manager":
    "the manager is not another active member of the workspace, or reports to this account",
  "agent.invalid_project": "the project it starts in was not found",
} as const;

/** An agent account with whom it reports to, as one asker reads it. */
export interface AgentRecord {
  readonly person: PersonRecord;
  /** Whom it reports to, where the asker may see them; an agent account always has a manager. */
  readonly manager: PersonRecord | undefined;
  /** Whether the asker supervises it (auth/policy.ts). */
  readonly supervised: boolean;
}

/** Who reads the agent accounts: the policy's conditions for the asker, each on a `people` row. */
export interface AgentReader {
  /** Whether the asker may see the member. */
  readonly visible: SQL;
  /** Whether the asker supervises the member. */
  readonly supervises: SQL;
}

/** The managers of the agent accounts read: `people` again, under another name. */
const managers = alias(people, "managers");

const sameLogin = (login: string): SQL => sql`lower(${people.login}) = lower(${login})`;

/** Whether `managerId` reports to `personId`, directly or through others: naming them its manager would close a loop. */
async function reportsTo(tx: Transaction, managerId: string, personId: string): Promise<boolean> {
  let above: string | null = managerId;
  for (let steps = 0; above !== null && steps < 1000; steps += 1) {
    if (above === personId) {
      return true;
    }
    const [next]: { managerId: string | null }[] = await tx
      .select({ managerId: people.managerId })
      .from(people)
      .where(eq(people.id, above))
      .limit(1);
    above = next?.managerId ?? null;
  }
  return false;
}

export interface AgentAccountInput {
  readonly workspaceId: string;
  readonly actor: Actor;
  /** The account it signs in with: the provider, and the login there, as the administrator spelled it. */
  readonly host: ProviderKey;
  readonly login: string;
  readonly handle: string;
  readonly name: string;
  readonly title: string | undefined;
  readonly avatarSeed: string | undefined;
  readonly avatarParts: RestAvatarParts;
  /** Whom it reports to: an active member of the workspace. */
  readonly managerId: string;
  /** The project it starts in, by key. */
  readonly projectKey: string;
  readonly now: Date;
}

/**
 * Makes an agent account, and tells the board (ADR-0084). The member's row is written at once,
 * so that work can be assigned to it before anyone signed in with it, and the login is let in as
 * a listing lets one in; the first sign-in with that login binds the provider's account to the
 * row (`savePerson`). A login a member already carries is made an agent account the same way,
 * once: the member's row becomes the account, with everything it did, unless they administer
 * the workspace. The account is listed in the project it starts in, where the project lists its
 * members. Its manager is another active member, who does not report to it.
 */
export async function createAgentAccount(
  database: Database,
  input: AgentAccountInput,
): Promise<AgentRecord> {
  const { workspaceId, actor, host, login, handle, name, title, avatarSeed, avatarParts, now } =
    input;
  return drizzleOf(database).transaction(async (tx) => {
    // The workspace's row first, as every change to the directory takes it.
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    const [taken] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.workspaceId, workspaceId), eq(people.handle, handle)))
      .limit(1);
    if (taken !== undefined) {
      throw new AgentError("agent.handle_taken");
    }
    const [manager] = await tx
      .select(personColumns(people))
      .from(people)
      .where(
        and(
          eq(people.workspaceId, workspaceId),
          eq(people.id, input.managerId),
          eq(people.status, "active"),
        ),
      )
      .limit(1);
    if (manager === undefined) {
      throw new AgentError("agent.invalid_manager");
    }
    const [project] = await tx
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        visibility: projects.visibility,
      })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.key, input.projectKey)))
      .limit(1);
    if (project === undefined) {
      throw new AgentError("agent.invalid_project");
    }
    // Whoever carries the login already: a member in before one out, an account signed in with
    // before a row that waits for its first sign-in.
    const [member] = await tx
      .select(personColumns(people))
      .from(people)
      .where(and(eq(people.workspaceId, workspaceId), eq(people.host, host), sameLogin(login)))
      .orderBy(asc(people.status), asc(sql`${people.hostAccountId} is null`))
      .limit(1);
    const persona = {
      kind: "agent" as const,
      handle,
      name,
      // The picture is drawn from the parts: none of the provider's is kept beside them.
      avatarUrl: null,
      avatarSeed: avatarSeed ?? null,
      avatarParts,
      managerId: manager.id,
      updatedAt: now,
    };
    let row: Parameters<typeof toPerson>[0] | undefined;
    if (member !== undefined) {
      if (member.kind === "agent") {
        throw new AgentError("agent.exists");
      }
      if (member.role === "admin") {
        throw new AgentError("agent.administrator");
      }
      if (await reportsTo(tx, manager.id, member.id)) {
        throw new AgentError("agent.invalid_manager");
      }
      [row] = await tx
        .update(people)
        .set({ ...persona, ...(title === undefined ? {} : { title }) })
        .where(eq(people.id, member.id))
        .returning(personColumns(people));
      await recordEvent(tx, {
        workspaceId,
        kind: "person.updated",
        actor,
        data: { login: member.login, handle, fields: ["kind"] },
        now,
      });
    } else {
      [row] = await tx
        .insert(people)
        .values({
          ...persona,
          workspaceId,
          host,
          hostAccountId: null,
          login,
          title: title ?? null,
          role: "member",
          source: "listed",
          lastLoginAt: null,
        })
        .returning(personColumns(people));
      if (row !== undefined) {
        // Let in as a listing lets a login in (ADR-0022), and the listing is the account's from
        // the start. One an administrator made for the login before is taken over; one bound to
        // a member who has since been renamed is spelled as they are called now, since the
        // login is theirs no longer.
        await tx
          .update(listings)
          .set({
            login: sql`(select p.login from ${people} p where p.id = ${listings.personId})`,
          })
          .where(
            and(
              eq(listings.workspaceId, workspaceId),
              eq(listings.host, host),
              isNotNull(listings.personId),
              sql`lower(${listings.login}) = lower(${login})`,
            ),
          );
        const [listed] = await tx
          .update(listings)
          .set({ personId: row.id })
          .where(
            and(
              eq(listings.workspaceId, workspaceId),
              eq(listings.host, host),
              isNull(listings.personId),
              sql`lower(${listings.login}) = lower(${login})`,
            ),
          )
          .returning({ id: listings.id });
        if (listed === undefined) {
          await tx
            .insert(listings)
            .values({ workspaceId, host, login, personId: row.id, listedById: actor.id });
        }
      }
      await recordEvent(tx, {
        workspaceId,
        kind: "person.listed",
        actor,
        data: { login, handle },
        now,
      });
    }
    if (row === undefined) {
      throw new Error("agent account write returned no row");
    }
    const person = toPerson(row);
    // A project open to the workspace has everyone in it; a private one lists its members.
    if (project.visibility === "private") {
      const [added] = await tx
        .insert(projectMembers)
        .values({ projectId: project.id, personId: person.id, role: "member", createdAt: now })
        .onConflictDoNothing()
        .returning({ personId: projectMembers.personId });
      if (added !== undefined) {
        await recordEvent(tx, {
          workspaceId,
          projectId: project.id,
          kind: "project.member_added",
          actor,
          data: { key: project.key, name: project.name, login: person.login, role: "member" },
          now,
        });
      }
    }
    // Made by an administrator, who supervises every agent account.
    return { person, manager: toPerson(manager), supervised: true };
  });
}

/** The account, its manager, whether the asker may see the manager (`visible`, read on the manager's own row), and whether they supervise the account. */
const agentColumns = (reader: AgentReader) => ({
  person: personColumns(people),
  manager: personColumns(managers),
  managerVisible: sql<boolean>`exists (select 1 from ${people} where ${people.id} = ${managers.id} and ${reader.visible})`,
  supervised: sql<boolean>`${reader.supervises}`,
});

type AgentRow = {
  readonly person: Parameters<typeof toPerson>[0];
  readonly manager: Parameters<typeof toPerson>[0] | null;
  readonly managerVisible: boolean;
  readonly supervised: boolean;
};

const toAgent = (row: AgentRow): AgentRecord => ({
  person: toPerson(row.person),
  manager: row.manager === null || !row.managerVisible ? undefined : toPerson(row.manager),
  supervised: row.supervised,
});

/** An agent account the asker may read: one they may see as a member, or one they supervise. */
const readable = (workspaceId: string, reader: AgentReader): SQL | undefined =>
  and(
    eq(people.workspaceId, workspaceId),
    eq(people.kind, "agent"),
    or(reader.visible, reader.supervises),
  );

/** The agent accounts of the workspace the asker may read, those in first, by handle. */
export async function listAgents(
  database: Database,
  workspaceId: string,
  reader: AgentReader,
): Promise<AgentRecord[]> {
  const rows = await drizzleOf(database)
    .select(agentColumns(reader))
    .from(people)
    .leftJoin(managers, eq(managers.id, people.managerId))
    .where(readable(workspaceId, reader))
    .orderBy(asc(people.status), asc(people.handle));
  return rows.map(toAgent);
}

/** One agent account by its handle, as the asker may read it, or nothing. */
export async function findAgent(
  database: Database,
  workspaceId: string,
  handle: string,
  reader: AgentReader,
): Promise<AgentRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(agentColumns(reader))
    .from(people)
    .leftJoin(managers, eq(managers.id, people.managerId))
    .where(and(readable(workspaceId, reader), eq(people.handle, handle)))
    .limit(1);
  return row === undefined ? undefined : toAgent(row);
}

/** Whether two avatars are made of the same parts, in whatever order each was written down. */
function sameParts(a: RestAvatarParts, b: RestAvatarParts | null): boolean {
  return (
    b !== null &&
    (Object.keys(a) as (keyof RestAvatarParts)[]).every((part) => a[part] === b[part]) &&
    Object.keys(a).length === Object.keys(b).length
  );
}

/** The handles the workspace's agent accounts have, whoever may see them: what a proposal must not repeat. */
export async function takenHandles(database: Database, workspaceId: string): Promise<string[]> {
  const rows = await drizzleOf(database)
    .select({ handle: people.handle })
    .from(people)
    .where(and(eq(people.workspaceId, workspaceId), isNotNull(people.handle)));
  return rows.flatMap((row) => (row.handle === null ? [] : [row.handle]));
}

/**
 * Keeps an agent account's persona, and tells the board (ADR-0084): its name, its title, its
 * avatar, one or more; the handle never changes. For whoever supervises it (`reader.supervises`):
 * an account they do not is not found. What is already so writes nothing.
 */
export async function updateAgentPersona(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly handle: string;
    readonly reader: AgentReader;
    readonly name?: string | undefined;
    /** The title, or null for none. */
    readonly title?: string | null | undefined;
    readonly avatarParts?: RestAvatarParts | undefined;
    /** What the parts were rolled from, or null for parts chosen by hand; read only with the parts. */
    readonly avatarSeed?: string | null | undefined;
    readonly now: Date;
  },
): Promise<AgentRecord> {
  const { workspaceId, actor, handle, reader, now } = input;
  await drizzleOf(database).transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    const [current] = await tx
      .select(personColumns(people))
      .from(people)
      .where(
        and(
          eq(people.workspaceId, workspaceId),
          eq(people.kind, "agent"),
          eq(people.handle, handle),
          reader.supervises,
        ),
      )
      .limit(1);
    if (current === undefined) {
      throw new AgentError("agent.not_found");
    }
    const fields: string[] = [];
    if (input.name !== undefined && input.name !== current.name) {
      fields.push("name");
    }
    if (input.title !== undefined && input.title !== current.title) {
      fields.push("title");
    }
    if (input.avatarParts !== undefined && !sameParts(input.avatarParts, current.avatarParts)) {
      fields.push("avatar");
    }
    if (fields.length === 0) {
      return;
    }
    await tx
      .update(people)
      .set({
        ...(fields.includes("name") ? { name: input.name } : {}),
        ...(fields.includes("title") ? { title: input.title } : {}),
        ...(fields.includes("avatar")
          ? { avatarParts: input.avatarParts, avatarSeed: input.avatarSeed ?? null }
          : {}),
        updatedAt: now,
      })
      .where(eq(people.id, current.id));
    await recordEvent(tx, {
      workspaceId,
      kind: "person.updated",
      actor,
      data: { login: current.login, handle, fields },
      now,
    });
  });
  const changed = await findAgent(database, workspaceId, handle, reader);
  if (changed === undefined) {
    throw new AgentError("agent.not_found");
  }
  return changed;
}
