import { USAGE_KEPT_MS } from "../agent-usage.js";
import { MAX_RUNNER_USAGE_WINDOWS, MAX_USAGE_WINDOW_NAME_LENGTH } from "../limits.js";
import type { UsageWindow } from "./types.js";

// What the runner makes of its product's allowance (ADR-0150, docs/specs/runner.md, "A usage
// limit"): a subscription allows so much within a window that resets, and a product that has
// used it up answers nobody until then. The runner tells its agent before, at a share of the
// window it decides, and brings the agent back after, by itself. What a driver says of the
// allowance is the product's own, read by shape and bounded there; here it is numbers and a
// few words, and nothing of it is run.

/**
 * The shares of a window at which the agent is told how much of it is used: with a fifth left,
 * when there is still room to end what is under way in order, and with a tenth left, when what
 * is said to people is said now. Each once for a window, until it resets.
 */
export const USAGE_MARKS = [0.8, 0.9] as const;

/**
 * How long after the moment a product says its limit resets the runner brings its agent back:
 * the machine's clock and the product's differ by less.
 */
export const RESET_MARGIN_MS = 60_000;

/** How many windows the runner keeps what it told of: more than any product names. */
const MAX_WINDOWS = 16;

/**
 * What a product's own error says when what its subscription allows is used up until a window
 * resets. Its words are its own and no contract: read by pattern, of an error of the product
 * alone and never of what a model or a tool wrote, and held by the fixtures of the drivers.
 * Narrow on purpose: a request the server throttles for a moment and a conversation that
 * reached its length are limits too, and neither is this one.
 */
const USAGE_LIMIT =
  /\byou['\u2019]?ve (?:hit|reached) your ((?:[\w-]+ ){0,3})limit\b|\b(?:hit|reached) your (?:[\w-]+ ){0,2}usage limit\b|\busage limit (?:has been )?(?:reached|exceeded)\b|\busage_limit_reached\b/i;
/** What stands before "limit" in a limit that is another: a throttle, or a conversation's length. */
const ANOTHER_LIMIT = /\b(?:rate|request|context|token|output|length|size|message)\b/i;

/**
 * Whether an error of a product's own says its usage limit is reached. Under a driver whose
 * product names no reason, these words alone decide, and a limit read wrongly would be waited
 * out for hours: "you've hit your rate limit" and "your context window limit" are not it.
 */
export const saysUsageLimit = (text: string): boolean => {
  const found = USAGE_LIMIT.exec(text.slice(0, 2000));
  return found !== null && !(found[1] !== undefined && ANOTHER_LIMIT.test(found[1]));
};

/** What the agent was told of a window: the mark it had reached, and when that window resets. */
export interface ToldOfUsage {
  readonly mark: number;
  readonly resetsAt: number | undefined;
}

/** A window the agent is to be told of, with the mark it reached. */
export interface UsageTelling {
  readonly window: UsageWindow;
  readonly mark: number;
}

/**
 * The mark a window has reached: the highest of `USAGE_MARKS` its share used is at or past; the
 * first where the product says no share and says itself that the window is near its limit;
 * none below the first, and none for a window used up, which the limit itself says.
 */
function markOf(window: UsageWindow): number | undefined {
  if (window.used === undefined) {
    return window.near === true ? USAGE_MARKS[0] : undefined;
  }
  if (window.used >= 1) {
    return undefined;
  }
  let reached: number | undefined;
  for (const mark of USAGE_MARKS) {
    if (window.used >= mark) {
      reached = mark;
    }
  }
  return reached ?? (window.near === true ? USAGE_MARKS[0] : undefined);
}

/**
 * Of what a product says of its windows, what the agent is to be told now, and what it then
 * was told. A window is told once at each mark it reaches, at the highest alone where it passed
 * several between two looks. What was told of a window stands until that window resets: until
 * the moment it named has come and the product names a later one, or none, or its share is
 * below the first mark again, so that a product whose reset moves with every look is told of
 * once all the same. A moment that is past and named again is the same window still, a clock
 * that runs ahead of the product's say: told of at every look, each telling would be a turn
 * that spends the allowance it speaks of.
 */
export function usageToTell(
  windows: readonly UsageWindow[],
  told: ReadonlyMap<string, ToldOfUsage>,
  now: number,
): { readonly tell: readonly UsageTelling[]; readonly told: Map<string, ToldOfUsage> } {
  const next = new Map(told);
  const tell: UsageTelling[] = [];
  for (const window of windows) {
    // A quota kept apart from the session's own is shown and tells nothing: see `UsageWindow.apart`.
    if (window.apart === true) {
      continue;
    }
    const before = next.get(window.name);
    const mark = markOf(window);
    const reset =
      before !== undefined &&
      ((before.resetsAt !== undefined &&
        now >= before.resetsAt &&
        (window.resetsAt === undefined || window.resetsAt > before.resetsAt)) ||
        (window.used !== undefined && window.used < USAGE_MARKS[0] && window.near !== true));
    if (reset) {
      next.delete(window.name);
    }
    if (mark === undefined) {
      continue;
    }
    const stands = reset ? undefined : before;
    if (stands !== undefined && stands.mark >= mark) {
      continue;
    }
    // The oldest is let go where a driver names more windows than any product has.
    if (!next.has(window.name) && next.size >= MAX_WINDOWS) {
      const oldest = next.keys().next().value;
      if (oldest !== undefined) {
        next.delete(oldest);
      }
    }
    next.set(window.name, { mark, resetsAt: window.resetsAt });
    tell.push({ window, mark });
  }
  return { tell, told: next };
}

export interface NoticeOptions {
  /** The session's mark. */
  readonly mark: string;
  /** A moment with its day: a window may reset, and a limit end, on another day. */
  readonly moment: (iso: string) => string;
}

/** What the runner says of its own, under a header that carries the session's mark. */
export const runnerSays = (mark: string, words: string): string =>
  `[console ${mark} · runner]\n${words}`;

/** A name of a window on one line, with nothing in it that ends a header or a line. */
const plain = (text: string): string =>
  text
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, " ")
    .trim()
    .slice(0, MAX_USAGE_WINDOW_NAME_LENGTH)
    // Cut by its length in units, a letter of two may be cut in half: half a letter is no text.
    .replace(/[\uD800-\uDBFF]$/u, "")
    .trim();

