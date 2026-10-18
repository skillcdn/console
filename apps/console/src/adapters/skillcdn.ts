import { ApiError, createClient, type FetchLike } from "@skillcdn/client";
import { formatAddress } from "@skillcdn/core";
import type { Logger } from "../logger.js";
import { type PackConnector, PackError, type PackSource } from "../ports/skill-source.js";

// A pack at a SkillCDN deployment: the five reads of its REST API through the main repository's
// own client, which parses every answer with the contracts of @skillcdn/core, sends a token to
// the deployment's origin only and follows no redirect (ADR-0028, ADR-0031). The pack token a
// project holds travels as the bearer of the request and nowhere else. The deployment is
// someone else's: what it refuses, and what goes wrong on the way, is a PackError with the code
// the API gave it, for the board to say in its own words, so that the board stays up when the
// skills are not there. A `local` address is asked of the deployment as any other: a deployment
// serves none, and a pack served from a machine by the skillcdn command answers it. The same
// client connects a project's pack with a code a person approves (ADR-0036), as nobody.

export interface SkillCdnOptions {
  /** The origin of the deployment, such as `https://skillcdn.ai`. */
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly logger: Logger;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

/** How long one read of the deployment may take, headers and body together. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** What the deployment refused, or what went wrong on the way, as the board reads it. */
function asPackError(logger: Logger): (error: unknown) => never {
  return (error) => {
    if (error instanceof ApiError) {
      // A deployment that cannot be reached or read is logged; what it refuses is its answer.
      if (error.code === "network" || error.code === "invalid_response") {
        logger.warn(
          { code: error.code, status: error.status },
          "the SkillCDN deployment could not be read",
        );
      }
      throw new PackError(error.status, error.code, error.message, {
        directories: error.directories,
        sourceUrl: error.sourceUrl,
      });
    }
    throw error;
  };
}

export function createSkillCdnSource(options: SkillCdnOptions): PackSource {
  const { logger } = options;
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const location = { kind: "deployment", url: options.baseUrl } as const;
  return {
    open(address, token) {
      const client = createClient({
        baseUrl: options.baseUrl,
        fetch: send,
        token,
        userAgent: options.userAgent,
        timeoutMs,
      });
      const failed = asPackError(logger);
      return {
        address,
        location,
        mount: () => client.mount(address).catch(failed),
        browse: (query) => client.browse(address, query).catch(failed),
        find: (query) => client.find(address, query).catch(failed),
        skill: (path, cursor) => client.skill(address, { path, cursor }).catch(failed),
        file: (query) => client.file(address, query).catch(failed),
      };
    },
  };
}

/** Connecting with a code at the deployment, as nobody (ADR-0036): the client's `connect` and `claimConnection`. */
export function createSkillCdnConnector(options: SkillCdnOptions): PackConnector {
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const client = createClient({
    baseUrl: options.baseUrl,
    fetch: send,
    userAgent: options.userAgent,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const failed = asPackError(options.logger);
  return {
    connect: (address, agent) =>
      client.connect({ address: formatAddress(address), agent }).catch(failed),
    claim: (secret) => client.claimConnection(secret).catch(failed),
  };
}
