import { describe, expect, it } from "vitest";
import * as z from "zod";
import { defineCollection } from "./define.js";
import { createTestContext } from "./testing.js";

const requests = defineCollection("requests", {
  schema: z.object({
    personId: z.string(),
    state: z.enum(["requested", "approved"]),
    days: z.number().int().min(0),
  }),
  indexes: ["personId", "state", "days"],
  search: ["personId"],
  owner: "personId",
  read: ["approver"],
});

describe("createTestContext", () => {
  it("keeps records in memory, checked against the schema, owned by the owner field", async () => {
    const ctx = createTestContext({
      collections: [requests],
      now: () => new Date("2026-11-01T10:00:00Z"),
    });
    const record = await ctx
      .records(requests)
      .create({ personId: "p1", state: "requested", days: 2 });
    expect(record).toMatchObject({
      collection: "requests",
      owner: "p1",
      version: 1,
      createdBy: "person-1",
      createdAt: "2026-11-01T10:00:00.000Z",
      archivedAt: null,
    });
    expect(await ctx.records(requests).get(record.id)).toEqual(record);
    expect(await ctx.records("requests").get("nothing")).toBeNull();
    await expect(
      ctx.records(requests).create({ personId: "p1", state: "requested", days: -1 }),
    ).rejects.toMatchObject({
      code: "plugin.invalid_args",
      message: expect.stringContaining("days"),
    });
    await expect(
      ctx.records(requests).create({ personId: "p1", state: "lost" } as never),
    ).rejects.toMatchObject({ code: "plugin.invalid_args" });
  });

  it("updates with versions and refuses a stale baseVersion", async () => {
    const ctx = createTestContext({ collections: [requests] });
    const created = await ctx
      .records(requests)
      .create({ personId: "p1", state: "requested", days: 2 });
    const updated = await ctx
      .records(requests)
      .update(created.id, { state: "approved" }, { baseVersion: 1 });
    expect(updated.version).toBe(2);
    expect(updated.data).toEqual({ personId: "p1", state: "approved", days: 2 });
    await expect(
      ctx.records(requests).update(created.id, { days: 3 }, { baseVersion: 1 }),
    ).rejects.toMatchObject({ code: "plugin.conflict" });
    expect(await ctx.records(requests).versions(created.id)).toEqual([
      {
        version: 1,
        data: { personId: "p1", state: "requested", days: 2 },
        at: created.createdAt,
        by: "person-1",
      },
    ]);
    await ctx.records(requests).archive(created.id);
    expect((await ctx.records(requests).list()).items).toEqual([]);
    expect((await ctx.records(requests).list({ archived: true })).items).toHaveLength(1);
    await ctx.records(requests).restore(created.id);
    expect((await ctx.records(requests).list()).items).toHaveLength(1);
  });

  it("lists by where, order and pages, on indexed fields only", async () => {
    const ctx = createTestContext({ collections: [requests] });
    const records = ctx.records(requests);
    for (const [personId, state, days] of [
      ["p1", "requested", 1],
      ["p2", "approved", 3],
      ["p1", "approved", 2],
    ] as const) {
      await records.create({ personId, state, days });
    }
    const approved = await records.list({
      where: { state: "approved" },
      order: { field: "days", descending: true },
    });
    expect(approved.items.map((item) => item.data.days)).toEqual([3, 2]);
    expect((await records.list({ where: { days: { gte: 2 } } })).items).toHaveLength(2);
    expect((await records.list({ where: { personId: { in: ["p2"] } } })).items).toHaveLength(1);
    expect((await records.list({ where: { state: { exists: true } } })).items).toHaveLength(3);
    const first = await records.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.after).not.toBeNull();
    const second = await records.list({ limit: 2, after: first.after ?? undefined });
    expect(second.items).toHaveLength(1);
    expect(second.after).toBeNull();
    await expect(records.list({ where: { reason: "x" } })).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
    expect((await records.search("p2")).items).toHaveLength(1);
    expect(
      await records.aggregate({ groupBy: ["state"], count: true, sum: ["days"], max: ["days"] }),
    ).toEqual([
      { group: { state: "requested" }, count: 1, sum: { days: 1 }, max: { days: 1 } },
      { group: { state: "approved" }, count: 2, sum: { days: 5 }, max: { days: 3 } },
    ]);
  });

  it("links records and keeps their files", async () => {
    const ctx = createTestContext({ collections: [requests] });
    const record = await ctx
      .records(requests)
      .create({ personId: "p1", state: "requested", days: 1 });
    await ctx.records(requests).link(record.id, { kind: "decision", id: "d1" });
    await ctx.records(requests).link(record.id, { kind: "decision", id: "d1" });
    expect(await ctx.records(requests).links(record.id)).toEqual([{ kind: "decision", id: "d1" }]);
    await ctx.records(requests).unlink(record.id, { kind: "decision", id: "d1" });
    expect(await ctx.records(requests).links(record.id)).toEqual([]);
    const file = await ctx
      .records(requests)
      .files(record.id)
      .attach({ handle: "h1", name: "note.txt", type: "text/plain", bytes: 4 });
    expect(file).toMatchObject({ name: "note.txt", type: "text/plain", bytes: 4 });
    expect(await ctx.records(requests).files(record.id).list()).toHaveLength(1);
    await ctx.records(requests).files(record.id).remove(file.id);
    expect(await ctx.records(requests).files(record.id).list()).toEqual([]);
  });

  it("acts as another plugin's caller, for a person or as itself (ADR-0072)", async () => {
    const ctx = createTestContext({
      plugins: {
        hr: {
          version: "1.0.0",
          api: { who: async () => "anyone" },
          for: (personId) => ({ version: "1.0.0", api: { who: async () => personId } }),
        },
      },
    });
    const hr = await ctx.plugins.get("hr");
    expect(await hr.api.who?.({})).toBe("anyone");
    expect(await hr.for("person-2").api.who?.({})).toBe("person-2");
    const forBob = ctx.as({
      kind: "plugin",
      plugin: "messenger",
      roles: ["employee"],
      for: { id: "person-2", login: "bob", name: "Bob", language: "ko", admin: false },
      project: null,
    });
    expect(forBob.language).toBe("ko");
    expect(forBob.caller.kind).toBe("plugin");
    const itself = ctx.as({
      kind: "plugin",
      plugin: "messenger",
      roles: [],
      for: null,
      project: null,
    });
    expect(itself.language).toBe("en");
    expect(itself.plugin.grants).toEqual([]);
  });

  it("refuses the console where nothing was given, and answers where it was", async () => {
    const ctx = createTestContext({
      console: {
        tasks: { create: async (project, task) => ({ project, title: task.title }) as never },
      },
      secrets: { token: "s3cret" },
      plugin: { settings: { daysPerYear: 15 } },
    });
    await expect(ctx.console.people.list()).rejects.toMatchObject({ code: "plugin.forbidden" });
    await expect(ctx.console.tasks.update("web", 1, {})).rejects.toMatchObject({
      code: "plugin.forbidden",
    });
    expect(await ctx.console.tasks.create("web", { title: "Hello" })).toEqual({
      project: "web",
      title: "Hello",
    });
    await expect(ctx.fetch("https://api.example.com/")).rejects.toMatchObject({
      code: "plugin.forbidden",
    });
    await expect(ctx.sql.query("select 1")).rejects.toMatchObject({ code: "plugin.forbidden" });
    await expect(ctx.plugins.get("crm")).rejects.toMatchObject({ code: "plugin.forbidden" });
    expect(ctx.plugin.settings.daysPerYear).toBe(15);
    expect(await ctx.secrets.has("token")).toBe(true);
    expect(await ctx.secrets.has("other")).toBe(false);
    expect(await ctx.secrets.status("token")).toMatchObject({
      set: true,
      expiresAt: null,
      source: "administrator",
    });
    expect(await ctx.secrets.status("other")).toEqual({
      set: false,
      setAt: null,
      expiresAt: null,
      source: null,
    });
    const signature = await ctx.secrets.sign("token", "payload", "hmac-sha256");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await ctx.secrets.verify("token", "payload", signature, "hmac-sha256")).toBe(true);
    expect(await ctx.secrets.verify("token", "other", signature, "hmac-sha256")).toBe(false);
  });

  it("answers an endpoint's address from the public origin given, and refuses without one", async () => {
    const ctx = createTestContext({
      plugin: { key: "leave" },
      publicUrl: "https://console.example",
      endpoints: ["slack"],
    });
    await expect(ctx.endpoints.url("slack")).resolves.toBe(
      "https://console.example/api/v1/plugins/leave/x/slack",
    );
    await expect(ctx.endpoints.url("nope")).rejects.toMatchObject({ code: "plugin.not_found" });
    await expect(createTestContext().endpoints.url("slack")).rejects.toMatchObject({
      code: "plugin.unavailable",
    });
  });

  it("keeps what was emitted and logged, and acts as another caller on the same store", async () => {
    const ctx = createTestContext({ collections: [requests] });
    await ctx.events.emit("requested", { id: "r1" });
    ctx.log.info("hello", { n: 1 });
    ctx.log.error("failed");
    expect(ctx.emitted).toEqual([{ kind: "requested", data: { id: "r1" } }]);
    expect(ctx.logged).toEqual([
      { level: "info", message: "hello", fields: { n: 1 } },
      { level: "error", message: "failed", fields: undefined },
    ]);
    const asConsole = ctx.as({ kind: "console", roles: ["approver"], project: null });
    const record = await asConsole
      .records(requests)
      .create({ personId: "p1", state: "requested", days: 1 });
    expect(record.createdBy).toBeNull();
    expect(asConsole.language).toBe("en");
    expect(ctx.all("requests")).toHaveLength(1);
  });
});