/** A share as a whole number of hundredths, never more than was said: 0.899 is 89%. */
const percentOf = (share: number): number => Math.floor(Math.max(0, Math.min(1, share)) * 100);

/** One window as a line says it: how much of it is used, and when it resets where that is known. */
function windowWords(window: UsageWindow, moment: (iso: string) => string): string {
  const share = window.used === undefined ? "near its limit" : `${percentOf(window.used)}% used`;
  const resets =
    window.resetsAt === undefined
      ? ""
      : `, which resets ${moment(new Date(window.resetsAt).toISOString())}`;
  return `${share} in its ${plain(window.name)} window${resets}`;
}

/**
 * What the agent is told of its product's allowance before the limit (ADR-0150): how much of
 * which window is used, when it resets, and what the limit does, which is what there is to
 * plan by. A window of a part of the allowance, one model's week, is said in a sentence of its
 * own: what it counts is said, and nothing of what to do, since that limit is the model's and
 * what the agent makes of it is its own to decide. The words of the line, without its header.
 */
export function usageWords(tell: readonly UsageTelling[], moment: (iso: string) => string): string {
  const said = (which: readonly UsageTelling[]): string =>
    which.map((one) => windowWords(one.window, moment)).join("; and ");
  const whole = tell.filter((one) => one.window.part !== true);
  const parts = tell.filter((one) => one.window.part === true);
  const words: string[] = [];
  if (whole.length > 0) {
    words.push(
      `Your product's allowance is ${said(whole)}. Everything signed in with it draws on it, each sub-agent you start too. At the limit your turn ends where it is and you answer nobody until the reset; the runner brings you back then by itself, with what reached you meanwhile. Nothing is asked of you now. Plan by it: where someone waits on you, or work would be cut in the middle, say so and leave it where you can pick it up, before then.`,
    );
  }
  if (parts.length > 0) {
    words.push(
      `Your product's allowance for one model is ${said(parts)}. Requests to that model alone are counted on it, beside the plan's own windows. What you do about it is yours to decide.`,
    );
  }
  return words.join(" ");
}

/** A stretch a usage limit stopped the agent for: since when, and until when where the product said. */
export interface Limited {
  readonly since: number;
  readonly until: number | undefined;
}

/**
 * What the agent is told when it is handed something again after a usage limit stopped it
 * (ADR-0150), ahead of what reached it meanwhile: that it was stopped and from when, that its
 * turn and its sub-agents ended where they were, and whether the limit is over. The words,
 * without a header.
 */
