import { type Address, restMountSchema, restPath } from "@skillcdn/core";
import type { Logger } from "../logger.js";
import type { SkillListing, SkillSource } from "../ports/skill-source.js";
import { DEFAULT_TIMEOUT_MS, type FetchLike, readBody } from "./upstream.js";

// The SkillCDN deployment's side of the skill source: one read of the mount overview of an
// address through its REST API, parsed with the contracts of @skillcdn/core. The deployment is
// someone else's: what it answers is bounded and checked, and what goes wrong is a status, so
// that the board stays up when the skills are not there.

/** A mount overview lists at most a couple of hundred skills and documents; this is far above. */
const MAX_OVERVIEW_BYTES = 1024 * 1024;

export interface SkillCdnOptions {
  /** The origin of the deployment, such as `https://skillcdn.ai`. */
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly logger: Logger;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

const nothing = (status: SkillListing["status"]): SkillListing => ({ status, skills: [] });

export function createSkillCdnSource(options: SkillCdnOptions): SkillSource {
  const { logger } = options;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async list(address: Address): Promise<SkillListing> {
      const url = `${options.baseUrl}${restPath("mounts", address)}`;
      let response: Response;
      try {
        response = await send(url, {
          method: "GET",
          headers: { accept: "application/json", "user-agent": options.userAgent },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        logger.warn({ err: error }, "the SkillCDN deployment could not be reached");
        return nothing("unavailable");
      }
      // Not served, or not to someone the deployment does not know: the same to the board.
      if (response.status === 404 || response.status === 403) {
        await response.body?.cancel();
        return nothing("not_found");
      }
      if (!response.ok) {
        await response.body?.cancel();
        logger.warn({ status: response.status }, "the SkillCDN deployment answered an error");
        return nothing("unavailable");
      }
      const bytes = await readBody(response, MAX_OVERVIEW_BYTES);
      if (bytes === undefined) {
        logger.warn("the SkillCDN deployment answered more than an overview");
        return nothing("unavailable");
      }
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        logger.warn("the SkillCDN deployment answered something that is not JSON");
        return nothing("unavailable");
      }
      const parsed = restMountSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn("the SkillCDN deployment answered an overview in an unexpected shape");
        return nothing("unavailable");
      }
      const { index } = parsed.data;
      if (index.status !== "ready") {
        return nothing(index.status);
      }
      return {
        status: "ready",
        skills: index.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          directory: skill.directory,
          path: skill.path ?? (skill.directory === "" ? "SKILL.md" : `${skill.directory}/SKILL.md`),
          translations: skill.translations,
        })),
      };
    },
  };
}
