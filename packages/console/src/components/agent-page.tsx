import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  type AgentState,
  type FileUpload,
  MAX_FILE_BYTES,
  MAX_SIGNAL_ATTACHMENTS,
  MAX_SIGNAL_LENGTH,
  type RestAgent,
  type RestAgentRunner,
  type RestAgentSecret,
  type RestAgentSession,
  type RestPerson,
  type RestSignal,
  type RestTranscriptEvent,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { isPicture } from "./files.js";
import { Lightbox, PictureThumb, usePicture } from "./pictures.js";
import { Avatar, Badge, Button, Callout, cx, formatBytes, personName, Time } from "./ui.js";

// The parts of an agent account's page (ADR-0085, ADR-0086): how it stands, what it is doing as
// it happens, read as a conversation in a pane that follows its end, what a supervisor says to
// it, shown as waiting until the agent takes it, what changes how it stands, its sessions, and
// what its runner said of itself. Everything an agent's product printed is shown as text, in a
// block that keeps its spaces and its lines, and is never made markup; a picture is shown by its
// address at the console, and any other file is offered to save.

/** How an agent stands, in a word, with the tone of it. */
const STATE_TONES: Readonly<Record<AgentState, "success" | "neutral" | "warning" | "danger">> = {
  running: "success",
  stopped: "neutral",
  refused: "warning",
  failed: "danger",
  unheard: "warning",
};

/** The state of an agent account as a badge: the word, and why and since when where there is room. */
export function AgentStateBadge(props: {
  readonly state: RestAgent["state"];
  /** With why it stands so, since when, and when its runner was last heard from. */
  readonly full?: boolean | undefined;
}) {
  const words = useWords().agents.page.state;
  const state = props.state ?? null;
  if (state === null) {
    // Where there is room, an account no runner has spoken for says so as the others say how they
    // stand: a word in a badge, and why beside it.
    return props.full === true ? (
      <span className="sc-agent-state">
        <Badge tone="neutral" kind="state">
          {words.unset}
        </Badge>
        <span className="sc-agent-state-why">{words.none}</span>
      </span>
    ) : null;
  }
  const reasons: Readonly<Record<string, string>> = words.reasons;
  const reason = state.reason === null ? undefined : (reasons[state.reason] ?? state.reason);
  const badge = (
    <Badge tone={STATE_TONES[state.state]} kind="state" title={reason}>
      {words[state.state]}
    </Badge>
  );
  if (props.full !== true) {
    return badge;
  }
  return (
    <span className="sc-agent-state">
      {badge}
      <span className="sc-agent-state-why">
        {reason !== undefined && `${reason} · `}
        {words.since.before}
        <Time iso={state.since} precision="clock" />
        {words.since.after}
        {state.heardAt !== null && (
          <>
            {" · "}
            {words.heard} <Time iso={state.heardAt} precision="clock" />
          </>
        )}
      </span>
    </span>
  );
}

export interface TranscriptViewProps {
  readonly events: readonly RestTranscriptEvent[];
  /** Where the bytes of a picture of the session are read. */
  readonly fileHref: (fileId: string) => string;
  /** Reads the whole text of an event whose row keeps its beginning alone. */
  readonly onReadWhole?: ((n: number) => Promise<string>) | undefined;
  /** The account whose session this is: its picture stands beside what it said. */
  readonly agent?: RestPerson | undefined;
  /**
   * The files that came with a signal, by its number, where the page has read the account's
   * record: what a supervisor sent that is no picture is offered to save from there.
   */
  readonly signalFiles?: ((number: number) => readonly SignalFile[] | undefined) | undefined;
  /** Where the bytes of a file of a signal are read. */
  readonly signalFileHref?: ((number: number, fileId: string) => string) | undefined;
  readonly empty?: ReactNode;
  /**
   * What stands at the conversation's foot, rows of its list: the words that wait to be taken,
   * and the sign that the agent is at work.
   */
  readonly foot?: ReactNode;
}

/** A file that came with a signal, as the account's record names it. */
export interface SignalFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** What a runner says of an event that is said apart from the rest: the tool it names. */
const TOOL = "tool";

/**
 * One thing of a session as a person reads it: what the agent was told, what woke it, what it
 * said and thought, a tool's call with what it answered and what was asked of it, and a note for
 * everything else, a status, an error, an event that was sealed.
 */
export type TalkItem =
  | {
      readonly type: "told" | "wake" | "said" | "thought" | "note";
      readonly event: RestTranscriptEvent;
    }
  | {
      readonly type: "tool";
      /** The call, its answer and what was asked before it ran, each where the session has it. */
      readonly call: RestTranscriptEvent | undefined;
      readonly result: RestTranscriptEvent | undefined;
      readonly permission: RestTranscriptEvent | undefined;
    };

