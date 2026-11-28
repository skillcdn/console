import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { Rotation, SealPurpose } from "../../auth/secrets.js";
import { type Database, type Drizzle, drizzleOf } from "../client.js";
import {
  agentSecretOffers,
  agentSecrets,
  packConnects,
  pluginKeyedSecrets,
  pluginSecrets,
  projects,
  workspacePackConnects,
  workspaces,
} from "../schema.js";

// The rotation of the deployment's secret (ADR-0127): every row that keeps a sealed value, read
// under the two secrets and written again under the current one where only the one before opens
// it. A value is opened and sealed inside the rotation and never comes here in the clear; what
// this module sees of it is the sealed text before and after.

/** The kinds of sealed value the console keeps in rows, as the step names them in its answer. */
export const SEALED_KINDS = [
  "workspacePackTokens",
  "projectPackTokens",
  "workspacePackConnections",
  "projectPackConnections",
  "pluginSecrets",
  "pluginKeyedSecrets",
  "agentSecrets",
  "agentSecretOffers",
] as const;

export type SealedKind = (typeof SEALED_KINDS)[number];

/** What the step found of one kind. */
export interface ResealCount {
  readonly kind: SealedKind;
  /** How many values of the kind there are. */
  readonly values: number;
  /** How many the step sealed again under the current secret. */
  readonly resealed: number;
  /** How many neither secret opens: left as they are. */
  readonly unopened: number;
  /** How many only the secret before still opens: written by someone else while the step read them, every time it looked. */
  readonly left: number;
}

/** How many rows the step reads at a time. */
const PAGE = 200;
/** How many times a kind is read again while a value changed under the step. */
const PASSES = 3;

/**
 * One table's sealed values: a page of them after a key, in the key's order, and one written
 * again where it still is what was read, so that a value set meanwhile is never written over.
 */
export interface SealedStore<Key> {
  readonly kind: SealedKind;
  readonly purpose: SealPurpose;
  page(
    db: Drizzle,
    after: Key | undefined,
  ): Promise<{ readonly key: Key; readonly sealed: string }[]>;
  write(db: Drizzle, key: Key, was: string, next: string): Promise<boolean>;
}

const workspaceTokens: SealedStore<string> = {
  kind: "workspacePackTokens",
  purpose: "pack-token",
  page: async (db, after) =>
    (
      await db
        .select({ key: workspaces.id, sealed: workspaces.packToken })
        .from(workspaces)
        .where(
          and(
            isNotNull(workspaces.packToken),
            after === undefined ? undefined : gt(workspaces.id, after),
          ),
        )
        .orderBy(asc(workspaces.id))
        .limit(PAGE)
    ).flatMap((row) => (row.sealed === null ? [] : [{ key: row.key, sealed: row.sealed }])),
  write: async (db, key, was, next) =>
    (
      await db
        .update(workspaces)
        .set({ packToken: next })
        .where(and(eq(workspaces.id, key), eq(workspaces.packToken, was)))
        .returning({ key: workspaces.id })
    ).length === 1,
};

const projectTokens: SealedStore<string> = {
  kind: "projectPackTokens",
  purpose: "pack-token",
  page: async (db, after) =>
    (
      await db
        .select({ key: projects.id, sealed: projects.packToken })
        .from(projects)
        .where(
          and(
            isNotNull(projects.packToken),
            after === undefined ? undefined : gt(projects.id, after),
          ),
        )
        .orderBy(asc(projects.id))
        .limit(PAGE)
    ).flatMap((row) => (row.sealed === null ? [] : [{ key: row.key, sealed: row.sealed }])),
  write: async (db, key, was, next) =>
    (
      await db
        .update(projects)
        .set({ packToken: next })
        .where(and(eq(projects.id, key), eq(projects.packToken, was)))
        .returning({ key: projects.id })
    ).length === 1,
};

const workspaceConnections: SealedStore<string> = {
  kind: "workspacePackConnections",
  purpose: "pack-connect",
  page: (db, after) =>
    db
      .select({ key: workspacePackConnects.workspaceId, sealed: workspacePackConnects.secret })
      .from(workspacePackConnects)
      .where(after === undefined ? undefined : gt(workspacePackConnects.workspaceId, after))
      .orderBy(asc(workspacePackConnects.workspaceId))
      .limit(PAGE),
  write: async (db, key, was, next) =>
    (
      await db
        .update(workspacePackConnects)
        .set({ secret: next })
        .where(
          and(eq(workspacePackConnects.workspaceId, key), eq(workspacePackConnects.secret, was)),
        )
        .returning({ key: workspacePackConnects.workspaceId })
    ).length === 1,
};

