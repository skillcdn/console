/**
 * Who may be in the workspace: the accounts the operator listed, by login, as the first version
 * of membership (docs/architecture.md, open question 1). Checked when a person signs in and on
 * every request after, so that a login taken off the list is out at once. Logins are compared
 * as the git host does, without regard to case. An empty list lets nobody in.
 */
export class Membership {
  readonly #logins: ReadonlySet<string>;

  constructor(logins: readonly string[]) {
    this.#logins = new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean));
  }

  get size(): number {
    return this.#logins.size;
  }

  allows(login: string): boolean {
    return this.#logins.has(login.trim().toLowerCase());
  }
}
