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
  type RestTranscriptEvent,
  type SignalKind,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { isPicture } from "./files.js";
import { Avatar, Badge, Button, cx, formatBytes, Time } from "./ui.js";

// The parts of an agent account's page (ADR-0085, ADR-0086): how it stands, what it is doing as
// it happens, read as a conversation, what a supervisor says to it, what changes how it stands,
// its sessions, and what its runner said of itself. Everything an agent's product printed is
// shown as text, in a block that keeps its spaces and its lines, and is never made markup; a
// picture is shown by its address at the console, and any other file is offered to save.

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
 * thoughts folded; a tool's call and what it answered as one row that opens; a wake, a status
 * and an error as notes between. Everything an agent's product printed is text, never markup.
 */
export function TranscriptView(props: TranscriptViewProps) {
  const all = useWords();
  const words = all.agents.page.live;
  const [whole, setWhole] = useState<Readonly<Record<number, string>>>({});
  const [reading, setReading] = useState<number | undefined>(undefined);
  if (props.events.length === 0) {
    return <>{props.empty ?? null}</>;
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
            <a href={props.fileHref(file.id)} target="_blank" rel="noreferrer">
              <img
                src={props.fileHref(file.id)}
                alt={file.name}
                title={`${file.name} · ${formatBytes(file.size)}`}
                loading="lazy"
              />
            </a>
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
      return (
        <li key={event.n} className="sc-talk-item sc-talk-told" data-n={event.n}>
          <div className="sc-talk-bubble">
            <div className="sc-talk-meta">
              <span className="sc-talk-who">{word(event.data.by) ?? kinds.person}</span>
              {through !== undefined && <span>{words.through(through)}</span>}
              {kind !== undefined && kind !== "tell" && <Badge>{signalKinds[kind] ?? kind}</Badge>}
              {when(event)}
            </div>
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
        <li key={event.n} className="sc-talk-item sc-talk-thought" data-n={event.n}>
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
    // A wake, a status, an error, and whatever a newer runner calls otherwise: a note between.
    const facts = Object.entries(event.data).filter(
      ([name, fact]) => fact !== null && name !== "signal" && name !== "kind",
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
    <ol className="sc-talk" aria-label={words.transcript}>
      {talkOf(props.events).map(item)}
    </ol>
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
   * Whether the agent's product takes a message in a turn, as its driver says on the heartbeat
   * (`offers.steer`): where it takes none, a tell is read when the turn ends, and the button
   * says so. Nothing said is a product that takes one.
   */
  readonly steer?: boolean | undefined;
  /**
   * Whether the agent's product takes a picture (`offers.images`): where it takes none, a
   * picture is handed over as a file in its desk, and the box says so before it is sent.
   */
  readonly images?: boolean | undefined;
  readonly busy?: boolean | undefined;
  /** What was sent last, as a line under the box; or what went wrong. */
  readonly note?: ReactNode;
  readonly onSend: (kind: SignalKind, text: string, files: readonly FileUpload[]) => void;
}

/**
 * What a supervisor says to the agent, as the box of an agent product is: words, with files
 * chosen, pasted or dropped on it, a picture shown small and any other file by its name, each
 * taken out again from its chip. Enter tells; Shift with Enter is a new line. An interruption
 * of the turn under way stands beside the tell. What changes how the agent stands, a stop, a
 * restart, a reset, is not said here: `AgentControls` has it.
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
  const send = (kind: SignalKind) => {
    props.onSend(
      kind,
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
      send("tell");
    }
  };
  const stopped = props.state === "stopped";
  const unseen = props.images === false && files.some((file) => isPicture(file.type));
  return (
    <form
      className={cx("sc-panel", "sc-signal-composer", over && "sc-signal-composer-over")}
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
      {files.length > 0 && (
        <ul className="sc-chosen-files sc-signal-files" aria-label={words.files}>
          {files.map((file, index) => {
            const preview = previews[keyOf(file)];
            return (
              <li key={keyOf(file)} className="sc-chosen-file">
                {preview !== undefined && <img className="sc-signal-thumb" src={preview} alt="" />}
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
        className="sc-input sc-signal-text"
        aria-label={words.placeholder}
        placeholder={stopped ? words.placeholderStopped : words.placeholder}
        value={text}
        maxLength={MAX_SIGNAL_LENGTH}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          const pasted = [...event.clipboardData.files];
          if (pasted.length > 0) {
            event.preventDefault();
            const now = new Date();
            add(pasted.map((file) => new File([file], pastedName(file, now), { type: file.type })));
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
              send("tell");
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
        <span className="sc-field-hint sc-signal-keys">{words.keys}</span>
        <span className="sc-signal-ways">
          <Button
            disabled={!ready || stopped}
            title={words.interruptHint}
            onClick={() => send("interrupt")}
          >
            {words.interrupt}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!ready}
            title={props.steer === false ? words.tellHintAfterTurn : words.tellHint}
          >
            {words.send}
          </Button>
        </span>
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
      {resetting ? (
        <p className="sc-field-hint sc-signal-warning">{words.resetWarning}</p>
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
