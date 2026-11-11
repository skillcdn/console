import { type FormEvent, useId, useMemo, useState } from "react";
import {
  isDomain,
  isHandle,
  PEOPLE_VISIBILITIES,
  type PeopleVisibility,
  type RestMe,
  type RestWorkspace,
  type RestWorkspacePatch,
  SERVICE_ROLES,
  type ServiceRole,
  serviceProblem,
  WEEK_STARTS,
  type WeekStart,
} from "../api.js";
import { DEFAULT_LANGUAGES, packFor, useWords } from "../i18n/index.js";
import {
  SERVICE_PROVIDERS,
  type ServiceProvider,
  serviceAccountOf,
  serviceNamesOf,
  serviceProviderOf,
} from "../services.js";
import { CONSOLE_LANGUAGES } from "../vocabulary.js";
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

/** The workspace's language (ADR-0081), or none. */
export function workspaceLanguageOf(workspace: RestWorkspace | undefined): string | undefined {
  return workspace?.language ?? undefined;
}

/** A language as it calls itself, `한국어`, from the packs the package ships; the tag where none speaks it. */
const languageLabel = (tag: string): string => packFor(tag, DEFAULT_LANGUAGES)?.label ?? tag;

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
  /**
   * The console's version with the range of command versions it takes, as `GET /api/v1/me`
   * says them (ADR-0025): shown first, so that whoever keeps the agents' commands up to date
   * reads here which console they must match. Left out, nothing is said.
   */
  readonly console?: RestMe["console"];
}

