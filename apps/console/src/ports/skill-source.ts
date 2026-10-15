import type { Address } from "@skillcdn/core";

/**
 * What a SkillCDN deployment says of an address: an index to read, or why there is none to read.
 * `token_invalid` is the deployment refusing the pack token the project holds (ADR-0028).
 */
export type SkillSourceStatus =
  | "ready"
  | "indexing"
  | "failed"
  | "not_found"
  | "token_invalid"
  | "unavailable";

/** One skill as the deployment lists it: what the repository says of it, and nothing of the console's. */
export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  /** The skill's folder in the repository; `""` for the root. */
  readonly directory: string;
  /** The repository-root path of its `SKILL.md`. */
  readonly path: string;
  /** The name and the description in other languages, by language tag. */
  readonly translations: Readonly<
    Record<string, { readonly title: string | null; readonly description: string | null }>
  >;
}

/** The pack as its manifest or its README names it: what it is called, what it is for, the language it is written in. */
export interface SkillPack {
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly language: string | undefined;
}

/** How much the index found at the address. */
export interface SkillCounts {
  readonly skills: number;
  readonly documents: number;
}

export interface SkillListing {
  readonly status: SkillSourceStatus;
  /** The pack by name, when `ready` and the deployment says; nothing otherwise. */
  readonly pack?: SkillPack | undefined;
  /** How many skills and documents the index found, when `ready`. */
  readonly counts?: SkillCounts | undefined;
  /** The skills, when `ready`; empty otherwise. */
  readonly skills: readonly SkillSummary[];
}

/** A rule, a body or an included file of a skill: its repository path and its text, cut where a page ends. */
export interface SkillText {
  readonly path: string;
  readonly body: string;
  readonly truncated: boolean;
}

/** A file the skill points to, and whether it can be read. */
export interface SkillReference {
  readonly path: string;
  readonly status: "available" | "blocked" | "missing" | "outside_mount";
}

/** How the skill is served: whole, or described only, with its license and where it is read at the host. */
export interface SkillServing {
  readonly full: boolean;
  readonly license: string | undefined;
  readonly sourceUrl: string | undefined;
}

/** A skill as the deployment serves it, on one page of its context: what `load_skill` gives a model. */
export interface SkillPage {
  readonly path: string;
  readonly directory: string;
  readonly name: string;
  readonly description: string;
  /** The rules that hold for the skill, from the repository's root to the nearest manifest. */
  readonly rules: readonly SkillText[];
  readonly body: string;
  /** The files the skill includes with its body. */
  readonly included: readonly SkillText[];
  /** The paths of the skill's own files, which the files route reads. */
  readonly files: readonly string[];
  readonly references: readonly SkillReference[];
  /** Whether this page completes the skill; else `nextCursor` continues it. */
  readonly complete: boolean;
  readonly nextCursor: string | undefined;
  readonly serving: SkillServing;
  readonly warnings: readonly string[];
}

export type SkillLoad =
  | { readonly status: "ready"; readonly skill: SkillPage }
  | { readonly status: Exclude<SkillSourceStatus, "ready"> };

/** A page of a file of the pack, in characters. */
export interface SkillFile {
  readonly path: string;
  readonly content: string;
  readonly offset: number;
  readonly nextOffset: number | undefined;
  readonly totalLength: number;
}

export interface SkillFolderEntry {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly size: number | undefined;
}

/** What a folder of the pack holds, when a path names one. */
export interface SkillFolder {
  readonly path: string;
  readonly entries: readonly SkillFolderEntry[];
  readonly truncated: boolean;
}

export type SkillFileRead =
  | { readonly status: "ready"; readonly file: SkillFile; readonly folder: undefined }
  | { readonly status: "ready"; readonly file: undefined; readonly folder: SkillFolder }
  | { readonly status: Exclude<SkillSourceStatus, "ready"> };

