import * as z from "zod/mini";
import type { WakeHost, WakeSource } from "./types.js";

// The `slack` wake source (ADR-0085): one app for one agent account, which receives over its
// Socket Mode connection the events the agent's own member of the workspace can see, and raises
// a wake for what is said to the agent: a direct message, a message of a group conversation, a
// message that mentions it, and any message of a channel `runner.json` names. The wake names the
// thread, so that what is said in one thread is one thing to the agent, and
// carries the words as someone else's: what the message shows, a table, a list and code among
// it, read from its blocks where it has them. Written from the messenger's own documentation of
// Socket Mode, of the Events API and of its blocks; what an event holds is read by schema,
// bounded, and never run.

/** The secret of the account's store that holds the app's token for the socket (`xapp-...`). */
export const SLACK_APP_TOKEN = "slack.app_token";
/** Where a connection is asked for. */
const OPEN_URL = "https://slack.com/api/apps.connections.open";
/** The most of a message a wake carries: the agent reads the thread with the messenger's own tool. */
const MAX_WAKE_TEXT = 4000;
/** The deepest a list of a message is indented in a wake. */
const MAX_LIST_DEPTH = 8;
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
  /**
   * What the message shows where it is more than plain words, and what hangs under it. Read
   * loosely and a part at a time (`wordsOf`): a part of a shape the source does not know is
   * left out of the words, and never lets go of the wake.
   */
  blocks: z.optional(z.unknown()),
  attachments: z.optional(z.unknown()),
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

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
/** A whole number of a block, from nothing to the most it may be; nothing where it is anything else. */
const countOf = (value: unknown, most: number): number =>
  typeof value === "number" && Number.isInteger(value) ? Math.min(Math.max(value, 0), most) : 0;

/**
 * What stands in a message's words for a part of it the wake does not carry, a picture or a
 * button say, by the messenger's name for the part: the agent reads there that the message
 * holds more, and reads it with the messenger's own tool.
 */
const leftOut = (kind: unknown): string =>
  `[${typeof kind === "string" && /^[a-z_]{1,40}$/.test(kind) ? kind : "a part"}, not carried in this wake]`;

/** The marks the messenger writes a style with in a message's text, the outermost first. */
const MARKS = [
  ["bold", "*"],
  ["italic", "_"],
  ["strike", "~"],
  ["code", "`"],
] as const;

/** One element of a run of rich text, as the messenger writes it in a message's text: a name by its id. */
function elementOf(element: Json): string {
  switch (element.type) {
    case "text":
      return textOf(element.text) ?? "";
    case "link": {
      const url = textOf(element.url) ?? "";
      const text = textOf(element.text);
      return text === undefined || text === url ? `<${url}>` : `<${url}|${text}>`;
    }
    case "user":
      return `<@${textOf(element.user_id) ?? ""}>`;
    case "channel":
      return `<#${textOf(element.channel_id) ?? ""}>`;
    case "usergroup":
      return `<!subteam^${textOf(element.usergroup_id) ?? ""}>`;
    case "broadcast":
      return `<!${textOf(element.range) ?? ""}>`;
    case "emoji":
      return `:${textOf(element.name) ?? ""}:`;
    case "date":
      return textOf(element.fallback) ?? leftOut(element.type);
    case "color":
      return textOf(element.value) ?? "";
    default:
      return leftOut(element.type);
  }
}

/**
 * A run of rich text: its elements one after another, each between the marks of its style. The
 * new line it ends with, as a paragraph does before a list, is the one its part is joined by.
 */
function runOf(elements: unknown): string {
  let run = "";
  for (const element of listOf(elements)) {
    if (!isObject(element)) {
      continue;
    }
    const style = isObject(element.style) ? element.style : {};
    const marks = MARKS.filter(([name]) => style[name] === true).map(([, mark]) => mark);
    run += `${marks.join("")}${elementOf(element)}${marks.reverse().join("")}`;
  }
  return run.endsWith("\n") ? run.slice(0, -1) : run;
}

/** What a rich text shows: its paragraphs, its lists by their marks and their depth, its code between fences, its quotes. */
function richTextOf(elements: unknown): string[] {
  const shown: string[] = [];
  for (const part of listOf(elements)) {
    if (!isObject(part)) {
      continue;
    }
    if (part.type === "rich_text_section") {
      shown.push(runOf(part.elements));
    } else if (part.type === "rich_text_list") {
      const depth = "    ".repeat(countOf(part.indent, MAX_LIST_DEPTH));
      let number = countOf(part.offset, Number.MAX_SAFE_INTEGER);
      for (const item of listOf(part.elements)) {
        if (isObject(item)) {
          number += 1;
          shown.push(
            `${depth}${part.style === "ordered" ? `${number}.` : "•"} ${runOf(item.elements)}`,
          );
        }
      }
    } else if (part.type === "rich_text_preformatted") {
      shown.push(`\`\`\`\n${runOf(part.elements)}\n\`\`\``);
    } else if (part.type === "rich_text_quote") {
      shown.push(runOf(part.elements).replaceAll(/^/gm, "> "));
    } else {
      shown.push(leftOut(part.type));
    }
  }
  return shown;
}

