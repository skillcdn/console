import { describe, expect, it } from "vitest";
import { Membership } from "./membership.js";

describe("Membership", () => {
  it("lets the listed logins in, whatever their case, and nobody else", () => {
    const members = new Membership(["Alice", " bob ", "", "alice"]);
    expect(members.size).toBe(2);
    expect(members.allows("alice")).toBe(true);
    expect(members.allows("ALICE")).toBe(true);
    expect(members.allows("bob")).toBe(true);
    expect(members.allows("carol")).toBe(false);
    expect(members.allows("")).toBe(false);
  });

  it("lets nobody in when nobody is listed", () => {
    expect(new Membership([]).allows("alice")).toBe(false);
  });
});
