import { describe, expect, it } from "vitest";
import { domainOf, Membership } from "./membership.js";

describe("Membership", () => {
  it("lets the listed logins in, whatever their case, and nobody else", () => {
    const members = new Membership({ logins: ["Alice", " bob ", "", "alice"] });
    expect(members.empty).toBe(false);
    expect(members.allows({ host: "gh", login: "alice" })).toBe(true);
    expect(members.allows({ host: "gh", login: "ALICE" })).toBe(true);
    expect(members.allows({ host: "gh", login: "bob" })).toBe(true);
    expect(members.allows({ host: "gh", login: "carol" })).toBe(false);
    expect(members.allows({ host: "gh", login: "" })).toBe(false);
    expect(members.admits("gh", { login: "Bob", domain: undefined })).toBe(true);
    expect(members.admits("gh", { login: "carol", domain: undefined })).toBe(false);
  });

  it("lets nobody in when nobody is listed", () => {
    const nobody = new Membership({ logins: [] });
    expect(nobody.empty).toBe(true);
    expect(nobody.allows({ host: "gh", login: "alice" })).toBe(false);
    expect(nobody.admits("google", { login: "a@acme.test", domain: "acme.test" })).toBe(false);
  });

  it("lets the accounts of a named domain in when their provider vouches for it", () => {
    const members = new Membership({ logins: ["dave@elsewhere.test"], domains: ["Acme.test"] });
    expect(members.empty).toBe(false);
    // At sign-in the provider says which domain the account belongs to.
    expect(members.admits("google", { login: "alice@acme.test", domain: "acme.test" })).toBe(true);
    expect(members.admits("google", { login: "alice@acme.test", domain: undefined })).toBe(false);
    expect(members.admits("google", { login: "x@other.test", domain: "other.test" })).toBe(false);
    expect(members.admits("google", { login: "dave@elsewhere.test", domain: undefined })).toBe(
      true,
    );
    // A git host vouches for no domain.
    expect(members.admits("gh", { login: "alice@acme.test", domain: "acme.test" })).toBe(false);
    // On every request after, the address the person signs in as says which domain.
    expect(members.allows({ host: "google", login: "Alice@ACME.test" })).toBe(true);
    expect(members.allows({ host: "google", login: "alice@other.test" })).toBe(false);
    expect(members.allows({ host: "gh", login: "alice@acme.test" })).toBe(false);
    expect(members.allows({ host: "google", login: "dave@elsewhere.test" })).toBe(true);
  });

  it("names administrators among the logins", () => {
    const members = new Membership({ logins: ["alice", "bob"], admins: ["ALICE"] });
    expect(members.administers("alice")).toBe(true);
    expect(members.administers("bob")).toBe(false);
  });

  it("reads the domain off an address, and nothing off a login", () => {
    expect(domainOf("Alice@Acme.test")).toBe("acme.test");
    expect(domainOf("alice")).toBeUndefined();
    expect(domainOf("@acme.test")).toBeUndefined();
    expect(domainOf("alice@")).toBeUndefined();
  });
});
