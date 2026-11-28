import { randomUUID } from "node:crypto";
import process from "node:process";
import { AUTH_ROUTES, SIGN_IN_PARAM } from "@skillcdn/console/api";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRotation, createSecrets } from "../auth/secrets.js";
import { ConfigError, loadConfig } from "../config/config.js";
import { drizzleOf } from "../db/client.js";
import {
  leaveSecretOffer,
  offerSecret,
  takeSecretOffer,
} from "../db/queries/agent-secret-offers.js";
import { readSecret, setSecret } from "../db/queries/agent-secrets.js";
import { startPackConnect } from "../db/queries/pack-connects.js";
import { resealAll, type SEALED_KINDS } from "../db/queries/reseal.js";
import {
  agentSecretAccesses,
  agentSecretOffers,
  agentSecrets,
  packConnects,
  people,
  pluginKeyedSecrets,
  pluginSecrets,
  projects,
  workspacePackConnects,
  workspaces,
} from "../db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { cookieOf, createHarness, type Harness, SIGN_IN_URL } from "../testing/harness.js";
import { runReseal } from "./reseal.js";

// A rotation of the deployment's secret (ADR-0127), against a database that holds a value of
// every kind the console seals, each sealed under the secret before: the console reads them all
// beside the new secret, `migrate reseal` seals them again, and the secret before can go.

const OLD = "the secret the deployment had before, long enough";
const NEW = "the secret the deployment has now, long enough too";
const OTHER = "a secret this deployment never had, as long as one is";
/** What someone gives as the secret before when it is not: a value mistyped, or another's. */
const WRONG = "the secret the deployment had before, long enough.";
const NOW = new Date("2026-11-15T09:00:00Z");
/** More rows than the step reads at a time, of the two kinds whose key has several columns. */
const MANY = 450;

let testDatabase: TestDatabase;
let h: Harness;
let workspaceId: string;
let projectId: string;
let aliceId: string;
/** The offer that waits through the rotation, and what it holds: drawn when the test runs. */
let offerId: string;
const OFFERED = `offered ${randomUUID()}`;

const before = createSecrets(OLD);
const now = createSecrets(NEW);
const both = createSecrets(NEW, OLD);
const never = createSecrets(OTHER);

const db = () => drizzleOf(testDatabase.database);

/** Every sealed value the database holds, by kind, as the rows hold it. */
async function sealedValues(): Promise<Record<(typeof SEALED_KINDS)[number], string[]>> {
  const handle = db();
  const some = (values: (string | null)[]): string[] =>
    values.filter((value): value is string => value !== null);
  return {
    workspacePackTokens: some(
      (await handle.select({ sealed: workspaces.packToken }).from(workspaces)).map(
        (row) => row.sealed,
      ),
    ),
    projectPackTokens: some(
      (await handle.select({ sealed: projects.packToken }).from(projects)).map((row) => row.sealed),
    ),
    workspacePackConnections: (
      await handle.select({ sealed: workspacePackConnects.secret }).from(workspacePackConnects)
    ).map((row) => row.sealed),
    projectPackConnections: (
      await handle.select({ sealed: packConnects.secret }).from(packConnects)
    ).map((row) => row.sealed),
    pluginSecrets: (
      await handle
        .select({ sealed: pluginSecrets.sealed })
        .from(pluginSecrets)
        .orderBy(asc(pluginSecrets.name))
    ).map((row) => row.sealed),
    pluginKeyedSecrets: (
      await handle
        .select({ sealed: pluginKeyedSecrets.sealed })
        .from(pluginKeyedSecrets)
        .orderBy(asc(pluginKeyedSecrets.name), asc(pluginKeyedSecrets.key))
    ).map((row) => row.sealed),
    agentSecrets: (
      await handle
        .select({ sealed: agentSecrets.sealed })
        .from(agentSecrets)
        .orderBy(asc(agentSecrets.name))
    ).map((row) => row.sealed),
    agentSecretOffers: some(
      (
        await handle
          .select({ sealed: agentSecretOffers.sealed })
          .from(agentSecretOffers)
          .orderBy(asc(agentSecretOffers.id))
      ).map((row) => row.sealed),
    ),
  };
}

