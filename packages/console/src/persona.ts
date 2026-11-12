// An agent account's persona, as it is proposed (ADR-0084): a name in each language the console
// speaks, a handle, and an avatar, from a seed. What is here is a suggestion for whoever makes
// an account, rolled again at will and edited freely: it never restricts a choice. The names
// ship with the package, and a deployer building a console replaces them.

import { type AvatarSet, rollAvatar, seededNumbers } from "./avatar.js";
import { en } from "./i18n/en.js";
import { ko } from "./i18n/ko.js";
import { MAX_HANDLE_LENGTH } from "./limits.js";
import type { RestAgentProposal } from "./schemas.js";

/** A name to propose: the handle it gives, and how it is spelled in each language, `en` always among them. */
export interface PersonaName {
  readonly handle: string;
  readonly names: Readonly<Record<string, string>>;
}

/**
 * The names the package proposes: names of asteroids, to go with the planet an account's avatar
 * is (ADR-0097), each of two or three syllables, said alike in many languages, and nobody's
 * product. A handle each, and its spelling in every language the console speaks, which the
 * language packs hold (ADR-0012): a name added to one pack is added to every other.
 */
export const PERSONA_NAMES: readonly PersonaName[] = Object.entries(en.persona.names).map(
  ([handle, english]) => ({
    handle,
    names: {
      en: english,
      ko: (ko.persona.names as Readonly<Record<string, string>>)[handle] ?? english,
    },
  }),
);

/** How many proposals one asking answers with when none is said, and the most it may. */
export const DEFAULT_PROPOSALS = 4;
export const MAX_PROPOSALS = 12;

/** The name in a language: as the tag says (`ko-KR`), else its base (`ko`), else English, else any. */
function spelled(names: Readonly<Record<string, string>>, lang: string | undefined): string {
  const tag = (lang ?? "en").toLowerCase();
  const base = tag.split("-")[0] ?? "en";
  return names[tag] ?? names[base] ?? names.en ?? Object.values(names)[0] ?? "";
}

/** A handle nobody has: the name's own, or the first of `mira-2`, `mira-3` and on that is free. */
function freeHandle(handle: string, taken: ReadonlySet<string>): string {
  if (!taken.has(handle)) {
    return handle;
  }
  for (let number = 2; number < 10_000; number += 1) {
    const suffix = `-${number}`;
    const candidate = `${handle.slice(0, MAX_HANDLE_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return handle;
}

export interface ProposeOptions {
  /** The language the names are proposed in; English when left out. */
  readonly lang?: string | undefined;
  /** The names to propose from; the package's when left out. */
  readonly names?: readonly PersonaName[] | undefined;
  /** The handles the workspace's agent accounts already have, which no proposal repeats. */
  readonly taken?: Iterable<string> | undefined;
  /** The sets of shapes the avatars are rolled from; the package's when left out. */
  readonly sets?: readonly AvatarSet[] | undefined;
}

/**
 * A proposal for each seed: a name, the handle it gives where nobody has it, and the parts of
 * an avatar. The same seed proposes the same name and the same avatar; no two proposals of one
 * asking share a name, while there are names enough.
 */
export function proposeAgents(
  seeds: readonly string[],
  options: ProposeOptions = {},
): RestAgentProposal[] {
  const names =
    options.names === undefined || options.names.length === 0 ? PERSONA_NAMES : options.names;
  const taken = new Set(options.taken ?? []);
  const used = new Set<number>();
  return seeds.map((seed) => {
    let index = Math.floor(seededNumbers(`name:${seed}`)() * names.length);
    for (let tries = 0; used.has(index) && tries < names.length; tries += 1) {
      index = (index + 1) % names.length;
    }
    used.add(index);
    const chosen = names[index] ?? PERSONA_NAMES[0];
    const handle = freeHandle(chosen?.handle ?? "agent", taken);
    taken.add(handle);
    return {
      seed,
      name: spelled(chosen?.names ?? {}, options.lang),
      handle,
      avatarParts: rollAvatar(seed, options.sets),
    };
  });
}
