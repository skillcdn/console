import * as z from "zod/mini";
import { MAX_SIGNAL_LENGTH } from "../limits.js";
import { withoutForbiddenCodePoints } from "../text.js";
import { wakeTextOf } from "./message.js";
import type { WakeAccount, WakeHost, WakePart, WakeRead, WakeSource, WakeWriter } from "./types.js";

// The `slack` wake source (ADR-0085): one app for one agent account, which receives over its
// Socket Mode connection the events the agent's own member of the workspace can see, and raises
// a wake for what is said to the agent: a direct message, a message of a group conversation, a
// message that mentions it, and any message of a channel `runner.json` names. The wake names the
// thread, so that what is said in one thread is one thing to the agent, and
// carries the words as someone else's: what the message shows, a table, a list and code among
// it, read from its blocks where it has them. Its first line is the source's own, and says of
// the account that wrote what the event says of it: its id, its workspace where that is
// another than the agent's (ADR-0160), that it wrote through an app where it did, and, where the
// console knows which member the account is (ADR-0164), that member and whether they supervise
// the agent. A wake is
// raised in parts (ADR-0163): the source's own lines, which nothing a message holds reaches,
// and what was written, a message someone passed on apart from the words of whoever passed it
// on. With the member's own token, where the account keeps it, the source reads what was said
// in the conversation before the message, and the wake carries what the agent missed of it,
// who else there writes as an agent account does, and what to judge by whether to answer.
// What the source brought the agent it keeps by ids and moments, from one runner to the next,
// and counts for as long as the agent's conversation holds it (ADR-0166): a conversation begun
// since, at a reset say, is carried what led up to the message, the agent's own words among it.
// Written from the messenger's own documentation of Socket Mode, of the Events API, of its
// blocks and of the two methods that read a conversation; what an event or an answer holds is
// read by schema, bounded, and never run.

/** The secret of the account's store that holds the app's token for the socket (`xapp-...`). */
export const SLACK_APP_TOKEN = "slack.app_token";
/**
 * The secret that holds the member's own token (`xoxp-...`), which the agent sends with: with it
 * the source reads the conversation a wake is raised in, as the scopes the events ask for allow.
 */
export const SLACK_USER_TOKEN = "slack.user_token";
/** Where a connection is asked for. */
const OPEN_URL = "https://slack.com/api/apps.connections.open";
/** Where a conversation is read outside its threads, the newest first, and where a thread is, the oldest first. */
const HISTORY_URL = "https://slack.com/api/conversations.history";
const REPLIES_URL = "https://slack.com/api/conversations.replies";
/** The most of a message a wake carries: the agent reads the rest with the messenger's own tool. */
const MAX_WAKE_TEXT = 4000;
/**
 * The most the message itself takes of the text a signal carries, its lines begun as that text
 * begins them: what is left is for what was said before it and for who else is there. A message of a
 * great many short lines comes to more than this within `MAX_WAKE_TEXT`, and is cut shorter.
 */
const MAX_LEAD_LENGTH = MAX_SIGNAL_LENGTH - 2500;
/** How many of the things that hang under a message a wake carries apart, as it names so many files. */
const MAX_UNDER = 5;
/**
 * What a wake carries of what was said before the message that raised it: so many messages at
 * the most, so much of each, and so much of them together as the text a signal carries holds.
 */
const MAX_BEFORE = 10;
const MAX_BEFORE_TEXT = 500;
const MAX_BEFORE_LENGTH = 3000;
/**
 * The most of one earlier message where few are carried (ADR-0166): they share what a wake holds
 * of them, so that one long message is read whole in its wake and not fetched again, and each of
 * many is still cut at `MAX_BEFORE_TEXT`.
 */
const MAX_BEFORE_MOST = 2000;
/** What a line that leads an earlier message takes of that share, about. */
const BEFORE_LINE = 200;
/**
 * How many earlier messages a wake carries where the agent's conversation holds nothing of the
 * place (ADR-0166): the last few, whoever wrote them, to take up what was being said.
 */
const MAX_BEFORE_ANEW = 5;
/** How many members a wake's first line names of those a message names beside the agent. */
const MAX_NAMED = 5;
/** How many messages a wake reads of a conversation, and of a thread: a page of so many, so many pages. */
const READ_MESSAGES = 50;
const READ_THREAD_PAGE = 200;
const READ_THREAD_PAGES = 5;
/** How long all that one wake reads is waited for, however many requests it takes, before the wake goes without. */
const READ_WAIT_MS = 5000;
/** How many wakes may wait behind one whose conversation is read: with more, it goes with nothing read. */
const MAX_WAITING = 5;
/** How long the source waits before it opens the connection the messenger asked for in place of the one it ended. */
const REOPEN_WAIT_MS = 1000;
/** How many others that write through an app a wake names. */
const MAX_OTHERS = 5;
/** Of so many accounts the console is asked at once who they are: what one asking takes. */
const MAX_WRITERS_ASKED = 100;
/** What the command reads of a conversation where nothing says how much, and at the most. */
export const SLACK_READ_DEFAULT = 20;
export const SLACK_READ_MOST = 100;
/** How long what the command reads is at the most, every message of it together: the newest are kept. */
const MAX_READ_LENGTH = 12_000;
/** The deepest a list of a message is indented in a wake. */
const MAX_LIST_DEPTH = 8;
/** How many files of a message a wake names, and how much of a name. */
const MAX_FILES_NAMED = 5;
const MAX_FILE_NAME = 80;
/**
 * The kinds of message that are someone's words: a plain one, one with a file, and a reply in a
 * thread that was sent to its conversation too. Every other kind is an edit, a join or a
 * deletion, and wakes nobody.
 */
const WORDS_OF_SOMEONE: readonly (string | undefined)[] = [
  undefined,
  "file_share",
  "thread_broadcast",
];
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
  files: z.optional(z.unknown()),
  ts: z.optional(stamp),
  thread_ts: z.optional(stamp),
  /**
   * The workspace the message came from, and in a conversation shared between workspaces the
   * one its writer is a member of. Read loosely (`workspaceOf`): one that is not spelled as the
   * messenger spells an id says nothing, and never lets go of the wake.
   */
  team: z.optional(z.unknown()),
  user_team: z.optional(z.unknown()),
});

const payloadSchema = z.object({
  event: z.optional(eventSchema),
  /**
   * The installation the event was delivered for: the member the app acts for, with the
   * workspace that member is of and, where the workspace is one of several of an organization,
   * the organization. The two are read loosely, as an event's own workspace is.
   */
  authorizations: z.optional(
    z
      .array(
        z.object({
          user_id: z.optional(z.nullable(id)),
          team_id: z.optional(z.unknown()),
          enterprise_id: z.optional(z.unknown()),
        }),
      )
      .check(z.maxLength(20)),
  ),
  /** Whether the conversation is shared with another organization, as the messenger says it. */
  is_ext_shared_channel: z.optional(z.unknown()),
});

/** A workspace's id, or an organization's, as the messenger spells one; nothing for anything else. */
const workspaceOf = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Z0-9]{1,24}$/.test(value) ? value : undefined;

/**
 * A message as a read of a conversation answers one: what the source reads of it, and nothing
 * else. Its blocks and what hangs under it are read loosely, as an event's are.
 */
const heardSchema = z.object({
  subtype: z.optional(z.string().check(z.maxLength(60))),
  user: z.optional(id),
  bot_id: z.optional(z.string().check(z.maxLength(40))),
  text: z.optional(z.string().check(z.maxLength(100_000))),
  blocks: z.optional(z.unknown()),
  attachments: z.optional(z.unknown()),
  files: z.optional(z.unknown()),
  ts: stamp,
  thread_ts: z.optional(stamp),
  team: z.optional(z.unknown()),
  user_team: z.optional(z.unknown()),
});
type HeardMessage = z.infer<typeof heardSchema>;

