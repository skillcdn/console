// The record store (ADR-0051, docs/specs/plugins.md, "Records"): where a plugin's data lives
// when it keeps records. The console holds the rows, checks the collection's rules (the indexed
// fields `where` and `order` may name, the project, the owner), bounds the plugin to its quotas,
// keeps a version per write where the collection asks, and reads for a person by their roles.
// The data itself is checked against the collection's schema in the plugin's thread, before it
// gets here.
import {
  type CollectionDescription,
  type LinkTarget,
  MAX_PLUGIN_RECORD_BYTES,
  MAX_PLUGIN_RECORD_VERSIONS,
  MAX_PLUGIN_RECORDS,
  PLUGIN_LIST_LIMIT,
  type PluginFileHandle,
  type PluginRecord,
  PluginRefusal,
  type RecordAggregate,
  type RecordAggregation,
  type RecordFile,
  type RecordPage,
  type RecordQuery,
  type RecordVersion,
  type Where,
  type WhereScalar,
  type WhereValue,
} from "@skillcdn/console/plugin";
import { and, asc, desc, eq, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { projectVisibleTo } from "../auth/policy.js";
import { type Database, drizzleOf, type Transaction } from "../db/client.js";
import type { PersonRecord } from "../db/queries/people.js";
import {
  pluginLinks,
  pluginRecordFiles,
  pluginRecords,
  pluginRecordVersions,
  pluginUploads,
  projects,
} from "../db/schema.js";
import type { BlobStore } from "../ports/blob-store.js";
import type { Clock } from "../ports/clock.js";

/** Which plugin's which collection a call is about. */
export interface RecordScope {
  readonly workspaceId: string;
  readonly plugin: string;
  readonly collection: CollectionDescription;
}

/** Who causes a write: a person, through an agent or not; nobody for the console. */
export interface Writer {
  readonly personId: string | undefined;
  readonly agent: string | undefined;
}

/**
 * How far a read may see: everything (plugin code, an administrator, a `read` role), the
 * caller's own records (a `readOwn` role), and only records whose project the person may see.
 */
export interface Visibility {
  readonly ownOnly?: string | undefined;
  readonly person?: PersonRecord | undefined;
}

/** How long an uploaded file waits for a command to attach it. */
export const UPLOAD_TTL_MS = 60 * 60_000;
/** The fields every record has beside its data, which `where` and `order` may always name. */
const META_FIELDS = ["id", "owner", "project"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** How many records one page of an export reads at a time. */
const EXPORT_PAGE = 500;

type Handle = Transaction | ReturnType<typeof drizzleOf>;

const recordColumns = {
  id: pluginRecords.id,
  collection: pluginRecords.collection,
  projectId: pluginRecords.projectId,
  ownerId: pluginRecords.ownerId,
  data: pluginRecords.data,
  version: pluginRecords.version,
  createdAt: pluginRecords.createdAt,
  updatedAt: pluginRecords.updatedAt,
  createdById: pluginRecords.createdById,
  updatedById: pluginRecords.updatedById,
  archivedAt: pluginRecords.archivedAt,
};

type RecordRow = {
  id: string;
  collection: string;
  projectId: string | null;
  ownerId: string | null;
  data: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
  archivedAt: Date | null;
};

function toRecord(row: RecordRow): PluginRecord {
  return {
    id: row.id,
    collection: row.collection,
    project: row.projectId,
    owner: row.ownerId,
    data: row.data,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdById,
    updatedBy: row.updatedById,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
  };
}

function invalid(message: string): PluginRefusal {
  return new PluginRefusal("plugin.invalid_args", message);
}

/** The words of the collection's search fields, as the write found them, for the database to index. */
function searchTextOf(collection: CollectionDescription, data: Record<string, unknown>): string {
  return collection.search
    .map((field) => data[field])
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(String)
    .join(" ")
    .slice(0, 100_000);
}

/** The person the collection's owner field names, as a uuid, or none. */
function ownerOf(
  collection: CollectionDescription,
  data: Record<string, unknown>,
  given: string | undefined,
): string | null {
  const value = given ?? (collection.owner === null ? undefined : data[collection.owner]);
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function sizeOf(data: unknown): number {
  return Buffer.byteLength(JSON.stringify(data) ?? "", "utf8");
}

/** The cursor of a page: where the last record stood in the order, opaque to the caller. */
function cursorOf(value: unknown, id: string): string {
  return Buffer.from(JSON.stringify({ v: value ?? null, id }), "utf8").toString("base64url");
}

function cursorFrom(after: string): { v: unknown; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(after, "base64url").toString("utf8")) as {
      v?: unknown;
      id?: unknown;
    };
    if (typeof parsed.id === "string" && UUID.test(parsed.id)) {
      return { v: parsed.v ?? null, id: parsed.id };
    }
  } catch {
    // Not a cursor of ours: said below.
  }
  throw invalid("after is not a cursor a list answered with");
}

export class RecordStore {
  private readonly database: Database;
  private readonly blobs: BlobStore;
  private readonly clock: Clock;
  private readonly fileBytesAtMost: number | undefined;

  constructor(options: {
    readonly database: Database;
    readonly blobs: BlobStore;
    readonly clock: Clock;
    readonly fileBytesAtMost: number | undefined;
  }) {
    this.database = options.database;
    this.blobs = options.blobs;
    this.clock = options.clock;
    this.fileBytesAtMost = options.fileBytesAtMost;
  }

  /** The condition every read of a collection starts from. */
  private within(scope: RecordScope): SQL {
    return and(
      eq(pluginRecords.workspaceId, scope.workspaceId),
      eq(pluginRecords.pluginKey, scope.plugin),
      eq(pluginRecords.collection, scope.collection.name),
    ) as SQL;
  }

  /** A field `where`, `order` or `aggregate` may name: an index of the collection, or one every record has. */
  private field(scope: RecordScope, name: string): SQL {
    if (name === "id") {
      return sql`${pluginRecords.id}`;
    }
    if (name === "owner") {
      return sql`${pluginRecords.ownerId}`;
    }
    if (name === "project") {
      return sql`${pluginRecords.projectId}`;
    }
    if (!FIELD.test(name) || !scope.collection.indexes.includes(name)) {
      throw invalid(
        `${name} is not an indexed field of ${scope.collection.name}; the indexes are ${scope.collection.indexes.join(", ") || "none"}`,
      );
    }
    return sql`coalesce(${pluginRecords.data} -> ${name}, 'null'::jsonb)`;
  }

  private isMeta(name: string): boolean {
    return (META_FIELDS as readonly string[]).includes(name);
  }

  private condition(scope: RecordScope, field: string, value: WhereValue): SQL {
    const expression = this.field(scope, field);
    const meta = this.isMeta(field);
    const equals = (scalar: WhereScalar): SQL => {
      if (meta) {
        return scalar === null
          ? sql`${expression} is null`
          : sql`${expression} = ${String(scalar)}`;
      }
      return sql`${pluginRecords.data} @> ${JSON.stringify({ [field]: scalar })}::jsonb`;
    };
    if (value === null || typeof value !== "object") {
      return equals(value);
    }
    if ("in" in value && Array.isArray(value.in)) {
      if (value.in.length === 0) {
        return sql`false`;
      }
      return or(...value.in.map((scalar) => equals(scalar))) as SQL;
    }
    if ("exists" in value && typeof value.exists === "boolean") {
      const present = meta
        ? sql`${expression} is not null`
        : sql`${pluginRecords.data} ? ${field} and jsonb_typeof(${pluginRecords.data} -> ${field}) <> 'null'`;
      return value.exists ? present : sql`not (${present})`;
    }
    const bounds = value as {
      gte?: WhereScalar;
      gt?: WhereScalar;
      lte?: WhereScalar;
      lt?: WhereScalar;
    };
    const parts: SQL[] = [];
    for (const [operator, bound] of [
      [">=", bounds.gte],
      [">", bounds.gt],
      ["<=", bounds.lte],
      ["<", bounds.lt],
    ] as const) {
      if (bound === undefined) {
        continue;
      }
      if (meta) {
        parts.push(sql`${expression} ${sql.raw(operator)} ${String(bound)}`);
      } else if (typeof bound === "number") {
        parts.push(
          sql`jsonb_typeof(${pluginRecords.data} -> ${field}) = 'number' and (${pluginRecords.data} ->> ${field})::numeric ${sql.raw(operator)} ${bound}`,
        );
      } else {
        parts.push(
          sql`jsonb_typeof(${pluginRecords.data} -> ${field}) = 'string' and (${pluginRecords.data} ->> ${field}) ${sql.raw(operator)} ${String(bound)}`,
        );
      }
    }
    if (parts.length === 0) {
      throw invalid(`the condition on ${field} says nothing`);
    }
    return and(...parts) as SQL;
  }

  private whereOf(scope: RecordScope, where: Where | undefined): SQL | undefined {
    if (where === undefined) {
      return undefined;
    }
    const conditions = Object.entries(where).map(([field, value]) =>
      this.condition(scope, field, value),
    );
    return conditions.length === 0 ? undefined : (and(...conditions) as SQL);
  }

  /** What a person may see of the collection: everything, their own, within the projects they see. */
  private visibleTo(visibility: Visibility | undefined): SQL | undefined {
    if (visibility === undefined) {
      return undefined;
    }
    const conditions: SQL[] = [];
    if (visibility.ownOnly !== undefined) {
      conditions.push(eq(pluginRecords.ownerId, visibility.ownOnly));
    }
    if (visibility.person !== undefined) {
      conditions.push(
        sql`(${pluginRecords.projectId} is null or exists (select 1 from ${projects} where ${projects.id} = ${pluginRecords.projectId} and ${projectVisibleTo(visibility.person)}))`,
      );
    }
    return conditions.length === 0 ? undefined : (and(...conditions) as SQL);
  }

  private async projectIdOf(
    scope: RecordScope,
    key: string | undefined,
  ): Promise<string | undefined> {
    if (key === undefined) {
      return undefined;
    }
    const [row] = await drizzleOf(this.database)
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, scope.workspaceId), eq(projects.key, key)))
      .limit(1);
    if (row === undefined) {
      throw invalid(`the project ${key} was not found`);
    }
    return row.id;
  }

  /** How many records the plugin holds, every collection and archived ones included. */
  async count(workspaceId: string, plugin: string): Promise<number> {
    const [row] = await drizzleOf(this.database)
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(pluginRecords)
      .where(and(eq(pluginRecords.workspaceId, workspaceId), eq(pluginRecords.pluginKey, plugin)));
    return row?.count ?? 0;
  }

  async create(
    scope: RecordScope,
    data: Record<string, unknown>,
    options: { readonly project?: string | undefined; readonly owner?: string | undefined },
    writer: Writer,
  ): Promise<PluginRecord> {
    if (sizeOf(data) > MAX_PLUGIN_RECORD_BYTES) {
      throw invalid(
        `${scope.collection.name}: a record is ${MAX_PLUGIN_RECORD_BYTES} bytes at most`,
      );
    }
    if (scope.collection.project === "none" && options.project !== undefined) {
      throw invalid(`${scope.collection.name}: its records are linked to no project`);
    }
    if (scope.collection.project === "required" && options.project === undefined) {
      throw invalid(`${scope.collection.name}: a record of this collection is linked to a project`);
    }
    if (options.owner !== undefined && !UUID.test(options.owner)) {
      throw invalid("owner is a person's id");
    }
    const projectId = await this.projectIdOf(scope, options.project);
    const now = this.clock.now();
    return drizzleOf(this.database).transaction(async (tx) => {
      const [counted] = await tx
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(pluginRecords)
        .where(
          and(
            eq(pluginRecords.workspaceId, scope.workspaceId),
            eq(pluginRecords.pluginKey, scope.plugin),
          ),
        );
      if ((counted?.count ?? 0) >= MAX_PLUGIN_RECORDS) {
        throw new PluginRefusal(
          "plugin.too_many",
          `the plugin holds ${MAX_PLUGIN_RECORDS} records already`,
        );
      }
      const [row] = await tx
        .insert(pluginRecords)
        .values({
          workspaceId: scope.workspaceId,
          pluginKey: scope.plugin,
          collection: scope.collection.name,
          projectId: projectId ?? null,
          ownerId: ownerOf(scope.collection, data, options.owner),
          data,
          searchText: searchTextOf(scope.collection, data),
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdById: writer.personId ?? null,
          createdAgent: writer.agent ?? null,
          updatedById: writer.personId ?? null,
          updatedAgent: writer.agent ?? null,
        })
        .returning(recordColumns);
      if (row === undefined) {
        throw new Error("plugin record insert returned no row");
      }
      return toRecord(row);
    });
  }

  private async read(
    handle: Handle,
    scope: RecordScope,
    id: string,
    visibility?: Visibility,
  ): Promise<RecordRow | undefined> {
    if (!UUID.test(id)) {
      return undefined;
    }
    const [row] = await handle
      .select(recordColumns)
      .from(pluginRecords)
      .where(and(this.within(scope), eq(pluginRecords.id, id), this.visibleTo(visibility)))
      .limit(1);
    return row;
  }

  /** One record, or none: not there, not of this collection, or not the caller's to see. */
  async get(
    scope: RecordScope,
    id: string,
    visibility?: Visibility,
  ): Promise<PluginRecord | undefined> {
    const row = await this.read(drizzleOf(this.database), scope, id, visibility);
    return row === undefined ? undefined : toRecord(row);
  }

  /**
   * Writes the data as it is now, which the caller merged and had checked; keeps the version
   * before where the collection asks; refuses when the record moved on since `baseVersion`.
   */
  async update(
    scope: RecordScope,
    id: string,
    data: Record<string, unknown>,
    options: { readonly baseVersion?: number | undefined },
    writer: Writer,
  ): Promise<PluginRecord> {
    if (sizeOf(data) > MAX_PLUGIN_RECORD_BYTES) {
      throw invalid(
        `${scope.collection.name}: a record is ${MAX_PLUGIN_RECORD_BYTES} bytes at most`,
      );
    }
    const now = this.clock.now();
    return drizzleOf(this.database).transaction(async (tx) => {
      const [current] = await tx
        .select(recordColumns)
        .from(pluginRecords)
        .where(and(this.within(scope), eq(pluginRecords.id, id)))
        .for("update");
      if (current === undefined) {
        throw new PluginRefusal("plugin.not_found", `${scope.collection.name}: no record ${id}`);
      }
      if (options.baseVersion !== undefined && options.baseVersion !== current.version) {
        throw new PluginRefusal(
          "plugin.conflict",
          `${scope.collection.name}: the record is at version ${current.version}, not ${options.baseVersion}`,
        );
      }
      if (scope.collection.history) {
        await tx.insert(pluginRecordVersions).values({
          recordId: current.id,
          version: current.version,
          data: current.data,
          at: current.updatedAt,
          byId: current.updatedById,
          agent: null,
        });
        await tx.execute(
          sql`delete from ${pluginRecordVersions} where ${pluginRecordVersions.recordId} = ${current.id} and ${pluginRecordVersions.version} <= ${current.version - MAX_PLUGIN_RECORD_VERSIONS}`,
        );
      }
      const [row] = await tx
        .update(pluginRecords)
        .set({
          data,
          searchText: searchTextOf(scope.collection, data),
          ownerId: ownerOf(scope.collection, data, undefined) ?? current.ownerId,
          version: current.version + 1,
          updatedAt: now,
          updatedById: writer.personId ?? null,
          updatedAgent: writer.agent ?? null,
        })
        .where(eq(pluginRecords.id, current.id))
        .returning(recordColumns);
      if (row === undefined) {
        throw new Error("plugin record update returned no row");
      }
      return toRecord(row);
    });
  }

  private async setArchived(scope: RecordScope, id: string, archived: boolean): Promise<void> {
    const [row] = await drizzleOf(this.database)
      .update(pluginRecords)
      .set({ archivedAt: archived ? this.clock.now() : null, updatedAt: this.clock.now() })
      .where(and(this.within(scope), eq(pluginRecords.id, id)))
      .returning({ id: pluginRecords.id });
    if (row === undefined) {
      throw new PluginRefusal("plugin.not_found", `${scope.collection.name}: no record ${id}`);
    }
  }

  archive(scope: RecordScope, id: string): Promise<void> {
    return this.setArchived(scope, id, true);
  }

  restore(scope: RecordScope, id: string): Promise<void> {
    return this.setArchived(scope, id, false);
  }

  /** A page of the collection, in the order asked, from the cursor on. */
  async list(
    scope: RecordScope,
    query: RecordQuery,
    visibility?: Visibility,
  ): Promise<RecordPage<Record<string, unknown>>> {
    const limit = Math.min(Math.max(query.limit ?? PLUGIN_LIST_LIMIT, 1), PLUGIN_LIST_LIMIT);
    const orderField = query.order?.field ?? "id";
    const descending = query.order?.descending === true;
    const expression = this.field(scope, orderField);
    const projectId = await this.projectIdOf(scope, query.project);
    const conditions: (SQL | undefined)[] = [
      this.within(scope),
      query.archived === true ? undefined : isNull(pluginRecords.archivedAt),
      projectId === undefined ? undefined : eq(pluginRecords.projectId, projectId),
      this.whereOf(scope, query.where),
      this.visibleTo(visibility),
    ];
    if (query.after !== undefined) {
      const cursor = cursorFrom(query.after);
      const operator = sql.raw(descending ? "<" : ">");
      conditions.push(
        orderField === "id"
          ? sql`${pluginRecords.id} ${operator} ${cursor.id}::uuid`
          : this.isMeta(orderField)
            ? sql`(${expression}, ${pluginRecords.id}) ${operator} (${cursor.v === null ? sql`null` : sql`${String(cursor.v)}`}, ${cursor.id}::uuid)`
            : sql`(${expression}, ${pluginRecords.id}) ${operator} (${JSON.stringify(cursor.v)}::jsonb, ${cursor.id}::uuid)`,
      );
    }
    const rows = await drizzleOf(this.database)
      .select({ ...recordColumns, sortKey: sql<unknown>`${expression}`.as("sort_key") })
      .from(pluginRecords)
      .where(and(...conditions))
      .orderBy(
        descending ? desc(expression) : asc(expression),
        descending ? desc(pluginRecords.id) : asc(pluginRecords.id),
      )
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toRecord),
      after: rows.length > limit && last !== undefined ? cursorOf(last.sortKey, last.id) : null,
    };
  }

  /** The records whose search fields hold the words, best first. */
  async search(
    scope: RecordScope,
    words: string,
    options: Pick<RecordQuery, "where" | "limit" | "project">,
    visibility?: Visibility,
  ): Promise<RecordPage<Record<string, unknown>>> {
    const limit = Math.min(Math.max(options.limit ?? PLUGIN_LIST_LIMIT, 1), PLUGIN_LIST_LIMIT);
    const trimmed = words.trim().slice(0, 200);
    if (trimmed.length === 0) {
      return { items: [], after: null };
    }
    const projectId = await this.projectIdOf(scope, options.project);
    const query = sql`websearch_to_tsquery('simple', ${trimmed})`;
    const rows = await drizzleOf(this.database)
      .select(recordColumns)
      .from(pluginRecords)
      .where(
        and(
          this.within(scope),
          isNull(pluginRecords.archivedAt),
          sql`${pluginRecords.search} @@ ${query}`,
          projectId === undefined ? undefined : eq(pluginRecords.projectId, projectId),
          this.whereOf(scope, options.where),
          this.visibleTo(visibility),
        ),
      )
      .orderBy(sql`ts_rank(${pluginRecords.search}, ${query}) desc`, asc(pluginRecords.id))
      .limit(limit);
    return { items: rows.map(toRecord), after: null };
  }

  /** Counts, sums, least and most over the indexed fields, grouped by up to two of them. */
  async aggregate(
    scope: RecordScope,
    aggregation: RecordAggregation,
    visibility?: Visibility,
  ): Promise<RecordAggregate[]> {
    const groupBy = aggregation.groupBy ?? [];
    if (groupBy.length > 2) {
      throw invalid("aggregate groups by two fields at most");
    }
    const groups = groupBy.map((field) => ({ field, expression: this.field(scope, field) }));
    const numeric = (field: string) => {
      this.field(scope, field);
      return sql`(${pluginRecords.data} ->> ${field})::numeric`;
    };
    const isNumber = (field: string) =>
      sql`jsonb_typeof(${pluginRecords.data} -> ${field}) = 'number'`;
    const selection: Record<string, SQL> = {};
    groups.forEach((group, index) => {
      selection[`g${index}`] = sql`${group.expression}`;
    });
    if (aggregation.count === true) {
      selection.count = sql`count(*)`;
    }
    for (const field of aggregation.sum ?? []) {
      selection[`sum_${field}`] = sql`sum(${numeric(field)}) filter (where ${isNumber(field)})`;
    }
    // The database has no least or most of a jsonb value: numbers are compared as numbers,
    // strings as strings, and a field that holds both answers the numbers' least or most.
    const extreme = (fn: "min" | "max", field: string): SQL => {
      this.field(scope, field);
      const call = sql.raw(fn);
      return sql`coalesce(to_jsonb(${call}(${numeric(field)}) filter (where ${isNumber(field)})), to_jsonb(${call}(${pluginRecords.data} ->> ${field}) filter (where jsonb_typeof(${pluginRecords.data} -> ${field}) = 'string')))`;
    };
    for (const field of aggregation.min ?? []) {
      selection[`min_${field}`] = extreme("min", field);
    }
    for (const field of aggregation.max ?? []) {
      selection[`max_${field}`] = extreme("max", field);
    }
    const rows = await drizzleOf(this.database)
      .select(selection as Record<string, SQL<unknown>>)
      .from(pluginRecords)
      .where(
        and(
          this.within(scope),
          isNull(pluginRecords.archivedAt),
          this.whereOf(scope, aggregation.where),
          this.visibleTo(visibility),
        ),
      )
      // By position: a parameter in the select and the same in the group by are two to the database.
      .groupBy(...groups.map((_group, index) => sql.raw(String(index + 1))))
      .limit(1000);
    const scalar = (value: unknown): WhereScalar =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : value === null || value === undefined
          ? null
          : String(value);
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      const result: {
        group: Record<string, WhereScalar>;
        count?: number;
        sum?: Record<string, number>;
        min?: Record<string, WhereScalar>;
        max?: Record<string, WhereScalar>;
      } = {
        group: Object.fromEntries(
          groups.map((group, index) => [group.field, scalar(record[`g${index}`])]),
        ),
      };
      if (aggregation.count === true) {
        result.count = Number(record.count ?? 0);
      }
      if ((aggregation.sum ?? []).length > 0) {
        result.sum = Object.fromEntries(
          (aggregation.sum ?? []).map((field) => [field, Number(record[`sum_${field}`] ?? 0)]),
        );
      }
      if ((aggregation.min ?? []).length > 0) {
        result.min = Object.fromEntries(
          (aggregation.min ?? []).map((field) => [field, scalar(record[`min_${field}`])]),
        );
      }
      if ((aggregation.max ?? []).length > 0) {
        result.max = Object.fromEntries(
          (aggregation.max ?? []).map((field) => [field, scalar(record[`max_${field}`])]),
        );
      }
      return result;
    });
  }

  /** The versions kept of a record, oldest first. */
  async versions(
    scope: RecordScope,
    id: string,
    visibility?: Visibility,
  ): Promise<RecordVersion[]> {
    const record = await this.read(drizzleOf(this.database), scope, id, visibility);
    if (record === undefined) {
      throw new PluginRefusal("plugin.not_found", `${scope.collection.name}: no record ${id}`);
    }
    const rows = await drizzleOf(this.database)
      .select({
        version: pluginRecordVersions.version,
        data: pluginRecordVersions.data,
        at: pluginRecordVersions.at,
        byId: pluginRecordVersions.byId,
      })
      .from(pluginRecordVersions)
      .where(eq(pluginRecordVersions.recordId, id))
      .orderBy(asc(pluginRecordVersions.version));
    return rows.map((row) => ({
      version: row.version,
      data: row.data,
      at: row.at.toISOString(),
      by: row.byId,
    }));
  }

  /** One version of a record: a kept one, or the current. */
  async version(
    scope: RecordScope,
    id: string,
    version: number,
    visibility?: Visibility,
  ): Promise<RecordVersion | undefined> {
    const record = await this.read(drizzleOf(this.database), scope, id, visibility);
    if (record === undefined) {
      return undefined;
    }
    if (record.version === version) {
      return {
        version,
        data: record.data,
        at: record.updatedAt.toISOString(),
        by: record.updatedById,
      };
    }
    const [row] = await drizzleOf(this.database)
      .select({
        data: pluginRecordVersions.data,
        at: pluginRecordVersions.at,
        byId: pluginRecordVersions.byId,
      })
      .from(pluginRecordVersions)
      .where(and(eq(pluginRecordVersions.recordId, id), eq(pluginRecordVersions.version, version)))
      .limit(1);
    return row === undefined
      ? undefined
      : { version, data: row.data, at: row.at.toISOString(), by: row.byId };
  }

  private targetOf(target: LinkTarget): {
    kind: string;
    id: string;
    plugin: string | null;
    collection: string | null;
  } {
    const kinds = ["task", "decision", "document", "project", "run", "record"];
    if (
      typeof target !== "object" ||
      target === null ||
      !kinds.includes(target.kind) ||
      typeof target.id !== "string" ||
      !UUID.test(target.id)
    ) {
      throw invalid(
        "a link names a task, a decision, a document, a project, a run or a record, by id",
      );
    }
    if (target.kind === "record") {
      return {
        kind: "record",
        id: target.id,
        plugin: target.plugin ?? null,
        collection: target.collection ?? null,
      };
    }
    return { kind: target.kind, id: target.id, plugin: null, collection: null };
  }

  async link(scope: RecordScope, id: string, target: LinkTarget): Promise<void> {
    const record = await this.read(drizzleOf(this.database), scope, id);
    if (record === undefined) {
      throw new PluginRefusal("plugin.not_found", `${scope.collection.name}: no record ${id}`);
    }
    const resolved = this.targetOf(target);
    await drizzleOf(this.database)
      .insert(pluginLinks)
      .values({
        workspaceId: scope.workspaceId,
        pluginKey: scope.plugin,
        recordId: id,
        targetKind: resolved.kind,
        targetId: resolved.id,
        targetPlugin: resolved.plugin,
        targetCollection: resolved.collection,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing();
  }

  async unlink(scope: RecordScope, id: string, target: LinkTarget): Promise<void> {
    const resolved = this.targetOf(target);
    await drizzleOf(this.database)
      .delete(pluginLinks)
      .where(
        and(
          eq(pluginLinks.pluginKey, scope.plugin),
          eq(pluginLinks.recordId, id),
          eq(pluginLinks.targetKind, resolved.kind),
          eq(pluginLinks.targetId, resolved.id),
        ),
      );
  }

  async links(scope: RecordScope, id: string, visibility?: Visibility): Promise<LinkTarget[]> {
    const record = await this.read(drizzleOf(this.database), scope, id, visibility);
    if (record === undefined) {
      throw new PluginRefusal("plugin.not_found", `${scope.collection.name}: no record ${id}`);
    }
    const rows = await drizzleOf(this.database)
      .select({
        kind: pluginLinks.targetKind,
        id: pluginLinks.targetId,
        plugin: pluginLinks.targetPlugin,
        collection: pluginLinks.targetCollection,
      })
      .from(pluginLinks)
      .where(and(eq(pluginLinks.pluginKey, scope.plugin), eq(pluginLinks.recordId, id)))
      .orderBy(asc(pluginLinks.createdAt));
    return rows.map((row) =>
      row.kind === "record"
        ? {
            kind: "record" as const,
            id: row.id,
            collection: row.collection ?? "",
            ...(row.plugin === null ? {} : { plugin: row.plugin }),
          }
        : { kind: row.kind as "task" | "decision" | "document" | "project" | "run", id: row.id },
    );
  }

  /** The bytes the plugin's files hold together: on its records, and uploaded and not yet attached. */
  async fileBytes(workspaceId: string, plugin: string): Promise<number> {
    const db = drizzleOf(this.database);
    const [attached] = await db
      .select({ bytes: sql<string | null>`sum(${pluginRecordFiles.fileSize})` })
      .from(pluginRecordFiles)
      .where(
        and(
          eq(pluginRecordFiles.workspaceId, workspaceId),
          eq(pluginRecordFiles.pluginKey, plugin),
        ),
      );
    const [pending] = await db
      .select({ bytes: sql<string | null>`sum(${pluginUploads.fileSize})` })
      .from(pluginUploads)
      .where(and(eq(pluginUploads.workspaceId, workspaceId), eq(pluginUploads.pluginKey, plugin)));
    return Number(attached?.bytes ?? 0) + Number(pending?.bytes ?? 0);
  }

  /** Keeps the bytes a person uploaded for a command, and answers the handle it attaches with. */
  async upload(
    workspaceId: string,
    plugin: string,
    personId: string,
    bytes: Uint8Array,
    name: string,
    contentType: string,
  ): Promise<PluginFileHandle> {
    if (
      this.fileBytesAtMost !== undefined &&
      (await this.fileBytes(workspaceId, plugin)) + bytes.byteLength > this.fileBytesAtMost
    ) {
      throw new PluginRefusal(
        "plugin.too_many",
        `the plugin's files hold ${this.fileBytesAtMost} bytes at most together`,
      );
    }
    const now = this.clock.now();
    const kept = await this.blobs.put(bytes, now);
    const [row] = await drizzleOf(this.database)
      .insert(pluginUploads)
      .values({
        workspaceId,
        pluginKey: plugin,
        personId,
        fileName: name,
        fileSize: kept.size,
        contentType,
        sha256: kept.sha256,
        createdAt: now,
        expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
      })
      .returning({ id: pluginUploads.id });
    if (row === undefined) {
      throw new Error("plugin upload insert returned no row");
    }
    return { handle: row.id, name, type: contentType, bytes: kept.size };
  }

  /** An upload by its handle, for a `file` argument: the caller's own, of this plugin, not yet expired; or nothing. */
  async uploadOf(
    workspaceId: string,
    plugin: string,
    handle: string,
    personId: string,
  ): Promise<PluginFileHandle | undefined> {
    if (!UUID.test(handle)) {
      return undefined;
    }
    const [upload] = await drizzleOf(this.database)
      .select({
        id: pluginUploads.id,
        fileName: pluginUploads.fileName,
        fileSize: pluginUploads.fileSize,
        contentType: pluginUploads.contentType,
        expiresAt: pluginUploads.expiresAt,
      })
      .from(pluginUploads)
      .where(
        and(
          eq(pluginUploads.id, handle),
          eq(pluginUploads.workspaceId, workspaceId),
          eq(pluginUploads.pluginKey, plugin),
          eq(pluginUploads.personId, personId),
        ),
      )
      .limit(1);
    if (upload === undefined || upload.expiresAt.getTime() <= this.clock.now().getTime()) {
      return undefined;
    }
    return {
      handle: upload.id,
      name: upload.fileName,
      type: upload.contentType,
      bytes: upload.fileSize,
    };
  }

  /** Attaches an uploaded file to a record: the handle's, uploaded by the caller, not yet expired. */
  async attachFile(
    scope: RecordScope,
    id: string,
    handle: PluginFileHandle | string,
    options: { readonly name?: string | undefined; readonly type?: string | undefined },
    writer: Writer,
  ): Promise<RecordFile> {
    const handleId = typeof handle === "string" ? handle : handle.handle;
    if (!UUID.test(handleId)) {
      throw invalid("the handle is not one an upload answered with");
    }
    const now = this.clock.now();
    return drizzleOf(this.database).transaction(async (tx) => {
      const record = await this.read(tx, scope, id);
      if (record === undefined) {
        throw new PluginRefusal("plugin.not_found", `${scope.collection.name}: no record ${id}`);
      }
      const [upload] = await tx
        .select()
        .from(pluginUploads)
        .where(
          and(
            eq(pluginUploads.id, handleId),
            eq(pluginUploads.workspaceId, scope.workspaceId),
            eq(pluginUploads.pluginKey, scope.plugin),
            writer.personId === undefined ? undefined : eq(pluginUploads.personId, writer.personId),
          ),
        )
        .for("update");
      if (upload === undefined || upload.expiresAt.getTime() <= now.getTime()) {
        throw new PluginRefusal(
          "plugin.not_found",
          "the handle names no upload of this plugin's that is still good",
        );
      }
      const [file] = await tx
        .insert(pluginRecordFiles)
        .values({
          workspaceId: scope.workspaceId,
          pluginKey: scope.plugin,
          recordId: id,
          fileName: options.name ?? upload.fileName,
          fileSize: upload.fileSize,
          contentType: options.type ?? upload.contentType,
          sha256: upload.sha256,
          createdAt: now,
          createdById: writer.personId ?? null,
          agent: writer.agent ?? null,
        })
        .returning();
      await tx.delete(pluginUploads).where(eq(pluginUploads.id, handleId));
      if (file === undefined) {
        throw new Error("plugin record file insert returned no row");
      }
      return {
        id: file.id,
        name: file.fileName,
        type: file.contentType,
        bytes: file.fileSize,
        sha256: file.sha256,
        createdAt: file.createdAt.toISOString(),
      };
    });
  }

  async listFiles(scope: RecordScope, id: string, visibility?: Visibility): Promise<RecordFile[]> {
    const record = await this.read(drizzleOf(this.database), scope, id, visibility);
    if (record === undefined) {
      throw new PluginRefusal("plugin.not_found", `${scope.collection.name}: no record ${id}`);
    }
    const rows = await drizzleOf(this.database)
      .select()
      .from(pluginRecordFiles)
      .where(eq(pluginRecordFiles.recordId, id))
      .orderBy(asc(pluginRecordFiles.createdAt));
    return rows.map((file) => ({
      id: file.id,
      name: file.fileName,
      type: file.contentType,
      bytes: file.fileSize,
      sha256: file.sha256,
      createdAt: file.createdAt.toISOString(),
    }));
  }

  async removeFile(scope: RecordScope, id: string, fileId: string): Promise<void> {
    if (!UUID.test(fileId)) {
      throw new PluginRefusal("plugin.not_found", "no such file");
    }
    const removed = await drizzleOf(this.database)
      .delete(pluginRecordFiles)
      .where(
        and(
          eq(pluginRecordFiles.recordId, id),
          eq(pluginRecordFiles.id, fileId),
          eq(pluginRecordFiles.pluginKey, scope.plugin),
        ),
      )
      .returning({ id: pluginRecordFiles.id });
    if (removed.length === 0) {
      throw new PluginRefusal("plugin.not_found", "no such file on the record");
    }
  }

  /** A file of the plugin's by id, with the record it is on, for a read under the record's rule. */
  async fileOf(
    workspaceId: string,
    plugin: string,
    fileId: string,
  ): Promise<
    | {
        readonly name: string;
        readonly contentType: string;
        readonly sha256: string;
        readonly recordId: string;
        readonly collection: string;
      }
    | undefined
  > {
    if (!UUID.test(fileId)) {
      return undefined;
    }
    const [row] = await drizzleOf(this.database)
      .select({
        name: pluginRecordFiles.fileName,
        contentType: pluginRecordFiles.contentType,
        sha256: pluginRecordFiles.sha256,
        recordId: pluginRecordFiles.recordId,
        collection: pluginRecords.collection,
      })
      .from(pluginRecordFiles)
      .innerJoin(pluginRecords, eq(pluginRecords.id, pluginRecordFiles.recordId))
      .where(
        and(
          eq(pluginRecordFiles.workspaceId, workspaceId),
          eq(pluginRecordFiles.pluginKey, plugin),
          eq(pluginRecordFiles.id, fileId),
        ),
      )
      .limit(1);
    return row;
  }

  /** The bytes of a file, from the blob store. */
  bytesOf(sha256: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(sha256);
  }

  /** Everything the plugin keeps, as JSON Lines: records, their versions, links and files, a page at a time. */
  async *exportLines(workspaceId: string, plugin: string): AsyncGenerator<string> {
    const db = drizzleOf(this.database);
    let after: string | undefined;
    for (;;) {
      const rows = await db
        .select(recordColumns)
        .from(pluginRecords)
        .where(
          and(
            eq(pluginRecords.workspaceId, workspaceId),
            eq(pluginRecords.pluginKey, plugin),
            after === undefined ? undefined : sql`${pluginRecords.id} > ${after}::uuid`,
          ),
        )
        .orderBy(asc(pluginRecords.id))
        .limit(EXPORT_PAGE);
      for (const row of rows) {
        yield `${JSON.stringify({ type: "record", ...toRecord(row) })}\n`;
        const versions = await db
          .select({
            version: pluginRecordVersions.version,
            data: pluginRecordVersions.data,
            at: pluginRecordVersions.at,
            byId: pluginRecordVersions.byId,
          })
          .from(pluginRecordVersions)
          .where(eq(pluginRecordVersions.recordId, row.id))
          .orderBy(asc(pluginRecordVersions.version));
        for (const version of versions) {
          yield `${JSON.stringify({ type: "version", record: row.id, version: version.version, data: version.data, at: version.at.toISOString(), by: version.byId })}\n`;
        }
      }
      const last = rows.at(-1);
      if (rows.length < EXPORT_PAGE || last === undefined) {
        break;
      }
      after = last.id;
    }
    const links = await db
      .select()
      .from(pluginLinks)
      .where(and(eq(pluginLinks.workspaceId, workspaceId), eq(pluginLinks.pluginKey, plugin)))
      .orderBy(asc(pluginLinks.createdAt));
    for (const link of links) {
      yield `${JSON.stringify({ type: "link", record: link.recordId, kind: link.targetKind, id: link.targetId, plugin: link.targetPlugin, collection: link.targetCollection })}\n`;
    }
    const files = await db
      .select()
      .from(pluginRecordFiles)
      .where(
        and(
          eq(pluginRecordFiles.workspaceId, workspaceId),
          eq(pluginRecordFiles.pluginKey, plugin),
        ),
      )
      .orderBy(asc(pluginRecordFiles.createdAt));
    for (const file of files) {
      yield `${JSON.stringify({ type: "file", id: file.id, record: file.recordId, name: file.fileName, contentType: file.contentType, bytes: file.fileSize, sha256: file.sha256 })}\n`;
    }
  }

  /** Removes everything the plugin keeps here: records with their versions, files and links, and its uploads. */
  async purge(
    workspaceId: string,
    plugin: string,
  ): Promise<{ records: number; links: number; uploads: number }> {
    return drizzleOf(this.database).transaction(async (tx) => {
      const records = await tx
        .delete(pluginRecords)
        .where(and(eq(pluginRecords.workspaceId, workspaceId), eq(pluginRecords.pluginKey, plugin)))
        .returning({ id: pluginRecords.id });
      const links = await tx
        .delete(pluginLinks)
        .where(and(eq(pluginLinks.workspaceId, workspaceId), eq(pluginLinks.pluginKey, plugin)))
        .returning({ id: pluginLinks.id });
      const uploads = await tx
        .delete(pluginUploads)
        .where(and(eq(pluginUploads.workspaceId, workspaceId), eq(pluginUploads.pluginKey, plugin)))
        .returning({ id: pluginUploads.id });
      return { records: records.length, links: links.length, uploads: uploads.length };
    });
  }
}

/** Removes the uploads nobody attached in time; the janitor's. */
export async function deleteExpiredUploads(database: Database, now: Date): Promise<number> {
  const removed = await drizzleOf(database)
    .delete(pluginUploads)
    .where(lt(pluginUploads.expiresAt, now))
    .returning({ id: pluginUploads.id });
  return removed.length;
}