/** The role's step, as a deployment runs it: configured by the environment, with what it logs kept. */
async function reseal(
  environment: Record<string, string>,
): Promise<{ readonly left: number; readonly lines: Record<string, unknown>[] }> {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "info" },
    { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  const { left } = await runReseal(
    loadConfig(
      {
        DATABASE_URL: testDatabase.connectionString,
        PUBLIC_URL: "https://console.example.test",
        GITHUB_CLIENT_ID: "Iv23liExampleClientId",
        GITHUB_CLIENT_SECRET: "client-secret-of-the-app",
        ...environment,
      },
      () => {
        throw new Error("no file is read");
      },
    ),
    logger,
  );
  return { left, lines };
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider("gh")],
    admins: ["alice"],
    listed: ["alice"],
  });
  const alice = await h.signIn("alice");
  await h.project(alice, { key: "ops", name: "Operations", visibility: "private" });
  const handle = db();
  const [workspace] = await handle.select({ id: workspaces.id }).from(workspaces);
  const [project] = await handle.select({ id: projects.id }).from(projects);
  const [person] = await handle.select({ id: people.id }).from(people);
  if (workspace === undefined || project === undefined || person === undefined) {
    throw new Error("the fixture made no workspace, no project or no person");
  }
  workspaceId = workspace.id;
  projectId = project.id;
  aliceId = person.id;

  // One value of every kind, sealed as the console of before sealed it.
  await handle
    .update(workspaces)
    .set({ packToken: before.seal("pack-token", "the organization's token"), packTokenSetAt: NOW })
    .where(eq(workspaces.id, workspaceId));
  await handle
    .update(projects)
    .set({ packToken: before.seal("pack-token", "the project's token"), packTokenSetAt: NOW })
    .where(eq(projects.id, projectId));
  const connection = {
    address: "/gh/acme/skills",
    code: "ABCD-EFGH",
    url: "https://skillcdn.example.test/connect/ABCD-EFGH",
    intervalSeconds: 5,
    startedById: aliceId,
    expiresAt: new Date(NOW.getTime() + 600_000),
    now: NOW,
  };
  await startPackConnect(testDatabase.database, {
    ...connection,
    holder: { workspace: workspaceId },
    sealedSecret: before.seal("pack-connect", "the workspace's claim"),
  });
  await startPackConnect(testDatabase.database, {
    ...connection,
    holder: { project: projectId },
    sealedSecret: before.seal("pack-connect", "the project's claim"),
  });
  await handle.insert(pluginSecrets).values([
    {
      workspaceId,
      pluginKey: "ledger",
      name: "apiKey",
      sealed: before.seal("plugin-secret", "the plugin's key"),
      setAt: NOW,
    },
    // Sealed under a secret this deployment never had: neither of its two opens it.
    {
      workspaceId,
      pluginKey: "ledger",
      name: "lost",
      sealed: never.seal("plugin-secret", "nobody reads this"),
      setAt: NOW,
    },
    // And what was never a sealed value at all.
    { workspaceId, pluginKey: "ledger", name: "torn", sealed: "v1.AAAA", setAt: NOW },
  ]);
  await handle.insert(pluginKeyedSecrets).values(
    Array.from({ length: MANY }, (_, index) => ({
      workspaceId,
      pluginKey: "ledger",
      name: "botToken",
      key: `T${String(index).padStart(4, "0")}`,
      sealed: before.seal("plugin-secret", `token ${index}`),
      setAt: NOW,
      source: "administrator",
    })),
  );
  for (let index = 0; index < MANY; index += 1) {
    await setSecret(testDatabase.database, before, {
      accountId: aliceId,
      name: `s${String(index).padStart(4, "0")}`,
      value: `value ${index}`,
      expiresOn: null,
      actor: { id: aliceId },
      seeded: false,
      limit: MANY,
      now: NOW,
    });
  }
  // A secret offered to the account that still waits (ADR-0169), sealed as the console of
  // before sealed it, and one the account left, which holds no value any more.
  const offered = {
    accountId: aliceId,
    note: null,
    expiresOn: null,
    actor: { id: aliceId },
    waiting: 20,
    byOne: 5,
    days: 7,
    kept: 200,
    now: NOW,
  };
  const waits = await offerSecret(testDatabase.database, before, {
    ...offered,
    name: "x-offered",
    value: OFFERED,
  });
  offerId = waits.id;
  const left = await offerSecret(testDatabase.database, before, {
    ...offered,
    name: "x-left",
    value: `left ${randomUUID()}`,
  });
  await leaveSecretOffer(testDatabase.database, {
    accountId: aliceId,
    offerId: left.id,
    now: NOW,
  });
  // One the console of now has set already: the step leaves it as it is.
  await setSecret(testDatabase.database, now, {
    accountId: aliceId,
    name: "s0000",
    value: "set after the rotation",
    expiresOn: null,
    actor: { id: aliceId },
    seeded: false,
    limit: MANY,
    now: NOW,
  });
}, 120_000);

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

