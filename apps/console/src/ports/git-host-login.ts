import { DomainError } from "../errors.js";

/** A person as the git host knows them, told by the credential they signed in with. */
export interface HostAccount {
  /** The host's immutable id for the account. */
  readonly hostAccountId: string;
  readonly login: string;
  /** The name the account goes by, when it gives one besides its login. */
  readonly name: string | undefined;
  /** The account's picture as the host serves it, an https URL. */
  readonly avatarUrl: string | undefined;
}

export type GitHostErrorKind = "unauthorized" | "rate_limited" | "transient" | "invalid";

/** The git host did not answer as asked. `kind` says what to do about it; `message` is for logs. */
export class GitHostError extends DomainError {
  readonly kind: GitHostErrorKind;

  constructor(kind: GitHostErrorKind, message: string, options?: { readonly cause?: unknown }) {
    super(`git_host.${kind}`, message, options);
    this.kind = kind;
  }
}

/**
 * What signing in needs from a git host, and nothing more: where to send a browser, how to turn
 * what it comes back with into a credential, and who that credential belongs to. The
 * credential is used for that one question and then dropped; nothing of it is kept.
 */
export interface GitHostLogin {
  /**
   * Where a browser is sent to sign in. `codeChallenge` is the S256 challenge of the verifier.
   * The host is asked to show the person which account they continue with, every time.
   */
  authorizationUrl(request: {
    readonly state: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
  }): string;

  /** Exchanges the code a sign-in came back with. A code the host refuses is `unauthorized`. */
  exchangeCode(request: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }): Promise<{ readonly accessToken: string }>;

  /** Who holds the credential. One the host no longer accepts is `unauthorized`. */
  getAccount(accessToken: string): Promise<HostAccount>;
}
