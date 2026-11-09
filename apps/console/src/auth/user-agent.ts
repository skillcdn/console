// What a browser calls itself, read for a person looking at where they are signed in (board
// #309): the browser and the platform by the families a user-agent string names, so that a
// session reads as "Chrome on Windows". Nothing exact and nothing trusted: the string is the
// browser's own word, kept as text and shown as text.

export interface ClientDescription {
  /** The browser's family (`Chrome`, `Safari`), or `null` when the string names none known here. */
  readonly browser: string | null;
  /** The platform's family (`Windows`, `iOS`), or `null`. */
  readonly platform: string | null;
}

/** The families in the order they are told apart: a string that names several names the first. */
const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/Windows/i, "Windows"],
  [/iPhone|iPad|iPod/i, "iOS"],
  [/Android/i, "Android"],
  [/Mac OS X|Macintosh/i, "macOS"],
  [/CrOS/i, "ChromeOS"],
  [/Linux/i, "Linux"],
];

/** Each browser built on another names both; the one that names itself last in the string is first here. */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

const familyOf = (
  userAgent: string,
  families: readonly (readonly [RegExp, string])[],
): string | null => families.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

/** The browser and the platform a user-agent string names, or `null` for each it does not. */
export function describeUserAgent(userAgent: string | null | undefined): ClientDescription {
  if (userAgent === null || userAgent === undefined || userAgent.length === 0) {
    return { browser: null, platform: null };
  }
  return { browser: familyOf(userAgent, BROWSERS), platform: familyOf(userAgent, PLATFORMS) };
}
