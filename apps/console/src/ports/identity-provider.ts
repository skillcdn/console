import type { ProviderKey } from "@skillcdn/console/api";
import { DomainError } from "../errors.js";

/** A person as an identity provider knows them, told by the credential they signed in with. */
export interface ProviderAccount {
  /** The provider's immutable id for the account. */
  readonly accountId: string;
  /** What the account is called at the provider: a login at a git host, an email at a Workspace. */
  readonly login: string;
  /** The name the account goes by, when it gives one besides its login. */
  readonly name: string | undefined;
  /** The account's picture as the provider serves it, an https URL. */
  readonly avatarUrl: string | undefined;
  /** The organization's domain the account belongs to, when the provider vouches for one. */
  readonly domain: string | undefined;
}

export type ProviderErrorKind = "unauthorized" | "rate_limited" | "transient" | "invalid";

/** The provider did not answer as asked. `kind` says what to do about it; `message` is for logs. */
export class ProviderError extends DomainError {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind, message: string, options?: { readonly cause?: unknown }) {
    super(`identity_provider.${kind}`, message, options);
    this.kind = kind;
  }
}

/**
 * What signing in needs from an identity provider, and nothing more (ADR-0005): where to send
 * a browser, how to turn what it comes back with into a credential, and who that credential
 * belongs to. The credential is used for that one question and then dropped; nothing of it is
 * kept. A deployment may have several providers; each is one of these.
 */
export interface IdentityProvider {
  /** What the provider is called in paths and in the database. */
  readonly key: ProviderKey;
  /** What people read on the button that takes them there. */
  readonly label: string;

  /**
   * Where a browser is sent to sign in. `codeChallenge` is the S256 challenge of the verifier.
   * The provider is asked to show the person which account they continue with, every time.
   */
  authorizationUrl(request: {
    readonly state: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
  }): string;

  /** Exchanges the code a sign-in came back with. A code the provider refuses is `unauthorized`. */
  exchangeCode(request: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }): Promise<{ readonly accessToken: string }>;

  /** Who holds the credential. One the provider no longer accepts is `unauthorized`. */
  getAccount(accessToken: string): Promise<ProviderAccount>;
}
