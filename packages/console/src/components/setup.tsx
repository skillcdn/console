import type { ReactNode } from "react";
import type { RestAgentInvitation, RestAgentInvitationMade, RestAgentSetup } from "../api.js";
import { useWords } from "../i18n/index.js";
import { type SetupGuide, setupSentenceOf } from "../setup-guide.js";
import { AvatarPicture, Badge, Button, Callout, CopyButton, personName, Time } from "./ui.js";

// The way a machine is led to an agent account (ADR-0088): the invitation as a supervisor sees
// it under the account, with the one line to say on the machine, and the guide its code opens,
// as a person reads it. Each takes its data as props and nothing from the network.

/** A guide's sentence, with what it writes between backticks set as code. */
function withCode(text: string): ReactNode[] {
  return text.split("`").map((part, index) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence, never reordered
    index % 2 === 1 ? <code key={index}>{part}</code> : part,
  );
}

/** A line to copy as it is. */
function Line(props: { readonly text: string }) {
  return (
    <div className="sc-copyable">
      <pre className="sc-code">{props.text}</pre>
      <CopyButton text={props.text} size="sm" />
    </div>
  );
}

export interface SetupGuideViewProps {
  readonly guide: SetupGuide;
  /** The account the setup is for, as the code opens it. */
  readonly account: RestAgentSetup["account"];
}

/** The guide of one agent account's setup, in the order it is done and by whom. */
export function SetupGuideView(props: SetupGuideViewProps) {
  const words = useWords().setup;
  const { guide, account } = props;
  return (
    <article className="sc-setup">
      <header className="sc-setup-head">
        {account.avatarParts !== null && account.avatarParts !== undefined && (
          <AvatarPicture parts={account.avatarParts} className="sc-avatar sc-avatar-lg" />
        )}
        <h1 className="sc-page-title">{guide.title}</h1>
      </header>
      {guide.about.map((paragraph) => (
        <p key={paragraph}>{withCode(paragraph)}</p>
      ))}
      <p className="sc-muted">
        {words.goodUntil} <Time iso={guide.expiresAt} />
        {words.inEnglish.length > 0 && ` · ${words.inEnglish}`}
      </p>
      {guide.sections.map((section, index) => (
        <section key={section.key} className="sc-panel sc-setup-section" aria-label={section.title}>
          <h2 className="sc-section-title">
            {index + 1}. {section.title} <Badge>{words.who[section.who]}</Badge>
          </h2>
          <p className="sc-field-hint">{section.about}</p>
          <ol className="sc-setup-steps">
            {section.steps.map((step) => (
              <li key={step.title}>
                <strong>{withCode(step.title)}</strong>
                <p>{withCode(step.body)}</p>
                {step.line !== undefined && <Line text={step.line} />}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </article>
  );
}

export interface AgentInvitationPanelProps {
  /** The invitation as it stands: `null` for none, nothing while it is not read yet. */
  readonly invitation: RestAgentInvitation | null | undefined;
  /** The invitation just made, with its code, which is shown this once. */
  readonly made?: RestAgentInvitationMade | undefined;
  /** What a person does before the line, in the words of the workspace's identity service. */
  readonly first?: readonly string[];
  /** Where a person reads the guide a code opens. */
  readonly guideHref: (code: string) => string;
  readonly busy?: boolean;
  readonly onInvite: () => void;
  readonly onRevoke: () => void;
}

/**
 * The invitation of an agent account, for a supervisor: whether one stands, the way to make one,
 * to make it again and to take it away, and, once made, the one line to say on the machine.
 */
export function AgentInvitationPanel(props: AgentInvitationPanelProps) {
  const words = useWords().agents.page.settings.machine;
  const { invitation, made } = props;
  const busy = props.busy === true;
  const first = props.first ?? [];
  const standing = made?.invitation ?? invitation;
  return (
    <div className="sc-agent-invitation">
      <p className="sc-field-hint">{words.intro}</p>
      {first.length > 0 && (
        <>
          <p className="sc-field-label">{words.first}</p>
          <ul className="sc-setup-first">
            {first.map((line) => (
              <li key={line}>{withCode(line)}</li>
            ))}
          </ul>
        </>
      )}
      {made !== undefined ? (
        <Callout tone="warning" title={words.made.title}>
          <p>{words.made.say}</p>
          <Line text={setupSentenceOf(made.command)} />
          <p>{words.made.orRun}</p>
          <Line text={made.command} />
          <p>
            <a href={props.guideHref(made.code)}>{words.made.guide}</a>
          </p>
          <p>
            {words.made.once} <Time iso={made.invitation.expiresAt} />
          </p>
        </Callout>
      ) : standing === undefined ? null : standing === null ? (
        <p>{words.none}</p>
      ) : (
        <p>
          {words.stands} <Time iso={standing.expiresAt} />
          {standing.by !== null && ` · ${words.by(personName(standing.by))}`}
          {". "}
          {words.shownOnce}
        </p>
      )}
      <div className="sc-agent-invitation-actions">
        <Button disabled={busy || invitation === undefined} onClick={props.onInvite}>
          {standing === null || standing === undefined ? words.invite : words.again}
        </Button>
        {standing !== null && standing !== undefined && (
          <Button variant="ghost" disabled={busy} onClick={props.onRevoke}>
            {words.revoke}
          </Button>
        )}
      </div>
    </div>
  );
}