export function limitWords(
  limited: Limited,
  options: {
    readonly now: number;
    readonly moment: (iso: string) => string;
    /** How many signals follow in the message, said whole. */
    readonly follow: number;
    /**
     * How many more the message only names (ADR-0166): what the product took in this
     * conversation as the limit was reached and the agent never answered, which stands above.
     */
    readonly above?: number | undefined;
    /** Whether this is a supervisor's signal tried before the runner's own try, with what else is kept left for then. */
    readonly early?: boolean | undefined;
  },
): string {
  const at = (ms: number): string => options.moment(new Date(ms).toISOString());
  const early = options.early === true;
  const stopped = `Your product's usage limit stopped you at ${at(limited.since)}: your turn ended where it was, and so did every sub-agent it had started, since they draw on the one allowance.`;
  const now = early
    ? `${limited.until === undefined ? "The product did not say when the limit resets" : `The product said the limit resets ${at(limited.until)}`}, and a supervisor's message is tried now all the same: where the limit still stands this is not read, and the runner hands it to you again when it brings you back.`
    : limited.until === undefined
      ? `The product did not say when the limit resets, so the runner tries now, ${at(options.now)}, by itself.`
      : `The limit reset ${at(limited.until)}, and the runner brings you back by itself.`;
  const above = options.above ?? 0;
  // What the conversation holds is not said twice: it is named, and the agent reads it above.
  const unanswered =
    above === 0
      ? ""
      : `What you were handed as the limit was reached and had not answered stands above in this conversation: it is named below by its ${above === 1 ? "number" : "numbers"}, and not said again. `;
  const meanwhile = early
    ? "The message follows; what else reached you meanwhile is kept, and handed to you then."
    : options.follow === 0
      ? `${unanswered}Nothing ${above === 0 ? "" : "else "}reached you meanwhile.`
      : above === 0
        ? "What reached you meanwhile follows, in the order it came, what you were handed as the limit was reached and had not read among it."
        : `${unanswered}What reached you since follows, in the order it came.`;
  return `${stopped} ${now} Go on with what you were doing: look at what each sub-agent left before you start it again. ${meanwhile}`;
}

/** What the product last said of each window of its allowance, by the window's name, and when (ADR-0156). */
export type UsageSeen = Map<string, { readonly window: UsageWindow; readonly at: number }>;

/** A window as the console is told of it with the heartbeat. */
export interface UsageSaid {
  readonly name: string;
  readonly used: number | null;
  readonly resetsAt: string | null;
  readonly near?: true;
  readonly at: string;
}

/** The first moment a console no longer reads as one: the year 10000, which a moment written out has no place for. */
const MOMENTS_END = Date.UTC(10_000, 0, 1);

/** A moment the console takes, or nothing: what a product says is its own, and one number out of range would cost the heartbeat. */
const momentOf = (ms: number | undefined): number | undefined =>
  ms !== undefined && Number.isFinite(ms) && ms > 0 && ms < MOMENTS_END
    ? Math.floor(ms)
    : undefined;

/**
 * Notes what the product says of its windows, for the console to be told (ADR-0156). What a
 * product says is sparse: a window it says nothing of this time stands as it was last said. As
 * many windows are kept as a heartbeat carries, the first said, and one without a name is none.
 */
export function noteUsage(seen: UsageSeen, windows: readonly UsageWindow[], now: number): void {
  for (const window of windows) {
    const name = plain(window.name);
    if (name.length === 0 || (!seen.has(name) && seen.size >= MAX_RUNNER_USAGE_WINDOWS)) {
      continue;
    }
    seen.set(name, { window, at: now });
  }
}

/**
 * The windows as the console is told of them with the heartbeat. One whose reset has passed is
 * let go: what was said of it is of a window that is over, and the product says the next one
 * when it is next asked. And so is one that names no reset and was last said longer ago than
 * any window lasts: a product that changed what it counts, a plan without the short window
 * say, says the old window no more, and what it once said of it would stand for good.
 */
export function usageSaid(seen: UsageSeen, now: number): UsageSaid[] {
  const said: UsageSaid[] = [];
  for (const [name, { window, at }] of [...seen]) {
    const resetsAt = momentOf(window.resetsAt);
    if (resetsAt === undefined ? now - at > USAGE_KEPT_MS : resetsAt <= now) {
      seen.delete(name);
      continue;
    }
    const used =
      window.used === undefined || !Number.isFinite(window.used)
        ? null
        : Math.max(0, Math.min(1, window.used));
    said.push({
      name,
      used,
      resetsAt: resetsAt === undefined ? null : new Date(resetsAt).toISOString(),
      ...(window.near === true ? { near: true as const } : {}),
      at: new Date(at).toISOString(),
    });
  }
  return said;
}
