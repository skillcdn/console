import type {
  RestPackRefusal,
  RestSkill,
  RestSkillBrowse,
  RestSkillFile,
  RestSkillFind,
  RestSkillLoad,
  RestSkills,
  SkillsStatus,
} from "@skillcdn/console/api";
import {
  type Address,
  formatAddress,
  formatSkillUri,
  LOCAL_HOST_KEY,
  parseAddress,
  parseRepoPath,
  type RestMount,
} from "@skillcdn/core";
import type { Logger } from "./logger.js";
import type { Clock } from "./ports/clock.js";
import {
  type BrowseQuery,
  type FileQuery,
  type FindQuery,
  type Pack,
  PackError,
  type PackSource,
} from "./ports/skill-source.js";

// A project's pack as the board shows and reads it (ADR-0028, ADR-0031): the pack at the
// project's address, or at the organization's, opened at the deployment through the published
// client with the pack token the project holds where the pack is private, or, for a `local`
// address, in the directory the console was given; and answered as the deployment's REST API
// answers it, in the console's envelope, so that the command renders what a deployment's tools
// would give a model. The console refers to the pack by address and keeps nothing of it: a
// public listing is held for a while, since an address changes slowly, and asked for again
// after; what a token reads is the project's for that request and is never held.

/** How long one listing stands for, before the pack is asked again. */
export const SKILLS_CACHE_MS = 60_000;
/** How many addresses are held at once: beyond, the oldest listing goes. */
const MAX_HELD = 100;

export interface SkillsConfig {
  /** The origin of the SkillCDN deployment the skills are read through. */
  readonly source: string;
  /** The address of the organization's skills, for a project that names none; or none at all. */
  readonly address: Address | undefined;
}

/** Where a pack is read, for the people's pages: the deployment and the page of the address, or nothing for a directory. */
interface Where {
  readonly source: string | null;
  readonly page: string | null;
}

type Failed = Exclude<SkillsStatus, "ready" | "none">;

/** The first of the texts that says something; nothing when none does. */
function firstOf(...texts: readonly (string | null | undefined)[]): string | undefined {
  return texts.find((text): text is string => typeof text === "string" && text.trim() !== "");
}

/** The path of a skill's `SKILL.md`, from its directory where the answer left the path out. */
const skillPathOf = (path: string | undefined, directory: string): string =>
  path ?? (directory === "" ? "SKILL.md" : `${directory}/SKILL.md`);

/**
 * What a pack's refusal means to the board: the token is no good there; the index is not there
 * to read from; nothing is at the address or the path, or the pack is private and read as
 * nobody; a file the pack will not carry; or the pack could not be read at all.
 */
export function failureOf(error: PackError): {
  readonly status: Failed;
  readonly refusal: RestPackRefusal;
} {
  const refusal: RestPackRefusal = {
    code: error.code,
    message: error.message,
    sourceUrl: error.sourceUrl ?? null,
    directories: [...error.directories],
  };
  if (error.status === 401 || error.code === "auth.invalid_token") {
    return { status: "token_invalid", refusal };
  }
  if (error.code === "index.indexing") {
    return { status: "indexing", refusal };
  }
  if (error.code === "index.failed") {
    return { status: "failed", refusal };
  }
  if ([400, 403, 404, 409].includes(error.status)) {
    return { status: "not_found", refusal };
  }
  if (error.status === 413 || error.status === 415) {
    return { status: "failed", refusal };
  }
  return { status: "unavailable", refusal };
}

export class Skills {
  readonly #config: SkillsConfig;
  readonly #deployment: PackSource;
  readonly #directory: PackSource | undefined;
  readonly #clock: Clock;
  readonly #logger: Logger | undefined;
  readonly #cacheMs: number;
  readonly #held = new Map<string, { readonly value: RestSkills; readonly until: number }>();
  readonly #reading = new Map<string, Promise<RestSkills>>();

