const normalize = (logins: readonly string[]): ReadonlySet<string> =>
  new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean));

/**
 * Who may be in the workspace: the accounts the operator listed, by login, as the first version
 * of membership (docs/architecture.md, open question 1). Checked when a person signs in and on
 * every request after, so that a login taken off the list is out at once. Logins are compared
 * as the git host does, without regard to case. An empty list lets nobody in. The operator also
 * names who administers, which is what a person is made at sign-in; what they are afterwards is
 * the board's own record.
 */
export class Membership {
  readonly #logins: ReadonlySet<string>;
  readonly #admins: ReadonlySet<string>;

  constructor(logins: readonly string[], admins: readonly string[] = []) {
    this.#logins = normalize(logins);
    this.#admins = normalize(admins);
  }

  get size(): number {
    return this.#logins.size;
  }

  allows(login: string): boolean {
    return this.#logins.has(login.trim().toLowerCase());
  }

  /** Whether the operator named the login an administrator. */
  administers(login: string): boolean {
    return this.#admins.has(login.trim().toLowerCase());
  }
}
