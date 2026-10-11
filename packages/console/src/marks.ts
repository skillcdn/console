import { COLOR_NAMES, type ColorName } from "./vocabulary.js";

// A project's mark: a symbol on a colour, so that projects tell apart at a glance. A project
// that names neither gets a colour from its key, the same everywhere and every time, and the
// first letter of its name.

/** A small, well-spread hash of a string: enough to pick a colour, nothing more. */
function hashOf(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** The colour of a project's mark: the one it names, else one chosen from its key. */
export function projectColorOf(project: {
  readonly key: string;
  readonly color: ColorName | null;
}): ColorName {
  if (project.color !== null) {
    return project.color;
  }
  // Gray is for what has no colour; a project chosen one gets one of the rest.
  const choices = COLOR_NAMES.filter((name) => name !== "gray");
  return choices[hashOf(project.key) % choices.length] ?? "gray";
}

/** The symbol of a project's mark: the one it names, else the first letter of its name. */
export function projectSymbolOf(project: {
  readonly name: string;
  readonly symbol: string | null;
}): string {
  if (project.symbol !== null && project.symbol.length > 0) {
    return project.symbol;
  }
  const first = [...project.name.trim()][0];
  return first === undefined ? "?" : first.toUpperCase();
}
