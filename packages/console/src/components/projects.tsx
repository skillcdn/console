import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  COLOR_NAMES,
  type ColorName,
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_SYMBOL_LENGTH,
  MAX_SKILLS_ADDRESS_LENGTH,
  PROJECT_ICON_TYPES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  type ProjectRole,
  type ProjectVisibility,
  projectColorOf,
  projectIconPath,
  projectSymbolOf,
  type RestMember,
  type RestMemberInput,
  type RestPerson,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Badge, Button, cx, PersonChip, personName, Time } from "./ui.js";

/** A project's mark: its symbol on its colour, so that projects tell apart at a glance. */
export function ProjectMark(props: {
  readonly project: {
    readonly key: string;
    readonly name: string;
    readonly color: ColorName | null;
    readonly symbol: string | null;
    /** The project's own image, when it has one; the symbol on the colour otherwise. */
    readonly icon?: { readonly sha256: string } | null | undefined;
  };
  readonly size?: "sm" | "md" | "lg";
  /** Where the image is read from; the console's own path for it when left out. */
  readonly iconSrc?: string | undefined;
}) {
  const size = props.size ?? "md";
  const icon = props.project.icon ?? null;
  const src =
    props.iconSrc ?? (icon === null ? undefined : projectIconPath(props.project.key, icon));
  return (
    <span
      className={cx(
        "sc-mark",
        `sc-mark-${size}`,
        `sc-category-${projectColorOf(props.project)}`,
        src !== undefined && "sc-mark-pictured",
      )}
      aria-hidden="true"
    >
      {src === undefined ? (
        projectSymbolOf(props.project)
      ) : (
        <img className="sc-mark-image" src={src} alt="" />
      )}
    </span>
  );
}

// The projects of the workspace (ADR-0008): the list a person may see, the way to make one,
// a project's settings for its owners, and those listed in it. Each takes its data as props
// and nothing from the network; what people wrote is shown as text, never as HTML.

/** The words of a project's roles and visibilities in English: the default pack's. */
export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  owner: "Owner",
  member: "Member",
};

export const VISIBILITY_LABELS: Readonly<Record<ProjectVisibility, string>> = {
  workspace: "Everyone of the workspace",
  private: "Only those listed",
};

export function ProjectRoleBadge(props: { readonly role: ProjectRole }) {
  const words = useWords();
  return (
    <Badge tone={props.role === "owner" ? "point" : "neutral"}>
      {words.vocabulary.projectRole[props.role]}
    </Badge>
  );
}

export interface ProjectListProps {
  readonly projects: readonly RestProject[];
  /** The link to a project's board, as the composition routes it. */
  readonly projectHref: (project: RestProject) => string;
  readonly onOpen: (project: RestProject) => void;
  readonly empty?: ReactNode;
}