const idOf = (event: RestTranscriptEvent): string | undefined => {
  const id = event.data.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

/**
 * The events of a session as the things a person reads, in order. A tool's call, what it
 * answered and what was asked before it ran are one thing, joined by the id the product gave
 * them; a call under an id whose call is done is another call, as an agent that numbers its
 * calls anew at every turn has it. What carries no id joins the call before it that waits.
 */
export function talkOf(events: readonly RestTranscriptEvent[]): TalkItem[] {
  const items: TalkItem[] = [];
  type Tool = Extract<TalkItem, { type: "tool" }>;
  /** The tool things by the id they are open under, as places among the items. */
  const open = new Map<string, number>();
  const toolAt = (at: number | undefined): Tool | undefined => {
    const item = at === undefined ? undefined : items[at];
    return item !== undefined && item.type === "tool" ? item : undefined;
  };
  /** The last tool thing that still waits for what `field` names, where nothing names an id. */
  const waiting = (field: "call" | "result"): number | undefined => {
    for (let at = items.length - 1; at >= 0; at -= 1) {
      const item = items[at];
      if (item === undefined || item.type !== "tool") {
        return undefined;
      }
      if (item[field] === undefined) {
        return at;
      }
    }
    return undefined;
  };
  const put = (id: string | undefined, tool: Tool, at: number | undefined): void => {
    if (at === undefined) {
      items.push(tool);
      if (id !== undefined) {
        open.set(id, items.length - 1);
      }
    } else {
      items[at] = tool;
    }
  };
  for (const event of events) {
    // A sealed event says who sealed it and why, wherever it stood.
    if (event.sealed !== null) {
      items.push({ type: "note", event });
      continue;
    }
    if (event.kind === "person") {
      items.push({ type: "told", event });
    } else if (event.kind === "wake") {
      items.push({ type: "wake", event });
    } else if (event.kind === "assistant") {
      items.push({ type: "said", event });
    } else if (event.kind === "thinking") {
      items.push({ type: "thought", event });
    } else if (event.kind === "tool_call") {
      const id = idOf(event);
      const at = id === undefined ? undefined : open.get(id);
      const held = toolAt(at);
      if (held !== undefined && held.call === undefined) {
        put(id, { ...held, call: event }, at);
      } else {
        put(id, { type: "tool", call: event, result: undefined, permission: undefined }, undefined);
      }
    } else if (event.kind === "tool_result") {
      const id = idOf(event);
      const at = id === undefined ? waiting("result") : open.get(id);
      const held = toolAt(at);
      if (held !== undefined && held.result === undefined) {
        put(id, { ...held, result: event }, at);
        if (id !== undefined) {
          open.delete(id);
        }
      } else {
        items.push({ type: "tool", call: undefined, result: event, permission: undefined });
      }
    } else if (event.kind === "permission") {
      const id = idOf(event);
      const at = id === undefined ? undefined : open.get(id);
      const held = toolAt(at);
      if (held !== undefined && held.permission === undefined && held.result === undefined) {
        put(id, { ...held, permission: event }, at);
      } else {
        put(id, { type: "tool", call: undefined, result: undefined, permission: event }, undefined);
      }
    } else {
      items.push({ type: "note", event });
    }
  }
  return items;
}

/** What the agent is at while a turn is under way: thinking, at a tool, or at work between the two. */
export type Working =
  | { readonly at: "thinking" | "working" }
  | { readonly at: "tool"; readonly tool: string | undefined };

/**
 * Whether a turn is under way, and what the agent is at, read off a session's events alone:
 * the record says where a turn ends (`turn: "completed"` on a status) and where the session
 * does, so whatever follows the last of those is a turn that is not done. Nothing where the
 * session has no event yet, or its last turn is over.
 */
export function workingOf(events: readonly RestTranscriptEvent[]): Working | undefined {
  /** The calls that were answered, by the id the product gave them. */
  const answered = new Set<string>();
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const event = events[at];
    if (event === undefined || event.sealed !== null) {
      continue;
    }
    if (event.kind === "status") {
      if (event.data.turn === "completed" || typeof event.data.ended === "string") {
        return undefined;
      }
      continue;
    }
    if (event.kind === "tool_result") {
      const id = idOf(event);
      if (id === undefined) {
        return { at: "working" };
      }
      answered.add(id);
      continue;
    }
    if (event.kind === "tool_call") {
      const id = idOf(event);
      return id !== undefined && answered.has(id)
        ? { at: "working" }
        : { at: "tool", tool: word(event.data[TOOL]) };
    }
    if (event.kind === "permission") {
      continue;
    }
    if (event.kind === "error") {
      return undefined;
    }
    if (answered.size > 0) {
      return { at: "working" };
    }
    return event.kind === "assistant" ? { at: "working" } : { at: "thinking" };
  }
  return undefined;
}

/** The number of the last signal a session's events say the agent took, or nothing where none says. */
export function takenOf(events: readonly RestTranscriptEvent[]): number | undefined {
  let most: number | undefined;
  for (const event of events) {
    const number = event.data.signal;
    if (
      (event.kind === "person" || event.kind === "wake") &&
      typeof number === "number" &&
      (most === undefined || number > most)
    ) {
      most = number;
    }
  }
  return most;
}

/**
 * The words supervisors sent that the agent has not taken: the tells, and the interrupts that
 * carry words or files, after the last signal the record says it took, the oldest first. A
 * signal is taken in order, so everything up to that one was.
 */
export function waitingOf(signals: readonly RestSignal[], taken: number): readonly RestSignal[] {
  return signals
    .filter(
      (signal) =>
        signal.number > taken &&
        signal.source === "person" &&
        (signal.kind === "tell" || signal.kind === "interrupt") &&
        (signal.text.trim().length > 0 || signal.attachments.length > 0),
    )
    .slice()
    .sort((a, b) => a.number - b.number);
}

/** How far from its end a conversation may stand and still be followed, in pixels. */
export const FOLLOW_SLACK = 72;

/** Whether whoever reads a pane is at its end, give or take a line: there the pane follows what arrives. */
export function followsEnd(pane: {
  readonly scrollHeight: number;
  readonly scrollTop: number;
  readonly clientHeight: number;
}): boolean {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= FOLLOW_SLACK;
}

/**
 * Whether a pane goes on following its end once it scrolled: at its end it does; away from it
 * by the hand of whoever reads, a wheel, a finger, a key or the bar, it does not; and away from
 * it by itself it goes on as it was. A pane moves by itself whenever the conversation changes
 * how tall it is, taller by what arrives and shorter while it is read again, and it is told so
 * after the fact, when the conversation may have changed once more: where the pane stands says
 * nothing then of who moved it.
 */
export function followsAfter(
  following: boolean,
  byHand: boolean,
  pane: {
    readonly scrollHeight: number;
    readonly scrollTop: number;
    readonly clientHeight: number;
  },
): boolean {
  if (followsEnd(pane)) {
    return true;
  }
  return byHand ? false : following;
}

/** How long after a wheel, a touch, a key or a press on the pane a scroll is taken for the reader's own, in milliseconds. */
export const HAND_MS = 1200;

/** The first line of a text, for a row that shows one: cut where it is long. */
function firstLine(text: string, most = 160): string {
  const line = text.split("\n").find((one) => one.trim().length > 0) ?? "";
  return line.length > most ? `${line.slice(0, most)}…` : line;
}

