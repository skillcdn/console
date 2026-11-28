import type { KeptBySource, RunnerState } from "../runner/runner.js";

// The runner's own files under the desk's `work/`, as `console runner` reads them back and
// writes them (ADR-0085, ADR-0166): its state between its own restarts, and what each wake
// source keeps. A file of the desk may hold anything, whatever wrote it: what is read of one is
// data, bounded, and nothing where it does not read.

/** What the runner keeps between its own restarts, as its file says it; nothing for a file that does not read. */
export function runnerStateOf(text: string | undefined): RunnerState | undefined {
  if (text === undefined) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null) {
    return undefined;
  }
  const delivered = "delivered" in json ? json.delivered : undefined;
  const conversation = "conversation" in json ? json.conversation : undefined;
  const driver = "driver" in json ? json.driver : undefined;
  const limited = "limited" in json ? json.limited : undefined;
  const kept: unknown = "kept" in json ? json.kept : undefined;
  const began: unknown = "began" in json ? json.began : undefined;
  if (typeof delivered !== "number" || !Number.isSafeInteger(delivered) || delivered < 0) {
    return undefined;
  }
  /**
   * A moment in milliseconds since the epoch, or nothing for anything else: a number past what
   * a date holds would fail the runner at every start, where it says the moment in words.
   */
  const momentOf = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 1e14
      ? value
      : undefined;
  const since =
    typeof limited === "object" && limited !== null && "since" in limited
      ? momentOf(limited.since)
      : undefined;
  return {
    delivered,
    conversation:
      typeof conversation === "string" && conversation.length > 0 && conversation.length <= 200
        ? conversation
        : undefined,
    // The driver the conversation was begun under, as a registry spells one.
    driver:
      typeof driver === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(driver) ? driver : undefined,
    // The usage limit the agent is not back from (ADR-0150): since when, and until when where the product said.
    ...(since === undefined || typeof limited !== "object" || limited === null
      ? {}
      : {
          limited: {
            since,
            until: "until" in limited ? momentOf(limited.until) : undefined,
          },
        }),
    // The signals the record has as delivered that the agent never read: taken from the stream once more.
    ...(Array.isArray(kept)
      ? {
          kept: kept
            .filter((number): number is number => momentOf(number) !== undefined)
            .slice(0, 50),
        }
      : {}),
    // When the conversation kept began (ADR-0166): nothing for a file of before, or a number that
    // is none. One ahead of the machine's clock is the runner's to hold to it, which knows the time.
    ...(momentOf(began) === undefined ? {} : { began: momentOf(began) }),
  };
}

/** How many names a wake source's file holds at the most, and how long a name and what stands under it may be. */
export const MAX_KEPT_NAMES = 2000;
const MAX_KEPT_LENGTH = 200;

/**
 * What a wake source kept under a runner before this one (ADR-0166), as its file says it: the
 * names it keeps with what stands under each, the oldest first, and nothing for a file that
 * does not read. Read as data: a pair that is none, or longer than a name is, is left out, and
 * no more is read than a source keeps. What a name and what stands under it mean is the
 * source's own, which holds each to its shape when it starts.
 */
export function keptBySourceOf(text: string | undefined): KeptBySource | undefined {
  if (text === undefined) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(json)) {
    return undefined;
  }
  const kept: [string, string][] = [];
  for (const pair of json.slice(-MAX_KEPT_NAMES)) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      continue;
    }
    const [name, value]: unknown[] = pair;
    if (
      typeof name === "string" &&
      typeof value === "string" &&
      name.length > 0 &&
      name.length <= MAX_KEPT_LENGTH &&
      value.length <= MAX_KEPT_LENGTH
    ) {
      kept.push([name, value]);
    }
  }
  return kept;
}

/** What a wake source keeps, as its file holds it: the latest names, no more than are read back. */
export const keptFileOf = (kept: KeptBySource): string =>
  `${JSON.stringify(kept.slice(-MAX_KEPT_NAMES))}\n`;
