import process from "node:process";
import { type CollectionDescription, MAX_PLUGIN_RECORD_BYTES } from "@skillcdn/console/plugin";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBlobStore } from "../adapters/pg-blob-store.js";
import { drizzleOf } from "../db/client.js";
import { findPerson, type PersonRecord } from "../db/queries/people.js";
import { ensureWorkspace } from "../db/queries/workspaces.js";
import { pluginRecords } from "../db/schema.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "../db/testing.js";
import { createFixtureProvider } from "../testing/fixture-provider.js";
import { createHarness, type Harness } from "../testing/harness.js";
import { type RecordScope, RecordStore, type Writer } from "./records.js";

// The record store against a real database: the rules of a collection, the quotas, the reads by
// role and project, versions, links, files, export and purge.

let testDatabase: TestDatabase;
let h: Harness;
let store: RecordStore;
let workspaceId: string;
let alice: PersonRecord;
let bob: PersonRecord;
let privateProjectKey: string;

const requests: CollectionDescription = {
  name: "requests",
  indexes: ["personId", "state", "days"],
  search: ["reason"],
  owner: "personId",
  project: "optional",
  read: ["approver"],
  readOwn: ["employee"],
  history: true,
  retention: null,
};
const notes: CollectionDescription = {
  name: "notes",
  indexes: [],
  search: [],
  owner: null,
  project: "none",
  read: [],
  readOwn: [],
  history: false,
  retention: null,
};
/** A log-like collection: light, and forgotten after a while, by a day its records name. */
const deliveries: CollectionDescription = {
  name: "deliveries",
  indexes: ["sentOn"],
  search: [],
  owner: null,
  project: "none",
  read: [],
  readOwn: [],
  history: false,
  retention: { days: 30, by: "sentOn" },
};
const CONSOLE: Writer = { personId: undefined, agent: undefined };
let scope: RecordScope;

async function personOf(login: string): Promise<PersonRecord> {
  const cookie = await h.signIn(login);
  const me = (await (await h.request("/api/v1/me", { headers: { cookie } })).json()) as {
    person: { id: string };
  };
  const person = await findPerson(testDatabase.database, workspaceId, me.person.id);
  if (person === undefined) {
    throw new Error(`${login} is not a person`);
  }
  return person;
}

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, { providers: [createFixtureProvider("gh")], admins: ["alice"] });
  const workspace = await ensureWorkspace(testDatabase.database, { name: "Acme", now: new Date() });
  workspaceId = workspace.id;
  alice = await personOf("alice");
  bob = await personOf("bob");
  const cookie = await h.signIn("alice");
  const project = await h.project(cookie, {
    key: "secret-ops",
    name: "Secret",
    visibility: "private",
  });
  privateProjectKey = project.key;
  store = new RecordStore({
    database: testDatabase.database,
    blobs: createPgBlobStore(testDatabase.database),
    clock: { now: () => new Date() },
    fileBytesAtMost: 1_000,
  });
  scope = { workspaceId, plugin: "leave", collection: requests };
});

afterAll(async () => {
  await h?.close();
  await testDatabase?.drop();
});

