import { type FormEvent, useMemo, useState } from "react";
import {
  PEOPLE_VISIBILITIES,
  type PeopleVisibility,
  type RestWorkspace,
  type RestWorkspacePatch,
  WEEK_STARTS,
  type WeekStart,
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

/** The day the calendars begin a week on, as the workspace says, or as the language has it. */
export function weekStartOf(workspace: RestWorkspace | undefined): WeekStart {
  return workspace?.weekStart ?? "auto";
}

/** The workspace's time zone, or none. */
export function timeZoneOf(workspace: RestWorkspace | undefined): string | undefined {
  return workspace?.timeZone ?? undefined;
}

/** The shape of a time zone's name, as the API takes one; the console says whether it is a zone. */
const TIME_ZONE = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/;

/** The zones this browser knows, for the form to offer; none where it cannot say. */
function knownTimeZones(): readonly string[] {
  try {
    const intl = Intl as typeof Intl & {
      readonly supportedValuesOf?: (key: "timeZone") => string[];
    };
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export interface WorkspaceSettingsViewProps {
  readonly workspace: RestWorkspace;
  /** Where the settings are changed; given to an administrator. */
  readonly editHref?: string | undefined;
}

export function WorkspaceSettingsView(props: WorkspaceSettingsViewProps) {
  const words = useWords();
  const settings = words.settings.workspace;
  const zone = timeZoneOf(props.workspace);
  return (
    <div className="sc-workspace-settings">
      <dl className="sc-facts sc-facts-plain">
        <div>
          <dt>{settings.peopleVisibility}</dt>
          <dd>{words.vocabulary.peopleVisibility[peopleVisibilityOf(props.workspace)]}</dd>
        </div>
        <div>
          <dt>{settings.weekStart}</dt>
          <dd>{words.vocabulary.weekStart[weekStartOf(props.workspace)]}</dd>
        </div>
        <div>
          <dt>{settings.timeZone}</dt>
          <dd>{zone === undefined ? settings.timeZoneNone : <code>{zone}</code>}</dd>
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
  const current = {
    peopleVisibility: peopleVisibilityOf(props.workspace),
    weekStart: weekStartOf(props.workspace),
    timeZone: timeZoneOf(props.workspace) ?? "",
  };
  const [peopleVisibility, setPeopleVisibility] = useState<PeopleVisibility>(
    current.peopleVisibility,
  );
  const [weekStart, setWeekStart] = useState<WeekStart>(current.weekStart);
  const [timeZone, setTimeZone] = useState(current.timeZone);
  const zones = useMemo(knownTimeZones, []);
  const zone = timeZone.trim();
  const zoneValid = zone === "" || TIME_ZONE.test(zone);
  const patch: RestWorkspacePatch = {
    ...(peopleVisibility === current.peopleVisibility ? {} : { peopleVisibility }),
    ...(weekStart === current.weekStart ? {} : { weekStart }),
    ...(zone === current.timeZone ? {} : { timeZone: zone === "" ? null : zone }),
  };
  const changed = Object.keys(patch).length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed && zoneValid) {
      props.onSubmit(patch);
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
      <label className="sc-field">
        <span className="sc-field-label">{settings.weekStart}</span>
        <select
          className="sc-input"
          value={weekStart}
          onChange={(event) => setWeekStart(event.target.value as WeekStart)}
        >
          {WEEK_STARTS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {words.vocabulary.weekStart[candidate]}
            </option>
          ))}
        </select>
        <span className="sc-field-hint">{settings.weekStartHint}</span>
      </label>
      <label className="sc-field">
        <span className="sc-field-label">{settings.timeZone}</span>
        <input
          className="sc-input"
          value={timeZone}
          list={zones.length === 0 ? undefined : "sc-time-zones"}
          placeholder="Asia/Seoul"
          autoComplete="off"
          onChange={(event) => setTimeZone(event.target.value)}
        />
        {zones.length > 0 && (
          <datalist id="sc-time-zones">
            {zones.map((candidate) => (
              <option key={candidate} value={candidate} />
            ))}
          </datalist>
        )}
        <span className="sc-field-hint">{settings.timeZoneHint}</span>
      </label>
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy === true || !changed || !zoneValid}
        >
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
