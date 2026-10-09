import type { RestSkills } from "@skillcdn/console/api";
import {
  type Address,
  formatAddress,
  formatSkillUri,
  parseAddress,
  parseRepoPath,
} from "@skillcdn/core";
import type { Logger } from "./logger.js";
import type { Clock } from "./ports/clock.js";
import type { SkillSource } from "./ports/skill-source.js";

// A project's skills as the board shows them: what the SkillCDN deployment serves at the
// project's address, or at the organization's, with where a person reads each and what an
// agent loads it by. The console refers to the skills by address and keeps nothing of them
// (docs/architecture.md): an answer is held for a while, since an address changes slowly and
// the deployment is someone else's, and asked for again after.

/** How long one answer of the deployment stands for, before it is asked again. */
export const SKILLS_CACHE_MS = 60_000;
/** How many addresses are held at once: beyond, the oldest answer goes. */
const MAX_HELD = 100;

export interface SkillsConfig {
  /** The origin of the SkillCDN deployment the skills are read through. */
  readonly source: string;
  /** The address of the organization's skills, for a project that names none; or none at all. */
  readonly address: Address | undefined;
}

export class Skills {
  readonly #config: SkillsConfig;
  readonly #source: SkillSource;
  readonly #clock: Clock;
  readonly #logger: Logger | undefined;
  readonly #cacheMs: number;
  readonly #held = new Map<string, { readonly value: RestSkills; readonly until: number }>();
  readonly #reading = new Map<string, Promise<RestSkills>>();

  constructor(options: {
    readonly config: SkillsConfig;
    readonly source: SkillSource;
    readonly clock: Clock;
    readonly logger?: Logger | undefined;
    readonly cacheMs?: number | undefined;
  }) {
    this.#config = options.config;
    this.#source = options.source;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#cacheMs = options.cacheMs ?? SKILLS_CACHE_MS;
  }

  /**
   * What the board answers for a project: the skills at the project's address, as it names
   * one, else at the organization's, as they stand; or why there are none to show.
   */
  async read(projectAddress: string | undefined): Promise<RestSkills> {
    const { source } = this.#config;
    const address = this.#addressOf(projectAddress);
    if (address === undefined) {
      return { address: null, source, page: null, status: "none", items: [] };
    }
    const canonical = formatAddress(address);
    const now = this.#clock.now().getTime();
    const held = this.#held.get(canonical);
    if (held !== undefined && held.until > now) {
      return held.value;
    }
    // One read at a time per address: whoever asks while one is under way gets its answer.
    let reading = this.#reading.get(canonical);
    if (reading === undefined) {
      reading = this.#fetch(address, canonical, source).finally(() => {
        this.#reading.delete(canonical);
      });
      this.#reading.set(canonical, reading);
    }
    return reading;
  }

  /** The address to read: the project's, which was checked when it was written, else the organization's. */
  #addressOf(projectAddress: string | undefined): Address | undefined {
    if (projectAddress === undefined) {
      return this.#config.address;
    }
    const parsed = parseAddress(projectAddress);
    if (parsed.ok) {
      return parsed.value;
    }
    this.#logger?.warn(
      { address: projectAddress },
      "a project names a skills address that is not one",
    );
    return undefined;
  }

  async #fetch(address: Address, canonical: string, source: string): Promise<RestSkills> {
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
      this.#held.delete(canonical);
      this.#held.set(canonical, { value, until: this.#clock.now().getTime() + this.#cacheMs });
      while (this.#held.size > MAX_HELD) {
        const oldest = this.#held.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.#held.delete(oldest);
      }
    }
    return value;
  }
}
