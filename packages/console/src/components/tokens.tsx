import { type FormEvent, type ReactNode, useState } from "react";
import {
  DEFAULT_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
  type RestToken,
  type RestTokenInput,
} from "../api.js";
import { Button, Callout, Time } from "./ui.js";

// The tokens a person holds for their agents, scripts and consoles of their own, shown as the
// agents that hold them: the list, the way to make one by hand, and the one just made, whose
// secret is shown this once. Each takes its data as props and nothing from the network.

/** How long a token may be good for, as the form offers it; `never` for one that does not expire. */
const DAY_CHOICES = ["30", "90", "180", "365", "never"] as const;
type DayChoice = (typeof DAY_CHOICES)[number];
const DEFAULT_CHOICE: DayChoice =
  DAY_CHOICES.find((choice) => choice === String(DEFAULT_TOKEN_DAYS)) ?? "90";
const choiceLabel = (choice: string): string =>
  choice === "never" ? "Does not expire" : `${choice} days`;

/**
 * The spans a form offers: the usual ones, within the most days the workspace allows when it
 * names some, and that limit itself; with a limit there is no "never".
 */
export function dayChoices(daysAtMost: number | null | undefined): readonly string[] {
  if (daysAtMost === null || daysAtMost === undefined) {
    return DAY_CHOICES;
  }
  const within = DAY_CHOICES.filter((choice) => choice !== "never" && Number(choice) < daysAtMost);
  return [...within, String(daysAtMost)];
}

export interface TokenListProps {
  readonly tokens: readonly RestToken[];
  /** Called to take a token away. Left out, tokens cannot be removed here. */
  readonly onRevoke?: ((token: RestToken) => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly empty?: ReactNode;
}

export function TokenList(props: TokenListProps) {
  if (props.tokens.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  return (
    <ul className="sc-token-list" aria-label="Agents">
      {props.tokens.map((token) => (
        <li key={token.id} className="sc-token">
          <div>
            <p className="sc-token-name">{token.name}</p>
            <p className="sc-token-meta">
              <span>
                Connected <Time iso={token.createdAt} />
              </span>
              <span>
                {token.expiresAt === null ? (
                  "Does not expire"
                ) : (
                  <>
                    Good until <Time iso={token.expiresAt} />
                  </>
                )}
              </span>
              <span>
                {token.lastUsedAt === null ? (
                  "Not active yet"
                ) : (
                  <>
                    Last active <Time iso={token.lastUsedAt} />
                  </>
                )}
              </span>
            </p>
          </div>
          {props.onRevoke !== undefined && (
            <Button
              variant="danger"
              size="sm"
              disabled={props.busy === true}
              onClick={() => props.onRevoke?.(token)}
            >
              Disconnect
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface TokenFormProps {
  /** What the token is called to begin with: what the agent calls itself, for one connecting. */
  readonly name?: string | undefined;
  /** The most days a token may be good for here, or nothing when a person chooses. */
  readonly daysAtMost?: number | null | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  /** What the button says; "Make the token" when left out. */
  readonly submitLabel?: string | undefined;
  readonly cancelLabel?: string | undefined;
  readonly onSubmit: (input: RestTokenInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

export function TokenForm(props: TokenFormProps) {
  const choices = dayChoices(props.daysAtMost);
  const [name, setName] = useState(props.name ?? "");
  const [choice, setChoice] = useState<string>(
    choices.includes(DEFAULT_CHOICE) ? DEFAULT_CHOICE : (choices.at(-1) ?? DEFAULT_CHOICE),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit({
      name: name.trim(),
      expiresInDays: choice === "never" ? null : Number(choice),
    });
  };
  return (
    <form className="sc-form" onSubmit={submit}>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">Name</span>
          <input
            className="sc-input"
            value={name}
            maxLength={MAX_TOKEN_NAME_LENGTH}
            required
            placeholder="The agent it is for, and where it runs"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="sc-field">
          <span className="sc-field-label">Good for</span>
          <select
            className="sc-input"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            {choices.map((option) => (
              <option key={option} value={option}>
                {choiceLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy === true || name.trim() === ""}
        >
          {props.submitLabel ?? "Make the token"}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" onClick={props.onCancel} disabled={props.busy === true}>
            {props.cancelLabel ?? "Cancel"}
          </Button>
        )}
      </div>
    </form>
  );
}

export interface NewTokenProps {
  readonly token: RestToken;
  /** The secret, which the server answered once and does not keep. */
  readonly secret: string;
  readonly onDone: () => void;
}

/** The token just made, with its secret shown this once and the way to copy it. */
export function NewToken(props: NewTokenProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
      return;
    }
    void navigator.clipboard.writeText(props.secret).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <Callout
      tone="warning"
      title={`The token "${props.token.name}" is ready`}
      action={
        <Button size="sm" variant="ghost" onClick={props.onDone}>
          Done
        </Button>
      }
    >
      <p>Copy it now: it is shown this once, and the console keeps only its hash.</p>
      <p className="sc-secret">
        <code className="sc-secret-value">{props.secret}</code>
        <Button size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </p>
      <p>
        Sign the <code>console</code> command in with it, present it as{" "}
        <code>Authorization: Bearer …</code> to the REST API, or give it to a console or a script of
        your own.{" "}
        {props.token.expiresAt === null ? (
          "It does not expire, so remove it here once it is no longer needed."
        ) : (
          <>
            It is good until <Time iso={props.token.expiresAt} />, and you can remove it here at any
            time.
          </>
        )}
      </p>
    </Callout>
  );
}
