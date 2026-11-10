import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  type ConsoleClient,
  describeService,
  type RestAgent,
  type RestAgentInvitationMade,
  type RestAgentSecret,
  type RestAgentSession,
  type RestSession,
  type RestTranscriptEvent,
  type RestWorkspace,
  restAgentSessionSchema,
  restTranscriptEventSchema,
  serviceNamesOf,
} from "./api.js";
import {
  AgentChoice,
  AgentElsewhereList,
  AgentRunnerFacts,
  AgentSecretList,
  AgentSessionList,
  AgentStateBadge,
  SignalComposer,
  TranscriptView,
} from "./components/agent-page.js";
import { AgentInvitationPanel } from "./components/setup.js";
import {
  Avatar,
  Button,
  Callout,
  cx,
  EmptyState,
  LinkButton,
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

const TABS: readonly AgentTab[] = ["live", "sessions", "work", "settings"];

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

/**
 * The events of one session: its last ones first, the ones before on asking, and what is
 * appended as it happens while the session is open.
 */
function SessionTranscript(props: {
  readonly client: ConsoleClient;
  readonly handle: string;
  readonly session: RestAgentSession;
  /** Told when the console says the session is over. */
  readonly onEnded?: (() => void) | undefined;
}) {
  const words = useWords().agents.page.live;
  const { client, handle, session, onEnded } = props;
  const [events, setEvents] = useState<readonly RestTranscriptEvent[]>([]);
  const [from, setFrom] = useState(0);
  const [problem, setProblem] = useState(false);
  const [live, setLive] = useState(false);
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
        fileHref={(fileId) => client.transcriptFileUrl(handle, session.id, fileId)}
        onReadWhole={async (n) => (await client.transcriptText(handle, session.id, n)).text}
        empty={session.away ? null : <p className="sc-field-hint">{words.empty}</p>}
      />
    </section>
  );
}

/** What the agent is doing now, and what its supervisor says to it. */
function AgentLive(props: {
  readonly client: ConsoleClient;
  readonly agent: RestAgent;
  readonly handle: string;
  readonly onChanged: () => void;
}) {
  const words = useWords().agents.page;
  const { client, agent, handle, onChanged } = props;
  const { busy, error, act } = useAction();
  const [note, setNote] = useState<string | undefined>(undefined);
  const read = useCallback(
    (signal: AbortSignal) => client.agentSessions(handle, { limit: 1 }, signal),
    [client, handle],
  );
  const sessions = useRead(read, REFRESH_MS);
  const session = sessions.value?.items[0];
  return (
    <>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      <SignalComposer
        state={agent.state?.state}
        busy={busy}
        note={note}
        onSend={(kind, text, pictures) =>
          void act(async () => {
            const sent = await client.sendSignal(
              handle,
              { kind, ...(text.length === 0 ? {} : { text }) },
              pictures,
            );
            setNote(words.tell.sent(sent.number, sent.kind));
            onChanged();
            sessions.again();
          })
        }
      />
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
      {sessions.value === undefined ? (
        sessions.failed === undefined ? (
          <div className="sc-loading">
            <Spinner label={words.loading} />
          </div>
        ) : (
          <Callout tone="danger">{words.live.couldNotLoad}</Callout>
        )
      ) : session === undefined ? (
        <EmptyState title={words.live.noSession.title} body={words.live.noSession.body} />
      ) : (
        <>
          <p className="sc-lead">{session.ended === null ? words.live.open : words.live.last}</p>
          <SessionTranscript
            client={client}
            handle={handle}
            session={session}
            onEnded={() => {
              sessions.again();
              onChanged();
            }}
          />
        </>
      )}
    </>
  );
}

