import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type ConsoleClient,
  isLoginAt,
  type RestAgent,
  type RestAgentInvitationMade,
  type RestAgentSecret,
  type RestAgentSession,
  type RestProvider,
  type RestSession,
  type RestSignal,
  type RestTranscriptEvent,
  restAgentSessionSchema,
  restTranscriptEventSchema,
} from "./api.js";
import {
  AgentChoice,
  AgentControls,
  AgentElsewhereList,
  AgentRunnerFacts,
  AgentSecretList,
  AgentSessionList,
  AgentStateBadge,
  ChatPane,
  SignalComposer,
  TalkWaiting,
  TalkWorking,
  TranscriptView,
  takenOf,
  waitingOf,
  workingOf,
} from "./components/agent-page.js";
import { AgentPictureSave } from "./components/agents.js";
import { AgentInvitationPanel, AgentStartSteps } from "./components/setup.js";
import {
  Avatar,
  Button,
  Callout,
  cx,
  EmptyState,
  LinkButton,
  PersonChip,
  personName,
  Spinner,
  Time,
} from "./components/ui.js";
import { useWords } from "./i18n/index.js";
import { type AgentTab, agentHref, PATHS, setupHref } from "./router.js";
import { useAction } from "./use-action.js";

// An agent account's page (ADR-0085, ADR-0086): how it stands, what it is doing as it happens
// with the way to say something to it, its sessions, its plate, and what is kept of it. Its
// supervisors read all of it; whoever only sees the account reads how it stands.

/** How often the page asks again how the agent stands, and whether a session began. */
const REFRESH_MS = 10_000;
/** How many of a session's last events the page reads first, and how many more a step back reads. */
const TAIL = 200;
/** How many steps back the page reads for the last word the agent took, where the events it shows hold none. */
const LOOK_BACK_STEPS = 5;

const TABS: readonly AgentTab[] = ["live", "work", "sessions", "settings"];

/** Something read from the console and read again on a timer: what it answered last, and the way to read it now. */
export function useRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  everyMs?: number,
): { readonly value: T | undefined; readonly failed: unknown; readonly again: () => void } {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [failed, setFailed] = useState<unknown>(undefined);
  const [turn, setTurn] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `turn` is the trigger
  useEffect(() => {
    const controller = new AbortController();
    const once = () =>
      read(controller.signal)
        .then((answer) => {
          if (!controller.signal.aborted) {
            setValue(answer);
            setFailed(undefined);
          }
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) {
            setFailed(failure);
          }
        });
    void once();
    const timer = everyMs === undefined ? undefined : setInterval(() => void once(), everyMs);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [read, everyMs, turn]);
  return { value, failed, again: () => setTurn((current) => current + 1) };
}

/** What a session's events say to whoever puts something at the conversation's foot. */
interface SessionRead {
  readonly events: readonly RestTranscriptEvent[];
  /**
   * The number of the last signal the session's events say the agent took; nothing where the
   * events read, and a few steps before them, say none.
   */
  readonly taken: number | undefined;
}

/**
 * The events of one session: its last ones first, the ones before on asking, and what is
 * appended as it happens while the session is open.
 */
