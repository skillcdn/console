import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { type AccessSettings, administers, personVisibleTo } from "../../auth/policy.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { messengerAccounts, people, pluginInstalls } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";
import { type PersonRecord, personColumns, toPerson } from "./people.js";

// Which account at a messenger is a member's (ADR-0164). The console knows no member's account
// there by itself: a plugin that matches people to their accounts says it, under the capability
// `people:accounts`, and nothing else does. An agent account's runner asks by it who wrote a
// message that woke it, and whether a supervisor of the account did, whose word at the
// messenger instructs it (ADR-0160): so what is said counts only while the plugin that said it
// is enabled and still holds the capability, every change is an event of the workspace under the
// plugin's name, and an account nobody said is nobody's.

/**
 * How a change is said on the workspace's feed: as a change of the member, `person.updated`
 * with the field `account`, and `set` for whether the account is theirs now. A kind of event
 * of its own would be one a command of before does not read (ADR-0043).
 */
const said = { fields: ["account"], set: true };
const gone = { fields: ["account"], set: false };

/** The capability a plugin says an account under. */
export const ACCOUNTS_CAPABILITY = "people:accounts";

/**
 * On a `messenger_accounts` row: whether what it says counts now, which is while the plugin that
 * said it is enabled and holds the capability.
 */
const counts = sql<boolean>`exists (select 1 from ${pluginInstalls} where ${pluginInstalls.workspaceId} = ${messengerAccounts.workspaceId} and ${pluginInstalls.key} = ${messengerAccounts.plugin} and ${pluginInstalls.state} = 'enabled' and ${pluginInstalls.consent} @> ${JSON.stringify([ACCOUNTS_CAPABILITY])}::jsonb)`;

export interface MessengerAccountRecord {
  readonly id: string;
  readonly personId: string;
  /** The messenger by its name, the workspace there and the account, by the messenger's ids. */
  readonly messenger: string;
  readonly team: string;
  readonly account: string;
  /** The plugin that said it, by key. */
  readonly plugin: string;
  readonly createdAt: Date;
}

const columns = {
  id: messengerAccounts.id,
  personId: messengerAccounts.personId,
  messenger: messengerAccounts.messenger,
  team: messengerAccounts.team,
  account: messengerAccounts.account,
  plugin: messengerAccounts.plugin,
  createdAt: messengerAccounts.createdAt,
};

/** Why an account was not said: `code` is what the plugin is refused with. */
export type MessengerAccountRefusal = "not_a_person" | "another_plugins" | "too_many";

/**
 * Says that an account at a messenger is a member's, for the plugin `plugin`. One member for an
 * account and one account of a member in a workspace there: what the plugin said before of the
 * account or of the member in that workspace gives way, each as an event. What another plugin
 * said of either stands while it counts, and this is refused; what counts no more, of a plugin
 * that was disabled or lost the capability, gives way too, so that the one in its place is not
 * kept out by it. Said again as it stands, nothing changes and nothing is recorded.
 */
export async function putMessengerAccount(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly plugin: string;
    readonly messenger: string;
    readonly team: string;
    readonly account: string;
    readonly personId: string;
    /** Whoever made the plugin say it, where a person's call did; nobody for the plugin itself. */
    readonly actor: Actor | undefined;
    /** How many accounts a workspace keeps, of every messenger together. */
    readonly most: number;
    readonly now: Date;
  },
): Promise<MessengerAccountRecord | MessengerAccountRefusal> {
  const { workspaceId, plugin, messenger, team, account, personId, actor, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    // One workspace's accounts are said one at a time, so that two said at once neither pass
    // the bound nor meet at the indexes.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`messenger_accounts:${workspaceId}`}))`,
    );
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
      return "not_a_person";
    }
    const here = and(
      eq(messengerAccounts.workspaceId, workspaceId),
      eq(messengerAccounts.messenger, messenger),
      eq(messengerAccounts.team, team),
    );
    const standing = await tx
      .select({ ...columns, login: people.login, counts })
      .from(messengerAccounts)
      .innerJoin(people, eq(people.id, messengerAccounts.personId))
      .where(
        and(
          here,
          or(eq(messengerAccounts.account, account), eq(messengerAccounts.personId, personId)),
        ),
      );
    const [same] = standing;
    if (
      standing.length === 1 &&
      same !== undefined &&
      same.plugin === plugin &&
      same.account === account &&
      same.personId === personId
    ) {
      const { login: _login, counts: _counts, ...kept } = same;
      return kept;
    }
    if (standing.some((row) => row.plugin !== plugin && row.counts)) {
      return "another_plugins";
    }
    for (const row of standing) {
      await tx.delete(messengerAccounts).where(eq(messengerAccounts.id, row.id));
      await recordEvent(tx, {
        workspaceId,
        kind: "person.updated",
        actor,
        plugin,
        data: { ...gone, login: row.login, messenger, workspace: team, account: row.account },
        now,
      });
    }
    const [kept] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(messengerAccounts)
      .where(eq(messengerAccounts.workspaceId, workspaceId));
    if ((kept?.count ?? 0) >= input.most) {
      return "too_many";
    }
    const [row] = await tx
      .insert(messengerAccounts)
      .values({ workspaceId, messenger, team, account, personId, plugin, createdAt: now })
      .returning(columns);
    if (row === undefined) {
      throw new Error("the account said was not found");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "person.updated",
      actor,
      plugin,
      data: { ...said, login: person.login, messenger, workspace: team, account },
      now,
    });
    return row;
  });
}

