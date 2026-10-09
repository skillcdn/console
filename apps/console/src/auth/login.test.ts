import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./login.js";

describe("safeReturnTo", () => {
  const origin = "https://console.test";

  it("keeps a path of this origin, with its query, and nothing else", () => {
    expect(safeReturnTo("/tasks/42?state=done#top", origin)).toBe("/tasks/42?state=done");
    expect(safeReturnTo("/", origin)).toBe("/");
    expect(safeReturnTo(undefined, origin)).toBe("/");
  });

  it.each([
    "//evil.test/path",
    "https://evil.test/",
    "/\\evil.test",
    "javascript:alert(1)",
    "tasks",
    "/.//evil.test",
    `/${"a".repeat(2049)}`,
  ])("sends %s to the front page", (value) => {
    expect(safeReturnTo(value, origin)).toBe("/");
  });
});