function SessionTranscript(props: {
  readonly client: ConsoleClient;
  readonly handle: string;
  readonly session: RestAgentSession;
  /** The account, whose picture stands beside what it said. */
  readonly agent: RestAgent["person"];
  /** The account's record of signals, where the page around reads it: read here where it does not. */
  readonly signals?: readonly RestSignal[] | undefined;
  /** What stands at the conversation's foot, from what the session's events say. */
  readonly foot?: ((read: SessionRead) => ReactNode) | undefined;
  /** Told when the console says the session is over. */
  readonly onEnded?: (() => void) | undefined;
}) {
  const words = useWords().agents.page.live;
  const { client, handle, session, onEnded } = props;
  const given = props.signals;
  const own = given === undefined;
  // The files that came with the signals the session was sent: what is no picture is offered to
  // save from the signal's own address, which the account's record names.
  const readSignals = useCallback(
    (signal: AbortSignal) =>
      own ? client.signals(handle, { limit: 100 }, signal) : Promise.resolve(undefined),
    [client, handle, own],
  );
  const read = useRead(readSignals, own && session.ended === null ? REFRESH_MS : undefined);
  const sent = given ?? read.value?.items;
  const filesOf = (number: number) => sent?.find((one) => one.number === number)?.attachments;
  const [events, setEvents] = useState<readonly RestTranscriptEvent[]>([]);
  const [from, setFrom] = useState(0);
  const [problem, setProblem] = useState(false);
  const [live, setLive] = useState(false);
  /** The last signal taken before the events read, once looked for: `0` where a few steps back say none. */
  const [before, setBefore] = useState<number | undefined>(undefined);
  const last = useRef(0);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const open = session.ended === null;
  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | undefined;
    const after = Math.max(0, session.events - TAIL);
    setEvents([]);
    setFrom(after);
    setProblem(false);
    setLive(false);
    setBefore(undefined);
    last.current = after;
    const append = (items: readonly RestTranscriptEvent[]) => {
      const fresh = items.filter((item) => item.n > last.current);
      if (fresh.length > 0) {
        last.current = fresh.at(-1)?.n ?? last.current;
        setEvents((current) => [...current, ...fresh]);
      }
    };
    const run = async () => {
      // Page after page until what is there now is read.
      for (;;) {
        const page = await client.transcript(
          handle,
          session.id,
          { after: last.current, limit: 500 },
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        append(page.items);
        if (!page.more) {
          break;
        }
      }
      if (!open || typeof EventSource === "undefined") {
        return;
      }
      source = new EventSource(client.transcriptStreamUrl(handle, session.id, last.current));
      source.onopen = () => setLive(true);
      source.onerror = () => setLive(false);
      source.addEventListener("event", (message) => {
        try {
          const parsed = restTranscriptEventSchema.safeParse(JSON.parse(String(message.data)));
          if (parsed.success) {
            append([parsed.data]);
          }
        } catch {
          // What does not read as an event is left out.
        }
      });
      source.addEventListener("end", (message) => {
        source?.close();
        setLive(false);
        try {
          if (restAgentSessionSchema.safeParse(JSON.parse(String(message.data))).success) {
            ended.current?.();
          }
        } catch {
          ended.current?.();
        }
      });
    };
    run().catch(() => {
      if (!controller.signal.aborted) {
        setProblem(true);
      }
    });
    return () => {
      controller.abort();
      source?.close();
    };
  }, [client, handle, session.id, session.events, open]);
  // Which of the words sent still wait is read off the last signal the agent took. Where the
  // events read hold none, a long turn since the last word say, the ones before are read a few
  // steps back for it, and not shown.
  const known = takenOf(events);
  const looks = props.foot !== undefined && open && known === undefined && from > 0;
  useEffect(() => {
    if (!looks || before !== undefined) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      let upTo = from;
      for (let step = 0; step < LOOK_BACK_STEPS && upTo > 0; step += 1) {
        const after = Math.max(0, upTo - TAIL);
        const page = await client.transcript(
          handle,
          session.id,
          { after, limit: upTo - after },
          controller.signal,
        );
        const found = takenOf(page.items);
        if (found !== undefined) {
          setBefore(found);
          return;
        }
        upTo = after;
      }
      setBefore(0);
    })().catch(() => undefined);
    return () => controller.abort();
  }, [looks, before, from, client, handle, session.id]);
  const earlier = () => {
    const after = Math.max(0, from - TAIL);
    void client
      .transcript(handle, session.id, { after, limit: from - after })
      .then((page) => {
        setEvents((current) => [...page.items.filter((item) => item.n <= from), ...current]);
        setFrom(after);
      })
      .catch(() => setProblem(true));
  };
  const taken = known ?? (before !== undefined && before > 0 ? before : undefined);
  return (
    <section className="sc-agent-transcript" aria-label={words.transcript}>
      {session.away && <Callout tone="warning">{words.away}</Callout>}
      {problem && <Callout tone="danger">{words.couldNotLoad}</Callout>}
      {open && !live && typeof EventSource === "undefined" && (
        <p className="sc-field-hint">{words.notLive}</p>
      )}
      {from > 0 && (
        <Button variant="ghost" size="sm" onClick={earlier}>
          {words.earlier}
        </Button>
      )}
      <TranscriptView
        events={events}
        agent={props.agent}
        fileHref={(fileId) => client.transcriptFileUrl(handle, session.id, fileId)}
        signalFiles={filesOf}
        signalFileHref={(number, fileId) => client.signalFileUrl(handle, number, fileId)}
        onReadWhole={async (n) => (await client.transcriptText(handle, session.id, n)).text}
        empty={session.away ? null : <p className="sc-field-hint">{words.empty}</p>}
        foot={props.foot?.({ events, taken })}
      />
    </section>
  );
}