/** Takes back what the plugin said of a member's account in a workspace of a messenger; whether it had said one. */
export async function removeMessengerAccount(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly plugin: string;
    readonly messenger: string;
    readonly team: string;
    readonly personId: string;
    readonly actor: Actor | undefined;
    readonly now: Date;
  },
): Promise<boolean> {
  const { workspaceId, plugin, messenger, team, personId, actor, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [row] = await tx
      .delete(messengerAccounts)
      .where(
        and(
          eq(messengerAccounts.workspaceId, workspaceId),
          eq(messengerAccounts.plugin, plugin),
          eq(messengerAccounts.messenger, messenger),
          eq(messengerAccounts.team, team),
          eq(messengerAccounts.personId, personId),
        ),
      )
      .returning({ account: messengerAccounts.account });
    if (row === undefined) {
      return false;
    }
    const [person] = await tx
      .select({ login: people.login })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);
    await recordEvent(tx, {
      workspaceId,
      kind: "person.updated",
      actor,
      plugin,
      data: { ...gone, login: person?.login, messenger, workspace: team, account: row.account },
      now,
    });
    return true;
  });
}

/**
 * Forgets everything a plugin said, as it is purged, each as an event: a package installed later
 * under the same key has said nothing until it says it.
 */
export async function forgetMessengerAccounts(
  tx: Transaction,
  input: {
    readonly workspaceId: string;
    readonly plugin: string;
    readonly actor: Actor;
    readonly now: Date;
  },
): Promise<void> {
  const { workspaceId, plugin, actor, now } = input;
  const mine = and(
    eq(messengerAccounts.workspaceId, workspaceId),
    eq(messengerAccounts.plugin, plugin),
  );
  const rows = await tx
    .select({ ...columns, login: people.login })
    .from(messengerAccounts)
    .innerJoin(people, eq(people.id, messengerAccounts.personId))
    .where(mine)
    .orderBy(asc(messengerAccounts.id));
  await tx.delete(messengerAccounts).where(mine);
  for (const row of rows) {
    await recordEvent(tx, {
      workspaceId,
      kind: "person.updated",
      actor,
      plugin,
      data: {
        ...gone,
        login: row.login,
        messenger: row.messenger,
        workspace: row.team,
        account: row.account,
      },
      now,
    });
  }
}

/** What the plugin said of a workspace of a messenger, in the order it was said, a page at a time. */
export async function listMessengerAccounts(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly plugin: string;
    readonly messenger: string;
    readonly team: string;
    /** The id of the last one read, to read on from. */
    readonly after?: string | undefined;
    readonly limit: number;
  },
): Promise<MessengerAccountRecord[]> {
  return drizzleOf(database)
    .select(columns)
    .from(messengerAccounts)
    .where(
      and(
        eq(messengerAccounts.workspaceId, input.workspaceId),
        eq(messengerAccounts.plugin, input.plugin),
        eq(messengerAccounts.messenger, input.messenger),
        eq(messengerAccounts.team, input.team),
        input.after === undefined ? undefined : gt(messengerAccounts.id, input.after),
      ),
    )
    .orderBy(asc(messengerAccounts.id))
    .limit(input.limit);
}

/** Who an account at a messenger is to an agent account, as the console knows it. */
export interface AccountWriter {
  readonly workspace: string;
  readonly account: string;
  /**
   * Whether the console is told the accounts of that workspace at all, by a plugin that is
   * enabled and holds the capability: where it is not, nothing is known of any account there,
   * and that an account is no member's is not said.
   */
  readonly told: boolean;
  /** The member whose account it is, where one is said and they are active. */
  readonly member:
    | {
        readonly person: PersonRecord;
        /** Whether the account that asks may see the member, and so read their login (ADR-0035). */
        readonly seen: boolean;
        /** Whether they supervise the agent account (ADR-0084): an administrator, or above it in the reporting line. */
        readonly supervisor: boolean;
        /** Whether they administer the workspace: a supervisor of every agent account, in its line or not. */
        readonly administrator: boolean;
        /**
         * Where they stand in the reporting line of whoever asks: whom it reports to, anyone
         * further above, whoever reports to it, anyone further below, or nowhere in it.
         */
        readonly line: "manager" | "above" | "report" | "below" | undefined;
      }
    | undefined;
}

