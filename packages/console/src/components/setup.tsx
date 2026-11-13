import type { ReactNode } from "react";
import {
  hostOfLogin,
  type RestAgentInvitation,
  type RestAgentInvitationMade,
  type RestAgentSetup,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { type SetupGuide, setupSentenceOf } from "../setup-guide.js";
import { AvatarPicture, Badge, Button, Callout, CopyButton, cx, personName, Time } from "./ui.js";

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
  /** Whether what an invitation is is said first; left out where the words around the panel say it. */
  readonly intro?: boolean | undefined;
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
  const standing = made?.invitation ?? invitation;
  return (
    <div className="sc-agent-invitation">
      {props.intro !== false && <p className="sc-field-hint">{words.intro}</p>}
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

export interface AgentStartStepsProps {
  /** The login the account signs in to the console with, and what its provider is called. */
  readonly login: string;
  readonly provider: string;
  /** Whether anyone has signed in with the account. */
  readonly signedIn: boolean;
  /** Whether an invitation stands. */
  readonly invited: boolean;
  /** Whether the account's command is signed in on a machine. */
  readonly onMachine: boolean;
  /** Whether its runner was ever heard from. */
  readonly heard: boolean;
  /** The invitation, with the way to make one: shown under its step. */
  readonly invitation?: ReactNode;
}

/**
 * What stands between an agent account that was just added and one at work, in the order it is
 * done: the account it signs in with, an invitation, the one line on its machine, its runner.
 * Each is said done as the console sees it, so that whoever looks reads what is next. Who makes
 * the account at the provider is not said: the account is named, and when it has to be there
 * (ADR-0094), which at a git host is already, since until its first sign-in the console lets in
 * whoever holds the login.
 */
export function AgentStartSteps(props: AgentStartStepsProps) {
  const words = useWords().agents.page.start;
  // A step further on that is done says the ones before it are: a runner heard from was set up.
  const heard = props.heard;
  const onMachine = props.onMachine || heard;
  const signedIn = props.signedIn || onMachine;
  const steps: readonly {
    readonly key: string;
    readonly title: string;
    readonly body: string;
    readonly done: boolean;
    readonly more?: ReactNode;
  }[] = [
    {
      key: "account",
      title: words.account.title,
      body: signedIn
        ? words.account.done(props.login)
        : words.account.at[hostOfLogin(props.login)](props.login, props.provider),
      done: signedIn,
    },
    {
      key: "invitation",
      title: words.invitation.title,
      body: words.invitation.body,
      done: props.invited || onMachine,
      more: onMachine ? undefined : props.invitation,
    },
    {
      key: "machine",
      title: words.machine.title,
      body: onMachine ? words.machine.done : words.machine.body,
      done: onMachine,
    },
    {
      key: "runner",
      title: words.runner.title,
      body: heard ? words.runner.done : words.runner.body,
      done: heard,
    },
  ];
  // What is next is the first step not done. Whether the account is there at its provider the
  // console cannot see before it signs in: once a later step is done, the one after that is next.
  const open = steps.findIndex((step) => !step.done);
  const next = steps.some((step, index) => index > open && step.done)
    ? steps.findIndex((step, index) => index > open && !step.done)
    : open;
  return (
    <ol className="sc-steps" aria-label={words.title}>
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={cx("sc-step", step.done && "sc-step-done", index === next && "sc-step-next")}
          aria-current={index === next ? "step" : undefined}
        >
          <span className="sc-step-mark" aria-hidden="true">
            {index + 1}
          </span>
          <div className="sc-step-what">
            <span className="sc-step-title">
              {step.title}
              {step.done && <Badge tone="success">{words.done}</Badge>}
            </span>
            <p className="sc-step-body">{step.body}</p>
            {step.more}
          </div>
        </li>
      ))}
    </ol>
  );
}
