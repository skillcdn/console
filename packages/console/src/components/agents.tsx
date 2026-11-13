import { type FormEvent, useContext, useEffect, useState } from "react";
import {
  hostOfLogin,
  isHandle,
  isLoginAt,
  type ProviderKey,
  RESERVED_HANDLES,
  type RestAgent,
  type RestAgentInput,
  type RestAgentProposal,
  type RestPerson,
  type RestProject,
  type RestProvider,
  type RestWorkspace,
} from "../api.js";
import { type AvatarSet, avatarScanlines, MAX_AVATAR_PIXELS, pngFile } from "../avatar.js";
import { useWords } from "../i18n/index.js";
import {
  MAX_HANDLE_LENGTH,
  MAX_LOGIN_LENGTH,
  MAX_PERSON_NAME_LENGTH,
  MAX_PERSON_TITLE_LENGTH,
} from "../limits.js";
import { agentLoginOf } from "../services.js";
import { AgentStateBadge } from "./agent-page.js";
import { supervisedBy } from "./people.js";
import { Picker } from "./picker.js";
import { peopleSearch } from "./searches.js";
import {
  Avatar,
  AvatarPicture,
  AvatarSetsContext,
  Badge,
  Button,
  Callout,
  cx,
  PersonChip,
  PersonOption,
  personName,
  Time,
} from "./ui.js";

// The agent accounts of the workspace (ADR-0084): agents that are members of their own, listed
// with whom each reports to, and the form an administrator makes one with, from a persona
// proposed and edited freely. Each takes its data as props and nothing from the network; the
// one thing done here beyond drawing is writing an avatar out as a picture file, in the browser.

/**
 * An avatar as a PNG file, drawn here from its parts and compressed by the browser: for the
 * profile of the agent's account elsewhere, where a picture file is what is taken. Nothing is
 * asked of the console.
 */
