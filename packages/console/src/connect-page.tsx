import { useEffect, useState } from "react";
import {
  ApiError,
  normalizeConnectCode,
  type RestConnectRequest,
  type RestTokenInput,
} from "./api.js";
import { ConnectApproval, ConnectCodeForm } from "./components/connect.js";
import { Callout, Spinner } from "./components/ui.js";
import type { ConsoleData } from "./data.js";
import { connectHref, type Navigation, PATHS } from "./router.js";
import { useAction } from "./use-action.js";

// The page where a person connects their agent (ADR-0011): the code typed when the address
// does not carry one, what asks under it, the approval, and what came of it. Part of the
// default composition; a custom console composes the same components its own way.

export interface ConnectPageProps {
  /** The code in the address, as typed or followed, or nothing. */
  readonly code: string | undefined;
  readonly data: ConsoleData;
  readonly navigation: Navigation;
}

const NO_SUCH_CODE =
  "No agent asks to connect with this code. A code is good for ten minutes and for one approval; ask your agent for a new one.";

export function ConnectPage(props: ConnectPageProps) {
  const { data, navigation } = props;
  const code = props.code === undefined ? undefined : normalizeConnectCode(props.code);
  const [request, setRequest] = useState<RestConnectRequest | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<"approved" | "denied" | undefined>(undefined);
  const { busy, error, act } = useAction();
  const { connectRequest } = data.actions;

  // What asks under the code, read once the page is on one.
  useEffect(() => {
    setRequest(undefined);
    setProblem(undefined);
    setOutcome(undefined);
    if (code === undefined) {
      return;
    }
    const controller = new AbortController();
    connectRequest(code, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) {
          setRequest(found);
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setProblem(
          failure instanceof ApiError && failure.code === "connect.not_found"
            ? NO_SUCH_CODE
            : failure instanceof ApiError
              ? failure.message
              : "The console could not be asked.",
        );
      });
    return () => controller.abort();
  }, [code, connectRequest]);

  const head = (
    <div className="sc-page-head">
      <h1 className="sc-page-title">Connect an agent</h1>
    </div>
  );
  const ask = (
    <>
      <p className="sc-lead">
        Your agent showed you a code when it was told to connect to this console. Type it here, and
        say whether the agent may work as you.
      </p>
      <section className="sc-panel" aria-label="Connect">
        <ConnectCodeForm busy={busy} onSubmit={(typed) => navigation.go(connectHref(typed))} />
      </section>
    </>
  );

  if (outcome === "approved" && request !== undefined) {
    return (
      <>
        {head}
        <Callout tone="info" title={`"${request.agent}" is connected as you`}>
          <p>
            The agent gets its token on its own; there is nothing to copy. You can close this page,
            or see what is connected on your <a href={PATHS.agents}>Agents page</a>.
          </p>
        </Callout>
      </>
    );
  }
  if (outcome === "denied") {
    return (
      <>
        {head}
        <Callout tone="info" title="Nothing was connected">
          <p>The code is spent. An agent that should connect shows a new one when told again.</p>
        </Callout>
        {ask}
      </>
    );
  }
  if (code === undefined || problem !== undefined) {
    return (
      <>
        {head}
        {props.code !== undefined && code === undefined && (
          <Callout tone="warning">
            That is not a code: eight letters and digits, in two groups.
          </Callout>
        )}
        {problem !== undefined && <Callout tone="warning">{problem}</Callout>}
        {ask}
      </>
    );
  }
  if (request === undefined) {
    return (
      <>
        {head}
        <div className="sc-loading">
          <Spinner label="Looking the code up" />
        </div>
      </>
    );
  }
  return (
    <>
      {head}
      <ConnectApproval
        request={request}
        daysAtMost={data.me?.workspace.tokenDaysAtMost}
        busy={busy}
        error={error}
        onApprove={(input: RestTokenInput) =>
          void act(async () => {
            await data.actions.approveConnection(code, input);
            setOutcome("approved");
          })
        }
        onDeny={() =>
          void act(async () => {
            await data.actions.denyConnection(code);
            setOutcome("denied");
          })
        }
      />
    </>
  );
}
