import * as z from "zod";
import { type IdentityProvider, ProviderError } from "../ports/identity-provider.js";
import {
  clean,
  createUpstream,
  type FetchLike,
  httpsOnly,
  MAX_REPLY_BYTES,
  readBody,
} from "./upstream.js";

// The Google implementation of the identity-provider port, for Google Workspace and plain
// Google accounts alike: OpenID Connect with the code flow and PKCE. The account is asked for
// at the userinfo endpoint with the token the code was exchanged for, so no id token is read
// or verified here. A person is known by the account's `sub` and called by its email; the
// Workspace domain the account belongs to (`hd`) is what the provider vouches for.

export interface GoogleProviderOptions {
  /** The client id and secret of the OAuth client the operator registered for the console. */
  readonly clientId: string;
  readonly clientSecret: string;
  readonly userAgent: string;
  /** The Workspace domain to offer at the account picker, when the operator named one. */
  readonly domain?: string | undefined;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

const WHO = "Google";
const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
/** Who the person is, and nothing of what they have: no access to mail, drive or the directory. */
const SCOPE = "openid email profile";

const tokenReplySchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
]);

const accountSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().min(3).max(320),
  email_verified: z.boolean().optional(),
  /** The Workspace domain, present for a managed account only. */
  hd: z.string().max(253).optional(),
  name: z.string().max(200).nullable().optional(),
  picture: z.string().max(2048).optional(),
});

/** Codes of the token endpoint that say the code is no good any more. */
const REFUSED_GRANTS = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);

export function createGoogleProvider(options: GoogleProviderOptions): IdentityProvider {
  const upstream = createUpstream({ who: WHO, fetch: options.fetch, timeoutMs: options.timeoutMs });

  return {
    key: "google",
    label: "Google",

    authorizationUrl(request) {
      const query = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: request.redirectUri,
        response_type: "code",
        scope: SCOPE,
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        // The picker every time, as with the git host; and the Workspace's accounts first,
        // when the operator named a domain. A hint only: who may sign in is decided here.
        prompt: "select_account",
        ...(options.domain === undefined ? {} : { hd: options.domain }),
      });
      return `${AUTHORIZATION_URL}?${query}`;
    },

    async exchangeCode(exchange) {
      const response = await upstream.request(TOKEN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": options.userAgent,
        },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code: exchange.code,
          code_verifier: exchange.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: exchange.redirectUri,
        }).toString(),
      });
      // A refused grant is answered with 400 and a body that names why; the code names what is
      // wrong and is not a secret, while the description may quote the request.
      if (response.status === 400 || response.status === 401) {
        const bytes = await readBody(response, MAX_REPLY_BYTES);
        let code = "unknown";
        if (bytes !== undefined) {
          try {
            const refusal = tokenReplySchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
            if (refusal.success && "error" in refusal.data) {
              code = refusal.data.error.slice(0, 64).replaceAll(/[^a-z_]/g, "");
            }
          } catch {
            // A refusal that is not JSON is a refusal still.
          }
        }
        throw new ProviderError(
          REFUSED_GRANTS.has(code) ? "unauthorized" : "invalid",
          `${WHO} refused the token request (${code})`,
        );
      }
      const reply = await upstream.reply(response, tokenReplySchema);
      if ("error" in reply) {
        const code = reply.error.slice(0, 64).replaceAll(/[^a-z_]/g, "");
        throw new ProviderError("invalid", `${WHO} refused the token request (${code})`);
      }
      return { accessToken: reply.access_token };
    },

    async getAccount(accessToken) {
      const response = await upstream.request(USERINFO_URL, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "user-agent": options.userAgent,
        },
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new ProviderError("unauthorized", `${WHO} refused the credential`);
      }
      const account = await upstream.reply(response, accountSchema);
      // An address Google has not verified could be anyone's; what a person is called here
      // must be theirs.
      if (account.email_verified !== true) {
        throw new ProviderError("invalid", `${WHO} did not vouch for the account's email`);
      }
      const domain = clean(account.hd)?.toLowerCase();
      return {
        accountId: account.sub,
        login: account.email.trim().toLowerCase(),
        name: clean(account.name),
        avatarUrl: httpsOnly(account.picture),
        domain,
      };
    },
  };
}