describe("the record store", () => {
  it("creates, reads, updates with versions, and refuses a stale baseVersion", async () => {
    const created = await store.create(
      scope,
      { personId: alice.id, state: "requested", days: 2, reason: "a trip" },
      {},
      CONSOLE,
    );
    expect(created).toMatchObject({
      collection: "requests",
      owner: alice.id,
      project: null,
      version: 1,
      createdBy: null,
    });
    expect(await store.get(scope, created.id)).toEqual(created);
    expect(await store.get(scope, "00000000-0000-7000-8000-000000000000")).toBeUndefined();
    expect(await store.get(scope, "not-an-id")).toBeUndefined();
    const updated = await store.update(
      scope,
      created.id,
      { ...created.data, state: "approved" },
      { baseVersion: 1 },
      { personId: bob.id, agent: "Claude Code" },
    );
    expect(updated).toMatchObject({
      version: 2,
      updatedBy: bob.id,
      data: { state: "approved", days: 2 },
    });
    await expect(
      store.update(scope, created.id, created.data, { baseVersion: 1 }, CONSOLE),
    ).rejects.toMatchObject({ code: "plugin.conflict" });
    expect(await store.versions(scope, created.id)).toEqual([
      { version: 1, data: created.data, at: created.updatedAt, by: null },
    ]);
    expect((await store.version(scope, created.id, 1))?.data.state).toBe("requested");
    expect((await store.version(scope, created.id, 2))?.data.state).toBe("approved");
    expect(await store.version(scope, created.id, 3)).toBeUndefined();
  });

  it("holds a record to its size, and a collection to its project rule", async () => {
    await expect(
      store.create(
        scope,
        {
          personId: alice.id,
          state: "requested",
          days: 1,
          reason: "x".repeat(MAX_PLUGIN_RECORD_BYTES),
        },
        {},
        CONSOLE,
      ),
    ).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
    await expect(
      store.create(
        { ...scope, collection: notes },
        { text: "hi" },
        { project: privateProjectKey },
        CONSOLE,
      ),
    ).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
    await expect(
      store.create(
        scope,
        { personId: alice.id, state: "requested", days: 1 },
        { project: "nowhere" },
        CONSOLE,
      ),
    ).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
  });

  it("lists by indexed fields, in order, a page at a time, and refuses other fields", async () => {
    const own = { ...scope, plugin: "paging" };
    for (const [state, days, reason] of [
      ["requested", 1, "dentist"],
      ["approved", 3, "holiday in the mountains"],
      ["requested", 2, "moving house"],
      ["rejected", 5, "holiday again"],
      ["approved", 4, "family"],
    ] as const) {
      await store.create(own, { personId: alice.id, state, days, reason }, {}, CONSOLE);
    }
    const approved = await store.list(own, {
      where: { state: "approved" },
      order: { field: "days", descending: true },
    });
    expect(approved.items.map((item) => item.data.days)).toEqual([4, 3]);
    expect((await store.list(own, { where: { days: { gte: 3 } } })).items).toHaveLength(3);
    expect(
      (await store.list(own, { where: { days: { gt: 3, lt: 5 } } })).items.map(
        (item) => item.data.days,
      ),
    ).toEqual([4]);
    expect(
      (await store.list(own, { where: { state: { in: ["rejected", "approved"] } } })).items,
    ).toHaveLength(3);
    expect((await store.list(own, { where: { days: { exists: true } } })).items).toHaveLength(5);
    expect((await store.list(own, { where: { owner: alice.id } })).items).toHaveLength(5);
    await expect(store.list(own, { where: { reason: "dentist" } })).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
    await expect(store.list(own, { order: { field: "reason" } })).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });

    const first = await store.list(own, { order: { field: "days" }, limit: 2 });
    expect(first.items.map((item) => item.data.days)).toEqual([1, 2]);
    expect(first.after).not.toBeNull();
    const second = await store.list(own, {
      order: { field: "days" },
      limit: 2,
      after: first.after ?? undefined,
    });
    expect(second.items.map((item) => item.data.days)).toEqual([3, 4]);
    const third = await store.list(own, {
      order: { field: "days" },
      limit: 2,
      after: second.after ?? undefined,
    });
    expect(third.items.map((item) => item.data.days)).toEqual([5]);
    expect(third.after).toBeNull();
    const byId = await store.list(own, { limit: 3 });
    const rest = await store.list(own, { limit: 3, after: byId.after ?? undefined });
    expect(byId.items.length + rest.items.length).toBe(5);
    await expect(store.list(own, { after: "nonsense" })).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });

    const found = await store.search(own, "holiday", {});
    expect(found.items.map((item) => item.data.days).sort()).toEqual([3, 5]);
    expect(
      (await store.search(own, "holiday", { where: { state: "approved" } })).items,
    ).toHaveLength(1);

    const grouped = await store.aggregate(own, {
      groupBy: ["state"],
      count: true,
      sum: ["days"],
      min: ["days"],
      max: ["days"],
    });
    expect(
      grouped.sort((a, b) => String(a.group.state).localeCompare(String(b.group.state))),
    ).toEqual([
      {
        group: { state: "approved" },
        count: 2,
        sum: { days: 7 },
        min: { days: 3 },
        max: { days: 4 },
      },
      {
        group: { state: "rejected" },
        count: 1,
        sum: { days: 5 },
        min: { days: 5 },
        max: { days: 5 },
      },
      {
        group: { state: "requested" },
        count: 2,
        sum: { days: 3 },
        min: { days: 1 },
        max: { days: 2 },
      },
    ]);
    await expect(store.aggregate(own, { groupBy: ["a", "b", "c"] })).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
  });

  it("keeps an archived record out of the lists and brings it back", async () => {
    const own = { ...scope, plugin: "archiving" };
    const record = await store.create(
      own,
      { personId: alice.id, state: "requested", days: 1 },
      {},
      CONSOLE,
    );
    await store.archive(own, record.id);
    expect((await store.list(own, {})).items).toEqual([]);
    expect((await store.list(own, { archived: true })).items).toHaveLength(1);
    await store.restore(own, record.id);
    expect((await store.list(own, {})).items).toHaveLength(1);
    await expect(store.archive(own, "00000000-0000-7000-8000-000000000000")).rejects.toMatchObject({
      code: "plugin.not_found",
    });
  });

  it("reads for a person by their roles and within the projects they see", async () => {
    const own = { ...scope, plugin: "visibility" };
    const mine = await store.create(
      own,
      { personId: bob.id, state: "requested", days: 1 },
      {},
      CONSOLE,
    );
    const theirs = await store.create(
      own,
      { personId: alice.id, state: "requested", days: 1 },
      {},
      CONSOLE,
    );
    const hidden = await store.create(
      own,
      { personId: bob.id, state: "requested", days: 1 },
      { project: privateProjectKey },
      CONSOLE,
    );
    expect(hidden.project).not.toBeNull();
    const everything = await store.list(own, {});
    expect(everything.items).toHaveLength(3);
    const asBobOwn = await store.list(own, {}, { ownOnly: bob.id, person: bob });
    expect(asBobOwn.items.map((item) => item.id)).toEqual([mine.id]);
    expect(await store.get(own, theirs.id, { ownOnly: bob.id, person: bob })).toBeUndefined();
    const asAlice = await store.list(own, {}, { person: alice });
    expect(asAlice.items).toHaveLength(3);
    const asBobAll = await store.list(own, {}, { person: bob });
    expect(asBobAll.items.map((item) => item.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it("links a record to the board's items and to other records", async () => {
    const own = { ...scope, plugin: "linking" };
    const record = await store.create(
      own,
      { personId: alice.id, state: "requested", days: 1 },
      {},
      CONSOLE,
    );
    const decisionId = "00000000-0000-7000-8000-00000000d001";
    await store.link(own, record.id, { kind: "decision", id: decisionId });
    await store.link(own, record.id, { kind: "decision", id: decisionId });
    await store.link(own, record.id, {
      kind: "record",
      plugin: "crm",
      collection: "deals",
      id: "00000000-0000-7000-8000-00000000c001",
    });
    expect(await store.links(own, record.id)).toEqual([
      { kind: "decision", id: decisionId },
      {
        kind: "record",
        plugin: "crm",
        collection: "deals",
        id: "00000000-0000-7000-8000-00000000c001",
      },
    ]);
    await store.unlink(own, record.id, { kind: "decision", id: decisionId });
    expect(await store.links(own, record.id)).toHaveLength(1);
    await expect(
      store.link(own, record.id, { kind: "elsewhere", id: "x" } as never),
    ).rejects.toMatchObject({ code: "plugin.invalid_args" });
  });

  it("keeps uploaded files on records within the plugin's bound, and serves their bytes", async () => {
    const own = { ...scope, plugin: "filing" };
    const record = await store.create(
      own,
      { personId: alice.id, state: "requested", days: 1 },
      {},
      CONSOLE,
    );
    const handle = await store.upload(
      workspaceId,
      "filing",
      alice.id,
      new TextEncoder().encode("hello"),
      "note.txt",
      "text/plain",
    );
    expect(handle).toMatchObject({ name: "note.txt", type: "text/plain", bytes: 5 });
    await expect(
      store.attachFile(own, record.id, handle, {}, { personId: bob.id, agent: undefined }),
    ).rejects.toMatchObject({ code: "plugin.not_found" });
    const file = await store.attachFile(
      own,
      record.id,
      handle,
      { name: "renamed.txt" },
      { personId: alice.id, agent: undefined },
    );
    expect(file).toMatchObject({ name: "renamed.txt", type: "text/plain", bytes: 5 });
    expect(await store.listFiles(own, record.id)).toHaveLength(1);
    const found = await store.fileOf(workspaceId, "filing", file.id);
    expect(found).toMatchObject({
      name: "renamed.txt",
      recordId: record.id,
      collection: "requests",
    });
    expect(new TextDecoder().decode(await store.bytesOf(file.sha256))).toBe("hello");
    await expect(
      store.attachFile(own, record.id, handle, {}, { personId: alice.id, agent: undefined }),
    ).rejects.toMatchObject({ code: "plugin.not_found" });
    await expect(
      store.upload(
        workspaceId,
        "filing",
        alice.id,
        new Uint8Array(2_000),
        "big.bin",
        "application/octet-stream",
      ),
    ).rejects.toMatchObject({
      code: "plugin.too_many",
    });
    await store.removeFile(own, record.id, file.id);
    expect(await store.listFiles(own, record.id)).toEqual([]);
  });

  it("forgets what is past a collection's retention, by a day its records name or by their own moment", async () => {
    const own = { ...scope, plugin: "forgetting", collection: deliveries };
    const now = new Date("2026-11-08T12:00:00.000Z");
    const old = await store.create(own, { sentOn: "2026-09-01" }, {}, CONSOLE);
    // Thirty days before noon is noon of 2026-10-09: an instant later that day stays.
    const edge = await store.create(own, { sentOn: "2026-10-09T13:00:00Z" }, {}, CONSOLE);
    const fresh = await store.create(own, { sentOn: "2026-11-01" }, {}, CONSOLE);
    // What does not read as a day is kept, never guessed at.
    const odd = await store.create(own, { sentOn: "yesterday" }, {}, CONSOLE);
    expect(await store.sweepExpired(own, now)).toBe(1);
    expect(await store.get(own, old.id)).toBeUndefined();
    expect(await store.get(own, edge.id)).toBeDefined();
    expect(await store.get(own, fresh.id)).toBeDefined();
    expect(await store.get(own, odd.id)).toBeDefined();
    // By the record's own moment, where the collection says so; a collection without retention forgets nothing.
    const lines = {
      ...own,
      collection: { ...notes, name: "lines", retention: { days: 7, by: "createdAt" } },
    };
    const line = await store.create(lines, { text: "x" }, {}, CONSOLE);
    const kept = await store.create(lines, { text: "y" }, {}, CONSOLE);
    await drizzleOf(testDatabase.database)
      .update(pluginRecords)
      .set({ createdAt: new Date("2026-10-01T00:00:00.000Z") })
      .where(eq(pluginRecords.id, line.id));
    expect(await store.sweepExpired(lines, now)).toBe(1);
    expect(await store.get(lines, line.id)).toBeUndefined();
    expect(await store.get(lines, kept.id)).toBeDefined();
    expect(await store.sweepExpired({ ...own, collection: notes }, now)).toBe(0);
  });

  it("exports everything it keeps, and purges it", async () => {
    const own = { ...scope, plugin: "exporting" };
    const record = await store.create(
      own,
      { personId: alice.id, state: "requested", days: 1 },
      {},
      CONSOLE,
    );
    await store.update(own, record.id, { ...record.data, days: 2 }, {}, CONSOLE);
    await store.link(own, record.id, { kind: "task", id: "00000000-0000-7000-8000-00000000a001" });
    const lines: string[] = [];
    for await (const line of store.exportLines(workspaceId, "exporting")) {
      lines.push(line);
    }
    const types = lines.map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types).toEqual(["record", "version", "link"]);
    expect(await store.count(workspaceId, "exporting")).toBe(1);
    expect(await store.purge(workspaceId, "exporting")).toEqual({
      records: 1,
      links: 0,
      uploads: 0,
    });
    expect(await store.count(workspaceId, "exporting")).toBe(0);
    expect(await store.get(own, record.id)).toBeUndefined();
    expect(await store.count(workspaceId, "leave")).toBeGreaterThan(0);
  });
});