const projectConnections: SealedStore<string> = {
  kind: "projectPackConnections",
  purpose: "pack-connect",
  page: (db, after) =>
    db
      .select({ key: packConnects.projectId, sealed: packConnects.secret })
      .from(packConnects)
      .where(after === undefined ? undefined : gt(packConnects.projectId, after))
      .orderBy(asc(packConnects.projectId))
      .limit(PAGE),
  write: async (db, key, was, next) =>
    (
      await db
        .update(packConnects)
        .set({ secret: next })
        .where(and(eq(packConnects.projectId, key), eq(packConnects.secret, was)))
        .returning({ key: packConnects.projectId })
    ).length === 1,
};

type SecretKey = readonly [workspaceId: string, pluginKey: string, name: string];

const pluginSettings: SealedStore<SecretKey> = {
  kind: "pluginSecrets",
  purpose: "plugin-secret",
  page: async (db, after) =>
    (
      await db
        .select({
          workspaceId: pluginSecrets.workspaceId,
          pluginKey: pluginSecrets.pluginKey,
          name: pluginSecrets.name,
          sealed: pluginSecrets.sealed,
        })
        .from(pluginSecrets)
        .where(
          after === undefined
            ? undefined
            : sql`(${pluginSecrets.workspaceId}, ${pluginSecrets.pluginKey}, ${pluginSecrets.name}) > (${after[0]}, ${after[1]}, ${after[2]})`,
        )
        .orderBy(
          asc(pluginSecrets.workspaceId),
          asc(pluginSecrets.pluginKey),
          asc(pluginSecrets.name),
        )
        .limit(PAGE)
    ).map((row) => ({
      key: [row.workspaceId, row.pluginKey, row.name] as const,
      sealed: row.sealed,
    })),
  write: async (db, [workspaceId, pluginKey, name], was, next) =>
    (
      await db
        .update(pluginSecrets)
        .set({ sealed: next })
        .where(
          and(
            eq(pluginSecrets.workspaceId, workspaceId),
            eq(pluginSecrets.pluginKey, pluginKey),
            eq(pluginSecrets.name, name),
            eq(pluginSecrets.sealed, was),
          ),
        )
        .returning({ name: pluginSecrets.name })
    ).length === 1,
};

type KeyedSecretKey = readonly [workspaceId: string, pluginKey: string, name: string, key: string];

const pluginKeyedSettings: SealedStore<KeyedSecretKey> = {
  kind: "pluginKeyedSecrets",
  purpose: "plugin-secret",
  page: async (db, after) =>
    (
      await db
        .select({
          workspaceId: pluginKeyedSecrets.workspaceId,
          pluginKey: pluginKeyedSecrets.pluginKey,
          name: pluginKeyedSecrets.name,
          key: pluginKeyedSecrets.key,
          sealed: pluginKeyedSecrets.sealed,
        })
        .from(pluginKeyedSecrets)
        .where(
          after === undefined
            ? undefined
            : sql`(${pluginKeyedSecrets.workspaceId}, ${pluginKeyedSecrets.pluginKey}, ${pluginKeyedSecrets.name}, ${pluginKeyedSecrets.key}) > (${after[0]}, ${after[1]}, ${after[2]}, ${after[3]})`,
        )
        .orderBy(
          asc(pluginKeyedSecrets.workspaceId),
          asc(pluginKeyedSecrets.pluginKey),
          asc(pluginKeyedSecrets.name),
          asc(pluginKeyedSecrets.key),
        )
        .limit(PAGE)
    ).map((row) => ({
      key: [row.workspaceId, row.pluginKey, row.name, row.key] as const,
      sealed: row.sealed,
    })),
  write: async (db, [workspaceId, pluginKey, name, key], was, next) =>
    (
      await db
        .update(pluginKeyedSecrets)
        .set({ sealed: next })
        .where(
          and(
            eq(pluginKeyedSecrets.workspaceId, workspaceId),
            eq(pluginKeyedSecrets.pluginKey, pluginKey),
            eq(pluginKeyedSecrets.name, name),
            eq(pluginKeyedSecrets.key, key),
            eq(pluginKeyedSecrets.sealed, was),
          ),
        )
        .returning({ name: pluginKeyedSecrets.name })
    ).length === 1,
};

type AgentSecretKey = readonly [personId: string, name: string];

