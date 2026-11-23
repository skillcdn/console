import * as z from "zod/mini";
import type { WakeHost, WakeSource } from "./types.js";

// The `slack` wake source (ADR-0085): one app for one agent account, which receives over its
// Socket Mode connection the events the agent's own member of the workspace can see, and raises
// a wake for what is said to the agent: a direct message, a message of a group conversation, a
// message that mentions it, and any message of a channel `runner.json` names. The wake names the
// thread, so that what is said in one thread is one thing to the agent, and
// carries the words as someone else's. Written from the messenger's own documentation of Socket
// Mode and of the Events API; what an event holds is read by schema, bounded, and never run.

/** The secret of the account's store that holds the app's token for the socket (`xapp-...`). */
export const SLACK_APP_TOKEN = "slack.app_token";
/** Where a connection is asked for. */
const OPEN_URL = "https://slack.com/api/apps.connections.open";
/** The most of a message a wake carries: the agent reads the thread with the messenger's own tool. */
const MAX_WAKE_TEXT = 4000;
/** How long the source waits before it looks again where the account keeps no token for it. */
const NO_TOKEN_WAIT_MS = 5 * 60_000;

const id = z.string().check(z.regex(/^[A-Z0-9]{1,24}$/));
/** A message's moment, which is its name in its channel: seconds, a dot, and a counter. */
const stamp = z.string().check(z.regex(/^[0-9]{1,12}\.[0-9]{1,9}$/));

/** An event of the Events API as the socket carries it: what the source reads of one, and nothing else. */
const eventSchema = z.object({
  type: z.string().check(z.maxLength(60)),
  subtype: z.optional(z.string().check(z.maxLength(60))),
  channel: z.optional(id),
  channel_type: z.optional(z.string().check(z.maxLength(20))),
  user: z.optional(id),
  /** The app a message was written through, where it was no person's own writing. */
  bot_id: z.optional(z.string().check(z.maxLength(40))),
  text: z.optional(z.string().check(z.maxLength(100_000))),
  ts: z.optional(stamp),
  thread_ts: z.optional(stamp),
});

const payloadSchema = z.object({
  event: z.optional(eventSchema),
  /** The installation the event was delivered for: the member the app acts for. */
  authorizations: z.optional(
    z.array(z.object({ user_id: z.optional(z.nullable(id)) })).check(z.maxLength(20)),
  ),
});

const envelopeSchema = z.object({
  type: z.optional(z.string().check(z.maxLength(40))),
  envelope_id: z.optional(z.string().check(z.maxLength(200))),
  payload: z.optional(z.unknown()),
});

const openedSchema = z.object({
  ok: z.boolean(),
  url: z.optional(z.string().check(z.maxLength(2000))),
  error: z.optional(z.string().check(z.maxLength(200))),
});

/** Why the source ended, by a short name of the messenger's or the source's own: what the runner's line says. */
class SlackError extends Error {
  constructor(code: string) {
    super(code);
    this.name = `slack.${/^[a-z_]{1,60}$/.test(code) ? code : "refused"}`;
  }
}

/** A wake as a wake source raises one. */
export interface RaisedWake {
  readonly key: string;
  readonly text: string;
}

/**
 * The wake an event of the messenger means, or nothing: a message in a direct conversation, or
 * one that mentions the member the app acts for, from anyone but that member; and, mentioned or
 * not, a person's message in a group conversation the member is in or in one of the channels
 * `runner.json` names. A message that is an edit, a join or anything else than someone's words
 * wakes nobody.
 */
