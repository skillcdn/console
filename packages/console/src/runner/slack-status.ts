import * as z from "zod/mini";
import { en } from "../i18n/en.js";
import { ko } from "../i18n/ko.js";
import { withoutForbiddenCodePoints } from "../text.js";
import type { AgentStatus, WakeSource } from "./types.js";

// How the `slack` wake source shows an agent account's status (ADR-0170): the member's own
// status at the messenger, set with the member's own token, and taken back by the runner that
// set it and by no other. Written from the messenger's documentation of `users.profile.set`
// and from what a trial found of how often it may be called; whether a workspace takes it is
// seen in one.

const PROFILE_URL = "https://slack.com/api/users.profile.set";
/** The scope of the member's token that a status takes. */
const SLACK_STATUS_SCOPE = "users.profile:write";

type Host = Parameters<NonNullable<WakeSource["show"]>>[0];
type Options = Parameters<NonNullable<WakeSource["show"]>>[2];

/** The emoji of each state where the desk names none. */
const EMOJI = {
  thinking: ":thought_balloon:",
  working: ":hammer_and_wrench:",
  limited: ":low_battery:",
} as const;
/** The most a status says at the messenger, in characters. */
const MAX_TEXT = 100;
/**
 * How long a status stands at the messenger by itself, in seconds: a runner that is gone, with
 * its machine say, leaves nothing there for longer. The runner says how the agent stands again
 * every half minute, and a status with less than `RENEW_S` left is set again then: that is one
 * call in a quarter of an hour for an agent at work that long.
 */
const THINKING_S = 2 * 60;
const WORKING_S = 15 * 60;
const LIMITED_S = 30 * 60;
const RENEW_S = 60;
/**
 * How often the profile is written: so many calls at once, and one more every so long after
 * that. The messenger takes ten a minute of one member's profile, and refused the fourth in a
 * row where it was tried. What changed meanwhile is not sent: the latest is, when its turn comes.
 */
const BURST = 3;
const REFILL_MS = 8000;
/** How long the source waits where the messenger asked it to and said no number that reads, and the longest it waits for one that does. */
const RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60_000;
/** How often one sender looks again at what is to be shown before it leaves the rest to the next say. */
const MAX_TURNS = 20;
/** The name the source keeps under, from one runner to the next, until when a status of its own stands at the messenger: seconds since the epoch. */
export const KEPT_STATUS = "shown";
const KEPT_UNTIL = /^[0-9]{1,12}$/;
/** Whether what stands under that name is what the source keeps there. */
export const keptStatusFits = (value: string): boolean => KEPT_UNTIL.test(value);
/** What the messenger answers where nothing of the request is wrong: tried again when the runner says again. */
const PASSING = new Set([
  "internal_error",
  "fatal_error",
  "service_unavailable",
  "request_timeout",
]);

const answerSchema = z.object({ ok: z.boolean(), error: z.optional(z.string()) });

/** A status as the messenger takes one: its emoji, its words, and when it ends by itself. */
interface Look {
  readonly emoji: string;
  readonly text: string;
  /** Seconds since the epoch. */
  readonly expires: number;
  /** Whether that moment is one the status says, and not only how long it stands unless renewed. */
  readonly fixed: boolean;
}

/** What the source holds of one host's status. */
interface Standing {
  status: AgentStatus;
  options: Options;
  /** The status of the runner's own that stands at the messenger, as far as the source knows: nothing where it set none or took it back. */
  set: Look | undefined;
  /** How many times the runner said how the agent stands. */
  asked: number;
  sending: Promise<void> | undefined;
  /** Ends the wait of the sender under way: something was said meanwhile. */
  wake: AbortController | undefined;
  /** The calls it may make at once, and since when the next is counted. */
  calls: number;
  countedFrom: number;
  /** The moment the messenger asked not to be called before. */
  notBefore: number;
  /** The token the messenger refused a status with, and its word for why: not tried again with that token. */
  refused: { readonly token: string; readonly why: string } | undefined;
  /** Why no status is shown, for the agent: a line for the next wake, until it was carried. */
  note: string | undefined;
  /** What the runner's lines last said of it, so that each thing is said once. */
  said: string | undefined;
}

const standings = new WeakMap<object, Standing>();

function standingOf(host: Host, status: AgentStatus, options: Options): Standing {
  const before = standings.get(host);
  if (before !== undefined) {
    before.status = status;
    before.options = options;
    return before;
  }
  // What a runner before this one showed and never took back, ended as it was by its machine or
  // by force: the source's own still, until the moment it ends by itself.
  const kept = host.kept.get(KEPT_STATUS);
  const standing: Standing = {
    status,
    options,
    set:
      kept !== undefined && keptStatusFits(kept)
        ? { emoji: "", text: "", expires: Number(kept), fixed: false }
        : undefined,
    asked: 0,
    sending: undefined,
    wake: undefined,
    calls: BURST,
    countedFrom: options.now(),
    notBefore: 0,
    refused: undefined,
    note: undefined,
    said: undefined,
  };
  standings.set(host, standing);
  return standing;
}