export async function avatarPngBlob(
  parts: NonNullable<RestPerson["avatarParts"]>,
  size: number = MAX_AVATAR_PIXELS,
  sets?: readonly AvatarSet[],
): Promise<Blob> {
  const rows = avatarScanlines(parts, size, sets);
  const deflated = new Uint8Array(
    await new Response(
      new Blob([rows as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  return new Blob([pngFile(size, deflated) as BlobPart], { type: "image/png" });
}

/** Hands a file to the person's browser to save, under a name. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * The agent accounts as the agents' page lists them: the ones whoever looks manages, directly
 * or through someone who reports to them, and the others of the workspace, which only an
 * administrator is shown. An administrator supervises every account, so which they manage is
 * read off the reporting line; for anyone else the console has said which are theirs, and the
 * rest are not theirs to list.
 */
export function agentAccountGroups(
  agents: readonly RestAgent[],
  me: RestPerson | undefined,
  people: readonly RestPerson[],
): { readonly managed: readonly RestAgent[]; readonly others: readonly RestAgent[] } {
  const administrator = me?.role === "admin";
  const managed = agents.filter((agent) =>
    administrator ? supervisedBy(me, agent.person, people) : agent.supervised,
  );
  return {
    managed,
    others: administrator ? agents.filter((agent) => !managed.includes(agent)) : [],
  };
}

export interface AgentAccountListProps {
  readonly agents: readonly RestAgent[];
  /** Whoever is looking: a card names the manager of an account that reports to someone else. */
  readonly me?: RestPerson | undefined;
  /** Whether something is being done; the default list offers nothing to do, and reads it not. */
  readonly busy?: boolean | undefined;
  /** Shown where there is no agent account to list. */
  readonly empty?: React.ReactNode;
  /** Where an account's own page is; given, the whole card leads there, and left out, nothing does. */
  readonly href?: ((agent: RestAgent) => string) | undefined;
}

/**
 * Agent accounts, a card each, for whoever looks after several: the picture, the name with the
 * handle and what it does, and across from them how it stands; then what it is doing now and
 * since when, what it runs, and whom it reports to where that is someone else. Rows of one
 * shape, so that the cards read alike down a column. The whole card leads to the account's
 * page; what is kept of the account, the login it signs in with among it, is said there.
 */
export function AgentAccountList(props: AgentAccountListProps) {
  const words = useWords();
  const accounts = words.agents.accounts;
  const states = words.agents.page.state;
  if (props.agents.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  const reasons: Readonly<Record<string, string>> = states.reasons;
  return (
    <ul className="sc-people sc-agent-accounts" aria-label={accounts.list}>
      {props.agents.map((agent) => {
        const { person, manager } = agent;
        const name = personName(person);
        const out = person.status !== "active";
        const invited = person.invited === true;
        const title = person.title ?? "";
        const state = agent.state ?? null;
        const product = agent.runner?.product ?? null;
        const model = agent.runner?.running?.model ?? agent.runner?.settings.model ?? null;
        return (
          <li
            key={person.id}
            className={cx(
              "sc-person-card",
              "sc-agent-card",
              props.href !== undefined && "sc-agent-card-linked",
              out && "sc-person-card-out",
            )}
          >
            <div className="sc-person-card-head">
              <Avatar person={person} size="lg" />
              <div className="sc-person-card-who">
                <span className="sc-person-card-name">
                  {props.href === undefined ? (
                    name
                  ) : (
                    <a className="sc-agent-card-link" href={props.href(agent)}>
                      {name}
                    </a>
                  )}
                  <span className="sc-person-card-note">@{person.handle}</span>
                </span>
                {title !== "" && <span className="sc-person-card-title">{title}</span>}
              </div>
              <span className="sc-agent-card-state">
                {out ? (
                  <Badge>{words.people.deactivated}</Badge>
                ) : state !== null ? (
                  <AgentStateBadge state={state} />
                ) : (
                  <Badge tone={invited ? "warning" : "neutral"}>
                    {invited ? accounts.invited : states.unset}
                  </Badge>
                )}
              </span>
            </div>
            <dl className="sc-person-facts">
              <div className="sc-person-fact">
                <dt>{accounts.now}</dt>
                <dd>
                  {state === null ? (
                    <span className="sc-muted">{invited ? accounts.invitedHint : states.none}</span>
                  ) : (
                    <span>
                      {state.reason !== null && `${reasons[state.reason] ?? state.reason} · `}
                      {states.since.before}
                      <Time iso={state.since} precision="clock" />
                      {states.since.after}
                    </span>
                  )}
                </dd>
              </div>
              {product !== null && (
                <div className="sc-person-fact">
                  <dt>{accounts.runs}</dt>
                  <dd>
                    {[
                      `${product.name}${product.version === null ? "" : ` ${product.version}`}`,
                      ...(model === null ? [] : [model]),
                    ].join(" · ")}
                  </dd>
                </div>
              )}
              {manager?.id !== props.me?.id || manager === null ? (
                <div className="sc-person-fact">
                  <dt>{words.people.manager}</dt>
                  <dd>
                    {manager === null ? (
                      <span className="sc-muted">{accounts.managerUnseen}</span>
                    ) : (
                      <PersonChip person={manager} />
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The way a supervisor saves an agent account's picture (ADR-0084): its face, and a button that
 * writes it out as a PNG of 1024 pixels a side, drawn here in the browser, for the profile of its
 * account at the messenger or at the identity provider. Nothing where it has no parts to draw.
 */
export function AgentPictureSave(props: {
  readonly person: RestPerson;
  readonly busy?: boolean | undefined;
}) {
  const accounts = useWords().agents.accounts;
  const sets = useContext(AvatarSetsContext);
  const [saving, setSaving] = useState(false);
  const { person } = props;
  const parts = person.avatarParts;
  if (parts === null || parts === undefined) {
    return null;
  }
  const save = () => {
    setSaving(true);
    void avatarPngBlob(parts, MAX_AVATAR_PIXELS, sets)
      .then((blob) => saveBlob(blob, `${person.handle ?? "avatar"}.png`))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };
  return (
    <div className="sc-agent-picture">
      <Avatar person={person} size="lg" />
      <div className="sc-agent-picture-what">
        <Button
          variant="secondary"
          size="sm"
          disabled={props.busy === true || saving}
          onClick={save}
        >
          {accounts.savePicture}
        </Button>
        <p className="sc-field-hint">{accounts.savePictureHint}</p>
      </div>
    </div>
  );
}

/**
 * The login an agent account is proposed to sign in with, from its handle and what the
 * deployment's provider admits: an address at the first Workspace domain it names, or a login at
 * the git host after the organization it names; nothing where it names neither, and the
 * administrator types one. A suggestion, edited freely.
 */
export function suggestLogin(handle: string, provider: RestProvider | undefined): string {
  if (provider === undefined || handle === "") {
    return "";
  }
  if (provider.key === "google") {
    const domain = provider.admits?.domains[0];
    return domain === undefined ? "" : `${handle}@${domain}`;
  }
  const organization = provider.admits?.organization ?? null;
  return organization === null ? "" : `${organization.toLowerCase()}-${handle}`.slice(0, 39);
}

/**
 * The member who signs in with a login at a provider, among the people the form has: the one
 * whom adding an agent account with that login would make the account (ADR-0104). Logins are
 * compared as the hosts compare them, without regard to case. Nobody for a login that is an
 * agent account's already, or an administrator's: the console refuses those in its own words.
 */
export function memberSignedInAs(
  people: readonly RestPerson[],
  host: ProviderKey | undefined,
  login: string,
): RestPerson | undefined {
  const spelled = login.trim().toLowerCase();
  if (host === undefined || spelled === "") {
    return undefined;
  }
  return people.find(
    (person) =>
      person.login.toLowerCase() === spelled &&
      hostOfLogin(person.login) === host &&
      person.kind !== "agent" &&
      person.role !== "admin",
  );
}

export interface AgentAccountFormProps {
  /** A few personas to choose from, rolled again with `onRoll`; none while they are asked for. */
  readonly proposals: readonly RestAgentProposal[];
  /** Called to roll the proposals again. Left out, there is no such button. */
  readonly onRoll?: (() => void) | undefined;
  /** The providers people sign in through here: what the account's login is at. */
  readonly providers: readonly RestProvider[];
  /**
   * The workspace, whose identity service says what an agent account signs in with (ADR-0089):
   * the login is put together from its names where it names one. Left out, the provider's way.
   */
  readonly workspace?: RestWorkspace | undefined;
  /** The people a manager is chosen among. */
  readonly people: readonly RestPerson[];
  /** Whoever makes the account, who is its manager unless another is chosen. */
  readonly me?: RestPerson | undefined;
  /** The projects it may start in. */
  readonly projects: readonly RestProject[];
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: RestAgentInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

/**
 * "Add an agent account", in the three things it settles: who the account is, a persona chosen
 * among the proposals and edited; the account it signs in to this console with, at one of the
 * providers the deployment has, put together from the workspace's services and edited freely;
 * and whom it reports to and where it starts. The one thing the form has to get right is that
 * login, so it says what kind of name it is and when the account has to be there: at a git host,
 * before the account is added, since a login nobody holds there is whoever registers it first.
 * Who makes the account at the provider is the organization's to say, and the form says nothing
 * of it (ADR-0094). A login a member signs in with is not sent until whoever fills the form says
 * that the member is to become the account (ADR-0104).
 */
export function AgentAccountForm(props: AgentAccountFormProps) {
  const words = useWords();
  const form = words.agents.accounts.form;
  const [chosen, setChosen] = useState<RestAgentProposal | undefined>(undefined);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  // Where the workspace names the service its agents sign in through, that is the provider.
  const through =
    props.workspace === undefined ? undefined : agentLoginOf(props.workspace, "agent")?.host;
  const [host, setHost] = useState<ProviderKey | undefined>(
    props.providers.some((candidate) => candidate.key === through)
      ? through
      : props.providers[0]?.key,
  );
  /** The login as typed; while nothing was typed, the one the handle and the provider suggest. */
  const [typedLogin, setTypedLogin] = useState<string | undefined>(undefined);
  const [manager, setManager] = useState<RestPerson | undefined>(props.me);
  const [project, setProject] = useState(props.projects[0]?.key ?? "");
  /** The login of the member whom the person said is to become the account, as it was then. */
  const [converting, setConverting] = useState<string | undefined>(undefined);
  const provider = props.providers.find((candidate) => candidate.key === host);
  const named = props.workspace === undefined ? undefined : agentLoginOf(props.workspace, handle);
  const login =
    typedLogin ??
    (named !== undefined && named.host === host && handle.length > 0
      ? named.login
      : suggestLogin(handle, provider));

  // The first proposal stands chosen as soon as there is one, and again when they are rolled.
  const [first] = props.proposals;
  useEffect(() => {
    if (first !== undefined) {
      setChosen(first);
      setName(first.name);
      setHandle(first.handle);
    }
  }, [first]);

  const choose = (proposal: RestAgentProposal) => {
    setChosen(proposal);
    setName(proposal.name);
    setHandle(proposal.handle);
  };
  const handleOk = isHandle(handle) && !RESERVED_HANDLES.includes(handle);
  const loginOk = host !== undefined && isLoginAt(host, login.trim());
  // The member who signs in with the login written, if one does: a persona's proposed login may
  // spell a colleague's, and adding the account would make them it for good. An agent account
  // and an administrator are refused by the console in its own words.
  const spelled = login.trim().toLowerCase();
  const member = loginOk ? memberSignedInAs(props.people, host, login) : undefined;
  const convert = member !== undefined && converting === spelled;
  const valid =
    chosen !== undefined &&
    name.trim() !== "" &&
    handleOk &&
    loginOk &&
    (member === undefined || convert) &&
    manager !== undefined &&
    project !== "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || host === undefined || chosen === undefined || manager === undefined) {
      return;
    }
    props.onSubmit({
      host,
      login: login.trim(),
      handle,
      name: name.trim(),
      ...(title.trim() === "" ? {} : { title: title.trim() }),
      avatarSeed: chosen.seed,
      avatarParts: chosen.avatarParts,
      managerId: manager.id,
      project,
      ...(convert ? { convert: true } : {}),
    });
  };
  /** Whether the login is the one the workspace's services put together, and not one typed. */
  const derived =
    typedLogin === undefined && named !== undefined && named.host === host && handle.length > 0;
  const hostWords = host === undefined ? undefined : form.loginAt[host];
  return (
    <form className="sc-form sc-agent-form" aria-label={form.aria} onSubmit={submit}>
      <section className="sc-form-part" aria-label={form.who}>
        {/* The way to roll the proposals again stands with the part's title, over all of them. */}
        <div className="sc-section-head">
          <h2 className="sc-section-title">{form.who}</h2>
          {props.onRoll !== undefined && (
            <Button type="button" size="sm" disabled={props.busy === true} onClick={props.onRoll}>
              {form.roll}
            </Button>
          )}
        </div>
        <fieldset className="sc-agent-proposals">
          <legend className="sc-field-label">{form.proposals}</legend>
          <div className="sc-agent-proposal-row">
            {props.proposals.map((proposal) => (
              <button
                key={proposal.seed}
                type="button"
                className={cx(
                  "sc-agent-proposal",
                  chosen?.seed === proposal.seed && "sc-agent-proposal-chosen",
                )}
                aria-pressed={chosen?.seed === proposal.seed}
                disabled={props.busy === true}
                onClick={() => choose(proposal)}
              >
                <AvatarPicture parts={proposal.avatarParts} className="sc-avatar sc-avatar-lg" />
                <span className="sc-agent-proposal-name">{proposal.name}</span>
                <span className="sc-agent-proposal-handle">@{proposal.handle}</span>
              </button>
            ))}
          </div>
          <p className="sc-field-hint">{form.proposalsHint}</p>
        </fieldset>
        <div className="sc-field-row">
          <label className="sc-field">
            <span className="sc-field-label">{form.name}</span>
            <input
              className="sc-input"
              value={name}
              maxLength={MAX_PERSON_NAME_LENGTH}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="sc-field">
            <span className="sc-field-label">{form.handle}</span>
            <input
              className="sc-input"
              value={handle}
              maxLength={MAX_HANDLE_LENGTH}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={handle !== "" && !handleOk}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
            />
          </label>
          <label className="sc-field">
            <span className="sc-field-label">{form.title}</span>
            <input
              className="sc-input"
              value={title}
              maxLength={MAX_PERSON_TITLE_LENGTH}
              placeholder={form.titlePlaceholder}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </div>
        <p className="sc-field-hint">{form.handleHint}</p>
      </section>
      <section className="sc-form-part" aria-label={form.signsIn}>
        <h2 className="sc-section-title">{form.signsIn}</h2>
        <p className="sc-field-hint">{form.signsInHint}</p>
        <div className="sc-field-row">
          {props.providers.length > 1 && (
            <label className="sc-field">
              <span className="sc-field-label">{form.provider}</span>
              <select
                className="sc-input"
                value={host ?? ""}
                onChange={(event) => {
                  setHost(event.target.value as ProviderKey);
                  // A login typed for one provider is no login at another.
                  setTypedLogin(undefined);
                }}
              >
                {props.providers.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="sc-field">
            <span className="sc-field-label">{hostWords?.label ?? form.login}</span>
            <input
              className="sc-input"
              value={login}
              maxLength={MAX_LOGIN_LENGTH}
              placeholder={hostWords?.example}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={login !== "" && !loginOk}
              onChange={(event) => setTypedLogin(event.target.value)}
            />
          </label>
        </div>
        {provider !== undefined && (
          <p className="sc-field-hint" aria-live="polite">
            {login.trim() !== "" && !loginOk
              ? hostWords?.invalid
              : [
                  login.trim() === ""
                    ? hostWords?.unnamed(provider.label)
                    : hostWords?.named(login.trim(), provider.label),
                  ...(derived ? [form.loginDerived] : []),
                ].join(" ")}
          </p>
        )}
        {member !== undefined && (
          <Callout tone="warning">
            <p>{form.member.warning(personName(member), member.login)}</p>
            <label className="sc-check">
              <input
                type="checkbox"
                checked={convert}
                disabled={props.busy === true}
                onChange={(event) => setConverting(event.target.checked ? spelled : undefined)}
              />
              {form.member.confirm}
            </label>
          </Callout>
        )}
      </section>
      <section className="sc-form-part" aria-label={form.reports}>
        <h2 className="sc-section-title">{form.reports}</h2>
        <div className="sc-field-row">
          <div className="sc-field">
            <span className="sc-field-label">{form.manager}</span>
            <Picker
              value={manager}
              search={peopleSearch(props.people.filter((person) => person.status === "active"))}
              keyOf={(person) => person.id}
              render={(person) => <PersonChip person={person} />}
              renderOption={(person) => <PersonOption person={person} />}
              label={form.manager}
              placeholder={words.people.nobody}
              disabled={props.busy === true}
              onChange={(person) => setManager(person)}
            />
          </div>
          <label className="sc-field">
            <span className="sc-field-label">{form.project}</span>
            <select
              className="sc-input"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              {props.projects.map((candidate) => (
                <option key={candidate.id} value={candidate.key}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="sc-field-hint">{form.managerHint}</p>
      </section>
      {props.error !== undefined && <Callout tone="danger">{props.error}</Callout>}
      <div className="sc-form-actions">
        <Button type="submit" variant="primary" disabled={props.busy === true || !valid}>
          {form.submit}
        </Button>
        {props.onCancel !== undefined && (
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            {words.common.cancel}
          </Button>
        )}
        <span className="sc-field-hint">{form.next}</span>
      </div>
    </form>
  );
}
