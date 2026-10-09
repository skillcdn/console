import type { Address } from "@skillcdn/core";

/** What a SkillCDN deployment says of an address: an index to read, or why there is none yet. */
export type SkillSourceStatus = "ready" | "indexing" | "failed" | "not_found" | "unavailable";

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

export interface SkillListing {
  readonly status: SkillSourceStatus;
  /** The skills, when `ready`; empty otherwise. */
  readonly skills: readonly SkillSummary[];
}

/**
 * The organization's skills as a SkillCDN deployment serves them at an address
 * (docs/architecture.md, "Built on SkillCDN, not inside it"): read through its REST API, never
 * kept. Never throws: what went wrong on the way is the listing's status.
 */
export interface SkillSource {
  list(address: Address): Promise<SkillListing>;
}
