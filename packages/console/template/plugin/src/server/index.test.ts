import { createTestContext } from "@skillcdn/console/plugin/testing";
import { describe, expect, it } from "vitest";
import { greet, greetings, latest } from "./index.js";

describe("greet", () => {
  it("keeps the greeting as a record and says so", async () => {
    const ctx = createTestContext({
      collections: [greetings],
      plugin: { settings: { greeting: "Hi" } },
    });
    const result = await greet.run(ctx, { to: "world" });
    expect(result.text).toContain("Hi, world!");
    expect(ctx.all("greetings")).toHaveLength(1);
    expect(ctx.all("greetings")[0]?.data).toEqual({
      to: "world",
      text: "Hi, world!",
      by: "tester",
    });
    expect(ctx.emitted).toEqual([
      { kind: "greeted", data: { id: expect.any(String), to: "world" } },
    ]);
  });

  it("refuses what does not fit the schema", async () => {
    const ctx = createTestContext({ collections: [greetings] });
    await expect(greet.run(ctx, { to: "x".repeat(81) })).rejects.toMatchObject({
      code: "plugin.invalid_args",
    });
  });
});

describe("latest", () => {
  it("answers the newest first, as many as asked", async () => {
    const ctx = createTestContext({ collections: [greetings] });
    await greet.run(ctx, { to: "first" });
    await greet.run(ctx, { to: "second" });
    await greet.run(ctx, { to: "third" });
    const items = (await latest.run(ctx, { limit: 2 })) as { data: { to: string } }[];
    expect(items.map((item) => item.data.to)).toEqual(["third", "second"]);
  });
});