/**
 * Who wrote, for an agent account's runner: of each account at a messenger, the member it is and
 * whether they supervise `agent`. Only what a plugin said that is enabled now and holds the
 * capability now counts; a member who is deactivated is nobody; and a supervisor is who
 * `supervises` says: an administrator, or whoever is above the account in the reporting line.
 *
 * The relation is read whole, both ways (AGENTS.md, "Conventions"): the direct link, every
 * level of the line, and administrators. Above the account its manager and everyone above
 * them; below it whoever reports to it and everyone below them; and an administrator, who
 * supervises from outside the line and may stand anywhere in it as well.
 *
 * A member the account may not see, as the workspace has it, is said to be a member and nothing
 * more: whoever is in its line it is told of, its supervisors among them.
 */
export async function writersFor(
  database: Database,
  agent: PersonRecord,
  settings: AccessSettings,
  messenger: string,
  accounts: readonly { readonly workspace: string; readonly account: string }[],
): Promise<AccountWriter[]> {
  if (accounts.length === 0) {
    return [];
  }
  const db = drizzleOf(database);
  const trusted = and(
    eq(messengerAccounts.workspaceId, agent.workspaceId),
    eq(messengerAccounts.messenger, messenger),
    counts,
  );
  const teams = [...new Set(accounts.map((one) => one.workspace))];
  const told = new Set(
    (
      await db
        .selectDistinct({ team: messengerAccounts.team })
        .from(messengerAccounts)
        .where(and(trusted, inArray(messengerAccounts.team, teams)))
    ).map((row) => row.team),
  );
  const rows = await db
    .select({
      team: messengerAccounts.team,
      account: messengerAccounts.account,
      person: personColumns(people),
      visible: sql<boolean>`${personVisibleTo(agent, settings)}`,
    })
    .from(messengerAccounts)
    .innerJoin(people, eq(people.id, messengerAccounts.personId))
    .where(
      and(
        trusted,
        eq(people.status, "active"),
        inArray(messengerAccounts.team, teams),
        inArray(messengerAccounts.account, [...new Set(accounts.map((one) => one.account))]),
      ),
    );
  // Whoever is above the account in the reporting line: its manager, and theirs, to the top.
  // The line never loops (`updatePersonManager` sees to it), so the climb ends.
  const above = new Set(
    (
      await db.execute<{ id: string }>(
        sql`with recursive above(id) as (select manager_id from people where id = ${agent.id}::uuid union select p.manager_id from people p join above on p.id = above.id where p.manager_id is not null) select id from above where id is not null`,
      )
    ).rows.map((row) => row.id),
  );
  const found = new Map(
    rows.map((row) => [
      `${row.team} ${row.account}`,
      { person: toPerson(row.person), visible: row.visible },
    ]),
  );
  // Whoever is below the account, at any depth: climbed from each member found, since they are
  // few and what is below an account may be many. Pairs, so that the climb ends as the one
  // above does.
  const members = [...new Set(rows.map((row) => row.person.id))];
  const below = new Set(
    members.length === 0
      ? []
      : (
          await db.execute<{ start: string }>(
            sql`with recursive up(start, id) as (select id, manager_id from people where id in (${sql.join(
              members.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}) and manager_id is not null union select up.start, p.manager_id from people p join up on p.id = up.id where p.manager_id is not null) select start from up where id = ${agent.id}::uuid`,
          )
        ).rows.map((row) => row.start),
  );
  const lineOf = (person: PersonRecord): "manager" | "above" | "report" | "below" | undefined =>
    person.id === agent.managerId
      ? "manager"
      : above.has(person.id)
        ? "above"
        : person.managerId === agent.id
          ? "report"
          : below.has(person.id)
            ? "below"
            : undefined;
  return accounts.map(({ workspace, account }) => {
    const one = found.get(`${workspace} ${account}`);
    if (one === undefined) {
      return { workspace, account, told: told.has(workspace), member: undefined };
    }
    const { person } = one;
    const line = lineOf(person);
    return {
      workspace,
      account,
      told: told.has(workspace),
      member: {
        person,
        seen: one.visible || line !== undefined,
        supervisor: agent.kind === "agent" && (administers(person) || above.has(person.id)),
        administrator: administers(person),
        line,
      },
    };
  });
}
