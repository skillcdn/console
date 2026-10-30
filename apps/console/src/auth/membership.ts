import type { MembershipSource, ProviderKey } from "@skillcdn/console/api";
import type { Database } from "../db/client.js";
import { findListingFor, type ListingRecord, type PersonRecord } from "../db/queries/people.js";
import type { Logger } from "../logger.js";
import { ProviderError } from "../ports/identity-provider.js";
import type { OrganizationDirectory } from "../ports/organization.js";

const normalize = (values: readonly string[]): ReadonlySet<string> =>
  new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));

/** The domain of an email address, or nothing for a login that is not one. */
export function domainOf(login: string): string | undefined {
  const at = login.lastIndexOf("@");
  return at > 0 && at < login.length - 1
    ? login
        .slice(at + 1)
        .trim()
        .toLowerCase()
    : undefined;
}

export interface MembershipOptions {
  /** The logins the operator names administrators: let in at sign-in, and made administrators then. */
  readonly admins?: readonly string[] | undefined;
  /** The Workspace domains whose accounts are members, as their provider vouches for them. */
  readonly domains?: readonly string[] | undefined;
  /** The organization at the git host whose members are in, when the deployment names one. */
  readonly organization?: OrganizationDirectory | undefined;
  readonly logger?: Logger | undefined;
}

/** What let an account in at sign-in: its source, and the listing it came in on, when one did. */
export interface Admission {
  readonly source: MembershipSource;
  /** The listing that admitted the account, to be bound to the person; none for a domain or for `ADMINS`. */
  readonly listing?: ListingRecord | undefined;
}

/**
 * Who may be in the workspace (ADR-0022): the members of the organization at the git host the
 * operator named, as the host says; the accounts of the Workspace domains the operator named,
 * which their provider vouches for at sign-in; the logins an administrator let in on the People
 * page, which the database holds; and the logins the operator names administrators, so that
 * the first one can get in. Decided at sign-in, and on every request after from what is
 * written on the person: deactivated is out at once, and so is a domain or an organization
 * taken out of the configuration. Logins are compared without regard to case.
 */
export class Membership {
  readonly #admins: ReadonlySet<string>;
  readonly #domains: ReadonlySet<string>;
  readonly #organization: OrganizationDirectory | undefined;
  readonly #logger: Logger | undefined;

  constructor(options: MembershipOptions) {
    this.#admins = normalize(options.admins ?? []);
    this.#domains = normalize(options.domains ?? []);
    this.#organization = options.organization;
    this.#logger = options.logger;
  }

  /** True when the configuration alone lets nobody in: no organization, no domain, and no administrator named. */
  get empty(): boolean {
    return this.#admins.size === 0 && this.#domains.size === 0 && this.#organization === undefined;
  }

  /**
   * What admits an account signing in, or nothing: the organization, when the host says the
   * account is a member of it; a domain named, which only a provider that vouches for domains
   * can say; a listing an administrator made, unbound and spelled as the account's login, or
   * bound to this very account; or the operator's own naming. An organization that cannot be
   * asked admits nobody and refuses nobody: the rest decide.
   */
  async admit(
    database: Database,
    workspaceId: string,
    host: ProviderKey,
    account: {
      readonly accountId: string;
      readonly login: string;
      readonly domain: string | undefined;
    },
  ): Promise<Admission | undefined> {
    if (host === "gh" && this.#organization !== undefined) {
      try {
        if (await this.#organization.isMember(account.login)) {
          return { source: "organization" };
        }
      } catch (error) {
        if (!(error instanceof ProviderError)) {
          throw error;
        }
        this.#logger?.warn(
          { err: error, kind: error.kind, organization: this.#organization.name },
          "the organization could not be asked at a sign-in; the listings decide",
        );
      }
    }
    if (
      host === "google" &&
      account.domain !== undefined &&
      this.#domains.has(account.domain.trim().toLowerCase())
    ) {
      return { source: "domain" };
    }
    const listing = await findListingFor(database, workspaceId, host, account);
    if (listing !== undefined) {
      return { source: "listed", listing };
    }
    return this.administers(account.login) ? { source: "listed" } : undefined;
  }

  /**
   * Whether a person already written down is still in: active, and, where what let them in is
   * the deployment's to name, still named. A Workspace that signs people in under an alias
   * domain names that domain too, or lists those people.
   */
  allows(person: PersonRecord): boolean {
    if (person.status !== "active") {
      return false;
    }
    if (person.source === "domain") {
      const domain = domainOf(person.login);
      return person.host === "google" && domain !== undefined && this.#domains.has(domain);
    }
    if (person.source === "organization") {
      return person.host === "gh" && this.#organization !== undefined;
    }
    return true;
  }

  /** Whether the operator named the login an administrator. */
  administers(login: string): boolean {
    return this.#admins.has(login.trim().toLowerCase());
  }
}

/**
 * Why a person the console knows is refused, for whoever presents their token (ADR-0044):
 * deactivated, by an administrator or by the organization that took them out; or no longer let
 * in, because what let them in, the domain or the organization, is no longer named. The token
 * is kept either way, and is the person's again when they are back in.
 */
export interface AccessRefusal {
  readonly code: "auth.deactivated" | "auth.not_admitted";
  readonly message: string;
}

export function refusalOf(person: PersonRecord): AccessRefusal {
  return person.status === "deactivated"
    ? {
        code: "auth.deactivated",
        message:
          "The person this token acts as is deactivated. The token is kept, and works again when they are taken back in.",
      }
    : {
        code: "auth.not_admitted",
        message:
          "The person this token acts as is no longer let in: what let them in, the domain or the organization, is no longer named here. The token is kept, and works again when they are back in.",
      };
}
