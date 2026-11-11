import { type FormEvent, type ReactNode, useRef, useState } from "react";
import {
  type AgentState,
  type FileUpload,
  MAX_SIGNAL_ATTACHMENTS,
  MAX_SIGNAL_LENGTH,
  type RestAgent,
  type RestAgentRunner,
  type RestAgentSecret,
  type RestAgentSession,
  type RestTranscriptEvent,
  type SignalKind,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Badge, Button, cx, formatBytes, Time } from "./ui.js";

// The parts of an agent account's page (ADR-0085, ADR-0086): how it stands, what it is doing as
// it happens, what a supervisor says to it, its sessions, and what its runner said of itself.
// Everything an agent's product printed is shown as text, in a block that keeps its spaces and
// its lines, and is never made markup; a picture is shown by its address at the console.

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
        {words.since} <Time iso={state.since} precision="clock" />
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
  readonly empty?: ReactNode;
}

/** What a runner says of an event that is said apart from the rest: the tool it names. */
const TOOL = "tool";

/**
 * The events of a session, in order, as a log: what each is and when in a narrow column at the
 * left, what it says at the right. What the agent says and what it was told read as prose; what
 * its tools were called with and answered reads as code, on a sheet of its own; a wake, a status
 * and an error read as notes. Everything is text, never markup.
 */
