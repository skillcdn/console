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
    return props.full === true ? <span className="sc-muted">{words.none}</span> : null;
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
        {words.since} <Time iso={state.since} />
        {state.heardAt !== null && (
          <>
            {" · "}
            {words.heard} <Time iso={state.heardAt} />
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

/** The events of a session, in order: a block each, what it is and when, and what it says as text. */
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
        const facts = Object.entries(event.data).filter(([, fact]) => fact !== null);
        const text = whole[event.n] ?? event.text;
        return (
          <li
            key={event.n}
            className={cx("sc-transcript-event", `sc-transcript-${event.kind}`)}
            data-n={event.n}
          >
            <div className="sc-transcript-head">
              <span className="sc-transcript-kind">{kinds[event.kind] ?? event.kind}</span>
              {facts.length > 0 && (
                <span className="sc-transcript-facts">
                  {facts.map(([name, fact]) => `${name}: ${String(fact)}`).join(" · ")}
                </span>
              )}
              <Time iso={event.at} />
            </div>
            {event.sealed !== null ? (
              <p className="sc-transcript-sealed">
                {words.sealed(
                  event.sealed.by === null ? "?" : (event.sealed.by.name ?? event.sealed.by.login),
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
          </li>
        );
      })}
    </ol>
  );
}

export interface SignalComposerProps {
  /** How the agent stands, by which what may be said is chosen: a stopped agent is restarted, a running one stopped. */
  readonly state: AgentState | undefined;
  readonly busy?: boolean | undefined;
  /** What was sent last, as a line under the box; or what went wrong. */
  readonly note?: ReactNode;
  readonly onSend: (kind: SignalKind, text: string, pictures: readonly FileUpload[]) => void;
}

/**
 * What a supervisor says to the agent: a tell, with pictures; an interruption of the turn under
 * way; and the three that change how it stands, a stop, a restart with the same conversation and
 * a reset with a new one, each with words for the agent. A reset is asked twice.
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
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (said.length > 0 && !tooMany && !busy) {
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
        rows={3}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="sc-signal-row">
        <label className="sc-signal-pictures">
          <span>{words.pictures}</span>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            onChange={(event) => setPictures([...(event.target.files ?? [])])}
          />
        </label>
        {tooMany && <span className="sc-field-error">{words.tooMany(MAX_SIGNAL_ATTACHMENTS)}</span>}
        <span className="sc-signal-ways">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || said.length === 0 || tooMany}
            title={words.tellHint}
          >
            {words.send}
          </Button>
          <Button
            disabled={busy || said.length === 0 || tooMany || stopped}
            title={words.interruptHint}
            onClick={() => send("interrupt")}
          >
            {words.interrupt}
          </Button>
          {stopped ? (
            <Button disabled={busy} title={words.restartHint} onClick={() => send("restart")}>
              {words.restart}
            </Button>
          ) : (
            <Button disabled={busy} title={words.stopHint} onClick={() => send("stop")}>
              {words.stop}
            </Button>
          )}
          {resetting ? (
            <>
              <Button variant="danger" disabled={busy} onClick={() => send("reset")}>
                {words.resetConfirm}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setResetting(false)}>
                {words.cancel}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              disabled={busy}
              title={words.resetHint}
              onClick={() => setResetting(true)}
            >
              {words.reset}
            </Button>
          )}
        </span>
      </div>
      {resetting && <p className="sc-field-hint">{words.resetWarning}</p>}
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

/** An agent account's sessions, the newest first: when each began, how it ended, what it ran, how much it holds. */
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
          <a className="sc-agent-session-link" href={props.href(session)}>
            <Time iso={session.startedAt} />
          </a>
          {session.ended === null ? (
            <Badge tone="success" kind="state">
              {words.open}
            </Badge>
          ) : (
            <Badge>{ends[session.ended] ?? session.ended}</Badge>
          )}
          {session.away && <Badge tone="warning">{words.away}</Badge>}
          <span className="sc-agent-session-facts">
            {[
              words.events(session.events),
              `${session.product.name}${session.product.version === null ? "" : ` ${session.product.version}`}`,
              ...(session.model === null ? [] : [session.model]),
              ...(session.resumed ? [words.resumed] : []),
              session.machine.name,
            ].join(" · ")}
          </span>
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
