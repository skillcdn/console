import { describe, expect, it } from "vitest";
import { loggedPath } from "./request-context.js";

describe("the path as the access log carries it", () => {
  it("masks a connect code, on the page and under the API, and leaves every other path alone", () => {
    expect(loggedPath("/connect/ABCD-EFGH")).toBe("/connect/<code>");
    expect(loggedPath("/api/v1/connect/ABCD-EFGH")).toBe("/api/v1/connect/<code>");
    expect(loggedPath("/api/v1/connect/ABCD-EFGH/approve")).toBe("/api/v1/connect/<code>/approve");
    expect(loggedPath("/api/v1/connect/ABCD-EFGH/deny")).toBe("/api/v1/connect/<code>/deny");
    expect(loggedPath("/api/v1/connect")).toBe("/api/v1/connect");
    expect(loggedPath("/api/v1/projects/web/pack-token/connect")).toBe(
      "/api/v1/projects/web/pack-token/connect",
    );
    expect(loggedPath("/projects/web")).toBe("/projects/web");
    expect(loggedPath("/")).toBe("/");
  });
});
