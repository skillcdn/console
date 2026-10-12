import { createSign } from "node:crypto";
import * as z from "zod";
import type { Clock } from "../ports/clock.js";
import { ProviderError } from "../ports/identity-provider.js";
import type { OrganizationDirectory, OrganizationMember } from "../ports/organization.js";
import { createUpstream, decodeJson, type FetchLike, readBody } from "./upstream.js";

// The GitHub implementation of the organization port (ADR-0022): a GitHub App installed on the
// organization with its "Members" permission, read-only. The console signs a JWT with the app's
// private key, asks the host for the token of the app's installation on the organization, and
// reads the members with that. The key stays in configuration; the token is held until near
// its end and never logged.

export interface GitHubOrganizationOptions {
  /** Where the host's API is: `https://api.github.com`, or `https://<host>/api/v3`. */
  readonly apiUrl: string;
  /** The organization's login at the host. */
  readonly organization: string;
  /** The app's id, or its client id: what the host takes as the issuer of the JWT. */
  readonly appId: string;
  /** The app's private key, as PEM. */
  readonly privateKey: string;
  readonly userAgent: string;
  readonly clock: Clock;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

const WHO = "GitHub";
const API_VERSION = "2022-11-28";
/** A JWT for the app may live ten minutes; this one lives nine, dated a minute back, for clocks that differ. */
const JWT_LIFETIME_S = 540;
const JWT_BACKDATE_S = 60;
/** An installation token lasts an hour; it is asked for again this long before it ends. */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** A page of members, the most the host gives, and the most pages read: an organization of ten thousand at most. */
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
/** A page of a hundred members is tens of kilobytes; this bounds what the host may send of one. */
const MAX_PAGE_BYTES = 1024 * 1024;

const installationSchema = z.object({ id: z.number().int().positive() });
const tokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "must be a time"),
});
const membersSchema = z.array(
  z.object({ id: z.number().int().positive(), login: z.string().min(1).max(100) }),
);

const base64url = (value: string): string => Buffer.from(value).toString("base64url");

export function createGitHubOrganization(
  options: GitHubOrganizationOptions,
): OrganizationDirectory {
  const apiUrl = options.apiUrl.replace(/\/+$/, "");
  const { clock } = options;
  const upstream = createUpstream({ who: WHO, fetch: options.fetch, timeoutMs: options.timeoutMs });
  const organization = encodeURIComponent(options.organization);
  let current: { readonly token: string; readonly expiresAt: number } | undefined;
  let asking: Promise<string> | undefined;

  const headers = (authorization: string): Record<string, string> => ({
    accept: "application/vnd.github+json",
    authorization,
    "user-agent": options.userAgent,
    "x-github-api-version": API_VERSION,
  });

  /** What the host takes as the app itself: a JWT signed with the app's key, good for minutes. */
  const appJwt = (): string => {
    const now = Math.floor(clock.now().getTime() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({ iat: now - JWT_BACKDATE_S, exp: now + JWT_LIFETIME_S, iss: options.appId }),
    );
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(options.privateKey)
      .toString("base64url");
    return `${header}.${payload}.${signature}`;
  };

  const refusedAsApp = async (response: Response): Promise<never> => {
    await response.body?.cancel();
    if (response.status === 401) {
      throw new ProviderError("unauthorized", `${WHO} refused the app's key`);
    }
    if (response.status === 404) {
      throw new ProviderError(
        "invalid",
        `${WHO} has no installation of the app on the organization`,
      );
    }
    throw new ProviderError("invalid", `${WHO} rejected the request (${response.status})`);
  };

  /** The token of the app's installation on the organization, asked for with the JWT. */
  const installationToken = async (): Promise<string> => {
    const jwt = appJwt();
    const found = await upstream.request(`${apiUrl}/orgs/${organization}/installation`, {
      method: "GET",
      headers: headers(`Bearer ${jwt}`),
    });
    if (!found.ok) {
      return refusedAsApp(found);
    }
    const installation = await upstream.reply(found, installationSchema);
    const issued = await upstream.request(
      `${apiUrl}/app/installations/${installation.id}/access_tokens`,
      { method: "POST", headers: headers(`Bearer ${jwt}`) },
    );
    if (!issued.ok) {
      return refusedAsApp(issued);
    }
    const token = await upstream.reply(issued, tokenSchema);
    current = { token: token.token, expiresAt: Date.parse(token.expires_at) };
    return current.token;
  };

  /** The installation token held, or a new one when it is near its end; one request at a time. */
  const tokenNow = (): Promise<string> => {
    if (current !== undefined && current.expiresAt - clock.now().getTime() > TOKEN_MARGIN_MS) {
      return Promise.resolve(current.token);
    }
    asking ??= installationToken().finally(() => {
      asking = undefined;
    });
    return asking;
  };

  const refused = async (response: Response): Promise<never> => {
    await response.body?.cancel();
    if (response.status === 401) {
      // The token is no good any more: the next call asks for another.
      current = undefined;
      throw new ProviderError("unauthorized", `${WHO} refused the installation token`);
    }
    if (response.status === 302 || response.status === 403) {
      throw new ProviderError(
        "unauthorized",
        `${WHO} does not let the app read the organization's members`,
      );
    }
    throw new ProviderError("invalid", `${WHO} rejected the request (${response.status})`);
  };

  return {
    host: "gh",
    name: options.organization,

    async isMember(login) {
      const token = await tokenNow();
      const response = await upstream.request(
        `${apiUrl}/orgs/${organization}/members/${encodeURIComponent(login)}`,
        { method: "GET", headers: headers(`Bearer ${token}`) },
      );
      if (response.status === 204) {
        await response.body?.cancel();
        return true;
      }
      if (response.status === 404) {
        await response.body?.cancel();
        return false;
      }
      return refused(response);
    },

    async listMembers() {
      const token = await tokenNow();
      const members: OrganizationMember[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await upstream.request(
          `${apiUrl}/orgs/${organization}/members?per_page=${PAGE_SIZE}&page=${page}`,
          { method: "GET", headers: headers(`Bearer ${token}`) },
        );
        if (!response.ok) {
          return refused(response);
        }
        const bytes = await readBody(response, MAX_PAGE_BYTES);
        if (bytes === undefined) {
          throw new ProviderError(
            "invalid",
            `${WHO} sent a page of members that goes on for too long`,
          );
        }
        const found = decodeJson(bytes, membersSchema, WHO);
        for (const member of found) {
          members.push({ accountId: String(member.id), login: member.login });
        }
        if (found.length < PAGE_SIZE) {
          return members;
        }
      }
      throw new ProviderError(
        "invalid",
        `${WHO} lists more members than the console reads (${MAX_PAGES * PAGE_SIZE})`,
      );
    },
  };
}