/**
 * What the provider an account signs in through is called: the one of the deployment's whose
 * logins the account's is shaped as, an address at Google, a name at the git host.
 */
export function providerOf(login: string, providers: readonly RestProvider[]): string {
  return (
    providers.find((one) => isLoginAt(one.key, login))?.label ??
    (login.includes("@") ? "Google" : "GitHub")
  );
}

/**
 * An agent account's way onto a machine, for a supervisor: its invitation, read and made here,
 * and, until its runner was heard from, the steps from an account just added to one at work.
 */
function AgentStart(props: {
  readonly client: ConsoleClient;
  readonly agent: RestAgent;
  readonly handle: string;
  /** Whether the console is held through a token, which reads no sign-in. */
  readonly viaToken: boolean;
  /** What the provider the account signs in through is called. */
  readonly provider: string;
}) {
  const { client, agent, handle, viaToken } = props;
  const { busy, error, act } = useAction();
  const readInvitation = useCallback(
    (signal: AbortSignal) => client.agentInvitation(handle, signal),
    [client, handle],
  );
  const invitation = useRead(readInvitation);
  // The invitation just made: its code is shown this once, and is gone with the page.
  const [made, setMade] = useState<RestAgentInvitationMade | undefined>(undefined);
  const heard = agent.state !== null && agent.state !== undefined;
  const readSignIns = useCallback(
    (signal: AbortSignal) =>
      viaToken || heard ? Promise.resolve(undefined) : client.agentSignIns(handle, signal),
    [client, handle, viaToken, heard],
  );
  const signIns = useRead(readSignIns, heard ? undefined : REFRESH_MS);
  const standing = invitation.failed === undefined ? invitation.value?.invitation : null;
  const panel = (
    <AgentInvitationPanel
      invitation={standing}
      made={made}
      intro={heard}
      guideHref={setupHref}
      busy={busy}
      onInvite={() =>
        void act(async () => {
          setMade(await client.inviteAgent(handle));
          invitation.again();
        })
      }
      onRevoke={() =>
        void act(async () => {
          await client.revokeAgentInvitation(handle);
          setMade(undefined);
          invitation.again();
        })
      }
    />
  );
  return (
    <>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {heard ? (
        panel
      ) : (
        <AgentStartSteps
          login={agent.person.login}
          provider={props.provider}
          signedIn={agent.person.invited !== true}
          invited={made !== undefined || (standing !== null && standing !== undefined)}
          onMachine={(signIns.value?.items ?? []).some((one) => one.kind === "command")}
          heard={heard}
          invitation={panel}
        />
      )}
    </>
  );
}