/** The source's own words for each state, in the workspace's language where the package speaks it. */
const wordsOf = (language: string | undefined) =>
  (language ?? "").toLowerCase().split("-")[0] === "ko" ? ko.agents.status : en.agents.status;

/** Words as a status holds them: plain, one line, within what the messenger shows. */
const plain = (text: string): string =>
  [...withoutForbiddenCodePoints(text)].slice(0, MAX_TEXT).join("").trim();

/** How a state is shown at the messenger, or nothing for an agent with nothing to show. */
function lookOf(status: AgentStatus, options: Options, now: number): Look | undefined {
  if (status.state === "idle") {
    return undefined;
  }
  const own = wordsOf(options.language);
  const seconds = Math.floor(now / 1000);
  if (status.state !== "limited") {
    const said = options.words[status.state];
    return {
      emoji: said?.emoji ?? EMOJI[status.state],
      text: plain(said?.text ?? own[status.state]),
      expires: seconds + (status.state === "thinking" ? THINKING_S : WORKING_S),
      fixed: false,
    };
  }
  const said = options.words.limited;
  const emoji = said?.emoji ?? EMOJI.limited;
  const text = plain(said?.text ?? own.limited);
  if (status.until === undefined || status.until <= now) {
    return { emoji, text, expires: seconds + LIMITED_S, fixed: false };
  }
  // Until the moment it is back, which the status says and ends at by itself. Where the two
  // together are more than a status holds, the moment is left to the messenger to show.
  const back = withoutForbiddenCodePoints(
    (said?.back ?? own.back).replace("{time}", options.time(status.until)),
  ).trim();
  const whole = `${text} · ${back}`;
  return {
    emoji,
    text: [...whole].length <= MAX_TEXT ? whole : text,
    expires: Math.ceil(status.until / 1000),
    fixed: true,
  };
}

/** Whether what stands at the messenger is what is to be shown, with long enough left of it. */
const shownAs = (set: Look | undefined, look: Look, seconds: number): boolean =>
  set !== undefined &&
  set.emoji === look.emoji &&
  set.text === look.text &&
  (look.fixed ? set.expires === look.expires : set.expires - seconds > RENEW_S);

/** Says a thing of the status in the runner's lines, once. */
function sayOnce(host: Host, standing: Standing, line: string): void {
  if (standing.said !== line) {
    standing.said = line;
    host.log(line);
  }
}

/**
 * How long the next call waits, in milliseconds: until the messenger takes one again where it
 * asked to be left alone, and until the next of the calls the source allows itself. The last
 * thing a runner says waits for neither count, and is not sent at all where the messenger asked
 * for more time than a runner that ends has: nothing is answered then.
 */
function waitOf(standing: Standing, now: number, last: boolean): number | undefined {
  if (now < standing.notBefore) {
    return last ? undefined : standing.notBefore - now;
  }
  if (last) {
    return 0;
  }
  const gained = Math.floor((now - standing.countedFrom) / REFILL_MS);
  if (gained > 0) {
    standing.calls = Math.min(BURST, standing.calls + gained);
    standing.countedFrom =
      standing.calls === BURST ? now : standing.countedFrom + gained * REFILL_MS;
  }
  return standing.calls > 0 ? 0 : standing.countedFrom + REFILL_MS - now;
}

/** Waits so long, or until something else is said or the runner ends. */
async function pause(host: Host, standing: Standing, ms: number): Promise<void> {
  const wake = new AbortController();
  const ended = (): void => wake.abort();
  const { signal } = standing.options;
  signal.addEventListener("abort", ended, { once: true });
  standing.wake = wake;
  try {
    await host.wait(ms, wake.signal);
  } finally {
    signal.removeEventListener("abort", ended);
    if (standing.wake === wake) {
      standing.wake = undefined;
    }
  }
}

/** How long the messenger asks to be left alone, as its header says in seconds. */
function retryOf(header: string | null | undefined): number {
  const seconds =
    header !== null && header !== undefined && /^[0-9]{1,6}$/.test(header.trim())
      ? Number(header.trim())
      : undefined;
  return seconds === undefined ? RETRY_MS : Math.min(MAX_RETRY_MS, Math.max(1000, seconds * 1000));
}

/** A short name of why the messenger refused, as it spells its errors; `refused` for anything else. */
const whyOf = (error: string | undefined): string =>
  error !== undefined && /^[a-z_]{1,60}$/.test(error) ? error : "refused";

/**
 * Writes the member's status, or takes it back where there is none to show: one call, with the
 * member's own token in the `authorization` header. What came of it: taken, to be asked again
 * after a while, refused for a reason that stands, or failed in passing.
 */
async function write(
  host: Host,
  token: string,
  look: Look | undefined,
  signal: AbortSignal,
): Promise<
  | { readonly how: "taken" }
  | { readonly how: "later"; readonly ms: number }
  | { readonly how: "refused"; readonly why: string }
  | { readonly how: "failed" }
