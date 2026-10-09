import { describe, expect, it } from "vitest";
import { selectRole } from "./roles.js";

describe("selectRole", () => {
  it("selects a known role from the first argument", () => {
    expect(selectRole(["api"])).toEqual({ ok: true, role: "api" });
    expect(selectRole(["worker", "--ignored"])).toEqual({ ok: true, role: "worker" });
    expect(selectRole(["migrate"])).toEqual({ ok: true, role: "migrate" });
  });

  it("says when no role or an unknown one was asked for", () => {
    expect(selectRole([])).toEqual({ ok: false, reason: "missing" });
    expect(selectRole(["check"])).toEqual({ ok: false, reason: "unknown" });
    expect(selectRole(["API"])).toEqual({ ok: false, reason: "unknown" });
  });
});
