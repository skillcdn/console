// Whether the command and the console go together (ADR-0025, ADR-0038). The command names its version on
// every request, in the product token of its user-agent; the console answers every request of
// the API with its own version and the range of command versions it takes, and refuses a
// command outside the range with `426` and the words to update. One rule for both sides, kept
// here so that the command and the console read the same one, and narrowed by the console's
// policy below only, never widened: what the rule promises stays predictable. The command holds
// the console to a floor of its own the same way (ADR-0038).

/** The product token the command names itself with: `skillcdn-console/<version>`. */
export const CLIENT_PRODUCT = "skillcdn-console";
/** On every answer of the API: the console's version. */
export const VERSION_HEADER = "console-version";
/** On every answer of the API: the range of command versions the console takes, as npm spells one. */
export const CLIENT_RANGE_HEADER = "console-client-range";

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** `x.y.z`, each a number of at most nine digits without a leading zero; no tag, no build. */
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const MAX_VERSION_LENGTH = 32;

/** A version as the package spells one, or nothing for any other text. */
export function parseVersion(text: string | null | undefined): Version | undefined {
  if (typeof text !== "string" || text.length > MAX_VERSION_LENGTH) {
    return undefined;
  }
  const match = VERSION.exec(text);
  return match === null
    ? undefined
    : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Negative when `a` is the older, zero when they are the same, positive when `a` is the newer. */
export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** A half-open range of versions: from `atLeast` on, and before `below`. */
export interface VersionRange {
  readonly atLeast: Version;
  readonly below: Version;
}

/** The range as npm spells one: `>=0.1.18 <0.2.0`. */
export function formatRange(range: VersionRange): string {
  return `>=${formatVersion(range.atLeast)} <${formatVersion(range.below)}`;
}

const RANGE = /^>=(\S+) <(\S+)$/;
const MAX_RANGE_LENGTH = 2 * MAX_VERSION_LENGTH + 4;

/** A range as `formatRange` spells one, or nothing for any other text. */
export function parseRange(text: string | null | undefined): VersionRange | undefined {
  if (typeof text !== "string" || text.length > MAX_RANGE_LENGTH) {
    return undefined;
  }
  const match = RANGE.exec(text);
  const atLeast = parseVersion(match?.[1]);
  const below = parseVersion(match?.[2]);
  return atLeast !== undefined && below !== undefined && compareVersions(atLeast, below) < 0
    ? { atLeast, below }
    : undefined;
}

export function inRange(version: Version, range: VersionRange): boolean {
  return compareVersions(version, range.atLeast) >= 0 && compareVersions(version, range.below) < 0;
}

/**
 * The common rule. Before 1.0, the line: a command and a console of one major.minor go
 * together whatever the patch, since the minor is SkillCDN's line and a patch is a release of
 * the console's own (ADR-0034), and a release that changes what passes between them raises the
 * floors below instead (ADR-0038). From 1.0, the console's major and a minor within one of the
 * console's, either way, whatever the patch: a minor adds and a major breaks, as the version
 * promises from then on.
 */
export function commonRange(server: Version): VersionRange {
  if (server.major === 0) {
    return {
      atLeast: { major: 0, minor: server.minor, patch: 0 },
      below: { major: 0, minor: server.minor + 1, patch: 0 },
    };
  }
  return {
    atLeast: { major: server.major, minor: Math.max(0, server.minor - 1), patch: 0 },
    below: { major: server.major, minor: server.minor + 2, patch: 0 },
  };
}

/**
 * What the console narrows the common rule by, and nothing it widens it by: a floor above the
 * rule's, for a contract that moved within what the rule still allows, and versions refused
 * whatever the rule says, for a release whose command is wrong. Changed with a changeset that
 * says why.
 */
export interface ClientPolicy {
  /** The oldest command this console answers, when the common rule's floor is too low. */
  readonly atLeast?: string | undefined;
  /** Versions of the command refused outright. */
  readonly refused?: readonly string[] | undefined;
}

/**
 * The console's policy: the oldest command this console answers, raised by the release that
 * last changed what the command reads or sends (ADR-0038), whose changelog entry begins with
 * `Breaking:`; `pnpm check` holds it to a version the package has, or is about to have.
 */
export const CLIENT_POLICY: ClientPolicy = { atLeast: "0.4.0" };

/**
 * The oldest console this command works with (ADR-0038): raised by the release that last
 * changed what the command asks of the console, whose changelog entry begins with `Breaking:`.
 * The command compares it with the version every answer names and refuses a console below it
 * itself, naming the command to install instead; `pnpm check` holds it as it holds the
 * console's floor.
 */
export const CONSOLE_AT_LEAST = "0.4.0";

/** `common` from `atLeast` on, where that floor is within it; `common` as it is otherwise. */
function narrowed(common: VersionRange, atLeast: string | undefined): VersionRange {
  const floor = parseVersion(atLeast);
  return floor !== undefined &&
    compareVersions(floor, common.atLeast) > 0 &&
    compareVersions(floor, common.below) < 0
    ? { atLeast: floor, below: common.below }
    : common;
}

/** The range of command versions a console of `server` takes: the common rule, narrowed by the policy's floor where that floor is within it. */
export function clientRange(server: Version, policy: ClientPolicy = CLIENT_POLICY): VersionRange {
  return narrowed(commonRange(server), policy.atLeast);
}

/** The range of console versions a command of `client` works with: the common rule, narrowed by the command's floor where that floor is within it. */
export function consoleRange(client: Version, atLeast: string = CONSOLE_AT_LEAST): VersionRange {
  return narrowed(commonRange(client), atLeast);
}

/**
 * What a command of one version is to a console of another: within the range and the same
 * (`current`), older (`behind`) or newer (`ahead`), which the console answers; or outside it,
 * older (`outdated`) or newer (`too_new`), which the console refuses.
 */
export type ClientVerdict = "current" | "behind" | "ahead" | "outdated" | "too_new";

export interface ClientJudgement {
  readonly verdict: ClientVerdict;
  readonly range: VersionRange;
}

export function judgeClient(
  client: Version,
  server: Version,
  policy: ClientPolicy = CLIENT_POLICY,
): ClientJudgement {
  const range = clientRange(server, policy);
  const order = compareVersions(client, server);
  const refused = (policy.refused ?? []).some((text) => {
    const version = parseVersion(text);
    return version !== undefined && compareVersions(version, client) === 0;
  });
  if (refused) {
    return { verdict: order > 0 ? "too_new" : "outdated", range };
  }
  if (compareVersions(client, range.atLeast) < 0) {
    return { verdict: "outdated", range };
  }
  if (compareVersions(client, range.below) >= 0) {
    return { verdict: "too_new", range };
  }
  return { verdict: order === 0 ? "current" : order < 0 ? "behind" : "ahead", range };
}

/**
 * What a console of one version is to a command of another (ADR-0038): within the range the
 * command works with, the same (`current`), older (`behind`) or newer (`ahead`); below it
 * (`outdated`), which the command refuses itself, naming the command to install; or beyond it
 * (`too_new`), which the console refuses the command for.
 */
export function judgeConsole(
  server: Version,
  client: Version,
  atLeast: string = CONSOLE_AT_LEAST,
): ClientJudgement {
  const range = consoleRange(client, atLeast);
  if (compareVersions(server, range.atLeast) < 0) {
    return { verdict: "outdated", range };
  }
  if (compareVersions(server, range.below) >= 0) {
    return { verdict: "too_new", range };
  }
  const order = compareVersions(server, client);
  return { verdict: order === 0 ? "current" : order < 0 ? "behind" : "ahead", range };
}

/** What the command sends as its user-agent: its product token, and, in a comment, where it runs. */
export function userAgentOf(version: string, comment?: string): string {
  // A comment holds printable ASCII without parentheses or backslashes; nothing else is said.
  const safe = comment?.replaceAll(/[^\x20-\x27\x2a-\x5b\x5d-\x7e]/g, "").trim();
  return `${CLIENT_PRODUCT}/${version}${safe === undefined || safe.length === 0 ? "" : ` (${safe})`}`;
}

const MAX_USER_AGENT_LENGTH = 512;
const CLIENT_TOKEN = new RegExp(
  `(?:^|\\s)${CLIENT_PRODUCT}/(\\d{1,9}\\.\\d{1,9}\\.\\d{1,9})(?![\\w.-])`,
);

/** The version of the command a request's user-agent names, or nothing for any other client. */
export function clientVersionOf(userAgent: string | null | undefined): Version | undefined {
  if (typeof userAgent !== "string") {
    return undefined;
  }
  return parseVersion(CLIENT_TOKEN.exec(userAgent.slice(0, MAX_USER_AGENT_LENGTH))?.[1]);
}
