import { useState } from "react";
import { normalizeConnectCode, type RestConnectRequest, type RestTokenInput } from "../api.js";
import { useWords } from "../i18n/index.js";
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
  const words = useWords().connect;
  const [text, setText] = useState("");
  const code = normalizeConnectCode(text);
  return (
    <form
      className="sc-form sc-connect-code"
      aria-label={words.codeAria}
      onSubmit={(event) => {
        event.preventDefault();
        if (code !== undefined) {
          props.onSubmit(code);
        }
      }}
    >
      <label className="sc-field">
        <span className="sc-field-label">{words.codeLabel}</span>
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
          {words.continue}
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
  const words = useWords().connect;
  const { request } = props;
  return (
    <div className="sc-approval">
      <Callout tone="warning" title={words.asks.title}>
        <p>
          {words.asks.callsItself} <strong>{request.agent}</strong>
        </p>
        <p>
          {words.asks.showedCode} <code className="sc-code-shown">{request.code}</code>
        </p>
        <p>{words.asks.ifNot}</p>
        <p>{words.asks.approvedMeans}</p>
        <p className="sc-muted">
          {words.asks.asked} <Time iso={request.createdAt} />; {words.asks.goodUntil}{" "}
          <Time iso={request.expiresAt} />.
        </p>
      </Callout>
      <TokenForm
        name={request.agent}
        daysAtMost={props.daysAtMost}
        busy={props.busy}
        error={props.error}
        submitLabel={words.approve}
        cancelLabel={words.notMine}
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
  const words = useWords().connect.words;
  return (
    <section className="sc-panel sc-connect" aria-label={words.title}>
      <h2 className="sc-section-title">{words.title}</h2>
      <p>
        {words.tellYourAgent} <q>{words.quote(props.origin)}</q> {words.doesTheRest}
      </p>
      <p>{words.thenApprove}</p>
      <p>{words.byHand}</p>
      <pre className="sc-code">
        npm install -g @skillcdn/console{"\n"}console login --url {props.origin}
        {"\n"}console use {"<project key>"}
      </pre>
    </section>
  );
}