/** The settings as they stand, one row each; where they are changed is the page's business. */
export function WorkspaceSettingsView(props: WorkspaceSettingsViewProps) {
  const words = useWords();
  const settings = words.settings.workspace;
  const zone = timeZoneOf(props.workspace);
  const device = deviceTimeZone();
  const offset = zone === undefined ? undefined : offsetOf(zone, new Date());
  const language = workspaceLanguageOf(props.workspace);
  return (
    <dl className="sc-settings-list">
      {props.console !== undefined && (
        <div className="sc-settings-item">
          <dt>{settings.consoleVersion}</dt>
          <dd>
            {props.console.version}
            <span className="sc-settings-note">
              {settings.consoleTakes(props.console.clientRange)}
            </span>
          </dd>
        </div>
      )}
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
      <div className="sc-settings-item">
        <dt>{settings.language}</dt>
        <dd>{language === undefined ? settings.languageNone : languageLabel(language)}</dd>
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
  const ids = { people: useId(), week: useId(), zone: useId(), language: useId() };
  const current = {
    peopleVisibility: peopleVisibilityOf(props.workspace),
    weekStart: weekStartOf(props.workspace),
    timeZone: timeZoneOf(props.workspace) ?? "",
    language: workspaceLanguageOf(props.workspace) ?? "",
  };
  const [peopleVisibility, setPeopleVisibility] = useState<PeopleVisibility>(
    current.peopleVisibility,
  );
  const [weekStart, setWeekStart] = useState<WeekStart>(current.weekStart);
  const [timeZone, setTimeZone] = useState(current.timeZone);
  const [language, setLanguage] = useState(current.language);
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
    ...(language === current.language
      ? {}
      : {
          language: CONSOLE_LANGUAGES.find((candidate) => candidate === language) ?? null,
        }),
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
      <div className="sc-settings-row">
        <div className="sc-settings-words">
          <label className="sc-settings-label" htmlFor={ids.language}>
            {settings.language}
          </label>
          <p className="sc-settings-hint">{settings.languageHint}</p>
        </div>
        <div className="sc-settings-control">
          <select
            id={ids.language}
            className="sc-input"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">{settings.languageNone}</option>
            {CONSOLE_LANGUAGES.map((candidate) => (
              <option key={candidate} value={candidate} lang={candidate}>
                {languageLabel(candidate)}
              </option>
            ))}
          </select>
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

/** The kinds a role's service is chosen among: the ones the package knows for it. */
const kindsFor = (role: ServiceRole): readonly ServiceProvider[] =>
  SERVICE_PROVIDERS.filter((provider) => provider.roles.includes(role));

/** The parameters the form asks of a kind the package knows, beside the account's template. */
const PARAMETERS: Readonly<
  Record<string, readonly ("organization" | "workspace" | "group" | "host" | "form")[]>
> = {
  github: ["organization"],
  gitlab: ["group", "host", "form"],
  "google-workspace": [],
  slack: ["workspace"],
};

/** The forms of account a git host has, for the kinds that have more than a person's. */
const FORMS = ["user", "service"] as const;

/** The services a workspace's agents work with (ADR-0089), as they stand: a row each. */
export function WorkspaceServicesView(props: { readonly workspace: RestWorkspace }) {
  const words = useWords().settings.services;
  const { workspace } = props;
  const names = serviceNamesOf(workspace, "mira");
  return (
    <dl className="sc-settings-list">
      <div className="sc-settings-item">
        <dt>{words.handle}</dt>
        <dd>{workspace.handle ?? words.none}</dd>
      </div>
      <div className="sc-settings-item">
        <dt>{words.domain}</dt>
        <dd>{workspace.domain ?? words.none}</dd>
      </div>
      {SERVICE_ROLES.map((role) => {
        const service = workspace.services?.[role];
        const account = service === undefined ? undefined : serviceAccountOf(service, names);
        return (
          <div key={role} className="sc-settings-item">
            <dt>{words.roles[role]}</dt>
            <dd>
              {service === undefined ? (
                words.none
              ) : (
                <>
                  {serviceProviderOf(service.kind ?? "").name}
                  {Object.entries(service)
                    .filter(([name]) => name !== "kind")
                    .map(([name, value]) => (
                      <span key={name} className="sc-muted">
                        {" "}
                        · {name}: {value}
                      </span>
                    ))}
                  {account !== undefined && (
                    <span className="sc-settings-note">{words.example(account)}</span>
                  )}
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export interface WorkspaceServicesFormProps {
  readonly workspace: RestWorkspace;
  readonly busy?: boolean | undefined;
  /** Called with what changed; nothing is sent when nothing did. */
  readonly onSubmit: (patch: RestWorkspacePatch) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** A role's service as the form holds it: its kind, `""` for none, and its parameters as typed. */
type ServiceDraft = Readonly<Record<string, string>>;

const draftOf = (service: Readonly<Record<string, string>> | undefined): ServiceDraft =>
  service === undefined ? { kind: "" } : { ...service };

/** A draft as it is sent: nothing for none, and no parameter left empty. */
const serviceOf = (draft: ServiceDraft): Record<string, string> | null => {
  const kind = (draft.kind ?? "").trim();
  if (kind.length === 0) {
    return null;
  }
  const service: Record<string, string> = { kind };
  for (const [name, value] of Object.entries(draft)) {
    if (name !== "kind" && value.trim().length > 0) {
      service[name] = value.trim();
    }
  }
  return service;
};

const same = (a: Record<string, string> | null, b: Record<string, string> | null): boolean =>
  JSON.stringify(a === null ? null : Object.entries(a).sort()) ===
  JSON.stringify(b === null ? null : Object.entries(b).sort());

/**
 * Where an administrator names the organization's short name, its domain and the services its
 * agents work with (ADR-0089). A kind the package knows asks for its own parameters; another is
 * named by its kind, and takes its parameters from the command.
 */
export function WorkspaceServicesForm(props: WorkspaceServicesFormProps) {
  const all = useWords();
  const words = all.settings.services;
  const { workspace } = props;
  const [handle, setHandle] = useState(workspace.handle ?? "");
  const [domain, setDomain] = useState(workspace.domain ?? "");
  const [drafts, setDrafts] = useState<Readonly<Record<ServiceRole, ServiceDraft>>>({
    identity: draftOf(workspace.services?.identity),
    git: draftOf(workspace.services?.git),
    messenger: draftOf(workspace.services?.messenger),
  });
  const set = (role: ServiceRole, name: string, value: string) =>
    setDrafts((current) => ({ ...current, [role]: { ...current[role], [name]: value } }));
  const patch: RestWorkspacePatch = {};
  const short = handle.trim().toLowerCase();
  const web = domain.trim().toLowerCase();
  if (short !== (workspace.handle ?? "")) {
    patch.handle = short.length === 0 ? null : short;
  }
  if (web !== (workspace.domain ?? "")) {
    patch.domain = web.length === 0 ? null : web;
  }
  const services: Partial<Record<ServiceRole, Record<string, string> | null>> = {};
  for (const role of SERVICE_ROLES) {
    const next = serviceOf(drafts[role]);
    if (!same(next, workspace.services?.[role] ?? null)) {
      services[role] = next;
    }
  }
  if (Object.keys(services).length > 0) {
    patch.services = services;
  }
  const unchanged = Object.keys(patch).length === 0;
  const invalid =
    (short.length > 0 && !isHandle(short)) ||
    (web.length > 0 && !isDomain(web)) ||
    SERVICE_ROLES.some((role) => {
      const service = serviceOf(drafts[role]);
      return service !== null && serviceProblem(role, service) !== undefined;
    });
  const names = {
    workspace: short.length === 0 ? null : short,
    agent: "mira",
    domain: web.length === 0 ? null : web,
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!unchanged && !invalid && props.busy !== true) {
      props.onSubmit(patch);
    }
  };
  return (
    <form className="sc-form" onSubmit={submit}>
      <p className="sc-field-hint">{words.intro}</p>
      <label className="sc-field">
        <span className="sc-field-label">{words.handle}</span>
        <input
          className="sc-input"
          value={handle}
          autoComplete="off"
          onChange={(event) => setHandle(event.target.value)}
        />
        <span className="sc-field-hint">{words.handleHint}</span>
      </label>
      <label className="sc-field">
        <span className="sc-field-label">{words.domain}</span>
        <input
          className="sc-input"
          value={domain}
          autoComplete="off"
          onChange={(event) => setDomain(event.target.value)}
        />
        <span className="sc-field-hint">{words.domainHint}</span>
      </label>
      {SERVICE_ROLES.map((role) => {
        const draft = drafts[role];
        const kind = draft.kind ?? "";
        const known = kindsFor(role);
        const other = kind.length > 0 && !known.some((provider) => provider.kind === kind);
        const service = serviceOf(draft);
        const account = service === null ? undefined : serviceAccountOf(service, names);
        return (
          <fieldset key={role} className="sc-fieldset sc-service-fields">
            <legend className="sc-field-label">{words.roles[role]}</legend>
            <span className="sc-field-hint">{words.roleHints[role]}</span>
            <label className="sc-field">
              <span className="sc-field-label">{words.kind}</span>
              <select
                className="sc-input"
                value={other ? "*" : kind}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [role]: { kind: event.target.value === "*" ? "other" : event.target.value },
                  }))
                }
              >
                <option value="">{words.noService}</option>
                {known.map((provider) => (
                  <option key={provider.kind} value={provider.kind}>
                    {provider.name}
                  </option>
                ))}
                <option value="*">{words.other}</option>
              </select>
            </label>
            {other && (
              <label className="sc-field">
                <span className="sc-field-label">{words.otherKind}</span>
                <input
                  className="sc-input"
                  value={kind}
                  autoComplete="off"
                  onChange={(event) => set(role, "kind", event.target.value)}
                />
              </label>
            )}
            {(PARAMETERS[kind] ?? []).map((name) =>
              name === "form" ? (
                // One of the forms the host has: left as it is, a person's.
                <label key={name} className="sc-field">
                  <span className="sc-field-label">{words.parameters.form}</span>
                  <select
                    className="sc-input"
                    value={draft.form ?? ""}
                    onChange={(event) => set(role, "form", event.target.value)}
                  >
                    <option value="">{words.forms.user}</option>
                    {FORMS.filter((form) => form !== "user").map((form) => (
                      <option key={form} value={form}>
                        {words.forms[form]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={name} className="sc-field">
                  <span className="sc-field-label">{words.parameters[name]}</span>
                  <input
                    className="sc-input"
                    value={draft[name] ?? ""}
                    autoComplete="off"
                    onChange={(event) => set(role, name, event.target.value)}
                  />
                </label>
              ),
            )}
            {serviceProviderOf(kind).account !== undefined && !other && kind.length > 0 && (
              <label className="sc-field">
                <span className="sc-field-label">{words.parameters.account}</span>
                <input
                  className="sc-input"
                  value={draft.account ?? ""}
                  placeholder={serviceProviderOf(kind).account}
                  autoComplete="off"
                  onChange={(event) => set(role, "account", event.target.value)}
                />
                <span className="sc-field-hint">{words.accountHint}</span>
              </label>
            )}
            {account !== undefined && (
              <span className="sc-field-hint">{words.example(account)}</span>
            )}
          </fieldset>
        );
      })}
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy === true || unchanged || invalid}
        >
          {all.common.save}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" onClick={props.onCancel}>
            {all.common.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
