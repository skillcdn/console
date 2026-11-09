import type { ReactNode } from "react";
import type { RestSession } from "../api.js";
import { useWords } from "../i18n/index.js";
import { Badge, Button, Time } from "./ui.js";

// The browsers a person is signed in on (board #309), on their own page beside their agents:
// each with what it is, where it last came from and when it was last used, the one they look
// from marked; the way to sign any other out, and all the others at once. Takes its data as
// props and nothing from the network.

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

export function SessionList(props: SessionListProps) {
  const words = useWords().sessions;
  const others = props.sessions.filter((session) => !session.current);
  const deviceOf = (session: RestSession): string =>
    session.browser !== null && session.platform !== null
      ? words.on(session.browser, session.platform)
      : (session.browser ?? session.platform ?? words.unknownBrowser);
  return (
    <section className="sc-sessions" aria-label={words.title}>
      <div className="sc-section-head">
        <h2 className="sc-section-title">{words.title}</h2>
        {props.onEndOthers !== undefined && others.length > 0 && (
          <Button size="sm" variant="danger" disabled={props.busy} onClick={props.onEndOthers}>
            {words.endOthers}
          </Button>
        )}
      </div>
      <p className="sc-muted">
        {props.idleDays === undefined ? words.intro : words.introIdle(String(props.idleDays))}
      </p>
      {props.sessions.length === 0 ? (
        (props.empty ?? null)
      ) : (
        <ul className="sc-token-list" aria-label={words.list}>
          {props.sessions.map((session) => (
            <li key={session.id} className="sc-token">
              <div>
                <p className="sc-token-name">
                  {deviceOf(session)}
                  {session.current && (
                    <>
                      {" "}
                      <Badge tone="accent">{words.thisBrowser}</Badge>
                    </>
                  )}
                </p>
                <p className="sc-token-meta">
                  <span>
                    {words.lastActive} <Time iso={session.lastSeenAt} />
                  </span>
                  <span>
                    {words.signedIn} <Time iso={session.createdAt} />
                  </span>
                  {session.address !== null && <span>{words.from(session.address)}</span>}
                </p>
              </div>
              {!session.current && props.onEnd !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
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