/** What a read of a conversation answers: its messages, each read by itself, and whether there are more. */
const readSchema = z.object({
  ok: z.boolean(),
  error: z.optional(z.string().check(z.maxLength(200))),
  messages: z.optional(z.array(z.unknown()).check(z.maxLength(1000))),
  has_more: z.optional(z.unknown()),
  response_metadata: z.optional(z.unknown()),
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

/** A wake as this source raises one: its key, and its parts in the order the agent reads them. */
export interface SlackWake {
  readonly key: string;
  readonly parts: readonly WakePart[];
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

/**
 * What a person typed, with the bracket that would begin a name, a channel or a link in a
 * message's text escaped as the messenger escapes it there: typed words never read as one.
 */
const typed = (text: string): string => text.replaceAll(/<(?=[@#!]|https?:|mailto:)/g, "&lt;");

/** One element of a run of rich text, as the messenger writes it in a message's text: a name by its id. */
function elementOf(element: Json): string {
  switch (element.type) {
    case "text":
      return typed(textOf(element.text) ?? "");
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

/** A file's id, as the messenger spells one. */
const FILE_ID = /^F[A-Z0-9]{1,23}$/;

/**
 * A mark for each file of a message, by its name on one line and the id the messenger reads it
 * by (ADR-0166), so that the agent opens it with the messenger's own tool without looking the
 * message up again: the first few, and how many more.
 */
function filesOf(files: unknown): string[] {
  const all = listOf(files).filter(isObject);
  const marks = all.slice(0, MAX_FILES_NAMED).map((file) => {
    const name = (textOf(file.name) ?? textOf(file.title) ?? "")
      .replaceAll(/[\r\n\]]+/g, " ")
      .trim()
      .slice(0, MAX_FILE_NAME);
    const id = textOf(file.id);
    const named = [name, id !== undefined && FILE_ID.test(id) ? `(${id})` : ""]
      .filter((part) => part !== "")
      .join(" ");
    return `[file${named === "" ? "" : ` ${named}`}, not carried in this wake]`;
  });
  const more = all.length - marks.length;
  return more > 0 ? [...marks, `[${more} more files, not carried in this wake]`] : marks;
}

/** What a message shows, of the fields a wake reads: an event's, or a message's as a read answers it. */
interface Shown {
  readonly text?: string | undefined;
  readonly blocks?: unknown;
  readonly attachments?: unknown;
  readonly files?: unknown;
}

/** Something that hangs under a message: what the source says of it, and what it shows. */
interface Under {
  readonly says: string;
  readonly words: string;
  /** Whether it is a message someone passed on, or one a link to it brought along. */
  readonly passedOn: boolean;
}

/** A message as a wake carries it: its writer's own words, and what hangs under it, each apart. */
interface Said {
  readonly words: string;
  readonly under: readonly Under[];
}

/** What a member's id begins with, as the messenger spells one. */
const MEMBER_ID = /^[UW][A-Z0-9]{1,23}$/;

/**
 * What the blocks of a message show, the parts one under another. Each is walked once and to the
 * depth the messenger gives a block, whatever it is nested with.
 */
const shownBy = (blocks: readonly unknown[]): string =>
  blocks
    .flatMap((block) => (isObject(block) ? blockOf(block) : []))
    .filter((part) => part.trim() !== "")
    .join("\n");

/**
 * A message's words as people read them, and what hangs under it apart from them. Where it has
 * blocks they are what the messenger shows, and its `text` is what a notification says in their
 * place, which leaves a table out: the words are read from the blocks, and from the `text` only
 * where no block says anything. A file of the message is named and marked as not carried.
 *
 * What hangs under a message is not its writer's own words: a message someone passed on, one a
 * link to it brought along, a preview of a page, a table the messenger shows apart. Each is
 * carried apart, behind a line of the source's own that says what it is, and for a message
 * passed on who wrote it, by the id the messenger gives for its writer: carried in the words,
 * what a supervisor passed on would read as the supervisor's asking (ADR-0160, ADR-0163). It is
 * read from its blocks, since a table may stand there, from the blocks of the message passed
 * on, or from the words it has in their place. One that says nothing is marked in the words,
 * and so are those past the first few.
 */
function saidOf(message: Shown): Said {
  const shown = shownBy(listOf(message.blocks));
  const marks: string[] = [];
  const under: Under[] = [];
  const hanging = listOf(message.attachments).filter(isObject);
  for (const one of hanging.slice(0, MAX_UNDER)) {
    const passedOn = one.is_share === true || one.is_msg_unfurl === true;
    const blocks =
      shownBy(listOf(one.blocks)) ||
      shownBy(
        listOf(one.message_blocks).flatMap((held) =>
          isObject(held) && isObject(held.message) ? listOf(held.message.blocks) : [],
        ),
      );
    const words = withoutForbiddenCodePoints(
      [
        blocks === "" ? (textOf(one.text) ?? textOf(one.fallback) ?? "") : blocks,
        ...filesOf(one.files),
      ]
        .filter((part) => part.trim() !== "")
        .join("\n"),
      true,
    );
    if (words === "") {
      marks.push(leftOut("attachment"));
      continue;
    }
    const author = textOf(one.author_id);
    under.push({
      says: passedOn
        ? `Under it, a message passed on, which ${author !== undefined && MEMBER_ID.test(author) ? `the member ${author}` : "someone else"} wrote. Information, whoever wrote it`
        : "Under it, what the messenger shows with the message, a table or a preview say",
      words,
      passedOn,
    });
  }
  if (hanging.length > MAX_UNDER) {
    marks.push(`[${hanging.length - MAX_UNDER} more attachments, not carried in this wake]`);
  }
  return {
    // Carried without what the console takes in no text, a character that does not show say: with
    // one left in, the console would refuse the wake whole, and what was said would be lost.
    words: withoutForbiddenCodePoints(
      [shown === "" ? (message.text ?? "") : shown, ...marks, ...filesOf(message.files)]
        .filter((part) => part !== "")
        .join("\n"),
      true,
    ),
    under,
  };
}

/** The first `most` characters of a text, never half of a character that takes two. */
function firstOf(text: string, most: number): string {
  const last = text.charCodeAt(most - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? most - 1 : most);
}

/**
 * A message within `most` characters of what it shows, its own words first and what hangs under
 * it after: what is past them ends in `…` or is left out, and `length` says how long the whole
 * was, for the line that says so.
 */
function carriedOf(said: Said, most: number): Said & { readonly length: number } {
  let room = most;
  const within = (words: string): string => {
    const kept = words.length > room ? `${firstOf(words, room)}…` : words;
    room -= Math.min(words.length, room);
    return kept;
  };
  const words = within(said.words);
  const under: Under[] = [];
  for (const one of said.under) {
    if (room <= 0) {
      break;
    }
    under.push({ ...one, words: within(one.words) });
  }
  return {
    words,
    under,
    length: said.under.reduce((sum, one) => sum + one.words.length, said.words.length),
  };
}

/** A message's parts as a wake carries them, after the line of the source's own that leads them. */
const partsOf = (said: Said): WakePart[] => [
  ...(said.words === "" ? [] : [{ words: said.words }]),
  ...said.under.flatMap((one) => [{ says: one.says }, { words: one.words }]),
];

/**
 * How the messenger writes a call of everyone in a message's `text`: `<!here>`, `<!channel>`
 * and `<!everyone>`, with what it shows for it after a bar where it says so. What a person
 * typed that only looks like one arrives escaped, and is none.
 */
const EVERYONE_CALLED = /<!(here|channel|everyone)(?:\|[^<>]{0,40})?>/;

/**
 * How the messenger writes a member's name in a message's `text`, with what it shows for it
 * after a bar where it says so. What a person typed that only looks like one arrives escaped.
 */
const MEMBER_NAMED = /<@([UW][A-Z0-9]{1,23})(?:\|[^<>]{0,80})?>/g;

/**
 * How the messenger writes a call of a group of members in a message's `text`, by the group's
 * id, with what it shows for it after a bar where it says so. Who is in the group, nothing in a
 * message says.
 */
const GROUP_CALLED = /<!subteam\^[A-Z0-9]{1,23}(?:\|[^<>]{0,80})?>/;

/**
 * Whom a message names: the members by their ids, each once, in the order it names them, in
 * whichever of its two ways the messenger wrote a name, and whether it calls a group of members,
 * which may hold anyone. The one reading of who is named, for the agent as for the others.
 */
function namedIn(text: string): { readonly members: string[]; readonly group: boolean } {
  const members: string[] = [];
  for (const found of text.matchAll(MEMBER_NAMED)) {
    const id = found[1];
    if (id !== undefined && !members.includes(id)) {
      members.push(id);
    }
  }
  return { members, group: GROUP_CALLED.test(text) };
}

/**
 * Who wrote a message, as a line of the source's says it: the account by the id the messenger
 * gives it, its workspace where the message says that it is another than the agent's own, and
 * that it wrote through an app where the message says so, which is how an agent account writes
 * with its member's token, and an app that posts in a member's name. An app that posted in
 * nobody's name is said as an app. The agent's own is the workspace the event was delivered
 * for, and the organization that workspace is one of several of, either of which an
 * installation may leave out. Where the message names no workspace for its writer, or nothing
 * is known of the agent's own, nothing is said of it: a line that names no workspace is no
 * proof of a colleague.
 */
function writerOf(
  message: Written,
  own: readonly (string | undefined)[],
  who: Who = NOBODY,
): string {
  if (message.user === undefined) {
    const app = workspaceOf(message.bot_id);
    return `an app${app === undefined ? "" : ` (${app})`}`;
  }
  const theirs = workspaceOf(message.user_team) ?? workspaceOf(message.team);
  const elsewhere =
    theirs === undefined || own.includes(theirs) || own.every((one) => one === undefined)
      ? undefined
      : theirs;
  return `the member ${message.user}${elsewhere === undefined ? "" : ` of another workspace (${elsewhere})`}${message.bot_id === undefined ? "" : " through an app"}${who(message)}`;
}

/** What a message says of whoever wrote it. */
interface Written {
  readonly user?: string | undefined;
  readonly bot_id?: string | undefined;
  readonly team?: unknown;
  readonly user_team?: unknown;
}

/**
 * What the console says of the account that wrote a message, as a line of the source's says it
 * after the account (ADR-0164), or nothing where the console says nothing of it.
 */
type Who = (message: Written) => string;
const NOBODY: Who = () => "";

/** Why what was asked came to nothing as the signal ended: by the word it was ended with, or because the wait for it was over. */
const endedBy = (until: AbortSignal): string =>
  typeof until.reason === "string" ? until.reason : "no_answer";

/** What is answered before the signal ends, or that it ended: an answer that comes or fails after that is nobody's to hear. */
const ENDED = Symbol("ended");
async function unlessEnded<T>(until: AbortSignal, answer: Promise<T>): Promise<T | typeof ENDED> {
  answer.catch(() => undefined);
  let stop = (): void => undefined;
  const ended = new Promise<typeof ENDED>((resolve) => {
    stop = () => resolve(ENDED);
    until.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([answer, ended]);
  } finally {
    until.removeEventListener("abort", stop);
  }
}

/** A login as a line of the source's carries one: a name of the console's, and never anything a line could be made of. */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,99}$/;

/**
 * The account a message names as its writer, as the console is asked of it: with the workspace
 * the message itself says the account is of. Where it says none, a message with a file say, the
 * workspace is `home`, the agent's own, which is given only for a conversation the messenger
 * says in so many words is shared with no other organization (ADR-0166): everyone who writes
 * there is an account of the agent's own organization, where an id is one account. Anywhere
 * else the agent's own workspace is never taken for it: the same id at another organization is
 * another account, and an account whose workspace nothing says is nobody the console knows.
 */
function accountOf(message: Written, home?: string): WakeAccount | undefined {
  const workspace = workspaceOf(message.user_team) ?? workspaceOf(message.team) ?? home;
  return message.user === undefined || workspace === undefined
    ? undefined
    : { workspace, account: message.user };
}

/**
 * How a member stands to the agent, as a line says it after who they are: a supervisor of its
 * own or none, and where the console says more, how: its manager, anyone above its manager or
 * an administrator, who supervises from outside the line and may stand in it too; and of
 * anyone below the agent in its line, that they report to it, themselves or through others.
 * A console that says only whether a member supervises is said as it was.
 */
function standsOf(member: NonNullable<WakeWriter["member"]>): string {
  const reports =
    member.line === "report"
      ? "reports to you"
      : member.line === "below"
        ? "reports to you through others"
        : undefined;
  // A supervisor only where the console says so in so many words: how it is one says more of
  // it, and never makes one.
  if (member.supervisor !== true) {
    return `no supervisor of yours${reports === undefined ? "" : `, ${reports}`}`;
  }
  const how = [
    member.line === "manager"
      ? "your manager"
      : member.line === "above"
        ? "above your manager"
        : undefined,
    member.administrator === true ? "an administrator" : undefined,
  ].filter((one) => one !== undefined);
  return `a supervisor of yours${how.length === 0 ? "" : `: ${how.join(" and ")}`}${reports === undefined ? "" : `, who ${reports}`}`;
}

/**
 * Asks the console who wrote (ADR-0164), of so many messages at once, and answers what a line
 * says of each writer after the account:
 *
 * - the member it is, by their login in the console, an agent account said as one, and whether
 *   they supervise the agent: `(@kim in the console, a supervisor of yours: your manager)`,
 *   with how, its manager, anyone above its manager or an administrator, and of anyone below
 *   the agent in its line that they report to it, themselves or through others (`standsOf`);
 * - that it is no member the console knows, where the console is told the accounts of that
 *   workspace and not this one: what it is told may be short of one, so a supervisor's tell that
 *   names the account still tells whose it is;
 * - nothing, where the console is told no account of that workspace, where it does not answer
 *   before the signal ends, or where it is older than the question: the line is then as the
 *   messenger alone has it. Where the signal has ended already, the console is not asked.
 *
 * It is the console's answer and nothing else's: no word of a message, no name the messenger
 * shows and no id alone makes an account a supervisor's, and a login that is not shaped as one
 * is left out. An agent takes a supervisor's own word at the messenger as an instruction
 * (ADR-0160), and this is how a wake says that one wrote.
 */
async function whoOf(
  host: Pick<WakeHost, "writers">,
  messages: readonly Written[],
  until: AbortSignal,
  home?: string,
): Promise<Who> {
  const keyOf = (one: WakeAccount): string => `${one.workspace} ${one.account}`;
  const asked = new Map<string, WakeAccount>();
  for (const message of messages) {
    const one = accountOf(message, home);
    if (one !== undefined && asked.size < MAX_WRITERS_ASKED) {
      asked.set(keyOf(one), one);
    }
  }
  if (host.writers === undefined || asked.size === 0 || until.aborted) {
    return NOBODY;
  }
  try {
    const answered = await unlessEnded(until, host.writers([...asked.values()], until));
    if (answered === ENDED) {
      return NOBODY;
    }
    const known = new Map<string, string>();
    for (const one of answered) {
      // Only what was asked of is heard, and only an answer of the shape one has.
      if (!asked.has(keyOf(one)) || one.told !== true) {
        continue;
      }
      const member = one.member;
      // A login that is not shaped as one is not written into a line: the member is said, unnamed.
      const named =
        member !== null && typeof member.login === "string" && LOGIN.test(member.login)
          ? `@${member.login} in the console`
          : "a member of the console";
      known.set(
        keyOf(one),
        member === null
          ? " (no member the console knows)"
          : ` (${named}${member.kind === "agent" ? ", an agent account" : ""}, ${standsOf(member)})`,
      );
    }
    return (message) => {
      const one = accountOf(message, home);
      return one === undefined ? "" : (known.get(keyOf(one)) ?? "");
    };
  } catch {
    return NOBODY;
  }
}

/** What an event of the messenger means to the agent: the wake's key, its parts with nothing read of the conversation, and where it was said. */
interface Heard {
  readonly key: string;
  /** The line of the source's own, with what the console says of who wrote, then the message and what hangs under it. */
  readonly saying: (who: Who) => readonly WakePart[];
  readonly channel: string;
  /** The message's own moment, and the thread it was written in where it was written in one. */
  readonly ts: string;
  readonly thread: string | undefined;
  /** The account that wrote, and the member the event was delivered for, where the event says. */
  readonly user: string;
  readonly member: string | undefined;
  /** Whether it was said in a direct conversation, where nobody else is, or in a group conversation. */
  readonly direct: boolean;
  readonly group: boolean;
  /** The agent's own workspace and organization, as the event names them. */
  readonly own: readonly (string | undefined)[];
  /** What the event says of whoever wrote, for the console to be asked who that is. */
  readonly from: Written;
  /**
   * The agent's own workspace, where the messenger says that the conversation is shared with no
   * other organization: the workspace of whoever writes there, where a message names none.
   */
  readonly home: string | undefined;
}

/**
 * The wake an event of the messenger means, or nothing: a message in a direct conversation, or
 * one that mentions the member the app acts for, from anyone but that member; and, mentioned or
 * not, a person's message in a group conversation the member is in or in one of the channels
 * `runner.json` names, and a call of everyone (`@here`, `@channel`, `@everyone`) in any
 * channel the member is in, whoever wrote it. A message that is an edit, a join or anything else
 * than someone's words wakes nobody. The wake's first line names the account that wrote by its
 * id, and its workspace where the event says it is another than the agent's own; and it says
 * that a conversation is shared with another organization where the messenger says so: an
 * agent goes by the account and never by a name (ADR-0160), and the same name at another
 * organization is another account.
 */
function heardOf(payload: unknown, channels: readonly string[]): Heard | undefined {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const event = parsed.data.event;
  const installed = parsed.data.authorizations?.[0];
  const member = installed?.user_id ?? undefined;
  if (
    event === undefined ||
    (event.type !== "message" && event.type !== "app_mention") ||
    !WORDS_OF_SOMEONE.includes(event.subtype) ||
    event.channel === undefined ||
    event.ts === undefined ||
    event.user === undefined ||
    event.user === member
  ) {
    return undefined;
  }
  const direct = event.channel_type === "im";
  // A mention is told by the message's `text`, where the messenger writes one in its own ways and
  // escapes what a person typed that only looks like one: read once, for the agent and for
  // whoever else the message names.
  const named = namedIn(event.text ?? "");
  const mentioned =
    event.type === "app_mention" || (member !== undefined && named.members.includes(member));
  const group = event.channel_type === "mpim";
  // Where nobody named the agent, only a person's own words wake it: what an app posts in a
  // conversation the agent listens to is not said to it, and would wake it at every post.
  const listened = event.bot_id === undefined && (group || channels.includes(event.channel));
  // Whoever calls everyone in a channel calls the agent that is in it, whether the channel is
  // one it listens to or not: an event arrives only of a conversation its member is in. And
  // whoever it is: an agent account is a member as a person is, and what it writes arrives as
  // an app's does (with a `bot_id`), so a call held to a person's would be deaf to every agent.
  // A call is written on purpose, as a name is, and an answer to one holds none: nothing here
  // goes round as it would where every message of a conversation woke. Where the event does
  // not say which member it was delivered for, the agent's own call cannot be told from
  // another's by who wrote it: what arrives with a `bot_id`, as its own does, then wakes
  // nobody, so that the agent is never woken by itself.
  const called =
    member === undefined && event.bot_id !== undefined
      ? undefined
      : EVERYONE_CALLED.exec(event.text ?? "")?.[1];
  if (!direct && !mentioned && !listened && called === undefined) {
    return undefined;
  }
  const thread = event.thread_ts ?? event.ts;
  // A message of a conversation outside any thread is said as one: named a thread, it is answered
  // in one, where whoever wrote it reads the conversation itself.
  const where = direct
    ? "A direct message at Slack"
    : group
      ? "A message in a group conversation at Slack"
      : undefined;
  const own = [installed?.team_id, installed?.enterprise_id].map(workspaceOf);
  // A conversation shared with another organization is said to be one, whoever wrote in it:
  // what is said there, people outside read.
  const shared = parsed.data.is_ext_shared_channel === true ? "externally shared " : "";
  // Whom a message names where it does not name the agent (ADR-0166): where several are in a
  // conversation, that is whom it was said to, and the agent reads so before it reads on. Not
  // in a direct conversation, where whatever is said is said to the agent, nor in a call of
  // everyone, which calls the agent with the rest, nor where a group of members is called,
  // which the agent may be in: nobody is said not to be named who may have been.
  const others =
    direct || mentioned || called !== undefined || named.group || member === undefined
      ? []
      : named.members.filter((one) => one !== member && one !== event.user);
  const naming =
    others.length === 0
      ? ""
      : `, naming ${others.slice(0, MAX_NAMED).join(", ")}${others.length > MAX_NAMED ? ` and ${others.length - MAX_NAMED} more` : ""} and not you`;
  const whole = saidOf(event);
  const saying = (who: Who): readonly WakePart[] => {
    const from = `from ${writerOf(event, own, who)}${naming}`;
    // A message of a channel that is in no thread is said to be in none (ADR-0166), with the
    // thread a reply to it goes in, which is its own: named as a thread alone, it read as a
    // reply in one.
    const first =
      where === undefined
        ? `${mentioned ? "A mention" : called !== undefined ? `A call of everyone (@${called})` : "A message"} in the ${shared}channel ${event.channel} at Slack, ${from}, ${event.thread_ts === undefined ? `outside any thread: a reply begins the thread ${thread}` : `in the thread ${thread}`}`
        : event.thread_ts === undefined
          ? `${where}, ${from}, in the ${shared}conversation ${event.channel}`
          : `${where}, ${from}, in the thread ${thread} of the ${shared}conversation ${event.channel}`;
    // A cut is said in the source's own line, with the message to read whole by its moment: said
    // after the words, it would read as theirs.
    const carried = (most: number): WakePart[] => {
      const said = carriedOf(whole, most);
      const cut =
        said.length > most
          ? ` (cut in this wake after ${most} of its ${said.length} characters: read the message ${event.ts} whole with the messenger's own tool)`
          : "";
      return [{ says: `${first}${cut}` }, ...partsOf(said)];
    };
    // So much of the message as a wake carries, and less where its lines are so many that, begun
    // as a signal's text begins them, they would leave no room for anything else.
    let most = MAX_WAKE_TEXT;
    let parts = carried(most);
    while (most > 250 && wakeTextOf(parts, Number.MAX_SAFE_INTEGER).length > MAX_LEAD_LENGTH) {
      most = Math.floor(most / 2);
      parts = carried(most);
    }
    return parts;
  };
  return {
    key: `slack:${event.channel}:${thread}`,
    saying,
    channel: event.channel,
    ts: event.ts,
    thread: event.thread_ts,
    user: event.user,
    member,
    direct,
    group,
    own,
    from: {
      user: event.user,
      bot_id: event.bot_id,
      team: event.team,
      user_team: event.user_team,
    },
    home: parsed.data.is_ext_shared_channel === false ? workspaceOf(installed?.team_id) : undefined,
  };
}

/**
 * The wake an event of the messenger means, with nothing read of the conversation it was said
 * in, or nothing where the event wakes nobody (`heardOf`): its key, and its parts, the line of
 * the source's own first, then the message's words, then what hangs under the message, each
 * behind a line that says what it is.
 */
export function slackWakeOf(
  payload: unknown,
  channels: readonly string[] = [],
): SlackWake | undefined {
  const heard = heardOf(payload, channels);
  return heard === undefined ? undefined : { key: heard.key, parts: heard.saying(NOBODY) };
}

/** Whether one moment of the messenger's is before another: by the seconds, then by the counter. */
function before(one: string, other: string): boolean {
  const [seconds = "", counter = ""] = one.split(".");
  const [otherSeconds = "", otherCounter = ""] = other.split(".");
  return Number(seconds) === Number(otherSeconds)
    ? counter.padEnd(9, "0") < otherCounter.padEnd(9, "0")
    : Number(seconds) < Number(otherSeconds);
}

/** A stretch of time as a line says it: whole seconds, minutes, hours or days, one at the least. */
function stretchOf(seconds: number): string {
  const counted = (count: number, word: string): string =>
    `${count} ${word}${count === 1 ? "" : "s"}`;
  if (seconds < 60) {
    return counted(Math.max(1, Math.floor(seconds)), "second");
  }
  if (seconds < 3600) {
    return counted(Math.floor(seconds / 60), "minute");
  }
  return seconds < 86_400
    ? counted(Math.floor(seconds / 3600), "hour")
    : counted(Math.floor(seconds / 86_400), "day");
}

/** The seconds of a moment of the messenger's. */
const secondsOf = (moment: string): number => Number(moment.split(".")[0]);

/** What a read of a conversation came to: its messages that are someone's words, the oldest first, and whether there are more before them; or why none. */
type Read =
  | { readonly ok: true; readonly messages: readonly HeardMessage[]; readonly more: boolean }
  | { readonly ok: false; readonly why: string };

/** A short name of why a read came to nothing, as the messenger spells its errors; `refused` for anything else. */
const whyOf = (error: string | undefined): string =>
  error !== undefined && /^[a-z_]{1,60}$/.test(error) ? error : "refused";

/**
 * Whether a message a read answered is someone's words: a plain one, one with a file, a reply
 * sent to its conversation too, each with the member that wrote it, and what an app posted in
 * nobody's name. A join, an edit and a message that does not read are none.
 */
function wordsOfSomeone(message: unknown): HeardMessage | undefined {
  const parsed = heardSchema.safeParse(message);
  if (!parsed.success) {
    return undefined;
  }
  const one = parsed.data;
  return (WORDS_OF_SOMEONE.includes(one.subtype) && one.user !== undefined) ||
    (one.subtype === "bot_message" && one.bot_id !== undefined)
    ? one
    : undefined;
}

/**
 * Does what one wake reads, all of it within one wait: the signal handed to the work ends once
 * the wait is over (`no_answer`), or before that with the one given, and what is asked under it
 * comes to nothing then. Where the one given has ended already, nothing is asked at all.
 */
async function within<T>(
  host: Pick<WakeHost, "wait">,
  signal: AbortSignal,
  read: (until: AbortSignal) => Promise<T>,
): Promise<T> {
  const control = new AbortController();
  const stop = (): void => control.abort(signal.reason);
  if (signal.aborted) {
    stop();
  } else {
    signal.addEventListener("abort", stop, { once: true });
    void host.wait(READ_WAIT_MS, control.signal).then(() => control.abort("no_answer"));
  }
  try {
    return await read(control.signal);
  } finally {
    control.abort();
    signal.removeEventListener("abort", stop);
  }
}

/**
 * Asks the messenger for a page of a conversation, with the member's own token in the
 * `authorization` header and what is asked in the address, where no token ever is. Waited for
 * until the signal ends and no longer: a wake is not held back for a messenger that does not
 * answer.
 */
async function pageOf(
  host: Pick<WakeHost, "fetch">,
  token: string,
  url: string,
  asked: Readonly<Record<string, string>>,
  until: AbortSignal,
): Promise<
  | {
      readonly ok: true;
      readonly messages: readonly unknown[];
      /** Whether there are more than these, and what the next page is asked for with, where the messenger says. */
      readonly more: boolean;
      readonly cursor: string | undefined;
    }
  | { readonly ok: false; readonly why: string }
> {
  if (until.aborted) {
    return { ok: false, why: endedBy(until) };
  }
  try {
    const answered = await unlessEnded(
      until,
      host
        .fetch(`${url}?${new URLSearchParams(asked).toString()}`, {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          signal: until,
        })
        .then((answered) => answered.json()),
    );
    if (answered === ENDED) {
      return { ok: false, why: endedBy(until) };
    }
    const parsed = readSchema.safeParse(answered);
    if (!parsed.success) {
      return { ok: false, why: "unreadable" };
    }
    if (!parsed.data.ok) {
      return { ok: false, why: whyOf(parsed.data.error) };
    }
    const meta = parsed.data.response_metadata;
    const cursor = isObject(meta) ? textOf(meta.next_cursor) : undefined;
    return {
      ok: true,
      messages: parsed.data.messages ?? [],
      more: parsed.data.has_more === true,
      cursor: cursor === undefined || cursor === "" || cursor.length > 1000 ? undefined : cursor,
    };
  } catch {
    return { ok: false, why: until.aborted ? endedBy(until) : "failed" };
  }
}

/** The messages of a read that are someone's words, the oldest first, each once. */
function inOrder(messages: readonly unknown[]): HeardMessage[] {
  const read = new Map<string, HeardMessage>();
  for (const message of messages) {
    const one = wordsOfSomeone(message);
    if (one !== undefined) {
      read.set(one.ts, one);
    }
  }
  return [...read.values()].sort((one, other) =>
    before(one.ts, other.ts) ? -1 : before(other.ts, one.ts) ? 1 : 0,
  );
}

/**
 * The latest of a conversation outside its threads: so many messages, before a moment where one
 * is given. The messenger answers them the newest first.
 */
async function conversationOf(
  host: Pick<WakeHost, "fetch">,
  token: string,
  channel: string,
  asked: { readonly limit: number; readonly before?: string | undefined },
  until: AbortSignal,
): Promise<Read> {
  const page = await pageOf(
    host,
    token,
    HISTORY_URL,
    {
      channel,
      limit: String(asked.limit),
      ...(asked.before === undefined ? {} : { latest: asked.before, inclusive: "false" }),
    },
    until,
  );
  return page.ok ? { ok: true, messages: inOrder(page.messages), more: page.more } : page;
}

/**
 * A thread: the messenger answers it the oldest first, the message that began it ahead of all, a
 * page at a time, so it is read to its end, or to as many pages as a read takes. Where a moment
 * is given, what is asked for is what was written after it: from the first page on, or past the
 * first page alone (`beginning`), which a long thread is read by without being read through,
 * and its first page says who writes there. `more` says that the thread goes on past what was
 * read, and so that its latest messages are not among them.
 */
async function threadOf(
  host: Pick<WakeHost, "fetch">,
  token: string,
  channel: string,
  thread: string,
  from: { readonly after?: string | undefined; readonly beginning?: boolean },
  until: AbortSignal,
): Promise<Read> {
  const messages: unknown[] = [];
  const asked: Record<string, string> = {
    channel,
    ts: thread,
    limit: String(READ_THREAD_PAGE),
    ...(from.after === undefined || from.beginning === true ? {} : { oldest: from.after }),
  };
  for (let pages = 0; pages < READ_THREAD_PAGES; pages += 1) {
    const page = await pageOf(host, token, REPLIES_URL, asked, until);
    if (!page.ok) {
      return page;
    }
    messages.push(...page.messages);
    if (!page.more) {
      return { ok: true, messages: inOrder(messages), more: false };
    }
    if (from.after !== undefined && asked.oldest === undefined) {
      asked.oldest = from.after;
    } else if (page.cursor === undefined) {
      break;
    } else {
      asked.cursor = page.cursor;
    }
  }
  return { ok: true, messages: inOrder(messages), more: true };
}

/** The command that reads on where a wake was raised: the conversation, or the thread in it. */
const readWith = (channel: string, thread: string | undefined, after?: string): string =>
  `console agent messages slack:${channel}${thread === undefined ? "" : `:${thread}`}${after === undefined ? "" : ` --after ${after}`}`;

/**
 * A message said before the one that raised a wake, as the wake carries it: who wrote it and how
 * long before, in a line of the source's own, and its writer's own words, so much of them. What
 * hangs under it is marked in the words and not carried: the agent reads it with the command.
 */
function earlierOf(
  message: HeardMessage,
  heard: Pick<Heard, "ts" | "own" | "member">,
  who: Who = NOBODY,
  most = MAX_BEFORE_TEXT,
): readonly [WakePart, WakePart] {
  const said = saidOf(message);
  const words = [
    said.words,
    ...said.under.map((one) =>
      one.passedOn ? "[a message passed on, not carried in this wake]" : leftOut("attachment"),
    ),
  ]
    .filter((part) => part !== "")
    .join("\n");
  const cut = words.length > most ? `, cut after ${most} of its ${words.length} characters` : "";
  // The agent's own message, carried where its conversation holds it no more, is said as its own.
  const from =
    message.user !== undefined && message.user === heard.member
      ? "you"
      : writerOf(message, heard.own, who);
  return [
    {
      says: `${stretchOf(secondsOf(heard.ts) - secondsOf(message.ts))} before it, from ${from}${cut}`,
    },
    { words: cut === "" ? words : `${firstOf(words, most)}…` },
  ];
}

/** How many names the source keeps, of the messages its wakes carried and of where they were raised: the latest. */
const MAX_KEPT = 2000;

/** The name the source keeps the moment of the last message a wake brought from a conversation, or from a thread, under. */
const broughtOf = (heard: Pick<Heard, "channel" | "thread">): string =>
  `brought:${heard.channel}:${heard.thread ?? ""}`;

/** The name the source keeps a message a wake carried under: `woke`, or `said` among what was said before another. */
const carriedAs = (channel: string, ts: string): string => `carried:${channel}:${ts}`;

/** The name the source keeps the moment under at which a wake last said, of a conversation or a thread, what to judge by whether to answer. */
const judgedOf = (heard: Pick<Heard, "channel" | "thread">): string =>
  `judged:${heard.channel}:${heard.thread ?? ""}`;

/** Keeps a name as the latest, and lets go of the oldest past the most. */
function keep(kept: Map<string, string>, name: string, value: string): void {
  kept.delete(name);
  kept.set(name, value);
  for (const oldest of kept.keys()) {
    if (kept.size <= MAX_KEPT) {
      break;
    }
    kept.delete(oldest);
  }
}

/** What a wake carries after the message itself, whether what was said there was read, and the moments of the messages it carries of it. */
interface Prior {
  readonly parts: readonly WakePart[];
  readonly read: boolean;
  readonly carried: readonly string[];
  /** Whether it says in full what the agent judges by whether to answer: kept, so that the next there says it short. */
  readonly judged?: boolean | undefined;
}

/**
 * What a wake carries of the conversation it was raised in, after the message itself (ADR-0163,
 * ADR-0166), read with the member's own token where the account keeps it:
 *
 * - what was said there before the message and since the later of two: the agent's own last
 *   message there, and the last message a wake already brought it from there, and of that what
 *   no wake carried, in a thread the message that began it say; so that an agent that stays
 *   silent is handed each message once. The oldest first, each behind a line that says who wrote
 *   it and how long before: the last few, so much of each as their number leaves room for, and
 *   where there was more, how many and the command that reads them. An agent account's message
 *   wakes no other unless it names it, so this is where an agent reads what another answered.
 *   It is information, whoever wrote it;
 * - each of the two counts only where the agent's conversation still holds it: one that began
 *   since, at a reset say (`WakeHost.began`), holds nothing of what the agent wrote or was
 *   brought before. The first wake of a place in such a conversation carries the last few
 *   messages before it, whoever wrote them, the agent's own said as its own, so that what was
 *   being said is taken up from the wake and not from a memory of it;
 * - who else there writes through an app, as an agent account does, the last to write first,
 *   and with them what the agent judges by whether to answer: said in every conversation but
 *   a direct one where such an account was read, since one message wakes each of them and
 *   none sees what another is about to say. The sentence is said once for a place in a
 *   conversation of the agent's; after that the line names them and the command, and no more.
 *
 * Where the account keeps no token to read with, nothing is added, and the wake is as it was;
 * where the messenger refuses the read or does not answer, a line says so, with why in a short
 * name of the messenger's. In a thread it is the thread that is read, and elsewhere the
 * conversation outside its threads.
 */
async function beforeOf(
  host: Pick<WakeHost, "secret" | "fetch" | "kept" | "writers" | "began">,
  heard: Heard,
  writer: Promise<Who>,
  until: AbortSignal,
): Promise<Prior> {
  const token = await host.secret(SLACK_USER_TOKEN);
  if (token === undefined) {
    return { parts: [], read: false, carried: [] };
  }
  // What was written or brought before the agent's conversation began, that conversation holds
  // no more: a moment of the messenger's is held only from then on.
  const began = host.began?.() ?? 0;
  const held = (moment: string): boolean => Number(moment) * 1000 >= began;
  const mark = host.kept.get(broughtOf(heard));
  const upTo = mark !== undefined && held(mark) ? mark : undefined;
  const read =
    heard.thread === undefined
      ? await conversationOf(
          host,
          token,
          heard.channel,
          { limit: READ_MESSAGES, before: heard.ts },
          until,
        )
      : await threadOf(
          host,
          token,
          heard.channel,
          heard.thread,
          { after: upTo, beginning: true },
          until,
        );
  const command = readWith(heard.channel, heard.thread);
  if (!read.ok) {
    return {
      parts: [{ says: `What was said there before it could not be read (${read.why})` }],
      read: false,
      carried: [],
    };
  }
  if (heard.thread !== undefined && read.more) {
    // Its latest messages are past what was read. The line says so, and the next wake there is
    // carried what was said after this message.
    return {
      parts: [
        {
          says: `The thread is longer than a wake reads, so what was said there before it is not carried: ${command}`,
        },
      ],
      read: true,
      carried: [],
    };
  }
  const earlier = read.messages.filter((message) => before(message.ts, heard.ts));
  // Who else writes there as an agent account does, the last to write first, the agent itself
  // in its place among them: the account that wrote the message is not woken by it.
  const writers: string[] = [];
  for (const message of earlier.toReversed()) {
    if (
      message.user !== undefined &&
      message.bot_id !== undefined &&
      message.user !== heard.user &&
      !writers.includes(message.user)
    ) {
      writers.push(message.user);
    }
  }
  const others = writers.filter((one) => one !== heard.member);
  // Where the event does not say which member it was delivered for, the agent's own account
  // cannot be told from another's, and nobody is named: it would be told to leave it to itself.
  const shown =
    heard.direct || heard.member === undefined || others.length === 0
      ? []
      : writers.slice(0, MAX_OTHERS + 1);
  const own =
    heard.member === undefined
      ? -1
      : earlier.findLastIndex((message) => message.user === heard.member);
  const wrote = own !== -1 && held(earlier[own]?.ts ?? "0") ? own : -1;
  // What a wake already brought of this conversation, as the message that woke or among what
  // was said before it, is not carried again: the agent has it, whether or not it answered. Nor
  // is what a wake brought from elsewhere, the message that began this thread from its channel.
  const brought =
    upTo === undefined ? -1 : earlier.findLastIndex((message) => !before(upTo, message.ts));
  const last = Math.max(wrote, brought);
  // Nothing of the place is in the agent's conversation, and something was said there before
  // that conversation began: what is carried is what leads up to the message, whoever wrote it.
  const anew = last === -1 && earlier.some((message) => !held(message.ts));
  const since = earlier
    .slice(last + 1)
    .filter(
      (message) => !(held(message.ts) && host.kept.has(carriedAs(heard.channel, message.ts))),
    );
  const latest = since.toReversed().slice(0, anew ? MAX_BEFORE_ANEW : MAX_BEFORE);
  // Who wrote each, as the console says it (ADR-0164), asked at once for all whose account is
  // another than that of the message that woke, which is asked of beside the read: said of an
  // earlier message as of the one that woke, and information all the same, whoever wrote it;
  // and said of each of the others named, by a message of theirs, since how one stands to the
  // agent, a supervisor of its own say, is among what it judges by whether to answer.
  const theirs = new Map<string, Written>();
  for (const one of shown) {
    const written = earlier.findLast(
      (message) => message.user === one && message.bot_id !== undefined,
    );
    if (one !== heard.member && written !== undefined) {
      theirs.set(one, written);
    }
  }
  const first = await writer;
  const known = accountOf(heard.from, heard.home);
  const rest = await whoOf(
    host,
    [...latest, ...theirs.values()].filter((message) => {
      const one = accountOf(message, heard.home);
      // The agent's own account is said as its own, and asked of nobody.
      return (
        message.user !== heard.member &&
        (one?.account !== known?.account || one?.workspace !== known?.workspace)
      );
    }),
    until,
    heard.home,
  );
  const who: Who = (message) => first(message) || rest(message);
  const named = shown
    .map((one) => {
      const written = theirs.get(one);
      return one === heard.member ? "you" : `${one}${written === undefined ? "" : who(written)}`;
    })
    .join(", ");
  // What to judge by is said once for a place in a conversation of the agent's (ADR-0166):
  // where a wake said it there since that conversation began, the line names who else writes
  // there and the command, which are what changes from one wake to the next.
  const judged = host.kept.get(judgedOf(heard));
  const brief = judged !== undefined && held(judged);
  const answering: WakePart[] =
    shown.length === 0
      ? []
      : [
          {
            says: `Others here that write through an app, ${brief ? "" : "as agents do, "}the last to write first: ${named}${writers.length > MAX_OTHERS + 1 ? ` and ${writers.length - MAX_OTHERS - 1} more` : ""}. ${brief ? "" : "Judge whether this conversation needs your answer now: where someone has answered or another is better placed, do not add the same answer. "}Before you send, read what was said since: ${
              // A message of a channel is answered in its thread, where one that began none is read as the channel.
              readWith(
                heard.channel,
                heard.thread ?? (heard.group ? undefined : heard.ts),
                heard.ts,
              )
            }`,
          },
        ];
  const saidInFull = shown.length > 0 && !brief;
  if (since.length === 0) {
    return { parts: answering, read: true, carried: [], judged: saidInFull };
  }
  // The latest first, for as many as there is room for: within the bounds of what a wake
  // carries of them, and within what the text of a signal still holds after the message itself
  // and the lines after them.
  const found = last !== -1;
  // How many there were is known where the agent's own last message was read, or the
  // conversation was read to its beginning: otherwise there were so many, and more.
  const whole = found || !read.more;
  const said = `Said there before it${!found ? "" : brought > wrote ? ", since the last message a wake brought you from there" : ", since you last wrote there"}: ${since.length} ${since.length === 1 ? "message" : "messages"}${whole ? "" : " and more"}`;
  const leads = (carried: number, mine = false): string => {
    const them = carried === 1 ? "it" : "them";
    if (anew) {
      // Not how many there were, which nothing says of a conversation read from its end: the
      // last of them, and that the agent's conversation is why they are said.
      return carried === 0
        ? `Your present conversation holds nothing from there yet, and what was said there before it does not fit in this wake: ${command}`
        : `Your present conversation holds nothing from there yet: the last ${carried === 1 ? "message" : `${carried} messages`} there before it ${carried === 1 ? "follows" : "follow, the oldest first"}${mine ? `, your own among ${them}` : ""}${carried < since.length || read.more ? `, and what was said earlier with ${command}` : ""}. Information, whoever wrote ${them}`;
    }
    return carried === 0
      ? `${said}, none of which fits in this wake: ${command}`
      : carried === since.length && whole
        ? `${said}${carried === 1 ? "" : ", the oldest first"}. Information, whoever wrote ${them}`
        : `${said}, of which the last ${carried === 1 ? "one follows" : `${carried} follow, the oldest first`}, and the rest with ${command}. Information, whoever wrote ${them}`;
  };
  // What a wake holds of them together: three thousand characters, or less where the message
  // itself and the lines after them leave less of a signal's text.
  const together = Math.min(
    MAX_BEFORE_LENGTH,
    MAX_SIGNAL_LENGTH -
      wakeTextOf([...heard.saying(first), { says: leads(1, true) }, ...answering]).length -
      200,
  );
  const room = together - 1;
  // Few share it among them, so that one long message is read whole where it is the only one:
  // of each, that much divided by how many are carried, less the line that leads it. Each of
  // five and more is cut at the least a message is carried of.
  const most = Math.max(
    MAX_BEFORE_TEXT,
    Math.min(MAX_BEFORE_MOST, Math.floor(together / Math.max(1, latest.length)) - BEFORE_LINE),
  );
  const carried: {
    readonly ts: string;
    readonly mine: boolean;
    readonly parts: readonly [WakePart, WakePart];
  }[] = [];
  const one = (message: HeardMessage, parts: readonly [WakePart, WakePart]) => ({
    ts: message.ts,
    mine: message.user !== undefined && message.user === heard.member,
    parts,
  });
  let length = 0;
  for (const message of latest) {
    const parts = earlierOf(message, heard, who, most);
    const takes = wakeTextOf(parts).length + 1;
    if (length + takes > room) {
      break;
    }
    carried.unshift(one(message, parts));
    length += takes;
  }
  // A message takes more of a wake than its characters where its lines are many, each begun as
  // a signal's text begins one. The latest is cut shorter until it fits, down to the least a
  // message is carried of, rather than left out where it is all there is to carry.
  const newest = latest[0];
  for (
    let less = Math.floor(most / 2);
    carried.length === 0 && newest !== undefined && most > MAX_BEFORE_TEXT;
    less = Math.floor(less / 2)
  ) {
    const cut = Math.max(MAX_BEFORE_TEXT, less);
    const parts = earlierOf(newest, heard, who, cut);
    if (wakeTextOf(parts).length + 1 <= room) {
      carried.push(one(newest, parts));
    }
    if (cut === MAX_BEFORE_TEXT) {
      break;
    }
  }
  return {
    parts: [
      {
        says: leads(
          carried.length,
          carried.some((one) => one.mine),
        ),
      },
      ...carried.flatMap((one) => [...one.parts]),
      ...answering,
    ],
    read: true,
    carried: carried.map((one) => one.ts),
    judged: saidInFull,
  };
}

/**
 * Raises the wake of one message, with who wrote it and what it carries of its conversation, all
 * of it asked within one wait, and keeps what the agent was brought by it, once the console took it:
 *
 * - the message itself, and each message it carries of what was said before. A message that woke
 *   is not raised again where its event comes again, after a connection that ended before it
 *   was acknowledged say. One that was carried among what was said before another is raised
 *   still when its own event comes, late as it is: it was carried as information, and what is
 *   said to the agent instructs it only where it is what woke it;
 * - the moment of the message, as far as the agent was brought what is said there: only where
 *   what was said before it was read, so that a wake that carried nothing of it leaves the next
 *   to;
 * - the moment at which a wake said in full, of that place, what the agent judges by whether to
 *   answer.
 *
 * The moment of a message is kept, and where it was written, never a word of one. It is kept
 * from one runner to the next where the machine keeps it, and counts for as long as the
 * agent's conversation holds what it stands for (ADR-0166).
 */
async function raiseOf(host: WakeHost, heard: Heard, reading: AbortSignal): Promise<void> {
  const message = carriedAs(heard.channel, heard.ts);
  if (host.kept.get(message) === "woke") {
    return;
  }
  const { parts, prior } = await within(host, reading, async (until) => {
    // Who wrote, as the console says it (ADR-0164), is asked beside the read of the conversation
    // and not after it: a messenger that does not answer costs the wake's first line nothing.
    const writer = whoOf(host, [heard.from], until, heard.home);
    // A read that fails in a way of its own costs the wake nothing: it goes as it stands.
    const prior = await beforeOf(host, heard, writer, until).catch(
      (): Prior => ({
        parts: [{ says: "What was said there before it could not be read (failed)" }],
        read: false,
        carried: [],
      }),
    );
    return { parts: heard.saying(await writer), prior };
  });
  const taken = await host
    .raise({ key: heard.key, parts: [...parts, ...prior.parts] })
    .catch((error: unknown) => {
      host.log(
        `a wake from slack was not raised (${error instanceof Error ? error.name : "error"})`,
      );
      return false;
    });
  if (!taken) {
    return;
  }
  for (const ts of prior.carried) {
    // One that woke stays one that woke, though it is carried again among what led up to this
    // message, in a conversation begun since: its own event, come again, wakes nobody twice.
    const name = carriedAs(heard.channel, ts);
    keep(host.kept, name, host.kept.get(name) === "woke" ? "woke" : "said");
  }
  keep(host.kept, message, "woke");
  if (prior.judged === true) {
    // What to judge by was said in full: the next wake there says it short (ADR-0166).
    keep(host.kept, judgedOf(heard), heard.ts);
  }
  if (prior.read) {
    const place = broughtOf(heard);
    const was = host.kept.get(place);
    keep(host.kept, place, was !== undefined && before(heard.ts, was) ? was : heard.ts);
  }
}

/** Where a read is asked for, as a wake's key names it after the source's name: the conversation, and the thread in it. */
const NAMED = /^([A-Z0-9]{1,24})(?::([0-9]{1,12}\.[0-9]{1,9}))?$/;

/**
 * The latest of what was said in a conversation or in a thread of one, for the account's own
 * command: each message behind a line of the source's own that says how long ago it was
 * written, by whom and under which moment, its words as a wake carries them and what hangs
 * under it apart. After a moment alone, where one is given. Named as a wake's key names it,
 * `<conversation>` or `<conversation>:<thread>`; a thread that is none, the message of a wake
 * that was written in no thread, is read as its conversation. So much of it all together, the
 * newest kept, and the first line says how many were left out.
 */
async function readOf(
  host: Pick<WakeHost, "secret" | "fetch" | "writers">,
  where: string,
  options: Parameters<NonNullable<WakeSource["read"]>>[2],
): Promise<WakeRead> {
  const named = NAMED.exec(where);
  const channel = named?.[1];
  if (channel === undefined) {
    return { ok: false, why: "not_a_conversation" };
  }
  const after = options.after;
  if (after !== undefined && !stamp.safeParse(after).success) {
    return { ok: false, why: "not_a_moment" };
  }
  const token = await host.secret(SLACK_USER_TOKEN);
  if (token === undefined) {
    return { ok: false, why: "no_token" };
  }
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? SLACK_READ_DEFAULT), 1),
    SLACK_READ_MOST,
  );
  let thread = named?.[2];
  let read =
    thread === undefined
      ? await conversationOf(host, token, channel, { limit }, options.signal)
      : await threadOf(host, token, channel, thread, { after }, options.signal);
  // A message that began no thread is all a read of its thread answers: what is asked for is
  // then what was said around it, in its conversation.
  if (
    thread !== undefined &&
    read.ok &&
    read.messages.length <= 1 &&
    read.messages[0]?.thread_ts === undefined
  ) {
    thread = undefined;
    read = await conversationOf(host, token, channel, { limit }, options.signal);
  }
  if (!read.ok) {
    return read;
  }
  const said =
    after === undefined
      ? read.messages
      : read.messages.filter((message) => before(after, message.ts));
  const latest = said.slice(-limit);
  const now = Math.floor(options.now / 1000);
  const who = await whoOf(host, latest, options.signal);
  // The newest first, for as long as there is room: the oldest are what is left out.
  const shown: WakePart[][] = [];
  let length = 0;
  for (const message of latest.toReversed()) {
    const carried = carriedOf(saidOf(message), MAX_WAKE_TEXT);
    const parts: WakePart[] = [
      {
        says: `${stretchOf(Math.max(0, now - secondsOf(message.ts)))} ago, from ${writerOf(message, [], who)}, the message ${message.ts}${
          carried.length > MAX_WAKE_TEXT
            ? ` (cut after ${MAX_WAKE_TEXT} of its ${carried.length} characters)`
            : ""
        }`,
      },
      ...partsOf(carried),
    ];
    length += wakeTextOf(parts, Number.MAX_SAFE_INTEGER).length + 1;
    if (shown.length > 0 && length > MAX_READ_LENGTH) {
      break;
    }
    shown.unshift(parts);
  }
  const left = latest.length - shown.length;
  // A conversation is answered from its latest back: where all of it was said after the moment,
  // more may have been.
  const more =
    latest.length < said.length ||
    (thread === undefined && read.more && said.length === read.messages.length);
  const rest =
    thread !== undefined && read.more
      ? // A thread that goes on past what was read is said so: its latest are not these.
        "; the thread is longer than a read takes, and goes on after these"
      : more
        ? "; more was said before"
        : "";
  return {
    ok: true,
    parts: [
      {
        says: `${
          shown.length === 0
            ? "Nothing is said"
            : `The last ${shown.length === 1 ? "message" : `${shown.length} messages`}`
        }${after === undefined ? "" : ` after ${after}`} ${thread === undefined ? `in the conversation ${channel}` : `in the thread ${thread} of the conversation ${channel}`} at Slack${shown.length < 2 ? "" : ", the oldest first"}${rest}${
          left === 0
            ? ""
            : `; ${left} before ${shown.length === 1 ? "it" : "these"} left out, past what one reading holds: read ${left === 1 ? "it" : "them"} with the messenger's own tool`
        }. A line that begins with > is what someone wrote`,
      },
      ...shown.flat(),
    ],
  };
}

/**
 * One connection of the socket, until it ends: every envelope is acknowledged as it arrives, and
 * what is said to the agent handed on. Answers whether the messenger asked for a new one in its
 * place, which it does now and then.
 */
async function listen(
  host: WakeHost,
  token: string,
  hear: (heard: Heard) => void,
  signal: AbortSignal,
): Promise<boolean> {
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
      if (envelope.data.type === "disconnect") {
        return true;
      }
      // Acknowledged first, whatever it holds: an event nobody acknowledged is sent again.
      if (envelope.data.envelope_id !== undefined) {
        socket.send(JSON.stringify({ envelope_id: envelope.data.envelope_id }));
      }
      if (envelope.data.type !== "events_api") {
        continue;
      }
      const heard = heardOf(envelope.data.payload, host.channels);
      if (heard !== undefined) {
        hear(heard);
      }
    }
    return false;
  } finally {
    signal.removeEventListener("abort", closing);
    socket.close();
  }
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
    // What is raised, one wake after another in the order the events arrived: the conversation
    // is read for each before it is raised, and the socket is not kept waiting for that, since
    // an event that is not acknowledged within a few seconds is sent again. Where too many
    // wait, the one whose turn it is goes with nothing read: the latest say what was said before.
    const reading = new AbortController();
    let raising: Promise<void> = Promise.resolve();
    let waiting = 0;
    const hear = (heard: Heard): void => {
      waiting += 1;
      raising = raising.then(() => {
        waiting -= 1;
        return raiseOf(
          host,
          heard,
          waiting > MAX_WAITING ? AbortSignal.abort("too_many_waiting") : reading.signal,
        );
      });
    };
    try {
      // The messenger asks for a new connection now and then: it is opened with what is still
      // being raised carried over, which nothing of it waits for.
      while (await listen(host, token, hear, signal)) {
        host.stands("waiting");
        await host.wait(REOPEN_WAIT_MS, signal);
        if (signal.aborted) {
          return;
        }
      }
    } finally {
      // What was heard before the source ended is raised still, with nothing more read for it:
      // neither the next connection nor a stop of the runner waits for a messenger to answer.
      reading.abort("stopped");
      await raising;
    }
  },
  read: (host, where, options) => readOf(host, where, options),
};