/** What the agent is doing now, and what its supervisor says to it. */
function AgentLive(props: {
  readonly client: ConsoleClient;
  readonly agent: RestAgent;
  readonly handle: string;
  /** Whether the console is held through a token, which reads no sign-in. */
  readonly viaToken: boolean;
  /** What the provider the account signs in through is called. */
  readonly provider: string;
  readonly onChanged: () => void;
}) {
  const words = useWords().agents.page;
  const { client, agent, handle, onChanged } = props;
  const { busy, error, act } = useAction();
  const [note, setNote] = useState<string | undefined>(undefined);
  /** Counts what was said here: the pane goes to its end with each. */
  const [said, setSaid] = useState(0);
  const read = useCallback(
    (signal: AbortSignal) => client.agentSessions(handle, { limit: 1 }, signal),
    [client, handle],
  );
  const sessions = useRead(read, REFRESH_MS);
  const session = sessions.value?.items[0];
  const heard = agent.state !== null && agent.state !== undefined;
  // The account's record of signals: what was told and not taken yet stands at the
  // conversation's foot, and the files of a signal are named there.
  const readSignals = useCallback(
    (signal: AbortSignal) =>
      heard ? client.signals(handle, { limit: 100 }, signal) : Promise.resolve(undefined),
    [client, handle, heard],
  );
  const record = useRead(readSignals, heard ? REFRESH_MS : undefined);
  const signals = record.value?.items;
  const state = agent.state?.state;
  const delivered = agent.runner?.delivered ?? 0;
  const send = (kind: "stop" | "restart" | "reset", text: string) =>
    void act(async () => {
      const sent = await client.sendSignal(handle, {
        kind,
        ...(text.length === 0 ? {} : { text }),
      });
      setNote(words.tell.sent(sent.number, sent.kind));
      onChanged();
      sessions.again();
      record.again();
    });
  /** The rows at the conversation's foot: what waits to be taken, and the sign that the agent is at work. */
  const foot = (events: readonly RestTranscriptEvent[], taken: number | undefined): ReactNode => {
    const open = session !== undefined && session.ended === null;
    const working = open && state === "running" ? workingOf(events) : undefined;
    // Signals are taken in order: everything up to the last one the record says was taken is.
    // Where the record says none, what the runner was handed counts as taken.
    const floor = open ? (taken ?? delivered) : Math.max(taken ?? 0, delivered);
    const waiting = waitingOf(signals ?? [], floor);
    const why =
      state === "stopped"
        ? "stopped"
        : state === "unheard"
          ? "unheard"
          : working === undefined
            ? "soon"
            : agent.runner?.offers?.steer === false
              ? "turn"
              : "call";
    return (
      <>
        <TalkWorking working={working} agent={agent.person} />
        <TalkWaiting
          signals={waiting}
          why={why}
          fileHref={(number, fileId) => client.signalFileUrl(handle, number, fileId)}
          busy={busy}
          onInterrupt={
            working === undefined
              ? undefined
              : () =>
                  void act(async () => {
                    await client.sendSignal(handle, { kind: "interrupt" });
                    record.again();
                  })
          }
        />
      </>
    );
  };
  const composer = (
    <SignalComposer
      state={state}
      images={agent.runner?.offers?.images}
      busy={busy}
      note={
        error === undefined ? undefined : (
          <span className="sc-form-error" role="alert">
            {error}
          </span>
        )
      }
      onSend={(text, pictures) =>
        void act(async () => {
          await client.sendSignal(handle, { kind: "tell", text }, pictures);
          setSaid((count) => count + 1);
          record.again();
          onChanged();
          sessions.again();
        })
      }
    />
  );
  return (
    <div className="sc-agent-live">
      <div className="sc-agent-live-main">
        {sessions.value === undefined ? (
          sessions.failed === undefined ? (
            <div className="sc-loading">
              <Spinner label={words.loading} />
            </div>
          ) : (
            <Callout tone="danger">{words.live.couldNotLoad}</Callout>
          )
        ) : !heard ? (
          // An account no runner has spoken for has no session to show and is told nothing yet:
          // what stands between it and its first one is shown in its place.
          <section className="sc-panel" aria-label={words.start.title}>
            <h2 className="sc-section-title">{words.start.title}</h2>
            <p className="sc-field-hint">{words.start.intro}</p>
            <AgentStart
              client={client}
              agent={agent}
              handle={handle}
              viaToken={props.viaToken}
              provider={props.provider}
            />
          </section>
        ) : (
          <ChatPane label={words.live.transcript} composer={composer} said={said}>
            {session === undefined ? (
              <TranscriptView
                events={[]}
                fileHref={() => ""}
                empty={
                  <EmptyState title={words.live.noSession.title} body={words.live.noSession.body} />
                }
                foot={foot([], undefined)}
              />
            ) : (
              <>
                {session.ended !== null && (
                  <p className="sc-field-hint sc-agent-live-lead">{words.live.last}</p>
                )}
                <SessionTranscript
                  client={client}
                  handle={handle}
                  session={session}
                  agent={agent.person}
                  signals={signals ?? []}
                  foot={({ events, taken }) => foot(events, taken)}
                  onEnded={() => {
                    sessions.again();
                    onChanged();
                  }}
                />
              </>
            )}
          </ChatPane>
        )}
      </div>
      <aside className="sc-agent-live-side">
        {session !== undefined && (
          <section className="sc-panel" aria-label={words.live.now}>
            <h2 className="sc-section-title">{words.live.now}</h2>
            <AgentSessionList
              sessions={[session]}
              href={(one) => agentHref(handle, "sessions", one.id)}
            />
          </section>
        )}
        {heard && (
          <section className="sc-panel" aria-label={words.controls.title}>
            <h2 className="sc-section-title">{words.controls.title}</h2>
            <AgentControls state={state} busy={busy} onSend={send} note={note} />
          </section>
        )}
        <section className="sc-panel" aria-label={words.choice.title}>
          <h2 className="sc-section-title">{words.choice.title}</h2>
          <AgentChoice
            runner={agent.runner}
            busy={busy}
            onSet={(choice) =>
              void act(async () => {
                const sent = await client.sendSignal(handle, { kind: "set", set: choice });
                setNote(words.tell.sent(sent.number, sent.kind));
                onChanged();
              })
            }
          />
        </section>
      </aside>
    </div>
  );
}