describe("a console while its secret is rotated", () => {
  it("ends a sign-in that began under the secret before, and says at every start that a rotation is under way", async () => {
    // One provider, as a browser sees one, and three consoles on the database: the one of
    // before, the one a rotation rolls out, and one given the new secret alone.
    const provider = createFixtureProvider("gh");
    const people = { providers: [provider], admins: ["alice"], listed: ["alice"] };
    const old = createHarness(testDatabase, { ...people, secret: OLD });
    const rotated = createHarness(testDatabase, { ...people, secret: NEW, previousSecret: OLD });
    const alone = createHarness(testDatabase, { ...people, secret: NEW });
    try {
      const begun = await old.request(AUTH_ROUTES.login("gh"));
      const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
      const cookie = cookieOf(begun, "console_login");
      const back = (one: Harness) =>
        one.request(
          `${AUTH_ROUTES.callback("gh")}?code=${provider.codeFor("alice", state)}&state=${state}`,
          { headers: { cookie } },
        );

      // The new secret alone does not read what the browser carries: the sign-in is over.
      const lost = await back(alone);
      expect(
        new URL(lost.headers.get("location") ?? "/", SIGN_IN_URL).searchParams.get(SIGN_IN_PARAM),
      ).toBe("expired");
      // Beside the secret before, it does, and the person is in.
      const done = await back(rotated);
      expect(
        new URL(done.headers.get("location") ?? "/", SIGN_IN_URL).searchParams.get(SIGN_IN_PARAM),
      ).toBeNull();
      expect(cookieOf(done, "console_session")).toMatch(/console_session=.+/);

      const says = (one: Harness): boolean =>
        one.logs.some(
          (line) =>
            line.level === 40 &&
            String(line.msg).startsWith("a previous secret is read beside the current one"),
        );
      expect(says(rotated)).toBe(true);
      expect(says(old)).toBe(false);
      expect(says(alone)).toBe(false);
      expect(JSON.stringify(rotated.logs)).not.toContain(OLD);
    } finally {
      await old.close();
      await rotated.close();
      await alone.close();
    }
  });
});

