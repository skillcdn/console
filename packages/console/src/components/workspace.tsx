import { type FormEvent, useState } from "react";
import {
  PEOPLE_VISIBILITIES,
  type PeopleVisibility,
  type RestWorkspace,
  type RestWorkspacePatch,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Button } from "./ui.js";

// The workspace's own settings (ADR-0035), as an administrator keeps them on the Settings page:
// read by everyone, so that a member knows what the board shows them; changed on a form of
// their own. Takes its data as props and nothing from the network.

/** What a workspace is set to until an administrator says otherwise, for a console that answers no setting. */
export const DEFAULT_PEOPLE_VISIBILITY: PeopleVisibility = "everyone";

/** Who sees whom, as the workspace says, or as a console older than the setting would have it. */
export function peopleVisibilityOf(workspace: RestWorkspace | undefined): PeopleVisibility {
  return workspace?.peopleVisibility ?? DEFAULT_PEOPLE_VISIBILITY;
}

export interface WorkspaceSettingsViewProps {
  readonly workspace: RestWorkspace;
  /** Where the settings are changed; given to an administrator. */
  readonly editHref?: string | undefined;
}

export function WorkspaceSettingsView(props: WorkspaceSettingsViewProps) {
  const words = useWords();
  const settings = words.settings.workspace;
  return (
    <div className="sc-workspace-settings">
      <dl className="sc-facts sc-facts-plain">
        <div>
          <dt>{settings.peopleVisibility}</dt>
          <dd>{words.vocabulary.peopleVisibility[peopleVisibilityOf(props.workspace)]}</dd>
        </div>
      </dl>
      {props.editHref !== undefined && (
        <a className="sc-button sc-button-secondary" href={props.editHref}>
          {settings.edit}
        </a>
      )}
    </div>
  );
}

export interface WorkspaceSettingsFormProps {
  readonly workspace: RestWorkspace;
  readonly busy?: boolean | undefined;
  /** Called with what changed; nothing is sent when nothing did. */
  readonly onSubmit: (patch: RestWorkspacePatch) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** Where an administrator changes the workspace's settings (ADR-0035). */
export function WorkspaceSettingsForm(props: WorkspaceSettingsFormProps) {
  const words = useWords();
  const settings = words.settings.workspace;
  const current = peopleVisibilityOf(props.workspace);
  const [peopleVisibility, setPeopleVisibility] = useState<PeopleVisibility>(current);
  const changed = peopleVisibility !== current;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed) {
      props.onSubmit({ peopleVisibility });
    }
  };
  return (
    <form className="sc-form sc-workspace-form" aria-label={settings.aria} onSubmit={submit}>
      <label className="sc-field">
        <span className="sc-field-label">{settings.peopleVisibility}</span>
        <select
          className="sc-input"
          value={peopleVisibility}
          onChange={(event) => setPeopleVisibility(event.target.value as PeopleVisibility)}
        >
          {PEOPLE_VISIBILITIES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {words.vocabulary.peopleVisibility[candidate]}
            </option>
          ))}
        </select>
        <span className="sc-field-hint">{settings.peopleVisibilityHint}</span>
      </label>
      <div className="sc-form-actions">
        <Button type="submit" variant="primary" disabled={props.busy === true || !changed}>
          {settings.save}
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