/** The agent's sessions, the newest first; or one of them, read whole. */
function AgentSessions(props: {
  readonly client: ConsoleClient;
  readonly handle: string;
  readonly session: string | undefined;
  /** The account, whose picture stands beside what it said. */
  readonly agent: RestAgent["person"];
}) {
  const words = useWords().agents.page;
  const { client, handle, session } = props;
  const [older, setOlder] = useState<readonly RestAgentSession[]>([]);
  const [more, setMore] = useState<boolean | undefined>(undefined);
  const read = useCallback(
    async (signal: AbortSignal) =>
      session === undefined
        ? { list: await client.agentSessions(handle, {}, signal), one: undefined }
        : { list: undefined, one: await client.agentSession(handle, session, signal) },
    [client, handle, session],
  );
  const found = useRead(read);
  if (found.value === undefined) {
    return found.failed === undefined ? (
      <div className="sc-loading">
        <Spinner label={words.loading} />
      </div>
    ) : (
      <Callout tone="danger">{words.live.couldNotLoad}</Callout>
    );
  }
  if (found.value.one !== undefined) {
    return (
      <>
        <nav className="sc-doc-crumbs sc-agent-crumbs" aria-label={words.sessions.title}>
          <a href={agentHref(handle, "sessions")}>{words.sessions.back}</a>
        </nav>
        <div className="sc-panel sc-agent-session-panel">
          <AgentSessionList
            sessions={[found.value.one]}
            href={() => agentHref(handle, "sessions", session)}
          />
        </div>
        <SessionTranscript
          client={client}
          handle={handle}
          session={found.value.one}
          agent={props.agent}
          onEnded={found.again}
        />
      </>
    );
  }
  const first = found.value.list?.items ?? [];
  const all = [...first, ...older];
  const hasMore = more ?? found.value.list?.more ?? false;
  const earlier = () => {
    const before = all.at(-1)?.startedAt;
    void client
      .agentSessions(handle, { before })
      .then((page) => {
        setOlder((current) => [...current, ...page.items]);
        setMore(page.more);
      })
      .catch(() => setMore(false));
  };
  return (
    <>
      {all.length === 0 ? (
        <EmptyState title={words.sessions.empty.title} body={words.sessions.empty.body} />
      ) : (
        <div className="sc-panel sc-agent-session-panel">
          <AgentSessionList sessions={all} href={(one) => agentHref(handle, "sessions", one.id)} />
          {hasMore && (
            <Button variant="ghost" size="sm" onClick={earlier}>
              {words.sessions.more}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** What is kept of the agent: its runner, where it is signed in, what it runs with, its secrets by name, its persona. */
function AgentSettings(props: {
  readonly client: ConsoleClient;
  readonly agent: RestAgent;
  readonly handle: string;
  /** Whether the console is held through a token, which reads no sign-in. */
  readonly viaToken: boolean;
  /** What the provider the account signs in through is called. */
  readonly provider: string;
  readonly onChanged: () => void;
}) {
  const words = useWords();
  const page = words.agents.page;
  const { client, agent, handle, viaToken, onChanged } = props;
  const { busy, error, act } = useAction();
  const readSecrets = useCallback(
    (signal: AbortSignal) => client.agentSecrets(handle, signal),
    [client, handle],
  );
  const secrets = useRead(readSecrets);
  const readSignIns = useCallback(
    (signal: AbortSignal) =>
      viaToken ? Promise.resolve(undefined) : client.agentSignIns(handle, signal),
    [client, handle, viaToken],
  );
  const signIns = useRead(readSignIns);
  const [name, setName] = useState(agent.person.name ?? "");
  const [role, setRole] = useState(agent.person.title ?? "");
  const [dayStart, setDayStart] = useState(agent.hours?.dayStart ?? "");
  const [dayEnd, setDayEnd] = useState(agent.hours?.dayEnd ?? "");
  const hoursUnchanged =
    dayStart === (agent.hours?.dayStart ?? "") && dayEnd === (agent.hours?.dayEnd ?? "");
  const saveHours = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await client.updateAgent(handle, {
        dayStart: dayStart.length === 0 ? null : dayStart,
        dayEnd: dayEnd.length === 0 ? null : dayEnd,
      });
      onChanged();
    });
  };
  const kept: readonly RestAgentSecret[] = secrets.value?.items ?? [];
  const where: readonly RestSession[] = signIns.value?.items ?? [];
  const savePersona = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await client.updateAgent(handle, {
        ...(name.trim() === (agent.person.name ?? "") ? {} : { name: name.trim() }),
        ...(role.trim() === (agent.person.title ?? "")
          ? {}
          : { title: role.trim().length === 0 ? null : role.trim() }),
      });
      onChanged();
    });
  };
  const unchanged =
    name.trim() === (agent.person.name ?? "") && role.trim() === (agent.person.title ?? "");
  // Two columns where there is room: who the agent is, when it works and where it is signed in at
  // the left, how it runs and what it holds at the right; one column, in that order, where not.
  return (
    <div className="sc-agent-settings">
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      <div className="sc-agent-settings-column">
        <section className="sc-panel" aria-label={page.settings.persona.title}>
          <h2 className="sc-section-title">{page.settings.persona.title}</h2>
          <AgentPictureSave person={agent.person} busy={busy} />
          <dl className="sc-person-facts sc-agent-runner-facts">
            <div className="sc-person-fact">
              <dt>{words.agents.accounts.login}</dt>
              <dd>
                {agent.person.login} · {props.provider}
              </dd>
            </div>
          </dl>
          <form className="sc-agent-persona" onSubmit={savePersona}>
            <label className="sc-field">
              <span className="sc-field-label">{page.settings.persona.name}</span>
              <input
                className="sc-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="sc-field">
              <span className="sc-field-label">{page.settings.persona.role}</span>
              <input
                className="sc-input"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || unchanged || name.trim().length === 0}>
              {page.settings.persona.save}
            </Button>
          </form>
        </section>
        <section className="sc-panel" aria-label={page.settings.hours.title}>
          <h2 className="sc-section-title">{page.settings.hours.title}</h2>
          <form className="sc-agent-persona" onSubmit={saveHours}>
            <label className="sc-field">
              <span className="sc-field-label">{page.settings.hours.start}</span>
              <input
                className="sc-input"
                type="time"
                value={dayStart}
                onChange={(event) => setDayStart(event.target.value)}
              />
            </label>
            <label className="sc-field">
              <span className="sc-field-label">{page.settings.hours.end}</span>
              <input
                className="sc-input"
                type="time"
                value={dayEnd}
                onChange={(event) => setDayEnd(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || hoursUnchanged}>
              {page.settings.hours.save}
            </Button>
          </form>
          <p className="sc-field-hint">{page.settings.hours.intro}</p>
        </section>
        <section className="sc-panel" aria-label={page.settings.elsewhere.title}>
          <h2 className="sc-section-title">{page.settings.elsewhere.title}</h2>
          <AgentElsewhereList accounts={agent.accounts} />
        </section>
        <section className="sc-panel" aria-label={page.settings.signIns.title}>
          <h2 className="sc-section-title">{page.settings.signIns.title}</h2>
          {viaToken || signIns.failed !== undefined ? (
            <p className="sc-field-hint">{page.settings.signIns.couldNotLoad}</p>
          ) : where.length === 0 ? (
            <p className="sc-field-hint">{page.settings.signIns.empty}</p>
          ) : (
            <ul className="sc-agent-secret-list">
              {where.map((one) => (
                <li key={one.id} className="sc-agent-secret">
                  <span>
                    {one.kind === "command"
                      ? words.sessions.command(one.name ?? "")
                      : one.browser !== null && one.platform !== null
                        ? words.sessions.on(one.browser, one.platform)
                        : (one.browser ?? one.platform ?? words.sessions.unknownBrowser)}
                  </span>
                  <span className="sc-muted">
                    <Time iso={one.lastSeenAt} />
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await client.endAgentSignIn(handle, one.id);
                        signIns.again();
                      })
                    }
                  >
                    {words.sessions.end}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="sc-agent-settings-column">
        <section className="sc-panel" aria-label={page.settings.runner.title}>
          <h2 className="sc-section-title">{page.settings.runner.title}</h2>
          <AgentRunnerFacts runner={agent.runner} />
          <AgentChoice
            runner={agent.runner}
            busy={busy}
            onSet={(choice) =>
              void act(async () => {
                await client.sendSignal(handle, { kind: "set", set: choice });
                onChanged();
              })
            }
          />
        </section>
        <section className="sc-panel" aria-label={page.settings.machine.title}>
          <h2 className="sc-section-title">
            {agent.state === null || agent.state === undefined
              ? page.start.title
              : page.settings.machine.title}
          </h2>
          <AgentStart
            client={client}
            agent={agent}
            handle={handle}
            viaToken={viaToken}
            provider={props.provider}
          />
        </section>
        <section className="sc-panel" aria-label={page.settings.secrets.title}>
          <h2 className="sc-section-title">{page.settings.secrets.title}</h2>
          <AgentSecretList
            secrets={kept}
            busy={busy}
            onSeed={(secret, value) =>
              void act(async () => {
                await client.seedAgentSecret(handle, secret, { value });
                secrets.again();
              })
            }
            onRemove={(secret) =>
              void act(async () => {
                await client.removeAgentSecret(handle, secret);
                secrets.again();
              })
            }
          />
        </section>
      </div>
    </div>
  );
}

export interface AgentPageProps {
  readonly handle: string;
  readonly tab: AgentTab;
  readonly session: string | undefined;
  readonly client: ConsoleClient;
  /** Whether the console is held through a token: such a console reads no sign-in. */
  readonly viaToken: boolean;
  /** The providers people sign in through here, by which an account's login is said to be at one. */
  readonly providers?: readonly RestProvider[] | undefined;
  /** The agent's plate, which the console draws as it draws a person's. */
  readonly work: (agent: RestAgent) => ReactNode;
}

/**
 * What a view of an agent's page shows to whoever opens it: its work to anyone who sees the
 * account, and the rest, what it is doing, its sessions and what is kept of it, its picture and
 * the names of its secrets among them, to its supervisors alone. Whoever only sees the account
 * and opens its page, from the people's list say, is shown its work, which is theirs to read;
 * a view named in an address that is not theirs to open says so.
 */
export function agentViewOf(tab: AgentTab, supervised: boolean): AgentTab | "closed" {
  if (supervised || tab === "work") {
    return tab;
  }
  return tab === "live" ? "work" : "closed";
}

export function AgentPage(props: AgentPageProps) {
  const all = useWords();
  const words = all.agents.page;
  const { handle, tab, client } = props;
  const read = useCallback((signal: AbortSignal) => client.agent(handle, signal), [client, handle]);
  const found = useRead(read, REFRESH_MS);
  const agent = found.value;
  if (agent === undefined) {
    if (found.failed === undefined) {
      return (
        <div className="sc-loading">
          <Spinner label={words.loading} />
        </div>
      );
    }
    const gone = found.failed instanceof ApiError && found.failed.status === 404;
    return (
      <EmptyState
        title={gone ? words.notFound.title : words.live.couldNotLoad}
        body={gone ? words.notFound.body : undefined}
        action={<LinkButton href={PATHS.agents}>{all.nav.agents}</LinkButton>}
      />
    );
  }
  const { person } = agent;
  const labels: Readonly<Record<AgentTab, string>> = words.tabs;
  const provider = providerOf(person.login, props.providers ?? []);
  const view = agentViewOf(tab, agent.supervised);
  return (
    <>
      <header className="sc-panel sc-agent-header">
        <div className="sc-agent-head">
          <Avatar person={person} size="xl" />
          <div className="sc-agent-head-who">
            <div className="sc-agent-head-name">
              <h1 className="sc-page-title">{personName(person)}</h1>
              <span className="sc-muted">@{person.handle}</span>
            </div>
            {(person.title ?? "") !== "" && <p className="sc-lead">{person.title}</p>}
            <AgentStateBadge state={agent.state} full />
          </div>
          <dl className="sc-facts-row sc-agent-head-facts">
            <div>
              <dt>{all.people.manager}</dt>
              <dd>
                {agent.manager === null ? (
                  <span className="sc-muted">{all.agents.accounts.managerUnseen}</span>
                ) : (
                  <PersonChip person={agent.manager} />
                )}
              </dd>
            </div>
          </dl>
        </div>
      </header>
      {/* Whoever only sees the account reads its plate, and is offered no view they cannot open. */}
      {agent.supervised && (
        <nav className="sc-subtabs sc-agent-views" aria-label={words.tabs.aria}>
          {TABS.map((one) => (
            <a
              key={one}
              className={cx("sc-tab", one === tab && "sc-tab-current")}
              href={agentHref(handle, one)}
              aria-current={one === tab ? "page" : undefined}
            >
              {labels[one]}
            </a>
          ))}
        </nav>
      )}
      {view === "work" ? (
        props.work(agent)
      ) : view === "closed" ? (
        <EmptyState title={words.notSupervised.title} body={words.notSupervised.body} />
      ) : view === "live" ? (
        <AgentLive
          client={client}
          agent={agent}
          handle={handle}
          viaToken={props.viaToken}
          provider={provider}
          onChanged={found.again}
        />
      ) : view === "sessions" ? (
        <AgentSessions
          client={client}
          handle={handle}
          session={props.session}
          agent={agent.person}
        />
      ) : (
        <AgentSettings
          client={client}
          agent={agent}
          handle={handle}
          viaToken={props.viaToken}
          provider={provider}
          onChanged={found.again}
        />
      )}
    </>
  );
}

/**
 * The agents that report to a person and are not running, on that person's plate: each with how
 * it stands and the way to its page, so that whoever manages several is told once where to look.
 */
export function AgentsNeedingYou(props: {
  readonly agents: readonly RestAgent[];
  readonly me: string | undefined;
}) {
  const words = useWords().agents.needYou;
  const waiting = props.agents.filter(
    (agent) =>
      agent.manager?.id === props.me &&
      agent.person.status === "active" &&
      agent.state !== null &&
      agent.state !== undefined &&
      agent.state.state !== "running",
  );
  if (props.me === undefined || waiting.length === 0) {
    return null;
  }
  return (
    <section className="sc-panel sc-agents-need-you" aria-label={words.title}>
      <h2 className="sc-section-title">{words.title}</h2>
      <p className="sc-field-hint">{words.intro}</p>
      <ul className="sc-agent-secret-list">
        {waiting.map((agent) => (
          <li key={agent.person.id} className="sc-agent-secret">
            <a className="sc-agent-need-link" href={agentHref(agent.person.handle ?? "")}>
              <Avatar person={agent.person} size="sm" />
              {personName(agent.person)}
            </a>
            <AgentStateBadge state={agent.state} full />
          </li>
        ))}
      </ul>
    </section>
  );
}