const agentStore: SealedStore<AgentSecretKey> = {
  kind: "agentSecrets",
  purpose: "agent-secret",
  page: async (db, after) =>
    (
      await db
        .select({
          personId: agentSecrets.personId,
          name: agentSecrets.name,
          sealed: agentSecrets.sealed,
        })
        .from(agentSecrets)
        .where(
          after === undefined
            ? undefined
            : sql`(${agentSecrets.personId}, ${agentSecrets.name}) > (${after[0]}, ${after[1]})`,
        )
        .orderBy(asc(agentSecrets.personId), asc(agentSecrets.name))
        .limit(PAGE)
    ).map((row) => ({ key: [row.personId, row.name] as const, sealed: row.sealed })),
  // The value is sealed with the account and the name it is for, and is sealed again as it was:
  // it still opens for that account under that name alone. Nothing is noted in the account's
  // record of its store, since nobody set, read or removed a value.
  write: async (db, [personId, name], was, next) =>
    (
      await db
        .update(agentSecrets)
        .set({ sealed: next })
        .where(
          and(
            eq(agentSecrets.personId, personId),
            eq(agentSecrets.name, name),
            eq(agentSecrets.sealed, was),
          ),
        )
        .returning({ name: agentSecrets.name })
    ).length === 1,
};

// A secret offered to an agent account and still waiting (ADR-0169): sealed for the account
// and the offer, and sealed again as it was. One that no longer waits holds no value.
const agentOffers: SealedStore<string> = {
  kind: "agentSecretOffers",
  purpose: "agent-secret",
  page: async (db, after) =>
    (
      await db
        .select({ key: agentSecretOffers.id, sealed: agentSecretOffers.sealed })
        .from(agentSecretOffers)
        .where(
          and(
            isNotNull(agentSecretOffers.sealed),
            after === undefined ? undefined : gt(agentSecretOffers.id, after),
          ),
        )
        .orderBy(asc(agentSecretOffers.id))
        .limit(PAGE)
    ).flatMap((row) => (row.sealed === null ? [] : [{ key: row.key, sealed: row.sealed }])),
  write: async (db, id, was, next) =>
    (
      await db
        .update(agentSecretOffers)
        .set({ sealed: next })
        .where(and(eq(agentSecretOffers.id, id), eq(agentSecretOffers.sealed, was)))
        .returning({ id: agentSecretOffers.id })
    ).length === 1,
};

/** Reads one kind through, page by page, and writes again what only the secret before opens. */
async function pass<Key>(
  db: Drizzle,
  rotation: Rotation,
  store: SealedStore<Key>,
): Promise<{ values: number; resealed: number; unopened: number; missed: number }> {
  const found = { values: 0, resealed: 0, unopened: 0, missed: 0 };
  let after: Key | undefined;
  for (;;) {
    const rows = await store.page(db, after);
    for (const row of rows) {
      found.values += 1;
      const read = rotation.reseal(store.purpose, row.sealed);
      if (read.by === "neither") {
        found.unopened += 1;
      } else if (read.by === "previous") {
        // One statement, and so one transaction, a value: the step can be cut short anywhere
        // and run again.
        if (await store.write(db, row.key, row.sealed, read.sealed)) {
          found.resealed += 1;
        } else {
          found.missed += 1;
        }
      }
    }
    const last = rows.at(-1);
    if (rows.length < PAGE || last === undefined) {
      return found;
    }
    after = last.key;
  }
}

/**
 * One kind, read through and read again while a value changed under the step, a bounded number
 * of times: what is still under the secret before then is `left`, for the next run.
 */
export async function resealKind<Key>(
  db: Drizzle,
  rotation: Rotation,
  store: SealedStore<Key>,
): Promise<ResealCount> {
  let resealed = 0;
  for (let turn = 1; ; turn += 1) {
    const found = await pass(db, rotation, store);
    resealed += found.resealed;
    // A value that changed while it was read was set by a console that runs now: read the kind
    // again, where it is the current secret's, or the one before's once more.
    if (found.missed === 0 || turn === PASSES) {
      return {
        kind: store.kind,
        values: found.values,
        resealed,
        unopened: found.unopened,
        left: found.missed,
      };
    }
  }
}

/**
 * Seals again, under the current secret, every value in the database that only the secret before
 * opens, kind by kind, and answers what it found of each. Run again, it finds nothing to do.
 */
export async function resealAll(database: Database, rotation: Rotation): Promise<ResealCount[]> {
  const db = drizzleOf(database);
  return [
    await resealKind(db, rotation, workspaceTokens),
    await resealKind(db, rotation, projectTokens),
    await resealKind(db, rotation, workspaceConnections),
    await resealKind(db, rotation, projectConnections),
    await resealKind(db, rotation, pluginSettings),
    await resealKind(db, rotation, pluginKeyedSettings),
    await resealKind(db, rotation, agentStore),
    await resealKind(db, rotation, agentOffers),
  ];
}

/** The purposes whose values are kept in rows, and so read by the step; `login` travels through a browser and is kept nowhere. */
export const RESEALED_PURPOSES: readonly SealPurpose[] = [
  "pack-token",
  "pack-connect",
  "plugin-secret",
  "agent-secret",
];
