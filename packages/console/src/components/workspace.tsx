import { type FormEvent, useId, useMemo, useState } from "react";
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
// their own, each setting a row with its words beside its control. Takes its data as props and
// nothing from the network.

/** What a workspace is set to until an administrator says otherwise, for a console that answers no setting. */
export const DEFAULT_PEOPLE_VISIBILITY: PeopleVisibility = "everyone";

/** Who sees whom, as the workspace says, or as a console older than the setting would have it. */
export function peopleVisibilityOf(workspace: RestWorkspace | undefined): PeopleVisibility {
  return workspace?.peopleVisibility ?? DEFAULT_PEOPLE_VISIBILITY;
}

/** The day the calendars begin a week on, as the workspace says, or the system default. */
export function weekStartOf(workspace: RestWorkspace | undefined): WeekStart {
  return workspace?.weekStart ?? "auto";
}

/** The workspace's time zone, or none. */
export function timeZoneOf(workspace: RestWorkspace | undefined): string | undefined {
  return workspace?.timeZone ?? undefined;
}

/** The zones this browser knows, for the picker to offer; none where it cannot say. */
export function knownTimeZones(): readonly string[] {
  try {
    const intl = Intl as typeof Intl & {
      readonly supportedValuesOf?: (key: "timeZone") => string[];
    };
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

/** The zone this device keeps time in, as the browser says; none where it cannot say. */
export function deviceTimeZone(): string | undefined {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone === undefined || zone === "" ? undefined : zone;
  } catch {
    return undefined;
  }
}

/** A zone's offset from UTC at a moment, as `UTC+09:00`; none where the browser cannot say. */
export function offsetOf(zone: string, at: Date): string | undefined {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    if (name === undefined) {
      return undefined;
    }
    return name === "GMT" ? "UTC+00:00" : name.replace(/^GMT/, "UTC");
  } catch {
    return undefined;
  }
}

export interface TimeZoneOption {
  readonly name: string;
  /** The offset now, for the person to tell zones apart by; none where the browser cannot say. */
  readonly offset: string | undefined;
}

export interface TimeZoneGroup {
  /** The area before the slash, `Asia` of `Asia/Seoul`; empty for a zone with none, such as `UTC`. */
  readonly area: string;
  readonly zones: readonly TimeZoneOption[];
}

/**
 * Zones for a picker: by their area, the areas in order, each zone with its offset at `at`; the
 * zones with no area first, since `UTC` is one. `extra` zones the browser does not list, the one
 * set and the device's, are offered too, so that the picker always shows what is chosen.
 */
export function timeZoneGroups(
  zones: readonly string[],
  at: Date,
  extra: readonly (string | undefined)[] = [],
): TimeZoneGroup[] {
  const names = new Set(zones);
  for (const name of extra) {
    if (name !== undefined && name !== "") {
      names.add(name);
    }
  }
  const groups = new Map<string, TimeZoneOption[]>();
  for (const name of [...names].sort((a, b) => a.localeCompare(b, "en"))) {
    const slash = name.indexOf("/");
    const area = slash < 0 ? "" : name.slice(0, slash);
    const list = groups.get(area) ?? [];
    list.push({ name, offset: offsetOf(name, at) });
    groups.set(area, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "en")))
    .map(([area, options]) => ({ area, zones: options }));
}

/** A zone as the picker shows it: its name, and its offset where known. */
const labelOf = (zone: TimeZoneOption): string =>
  zone.offset === undefined ? zone.name : `${zone.name} (${zone.offset})`;

export interface WorkspaceSettingsViewProps {
  readonly workspace: RestWorkspace;
}

/** The settings as they stand, one row each; where they are changed is the page's business. */
export function WorkspaceSettingsView(props: WorkspaceSettingsViewProps) {
  const words = useWords();
  const settings = words.settings.workspace;
  const zone = timeZoneOf(props.workspace);
  const device = deviceTimeZone();
  const offset = zone === undefined ? undefined : offsetOf(zone, new Date());
  return (
    <dl className="sc-settings-list">
      <div className="sc-settings-item">
        <dt>{settings.peopleVisibility}</dt>
        <dd>{words.vocabulary.peopleVisibility[peopleVisibilityOf(props.workspace)]}</dd>
      </div>
      <div className="sc-settings-item">
        <dt>{settings.weekStart}</dt>
        <dd>{words.vocabulary.weekStart[weekStartOf(props.workspace)]}</dd>
      </div>
      <div className="sc-settings-item">
        <dt>{settings.timeZone}</dt>
        <dd>
          {zone === undefined ? (
            settings.timeZoneNone
          ) : (
            <>
              {zone}
              {offset !== undefined && <span className="sc-muted"> ({offset})</span>}
            </>
          )}
          {device !== undefined && device !== zone && (
            <span className="sc-settings-note">{settings.timeZoneDevice(device)}</span>
          )}
        </dd>
      </div>
    </dl>
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
  const ids = { people: useId(), week: useId(), zone: useId() };
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
  const device = useMemo(deviceTimeZone, []);
  // UTC is offered whatever the browser lists, beside the zone set and the device's.
  const groups = useMemo(
    () => timeZoneGroups(knownTimeZones(), new Date(), ["UTC", current.timeZone, device]),
    [current.timeZone, device],
  );
  const patch: RestWorkspacePatch = {
    ...(peopleVisibility === current.peopleVisibility ? {} : { peopleVisibility }),
    ...(weekStart === current.weekStart ? {} : { weekStart }),
    ...(timeZone === current.timeZone ? {} : { timeZone: timeZone === "" ? null : timeZone }),
  };
  const changed = Object.keys(patch).length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed) {
      props.onSubmit(patch);
    }
  };
  return (
    <form className="sc-form sc-settings-form" aria-label={settings.aria} onSubmit={submit}>
      <div className="sc-settings-row">
        <div className="sc-settings-words">
          <label className="sc-settings-label" htmlFor={ids.people}>
            {settings.peopleVisibility}
          </label>
          <p className="sc-settings-hint">{settings.peopleVisibilityHint}</p>
        </div>
        <div className="sc-settings-control">
          <select
            id={ids.people}
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
        </div>
      </div>
      <div className="sc-settings-row">
        <div className="sc-settings-words">
          <label className="sc-settings-label" htmlFor={ids.week}>
            {settings.weekStart}
          </label>
          <p className="sc-settings-hint">{settings.weekStartHint}</p>
        </div>
        <div className="sc-settings-control">
          <select
            id={ids.week}
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
        </div>
      </div>
      <div className="sc-settings-row">
        <div className="sc-settings-words">
          <label className="sc-settings-label" htmlFor={ids.zone}>
            {settings.timeZone}
          </label>
          <p className="sc-settings-hint">{settings.timeZoneHint}</p>
        </div>
        <div className="sc-settings-control">
          <select
            id={ids.zone}
            className="sc-input"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
          >
            <option value="">{settings.timeZoneNone}</option>
            {groups.map((group) =>
              group.area === "" ? (
                group.zones.map((zone) => (
                  <option key={zone.name} value={zone.name}>
                    {labelOf(zone)}
                  </option>
                ))
              ) : (
                <optgroup key={group.area} label={group.area}>
                  {group.zones.map((zone) => (
                    <option key={zone.name} value={zone.name}>
                      {labelOf(zone)}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
          {device !== undefined && device !== timeZone && (
            <Button variant="ghost" size="sm" onClick={() => setTimeZone(device)}>
              {settings.timeZoneUseDevice(device)}
            </Button>
          )}
        </div>
      </div>
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