export function ProjectList(props: ProjectListProps) {
  const words = useWords().projects;
  if (props.projects.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  return (
    <ul className="sc-projects" aria-label={words.list}>
      {props.projects.map((project) => (
        <li key={project.id} className="sc-project">
          <div className="sc-project-head">
            <ProjectMark project={project} size="md" />
            <a
              className="sc-project-name"
              href={props.projectHref(project)}
              onClick={(event) => {
                if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                  event.preventDefault();
                  props.onOpen(project);
                }
              }}
            >
              {project.name}
            </a>
            <code className="sc-project-key">{project.key}</code>
            <ProjectRoleBadge role={project.role} />
            {project.visibility === "private" && <Badge tone="neutral">{words.private}</Badge>}
          </div>
          {project.description.length > 0 && (
            <p className="sc-project-description">{project.description}</p>
          )}
          {project.openDecisions > 0 && (
            <p className="sc-project-meta">
              <Badge tone="warning">{words.decisionsWaiting(project.openDecisions)}</Badge>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface ProjectFormProps {
  /** The project to change; left out, the form makes a new one, with a key. */
  readonly project?: RestProject | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  /**
   * Called with the settings as they are to be, and the image for the mark: a file chosen,
   * `null` to take the image away, or nothing to keep what the project has.
   */
  readonly onSubmit: (input: RestProjectInput | RestProjectPatch, icon?: File | null) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** A key as a person types a name: lowercase letters, digits and hyphens, from what they typed. */
export function keyOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, MAX_PROJECT_KEY_LENGTH);
}

export function ProjectForm(props: ProjectFormProps) {
  const words = useWords();
  const form = words.projects.form;
  const { project } = props;
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(project !== undefined);
  const [description, setDescription] = useState(project?.description ?? "");
  const [visibility, setVisibility] = useState<ProjectVisibility>(project?.visibility ?? "private");
  const [skillsAddress, setSkillsAddress] = useState(project?.skillsAddress ?? "");
  const [color, setColor] = useState<ColorName | "">(project?.color ?? "");
  const [symbol, setSymbol] = useState(project?.symbol ?? "");
  /** The image for the mark: a file chosen, `null` for none any more, nothing to keep the project's. */
  const [icon, setIcon] = useState<File | null | undefined>(undefined);
  const chosenSrc = useMemo(
    () => (icon instanceof File ? URL.createObjectURL(icon) : undefined),
    [icon],
  );
  useEffect(
    () => () => {
      if (chosenSrc !== undefined) {
        URL.revokeObjectURL(chosenSrc);
      }
    },
    [chosenSrc],
  );
  const kept = icon === undefined ? (project?.icon ?? null) : null;
  /** The mark as it will be, from what is typed and chosen so far. */
  const preview = {
    key: key.trim() === "" ? keyOf(name) : key.trim(),
    name: name.trim() === "" ? "?" : name.trim(),
    color: color === "" ? null : color,
    symbol: symbol.trim() === "" ? null : symbol.trim(),
    icon: icon instanceof File ? { sha256: "chosen" } : kept,
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const settings: RestProjectPatch = {
      name: name.trim(),
      description: description.trim(),
      visibility,
      skillsAddress: skillsAddress.trim() === "" ? null : skillsAddress.trim(),
      color: preview.color,
      symbol: preview.symbol,
    };
    props.onSubmit(
      project === undefined ? { key: key.trim(), ...settings, name: name.trim() } : settings,
      icon,
    );
  };

  return (
    <form className="sc-form" onSubmit={submit}>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">{form.name}</span>
          <input
            className="sc-input"
            value={name}
            maxLength={MAX_PROJECT_NAME_LENGTH}
            required
            onChange={(event) => {
              setName(event.target.value);
              if (!keyTouched) {
                setKey(keyOf(event.target.value));
              }
            }}
          />
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{form.key}</span>
          <input
            className="sc-input"
            value={key}
            maxLength={MAX_PROJECT_KEY_LENGTH}
            pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
            required
            disabled={project !== undefined}
            title={form.keyHint}
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value);
            }}
          />
        </label>
      </div>
      <label className="sc-field">
        <span className="sc-field-label">{form.description}</span>
        <textarea
          className="sc-input sc-textarea"
          value={description}
          maxLength={MAX_PROJECT_DESCRIPTION_LENGTH}
          rows={2}
          placeholder={form.descriptionPlaceholder}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">{form.whoIsMember}</span>
          <select
            className="sc-input"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as ProjectVisibility)}
          >
            {PROJECT_VISIBILITIES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {words.vocabulary.visibility[candidate]}
              </option>
            ))}
          </select>
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{form.skillsAddress}</span>
          <input
            className="sc-input"
            value={skillsAddress}
            maxLength={MAX_SKILLS_ADDRESS_LENGTH}
            placeholder={form.skillsAddressPlaceholder}
            onChange={(event) => setSkillsAddress(event.target.value)}
          />
        </label>
      </div>
      <div className="sc-field-row sc-mark-row">
        <ProjectMark project={preview} size="lg" iconSrc={chosenSrc} />
        <label className="sc-field">
          <span className="sc-field-label">{form.symbol}</span>
          <input
            className="sc-input"
            value={symbol}
            maxLength={MAX_PROJECT_SYMBOL_LENGTH}
            pattern="\S*"
            placeholder={projectSymbolOf({ name: preview.name, symbol: null })}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{form.color}</span>
          <select
            className="sc-input"
            value={color}
            onChange={(event) => setColor(event.target.value as ColorName | "")}
          >
            <option value="">{form.colorAuto}</option>
            {COLOR_NAMES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {words.vocabulary.categoryColor[candidate]}
              </option>
            ))}
          </select>
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{form.image}</span>
          <input
            key={icon === null ? "none" : "some"}
            className="sc-input sc-input-file"
            type="file"
            accept={PROJECT_ICON_TYPES.join(",")}
            onChange={(event) => setIcon(event.target.files?.[0] ?? undefined)}
          />
        </label>
        {(icon instanceof File || kept !== null) && (
          <Button variant="ghost" size="sm" onClick={() => setIcon(null)}>
            {form.imageRemove}
          </Button>
        )}
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
          disabled={props.busy === true || name.trim() === "" || key.trim() === ""}
        >
          {project === undefined ? form.make : words.common.save}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" onClick={props.onCancel}>
            {words.common.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

export interface MemberListProps {
  readonly members: readonly RestMember[];
  /** The people of the workspace who may be listed: those not listed yet are offered. */
  readonly people: readonly RestPerson[];
  /** Whoever is looking, so that their own row says so. */
  readonly me?: RestPerson | undefined;
  /** Called with a person to list, and what they are to be. Left out, the list is read here, not changed. */
  readonly onAdd?: ((input: RestMemberInput) => void) | undefined;
  readonly onChangeRole?: ((member: RestMember, role: ProjectRole) => void) | undefined;
  readonly onRemove?: ((member: RestMember) => void) | undefined;
  /** Where a member's work is seen; given to the project's owners. */
  readonly workHref?: ((member: RestMember) => string) | undefined;
  readonly busy?: boolean | undefined;
  readonly empty?: ReactNode;
}

export function MemberList(props: MemberListProps) {
  const words = useWords();
  const members = words.projects.members;
  const listed = new Set(props.members.map((member) => member.person.id));
  const candidates = props.people.filter((person) => !listed.has(person.id));
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState<ProjectRole>("member");
  return (
    <div className="sc-members">
      {props.members.length === 0 ? (
        (props.empty ?? null)
      ) : (
        <ul className="sc-people" aria-label={members.list}>
          {props.members.map((member) => (
            <li key={member.person.id} className="sc-person-row">
              <PersonChip person={member.person} size="md" />
              <span className="sc-person-name">
                {member.person.name ?? ""}
                {props.me?.id === member.person.id && (
                  <span className="sc-muted"> {words.common.you}</span>
                )}
                <span className="sc-muted">
                  {" "}
                  {members.since} <Time iso={member.addedAt} />
                </span>
              </span>
              {props.onChangeRole === undefined ? (
                <ProjectRoleBadge role={member.role} />
              ) : (
                <label className="sc-field sc-field-inline">
                  <span className="sc-visually-hidden">
                    {members.roleOf(personName(member.person))}
                  </span>
                  <select
                    className="sc-input"
                    value={member.role}
                    disabled={props.busy === true}
                    onChange={(event) =>
                      props.onChangeRole?.(member, event.target.value as ProjectRole)
                    }
                  >
                    {PROJECT_ROLES.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {words.vocabulary.projectRole[candidate]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {props.workHref !== undefined && (
                <a className="sc-button sc-button-ghost sc-button-sm" href={props.workHref(member)}>
                  {words.people.work}
                </a>
              )}
              {props.onRemove !== undefined && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={props.busy === true}
                  onClick={() => props.onRemove?.(member)}
                >
                  {words.common.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.onAdd !== undefined && candidates.length > 0 && (
        <form
          className="sc-form sc-member-form"
          aria-label={members.addAria}
          onSubmit={(event) => {
            event.preventDefault();
            if (personId !== "") {
              props.onAdd?.({ personId, role });
              setPersonId("");
            }
          }}
        >
          <div className="sc-field-row">
            <label className="sc-field">
              <span className="sc-field-label">{members.person}</span>
              <select
                className="sc-input"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
              >
                <option value="">{members.chooseSomeone}</option>
                {candidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {personName(person)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sc-field">
              <span className="sc-field-label">{members.as}</span>
              <select
                className="sc-input"
                value={role}
                onChange={(event) => setRole(event.target.value as ProjectRole)}
              >
                {PROJECT_ROLES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {words.vocabulary.projectRole[candidate]}
                  </option>
                ))}
              </select>
            </label>
            <div className="sc-form-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={props.busy === true || personId === ""}
              >
                {members.add}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
