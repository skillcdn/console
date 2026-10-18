import { useEffect, useState } from "react";
import type {
  PackConnectEnding,
  RestPackConnect,
  RestPackConnectStarted,
  RestProject,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Button } from "./ui.js";

// A private pack connected with a code a person approves (ADR-0036): an owner asks, the console
// asks the deployment and shows what it answered, the code and the page, and the owner approves
// there; the page asks the console again at the interval the deployment named until the token
// is kept or the request ended. Takes its data through the callbacks and keeps nothing itself.

export interface PackConnectProps {
  /** Asks the deployment to connect; answers what the person is shown. */
  readonly onStart: () => Promise<RestPackConnectStarted>;
  /** How the connection stands; the token is kept when the person approved. */
  readonly poll: (signal?: AbortSignal) => Promise<RestPackConnect>;
  /** Gives the connection up. */
  readonly onCancel: () => Promise<void>;
  /** Called once the token is kept, with the project as it stands. */
  readonly onConnected?: ((project: RestProject) => void) | undefined;
  readonly busy?: boolean | undefined;
}

type Shown =
  | { readonly kind: "idle" }
  | {
      readonly kind: "waiting";
      readonly code: string;
      readonly url: string;
      readonly expiresAt: string;
      readonly intervalSeconds: number;
    }
  | { readonly kind: "ended"; readonly reason: PackConnectEnding }
  | { readonly kind: "connected" };

/** The least often the console is asked again, whatever the deployment says. */
const MIN_INTERVAL_SECONDS = 2;

export function PackConnect(props: PackConnectProps) {
  const words = useWords();
  const pack = words.projects.packToken;
  const { poll, onConnected } = props;
  const [shown, setShown] = useState<Shown>({ kind: "idle" });
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // A request begun before the page was opened is picked up where it stands.
  useEffect(() => {
    const controller = new AbortController();
    poll(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted && state.status === "pending") {
          setShown({ kind: "waiting", ...state });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [poll]);

  // While waiting, the console is asked again at the interval the deployment named; a new
  // answer, pending still, is a new state, which schedules the next asking.
  useEffect(() => {
    if (shown.kind !== "waiting") {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      poll(controller.signal)
        .then((state) => {
          if (controller.signal.aborted) {
            return;
          }
          setProblem(undefined);
          if (state.status === "pending") {
            setShown({ kind: "waiting", ...state });
          } else if (state.status === "connected") {
            setShown({ kind: "connected" });
            onConnected?.(state.project);
          } else if (state.status === "ended") {
            setShown({ kind: "ended", reason: state.reason });
          } else {
            setShown({ kind: "idle" });
          }
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          // The console could not be asked this time; it is asked again.
          setProblem(failure instanceof Error ? failure.message : String(failure));
          setShown((current) => (current.kind === "waiting" ? { ...current } : current));
        });
    }, Math.max(shown.intervalSeconds, MIN_INTERVAL_SECONDS) * 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [shown, poll, onConnected]);

  const start = () => {
    setProblem(undefined);
    props
      .onStart()
      .then((started) => setShown({ kind: "waiting", ...started }))
      .catch((failure: unknown) => {
        setProblem(failure instanceof Error ? failure.message : String(failure));
      });
  };
  const cancel = () => {
    props
      .onCancel()
      .then(() => setShown({ kind: "idle" }))
      .catch((failure: unknown) => {
        setProblem(failure instanceof Error ? failure.message : String(failure));
      });
  };

  return (
    <div className="sc-pack-connect" aria-live="polite">
      {shown.kind === "waiting" ? (
        <>
          <p className="sc-pack-connect-code">
            <span className="sc-field-label">{pack.connectCode}</span> <code>{shown.code}</code>
          </p>
          <p>
            <a
              className="sc-button sc-button-primary"
              href={shown.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {pack.connectOpen}
            </a>
          </p>
          <p className="sc-muted">{pack.connectWaiting}</p>
          <div className="sc-form-actions">
            <Button variant="ghost" disabled={props.busy === true} onClick={cancel}>
              {pack.connectCancel}
            </Button>
          </div>
        </>
      ) : shown.kind === "connected" ? (
        <p>{pack.connectDone}</p>
      ) : (
        <>
          {shown.kind === "ended" && (
            <p className="sc-form-error" role="alert">
              {pack.connectEnded[shown.reason]}
            </p>
          )}
          <p className="sc-field-hint">{pack.connectHint}</p>
          <div className="sc-form-actions">
            <Button variant="primary" disabled={props.busy === true} onClick={start}>
              {pack.connect}
            </Button>
          </div>
        </>
      )}
      {problem !== undefined && (
        <p className="sc-form-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
