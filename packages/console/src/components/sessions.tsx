import type { ReactNode } from "react";
import type { RestSession } from "../api.js";
import { useWords } from "../i18n/index.js";
import { Badge, Button, cx, Time } from "./ui.js";

// The browsers a person is signed in on (board #309), on a page of the settings of their own: each
// with what it is, when it was last used, where it last came from and the day it signed in, the
// one they look from marked; the way to sign any other out, and all the others at once. Takes its
// data as props and nothing from the network.

export interface SessionListProps {
  readonly sessions: readonly RestSession[];
  /** How many days a session lasts without being used; left out, the page does not say. */
  readonly idleDays?: number | undefined;
  /** Called to end a session that is not the current one. Left out, sessions cannot be ended here. */
  readonly onEnd?: ((session: RestSession) => void) | undefined;
  /** Called to end every session but the current one. Left out, there is no such button. */
  readonly onEndOthers?: (() => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly empty?: ReactNode;
}

/** The platforms held in a hand, as the server names them: drawn as a phone, the rest as a screen. */
const HANDHELD: ReadonlySet<string> = new Set(["iOS", "Android"]);

function DeviceIcon(props: { readonly handheld: boolean }) {
  return (
    <span className="sc-session-icon">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        {props.handheld ? (
          <>
            <rect x="5.5" y="2.5" width="9" height="15" rx="2" />
            <path d="M9 14.75h2" />
          </>
        ) : (
          <>
            <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
            <path d="M7 16.5h6M10 13.5v3" />
          </>
        )}
      </svg>
    </span>
  );
}

export function SessionList(props: SessionListProps) {
  const words = useWords().sessions;
  const others = props.sessions.filter((session) => !session.current);
  const deviceOf = (session: RestSession): string =>
    // The command signed in as the account itself (ADR-0084), by what it called itself.
    session.kind === "command"
      ? words.command(session.name ?? "")
      : session.browser !== null && session.platform !== null
        ? words.on(session.browser, session.platform)
        : (session.browser ?? session.platform ?? words.unknownBrowser);
  return (
    <section className="sc-panel sc-sessions" aria-label={words.title}>
      <div className="sc-section-head">
        <h2 className="sc-section-title">{words.title}</h2>
        {props.onEndOthers !== undefined && others.length > 0 && (
          <Button size="sm" disabled={props.busy} onClick={props.onEndOthers}>
            {words.endOthers}
          </Button>
        )}
      </div>
      <p className="sc-settings-hint">
        {props.idleDays === undefined ? words.intro : words.introIdle(String(props.idleDays))}
      </p>
      {props.sessions.length === 0 ? (
        (props.empty ?? null)
      ) : (
        <ul className="sc-session-list" aria-label={words.list}>
          {props.sessions.map((session) => (
            <li
              key={session.id}
              className={cx("sc-session", session.current && "sc-session-current")}
            >
              <DeviceIcon handheld={session.platform !== null && HANDHELD.has(session.platform)} />
              <div className="sc-session-body">
                <p className="sc-session-name">
                  <span>{deviceOf(session)}</span>
                  {session.current && <Badge tone="accent">{words.current}</Badge>}
                </p>
                <p className="sc-session-meta">
                  <span>
                    {words.lastActive} <Time iso={session.lastSeenAt} />
                  </span>
                  {session.address !== null && <span>{words.from(session.address)}</span>}
                  <span>
                    {words.signedIn} <Time iso={session.createdAt} precision="day" />
                  </span>
                </p>
              </div>
              {!session.current && props.onEnd !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="sc-session-end"
                  disabled={props.busy}
                  onClick={() => props.onEnd?.(session)}
                >
                  {words.end}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
