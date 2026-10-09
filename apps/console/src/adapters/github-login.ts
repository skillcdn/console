import * as z from "zod";
import { type IdentityProvider, ProviderError } from "../ports/identity-provider.js";
import { clean, createUpstream, type FetchLike, httpsOnly } from "./upstream.js";

// The GitHub implementation of the identity-provider port: an OAuth app or a GitHub App's own
// client, which both sign people in the same way. A person is known by the account's id and
// called by its login.

export interface GitHubProviderOptions {
  /** Where people use the host in a browser: where they sign in, and where the token endpoint is. */
  readonly webUrl: string;
  /** Where the host's API is: `https://api.github.com`, or `https://<host>/api/v3`. */
  readonly apiUrl: string;
  /** The client id and secret the host issued the app for signing people in. */
  readonly clientId: string;
  readonly clientSecret: string;
  readonly userAgent: string;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

const WHO = "GitHub";
const API_VERSION = "2022-11-28";

const tokenReplySchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
]);

const accountSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
  name: z.string().max(200).nullable().optional(),
  avatar_url: z.string().max(2048).optional(),
});

/** Codes of the token endpoint that say the code is no good any more. */
const REFUSED_GRANTS = new Set(["bad_verification_code", "incorrect_client_credentials"]);

export function createGitHubProvider(options: GitHubProviderOptions): IdentityProvider {
  const webUrl = options.webUrl.replace(/\/+$/, "");
  const apiUrl = options.apiUrl.replace(/\/+$/, "");
  const upstream = createUpstream({ who: WHO, fetch: options.fetch, timeoutMs: options.timeoutMs });

  return {
    key: "gh",
    label: "GitHub",

    authorizationUrl(request) {
      const query = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: request.redirectUri,
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        // The host's own account picker, every time: it shows which account the person
        // continues with and the way to another. Without it the host sends a browser that is
        // signed in straight back, as whoever its own session has.
        prompt: "select_account",
      });
      return `${webUrl}/login/oauth/authorize?${query}`;
    },

    async exchangeCode(exchange) {
      const response = await upstream.request(`${webUrl}/login/oauth/access_token`, {
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
          redirect_uri: exchange.redirectUri,
          code_verifier: exchange.codeVerifier,
        }).toString(),
      });
      const reply = await upstream.reply(response, tokenReplySchema);
      if ("error" in reply) {
        // The code names what is wrong and is not a secret; the description may quote the request.
        const code = reply.error.slice(0, 64).replaceAll(/[^a-z_]/g, "");
        throw new ProviderError(
          REFUSED_GRANTS.has(code) ? "unauthorized" : "invalid",
          `${WHO} refused the token request (${code})`,
        );
      }
      return { accessToken: reply.access_token };
    },

    async getAccount(accessToken) {
      const response = await upstream.request(`${apiUrl}/user`, {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${accessToken}`,
          "user-agent": options.userAgent,
          "x-github-api-version": API_VERSION,
        },
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new ProviderError("unauthorized", `${WHO} refused the credential`);
      }
      const account = await upstream.reply(response, accountSchema);
      return {
        accountId: String(account.id),
        login: account.login,
        name: clean(account.name),
        avatarUrl: httpsOnly(account.avatar_url),
        domain: undefined,
      };
    },
  };
}