export function TranscriptView(props: TranscriptViewProps) {
  const words = useWords().agents.page.live;
  const [whole, setWhole] = useState<Readonly<Record<number, string>>>({});
  const [reading, setReading] = useState<number | undefined>(undefined);
  if (props.events.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  const kinds: Readonly<Record<string, string>> = words.kinds;
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
  return (
    <ol className="sc-transcript" aria-label={words.transcript}>
      {props.events.map((event) => {
        const tool = event.data[TOOL];
        // The tool's name stands by itself where it is one; whatever else an event says is a fact.
        const facts = Object.entries(event.data).filter(
          ([name, fact]) => fact !== null && !(name === TOOL && typeof fact === "string"),
        );
        const text = whole[event.n] ?? event.text;
        return (
          <li
            key={event.n}
            className={cx("sc-transcript-event", `sc-transcript-${event.kind}`)}
            data-n={event.n}
          >
            <div className="sc-transcript-head">
              <span className="sc-transcript-kind">{kinds[event.kind] ?? event.kind}</span>
              <Time iso={event.at} precision="clock" />
            </div>
            <div className="sc-transcript-body">
              {(typeof tool === "string" || facts.length > 0) && (
                <div className="sc-transcript-about">
                  {typeof tool === "string" && <code className="sc-transcript-tool">{tool}</code>}
                  {facts.length > 0 && (
                    <span className="sc-transcript-facts">
                      {facts.map(([name, fact]) => (
                        <span key={name} className="sc-transcript-fact">
                          {name} <b>{String(fact)}</b>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}
              {event.sealed !== null ? (
                <p className="sc-transcript-sealed">
                  {words.sealed(
                    event.sealed.by === null
                      ? "?"
                      : (event.sealed.by.name ?? event.sealed.by.login),
                    event.sealed.reason,
                  )}
                </p>
              ) : (
                <>
                  {text.length > 0 && <pre className="sc-transcript-text">{text}</pre>}
                  {event.whole !== null && whole[event.n] === undefined && (
                    <p className="sc-transcript-cut">
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
                  {event.files.length > 0 && (
                    <ul className="sc-transcript-pictures">
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
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The pictures of a tell with the ones just chosen added: a file that is there already is not
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

/** The pictures of a tell without the one at a place: what the way out of its chip leaves. */
export function withoutChosen(current: readonly File[], at: number): readonly File[] {
  return current.filter((_, index) => index !== at);
}

/** Whether a key pressed in the box tells what is written: Enter with Ctrl, or with Cmd. */
export function tellsWith(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  return event.key === "Enter" && (event.ctrlKey || event.metaKey);
}

export interface SignalComposerProps {
  /** How the agent stands, by which what may be said is chosen: a stopped agent is restarted, a running one stopped. */
  readonly state: AgentState | undefined;
  /**
   * Whether the agent's product takes a message in a turn, as its driver says on the heartbeat
   * (`offers.steer`): where it takes none, a tell is read when the turn ends, and the button
   * says so. Nothing said is a product that takes one.
   */
  readonly steer?: boolean | undefined;
  readonly busy?: boolean | undefined;
  /** What was sent last, as a line under the box; or what went wrong. */
  readonly note?: ReactNode;
  readonly onSend: (kind: SignalKind, text: string, pictures: readonly FileUpload[]) => void;
}

/**
 * What a supervisor says to the agent: a tell, with pictures; an interruption of the turn under
 * way; and the three that change how it stands, a stop, a restart with the same conversation and
 * a reset with a new one, each with words for the agent. A reset is asked twice. The two that say
 * something stand at the right, the tell foremost; the three that change how it stands at the
 * left, quieter, beside the pictures. Ctrl or Cmd with Enter tells.
 */
export function SignalComposer(props: SignalComposerProps) {
  const words = useWords().agents.page.tell;
  const [text, setText] = useState("");
  const [pictures, setPictures] = useState<readonly File[]>([]);
  const [resetting, setResetting] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const said = text.trim();
  const busy = props.busy === true;
  const tooMany = pictures.length > MAX_SIGNAL_ATTACHMENTS;
  const send = (kind: SignalKind) => {
    props.onSend(
      kind,
      said,
      kind === "tell" || kind === "interrupt"
        ? pictures.map((file) => ({ name: file.name, bytes: file, contentType: file.type }))
        : [],
    );
    setText("");
    setPictures([]);
    setResetting(false);
    if (picker.current !== null) {
      picker.current.value = "";
    }
  };
  const ready = said.length > 0 && !tooMany && !busy;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) {
      send("tell");
    }
  };
  const stopped = props.state === "stopped";
  return (
    <form className="sc-panel sc-signal-composer" aria-label={words.aria} onSubmit={submit}>
      <textarea
        className="sc-input sc-signal-text"
        aria-label={words.placeholder}
        placeholder={words.placeholder}
        value={text}
        maxLength={MAX_SIGNAL_LENGTH}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (tellsWith(event) && ready) {
            event.preventDefault();
            send("tell");
          }
        }}
      />
      {pictures.length > 0 && (
        <ul className="sc-signal-chosen">
          {pictures.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="sc-signal-chosen-one"
            >
              <span className="sc-signal-chosen-name">{file.name}</span>
              <button
                type="button"
                className="sc-signal-chosen-remove"
                aria-label={words.removePicture(file.name)}
                onClick={() => setPictures((current) => withoutChosen(current, index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="sc-signal-row">
        <span className="sc-signal-states">
          <label className="sc-button sc-button-ghost sc-button-sm sc-file-choice">
            {words.pictures}
            <input
              ref={picker}
              className="sc-file-input"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])];
                setPictures((current) => withChosen(current, chosen));
                // The box is emptied, so that a file taken out can be chosen again.
                event.target.value = "";
              }}
            />
          </label>
          <span className="sc-signal-rule" aria-hidden="true" />
          {stopped ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title={words.restartHint}
              onClick={() => send("restart")}
            >
              {words.restart}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title={words.stopHint}
              onClick={() => send("stop")}
            >
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
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title={words.resetHint}
              onClick={() => setResetting(true)}
            >
              {words.reset}
            </Button>
          )}
        </span>
        {tooMany && (
          <span className="sc-form-error" role="alert">
            {words.tooMany(MAX_SIGNAL_ATTACHMENTS)}
          </span>
        )}
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
      {resetting && <p className="sc-field-hint sc-signal-warning">{words.resetWarning}</p>}
      {props.note !== undefined && <p className="sc-field-hint">{props.note}</p>}
    </form>
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