describe("a rotation of the deployment's secret", () => {
  it("reads what the secret before sealed, beside the new one, before anything is sealed again", async () => {
    const sealed = await sealedValues();
    expect(both.open("pack-token", sealed.workspacePackTokens[0] ?? "")).toBe(
      "the organization's token",
    );
    expect(both.open("pack-token", sealed.projectPackTokens[0] ?? "")).toBe("the project's token");
    expect(both.open("pack-connect", sealed.workspacePackConnections[0] ?? "")).toBe(
      "the workspace's claim",
    );
    expect(both.open("pack-connect", sealed.projectPackConnections[0] ?? "")).toBe(
      "the project's claim",
    );
    expect(both.open("plugin-secret", sealed.pluginSecrets[0] ?? "")).toBe("the plugin's key");
    expect(both.open("plugin-secret", sealed.pluginKeyedSecrets[7] ?? "")).toBe("token 7");
    expect(
      await readSecret(testDatabase.database, both, {
        accountId: aliceId,
        name: "s0007",
        actor: { id: aliceId },
        now: NOW,
      }),
    ).toMatchObject({ value: "value 7" });
    // The new secret alone opens none of them yet, which is what a rotation without the
    // secret before would have lost.
    expect(now.open("pack-token", sealed.workspacePackTokens[0] ?? "")).toBeUndefined();
    expect(now.open("plugin-secret", sealed.pluginKeyedSecrets[7] ?? "")).toBeUndefined();
  });

  it("says a setting is at fault, and seals nothing, where the role was given no secret before", async () => {
    const sealedBefore = await sealedValues();
    await expect(reseal({ AUTH_SECRET: NEW })).rejects.toThrow(ConfigError);
    await expect(reseal({ AUTH_SECRET: NEW })).rejects.toThrow(/AUTH_SECRET_PREVIOUS/);
    expect(await sealedValues()).toEqual(sealedBefore);
  });

  it("says that the secret before opened nothing, where it is not the one the deployment had, and seals nothing", async () => {
    const sealedBefore = await sealedValues();
    const { left, lines } = await reseal({ AUTH_SECRET: NEW, AUTH_SECRET_PREVIOUS: WRONG });
    // Nothing is under a secret that opens nothing: the exit code is the one it was. What a
    // reader needs is in the line, and a second one says it in words: read as "nothing left",
    // the answer had the real secret before taken out, and every value lost with it.
    expect(left).toBe(0);
    const all = 6 + MANY + (MANY - 1) + 2;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: 40,
      msg: "sealed again",
      resealed: 0,
      openedByPrevious: 0,
      unopened: all,
      left: 0,
    });
    expect(lines[1]).toMatchObject({
      level: 40,
      msg: "the previous secret opened no value: unless an earlier run sealed the values again, check that AUTH_SECRET_PREVIOUS is the secret the deployment had, given in the same form, before it is taken out",
      unopened: all,
    });
    expect(JSON.stringify(lines)).not.toContain(WRONG);
    expect(await sealedValues()).toEqual(sealedBefore);
  });

  it("seals again what only the secret before opens, counts what neither opens, and leaves it", async () => {
    const handle = db();
    const sealedBefore = await sealedValues();
    const [accessesBefore] = await handle.select({ count: count() }).from(agentSecretAccesses);
    const [datesBefore] = await handle
      .select({ updatedAt: workspaces.updatedAt, setAt: workspaces.packTokenSetAt })
      .from(workspaces);

    const { left, lines } = await reseal({ AUTH_SECRET: NEW, AUTH_SECRET_PREVIOUS: OLD });
    expect(left).toBe(0);
    // One line: the secret before opened what it was to open, and there is nothing to check.
    expect(lines).toHaveLength(1);
    // Two values neither secret opens: said as a warning, and counted.
    expect(lines[0]).toMatchObject({
      level: 40,
      msg: "sealed again",
      resealed: 6 + MANY + (MANY - 1),
      openedByPrevious: 6 + MANY + (MANY - 1),
      unopened: 2,
      left: 0,
      kinds: {
        workspacePackTokens: { values: 1, resealed: 1, unopened: 0, left: 0 },
        projectPackTokens: { values: 1, resealed: 1, unopened: 0, left: 0 },
        workspacePackConnections: { values: 1, resealed: 1, unopened: 0, left: 0 },
        projectPackConnections: { values: 1, resealed: 1, unopened: 0, left: 0 },
        pluginSecrets: { values: 3, resealed: 1, unopened: 2, left: 0 },
        pluginKeyedSecrets: { values: MANY, resealed: MANY, unopened: 0, left: 0 },
        agentSecrets: { values: MANY, resealed: MANY - 1, unopened: 0, left: 0 },
        // The one that waits: the one the account left holds nothing to seal.
        agentSecretOffers: { values: 1, resealed: 1, unopened: 0, left: 0 },
      },
    });
    // No value and no secret is in what the step said.
    const said = JSON.stringify(lines);
    for (const word of [OLD, NEW, "the organization's token", "value 7", "token 7", OFFERED]) {
      expect(said).not.toContain(word);
    }

    // The secret before can go: the new one alone opens everything it sealed.
    const sealed = await sealedValues();
    expect(now.open("pack-token", sealed.workspacePackTokens[0] ?? "")).toBe(
      "the organization's token",
    );
    expect(now.open("pack-token", sealed.projectPackTokens[0] ?? "")).toBe("the project's token");
    expect(now.open("pack-connect", sealed.workspacePackConnections[0] ?? "")).toBe(
      "the workspace's claim",
    );
    expect(now.open("pack-connect", sealed.projectPackConnections[0] ?? "")).toBe(
      "the project's claim",
    );
    expect(now.open("plugin-secret", sealed.pluginSecrets[0] ?? "")).toBe("the plugin's key");
    expect(sealed.pluginKeyedSecrets.map((one) => now.open("plugin-secret", one))).toEqual(
      Array.from({ length: MANY }, (_, index) => `token ${index}`),
    );
    for (const [name, value] of [
      ["s0000", "set after the rotation"],
      ["s0001", "value 1"],
      ["s0449", "value 449"],
    ] as const) {
      expect(
        await readSecret(testDatabase.database, now, {
          accountId: aliceId,
          name,
          actor: { id: aliceId },
          now: NOW,
        }),
      ).toMatchObject({ value });
    }
    expect(before.open("pack-token", sealed.workspacePackTokens[0] ?? "")).toBeUndefined();

    // What neither opens is as it was, and so is the one the console of now had set.
    expect(sealed.pluginSecrets.slice(1)).toEqual(sealedBefore.pluginSecrets.slice(1));
    expect(sealed.agentSecrets[0]).toBe(sealedBefore.agentSecrets[0]);
    // Nothing but the sealed text changed: no date of the rows, and nothing on the account's
    // record of its store but the three reads above.
    const [datesAfter] = await handle
      .select({ updatedAt: workspaces.updatedAt, setAt: workspaces.packTokenSetAt })
      .from(workspaces);
    expect(datesAfter).toEqual(datesBefore);
    const [accessesAfter] = await handle.select({ count: count() }).from(agentSecretAccesses);
    expect((accessesAfter?.count ?? 0) - (accessesBefore?.count ?? 0)).toBe(3);

    // The offer that waited is the account's to take still, with the new secret alone.
    expect(before.open("agent-secret", sealed.agentSecretOffers[0] ?? "")).toBeUndefined();
    await takeSecretOffer(testDatabase.database, now, {
      accountId: aliceId,
      offerId,
      as: undefined,
      replace: false,
      actor: { id: aliceId },
      limit: MANY + 1,
      now: NOW,
    });
    expect(
      await readSecret(testDatabase.database, now, {
        accountId: aliceId,
        name: "x-offered",
        actor: { id: aliceId },
        now: NOW,
      }),
    ).toMatchObject({ value: OFFERED });
  });

  it("finds nothing to do when it is run again", async () => {
    const sealedBefore = await sealedValues();
    const { left, lines } = await reseal({ AUTH_SECRET: NEW, AUTH_SECRET_PREVIOUS: OLD });
    // It still ends well: everything the secret before opened was sealed again by the run
    // before, which is the case the second line names as the one with nothing to check.
    expect(left).toBe(0);
    expect(lines[0]).toMatchObject({
      msg: "sealed again",
      resealed: 0,
      openedByPrevious: 0,
      unopened: 2,
      left: 0,
    });
    expect(lines).toHaveLength(2);
    expect(String(lines[1]?.msg)).toContain("unless an earlier run sealed the values again");
    expect(await sealedValues()).toEqual(sealedBefore);
  });

  it("says one line where every value opens with the current secret", async () => {
    // Nothing for the secret before to open, and nothing lost: no word of a check.
    const handle = db();
    const lost = and(eq(pluginSecrets.pluginKey, "ledger"), eq(pluginSecrets.name, "lost"));
    const torn = and(eq(pluginSecrets.pluginKey, "ledger"), eq(pluginSecrets.name, "torn"));
    const [wasLost] = await handle
      .select({ sealed: pluginSecrets.sealed })
      .from(pluginSecrets)
      .where(lost);
    const [wasTorn] = await handle
      .select({ sealed: pluginSecrets.sealed })
      .from(pluginSecrets)
      .where(torn);
    const set = now.seal("plugin-secret", "set again by its holder");
    await handle.update(pluginSecrets).set({ sealed: set }).where(lost);
    await handle.update(pluginSecrets).set({ sealed: set }).where(torn);
    try {
      const { left, lines } = await reseal({ AUTH_SECRET: NEW, AUTH_SECRET_PREVIOUS: WRONG });
      expect(left).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 30,
        msg: "sealed again",
        resealed: 0,
        openedByPrevious: 0,
        unopened: 0,
        left: 0,
      });
    } finally {
      // As the tests after this one find them.
      await handle
        .update(pluginSecrets)
        .set({ sealed: wasLost?.sealed ?? "" })
        .where(lost);
      await handle
        .update(pluginSecrets)
        .set({ sealed: wasTorn?.sealed ?? "" })
        .where(torn);
    }
  });

  it("never writes over a value set while it reads, and reads the kind again", async () => {
    const handle = db();
    const apiKey = and(eq(pluginSecrets.pluginKey, "ledger"), eq(pluginSecrets.name, "apiKey"));
    await handle
      .update(pluginSecrets)
      .set({ sealed: before.seal("plugin-secret", "the plugin's key") })
      .where(apiKey);
    const fresh = now.seal("plugin-secret", "set by a console that runs now");

    // Another console sets the value, and its transaction stays open while the step reads the
    // row as it was and goes to write it: the step's write waits on the row, and finds another
    // text there once the other has committed.
    let commit: () => void = () => {};
    const told = new Promise<void>((resolve) => {
      commit = resolve;
    });
    let written: () => void = () => {};
    const wrote = new Promise<void>((resolve) => {
      written = resolve;
    });
    const other = handle.transaction(async (tx) => {
      await tx.update(pluginSecrets).set({ sealed: fresh }).where(apiKey);
      written();
      await told;
    });
    await wrote;
    const step = resealAll(testDatabase.database, createRotation(NEW, OLD));
    await expect
      .poll(
        async () =>
          (
            await handle.execute(
              sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
            )
          ).rows[0]?.waiting,
        { timeout: 10_000 },
      )
      .toBe(1);
    commit();
    await other;

    const counts = await step;
    expect(counts.find((one) => one.kind === "pluginSecrets")).toEqual({
      kind: "pluginSecrets",
      values: 3,
      resealed: 0,
      unopened: 2,
      left: 0,
    });
    const [row] = await handle
      .select({ sealed: pluginSecrets.sealed })
      .from(pluginSecrets)
      .where(apiKey);
    expect(row?.sealed).toBe(fresh);
  });
});
