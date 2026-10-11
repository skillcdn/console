import { type CategoryColor, MAX_CATEGORIES } from "@skillcdn/console/api";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { DomainError } from "../../errors.js";
import { type Database, drizzleOf, type Transaction } from "../client.js";
import { categories, tasks, workspaces } from "../schema.js";
import { type Actor, recordEvent } from "./events.js";

// The categories tasks are sorted into (ADR-0019): the workspace's own vocabulary for the kinds
// of work, kept by an administrator. A category is named by its key, which does not change;
// one no task uses may be removed. Every change is one transaction with the workspace's own
// event that records it.

export interface CategoryRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly color: CategoryColor;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What is wrong with a category an administrator asked for. `code` is what the API answers with. */
export class CategoryError extends DomainError {
  constructor(
    code: "category.not_found" | "category.key_taken" | "category.in_use" | "category.too_many",
  ) {
    super(code, CATEGORY_ERROR_WORDS[code]);
  }
}

const CATEGORY_ERROR_WORDS = {
  "category.not_found": "the category was not found",
  "category.key_taken": "a category with this key exists already",
  "category.in_use": "tasks are sorted into the category; move them first",
  "category.too_many": "the workspace has as many categories as one may",
} as const;

export interface CategoryInput {
  readonly key: string;
  readonly name: string;
  readonly color?: CategoryColor | undefined;
}

/** Only what changes; a key that is absent leaves the field as it is. */
export interface CategoryPatch {
  readonly name?: string | undefined;
  readonly color?: CategoryColor | undefined;
}

/**
 * The categories every workspace starts with: the usual kinds of work. An administrator
 * renames, recolours, adds and removes them from there; the migration that brought categories
 * seeded the workspaces that existed with the same list.
 */
export const DEFAULT_CATEGORIES: readonly CategoryInput[] = [
  { key: "engineering", name: "Engineering", color: "blue" },
  { key: "product", name: "Product", color: "purple" },
  { key: "design", name: "Design", color: "pink" },
  { key: "marketing", name: "Marketing", color: "orange" },
  { key: "operations", name: "Operations", color: "teal" },
];

type Handle = Transaction | ReturnType<typeof drizzleOf>;

const categoryColumns = {
  id: categories.id,
  workspaceId: categories.workspaceId,
  key: categories.key,
  name: categories.name,
  color: categories.color,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
};

/** Gives a workspace its first categories; one that has any already keeps them as they are. */
export async function seedCategories(
  handle: Handle,
  workspaceId: string,
  now: Date,
): Promise<void> {
  await handle
    .insert(categories)
    .values(
      DEFAULT_CATEGORIES.map((category) => ({
        workspaceId,
        key: category.key,
        name: category.name,
        color: category.color ?? "gray",
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
}

/** The workspace's categories, by name. */
export async function listCategories(
  database: Database,
  workspaceId: string,
): Promise<CategoryRecord[]> {
  return drizzleOf(database)
    .select(categoryColumns)
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${categories.name})`), asc(categories.key));
}

async function readCategory(
  handle: Handle,
  workspaceId: string,
  key: string,
): Promise<CategoryRecord | undefined> {
  const [row] = await handle
    .select(categoryColumns)
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), eq(categories.key, key)))
    .limit(1);
  return row;
}

export function findCategory(
  database: Database,
  workspaceId: string,
  key: string,
): Promise<CategoryRecord | undefined> {
  return readCategory(drizzleOf(database), workspaceId, key);
}

/**
 * Makes a category and tells the workspace. The key is unique in the workspace and the count
 * bounded, both checked under the lock on the workspace row, so that two made at once cannot
 * share a key or pass the bound together.
 */
export async function createCategory(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly category: CategoryInput;
    readonly now: Date;
  },
): Promise<CategoryRecord> {
  const { workspaceId, actor, category, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    if ((await readCategory(tx, workspaceId, category.key)) !== undefined) {
      throw new CategoryError("category.key_taken");
    }
    const [existing] = await tx
      .select({ count: count() })
      .from(categories)
      .where(eq(categories.workspaceId, workspaceId));
    if ((existing?.count ?? 0) >= MAX_CATEGORIES) {
      throw new CategoryError("category.too_many");
    }
    const [inserted] = await tx
      .insert(categories)
      .values({
        workspaceId,
        key: category.key,
        name: category.name,
        color: category.color ?? "gray",
        createdAt: now,
        updatedAt: now,
      })
      .returning(categoryColumns);
    if (inserted === undefined) {
      throw new Error("category insert returned no row");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "category.created",
      actor,
      data: { key: inserted.key, name: inserted.name },
      now,
    });
    return inserted;
  });
}

/** Changes what the patch names and tells the workspace which fields; a patch that changes nothing writes nothing. */
export async function updateCategory(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actor: Actor;
    readonly key: string;
    readonly patch: CategoryPatch;
    readonly now: Date;
  },
): Promise<CategoryRecord> {
  const { workspaceId, actor, key, patch, now } = input;
  return drizzleOf(database).transaction(async (tx) => {
    const [current] = await tx
      .select(categoryColumns)
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), eq(categories.key, key)))
      .for("update");
    if (current === undefined) {
      throw new CategoryError("category.not_found");
    }
    const next = { name: patch.name ?? current.name, color: patch.color ?? current.color };
    const changed = (["name", "color"] as const).filter((field) => next[field] !== current[field]);
    if (changed.length === 0) {
      return current;
    }
    const [written] = await tx
      .update(categories)
      .set({ ...next, updatedAt: now })
      .where(eq(categories.id, current.id))
      .returning(categoryColumns);
    if (written === undefined) {
      throw new CategoryError("category.not_found");
    }
    await recordEvent(tx, {
      workspaceId,
      kind: "category.updated",
      actor,
      data: { key: written.key, name: written.name, fields: changed },
      now,
    });
    return written;
  });
}

/**
 * Removes a category no task uses, and tells the workspace. One that tasks are sorted into is
 * refused: the tasks are moved first, so that nothing loses its category unseen.
 */
export async function removeCategory(
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
    const [current] = await tx
      .select(categoryColumns)
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), eq(categories.key, key)))
      .for("update");
    if (current === undefined) {
      throw new CategoryError("category.not_found");
    }
    const [used] = await tx
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.categoryId, current.id));
    if ((used?.count ?? 0) > 0) {
      throw new CategoryError("category.in_use");
    }
    await tx.delete(categories).where(eq(categories.id, current.id));
    await recordEvent(tx, {
      workspaceId,
      kind: "category.removed",
      actor,
      data: { key: current.key, name: current.name },
      now,
    });
  });
}
