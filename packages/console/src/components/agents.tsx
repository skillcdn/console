import { type FormEvent, useContext, useEffect, useState } from "react";
import {
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
} from "../api.js";
import { type AvatarSet, avatarScanlines, MAX_AVATAR_PIXELS, pngFile } from "../avatar.js";
import { useWords } from "../i18n/index.js";
import {
  MAX_HANDLE_LENGTH,
  MAX_LOGIN_LENGTH,
  MAX_PERSON_NAME_LENGTH,
  MAX_PERSON_TITLE_LENGTH,
} from "../limits.js";
import { AgentStateBadge } from "./agent-page.js";
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

export interface AgentAccountListProps {
  readonly agents: readonly RestAgent[];
  readonly busy?: boolean | undefined;
  /** Shown where there is no agent account to list. */
  readonly empty?: React.ReactNode;
  /** Where an account's own page is; left out, its name is not a link. */
  readonly href?: ((agent: RestAgent) => string) | undefined;
}

/** The workspace's agent accounts: who each is, the login it signs in with, and whom it reports to. */
export function AgentAccountList(props: AgentAccountListProps) {
  const words = useWords();
  const accounts = words.agents.accounts;
  const sets = useContext(AvatarSetsContext);
  const [saving, setSaving] = useState<string | undefined>(undefined);
  if (props.agents.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  const save = (agent: RestAgent) => {
    const parts = agent.person.avatarParts;
    if (parts === null || parts === undefined) {
      return;
    }
    setSaving(agent.person.id);
    void avatarPngBlob(parts, MAX_AVATAR_PIXELS, sets)
      .then((blob) => saveBlob(blob, `${agent.person.handle ?? "avatar"}.png`))
      .catch(() => undefined)
      .finally(() => setSaving(undefined));
  };
  return (
    <ul className="sc-people sc-agent-accounts" aria-label={accounts.list}>
      {props.agents.map((agent) => {
        const { person, manager } = agent;
        const name = personName(person);
        const out = person.status !== "active";
        return (
          <li key={person.id} className={cx("sc-person-card", out && "sc-person-card-out")}>
            <div className="sc-person-card-head">
              <Avatar person={person} size="lg" />
              <div className="sc-person-card-who">
                <span className="sc-person-card-name">
                  {props.href === undefined ? name : <a href={props.href(agent)}>{name}</a>}
                  <AgentStateBadge state={agent.state} />
                  {person.invited === true && <Badge tone="warning">{accounts.invited}</Badge>}
                  {out && <Badge>{words.people.deactivated}</Badge>}
                </span>
                {(person.title ?? "") !== "" && (
                  <span className="sc-person-card-title">{person.title}</span>
                )}
                <span className="sc-person-card-note">
                  @{person.handle} · {accounts.signsInAs(person.login)}
                </span>
              </div>
            </div>
            <dl className="sc-person-facts">
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
            </dl>
            {person.invited === true && <p className="sc-field-hint">{accounts.invitedHint}</p>}
            {agent.supervised &&
              person.avatarParts !== null &&
              person.avatarParts !== undefined && (
                <div className="sc-person-card-ways">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={props.busy === true || saving === person.id}
                    title={accounts.savePictureHint}
                    onClick={() => save(agent)}
                  >
                    {accounts.savePicture}
                  </Button>
                </div>
              )}
          </li>
        );
      })}
    </ul>
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

export interface AgentAccountFormProps {
  /** A few personas to choose from, rolled again with `onRoll`; none while they are asked for. */
  readonly proposals: readonly RestAgentProposal[];
  /** Called to roll the proposals again. Left out, there is no such button. */
  readonly onRoll?: (() => void) | undefined;
  /** The providers people sign in through here: what the account's login is at. */
  readonly providers: readonly RestProvider[];
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
 * "Add an agent account": a persona chosen among the proposals and edited, the login it will
 * sign in with, its manager, and the project it starts in. What a person does first at the
 * provider is said in plain words, since the account there is a person's to make.
 */
export function AgentAccountForm(props: AgentAccountFormProps) {
  const words = useWords();
  const form = words.agents.accounts.form;
  const [chosen, setChosen] = useState<RestAgentProposal | undefined>(undefined);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [host, setHost] = useState<ProviderKey | undefined>(props.providers[0]?.key);
  /** The login as typed; while nothing was typed, the one the handle and the provider suggest. */
  const [typedLogin, setTypedLogin] = useState<string | undefined>(undefined);
  const [manager, setManager] = useState<RestPerson | undefined>(props.me);
  const [project, setProject] = useState(props.projects[0]?.key ?? "");
  const provider = props.providers.find((candidate) => candidate.key === host);
  const login = typedLogin ?? suggestLogin(handle, provider);

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
  const valid =
    chosen !== undefined &&
    name.trim() !== "" &&
    handleOk &&
    loginOk &&
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
    });
  };
  return (
    <form className="sc-form sc-agent-form" aria-label={form.aria} onSubmit={submit}>
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
          {props.onRoll !== undefined && (
            <Button type="button" size="sm" disabled={props.busy === true} onClick={props.onRoll}>
              {form.roll}
            </Button>
          )}
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
      <div className="sc-field-row">
        {props.providers.length > 1 && (
          <label className="sc-field">
            <span className="sc-field-label">{form.provider}</span>
            <select
              className="sc-input"
              value={host ?? ""}
              onChange={(event) => setHost(event.target.value as ProviderKey)}
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
          <span className="sc-field-label">{form.login}</span>
          <input
            className="sc-input"
            value={login}
            maxLength={MAX_LOGIN_LENGTH}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={login !== "" && !loginOk}
            onChange={(event) => setTypedLogin(event.target.value)}
          />
        </label>
      </div>
      {provider !== undefined && (
        <Callout tone="info" title={form.first.title(provider.label)}>
          <p>
            {login.trim() === ""
              ? form.first.unnamed(provider.label)
              : form.first.make(login.trim(), provider.label)}
          </p>
          <p>{provider.key === "gh" ? form.first.gitHost : form.first.password}</p>
        </Callout>
      )}
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
      </div>
    </form>
  );
}