export function slackWakeOf(
  payload: unknown,
  channels: readonly string[] = [],
): RaisedWake | undefined {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const event = parsed.data.event;
  const member = parsed.data.authorizations?.[0]?.user_id ?? undefined;
  if (
    event === undefined ||
    (event.type !== "message" && event.type !== "app_mention") ||
    (event.subtype !== undefined && event.subtype !== "file_share") ||
    event.channel === undefined ||
    event.ts === undefined ||
    event.user === undefined ||
    event.user === member
  ) {
    return undefined;
  }
  const words = event.text ?? "";
  const direct = event.channel_type === "im";
  const mentioned =
    event.type === "app_mention" || (member !== undefined && words.includes(`<@${member}>`));
  const group = event.channel_type === "mpim";
  // Where nobody named the agent, only a person's own words wake it: what an app posts in a
  // conversation the agent listens to is not said to it, and would wake it at every post.
  const listened = event.bot_id === undefined && (group || channels.includes(event.channel));
  if (!direct && !mentioned && !listened) {
    return undefined;
  }
  const thread = event.thread_ts ?? event.ts;
  const cut = words.length > MAX_WAKE_TEXT ? `${words.slice(0, MAX_WAKE_TEXT)}…` : words;
  // A message of a conversation outside any thread is said as one: named a thread, it is answered
  // in one, where whoever wrote it reads the conversation itself.
  const said = direct
    ? "A direct message at Slack"
    : group
      ? "A message in a group conversation at Slack"
      : undefined;
  const where =
    said === undefined
      ? `${mentioned ? "A mention" : "A message"} in the channel ${event.channel} at Slack, from the member ${event.user}, in the thread ${thread}`
      : event.thread_ts === undefined
        ? `${said}, from the member ${event.user}, in the conversation ${event.channel}`
        : `${said}, from the member ${event.user}, in the thread ${thread} of the conversation ${event.channel}`;
  return { key: `slack:${event.channel}:${thread}`, text: `${where}:\n${cut}` };
}

export const slack: WakeSource = {
  name: "slack",
  async run(host: WakeHost, signal: AbortSignal): Promise<void> {
    const token = await host.secret(SLACK_APP_TOKEN);
    if (token === undefined) {
      host.log(`the slack wake source finds no ${SLACK_APP_TOKEN} in the account's store`);
      host.stands("waiting", `no ${SLACK_APP_TOKEN} in the account's store`);
      await host.wait(NO_TOKEN_WAIT_MS, signal);
      return;
    }
    const answered = await host.fetch(OPEN_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      signal,
    });
    const opened = openedSchema.safeParse(await answered.json().catch(() => undefined));
    if (!opened.success || !opened.data.ok || opened.data.url === undefined) {
      throw new SlackError(opened.success ? (opened.data.error ?? "no_address") : "unreadable");
    }
    // The address is the messenger's own socket, or it is not opened.
    const address = URL.canParse(opened.data.url) ? new URL(opened.data.url) : undefined;
    if (
      address === undefined ||
      address.protocol !== "wss:" ||
      !/(^|\.)slack\.com$/.test(address.hostname)
    ) {
      throw new SlackError("foreign_address");
    }
    const socket = host.socket(address.href);
    const closing = () => socket.close();
    signal.addEventListener("abort", closing, { once: true });
    try {
      host.log("the slack wake source is connected");
      host.stands("connected");
      for await (const text of socket.messages) {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          continue;
        }
        const envelope = envelopeSchema.safeParse(json);
        if (!envelope.success) {
          continue;
        }
        // The messenger asks for a new connection now and then: this one ends, and the runner
        // starts the source again.
        if (envelope.data.type === "disconnect") {
          return;
        }
        // Acknowledged first, whatever it holds: an event nobody acknowledged is sent again.
        if (envelope.data.envelope_id !== undefined) {
          socket.send(JSON.stringify({ envelope_id: envelope.data.envelope_id }));
        }
        if (envelope.data.type !== "events_api") {
          continue;
        }
        const wake = slackWakeOf(envelope.data.payload, host.channels);
        if (wake !== undefined) {
          await host.raise(wake).catch((error: unknown) => {
            host.log(
              `a wake from slack was not raised (${error instanceof Error ? error.name : "error"})`,
            );
          });
        }
      }
    } finally {
      signal.removeEventListener("abort", closing);
      socket.close();
    }
  },
};
