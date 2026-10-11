import { DomainError } from "../errors.js";

/**
 * What a request to the bucket is signed with (ADR-0016): a pair of keys and, when they are
 * temporary, the token that comes with them. They come from configuration, as one pair, or
 * from the platform the container runs on, which hands it credentials of its own and renews
 * them (ADR-0018). The store asks for the current ones before every request and keeps none.
 */
export interface Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** With temporary credentials, the token that comes with them. */
  readonly sessionToken?: string | undefined;
}

export interface CredentialsSource {
  /** The credentials to sign the next request with: the same pair every time, or the platform's current ones. */
  credentials(): Promise<Credentials>;
}

/** The one pair from configuration, as it was given. */
export function fixedCredentials(credentials: Credentials): CredentialsSource {
  return { credentials: () => Promise.resolve(credentials) };
}

/** The platform's credentials could not be read: the endpoint is away, refused, or answered something else. */
export class CredentialsError extends DomainError {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super("credentials.unavailable", message, options);
  }
}
