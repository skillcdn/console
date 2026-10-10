import { useState } from "react";
import { normalizeConnectCode, type RestConnectRequest, type RestTokenInput } from "../api.js";
import { TokenForm } from "./tokens.js";
import { Button, Callout, Time } from "./ui.js";

// Connecting an agent (ADR-0011): where a person types the code their agent showed, what asks
// to connect under a code with the way to approve it, and the words that tell a person what to
// say to their agent. Each takes its data as props and nothing from the network.

export interface ConnectCodeFormProps {
  readonly busy?: boolean | undefined;
  /** Called with the code as it is written, once what was typed is one. */
  readonly onSubmit: (code: string) => void;
}

/** Where a person types the code their agent showed. */
export function ConnectCodeForm(props: ConnectCodeFormProps) {
  const [text, setText] = useState("");
  const code = normalizeConnectCode(text);
  return (
    <form
      className="sc-form sc-connect-code"
      aria-label="The code"
      onSubmit={(event) => {
        event.preventDefault();
        if (code !== undefined) {
          props.onSubmit(code);
        }
      }}
    >
      <label className="sc-field">
        <span className="sc-field-label">The code your agent showed</span>
        <input
          className="sc-input sc-code-input"
          value={text}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={code === undefined || props.busy === true}
        >
          Continue
        </Button>
      </div>
    </form>
  );
}

export interface ConnectApprovalProps {
  readonly request: RestConnectRequest;
  /** The most days a token may be good for here, or nothing when a person chooses. */
  readonly daysAtMost?: number | null | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  /** Called with what to call the agent and for how long its token is good. */
  readonly onApprove: (input: RestTokenInput) => void;
  /** Called when the person says the request is not theirs. */
  readonly onDeny: () => void;
}

/** What asks to connect under a code, and the way to let it, as the person it will act as. */
export function ConnectApproval(props: ConnectApprovalProps) {
  const { request } = props;
  return (
    <div className="sc-approval">
      <Callout tone="warning" title="An agent asks to connect as you">
        <p>
          It calls itself <strong>{request.agent}</strong>, and it showed the code{" "}
          <code className="sc-code-shown">{request.code}</code>. If that is not the code on your
          screen, or you did not ask for this, say that it is not yours.
        </p>
        <p>
          Approved, it works here as you, within what you may do, until you disconnect it on your
          Agents page. It gets a token of its own, which nobody sees, you included.
        </p>
        <p className="sc-muted">
          Asked <Time iso={request.createdAt} />; good until <Time iso={request.expiresAt} />.
        </p>
      </Callout>
      <TokenForm
        name={request.agent}
        daysAtMost={props.daysAtMost}
        busy={props.busy}
        error={props.error}
        submitLabel="Approve"
        cancelLabel="Not mine"
        onSubmit={props.onApprove}
        onCancel={props.onDeny}
      />
    </div>
  );
}

export interface ConnectWordsProps {
  /** The origin of the console, as a person tells their agent. */
  readonly origin: string;
}

/** What a person says to their agent to connect it, in words for someone who is not a developer. */
export function ConnectWords(props: ConnectWordsProps) {
  return (
    <section className="sc-panel sc-connect" aria-label="Connecting an agent">
      <h2 className="sc-section-title">Connecting an agent</h2>
      <p>
        Tell your agent, in its own chat:{" "}
        <q>Install the console command and connect to {props.origin}.</q> An agent that can run
        commands does the rest: it installs <code>@skillcdn/console</code>, runs{" "}
        <code>console login --url {props.origin}</code>, and shows you an address with a code.
      </p>
      <p>
        Open the address, signed in here, check that the page shows the same code, give the agent a
        name, and approve. From then on the agent works here as you, within what you may do;
        disconnect it on this page when that is over. The token it holds is never shown to anyone,
        you included.
      </p>
      <p>By hand, where no agent runs the command for you:</p>
      <pre className="sc-code">
        npm install -g @skillcdn/console{"\n"}console login --url {props.origin}
        {"\n"}console use {"<project key>"}
      </pre>
    </section>
  );
}
