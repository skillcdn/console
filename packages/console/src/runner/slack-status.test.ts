import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ko } from "../i18n/ko.js";
import { SLACK_USER_TOKEN, slack } from "./slack.js";
import { slackStatusNote } from "./slack-status.js";
import type { AgentStatus, StatusWords, WakeHost } from "./types.js";

// How the `slack` wake source shows an agent account's status (ADR-0170). The answers are
// invented, in the shapes the messenger documents for `users.profile.set`; nothing is asked of
// the messenger here, and whether a workspace takes the status is seen in one.

const PROFILE = "https://slack.com/api/users.profile.set";
/** 2026-11-28 03:00:00 UTC, in milliseconds and in seconds. */
const NOON = Date.UTC(2026, 10, 28, 3, 0, 0);
const NOON_S = NOON / 1000;
/** A token of the member's, invented when the test runs and shaped like none that is kept anywhere. */
const drawn = (): string => ["xoxp", "invented", randomBytes(6).toString("hex")].join("-");

/** What the messenger answers a call: its JSON, and the status and the headers where it says them. */
interface Answer {
  readonly body?: unknown;
  readonly status?: number;
  readonly retryAfter?: string;
  /** The call never arrives: the network failed. */
  readonly fails?: boolean;
}

/** A machine the test speaks for: its clock, what the source asked of the messenger and what it said. */
function fakeHost(
  over: {
    readonly token?: string | undefined;
    readonly answers?: (call: number) => Answer | undefined;
    readonly kept?: Map<string, string>;
    /** What happens while the source waits, before the wait is over. */
    readonly meanwhile?: (waited: number) => void;
  } = {},
) {
  const account: { token: string | undefined } = {
    token: "token" in over ? over.token : drawn(),
  };
  const clock = { now: NOON };
  const asked: {
    url: string;
    method: string;
    headers: Readonly<Record<string, string>>;
    profile: unknown;
    at: number;
  }[] = [];
  const log: string[] = [];
  const waited: number[] = [];
  const kept = over.kept ?? new Map<string, string>();
  const ending = new AbortController();
  const host: Pick<WakeHost, "secret" | "fetch" | "wait" | "log" | "kept"> = {
    secret: async (name) => (name === SLACK_USER_TOKEN ? account.token : undefined),
    fetch: async (url, init) => {
      const body: unknown = JSON.parse(init.body ?? "null");
      asked.push({
        url,
        method: init.method,
        headers: init.headers,
        profile: (body as { profile?: unknown } | null)?.profile,
        at: clock.now,
      });
      const answer = over.answers?.(asked.length - 1) ?? {};
      if (answer.fails === true) {
        throw new Error("the network failed");
      }
      return {
        json: async () => answer.body ?? { ok: true },
        status: answer.status ?? 200,
        headers: {
          get: (name) =>
            name.toLowerCase() === "retry-after" ? (answer.retryAfter ?? null) : null,
        },
      };
    },
    wait: async (ms, signal) => {
      waited.push(ms);
      over.meanwhile?.(waited.length - 1);
      // A wait that something ended is over at once, with no time gone by.
      if (!signal.aborted) {
        clock.now += ms;
      }
    },
    log: (line) => log.push(line),
    kept,
  };
  const show = (
    status: AgentStatus,
    with_: { readonly words?: StatusWords; readonly language?: string } = {},
  ) =>
    slack.show?.(host, status, {
      words: with_.words ?? {},
      language: with_.language,
      now: () => clock.now,
      // The hour and the minute, as a runner says them: here in UTC.
      time: (at) => new Date(at).toISOString().slice(11, 16),
      signal: ending.signal,
    });
  return { host, account, clock, asked, log, waited, kept, show, ending };
}

const THINKING: AgentStatus = { state: "thinking" };
const WORKING: AgentStatus = { state: "working" };
const IDLE: AgentStatus = { state: "idle" };
const cleared = { status_text: "", status_emoji: "", status_expiration: 0 };

