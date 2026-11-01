import { describe, expect, it } from "vitest";
import { satisfiesRange, settingProblem } from "./registry.js";
import { mayUse, rolesHeld } from "./roles.js";

describe("rolesHeld", () => {
  it("gives an administrator every role, a member the granted and the default ones, in the manifest's order", () => {
    const declared = ["employee", "approver", "auditor"];
    expect(rolesHeld({ admin: true, declared, defaultRole: undefined, granted: [] })).toEqual(
      declared,
    );
    expect(rolesHeld({ admin: false, declared, defaultRole: "employee", granted: [] })).toEqual([
      "employee",
    ]);
    expect(
      rolesHeld({
        admin: false,
        declared,
        defaultRole: "employee",
        granted: ["auditor", "approver"],
      }),
    ).toEqual(["employee", "approver", "auditor"]);
    expect(
      rolesHeld({ admin: false, declared, defaultRole: undefined, granted: ["stranger"] }),
    ).toEqual([]);
  });
});

describe("mayUse", () => {
  it("lets any of the named roles through, every member where none is named, and nobody without a role", () => {
    expect(mayUse(["approver"], ["employee"], ["employee", "approver"])).toBe(false);
    expect(mayUse(["approver", "employee"], ["employee"], ["employee", "approver"])).toBe(true);
    expect(mayUse(null, ["employee"], ["employee", "approver"])).toBe(true);
    expect(mayUse(null, [], ["employee", "approver"])).toBe(false);
    expect(mayUse(null, [], [])).toBe(true);
    expect(mayUse(["employee"], [], [])).toBe(false);
  });
});

describe("satisfiesRange", () => {
  it("reads the ranges a manifest's requires are written in", () => {
    expect(satisfiesRange("1.2.3", "*")).toBe(true);
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesRange("0.4.9", "^0.4.1")).toBe(true);
    expect(satisfiesRange("0.5.0", "^0.4.1")).toBe(false);
    expect(satisfiesRange("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.3", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
    expect(satisfiesRange("3.0.0", "^1.0.0 || ^3.0.0")).toBe(true);
    expect(satisfiesRange("not a version", "^1.0.0")).toBe(false);
  });
});

describe("settingProblem", () => {
  const setting = (type: string, extra: Record<string, unknown> = {}) =>
    ({ key: "s", type, name: { en: "S" }, ...extra }) as never;
  it("holds a value to its setting's type and bounds", () => {
    expect(settingProblem(setting("text", { max: 3 }), "abcd")).toBe("s is over 3 characters");
    expect(settingProblem(setting("text"), "a\nb")).toBe("s is one line");
    expect(settingProblem(setting("markdown"), "a\nb")).toBeUndefined();
    expect(settingProblem(setting("number", { min: 1, max: 5 }), 7)).toBe("s is above 5");
    expect(settingProblem(setting("number"), "7")).toBe("s is a number");
    expect(settingProblem(setting("boolean"), "yes")).toBe("s is true or false");
    expect(
      settingProblem(setting("enum", { options: [{ value: "a", name: { en: "A" } }] }), "b"),
    ).toBe("s is one of a");
    expect(settingProblem(setting("day"), "2026-13-01")).toBe("s is a day as YYYY-MM-DD");
    expect(settingProblem(setting("secret"), "x")).toBe("s is a secret, set with its own route");
    expect(settingProblem(setting("list", { of: "number", max: 1 }), [1, 2])).toBe(
      "s has more than 1 items",
    );
    expect(settingProblem(setting("list", { of: "number" }), [1, "2"])).toBe("s is a number");
    expect(settingProblem(setting("list", { of: "number" }), [1, 2])).toBeUndefined();
    expect(settingProblem(setting("text"), null)).toBeUndefined();
  });
});
