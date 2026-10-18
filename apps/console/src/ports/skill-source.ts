import type {
  Address,
  RestBrowse,
  RestConnectClaimed,
  RestConnectStarted,
  RestFile,
  RestFind,
  RestMount,
  RestSkill,
} from "@skillcdn/core";

// A pack as the console reads one for a project (ADR-0028, ADR-0031): the five reads of the
// main repository's REST API, answered in its shapes, so that the console's own API passes them
// on as they are and the command renders them as a deployment's tools would. One source opens a
// pack at a deployment, through the published client, with the pack token a project holds as
// the bearer; another opens a directory on this machine for a `local` address, read with the
// published reader. What a pack does not have, or cannot give, is a PackError with the code and
// the status the API answers with; what went wrong on the way is one too. Never kept: a pack is
// opened for a request and read for it.

export class PackError extends Error {
  /** The HTTP status the API answers with; `0` when the pack could not be reached at all. */
  readonly status: number;
  /** The stable code of the API: `skill.not_found`, `file.too_large`, `index.indexing`, `auth.invalid_token`, `network`, ... */
  readonly code: string;
  /** With `skill.ambiguous`: the directories to choose from. */
  readonly directories: readonly string[];
  /** With a file the pack will not carry: where it is at its source. */
  readonly sourceUrl: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: {
      readonly directories?: readonly string[] | undefined;
      readonly sourceUrl?: string | undefined;
    } = {},
  ) {
    super(message);
    this.name = "PackError";
    this.status = status;
    this.code = code;
    this.directories = extra.directories ?? [];
    this.sourceUrl = extra.sourceUrl;
  }
}

/** Which page of a folder is read: the folder (the mounted one when left out), where to go on, how many entries at most. */
export interface BrowseQuery {
  readonly path?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** What a search is asked with: the words, the folder to keep to, where to go on, how many at most. */
export interface FindQuery {
  readonly query?: string | undefined;
  readonly path?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** Which part of a file is read: from a character on, how many at most. */
export interface FileQuery {
  readonly path: string;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

/** Where a pack is read: a deployment, by its origin, or a directory on this machine. */
export type PackLocation =
  | { readonly kind: "deployment"; readonly url: string }
  | { readonly kind: "directory" };

/** A pack at one address, opened for one request: the reads of the REST API in its shapes. */
export interface Pack {
  readonly address: Address;
  readonly location: PackLocation;
  /** What the address serves: the pack, its index when ready, its skills and documents. */
  mount(): Promise<RestMount>;
  /** `browse_repo`: what a folder holds, a page of it. */
  browse(query: BrowseQuery): Promise<RestBrowse>;
  /** `search_repo`: what words find, or every skill and document without words; a page. */
  find(query: FindQuery): Promise<RestFind>;
  /** `load_skill`: a page of a skill's context, by the exact path of its `SKILL.md`. */
  skill(path: string, cursor?: string): Promise<RestSkill>;
  /** `read_repo_file`: a page of a file, or what a folder holds. */
  file(query: FileQuery): Promise<RestFile>;
}

/**
 * Where packs are read from: a deployment, for any address it serves; a directory on this
 * machine, for `local` addresses. A source that serves no such address answers nothing, and
 * the board says the pack is not found.
 */
export interface PackSource {
  open(address: Address, token?: string): Pack | undefined;
}

/**
 * The deployment's side of connecting with a code (its ADR-0059), which the console uses to
 * connect a project's pack token as the `skillcdn` command connects (ADR-0036): the console asks
 * as nobody, a person approves on the deployment's own pages, and the console claims the token
 * with the secret it was handed. What the deployment refuses, or what went wrong on the way, is
 * a PackError with the code the API gave it.
 */
export interface PackConnector {
  /** Begins: the code and the page for the person, the secret for the console, and until when. */
  connect(address: Address, agent: string): Promise<RestConnectStarted>;
  /** Claims: wait, while the person has not answered; or the token, this once. */
  claim(secret: string): Promise<RestConnectClaimed>;
}
