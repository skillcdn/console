import type { RestSkillFile, RestSkillLoad, RestSkills } from "@skillcdn/console/api";
import {
  type Address,
  formatAddress,
  formatSkillUri,
  parseAddress,
  parseRepoPath,
} from "@skillcdn/core";
import type { Logger } from "./logger.js";
import type { Clock } from "./ports/clock.js";
import type { FilePage, SkillListing, SkillSource } from "./ports/skill-source.js";

// A project's pack as the board shows and reads it: what the SkillCDN deployment serves at the
// project's address, or at the organization's, with where a person reads each skill and what an
// agent loads it by; and, for the command, a skill whole and a file of the pack, read through the
// deployment's REST API with the pack token the project holds where the pack is private
// (ADR-0028). The console refers to the pack by address and keeps nothing of it
// (docs/architecture.md): a public listing is held for a while, since an address changes slowly
// and the deployment is someone else's, and asked for again after; what a token reads is the
// project's for that request and is never held.

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

  /** The origin of the SkillCDN deployment the skills are read through: what a person connects their agent to. */
  get source(): string {
    return this.#config.source;
  }

  /** The organization's address, canonical, for a project that names none; or nothing. */
  get address(): string | undefined {
    return this.#config.address === undefined ? undefined : formatAddress(this.#config.address);
  }

  /**
   * What the board answers for a project: the skills at the project's address, as it names
   * one, else at the organization's, as they stand; or why there are none to show. With a pack
   * token the answer is the project's own and never held.
   */
  async read(projectAddress: string | undefined, token?: string): Promise<RestSkills> {
    const { source } = this.#config;
    const address = this.#addressOf(projectAddress);
    if (address === undefined) {
      return { address: null, source, page: null, status: "none", items: [] };
    }
    const canonical = formatAddress(address);
    if (token !== undefined) {
      return this.#listing(address, canonical, await this.#source.list(address, token));
    }
    const now = this.#clock.now().getTime();
    const held = this.#held.get(canonical);
    if (held !== undefined && held.until > now) {
      return held.value;
    }
    // One read at a time per address: whoever asks while one is under way gets its answer.
    let reading = this.#reading.get(canonical);
    if (reading === undefined) {
      reading = this.#fetch(address, canonical).finally(() => {
        this.#reading.delete(canonical);
      });
      this.#reading.set(canonical, reading);
    }
    return reading;
  }

  /** One skill of the pack, a page of its context as the deployment lays it out (`load_skill`). */
  async load(
    projectAddress: string | undefined,
    path: string,
    cursor: string | undefined,
    token?: string,
  ): Promise<RestSkillLoad> {
    const { source } = this.#config;
    const address = this.#addressOf(projectAddress);
    if (address === undefined) {
      return { address: null, source, page: null, status: "none", skill: null };
    }
    const canonical = formatAddress(address);
    const loaded = await this.#source.load(address, path, cursor, token);
    return {
      address: canonical,
      source,
      page: `${source}${canonical}`,
      status: loaded.status,
      skill:
        loaded.status === "ready"
          ? {
              path: loaded.skill.path,
              directory: loaded.skill.directory,
              name: loaded.skill.name,
              description: loaded.skill.description,
              rules: loaded.skill.rules.map((rule) => ({ ...rule })),
              body: loaded.skill.body,
              included: loaded.skill.included.map((file) => ({ ...file })),
              files: [...loaded.skill.files],
              references: loaded.skill.references.map((reference) => ({ ...reference })),
              complete: loaded.skill.complete,
              nextCursor: loaded.skill.nextCursor ?? null,
              serving: {
                full: loaded.skill.serving.full,
                license: loaded.skill.serving.license ?? null,
                sourceUrl: loaded.skill.serving.sourceUrl ?? null,
              },
              warnings: [...loaded.skill.warnings],
            }
          : null,
    };
  }

  /** A file of the pack, a page of it, or what a folder holds (`read_repo_file`). */
  async file(
    projectAddress: string | undefined,
    path: string,
    page: FilePage,
    token?: string,
  ): Promise<RestSkillFile> {
    const { source } = this.#config;
    const address = this.#addressOf(projectAddress);
    if (address === undefined) {
      return { address: null, source, status: "none", file: null, folder: null };
    }
    const canonical = formatAddress(address);
    const read = await this.#source.read(address, path, page, token);
    if (read.status !== "ready") {
      return { address: canonical, source, status: read.status, file: null, folder: null };
    }
    return {
      address: canonical,
      source,
      status: "ready",
      file:
        read.file === undefined
          ? null
          : {
              path: read.file.path,
              content: read.file.content,
              offset: read.file.offset,
              nextOffset: read.file.nextOffset ?? null,
              totalLength: read.file.totalLength,
            },
      folder:
        read.folder === undefined
          ? null
          : {
              path: read.folder.path,
              entries: read.folder.entries.map((entry) => ({
                path: entry.path,
                kind: entry.kind,
                size: entry.size ?? null,
              })),
              truncated: read.folder.truncated,
            },
    };
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

  /** The listing as the board shows it: each skill with its page and the URI an agent loads it by. */
  #listing(address: Address, canonical: string, listing: SkillListing): RestSkills {
    const { source } = this.#config;
    const page = `${source}${canonical}`;
    return {
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
  }

  async #fetch(address: Address, canonical: string): Promise<RestSkills> {
    const listing = await this.#source.list(address);
    const value = this.#listing(address, canonical, listing);
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
