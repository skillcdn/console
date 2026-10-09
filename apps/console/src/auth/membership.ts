import type { ProviderKey } from "@skillcdn/console/api";

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
  /** The accounts the operator listed, by login (or email, at a provider that calls people so). */
  readonly logins: readonly string[];
  /** The logins among them that administer. */
  readonly admins?: readonly string[] | undefined;
  /** The Workspace domains whose accounts are members, as their provider vouches for them. */
  readonly domains?: readonly string[] | undefined;
}

/**
 * Who may be in the workspace (docs/architecture.md, open question 1): the accounts the operator
 * listed by login, and the accounts of the Workspace domains the operator named, which their
 * provider vouches for. Checked when a person signs in and on every request after, so that a
 * login taken off the list, or a domain, is out at once. Logins are compared without regard to
 * case. Nothing listed lets nobody in. The operator also names who administers, which is what
 * a person is made at sign-in; what they are afterwards is the board's own record.
 */
export class Membership {
  readonly #logins: ReadonlySet<string>;
  readonly #admins: ReadonlySet<string>;
  readonly #domains: ReadonlySet<string>;

  constructor(options: MembershipOptions) {
    this.#logins = normalize(options.logins);
    this.#admins = normalize(options.admins ?? []);
    this.#domains = normalize(options.domains ?? []);
  }

  /** True when nothing is listed, so that nobody can be let in. */
  get empty(): boolean {
    return this.#logins.size === 0 && this.#domains.size === 0;
  }

  /**
   * Whether an account may sign in: listed by login, or of a domain named, which only a
   * provider that vouches for domains can say.
   */
  admits(
    host: ProviderKey,
    account: { readonly login: string; readonly domain: string | undefined },
  ): boolean {
    if (this.#logins.has(account.login.trim().toLowerCase())) {
      return true;
    }
    return (
      host === "google" &&
      account.domain !== undefined &&
      this.#domains.has(account.domain.trim().toLowerCase())
    );
  }

  /**
   * Whether a person already written down is still a member: by login, or by the domain of
   * the address a Workspace account signs in as. A Workspace that signs people in under an
   * alias domain lists that domain too, or lists those people.
   */
  allows(person: { readonly host: ProviderKey; readonly login: string }): boolean {
    const login = person.login.trim().toLowerCase();
    if (this.#logins.has(login)) {
      return true;
    }
    const domain = domainOf(login);
    return person.host === "google" && domain !== undefined && this.#domains.has(domain);
  }

  /** Whether the operator named the login an administrator. */
  administers(login: string): boolean {
    return this.#admins.has(login.trim().toLowerCase());
  }
}