/** Which part of a file is read: from a character on, how many at most. */
export interface FilePage {
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

/** An entry of a folder as the deployment browses it (`browse_repo`): a skill, a folder, or a file. */
export interface SkillBrowseEntry {
  readonly kind: "skill" | "directory" | "file";
  /** The repository-root path: of the `SKILL.md` for a skill, of the folder, of the file. */
  readonly path: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  /** For a folder: the skills and the documents under it. */
  readonly skillCount: number;
  readonly documentCount: number;
  /** For a file: its size in bytes. */
  readonly size: number | undefined;
  /** For a folder: the README that introduces it, read with the files route. */
  readonly overviewPath: string | undefined;
  /** For a skill: its license, and whether the address only describes it. */
  readonly license: string | undefined;
  readonly describedOnly: boolean;
}

/** The README that introduces a folder: its path, and what it says of the folder. */
export interface SkillFolderOverview {
  readonly path: string;
  readonly title: string | undefined;
  readonly description: string | undefined;
}

/** What a folder holds, one page of it; `nextCursor` continues the listing. */
export interface SkillBrowsePage {
  readonly path: string;
  readonly overview: SkillFolderOverview | undefined;
  readonly entries: readonly SkillBrowseEntry[];
  readonly nextCursor: string | undefined;
}

export type SkillBrowse =
  | { readonly status: "ready"; readonly folder: SkillBrowsePage }
  | { readonly status: Exclude<SkillSourceStatus, "ready"> };

/** Which page of a folder is read: the folder (the mounted one when left out), where to go on, how many entries at most. */
export interface BrowsePage {
  readonly path?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** A file that matched a search, under the skill it belongs to. */
export interface SkillFoundFile {
  readonly path: string;
  readonly title: string | undefined;
  readonly summary: string | undefined;
}

/** What a search found (`search_repo`): a skill, with the files of it that matched, or a document on its own. */
export type SkillFindItem =
  | {
      readonly kind: "skill";
      readonly path: string;
      readonly directory: string;
      readonly name: string;
      readonly description: string;
      readonly translations: SkillSummary["translations"];
      readonly files: readonly SkillFoundFile[];
      /** How many more of its files matched than are listed. */
      readonly moreFiles: number;
      readonly license: string | undefined;
      readonly describedOnly: boolean;
    }
  | {
      readonly kind: "document";
      readonly path: string;
      readonly title: string | undefined;
      readonly summary: string | undefined;
      /** The folder of the skill the document belongs to, when it is a skill's. */
      readonly skillDirectory: string | undefined;
    };

/** One page of what a search found, in relevance order; `nextCursor` continues it. */
export interface SkillFindPage {
  readonly query: string;
  /** The folder the search was kept to, or the whole pack. */
  readonly path: string | undefined;
  readonly items: readonly SkillFindItem[];
  readonly nextCursor: string | undefined;
}

export type SkillFind =
  | { readonly status: "ready"; readonly found: SkillFindPage }
  | { readonly status: Exclude<SkillSourceStatus, "ready"> };

/** What a search is asked with: the words, the folder to keep to, where to go on, how many at most. */
export interface FindQuery {
  readonly query: string;
  readonly path?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * A pack as a SkillCDN deployment serves it at an address (docs/architecture.md, "Built on
 * SkillCDN, not inside it"): read through its REST API, never kept. A token is the pack token
 * a person made for a private pack (ADR-0028), sent with the request and nowhere else. Never
 * throws: what went wrong on the way is the answer's status.
 */
export interface SkillSource {
  list(address: Address, token?: string): Promise<SkillListing>;
  /** One skill, whole or a page of it: `load_skill` as the deployment answers it. */
  load(
    address: Address,
    path: string,
    cursor: string | undefined,
    token?: string,
  ): Promise<SkillLoad>;
  /** A file of the pack, a page at a time, or what a folder holds: `read_repo_file`. */
  read(address: Address, path: string, page: FilePage, token?: string): Promise<SkillFileRead>;
  /** What a folder of the pack holds, a page at a time, as the deployment browses it: `browse_repo`. */
  browse(address: Address, page: BrowsePage, token?: string): Promise<SkillBrowse>;
  /** The skills and the documents of the pack that words find, a page of them in relevance order: `search_repo`. */
  find(address: Address, query: FindQuery, token?: string): Promise<SkillFind>;
}
