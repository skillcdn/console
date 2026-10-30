import { describe, expect, it } from "vitest";
import type { PersonRecord } from "../db/queries/people.js";
import { createFixtureOrganization } from "../testing/fixture-organization.js";
import { domainOf, Membership, refusalOf } from "./membership.js";

const person = (fields: Partial<PersonRecord>): PersonRecord => ({
  id: "0199c4d8-0000-7000-8000-000000000001",
  workspaceId: "0199c4d8-0000-7000-8000-000000000000",
  host: "gh",
  hostAccountId: "1001",
  login: "alice",
  name: undefined,
  avatarUrl: undefined,
  role: "member",
  status: "active",
  source: "listed",
  deactivatedAt: undefined,
  ...fields,
});

describe("Membership", () => {
  it("keeps a person in while they are active, and a deactivated one out at once", () => {
    const members = new Membership({ admins: ["alice"] });
    expect(members.allows(person({}))).toBe(true);
    expect(members.allows(person({ status: "deactivated", deactivatedAt: new Date() }))).toBe(
      false,
    );
  });

  it("says why a person it keeps out is refused: deactivated, or no longer let in (ADR-0044)", () => {
    expect(refusalOf(person({ status: "deactivated", deactivatedAt: new Date() }))).toMatchObject({
      code: "auth.deactivated",
    });
    expect(
      refusalOf(person({ host: "google", login: "alice@other.test", source: "domain" })),
    ).toMatchObject({ code: "auth.not_admitted" });
  });

  it("keeps a domain's people in while the domain is named, whatever the case of the address", () => {
    const members = new Membership({ domains: ["Acme.test"] });
    expect(members.empty).toBe(false);
    expect(
      members.allows(person({ host: "google", login: "Alice@ACME.test", source: "domain" })),
    ).toBe(true);
    expect(
      members.allows(person({ host: "google", login: "alice@other.test", source: "domain" })),
    ).toBe(false);
    // A git host vouches for no domain.
    expect(members.allows(person({ host: "gh", login: "alice@acme.test", source: "domain" }))).toBe(
      false,
    );
    // The domain taken out of the configuration takes its people with it; a listing does not go.
    const without = new Membership({});
    expect(
      without.allows(person({ host: "google", login: "alice@acme.test", source: "domain" })),
    ).toBe(false);
    expect(
      without.allows(person({ host: "google", login: "alice@acme.test", source: "listed" })),
    ).toBe(true);
  });

  it("keeps the organization's people in while it is named, and no longer when it is not", () => {
    const organization = createFixtureOrganization();
    const members = new Membership({ organization });
    expect(members.empty).toBe(false);
    expect(members.allows(person({ source: "organization" }))).toBe(true);
    expect(members.allows(person({ host: "google", source: "organization" }))).toBe(false);
    expect(new Membership({}).allows(person({ source: "organization" }))).toBe(false);
  });

  it("names administrators, whatever their case, and knows when the configuration lets nobody in", () => {
    const members = new Membership({ admins: [" ALICE ", "bob"] });
    expect(members.administers("alice")).toBe(true);
    expect(members.administers("Bob")).toBe(true);
    expect(members.administers("carol")).toBe(false);
    expect(members.empty).toBe(false);
    expect(new Membership({}).empty).toBe(true);
    expect(new Membership({ admins: [""], domains: [] }).empty).toBe(true);
  });

  it("reads the domain off an address, and nothing off a login", () => {
    expect(domainOf("Alice@Acme.test")).toBe("acme.test");
    expect(domainOf("alice")).toBeUndefined();
    expect(domainOf("@acme.test")).toBeUndefined();
    expect(domainOf("alice@")).toBeUndefined();
  });
});