/**
 * A table as rows between bars, the first its head: what a cell says on one line and a bar of
 * it escaped, so that nothing a cell says reads as another cell or another row.
 */
function tableOf(rows: unknown): string[] {
  const shown: string[] = [];
  for (const row of listOf(rows)) {
    if (!Array.isArray(row)) {
      continue;
    }
    const cells = listOf(row).map((cell) => {
      const says = !isObject(cell)
        ? ""
        : cell.type === "rich_text"
          ? richTextOf(cell.elements).join(" ")
          : (textOf(cell.text) ?? leftOut(cell.type));
      return says
        .replaceAll(/[\r\n]+/g, " ")
        .replaceAll("|", "\\|")
        .trim();
    });
    shown.push(`| ${cells.join(" | ")} |`);
    if (shown.length === 1) {
      shown.push(`|${" --- |".repeat(cells.length)}`);
    }
  }
  return shown;
}

/** The words of a block's text: an object that holds them, or in a block of Markdown the words themselves. */
const saidIn = (text: unknown): string => textOf(isObject(text) ? text.text : text) ?? "";

/** What one block shows, a part of it an entry: its words, and a mark for what the wake does not carry of it. */
function blockOf(block: Json): string[] {
  switch (block.type) {
    case "rich_text":
      return richTextOf(block.elements);
    case "table":
    case "data_table":
      return [saidIn(block.caption), ...tableOf(block.rows)];
    case "header":
    case "markdown":
      return [saidIn(block.text)];
    case "section":
      return [
        saidIn(block.text),
        ...listOf(block.fields).map(saidIn),
        isObject(block.accessory) ? leftOut(block.accessory.type) : "",
      ];
    case "context":
      return listOf(block.elements).map((element) =>
        isObject(element) && element.text === undefined ? leftOut(element.type) : saidIn(element),
      );
    case "divider":
      return ["---"];
    default:
      return [leftOut(block.type)];
  }
}

/**
 * A message's words as people read them. Where it has blocks they are what the messenger shows,
 * and its `text` is what a notification says in their place, which leaves a table out: the
 * words are read from the blocks, and from the `text` only where no block says anything. A
 * table may hang under the message instead, so the blocks under it are read after its own. Each
 * is walked once and to the depth the messenger gives a block, whatever it is nested with.
 */
function wordsOf(event: {
  readonly text?: string | undefined;
  readonly blocks?: unknown;
  readonly attachments?: unknown;
}): string {
  const shownBy = (blocks: readonly unknown[]): string =>
    blocks
      .flatMap((block) => (isObject(block) ? blockOf(block) : []))
      .filter((part) => part.trim() !== "")
      .join("\n");
  const shown = shownBy(listOf(event.blocks));
  const under = shownBy(
    listOf(event.attachments).flatMap((one) => (isObject(one) ? listOf(one.blocks) : [])),
  );
  return [shown === "" ? (event.text ?? "") : shown, under]
    .filter((part) => part !== "")
    .join("\n");
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
  const direct = event.channel_type === "im";
  // A mention is told by the message's `text`, where the messenger writes one in its own way and
  // escapes what a person typed that only looks like one.
  const mentioned =
    event.type === "app_mention" ||
    (member !== undefined && (event.text ?? "").includes(`<@${member}>`));
  const group = event.channel_type === "mpim";
  // Where nobody named the agent, only a person's own words wake it: what an app posts in a
  // conversation the agent listens to is not said to it, and would wake it at every post.
  const listened = event.bot_id === undefined && (group || channels.includes(event.channel));
  if (!direct && !mentioned && !listened) {
    return undefined;
  }
  const thread = event.thread_ts ?? event.ts;
  const words = wordsOf(event);
  // A cut is said in the source's own line, with the message to read whole by its moment: said
  // after the words, it would read as theirs.
  const cut =
    words.length > MAX_WAKE_TEXT
      ? ` (cut in this wake after ${MAX_WAKE_TEXT} of its ${words.length} characters: read the message ${event.ts} whole with the messenger's own tool)`
      : "";
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
  return {
    key: `slack:${event.channel}:${thread}`,
    text: `${where}${cut}:\n${cut === "" ? words : `${words.slice(0, MAX_WAKE_TEXT)}…`}`,
  };
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