  constructor(options: {
    readonly config: SkillsConfig;
    /** Where the addresses of a git host are read, and a `local` one without a directory to read it from. */
    readonly deployment: PackSource;
    /** Where `local` addresses are read: the directory the console was given, when it has one. */
    readonly directory?: PackSource | undefined;
    readonly clock: Clock;
    readonly logger?: Logger | undefined;
    readonly cacheMs?: number | undefined;
  }) {
    this.#config = options.config;
    this.#deployment = options.deployment;
    this.#directory = options.directory;
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
   * What the board answers for a project: the pack at the project's address, as it names one,
   * else at the organization's, as it stands; or why there is none to show. With a pack token
   * the answer is the project's own and never held.
   */
  async read(projectAddress: string | undefined, token?: string): Promise<RestSkills> {
    const address = this.#addressOf(projectAddress);
    if (address === undefined) {
      return {
        address: null,
        source: this.#config.source,
        page: null,
        status: "none",
        refusal: null,
        items: [],
        mount: null,
      };
    }
    const canonical = formatAddress(address);
    if (token !== undefined) {
      return this.#fetch(address, canonical, token);
    }
    const now = this.#clock.now().getTime();
    const held = this.#held.get(canonical);
    if (held !== undefined && held.until > now) {
      return held.value;
    }
    // One read at a time per address: whoever asks while one is under way gets its answer.
    let reading = this.#reading.get(canonical);
    if (reading === undefined) {
      reading = this.#fetch(address, canonical, undefined)
        .then((value) => {
          // A pack that could not be reached is asked again next time, not in a minute.
          if (value.status !== "unavailable") {
            this.#hold(canonical, value);
          }
          return value;
        })
        .finally(() => {
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
    const opened = this.#open(projectAddress, token);
    if (opened === undefined) {
      return { ...this.#nowhere(), read: null };
    }
    const { address, where, pack } = opened;
    try {
      const read = await pack.skill(path, cursor);
      return read.status === "ready"
        ? { ...this.#at(address, where, "ready"), read }
        : { ...this.#at(address, where, read.status), read: null };
    } catch (error) {
      return { ...this.#at(address, where, this.#refused(error)), read: null };
    }
  }

  /** A file of the pack, a page of it, or what a folder holds (`read_repo_file`). */
  async file(
    projectAddress: string | undefined,
    query: FileQuery,
    token?: string,
  ): Promise<RestSkillFile> {
    const opened = this.#open(projectAddress, token);
    if (opened === undefined) {
      return { ...this.#nowhere(), read: null };
    }
    const { address, where, pack } = opened;
    try {
      const read = await pack.file(query);
      return { ...this.#at(address, where, "ready"), read };
    } catch (error) {
      return { ...this.#at(address, where, this.#refused(error)), read: null };
    }
  }

  /** What a folder of the pack holds, a page of it, as the deployment browses it (`browse_repo`). */
  async browse(
    projectAddress: string | undefined,
    query: BrowseQuery,
    token?: string,
  ): Promise<RestSkillBrowse> {
    const opened = this.#open(projectAddress, token);
    if (opened === undefined) {
      return { ...this.#nowhere(), read: null };
    }
    const { address, where, pack } = opened;
    try {
      const read = await pack.browse(query);
      return read.status === "ready"
        ? { ...this.#at(address, where, "ready"), read }
        : { ...this.#at(address, where, read.status), read: null };
    } catch (error) {
      return { ...this.#at(address, where, this.#refused(error)), read: null };
    }
  }

  /** The skills and the documents of the pack that words find, a page of them in relevance order (`search_repo`). */
  async find(
    projectAddress: string | undefined,
    query: FindQuery,
    token?: string,
  ): Promise<RestSkillFind> {
    const opened = this.#open(projectAddress, token);
    if (opened === undefined) {
      return { ...this.#nowhere(), read: null };
    }
    const { address, where, pack } = opened;
    try {
      const read = await pack.find(query);
      return read.status === "ready"
        ? { ...this.#at(address, where, "ready"), read }
        : { ...this.#at(address, where, read.status), read: null };
    } catch (error) {
      return { ...this.#at(address, where, this.#refused(error)), read: null };
    }
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

  /**
   * The pack at an address, and where it is read: a `local` address in the directory the
   * console was given, when it has one; anything else at the deployment, with the token.
   */
  #packOf(address: Address, token: string | undefined): { pack: Pack; where: Where } | undefined {
    const canonical = formatAddress(address);
    if (address.host === LOCAL_HOST_KEY && this.#directory !== undefined) {
      const pack = this.#directory.open(address);
      return pack === undefined ? undefined : { pack, where: { source: null, page: null } };
    }
    const pack = this.#deployment.open(address, token);
    if (pack === undefined) {
      return undefined;
    }
    const url = pack.location.kind === "deployment" ? pack.location.url : null;
    return { pack, where: { source: url, page: url === null ? null : `${url}${canonical}` } };
  }

  #open(
    projectAddress: string | undefined,
    token: string | undefined,
  ): { address: Address; where: Where; pack: Pack } | undefined {
    const address = this.#addressOf(projectAddress);
    if (address === undefined) {
      return undefined;
    }
    const opened = this.#packOf(address, token);
    if (opened === undefined) {
      this.#logger?.warn({ address: formatAddress(address) }, "no source serves the pack");
      return undefined;
    }
    return { address, ...opened };
  }

  /** The envelope of an answer about nothing: neither the project nor the console names a pack. */
  #nowhere() {
    return {
      address: null,
      source: this.#config.source,
      page: null,
      status: "none" as const,
      refusal: null,
    };
  }

  /** The envelope of an answer about a pack: its address, where it is read, and how the read went. */
  #at(address: Address, where: Where, outcome: Failed | "ready" | ReturnType<typeof failureOf>) {
    const status = typeof outcome === "string" ? outcome : outcome.status;
    const refusal = typeof outcome === "string" ? null : outcome.refusal;
    return {
      address: formatAddress(address),
      source: where.source,
      page: where.page,
      status,
      refusal,
    };
  }

  /** What a read that threw stands for; anything but a pack's own refusal is the console's fault, and is thrown on. */
  #refused(error: unknown): ReturnType<typeof failureOf> {
    if (error instanceof PackError) {
      return failureOf(error);
    }
    throw error;
  }

  #hold(canonical: string, value: RestSkills): void {
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

  async #fetch(
    address: Address,
    canonical: string,
    token: string | undefined,
  ): Promise<RestSkills> {
    const opened = this.#packOf(address, token);
    if (opened === undefined) {
      this.#logger?.warn({ address: canonical }, "no source serves the pack");
      return {
        ...this.#at(address, { source: null, page: null }, "not_found"),
        items: [],
        mount: null,
      };
    }
    const { pack, where } = opened;
    try {
      return this.#listing(address, where, await pack.mount());
    } catch (error) {
      return { ...this.#at(address, where, this.#refused(error)), items: [], mount: null };
    }
  }

  /**
   * The listing as the board shows it, from what the address serves: the pack by name and by
   * count, each skill with its page and the URI an agent loads it by; and the answer itself,
   * for a program that renders what a model is given.
   */
  #listing(address: Address, where: Where, mount: RestMount): RestSkills {
    const { index, repository } = mount;
    if (index.status !== "ready") {
      return { ...this.#at(address, where, index.status), items: [], mount };
    }
    // The pack by name, as the deployment's own instructions name it to a model: the
    // manifest's, else its README's, else the host's.
    const manifest = index.manifest ?? undefined;
    return {
      ...this.#at(address, where, "ready"),
      pack: {
        name: firstOf(manifest?.name, index.overview?.title, repository.name) ?? null,
        description:
          firstOf(manifest?.description, index.overview?.description, repository.description) ??
          null,
        language: firstOf(manifest?.language) ?? null,
      },
      counts: { skills: index.skillCount, documents: index.documentCount },
      items: index.skills.map((skill) => this.#item(address, where, skill)),
      mount,
    };
  }

  /** One skill as the board shows it: what the repository says of it, its page, and the URI an agent loads it by. */
  #item(
    address: Address,
    where: Where,
    skill: RestMount["index"] extends infer I
      ? I extends { readonly status: "ready"; readonly skills: readonly (infer S)[] }
        ? S
        : never
      : never,
  ): RestSkill {
    const path = skillPathOf(skill.path, skill.directory);
    const parsed = parseRepoPath(path);
    return {
      name: skill.name,
      description: skill.description,
      directory: skill.directory,
      path,
      page: where.page === null ? null : `${where.page}?skill=${encodeURIComponent(path)}`,
      uri: parsed.ok ? formatSkillUri(address, parsed.value) : null,
      translations: skill.translations,
    };
  }
}
