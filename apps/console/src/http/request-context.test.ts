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

  it("masks the code of an invitation the same way, on the guide's page and under the API", () => {
    expect(loggedPath("/setup/K7Q2M9XD")).toBe("/setup/<code>");
    expect(loggedPath("/api/v1/setup/K7Q2M9XD")).toBe("/api/v1/setup/<code>");
    expect(loggedPath("/api/v1/setup")).toBe("/api/v1/setup");
    // A path that only ends in the word is no code's.
    expect(loggedPath("/api/v1/agents/setup")).toBe("/api/v1/agents/setup");
    expect(loggedPath("/projects/setup/board")).toBe("/projects/setup/board");
  });
});
