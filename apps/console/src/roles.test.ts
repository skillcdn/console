import { describe, expect, it } from "vitest";
import { selectRole } from "./roles.js";

describe("selectRole", () => {
  it("selects a known role from the first argument", () => {
    expect(selectRole(["api"])).toEqual({ ok: true, role: "api", args: [] });
    expect(selectRole(["worker", "--ignored"])).toEqual({
      ok: true,
      role: "worker",
      args: ["--ignored"],
    });
    expect(selectRole(["migrate"])).toEqual({ ok: true, role: "migrate", args: [] });
    // The words after the role are the role's own: the months `verify` checks.
    expect(selectRole(["verify", "2026-11", "2026-12"])).toEqual({
      ok: true,
      role: "verify",
      args: ["2026-11", "2026-12"],
    });
  });

  it("says when no role or an unknown one was asked for", () => {
    expect(selectRole([])).toEqual({ ok: false, reason: "missing" });
    expect(selectRole(["check"])).toEqual({ ok: false, reason: "unknown" });
    expect(selectRole(["API"])).toEqual({ ok: false, reason: "unknown" });
  });
});
