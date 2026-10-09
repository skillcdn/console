import type { RestSkills } from "@skillcdn/console/api";
import { type Address, formatAddress, formatSkillUri, parseRepoPath } from "@skillcdn/core";
import type { Clock } from "./ports/clock.js";
import type { SkillSource } from "./ports/skill-source.js";

// The organization's skills as the board shows them: what the SkillCDN deployment serves at
// the configured address, with where a person reads each and what an agent loads it by. The
// console refers to the skills by address and keeps nothing of them (docs/architecture.md):
// an answer is held for a while, since an address changes slowly and the deployment is
// someone else's, and asked for again after.

/** How long one answer of the deployment stands for, before it is asked again. */
export const SKILLS_CACHE_MS = 60_000;

export interface SkillsConfig {
  /** The origin of the SkillCDN deployment the skills are read through. */
  readonly source: string;
  /** The address of the organization's skills, or none. */
  readonly address: Address | undefined;
}

export class Skills {
  readonly #config: SkillsConfig;
  readonly #source: SkillSource;
  readonly #clock: Clock;
  readonly #cacheMs: number;
  #held: { readonly value: RestSkills; readonly until: number } | undefined;
  #reading: Promise<RestSkills> | undefined;

  constructor(options: {
    readonly config: SkillsConfig;
    readonly source: SkillSource;
    readonly clock: Clock;
    readonly cacheMs?: number | undefined;
  }) {
    this.#config = options.config;
    this.#source = options.source;
    this.#clock = options.clock;
    this.#cacheMs = options.cacheMs ?? SKILLS_CACHE_MS;
  }

  /** What the board answers: the skills as they stand, or why there are none to show. */
  async read(): Promise<RestSkills> {
    const { source, address } = this.#config;
    if (address === undefined) {
      return { address: null, source, page: null, status: "none", items: [] };
    }
    const now = this.#clock.now().getTime();
    if (this.#held !== undefined && this.#held.until > now) {
      return this.#held.value;
    }
    // One read at a time: whoever asks while one is under way gets its answer.
    this.#reading ??= this.#fetch(address, source).finally(() => {
      this.#reading = undefined;
    });
    return this.#reading;
  }

  async #fetch(address: Address, source: string): Promise<RestSkills> {
    const canonical = formatAddress(address);
    const page = `${source}${canonical}`;
    const listing = await this.#source.list(address);
    const value: RestSkills = {
      address: canonical,
      source,
      page,
      status: listing.status,
      items: listing.skills.map((skill) => {
        const path = parseRepoPath(skill.path);
        return {
          name: skill.name,
          description: skill.description,
          directory: skill.directory,
          path: skill.path,
          page: `${page}?skill=${encodeURIComponent(skill.path)}`,
          uri: path.ok ? formatSkillUri(address, path.value) : null,
          translations: skill.translations,
        };
      }),
    };
    // A deployment that could not be reached is asked again next time, not in a minute.
    if (listing.status !== "unavailable") {
      this.#held = { value, until: this.#clock.now().getTime() + this.#cacheMs };
    }
    return value;
  }
}
