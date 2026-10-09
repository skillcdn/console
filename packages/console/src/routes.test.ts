import { describe, expect, it } from "vitest";
import { AUTH_ROUTES, isSignInFailure, loginPath, restPath, signInPath } from "./routes.js";

describe("routes", () => {
  it("builds the way to a provider and back", () => {
    expect(loginPath("gh", "/tasks/42?x=1")).toBe("/auth/gh/login?return_to=%2Ftasks%2F42%3Fx%3D1");
    expect(AUTH_ROUTES.login("google")).toBe("/auth/google/login");
    expect(AUTH_ROUTES.callback("google")).toBe("/auth/google/callback");
  });

  it("tells a page why a sign-in did not complete", () => {
    expect(signInPath("/", "denied")).toBe("/?sign_in=denied");
    expect(signInPath("/tasks?state=done", "refused")).toBe("/tasks?state=done&sign_in=refused");
    expect(isSignInFailure("expired")).toBe(true);
    expect(isSignInFailure("ok")).toBe(false);
    expect(isSignInFailure(null)).toBe(false);
  });

  it("names a resource by its id, escaped", () => {
    expect(restPath("tasks", "a/b")).toBe("/api/v1/tasks/a%2Fb");
    expect(restPath("decisions", "d1")).toBe("/api/v1/decisions/d1");
    expect(restPath("tokens", "t1")).toBe("/api/v1/tokens/t1");
  });
});
