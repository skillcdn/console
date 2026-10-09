import * as z from "zod";
import { GitHostError, type GitHostLogin, type HostAccount } from "../ports/git-host-login.js";

// The GitHub implementation of the login port: an OAuth app or a GitHub App's own client,
// which both sign people in the same way. A person's credential arrives as an argument and
// leaves in the request it is sent with, nowhere else.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GitHubLoginOptions {
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

/** A token reply and a profile are a few hundred bytes; this bounds what an upstream can send. */
const MAX_REPLY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
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

/** Reads a body up to `maxBytes`, then gives up: `content-length` is a hint, not a promise. */
async function readBody(response: Response, maxBytes: number): Promise<Uint8Array | undefined> {
  if (response.body === null) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Reads a reply of the host as the shape the adapter expects of it. Only the fields we read
 * are validated; the host adds fields freely. A reply that is something else is `invalid`.
 */
function decodeJson<Schema extends z.ZodType>(body: Uint8Array, schema: Schema): z.infer<Schema> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    throw new GitHostError("invalid", "the git host sent a reply that is not JSON", {
      cause: error,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GitHostError("invalid", "the git host sent a reply in an unexpected shape");
  }
  return parsed.data;
}

/** A name or a picture as the host gives it, when it is usable, else nothing. */
function clean(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text.length === 0 ? undefined : text;
}

export function createGitHubLogin(options: GitHubLoginOptions): GitHostLogin {
  const webUrl = options.webUrl.replace(/\/+$/, "");
  const apiUrl = options.apiUrl.replace(/\/+$/, "");
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Sends, and turns whatever went wrong on the way into a `GitHostError`. */
  const request = async (url: string, init: RequestInit): Promise<Response> => {
    let response: Response;
    try {
      response = await send(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GitHostError("transient", "the git host could not be reached", { cause: error });
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new GitHostError(
        response.status === 429 ? "rate_limited" : "transient",
        `the git host answered ${response.status}`,
      );
    }
    return response;
  };

  return {
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
      const response = await request(`${webUrl}/login/oauth/access_token`, {
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
      const bytes = response.ok ? await readBody(response, MAX_REPLY_BYTES) : undefined;
      if (bytes === undefined) {
        // A body that was too long was cancelled by the reader; one that was refused is not read.
        if (!response.ok) {
          await response.body?.cancel();
        }
        throw new GitHostError(
          "invalid",
          `the git host rejected the token request (${response.status})`,
        );
      }
      const reply = decodeJson(bytes, tokenReplySchema);
      if ("error" in reply) {
        // The code names what is wrong and is not a secret; the description may quote the request.
        const code = reply.error.slice(0, 64).replaceAll(/[^a-z_]/g, "");
        throw new GitHostError(
          REFUSED_GRANTS.has(code) ? "unauthorized" : "invalid",
          `the git host refused the token request (${code})`,
        );
      }
      return { accessToken: reply.access_token };
    },

    async getAccount(accessToken): Promise<HostAccount> {
      const response = await request(`${apiUrl}/user`, {
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
        throw new GitHostError("unauthorized", "the git host refused the credential");
      }
      const bytes = response.ok ? await readBody(response, MAX_REPLY_BYTES) : undefined;
      if (bytes === undefined) {
        if (!response.ok) {
          await response.body?.cancel();
        }
        throw new GitHostError("invalid", `the git host rejected the request (${response.status})`);
      }
      const account = decodeJson(bytes, accountSchema);
      const avatar = clean(account.avatar_url);
      return {
        hostAccountId: String(account.id),
        login: account.login,
        name: clean(account.name),
        avatarUrl: avatar?.startsWith("https://") === true ? avatar : undefined,
      };
    },
  };
}