describe("the agent's status at Slack (ADR-0170)", () => {
  it("writes the member's status with the member's own token: an emoji, a line of words, and when it ends by itself", async () => {
    const at = fakeHost();
    await at.show(THINKING);
    expect(at.asked).toEqual([
      {
        url: PROFILE,
        method: "POST",
        headers: {
          authorization: `Bearer ${at.account.token}`,
          "content-type": "application/json; charset=utf-8",
        },
        profile: {
          status_text: "Thinking",
          status_emoji: ":thought_balloon:",
          status_expiration: NOON_S + 120,
        },
        at: NOON,
      },
    ]);
    await at.show(WORKING);
    expect(at.asked[1]?.profile).toEqual({
      status_text: "Working · a reply may take a while",
      status_emoji: ":hammer_and_wrench:",
      status_expiration: NOON_S + 15 * 60,
    });
    // Nothing to show: its own status is taken back, with nothing left in its place.
    await at.show(IDLE);
    expect(at.asked[2]?.profile).toEqual(cleared);
    expect(at.asked).toHaveLength(3);
    expect(at.log).toEqual([]);
  });

  it("sends nothing where nothing changed, and leaves a status that is not its own as it stands", async () => {
    const at = fakeHost();
    // The runner begins with nothing to show: whatever stands at the messenger is somebody
    // else's, and no profile is read to find out.
    await at.show(IDLE);
    await at.show(IDLE);
    expect(at.asked).toEqual([]);
    await at.show(THINKING);
    await at.show(THINKING);
    at.clock.now += 30_000;
    await at.show(THINKING);
    expect(at.asked).toHaveLength(1);
    await at.show(IDLE);
    await at.show(IDLE);
    expect(at.asked.map((one) => one.profile)).toEqual([expect.anything(), cleared]);
  });

  it("sets a status again only when little is left of it, so that a long turn costs a call in a quarter of an hour", async () => {
    const at = fakeHost();
    await at.show(WORKING);
    // Said again every half minute, as the runner does, for thirteen minutes: nothing is sent.
    for (let said = 0; said < 26; said += 1) {
      at.clock.now += 30_000;
      await at.show(WORKING);
    }
    expect(at.asked).toHaveLength(1);
    // Under a minute is left of it: set again, for as long as before.
    at.clock.now += 75_000;
    await at.show(WORKING);
    expect(at.asked).toHaveLength(2);
    expect(at.asked[1]?.profile).toMatchObject({
      status_expiration: Math.floor(at.clock.now / 1000) + 15 * 60,
    });
  });

  it("takes nothing back that ended by itself", async () => {
    const at = fakeHost();
    await at.show(THINKING);
    expect(at.kept.get("shown")).toBe(String(NOON_S + 120));
    at.clock.now += 121_000;
    await at.show(IDLE);
    expect(at.asked).toHaveLength(1);
    expect(at.kept.has("shown")).toBe(false);
  });

  it("says it in the workspace's language where the package speaks it, and in the desk's own words where runner.json has them", async () => {
    const korean = fakeHost();
    await korean.show(THINKING, { language: "ko" });
    await korean.show(WORKING, { language: "ko-KR" });
    expect(korean.asked.map((one) => one.profile)).toMatchObject([
      { status_text: ko.agents.status.thinking, status_emoji: ":thought_balloon:" },
      { status_text: ko.agents.status.working, status_emoji: ":hammer_and_wrench:" },
    ]);
    // A language the package has no words in is said in English.
    const other = fakeHost();
    await other.show(THINKING, { language: "fr" });
    expect(other.asked[0]?.profile).toMatchObject({ status_text: "Thinking" });
    const own = fakeHost();
    const words: StatusWords = {
      thinking: { emoji: ":eyes:" },
      working: { emoji: ":construction:", text: "Heads down" },
    };
    await own.show(THINKING, { words, language: "ko" });
    await own.show(WORKING, { words, language: "ko" });
    expect(own.asked.map((one) => one.profile)).toMatchObject([
      // An emoji of the desk's own, and the words the desk left to the source.
      { status_text: ko.agents.status.thinking, status_emoji: ":eyes:" },
      { status_text: "Heads down", status_emoji: ":construction:" },
    ]);
  });

  it("says when the agent is back from its usage limit, and ends the status at that moment", async () => {
    const at = fakeHost();
    const until = NOON + 2 * 3_600_000 + 40 * 60_000 + 500;
    await at.show({ state: "limited", until });
    expect(at.asked[0]?.profile).toEqual({
      status_text: "Out of usage · back at 05:40",
      status_emoji: ":low_battery:",
      // The moment itself, to the second after it: the messenger takes the status back then.
      status_expiration: Math.ceil(until / 1000),
    });
    // Said again while it stands, nothing is sent: the moment has not changed.
    at.clock.now += 3_600_000;
    await at.show({ state: "limited", until });
    expect(at.asked).toHaveLength(1);
    // Another moment, as the product said one since: written with it.
    await at.show({ state: "limited", until: until + 3_600_000 });
    expect(at.asked[1]?.profile).toMatchObject({
      status_text: "Out of usage · back at 06:40",
      status_expiration: Math.ceil(until / 1000) + 3600,
    });
    const korean = fakeHost();
    await korean.show({ state: "limited", until }, { language: "ko" });
    expect(korean.asked[0]?.profile).toMatchObject({
      status_text: `${ko.agents.status.limited} · ${ko.agents.status.back.replace("{time}", "05:40")}`,
    });
  });

  it("says a usage limit with no moment in its words alone, for half an hour at a time", async () => {
    const at = fakeHost();
    await at.show({ state: "limited" });
    expect(at.asked[0]?.profile).toEqual({
      status_text: "Out of usage",
      status_emoji: ":low_battery:",
      status_expiration: NOON_S + 30 * 60,
    });
    // A moment that is past is none to be back at.
    const past = fakeHost();
    await past.show({ state: "limited", until: NOON - 1000 });
    expect(past.asked[0]?.profile).toMatchObject({ status_text: "Out of usage" });
  });

  it("says the usage limit in the desk's own words, and leaves the moment out where the two together are more than a status holds", async () => {
    const at = fakeHost();
    const until = NOON + 3_600_000;
    const words: StatusWords = {
      limited: { emoji: ":zzz:", text: "Resting", back: "until {time}" },
    };
    await at.show({ state: "limited", until }, { words });
    expect(at.asked[0]?.profile).toMatchObject({
      status_text: "Resting · until 04:00",
      status_emoji: ":zzz:",
    });
    const long = fakeHost();
    await long.show(
      { state: "limited", until },
      { words: { limited: { text: "x".repeat(60), back: `${"y".repeat(40)} {time}` } } },
    );
    expect(long.asked[0]?.profile).toMatchObject({
      status_text: "x".repeat(60),
      status_expiration: Math.ceil(until / 1000),
    });
  });

  it("waits as the messenger asks where it takes no more for a while, and sends what is to be shown then", async () => {
    const said: Promise<void>[] = [];
    const at = fakeHost({
      answers: (call) =>
        call === 0
          ? { status: 429, retryAfter: "7", body: { ok: false, error: "ratelimited" } }
          : undefined,
      // While the source waits, the turn goes on past the half minute.
      meanwhile: (waited) => {
        const again = waited === 0 ? at.show(WORKING) : undefined;
        if (again !== undefined) {
          said.push(again);
        }
      },
    });
    await at.show(THINKING);
    await Promise.all(said);
    // Seven seconds, as the header said, though something was said meanwhile; and then the
    // latest, once, never what it was refused.
    expect(at.waited).toEqual([7000, 7000]);
    expect(at.asked.map((one) => (one.profile as { status_text: string }).status_text)).toEqual([
      "Thinking",
      "Working · a reply may take a while",
    ]);
    expect(at.asked[1]?.at).toBeGreaterThanOrEqual(NOON + 7000);
    expect(at.log).toEqual([]);
  });

  it("waits half a minute where the messenger names no time that reads, and no longer than ten minutes for one that does", async () => {
    for (const [retryAfter, waits] of [
      [undefined, 30_000],
      ["soon", 30_000],
      ["-5", 30_000],
      ["0", 1000],
      ["86400", 600_000],
    ] as const) {
      const at = fakeHost({
        answers: (call) =>
          call === 0
            ? {
                status: 429,
                ...(retryAfter === undefined ? {} : { retryAfter }),
                body: { ok: false, error: "ratelimited" },
              }
            : undefined,
      });
      await at.show(THINKING);
      expect(at.waited[0], String(retryAfter)).toBe(waits);
      expect(at.asked, String(retryAfter)).toHaveLength(2);
    }
    // The messenger's word alone says so too, where the answer carries no status.
    const worded = fakeHost({
      answers: (call) => (call === 0 ? { body: { ok: false, error: "ratelimited" } } : undefined),
    });
    await worded.show(THINKING);
    expect(worded.waited).toEqual([30_000]);
    expect(worded.asked).toHaveLength(2);
  });

  it("allows itself three calls at once and one more every eight seconds, and sends the latest when its turn comes", async () => {
    const at = fakeHost();
    await at.show(THINKING);
    await at.show(IDLE);
    await at.show(THINKING);
    expect(at.waited).toEqual([]);
    // The fourth in a row waits for its turn.
    await at.show(IDLE);
    expect(at.waited).toEqual([8000]);
    expect(at.asked.map((one) => one.at)).toEqual([NOON, NOON, NOON, NOON + 8000]);
    // A while later it has its three again.
    at.clock.now += 60_000;
    await at.show(THINKING);
    await at.show(WORKING);
    await at.show(IDLE);
    expect(at.waited).toEqual([8000]);
    expect(at.asked).toHaveLength(7);
  });

  it("takes its status back at once as the runner ends, whatever it allows itself otherwise", async () => {
    const at = fakeHost();
    await at.show(THINKING);
    await at.show(IDLE);
    await at.show(WORKING);
    await at.show({ state: "idle", last: true });
    expect(at.waited).toEqual([]);
    expect(at.asked.at(-1)?.profile).toEqual(cleared);
    expect(at.asked).toHaveLength(4);
    expect(at.kept.has("shown")).toBe(false);
  });

  it("sends nothing as the runner ends where the messenger asked to be left alone for longer, and nothing where it showed none", async () => {
    const limited = fakeHost({
      answers: (call) =>
        call === 1
          ? { status: 429, retryAfter: "60", body: { ok: false, error: "ratelimited" } }
          : undefined,
      meanwhile: (waited) => {
        if (waited === 0) {
          void limited.show({ state: "idle", last: true });
        }
      },
    });
    await limited.show(THINKING);
    await limited.show(WORKING);
    // The status that stands ends by itself: nothing more is asked of a messenger that said no.
    expect(limited.asked).toHaveLength(2);
    const none = fakeHost();
    await none.show({ state: "idle", last: true });
    expect(none.asked).toEqual([]);
  });

  it("says once that the member's token lacks the scope, tries no more with that token, and has a line for the agent", async () => {
    const at = fakeHost({ answers: () => ({ body: { ok: false, error: "missing_scope" } }) });
    await at.show(THINKING);
    await at.show(WORKING);
    at.clock.now += 3_600_000;
    await at.show(IDLE);
    await at.show(THINKING);
    expect(at.asked).toHaveLength(1);
    expect(at.log).toEqual([
      "the slack wake source shows no status: the messenger refused it (missing_scope), the member's token lacks the scope users.profile:write; not tried again until the runner starts again or the token changes",
    ]);
    expect(slackStatusNote(at.host)).toBe(
      'Your status at Slack is not shown while you work (missing_scope): your app lacks the user scope users.profile:write. The skill running-an-agent says how to add it (references/slack-app.md); "status": false in runner.json shows none',
    );
    // Nothing of the token is in a line or in what the agent is told.
    expect(`${at.log.join(" ")} ${slackStatusNote(at.host)}`).not.toContain(at.account.token);
    expect(`${at.log.join(" ")} ${slackStatusNote(at.host)}`).not.toContain("xoxp");
  });

  it("tries again with another token, of an app installed again say", async () => {
    const at = fakeHost({
      answers: (call) => (call === 0 ? { body: { ok: false, error: "missing_scope" } } : undefined),
    });
    await at.show(THINKING);
    await at.show(THINKING);
    expect(at.asked).toHaveLength(1);
    at.account.token = drawn();
    await at.show(THINKING);
    expect(at.asked).toHaveLength(2);
    expect(at.asked[1]?.headers.authorization).toBe(`Bearer ${at.account.token}`);
    expect(at.log.at(-1)).toBe("the slack wake source shows the agent's status again");
  });

  it("says a refusal in the messenger's own word where that is one, and never in words of its making", async () => {
    for (const [error, why] of [
      ["not_allowed_token_type", "not_allowed_token_type"],
      ["invalid_auth", "invalid_auth"],
      ["<b>No</b> and more words", "refused"],
      [undefined, "refused"],
      ["x".repeat(61), "refused"],
    ] as const) {
      const at = fakeHost({ answers: () => ({ body: { ok: false, error } }) });
      await at.show(THINKING);
      await at.show(WORKING);
      expect(at.asked, String(error)).toHaveLength(1);
      expect(at.log, String(error)).toEqual([
        `the slack wake source shows no status: the messenger refused it (${why}); not tried again until the runner starts again or the token changes`,
      ]);
      expect(slackStatusNote(at.host), String(error)).toBe(
        `Your status at Slack is not shown while you work (${why}); "status": false in runner.json shows none`,
      );
    }
  });

  it("says once that a call failed in passing, and tries again when the runner next says how the agent stands", async () => {
    for (const failing of [
      { fails: true },
      { body: "<html>" },
      { status: 500, body: { ok: false, error: "internal_error" } },
      { status: 503, body: { ok: false, error: "service_unavailable" } },
    ] satisfies Answer[]) {
      const at = fakeHost({ answers: (call) => (call < 2 ? failing : undefined) });
      await at.show(THINKING);
      await at.show(THINKING);
      expect(at.asked).toHaveLength(2);
      expect(at.log).toEqual([
        "the slack wake source could not write the agent's status (failed); it tries again",
      ]);
      at.clock.now += 30_000;
      await at.show(THINKING);
      expect(at.asked).toHaveLength(3);
      expect(at.log.at(-1)).toBe("the slack wake source shows the agent's status again");
      // No line for the agent: nothing of it is for the agent to put right.
      expect(slackStatusNote(at.host)).toBeUndefined();
    }
  });

  it("tries again to take back a status whose taking back failed", async () => {
    const at = fakeHost({ answers: (call) => (call === 1 ? { fails: true } : undefined) });
    await at.show(THINKING);
    await at.show(IDLE);
    expect(at.kept.has("shown")).toBe(true);
    at.clock.now += 30_000;
    await at.show(IDLE);
    expect(at.asked.map((one) => one.profile)).toEqual([expect.anything(), cleared, cleared]);
    expect(at.kept.has("shown")).toBe(false);
  });

  it("shows nothing, and says so once, where the account keeps no token of the member's", async () => {
    const at = fakeHost({ token: undefined });
    await at.show(THINKING);
    await at.show(WORKING);
    await at.show(IDLE);
    expect(at.asked).toEqual([]);
    expect(at.log).toEqual([
      "the slack wake source shows no status: no slack.user_token in the account's store",
    ]);
  });

  it("takes back what a runner before it showed and never took back, and nothing that ended since", async () => {
    // A runner that ended with its machine left a status that stands for ten minutes more.
    const stands = fakeHost({ kept: new Map([["shown", String(NOON_S + 600)]]) });
    await stands.show(IDLE);
    expect(stands.asked.map((one) => one.profile)).toEqual([cleared]);
    expect(stands.kept.has("shown")).toBe(false);
    const ended = fakeHost({ kept: new Map([["shown", String(NOON_S - 1)]]) });
    await ended.show(IDLE);
    expect(ended.asked).toEqual([]);
    expect(ended.kept.has("shown")).toBe(false);
    // What the file holds under the name is read as anything from a file is: a moment or nothing.
    for (const odd of ["", "soon", "1e99", "-1", "9".repeat(13), `${NOON_S + 600} `]) {
      const read = fakeHost({ kept: new Map([["shown", odd]]) });
      await read.show(IDLE);
      expect(read.asked, odd).toEqual([]);
    }
  });

  it("asks nothing once the runner has ended", async () => {
    const at = fakeHost();
    at.ending.abort();
    await at.show(THINKING);
    expect(at.asked).toEqual([]);
  });
});
