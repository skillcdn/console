// Versions and ranges as a manifest spells them (docs/specs/plugins.md, "The manifest"): the
// range of another plugin's version in `requires`, and the range of the console's version in
// `console`. Read loosely, as npm spells the common ones, with no library: a plugin declares
// `>=0.4.3 <0.6`, and the console, the authoring command and the tests compare the same way.

export type Triple = readonly [number, number, number];

/**
 * A version read loosely: `0.4.3`, `v0.4.3`, `0.6` (as `0.6.0`), `1` (as `1.0.0`), a prerelease or
 * a build after the numbers ignored; nothing for anything else.
 */
export function parseLooseVersion(text: string): Triple | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(text.trim());
  return match === null
    ? undefined
    : [Number(match[1]), Number(match[2] ?? "0"), Number(match[3] ?? "0")];
}

export function compareTriples(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Whether a version is within a range as npm spells the common ones: `*`, exact, `^`, `~`, `>=`,
 * `>`, `<=`, `<`, several with spaces between (all must hold) and alternatives with `||` between
 * (one must hold). A partial version in the range is read as `.0` filled in: `<0.6` is `<0.6.0`.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const have = parseLooseVersion(version);
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "" || trimmed === "x" || trimmed === "latest") {
    return true;
  }
  if (have === undefined) {
    return false;
  }
  return trimmed.split(/\s*\|\|\s*/).some((alternative) =>
    alternative.split(/\s+/).every((part) => {
      const operator = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(part);
      const wanted = parseLooseVersion(operator?.[2] ?? "");
      if (wanted === undefined) {
        return false;
      }
      switch (operator?.[1]) {
        case "^":
          return (
            compareTriples(have, wanted) >= 0 &&
            (wanted[0] === 0 ? have[0] === 0 && have[1] === wanted[1] : have[0] === wanted[0])
          );
        case "~":
          return (
            compareTriples(have, wanted) >= 0 && have[0] === wanted[0] && have[1] === wanted[1]
          );
        case ">=":
          return compareTriples(have, wanted) >= 0;
        case ">":
          return compareTriples(have, wanted) > 0;
        case "<=":
          return compareTriples(have, wanted) <= 0;
        case "<":
          return compareTriples(have, wanted) < 0;
        default:
          return compareTriples(have, wanted) === 0;
      }
    }),
  );
}

/**
 * The version a dependency spells, read loosely: `^0.4.3`, `~0.4.3`, `>=0.4.3` and `0.4.3` are
 * all `0.4.3`; `workspace:*`, `*`, `latest` and a tag name none.
 */
export function versionOfDependency(spec: string): Triple | undefined {
  return parseLooseVersion(spec.trim().replace(/^(?:\^|~|>=|=)\s*/, ""));
}

export function formatTriple(version: Triple): string {
  return `${version[0]}.${version[1]}.${version[2]}`;
}

/**
 * The range of consoles a plugin written against `version` runs on, as `console-plugin init`
 * writes it: from that version on, within its line, since the plugin API moves with the console's
 * line before 1.0 (`>=0.4.3 <0.5.0`), and within its major from 1.0 (`>=1.2.0 <2.0.0`).
 */
export function lineRangeFrom(version: Triple): string {
  const below: Triple = version[0] === 0 ? [0, version[1] + 1, 0] : [version[0] + 1, 0, 0];
  return `>=${formatTriple(version)} <${formatTriple(below)}`;
}
