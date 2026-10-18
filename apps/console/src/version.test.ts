import { describe, expect, it } from "vitest";
import { APP_SKILLCDN, APP_VERSION, skillcdnLineOf } from "./version.js";

describe("what the console says of itself (ADR-0033)", () => {
  it("reads the line of SkillCDN from a range as the manifests spell one", () => {
    expect(skillcdnLineOf("^0.3.0")).toBe("0.3");
    expect(skillcdnLineOf("~1.2.3")).toBe("1.2");
    expect(skillcdnLineOf(">=0.3.0 <0.5")).toBe("0.3");
    expect(skillcdnLineOf("0.10.11")).toBe("0.10");
    expect(skillcdnLineOf("workspace:*")).toBeUndefined();
    expect(skillcdnLineOf("latest")).toBeUndefined();
  });

  it("knows its version and its line from the package's manifest", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_SKILLCDN).toMatch(/^\d+\.\d+$/);
  });
});