> {
  try {
    const answered = await host.fetch(PROFILE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        profile: {
          status_text: look?.text ?? "",
          status_emoji: look?.emoji ?? "",
          status_expiration: look?.expires ?? 0,
        },
      }),
      signal,
    });
    const said = answerSchema.safeParse(await answered.json().catch(() => undefined));
    if (answered.status === 429 || (said.success && said.data.error === "ratelimited")) {
      return { how: "later", ms: retryOf(answered.headers?.get("retry-after")) };
    }
    if (!said.success || (!said.data.ok && PASSING.has(said.data.error ?? ""))) {
      return { how: "failed" };
    }
    return said.data.ok ? { how: "taken" } : { how: "refused", why: whyOf(said.data.error) };
  } catch {
    return { how: "failed" };
  }
}

/** What the agent is told where the messenger refuses its status, in a line of the source's own. */
const noteOf = (why: string): string =>
  why === "missing_scope"
    ? `Your status at Slack is not shown while you work (missing_scope): your app lacks the user scope ${SLACK_STATUS_SCOPE}. The skill running-an-agent says how to add it (references/slack-app.md); "status": false in runner.json shows none`
    : `Your status at Slack is not shown while you work (${why}); "status": false in runner.json shows none`;

/**
 * Brings what stands at the messenger to what the runner said last, a call at a time, until
 * the two are the same or nothing more can be done about it now.
 */
async function send(host: Host, secret: string, standing: Standing): Promise<void> {
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const { status, options } = standing;
    if (options.signal.aborted) {
      return;
    }
    const now = options.now();
    const seconds = Math.floor(now / 1000);
    // What stood until a moment that is past is there no more: the messenger took it back.
    if (standing.set !== undefined && standing.set.expires <= seconds) {
      standing.set = undefined;
      host.kept.delete(KEPT_STATUS);
    }
    const look = lookOf(status, options, now);
    // Nothing to show and nothing of its own there: whatever stands is somebody else's, and
    // is left as it is. No profile is read to find out.
    if (look === undefined ? standing.set === undefined : shownAs(standing.set, look, seconds)) {
      return;
    }
    const token = await host.secret(secret);
    if (token === undefined) {
      sayOnce(
        host,
        standing,
        `the slack wake source shows no status: no ${secret} in the account's store`,
      );
      return;
    }
    if (standing.refused !== undefined) {
      if (standing.refused.token === token) {
        return;
      }
      // Another token, of an app installed again say: asked once more.
      standing.refused = undefined;
    }
    const last = status.state === "idle" && status.last === true;
    const wait = waitOf(standing, now, last);
    if (wait === undefined) {
      return;
    }
    if (wait > 0) {
      await pause(host, standing, wait);
      continue;
    }
    if (standing.calls === BURST) {
      standing.countedFrom = now;
    }
    standing.calls = Math.max(0, standing.calls - 1);
    const answer = await write(host, token, look, options.signal);
    if (answer.how === "taken") {
      standing.set = look;
      host.kept.delete(KEPT_STATUS);
      if (look !== undefined) {
        host.kept.set(KEPT_STATUS, String(look.expires));
      }
      // It is shown: whatever kept it from being so is over, and the agent is told nothing of it.
      standing.note = undefined;
      if (standing.said !== undefined) {
        standing.said = undefined;
        host.log("the slack wake source shows the agent's status again");
      }
      // What is to be shown may have changed while the messenger answered.
      continue;
    }
    if (answer.how === "later") {
      standing.notBefore = options.now() + answer.ms;
      continue;
    }
    if (answer.how === "refused") {
      standing.refused = { token, why: answer.why };
      standing.note = noteOf(answer.why);
      sayOnce(
        host,
        standing,
        `the slack wake source shows no status: the messenger refused it (${answer.why})${answer.why === "missing_scope" ? `, the member's token lacks the scope ${SLACK_STATUS_SCOPE}` : ""}; not tried again until the runner starts again or the token changes`,
      );
      return;
    }
    // Tried again when the runner next says how the agent stands, half a minute on at the most.
    sayOnce(
      host,
      standing,
      "the slack wake source could not write the agent's status (failed); it tries again",
    );
    return;
  }
}

/**
 * Shows how the agent stands as the status of its own member at Slack (ADR-0170), with the
 * token the account keeps under `secret`. One sender at a time brings the messenger to the
 * latest thing said, so that what changed twice while it waited is written once.
 */
export async function showSlackStatus(
  host: Host,
  secret: string,
  status: AgentStatus,
  options: Options,
): Promise<void> {
  const standing = standingOf(host, status, options);
  standing.asked += 1;
  standing.wake?.abort();
  standing.sending ??= (async () => {
    try {
      // What was said while the sender was on its way out is sent by it still.
      for (let asked = -1; asked !== standing.asked; ) {
        asked = standing.asked;
        await send(host, secret, standing);
      }
    } finally {
      standing.sending = undefined;
    }
  })();
  await standing.sending;
}

/** Why no status is shown, as a line for the agent that no wake carried yet; nothing where there is none to say. */
export const slackStatusNote = (host: object): string | undefined => standings.get(host)?.note;

/** The line was carried by a wake: it is said no more. */
export function slackStatusNoted(host: object): void {
  const standing = standings.get(host);
  if (standing !== undefined) {
    standing.note = undefined;
  }
}
