import { ProviderError } from "../ports/identity-provider.js";
import type { OrganizationDirectory, OrganizationMember } from "../ports/organization.js";

// Test support: the git host's organization, as the host would answer for it, for the people
// of the git host fixture. Who is in is changed by the test; the host can be made unreachable.
// Not compiled.

export interface FixtureOrganization extends OrganizationDirectory {
  /** Who is in, by login, with the account's id: changed by a test as the organization changes. */
  readonly members: Map<string, string>;
  /** Makes every call fail as a host that cannot be reached does, until called with `false`. */
  unreachable(down: boolean): void;
  /** Calls per port method, to assert how often the host was asked. */
  readonly calls: Record<"isMember" | "listMembers", number>;
}

export function createFixtureOrganization(
  members: Readonly<Record<string, string>> = { Alice: "1001", bob: "1002" },
): FixtureOrganization {
  const current = new Map(Object.entries(members));
  const calls = { isMember: 0, listMembers: 0 };
  let down = false;
  const reach = (): void => {
    if (down) {
      throw new ProviderError("transient", "the host could not be reached");
    }
  };
  return {
    host: "gh",
    name: "acme",
    members: current,
    calls,
    unreachable(value) {
      down = value;
    },
    async isMember(login) {
      calls.isMember += 1;
      reach();
      return [...current.keys()].some((member) => member.toLowerCase() === login.toLowerCase());
    },
    async listMembers() {
      calls.listMembers += 1;
      reach();
      const listed: OrganizationMember[] = [];
      for (const [login, accountId] of current) {
        listed.push({ accountId, login });
      }
      return listed;
    },
  };
}
