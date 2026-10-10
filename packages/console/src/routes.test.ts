import { describe, expect, it } from "vitest";
import {
  AUTH_ROUTES,
  isSignInFailure,
  loginPath,
  projectPath,
  restPath,
  signInPath,
} from "./routes.js";

describe("routes", () => {
  it("builds the way to a provider and back", () => {
    expect(loginPath("gh", "/p/web/tasks/42?x=1")).toBe(
      "/auth/gh/login?return_to=%2Fp%2Fweb%2Ftasks%2F42%3Fx%3D1",
    );
    expect(AUTH_ROUTES.login("google")).toBe("/auth/google/login");
    expect(AUTH_ROUTES.callback("google")).toBe("/auth/google/callback");
  });

  it("tells a page why a sign-in did not complete", () => {
    expect(signInPath("/", "denied")).toBe("/?sign_in=denied");
    expect(signInPath("/p/web?state=done", "refused")).toBe("/p/web?state=done&sign_in=refused");
    expect(isSignInFailure("expired")).toBe(true);
    expect(isSignInFailure("ok")).toBe(false);
    expect(isSignInFailure(null)).toBe(false);
  });

  it("names a resource of the workspace by its id, escaped, and a project's by its key", () => {
    expect(restPath("people", "a/b")).toBe("/api/v1/people/a%2Fb");
    expect(restPath("tokens", "t1")).toBe("/api/v1/tokens/t1");
    expect(restPath("projects", "web")).toBe("/api/v1/projects/web");
    expect(projectPath("web")).toBe("/api/v1/projects/web");
    expect(projectPath("web", "tasks")).toBe("/api/v1/projects/web/tasks");
    expect(projectPath("web", "tasks", "7")).toBe("/api/v1/projects/web/tasks/7");
    expect(projectPath("a b", "files", "x/y")).toBe("/api/v1/projects/a%20b/files/x%2Fy");
    // A document's path is one segment of the URL, its slashes encoded.
    expect(projectPath("web", "docs", "guides/onboarding")).toBe(
      "/api/v1/projects/web/docs/guides%2Fonboarding",
    );
  });
});
