import { type FormEvent, type ReactNode, useState } from "react";
import {
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_SKILLS_ADDRESS_LENGTH,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  type ProjectRole,
  type ProjectVisibility,
  type RestMember,
  type RestMemberInput,
  type RestPerson,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
} from "../api.js";
import { Badge, Button, PersonChip, Time } from "./ui.js";

// The projects of the workspace (ADR-0008): the list a person may see, the way to make one,
// a project's settings for its owners, and those listed in it. Each takes its data as props
// and nothing from the network; what people wrote is shown as text, never as HTML.

export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  owner: "Owner",
  member: "Member",
};

export const VISIBILITY_LABELS: Readonly<Record<ProjectVisibility, string>> = {
  workspace: "Everyone of the workspace",
  private: "Only those listed",
};

export function ProjectRoleBadge(props: { readonly role: ProjectRole }) {
  return (
    <Badge tone={props.role === "owner" ? "point" : "neutral"}>
      {PROJECT_ROLE_LABELS[props.role]}
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
  if (props.projects.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  return (
    <ul className="sc-projects" aria-label="Projects">
      {props.projects.map((project) => (
        <li key={project.id} className="sc-project">
          <div className="sc-project-head">
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
            {project.visibility === "private" && <Badge tone="neutral">Private</Badge>}
          </div>
          {project.description.length > 0 && (
            <p className="sc-project-description">{project.description}</p>
          )}
          <p className="sc-project-meta">
            {project.openDecisions > 0 && (
              <Badge tone="warning">
                {project.openDecisions === 1
                  ? "1 decision waiting"
                  : `${project.openDecisions} decisions waiting`}
              </Badge>
            )}
            {project.openRuns > 0 && (
              <Badge tone="accent">
                {project.openRuns === 1 ? "1 agent at work" : `${project.openRuns} agents at work`}
              </Badge>
            )}
          </p>
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
  readonly onSubmit: (input: RestProjectInput | RestProjectPatch) => void;
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
  const { project } = props;
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(project !== undefined);
  const [description, setDescription] = useState(project?.description ?? "");
  const [visibility, setVisibility] = useState<ProjectVisibility>(project?.visibility ?? "private");
  const [skillsAddress, setSkillsAddress] = useState(project?.skillsAddress ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const settings: RestProjectPatch = {
      name: name.trim(),
      description: description.trim(),
      visibility,
      skillsAddress: skillsAddress.trim() === "" ? null : skillsAddress.trim(),
    };
    props.onSubmit(
      project === undefined ? { key: key.trim(), ...settings, name: name.trim() } : settings,
    );
  };

  return (
    <form className="sc-form" onSubmit={submit}>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">Name</span>
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
          <span className="sc-field-label">Key</span>
          <input
            className="sc-input"
            value={key}
            maxLength={MAX_PROJECT_KEY_LENGTH}
            pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
            required
            disabled={project !== undefined}
            title="Lowercase letters, digits and hyphens: what paths and the command say. It does not change."
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value);
            }}
          />
        </label>
      </div>
      <label className="sc-field">
        <span className="sc-field-label">Description</span>
        <textarea
          className="sc-input sc-textarea"
          value={description}
          maxLength={MAX_PROJECT_DESCRIPTION_LENGTH}
          rows={2}
          placeholder="What the project is for, in a sentence or two."
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">Who is a member</span>
          <select
            className="sc-input"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as ProjectVisibility)}
          >
            {PROJECT_VISIBILITIES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {VISIBILITY_LABELS[candidate]}
              </option>
            ))}
          </select>
        </label>
        <label className="sc-field">
          <span className="sc-field-label">Skills address</span>
          <input
            className="sc-input"
            value={skillsAddress}
            maxLength={MAX_SKILLS_ADDRESS_LENGTH}
            placeholder="/gh/<owner>/<repo>, or empty for the organization's"
            onChange={(event) => setSkillsAddress(event.target.value)}
          />
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
          disabled={props.busy === true || name.trim() === "" || key.trim() === ""}
        >
          {project === undefined ? "Make the project" : "Save"}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" onClick={props.onCancel}>
            Cancel
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
  readonly busy?: boolean | undefined;
  readonly empty?: ReactNode;
}

export function MemberList(props: MemberListProps) {
  const listed = new Set(props.members.map((member) => member.person.id));
  const candidates = props.people.filter((person) => !listed.has(person.id));
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState<ProjectRole>("member");
  return (
    <div className="sc-members">
      {props.members.length === 0 ? (
        (props.empty ?? null)
      ) : (
        <ul className="sc-people" aria-label="Members">
          {props.members.map((member) => (
            <li key={member.person.id} className="sc-person-row">
              <PersonChip person={member.person} size="md" />
              <span className="sc-person-name">
                {member.person.name ?? ""}
                {props.me?.id === member.person.id && <span className="sc-muted"> (you)</span>}
                <span className="sc-muted">
                  {" "}
                  since <Time iso={member.addedAt} />
                </span>
              </span>
              {props.onChangeRole === undefined ? (
                <ProjectRoleBadge role={member.role} />
              ) : (
                <label className="sc-field sc-field-inline">
                  <span className="sc-visually-hidden">Role of {member.person.login}</span>
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
                        {PROJECT_ROLE_LABELS[candidate]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {props.onRemove !== undefined && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={props.busy === true}
                  onClick={() => props.onRemove?.(member)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.onAdd !== undefined && candidates.length > 0 && (
        <form
          className="sc-form sc-member-form"
          aria-label="Add a member"
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
              <span className="sc-field-label">Person</span>
              <select
                className="sc-input"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
              >
                <option value="">Choose someone</option>
                {candidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.login}
                  </option>
                ))}
              </select>
            </label>
            <label className="sc-field">
              <span className="sc-field-label">As</span>
              <select
                className="sc-input"
                value={role}
                onChange={(event) => setRole(event.target.value as ProjectRole)}
              >
                {PROJECT_ROLES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {PROJECT_ROLE_LABELS[candidate]}
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
                Add
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