/** The agent's sessions, the newest first; or one of them, read whole. */
function AgentSessions(props: {
  readonly client: ConsoleClient;
  readonly handle: string;
  readonly session: string | undefined;
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
        <div className="sc-section-head">
          <AgentSessionList
            sessions={[found.value.one]}
            href={() => agentHref(handle, "sessions", session)}
          />
          <LinkButton href={agentHref(handle, "sessions")}>{words.sessions.back}</LinkButton>
        </div>
        <SessionTranscript
          client={client}
          handle={handle}
          session={found.value.one}
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
      <AgentSessionList
        sessions={all}
        href={(one) => agentHref(handle, "sessions", one.id)}
        empty={<EmptyState title={words.sessions.empty.title} body={words.sessions.empty.body} />}
      />
      {hasMore && (
        <Button variant="ghost" onClick={earlier}>
          {words.sessions.more}
        </Button>
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
  /** The workspace's names and services, in whose words the first step of a setup is said. */
  readonly workspace: Pick<RestWorkspace, "handle" | "domain" | "services"> | undefined;
  readonly onChanged: () => void;
}) {
  const words = useWords();
  const page = words.agents.page;
  const { client, agent, handle, viaToken, workspace, onChanged } = props;
  const { busy, error, act } = useAction();
  const readInvitation = useCallback(
    (signal: AbortSignal) => client.agentInvitation(handle, signal),
    [client, handle],
  );
  const invitation = useRead(readInvitation);
  // The invitation just made: its code is shown this once, and is gone with the page.
  const [made, setMade] = useState<RestAgentInvitationMade | undefined>(undefined);
  const first = useMemo(() => {
    const identity = workspace?.services?.identity;
    return workspace === undefined || identity === undefined
      ? []
      : describeService("identity", identity, serviceNamesOf(workspace, handle)).guide;
  }, [workspace, handle]);
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
  return (
    <div className="sc-agent-settings">
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      <section className="sc-panel" aria-label={page.settings.runner.title}>
        <h2 className="sc-section-title">{page.settings.runner.title}</h2>
        <AgentRunnerFacts runner={agent.runner} />
        <h3 className="sc-field-label sc-agent-settings-sub">{page.choice.title}</h3>
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
        <h2 className="sc-section-title">{page.settings.machine.title}</h2>
        <AgentInvitationPanel
          invitation={invitation.failed === undefined ? invitation.value?.invitation : null}
          made={made}
          first={first}
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
      <section className="sc-panel" aria-label={page.settings.elsewhere.title}>
        <h2 className="sc-section-title">{page.settings.elsewhere.title}</h2>
        <AgentElsewhereList accounts={agent.accounts} />
      </section>
      <section className="sc-panel" aria-label={page.settings.persona.title}>
        <h2 className="sc-section-title">{page.settings.persona.title}</h2>
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
  /** The workspace's names and services, in whose words the first step of a setup is said. */
  readonly workspace?: Pick<RestWorkspace, "handle" | "domain" | "services"> | undefined;
  /** The agent's plate, which the console draws as it draws a person's. */
  readonly work: (agent: RestAgent) => ReactNode;
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
  return (
    <>
      <div className="sc-page-head sc-agent-head">
        <Avatar person={person} size="lg" />
        <div className="sc-agent-head-who">
          <h1 className="sc-page-title">{personName(person)}</h1>
          <p className="sc-lead">
            @{person.handle}
            {(person.title ?? "") !== "" && ` · ${person.title}`}
          </p>
          <AgentStateBadge state={agent.state} full />
        </div>
      </div>
      <nav className="sc-subtabs sc-agent-tabs" aria-label={words.tabs.aria}>
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
      {tab === "work" ? (
        props.work(agent)
      ) : !agent.supervised ? (
        <EmptyState title={words.notSupervised.title} body={words.notSupervised.body} />
      ) : tab === "live" ? (
        <AgentLive client={client} agent={agent} handle={handle} onChanged={found.again} />
      ) : tab === "sessions" ? (
        <AgentSessions client={client} handle={handle} session={props.session} />
      ) : (
        <AgentSettings
          client={client}
          agent={agent}
          handle={handle}
          viaToken={props.viaToken}
          workspace={props.workspace}
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