/** A fact of an event as a word, or nothing where it is none. */
const word = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * A session as a conversation: what the agent was told at the right, as whoever said it wrote
 * it, with the files that came with it; what the agent said at the left, beside its picture; its
 * thoughts folded; a tool's call and what it answered as one row that opens, the steps of a turn
 * close together; a wake, a status and an error as notes between, and a line where a turn
 * ended, with how long it took. A picture opens large over the page. Everything an agent's
 * product printed is text, never markup.
 */
export function TranscriptView(props: TranscriptViewProps) {
  const all = useWords();
  const words = all.agents.page.live;
  const shown = usePicture();
  const [whole, setWhole] = useState<Readonly<Record<number, string>>>({});
  const [reading, setReading] = useState<number | undefined>(undefined);
  if (props.events.length === 0) {
    return (
      <>
        {props.empty ?? null}
        {props.foot !== undefined && props.foot !== null && (
          <ol className="sc-talk" aria-label={words.transcript}>
            {props.foot}
          </ol>
        )}
      </>
    );
  }
  /** When the turn an event ends began: the first thing the agent was sent after the turn before. */
  const began = new Map<number, string>();
  let since: string | undefined;
  for (const event of props.events) {
    if (event.kind === "status" && event.data.turn === "completed") {
      if (since !== undefined) {
        began.set(event.n, since);
      }
      since = undefined;
    } else if ((event.kind === "person" || event.kind === "wake") && since === undefined) {
      since = event.at;
    }
  }
  const kinds: Readonly<Record<string, string>> = words.kinds;
  const signalKinds: Readonly<Record<string, string>> = words.signalKinds;
  const read = (n: number) => {
    const load = props.onReadWhole;
    if (load === undefined) {
      return;
    }
    setReading(n);
    void load(n)
      .then((text) => setWhole((current) => ({ ...current, [n]: text })))
      .catch(() => undefined)
      .finally(() => setReading(undefined));
  };
  /** The words of an event, whole where they were read whole, with the way to read the rest. */
  const text = (event: RestTranscriptEvent, className: string): ReactNode => {
    const shown = whole[event.n] ?? event.text;
    return (
      <>
        {shown.length > 0 && <pre className={className}>{shown}</pre>}
        {event.whole !== null && whole[event.n] === undefined && (
          <p className="sc-talk-cut">
            {words.cutAt(formatBytes(event.whole))}{" "}
            {props.onReadWhole !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                disabled={reading === event.n}
                onClick={() => read(event.n)}
              >
                {words.whole}
              </Button>
            )}
          </p>
        )}
      </>
    );
  };
  const pictures = (event: RestTranscriptEvent | undefined): ReactNode =>
    event === undefined || event.files.length === 0 ? null : (
      <ul className="sc-talk-pictures">
        {event.files.map((file) => (
          <li key={file.id}>
            <PictureThumb
              picture={{
                src: props.fileHref(file.id),
                alt: file.name,
                name: file.name,
                size: file.size,
              }}
              onOpen={shown.open}
            />
          </li>
        ))}
      </ul>
    );
  const when = (event: RestTranscriptEvent): ReactNode => <Time iso={event.at} precision="clock" />;
  const item = (one: TalkItem): ReactNode => {
    if (one.type === "tool") {
      const first = one.call ?? one.permission ?? one.result;
      if (first === undefined) {
        return null;
      }
      const name = word(one.call?.data[TOOL]) ?? word(one.permission?.data[TOOL]);
      const failed = one.result?.data.error === true;
      const answer = word(one.permission?.data.answer);
      const refused = answer !== undefined && answer !== "allowed";
      const line = firstLine(one.call?.text ?? one.permission?.text ?? one.result?.text ?? "");
      return (
        <li
          key={first.n}
          className={cx(
            "sc-talk-item",
            "sc-talk-step",
            "sc-talk-tool",
            (failed || refused) && "sc-talk-tool-failed",
          )}
          data-n={first.n}
        >
          <details className="sc-talk-tool-fold">
            <summary className="sc-talk-tool-head">
              <code className="sc-talk-tool-name">{name ?? kinds.tool_call}</code>
              <span className="sc-talk-tool-line">{line}</span>
              {failed && <Badge tone="danger">{words.toolFailed}</Badge>}
              {refused && <Badge tone="warning">{words.toolRefused}</Badge>}
              {one.result === undefined && one.call !== undefined && !refused && (
                <span className="sc-muted">{words.toolRunning}</span>
              )}
              {when(first)}
            </summary>
            <div className="sc-talk-tool-body">
              {one.permission !== undefined && (
                <p className="sc-talk-note-line">
                  {kinds.permission}
                  {answer === undefined ? "" : ` · ${answer}`}
                  {one.permission.text.length > 0 && ` · ${one.permission.text}`}
                </p>
              )}
              {one.call !== undefined && text(one.call, "sc-talk-code")}
              {one.result !== undefined && text(one.result, "sc-talk-code sc-talk-code-answer")}
            </div>
          </details>
          {pictures(one.result)}
        </li>
      );
    }
    const { event } = one;
    if (event.sealed !== null) {
      return (
        <li key={event.n} className="sc-talk-item sc-talk-note" data-n={event.n}>
          <span className="sc-talk-note-line">
            {words.sealed(
              event.sealed.by === null ? "?" : (event.sealed.by.name ?? event.sealed.by.login),
              event.sealed.reason,
            )}
          </span>
          {when(event)}
        </li>
      );
    }
    if (one.type === "told") {
      const number = typeof event.data.signal === "number" ? event.data.signal : undefined;
      const kind = word(event.data.kind);
      const through = word(event.data.agent);
      const unseen = word(event.data.unseen);
      const others = word(event.data.files);
      const listed =
        number === undefined
          ? undefined
          : props.signalFiles?.(number)?.filter((file) => !isPicture(file.contentType));
      const who = word(event.data.by) ?? words.kinds.person;
      // An interrupt with no words of its own stopped the turn so that what waited is read: a
      // note of who did, and no message.
      if (
        kind === "interrupt" &&
        event.text.length === 0 &&
        event.files.length === 0 &&
        others === undefined
      ) {
        return (
          <li key={event.n} className="sc-talk-item sc-talk-note" data-n={event.n}>
            <span className="sc-talk-note-line">
              {words.interrupted(who)}
              {when(event)}
            </span>
          </li>
        );
      }
      return (
        <li key={event.n} className="sc-talk-item sc-talk-told" data-n={event.n}>
          <div className="sc-talk-bubble">
            {text(event, "sc-talk-text")}
            {pictures(event)}
            {listed !== undefined && listed.length > 0 ? (
              <ul className="sc-chosen-files" aria-label={words.files}>
                {listed.map((file) => (
                  <li key={file.id} className="sc-chosen-file">
                    {props.signalFileHref === undefined || number === undefined ? (
                      <span>{file.name}</span>
                    ) : (
                      <a href={props.signalFileHref(number, file.id)} download={file.name}>
                        {file.name}
                      </a>
                    )}{" "}
                    <span className="sc-muted">{formatBytes(file.size)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              others !== undefined && (
                <p className="sc-talk-note-line">
                  {words.files}: {others}
                </p>
              )
            )}
            {unseen !== undefined && (
              <p className="sc-talk-note-line sc-talk-unseen">{words.unseen(unseen)}</p>
            )}
          </div>
          <div className="sc-talk-meta">
            <span className="sc-talk-who">{who}</span>
            {through !== undefined && <span>{words.through(through)}</span>}
            {kind !== undefined && kind !== "tell" && <Badge>{signalKinds[kind] ?? kind}</Badge>}
            {when(event)}
          </div>
          {event.data.unread === true && (
            <p className="sc-talk-note-line sc-talk-unread">{words.unread}</p>
          )}
        </li>
      );
    }
    if (one.type === "said") {
      return (
        <li key={event.n} className="sc-talk-item sc-talk-said" data-n={event.n}>
          {props.agent !== undefined && <Avatar person={props.agent} size="sm" />}
          <div className="sc-talk-prose">
            {text(event, "sc-talk-text")}
            {pictures(event)}
          </div>
          {when(event)}
        </li>
      );
    }
    if (one.type === "thought") {
      return (
        <li key={event.n} className="sc-talk-item sc-talk-step sc-talk-thought" data-n={event.n}>
          <details className="sc-talk-tool-fold">
            <summary className="sc-talk-tool-head">
              <span className="sc-talk-kind">{kinds.thinking}</span>
              <span className="sc-talk-tool-line">{firstLine(event.text)}</span>
              {when(event)}
            </summary>
            <div className="sc-talk-tool-body">{text(event, "sc-talk-text")}</div>
          </details>
        </li>
      );
    }
    // Where a turn ended: a line, with how long the agent was at it where the record says when it began.
    if (event.kind === "status" && event.data.turn === "completed") {
      const from = began.get(event.n);
      const seconds =
        from === undefined
          ? undefined
          : Math.max(0, Math.round((Date.parse(event.at) - Date.parse(from)) / 1000));
      return (
        <li key={event.n} className="sc-talk-item sc-talk-turn" data-n={event.n}>
          <span className="sc-talk-note-line">
            {words.turnDone(Number.isFinite(seconds) ? seconds : undefined)}
            {when(event)}
          </span>
        </li>
      );
    }
    // A wake, a status, an error, and whatever a newer runner calls otherwise: a note between.
    // What the note's own words say already, how a session ended, is not said twice as a fact.
    const facts = Object.entries(event.data).filter(
      ([name, fact]) => fact !== null && name !== "signal" && name !== "kind" && name !== "ended",
    );
    const lines = event.text.split("\n").filter((line) => line.trim().length > 0);
    return (
      <li
        key={event.n}
        className={cx(
          "sc-talk-item",
          "sc-talk-note",
          event.kind === "error" && "sc-talk-note-error",
        )}
        data-n={event.n}
      >
        <span className="sc-talk-note-line">
          <span className="sc-talk-kind">{kinds[event.kind] ?? event.kind}</span>
          {facts.map(([name, fact]) => (
            <span key={name} className="sc-talk-fact">
              {name} {String(fact)}
            </span>
          ))}
          {lines.length === 1 && <span>{lines[0]}</span>}
          {when(event)}
        </span>
        {lines.length > 1 && text(event, "sc-talk-text sc-talk-text-note")}
        {pictures(event)}
      </li>
    );
  };
  return (
    <>
      <ol className="sc-talk" aria-label={words.transcript}>
        {talkOf(props.events).map(item)}
        {props.foot}
      </ol>
      <Lightbox picture={shown.shown} onClose={shown.close} />
    </>
  );
}

export interface TalkWaitingProps {
  /** The words that wait, the oldest first: `waitingOf` says which. */
  readonly signals: readonly RestSignal[];
  /**
   * Why they wait, which says when they are read: a turn under way that the product takes a
   * message in (`call`) or takes none in (`turn`), an agent that is stopped, a runner not heard
   * from, or nothing but the moment it takes to hand them over (`soon`).
   */
  readonly why: "call" | "turn" | "stopped" | "unheard" | "soon";
  /** Where the bytes of a file of a signal are read. */
  readonly fileHref?: ((number: number, fileId: string) => string) | undefined;
  readonly busy?: boolean | undefined;
  /**
   * Stops the turn under way so that what waits is read now. Left out, or with no turn to
   * stop, there is no such way.
   */
  readonly onInterrupt?: (() => void) | undefined;
}

/**
 * What supervisors said and the agent has not taken yet, at the foot of the conversation: each
 * as it will stand there, quieter, with when it is read; and under the last, while a turn is
 * under way, the way to have them read now. Rows of the conversation's list.
 */
export function TalkWaiting(props: TalkWaitingProps) {
  const words = useWords().agents.page.live;
  const waits = words.waiting;
  if (props.signals.length === 0) {
    return null;
  }
  const stops = props.onInterrupt !== undefined && (props.why === "call" || props.why === "turn");
  return (
    <>
      {props.signals.map((signal, index) => {
        const last = index === props.signals.length - 1;
        const pictures = signal.attachments.filter((file) => isPicture(file.contentType));
        const others = signal.attachments.filter((file) => !isPicture(file.contentType));
        return (
          <li
            key={signal.number}
            className="sc-talk-item sc-talk-told sc-talk-waiting"
            data-signal={signal.number}
          >
            <div className="sc-talk-bubble">
              {signal.text.length > 0 && <pre className="sc-talk-text">{signal.text}</pre>}
              {pictures.length > 0 && props.fileHref !== undefined && (
                <ul className="sc-talk-pictures">
                  {pictures.map((file) => (
                    <li key={file.id}>
                      <img
                        src={props.fileHref?.(signal.number, file.id)}
                        alt={file.name}
                        title={`${file.name} · ${formatBytes(file.size)}`}
                        loading="lazy"
                      />
                    </li>
                  ))}
                </ul>
              )}
              {others.length > 0 && (
                <ul className="sc-chosen-files" aria-label={words.files}>
                  {others.map((file) => (
                    <li key={file.id} className="sc-chosen-file">
                      <span>{file.name}</span>{" "}
                      <span className="sc-muted">{formatBytes(file.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sc-talk-meta">
              <span className="sc-talk-who">
                {signal.by === null ? words.kinds.person : personName(signal.by)}
              </span>
              <Time iso={signal.at} precision="clock" />
            </div>
            {last && (
              <p className="sc-talk-wait" role="status">
                <span>{waits[props.why]}</span>
                {stops && (
                  <Button
                    size="sm"
                    disabled={props.busy === true}
                    title={waits.interruptHint}
                    onClick={props.onInterrupt}
                  >
                    {waits.interrupt}
                  </Button>
                )}
              </p>
            )}
          </li>
        );
      })}
    </>
  );
}

/**
 * The sign that the agent is at work while a turn is under way: its picture, three dots, and
 * what it is at, a thought, a tool by its name, or the work between. A row of the
 * conversation's list; nothing where no turn is under way.
 */
export function TalkWorking(props: {
  readonly working: Working | undefined;
  readonly agent?: RestPerson | undefined;
}) {
  const words = useWords().agents.page.live.working;
  const { working } = props;
  if (working === undefined) {
    return null;
  }
  return (
    <li className="sc-talk-item sc-talk-working" role="status">
      {props.agent !== undefined && <Avatar person={props.agent} size="sm" />}
      <span className="sc-talk-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="sc-talk-working-what">
        {working.at === "tool"
          ? working.tool === undefined
            ? words.working
            : words.tool(working.tool)
          : words[working.at]}
      </span>
    </li>
  );
}

export interface ChatPaneProps {
  /** What the pane is called to a screen reader. */
  readonly label: string;
  /** The conversation: whatever is read in the pane, which scrolls by itself. */
  readonly children: ReactNode;
  /** The box to speak in, at the pane's foot, always in sight. */
  readonly composer?: ReactNode;
  /**
   * Changes when whoever reads said something: the pane goes to its end and follows from
   * there, wherever they had scrolled to.
   */
  readonly said?: number | undefined;
}

/**
 * A conversation in a pane of its own, as a chat is read: it scrolls within the pane, with the
 * box to speak in at its foot. The pane follows the conversation's end while whoever reads is
 * there, leaves them where they are once they scrolled up to read, and then offers the way
 * back to the latest, saying when something arrived meanwhile.
 */
export function ChatPane(props: ChatPaneProps) {
  const words = useWords().agents.page.live;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const whole = useRef<HTMLElement>(null);
  /** Whether the pane follows its end: true until whoever reads scrolls away from it. */
  const follows = useRef(true);
  /** Until when a scroll is taken for the reader's own: set by what a hand does to the pane. */
  const hand = useRef(0);
  const [away, setAway] = useState(false);
  const [fresh, setFresh] = useState(false);
  const toEnd = () => {
    const pane = scroller.current;
    if (pane !== null) {
      follows.current = true;
      pane.scrollTop = pane.scrollHeight;
      setAway(false);
      setFresh(false);
    }
  };
  // The pane is as tall as the window leaves under what stands over it on the page, so that
  // the box to speak in is in sight without scrolling: where it begins is measured, here and
  // whenever the page is drawn again or the window changes, and the stylesheet takes it from there.
  useEffect(() => {
    const measure = () => {
      const pane = whole.current;
      if (pane !== null) {
        const top = Math.round(pane.getBoundingClientRect().top + window.scrollY);
        pane.style.setProperty("--sc-chat-top", `${top}px`);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  useEffect(() => {
    const pane = scroller.current;
    const inner = content.current;
    if (pane === null || inner === null) {
      return;
    }
    const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());
    const onHand = () => {
      hand.current = now() + HAND_MS;
    };
    const onScroll = () => {
      const byHand = now() < hand.current;
      const goes = followsAfter(follows.current, byHand, pane);
      follows.current = goes;
      setAway(!goes);
      if (goes) {
        setFresh(false);
        // Moved by itself while it follows: the conversation changed under it, so back to its end.
        if (!byHand && !followsEnd(pane)) {
          pane.scrollTop = pane.scrollHeight;
        }
      } else if (byHand) {
        // A finger let go goes on scrolling for a while: each step of it is still the reader's.
        hand.current = now() + HAND_MS;
      }
    };
    pane.addEventListener("scroll", onScroll, { passive: true });
    const hands = ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"] as const;
    for (const name of hands) {
      pane.addEventListener(name, onHand, { passive: true });
    }
    // What arrives, and a picture that loads late, change how tall the conversation is: the
    // pane goes with it while it is followed, and says that there is more where it is not.
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (follows.current) {
              pane.scrollTop = pane.scrollHeight;
            } else {
              setFresh(true);
            }
          });
    observer?.observe(inner);
    pane.scrollTop = pane.scrollHeight;
    return () => {
      pane.removeEventListener("scroll", onScroll);
      for (const name of hands) {
        pane.removeEventListener(name, onHand);
      }
      observer?.disconnect();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `said` is the trigger
  useEffect(() => {
    if (props.said !== undefined && props.said > 0) {
      toEnd();
    }
  }, [props.said]);
  return (
    <section className="sc-panel sc-chat" aria-label={props.label} ref={whole}>
      <div className="sc-chat-scroll" ref={scroller}>
        <div className="sc-chat-content" ref={content}>
          {props.children}
        </div>
      </div>
      {away && (
        <div className="sc-chat-latest">
          <Button size="sm" onClick={toEnd}>
            {fresh ? words.latestNew : words.latest}
          </Button>
        </div>
      )}
      {props.composer !== undefined && props.composer !== null && (
        <div className="sc-chat-foot">{props.composer}</div>
      )}
    </section>
  );
}

/**
 * The files of a tell with the ones just chosen added: a file that is there already is not
 * added again, so that nothing is sent twice.
 */
export function withChosen(current: readonly File[], chosen: readonly File[]): readonly File[] {
  const same = (one: File, other: File): boolean =>
    one.name === other.name && one.size === other.size && one.lastModified === other.lastModified;
  const added: File[] = [];
  for (const file of chosen) {
    if (![...current, ...added].some((one) => same(one, file))) {
      added.push(file);
    }
  }
  return [...current, ...added];
}

/** The files of a tell without the one at a place: what the way out of its chip leaves. */
export function withoutChosen(current: readonly File[], at: number): readonly File[] {
  return current.filter((_, index) => index !== at);
}

/**
 * Whether a key pressed in the box tells what is written: Enter alone, as the boxes of agent
 * products have it, with Shift for a new line; and never while a word is still being composed,
 * as Korean is, where Enter ends the composing and not the message.
 */
export function tellsWith(event: {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}): boolean {
  // 229 is what a browser says of a key pressed while composing, where it says nothing else.
  return (
    event.key === "Enter" &&
    event.shiftKey !== true &&
    event.isComposing !== true &&
    event.keyCode !== 229
  );
}

/** A picture pasted from a clipboard is called `image.png` by every browser: a name of its own, by the moment. */
export function pastedName(file: File, at: Date): string {
  if (file.name !== "image.png" && file.name.length > 0) {
    return file.name;
  }
  const two = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  const ending = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] ?? "png");
  return `pasted-${stamp}.${ending}`;
}

/** How tall the box grows with what is written in it, before it scrolls. */
const MAX_BOX_PIXELS = 280;

/** A picture is shown small beside its name where it is no larger than this: a larger one is named alone. */
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

export interface SignalComposerProps {
  /** How the agent stands: a stopped agent is told nothing until it is started again, and the box says so. */
  readonly state: AgentState | undefined;
  /**
   * Whether the agent's product takes a picture (`offers.images`): where it takes none, a
   * picture is handed over as a file in its desk, and the box says so before it is sent.
   */
  readonly images?: boolean | undefined;
  readonly busy?: boolean | undefined;
  /** What went wrong with what was sent last, as a line under the box. */
  readonly note?: ReactNode;
  /** Tells the agent what was written, with the files chosen. */
  readonly onSend: (text: string, files: readonly FileUpload[]) => void;
}

/**
 * What a supervisor says to the agent, as the box of a chat is: one box with the words, the
 * files chosen, pasted or dropped on it above them, a picture shown small and any other file by
 * its name, each taken out again from its chip, and under the words the way to choose files and
 * the way to send. Enter tells; Shift with Enter is a new line. What is told stands in the
 * conversation at once, as waiting until the agent takes it, and the way to have it read now is
 * there, beside it: the box has none. What changes how the agent stands, a stop, a restart, a
 * reset, is not said here: `AgentControls` has it.
 */
export function SignalComposer(props: SignalComposerProps) {
  const words = useWords().agents.page.tell;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({});
  const [over, setOver] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // The box grows with what is written in it, lines that wrap among them, up to a bound.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger
  useEffect(() => {
    const area = box.current;
    if (area !== null) {
      area.style.height = "auto";
      area.style.height = `${Math.min(area.scrollHeight + 2, MAX_BOX_PIXELS)}px`;
    }
  }, [text]);
  const said = text.trim();
  const busy = props.busy === true;
  const tooMany = files.length > MAX_SIGNAL_ATTACHMENTS;
  const tooLarge = files.reduce((total, file) => total + file.size, 0) > MAX_FILE_BYTES;
  const keyOf = (file: File): string => `${file.name}-${file.size}-${file.lastModified}`;
  const add = (chosen: readonly File[]) => {
    if (chosen.length === 0) {
      return;
    }
    setFiles((current) => withChosen(current, chosen));
    // A picture is read here to be shown small: the page's policy takes a picture as data.
    for (const file of chosen) {
      if (
        isPicture(file.type) &&
        file.size <= MAX_PREVIEW_BYTES &&
        typeof FileReader !== "undefined"
      ) {
        const reader = new FileReader();
        reader.onload = () => {
          const read = reader.result;
          if (typeof read === "string") {
            setPreviews((current) => ({ ...current, [keyOf(file)]: read }));
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };
  const send = () => {
    props.onSend(
      said,
      files.map((file) => ({ name: file.name, bytes: file, contentType: file.type })),
    );
    setText("");
    setFiles([]);
    setPreviews({});
  };
  const ready = said.length > 0 && !tooMany && !tooLarge && !busy;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) {
      send();
    }
  };
  const stopped = props.state === "stopped";
  const unseen = props.images === false && files.some((file) => isPicture(file.type));
  return (
    <form
      className={cx("sc-signal-composer", over && "sc-signal-composer-over")}
      aria-label={words.aria}
      onSubmit={submit}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          add([...event.dataTransfer.files]);
        }
        setOver(false);
      }}
    >
      <div className="sc-signal-box">
        {files.length > 0 && (
          <ul className="sc-chosen-files sc-signal-files" aria-label={words.files}>
            {files.map((file, index) => {
              const preview = previews[keyOf(file)];
              return (
                <li key={keyOf(file)} className="sc-chosen-file">
                  {preview !== undefined && (
                    <img className="sc-signal-thumb" src={preview} alt="" />
                  )}
                  <span className="sc-signal-file-name">{file.name}</span>{" "}
                  <span className="sc-muted">{formatBytes(file.size)}</span>{" "}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={words.removeFile(file.name)}
                    onClick={() => setFiles((current) => withoutChosen(current, index))}
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <textarea
          ref={box}
          className="sc-signal-text"
          aria-label={words.placeholder}
          placeholder={stopped ? words.placeholderStopped : words.placeholder}
          value={text}
          maxLength={MAX_SIGNAL_LENGTH}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (pasted.length > 0) {
              event.preventDefault();
              const now = new Date();
              add(
                pasted.map((file) => new File([file], pastedName(file, now), { type: file.type })),
              );
            }
          }}
          onKeyDown={(event) => {
            // On a screen that is touched, Enter is the keyboard's new line: the button tells.
            if (
              typeof window !== "undefined" &&
              window.matchMedia?.("(pointer: coarse)").matches === true
            ) {
              return;
            }
            if (
              tellsWith({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
                keyCode: event.keyCode,
              })
            ) {
              event.preventDefault();
              if (ready) {
                send();
              }
            }
          }}
        />
        <div className="sc-signal-row">
          <label className="sc-button sc-button-ghost sc-button-sm sc-file-choice">
            {words.attach}
            <input
              className="sc-file-input"
              type="file"
              multiple
              onChange={(event) => {
                add([...(event.target.files ?? [])]);
                // The box is emptied, so that a file taken out can be chosen again.
                event.target.value = "";
              }}
            />
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={!ready}>
            {words.send}
          </Button>
        </div>
      </div>
      {tooMany && (
        <p className="sc-form-error" role="alert">
          {words.tooMany(MAX_SIGNAL_ATTACHMENTS)}
        </p>
      )}
      {tooLarge && (
        <p className="sc-form-error" role="alert">
          {words.tooLarge(formatBytes(MAX_FILE_BYTES))}
        </p>
      )}
      {files.length > 0 && said.length === 0 && <p className="sc-field-hint">{words.needsWords}</p>}
      {unseen && <p className="sc-field-hint">{words.unseen}</p>}
      {props.note !== undefined && <p className="sc-field-hint">{props.note}</p>}
    </form>
  );
}

export interface AgentControlsProps {
  /** How the agent stands, by which what is offered is chosen: a running agent is stopped, one that is not is started again. */
  readonly state: AgentState | undefined;
  readonly busy?: boolean | undefined;
  /** Sends a stop, a restart or a reset, with the words for the agent where any were written. */
  readonly onSend: (kind: "stop" | "restart" | "reset", text: string) => void;
  /** What was sent last, as a line under the ways. */
  readonly note?: ReactNode;
}

/**
 * What changes how the agent stands, apart from what is said to it: a stop, which holds until
 * it is started again; a restart, which goes on with the same conversation; a reset, which
 * begins a new one and is asked twice. Each with words for the agent, where its supervisor has
 * any, and with what it does said under it.
 */
export function AgentControls(props: AgentControlsProps) {
  const words = useWords().agents.page.tell;
  const [text, setText] = useState("");
  const [resetting, setResetting] = useState(false);
  const busy = props.busy === true;
  const send = (kind: "stop" | "restart" | "reset") => {
    props.onSend(kind, text.trim());
    setText("");
    setResetting(false);
  };
  const running = props.state === "running";
  const stopped = props.state === "stopped";
  return (
    <div className="sc-agent-controls">
      <label className="sc-field">
        <span className="sc-field-label">{words.controlWords}</span>
        <input
          className="sc-input"
          value={text}
          maxLength={MAX_SIGNAL_LENGTH}
          placeholder={words.controlWordsPlaceholder}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="sc-agent-controls-ways">
        {!running && (
          <Button size="sm" disabled={busy} onClick={() => send("restart")}>
            {words.restart}
          </Button>
        )}
        {!stopped && (
          <Button size="sm" disabled={busy} onClick={() => send("stop")}>
            {words.stop}
          </Button>
        )}
        {resetting ? (
          <>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => send("reset")}>
              {words.resetConfirm}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setResetting(false)}>
              {words.cancel}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setResetting(true)}>
            {words.reset}
          </Button>
        )}
      </div>
      {props.note !== undefined && props.note !== null && (
        <p className="sc-field-hint" role="status">
          {props.note}
        </p>
      )}
      {resetting ? (
        <Callout tone="warning">{words.resetWarning}</Callout>
      ) : (
        <ul className="sc-agent-controls-says">
          {!running && (
            <li>
              <b>{words.restart}</b> {words.restartHint}
            </li>
          )}
          {!stopped && (
            <li>
              <b>{words.stop}</b> {words.stopHint}
            </li>
          )}
          <li>
            <b>{words.reset}</b> {words.resetHint}
          </li>
        </ul>
      )}
    </div>
  );
}

export interface AgentChoiceProps {
  readonly runner: RestAgentRunner | null | undefined;
  readonly busy?: boolean | undefined;
  /** Sets what is named; `null` for the product's own again. */
  readonly onSet: (choice: { model?: string | null; effort?: string | null }) => void;
}

/** The model and the level of effort an agent runs with, chosen from what its product offers. */
export function AgentChoice(props: AgentChoiceProps) {
  const words = useWords().agents.page.choice;
  const runner = props.runner ?? null;
  const offers = runner?.offers ?? null;
  if (
    runner === null ||
    offers === null ||
    (offers.models.length === 0 && offers.efforts.length === 0)
  ) {
    return <p className="sc-field-hint">{words.none}</p>;
  }
  const select = (
    label: string,
    name: "model" | "effort",
    offered: readonly string[],
    chosen: string | null,
  ) =>
    offered.length === 0 ? null : (
      <label className="sc-field sc-agent-choice-field">
        <span className="sc-field-label">{label}</span>
        <select
          className="sc-input"
          value={chosen ?? ""}
          disabled={props.busy === true}
          onChange={(event) =>
            props.onSet({ [name]: event.target.value === "" ? null : event.target.value })
          }
        >
          <option value="">{words.own}</option>
          {/* What is chosen stays choosable when the product offers it no more. */}
          {[...new Set([...offered, ...(chosen === null ? [] : [chosen])])].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    );
  const running = runner.running;
  return (
    <div className="sc-agent-choice">
      {select(words.model, "model", offers.models, runner.settings.model)}
      {select(words.effort, "effort", offers.efforts, runner.settings.effort)}
      {running !== null && (running.model !== null || running.effort !== null) && (
        <p className="sc-field-hint">
          {words.runsWith(running.model ?? words.own, running.effort ?? words.own)}
        </p>
      )}
    </div>
  );
}

export interface AgentSessionListProps {
  readonly sessions: readonly RestAgentSession[];
  readonly href: (session: RestAgentSession) => string;
  readonly empty?: ReactNode;
}

/**
 * An agent account's sessions, the newest first, a row each that leads to it: when it began and
 * ended, how it ended, what it ran and where, and how much it holds.
 */
export function AgentSessionList(props: AgentSessionListProps) {
  const words = useWords().agents.page.sessions;
  if (props.sessions.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  const ends: Readonly<Record<string, string>> = words.ends;
  return (
    <ul className="sc-agent-sessions" aria-label={words.title}>
      {props.sessions.map((session) => (
        <li key={session.id} className="sc-agent-session">
          <span className="sc-agent-session-when">
            <a className="sc-agent-session-link" href={props.href(session)}>
              <Time iso={session.startedAt} />
            </a>
            {session.endedAt !== null && (
              <span className="sc-agent-session-until">
                {" – "}
                <Time iso={session.endedAt} precision="clock" against={session.startedAt} />
              </span>
            )}
          </span>
          <span className="sc-agent-session-badges">
            {session.ended === null ? (
              <Badge tone="success" kind="state">
                {words.open}
              </Badge>
            ) : (
              <Badge tone={session.ended === "crashed" ? "danger" : "neutral"}>
                {ends[session.ended] ?? session.ended}
              </Badge>
            )}
            {session.away && <Badge tone="warning">{words.away}</Badge>}
          </span>
          <span className="sc-agent-session-facts">
            {[
              `${session.product.name}${session.product.version === null ? "" : ` ${session.product.version}`}`,
              ...(session.model === null ? [] : [session.model]),
              ...(session.resumed ? [words.resumed] : []),
              session.machine.name,
            ].join(" · ")}
          </span>
          <span className="sc-agent-session-count">{words.events(session.events)}</span>
        </li>
      ))}
    </ul>
  );
}

/** What an agent's runner last said of itself: where it runs, with what, and where its record stands. */
export function AgentRunnerFacts(props: { readonly runner: RestAgentRunner | null | undefined }) {
  const words = useWords().agents.page.settings.runner;
  const runner = props.runner ?? null;
  if (runner === null || (runner.machine === null && runner.product === null)) {
    return <p className="sc-field-hint">{words.none}</p>;
  }
  const facts: [string, ReactNode][] = [
    ...(runner.machine === null
      ? []
      : ([
          [words.machine, `${runner.machine.name} · ${runner.machine.os}`],
          [words.user, runner.machine.user],
        ] as [string, ReactNode][])),
    ...(runner.runner === null ? [] : ([[words.version, runner.runner]] as [string, ReactNode][])),
    ...(runner.product === null
      ? []
      : ([
          [
            words.product,
            <span key="product" className="sc-agent-product">
              {runner.product.name}
              {runner.product.version !== null && ` ${runner.product.version}`}
              {!runner.product.tried && <Badge tone="warning">{words.untried}</Badge>}
            </span>,
          ],
        ] as [string, ReactNode][])),
    [words.signals, words.delivered(runner.delivered, runner.latest)],
  ];
  return (
    <dl className="sc-person-facts sc-agent-runner-facts">
      {facts.map(([name, value]) => (
        <div key={name} className="sc-person-fact">
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The accounts an agent account holds elsewhere (ADR-0089): what it is called at each service,
 * as it or a supervisor recorded them, and no secret. What to close when the account is taken out.
 */
export function AgentElsewhereList(props: {
  readonly accounts: Readonly<Record<string, string>> | undefined;
}) {
  const words = useWords().agents.page.settings.elsewhere;
  const held = Object.entries(props.accounts ?? {});
  return (
    <div className="sc-agent-elsewhere">
      {held.length === 0 ? (
        <p className="sc-field-hint">{words.empty}</p>
      ) : (
        <dl className="sc-person-facts sc-agent-runner-facts" aria-label={words.title}>
          {held.map(([service, name]) => (
            <div key={service} className="sc-person-fact">
              <dt>{service}</dt>
              <dd>{name}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="sc-field-hint">{words.intro}</p>
    </div>
  );
}

export interface AgentSecretListProps {
  readonly secrets: readonly RestAgentSecret[];
  readonly busy?: boolean | undefined;
  /** Seeds a secret, write-only: only the account reads the value back. */
  readonly onSeed: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}

/** The names of an agent account's secrets, and the way a supervisor seeds one or removes one. Never a value. */
export function AgentSecretList(props: AgentSecretListProps) {
  const words = useWords().agents.page.settings.secrets;
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const busy = props.busy === true;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length === 0 || value.length === 0 || busy) {
      return;
    }
    props.onSeed(name.trim(), value);
    setName("");
    setValue("");
  };
  return (
    <div className="sc-agent-secrets">
      {props.secrets.length === 0 ? (
        <p className="sc-field-hint">{words.empty}</p>
      ) : (
        <ul className="sc-agent-secret-list" aria-label={words.title}>
          {props.secrets.map((secret) => (
            <li key={secret.name} className="sc-agent-secret">
              <code>{secret.name}</code>
              <span className="sc-muted">
                <Time iso={secret.setAt} precision="day" />
                {secret.seeded && ` · ${words.seeded}`}
                {secret.expiresOn !== null && ` · ${words.expires(secret.expiresOn)}`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => props.onRemove(secret.name)}
              >
                {words.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="sc-agent-secret-form" aria-label={words.seedAria} onSubmit={submit}>
        <input
          className="sc-input"
          aria-label={words.name}
          placeholder={words.namePlaceholder}
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="sc-input"
          type="password"
          aria-label={words.value}
          placeholder={words.value}
          value={value}
          autoComplete="new-password"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" disabled={busy || name.trim().length === 0 || value.length === 0}>
          {words.seed}
        </Button>
      </form>
      <p className="sc-field-hint">{words.intro}</p>
    </div>
  );
}
