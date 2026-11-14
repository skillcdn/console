import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import type { ConsoleClient } from "../client.js";
import type { Messages } from "../i18n/en.js";
import { useWords } from "../i18n/index.js";
import { PLUGIN_CAPABILITIES, type PluginCapability } from "../plugin/capabilities.js";
import { settingsHref } from "../router.js";
import type {
  RestEvent,
  RestPerson,
  RestPlugin,
  RestPluginDetail,
  RestPluginEnableInput,
  RestPluginGrant,
  RestPluginGrantInput,
  RestPluginSetting,
  RestProject,
  RestTeam,
} from "../schemas.js";
import { useAction } from "../use-action.js";
import { EventFeed } from "./event-feed.js";
import { Picker } from "./picker.js";
import { listSearch, peopleSearch, projectsSearch } from "./searches.js";
import {
  Badge,
  Button,
  Callout,
  Chip,
  cx,
  EmptyState,
  formatInstant,
  LinkButton,
  personName,
  Spinner,
} from "./ui.js";

// The plugins' settings (docs/specs/plugins.md, "The settings pages"): what is installed and how
// each stands; and one plugin, read at a glance: its state in the head with the way to disable
// it, what it is on and holds a row each, the form that enables it (the capabilities to consent
// to, each by a name with what it opens, the board project, the projects), the settings form
// from the manifest with the secrets set and never shown, the roles with who holds each and the
// way to grant one, what the plugin did, export and purge. No plugin code runs here: everything
// is the console's own.

/** A text in the person's language, else in English, else the first the manifest has. */
export function pluginWord(
  texts: Readonly<Record<string, string>> | null | undefined,
  language: string,
): string {
  if (texts === null || texts === undefined) {
    return "";
  }
  return (
    texts[language] ??
    texts[language.split("-")[0] ?? language] ??
    texts.en ??
    Object.values(texts)[0] ??
    ""
  );
}

export interface CapabilityText {
  /** What the capability is called on the pages. */
  readonly name: string;
  /** The sentence of what it opens, as the administrator reads it before consenting. */
  readonly opens: string;
}

/**
 * A capability by the name the pages give it and the sentence of what it opens, in the person's
 * language; one the packs do not know, by its key alone.
 */
export function capabilityText(words: Messages, capability: string): CapabilityText {
  // Typed against the catalogue, so that a capability added there is named in the packs too.
  const known: Readonly<Record<PluginCapability, CapabilityText>> = words.plugins.capability;
  if ((PLUGIN_CAPABILITIES as readonly string[]).includes(capability)) {
    return known[capability as PluginCapability];
  }
  if (capability.startsWith("outbound:")) {
    return words.plugins.capability.outbound(capability.slice("outbound:".length));
  }
  if (capability.startsWith("plugins:")) {
    return words.plugins.capability.plugins(capability.slice("plugins:".length));
  }
  return { name: capability, opens: "" };
}

const STATE_TONES: Readonly<
  Record<RestPlugin["state"], "neutral" | "success" | "warning" | "danger">
> = {
  installed: "neutral",
  enabled: "success",
  needs_consent: "warning",
  disabled: "neutral",
  failed: "danger",
  orphaned: "warning",
};

export interface PluginSettingsListProps {
  readonly plugins: readonly RestPlugin[];
  readonly language: string;
  readonly href: (plugin: RestPlugin) => string;
}

/** Every plugin in a row: its name, its key, its version, how it stands. */
export function PluginSettingsList(props: PluginSettingsListProps) {
  const words = useWords();
  const settings = words.plugins.settings;
  if (props.plugins.length === 0) {
    return <EmptyState title={settings.empty.title} body={settings.empty.body} />;
  }
  return (
    <ul className="sc-task-rows" aria-label={settings.title}>
      {props.plugins.map((plugin) => (
        <li key={plugin.key} className="sc-task-row">
          <a className="sc-task-row-title" href={props.href(plugin)}>
            {pluginWord(plugin.name, props.language)}{" "}
            <span className="sc-muted">
              {plugin.key} {plugin.version}
              {plugin.console !== null && plugin.console !== undefined && (
                <> · {settings.consoleRange(plugin.console)}</>
              )}
            </span>
          </a>
          <span className="sc-task-row-meta">
            <Badge tone={STATE_TONES[plugin.state]}>
              {words.vocabulary.pluginState[plugin.state] ?? plugin.state}
            </Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface PluginSettingsViewProps {
  readonly detail: RestPluginDetail;
  readonly projects: readonly RestProject[];
  /** The people of the workspace, to grant a role to; an administrator sees everyone. */
  readonly people: readonly RestPerson[];
  readonly language: string;
  readonly client: ConsoleClient;
  /** The plugins of the console, to grant a role of this one to another (ADR-0072); none when left out. */
  readonly plugins?: readonly RestPlugin[] | undefined;
  /** The teams of the workspace, to grant a role to one (ADR-0073); none when left out. */
  readonly teams?: readonly RestTeam[] | undefined;
  /** Called after a change, so that the page reads the plugin again. */
  readonly onChanged: () => Promise<void>;
  /** Where the list is, for after a purge. */
  readonly onPurged: () => void;
}

/** A set with a value put in or taken out. */
function toggled(set: ReadonlySet<string>, value: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

/** A row of a list to tick: the box, a name, a word under it. */
function TickRow(props: {
  readonly checked: boolean;
  readonly onChange?: ((checked: boolean) => void) | undefined;
  readonly name: string;
  readonly under?: string | undefined;
  /** A word beside the name: that this one is new, say. */
  readonly tag?: string | undefined;
  /** Whether it stays as it is: on, and not the person's to turn off. */
  readonly locked?: boolean | undefined;
}) {
  return (
    <li>
      <label className={cx("sc-plugin-tick", props.locked === true && "sc-plugin-tick-locked")}>
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.locked === true}
          onChange={(event) => props.onChange?.(event.target.checked)}
        />
        <span className="sc-plugin-tick-words">
          <span className="sc-plugin-tick-name">
            {props.name}
            {props.tag !== undefined && <Badge tone="warning">{props.tag}</Badge>}
          </span>
          {props.under !== undefined && props.under !== "" && (
            <span className="sc-plugin-tick-under">{props.under}</span>
          )}
        </span>
      </label>
    </li>
  );
}

/** What the plugin is on and holds, a row each; nothing where there is nothing to say yet. */
function Overview(props: {
  readonly detail: RestPluginDetail;
  readonly projects: readonly RestProject[];
  readonly language: string;
  readonly busy: boolean;
  /** Called with what the plugin holds from now on, an optional capability turned on or off. */
  readonly onConsent: (consent: readonly string[]) => void;
}) {
  const words = useWords();
  const settings = words.plugins.settings;
  const { detail, language } = props;
  const enabled = detail.state === "enabled";
  const rows: { readonly key: string; readonly name: string; readonly value: ReactNode }[] = [];
  if (detail.console !== null && detail.console !== undefined) {
    rows.push({ key: "console", name: settings.console, value: <code>{detail.console}</code> });
  }
  if (detail.board !== null) {
    rows.push({
      key: "board",
      name: settings.board,
      value: (
        <>
          {detail.board.name} <span className="sc-muted">{detail.board.key}</span>
        </>
      ),
    });
  } else if (enabled && detail.boardNeeds !== "none") {
    rows.push({ key: "board", name: settings.board, value: settings.nothing });
  }
  if (detail.keeps !== undefined && detail.keeps.length > 0) {
    rows.push({
      key: "keeps",
      name: settings.keeps,
      value: detail.keeps.map((kept) => settings.keepsFor(kept.collection, kept.days)).join(", "),
    });
  }
  if (enabled && detail.projects !== null) {
    const names = detail.projects;
    rows.push({
      key: "projects",
      name: settings.projects,
      value:
        names === "all"
          ? settings.projectsAll
          : names.length === 0
            ? settings.nothing
            : names
                .map((key) => props.projects.find((project) => project.key === key)?.name ?? key)
                .join(", "),
    });
  }
  if (enabled && detail.consent !== null) {
    const consent = detail.consent;
    const optional = detail.optionalCapabilities ?? [];
    const required = consent.filter((capability) => !optional.includes(capability));
    rows.push({
      key: "capabilities",
      name: settings.capabilities,
      value:
        consent.length === 0 && optional.length === 0 ? (
          settings.nothing
        ) : (
          <>
            {required.length > 0 && (
              <ul className="sc-plugin-held">
                {required.map((capability) => {
                  const text = capabilityText(words, capability);
                  return (
                    <li key={capability}>
                      <span className="sc-plugin-tick-name">{text.name}</span>
                      {text.opens !== "" && (
                        <span className="sc-plugin-tick-under"> {text.opens}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {optional.length > 0 && (
              <div className="sc-plugin-optional">
                <span className="sc-field-label">{settings.optional}</span>
                <ul className="sc-plugin-held">
                  {optional.map((capability) => {
                    const text = capabilityText(words, capability);
                    return (
                      <li key={capability}>
                        <label className="sc-check">
                          <input
                            type="checkbox"
                            checked={consent.includes(capability)}
                            disabled={props.busy}
                            onChange={(event) =>
                              props.onConsent(
                                event.target.checked
                                  ? [...consent, capability]
                                  : consent.filter((held) => held !== capability),
                              )
                            }
                          />
                          <span>
                            <span className="sc-plugin-tick-name">{text.name}</span>
                            {text.opens !== "" && (
                              <span className="sc-plugin-tick-under"> {text.opens}</span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        ),
    });
  }
  if (detail.operations.length > 0) {
    rows.push({
      key: "operations",
      name: settings.operations,
      value: (
        <span className="sc-plugin-codes">
          {detail.operations.map((operation) => (
            <code key={operation.name}>{operation.name}</code>
          ))}
        </span>
      ),
    });
  }
  if (detail.agentNote !== null) {
    rows.push({
      key: "agentNote",
      name: settings.agentNote,
      value: pluginWord(detail.agentNote, language),
    });
  }
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="sc-panel" aria-label={settings.about}>
      <dl className="sc-settings-list">
        {rows.map((row) => (
          <div key={row.key} className="sc-settings-item">
            <dt>{row.name}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** How many choices a list of an enum shows as pills before it becomes a column of boxes. */
const PILLS_AT_MOST = 8;

/** The control of one item of a list, as a text field: a number, a day, a time or words. */
function itemInputType(of: string | null): "number" | "date" | "time" | "text" {
  switch (of) {
    case "number":
      return "number";
    case "day":
      return "date";
    case "time":
      return "time";
    default:
      return "text";
  }
}

/** The items of a list setting as the form holds them. */
function itemsOf(value: unknown): readonly (string | number)[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string | number => typeof item === "string" || typeof item === "number",
      )
    : [];
}

/**
 * A list of an enum: a pill per choice while they are few, lit while chosen, else a column of
 * boxes; either way the value is the chosen values, in the options' order.
 */
function EnumListControl(props: {
  readonly setting: RestPluginSetting;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly language: string;
}) {
  const options = props.setting.options ?? [];
  const chosen = new Set(itemsOf(props.value).map(String));
  const toggle = (option: string, on: boolean) => {
    const next = options
      .map((candidate) => candidate.value)
      .filter((candidate) => (candidate === option ? on : chosen.has(candidate)));
    props.onChange(next.length === 0 ? null : next);
  };
  const pills = options.length <= PILLS_AT_MOST;
  const name = pluginWord(props.setting.name, props.language);
  const choices = options.map((option) => (
    <label key={option.value} className={pills ? "sc-toggle-chip" : "sc-check"}>
      <input
        type="checkbox"
        checked={chosen.has(option.value)}
        onChange={(event) => toggle(option.value, event.target.checked)}
      />
      {pluginWord(option.name, props.language)}
    </label>
  ));
  return pills ? (
    <fieldset className="sc-toggle-chips" aria-label={name}>
      {choices}
    </fieldset>
  ) : (
    <ul className="sc-check-list" aria-label={name}>
      {choices.map((choice) => (
        <li key={choice.key}>{choice}</li>
      ))}
    </ul>
  );
}

/** One of a list setting's choices: a person or a project, by id, as it reads. */
type Candidate = { readonly id: string; readonly label: string };

/**
 * A list of people or of projects: each chosen one a chip with the way to take it out, and one
 * choice to add another among those not chosen yet; the value is their ids.
 */
function RefListControl(props: {
  readonly setting: RestPluginSetting;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly id: string;
  readonly language: string;
  readonly people: readonly RestPerson[];
  readonly projects: readonly RestProject[];
}) {
  const words = useWords();
  const chosen = itemsOf(props.value).map(String);
  const candidates: readonly Candidate[] =
    props.setting.of === "person"
      ? props.people
          .filter((person) => person.status === "active" || chosen.includes(person.id))
          .map((person) => ({ id: person.id, label: personChoice(person) }))
      : props.projects.map((project) => ({
          id: project.id,
          label: `${project.name} (${project.key})`,
        }));
  const labelOf = (id: string) => candidates.find((candidate) => candidate.id === id)?.label ?? id;
  const set = (next: readonly string[]) => props.onChange(next.length === 0 ? null : next);
  const full = props.setting.max !== null && chosen.length >= props.setting.max;
  return (
    <div className="sc-chips">
      {chosen.map((id) => (
        <Chip
          key={id}
          onRemove={() => set(chosen.filter((kept) => kept !== id))}
          removeLabel={`${words.common.remove}: ${labelOf(id)}`}
        >
          {labelOf(id)}
        </Chip>
      ))}
      {!full && (
        <Picker<Candidate>
          id={props.id}
          className="sc-picker-add"
          value={undefined}
          search={listSearch(
            candidates.filter((candidate) => !chosen.includes(candidate.id)),
            (candidate, typed) => candidate.label.toLowerCase().includes(typed),
          )}
          keyOf={(candidate) => candidate.id}
          render={(candidate) => candidate.label}
          label={pluginWord(props.setting.name, props.language)}
          placeholder={words.plugins.settings.addOne}
          onChange={(candidate) => {
            if (candidate !== undefined) {
              set([...chosen, candidate.id]);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * A list of texts, numbers, days or times: each item a chip with the way to take it out, and a
 * field that adds one on Enter or with the button; `min` and `max` bound how many.
 */
function ItemListControl(props: {
  readonly setting: RestPluginSetting;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly id: string;
}) {
  const words = useWords();
  const [draft, setDraft] = useState("");
  const items = itemsOf(props.value);
  const set = (next: readonly (string | number)[]) =>
    props.onChange(next.length === 0 ? null : next);
  const full = props.setting.max !== null && items.length >= props.setting.max;
  const add = () => {
    const word = draft.trim();
    if (word.length === 0 || full) {
      return;
    }
    const item = props.setting.of === "number" ? Number(word) : word;
    if (typeof item === "number" && !Number.isFinite(item)) {
      return;
    }
    set([...items, item]);
    setDraft("");
  };
  return (
    <div className="sc-chips">
      {items.map((item, index) => (
        <Chip
          // biome-ignore lint/suspicious/noArrayIndexKey: an item may be typed twice
          key={`${index}-${String(item)}`}
          onRemove={() => set(items.filter((_, at) => at !== index))}
          removeLabel={`${words.common.remove}: ${String(item)}`}
        >
          {String(item)}
        </Chip>
      ))}
      {!full && (
        <div className="sc-chip-input">
          <input
            id={props.id}
            className="sc-input"
            type={itemInputType(props.setting.of)}
            value={draft}
            placeholder={words.plugins.settings.itemPlaceholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" size="sm" disabled={draft.trim().length === 0} onClick={add}>
            {words.plugins.settings.addItem}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A setting's control, by its type: a person or a project is chosen among the workspace's, by
 * name, and held as its id; a time of day is read in the workspace's time zone; a list has a
 * control per kind of item; a secret has a row of its own below.
 */
function SettingControl(props: {
  readonly setting: RestPluginSetting;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly id: string;
  readonly language: string;
  readonly people: readonly RestPerson[];
  readonly projects: readonly RestProject[];
}) {
  const words = useWords();
  const { setting, value, onChange, id } = props;
  const chosen = typeof value === "string" ? value : "";
  switch (setting.type) {
    case "person": {
      // The people in; the one chosen stays listed when they have left, so that the value shows.
      const people = props.people.filter(
        (person) => person.status === "active" || person.id === chosen,
      );
      const current = people.find((person) => person.id === chosen);
      return (
        <Picker
          id={id}
          value={current}
          held={chosen !== "" && current === undefined ? chosen : undefined}
          search={peopleSearch(people)}
          keyOf={(person) => person.id}
          render={personChoice}
          label={pluginWord(setting.name, props.language)}
          placeholder={words.plugins.settings.choose}
          onChange={(person) => onChange(person?.id ?? null)}
        />
      );
    }
    case "project": {
      const current = props.projects.find((project) => project.id === chosen);
      return (
        <Picker
          id={id}
          value={current}
          held={chosen !== "" && current === undefined ? chosen : undefined}
          search={projectsSearch(props.projects)}
          keyOf={(project) => project.id}
          render={(project) => `${project.name} (${project.key})`}
          label={pluginWord(setting.name, props.language)}
          placeholder={words.plugins.settings.choose}
          onChange={(project) => onChange(project?.id ?? null)}
        />
      );
    }
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case "number":
      return (
        <input
          id={id}
          className="sc-input"
          type="number"
          value={typeof value === "number" ? value : ""}
          min={setting.min ?? undefined}
          max={setting.max ?? undefined}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : Number(event.target.value))
          }
        />
      );
    case "enum":
      return (
        <select
          id={id}
          className="sc-input"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">—</option>
          {(setting.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {pluginWord(option.name, props.language)}
            </option>
          ))}
        </select>
      );
    case "markdown":
      return (
        <textarea
          id={id}
          className="sc-input"
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        />
      );
    case "time":
      return (
        <>
          <input
            id={id}
            className="sc-input"
            type="time"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          />
          <p className="sc-settings-hint">{words.plugins.settings.timeZoneHint}</p>
        </>
      );
    case "list":
      if (setting.of === "enum") {
        return (
          <EnumListControl
            setting={setting}
            value={value}
            onChange={onChange}
            language={props.language}
          />
        );
      }
      if (setting.of === "person" || setting.of === "project") {
        return (
          <RefListControl
            language={props.language}
            setting={setting}
            value={value}
            onChange={onChange}
            id={id}
            people={props.people}
            projects={props.projects}
          />
        );
      }
      return <ItemListControl setting={setting} value={value} onChange={onChange} id={id} />;
    default:
      return (
        <input
          id={id}
          className="sc-input"
          type={setting.type === "day" ? "date" : "text"}
          value={typeof value === "string" ? value : ""}
          maxLength={setting.max ?? undefined}
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        />
      );
  }
}

/** The settings form from the manifest, without the secrets: the values as they stand, saved as a whole. */
function SettingsForm(props: {
  readonly detail: RestPluginDetail;
  readonly language: string;
  readonly busy: boolean;
  readonly people: readonly RestPerson[];
  readonly projects: readonly RestProject[];
  readonly onSave: (values: Record<string, unknown>) => void;
}) {
  const words = useWords();
  const settings = props.detail.settings.filter((setting) => setting.type !== "secret");
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(settings.map((setting) => [setting.key, setting.value ?? setting.default])),
  );
  const prefix = useId();
  if (settings.length === 0) {
    return null;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSave(values);
  };
  /** A row per setting: the name and the hint on the left, the control on the right. */
  const rows = (shown: readonly RestPluginSetting[]) =>
    shown.map((setting) => (
      <div key={setting.key} className="sc-settings-row">
        <div>
          <label className="sc-settings-label" htmlFor={`${prefix}-${setting.key}`}>
            {pluginWord(setting.name, props.language)}
            {setting.required && " *"}
          </label>
          {setting.description !== null && (
            <p className="sc-settings-hint">{pluginWord(setting.description, props.language)}</p>
          )}
        </div>
        <div className="sc-settings-control">
          <SettingControl
            setting={setting}
            value={values[setting.key]}
            id={`${prefix}-${setting.key}`}
            language={props.language}
            people={props.people}
            projects={props.projects}
            onChange={(value) => setValues((current) => ({ ...current, [setting.key]: value }))}
          />
        </div>
      </div>
    ));
  return (
    <form
      className="sc-form sc-settings-form"
      onSubmit={submit}
      aria-label={words.plugins.settings.settingsForm}
    >
      {rows(settings.filter((setting) => setting.group === null || setting.group === undefined))}
      {(props.detail.settingGroups ?? []).map((group) => {
        const grouped = settings.filter((setting) => setting.group === group.key);
        if (grouped.length === 0) {
          return null;
        }
        const description = pluginWord(group.description, props.language);
        return (
          <section
            key={group.key}
            className="sc-settings-group"
            aria-label={pluginWord(group.name, props.language)}
          >
            <h3 className="sc-settings-group-title">{pluginWord(group.name, props.language)}</h3>
            {description !== "" && <p className="sc-settings-hint">{description}</p>}
            {rows(grouped)}
          </section>
        );
      })}
      <div className="sc-form-actions">
        <Button type="submit" variant="primary" disabled={props.busy}>
          {words.common.save}
        </Button>
      </div>
    </form>
  );
}

/**
 * How a secret stands, in a line (ADR-0070): set by an administrator, or sealed from an answer
 * of a host, when; and when it expires, or that it has.
 */
function secretStanding(
  settings: Messages["plugins"]["settings"],
  setting: RestPluginSetting,
  language: string,
): string {
  const when = formatInstant(setting.setAt ?? "", language);
  const source = setting.source ?? "administrator";
  const set =
    source === "administrator" ? settings.secretSet(when) : settings.secretSealedFrom(source, when);
  if (setting.expiresAt === null || setting.expiresAt === undefined) {
    return set;
  }
  const expires = formatInstant(setting.expiresAt, language);
  return `${set} · ${
    Date.parse(setting.expiresAt) <= Date.now()
      ? settings.secretExpired(expires)
      : settings.secretExpires(expires)
  }`;
}

/** Whom a role may go to (ADR-0072): everyone, a project's members, a person, or a plugin. */
type GrantChoice =
  | { readonly kind: "everyone" }
  | { readonly kind: "project"; readonly project: RestProject }
  | { readonly kind: "person"; readonly person: RestPerson }
  | { readonly kind: "plugin"; readonly plugin: RestPlugin }
  | { readonly kind: "team"; readonly team: RestTeam };

/** One secret: whether and when it is set, a field to set it anew with its buttons on the line. */
function SecretRow(props: {
  readonly setting: RestPluginSetting;
  readonly language: string;
  readonly busy: boolean;
  readonly onSet: (value: string) => void;
  readonly onRemove: () => void;
}) {
  const words = useWords();
  const settings = words.plugins.settings;
  const [value, setValue] = useState("");
  const id = useId();
  const { setting } = props;
  return (
    <div className="sc-settings-row">
      <div>
        <label className="sc-settings-label" htmlFor={id}>
          {pluginWord(setting.name, props.language)}
          {setting.required && " *"}
        </label>
        <p className="sc-settings-hint">
          {setting.set && setting.setAt !== null
            ? secretStanding(settings, setting, props.language)
            : settings.secretUnset}
        </p>
        {setting.hosts !== null && setting.hosts !== undefined && setting.hosts.length > 0 && (
          <p className="sc-settings-hint">{settings.secretHosts(setting.hosts.join(", "))}</p>
        )}
        {setting.description !== null && (
          <p className="sc-settings-hint">{pluginWord(setting.description, props.language)}</p>
        )}
      </div>
      <div className="sc-settings-control">
        <div className="sc-plugin-line">
          <input
            id={id}
            className="sc-input sc-plugin-line-input"
            type="password"
            autoComplete="off"
            placeholder={settings.secretNew}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            disabled={props.busy || value.length === 0}
            onClick={() => {
              props.onSet(value);
              setValue("");
            }}
          >
            {words.common.save}
          </Button>
          {setting.set && (
            <Button variant="ghost" disabled={props.busy} onClick={props.onRemove}>
              {words.common.remove}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Enabling: the capabilities the plugin requires, on and not the administrator's to turn off, and
 * those it can go without, off until chosen, those consented to before on already (ADR-0060); the
 * board project, the one it had chosen already; the projects, as they were.
 */
function EnableForm(props: {
  readonly detail: RestPluginDetail;
  readonly projects: readonly RestProject[];
  readonly language: string;
  readonly busy: boolean;
  readonly onEnable: (
    input: RestPluginEnableInput,
    grants: readonly { readonly plugin: string; readonly role: string }[],
  ) => void;
}) {
  const words = useWords();
  const settings = words.plugins.settings;
  const { detail, language } = props;
  const optional = detail.optionalCapabilities ?? [];
  // The roles the plugin asks of other plugins (ADR-0072): granted on the way where ticked.
  const asks = (detail.asks ?? []).filter((ask) => ask.state !== "granted");
  const [askedNow, setAskedNow] = useState<ReadonlySet<string>>(() => new Set());
  const [consented, setConsented] = useState<ReadonlySet<string>>(
    () => new Set((detail.consent ?? []).filter((capability) => optional.includes(capability))),
  );
  /** A capability a new version asks and nobody has consented to yet is said to be new. */
  const tagOf = (capability: string): string | undefined =>
    detail.state === "needs_consent" && !(detail.consent ?? []).includes(capability)
      ? settings.newCapability
      : undefined;
  const needsBoard = detail.boardNeeds !== "none";
  const [boardMode, setBoardMode] = useState<"none" | "create" | "choose">(
    detail.boardNeeds === "none"
      ? "none"
      : detail.board !== null || detail.boardDefaults === null
        ? "choose"
        : "create",
  );
  const [boardKey, setBoardKey] = useState(detail.boardDefaults?.key ?? "");
  const [boardName, setBoardName] = useState(pluginWord(detail.boardDefaults?.name, language));
  const [boardDescription, setBoardDescription] = useState(
    pluginWord(detail.boardDefaults?.description, language),
  );
  const [chosen, setChosen] = useState(detail.board?.key ?? props.projects[0]?.key ?? "");
  const before = detail.projects;
  const [allProjects, setAllProjects] = useState(!Array.isArray(before) || before.length === 0);
  const [onProjects, setOnProjects] = useState<ReadonlySet<string>>(
    () => new Set(Array.isArray(before) ? before : []),
  );
  const ids = { key: useId(), name: useId(), description: useId(), choose: useId() };
  const boardReady =
    boardMode === "none"
      ? detail.boardNeeds !== "required"
      : boardMode === "create"
        ? boardKey.length > 0 && boardName.length > 0
        : chosen.length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onEnable(
      {
        consent: [...detail.capabilities, ...consented],
        board:
          boardMode === "none"
            ? null
            : boardMode === "create"
              ? { create: { key: boardKey, name: boardName, description: boardDescription } }
              : { project: chosen },
        projects: allProjects ? "all" : [...onProjects],
      },
      asks
        .filter((ask) => ask.state === "ungranted" && askedNow.has(`${ask.plugin}:${ask.role}`))
        .map((ask) => ({ plugin: ask.plugin, role: ask.role })),
    );
  };
  return (
    <form className="sc-form sc-plugin-enable" onSubmit={submit} aria-label={settings.enable}>
      {detail.capabilities.length + optional.length > 0 && (
        <div className="sc-plugin-group">
          <h3 className="sc-plugin-group-title">{settings.capabilities}</h3>
          {detail.capabilities.length > 0 && (
            <div className="sc-plugin-capabilities">
              <p className="sc-plugin-capabilities-head">
                <span className="sc-plugin-capabilities-name">{settings.required}</span>
                <span className="sc-settings-hint">{settings.requiredHint}</span>
              </p>
              <ul className="sc-plugin-ticks">
                {detail.capabilities.map((capability) => {
                  const text = capabilityText(words, capability);
                  return (
                    <TickRow
                      key={capability}
                      checked
                      locked
                      name={text.name}
                      under={text.opens}
                      tag={tagOf(capability)}
                    />
                  );
                })}
              </ul>
            </div>
          )}
          {optional.length > 0 && (
            <div className="sc-plugin-capabilities">
              <p className="sc-plugin-capabilities-head">
                <span className="sc-plugin-capabilities-name">{settings.optional}</span>
                <span className="sc-settings-hint">{settings.optionalHint}</span>
              </p>
              <ul className="sc-plugin-ticks">
                {optional.map((capability) => {
                  const text = capabilityText(words, capability);
                  return (
                    <TickRow
                      key={capability}
                      checked={consented.has(capability)}
                      onChange={(on) => setConsented((current) => toggled(current, capability, on))}
                      name={text.name}
                      under={text.opens}
                    />
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      {needsBoard && (
        <div className="sc-plugin-group">
          <h3 className="sc-plugin-group-title">{settings.board}</h3>
          <p className="sc-settings-hint">{settings.boardHint}</p>
          <div className="sc-radio-row">
            {detail.boardNeeds === "optional" && (
              <label className="sc-check">
                <input
                  type="radio"
                  name="board"
                  checked={boardMode === "none"}
                  onChange={() => setBoardMode("none")}
                />
                {settings.boardNone}
              </label>
            )}
            <label className="sc-check">
              <input
                type="radio"
                name="board"
                checked={boardMode === "create"}
                onChange={() => setBoardMode("create")}
              />
              {settings.boardCreate}
            </label>
            <label className="sc-check">
              <input
                type="radio"
                name="board"
                checked={boardMode === "choose"}
                onChange={() => setBoardMode("choose")}
              />
              {settings.boardChoose}
            </label>
          </div>
          {boardMode === "create" && (
            <div className="sc-plugin-fields">
              <div className="sc-field">
                <label className="sc-field-label" htmlFor={ids.key}>
                  {settings.boardKey}
                </label>
                <input
                  id={ids.key}
                  className="sc-input"
                  value={boardKey}
                  onChange={(event) => setBoardKey(event.target.value)}
                />
              </div>
              <div className="sc-field">
                <label className="sc-field-label" htmlFor={ids.name}>
                  {settings.boardName}
                </label>
                <input
                  id={ids.name}
                  className="sc-input"
                  value={boardName}
                  onChange={(event) => setBoardName(event.target.value)}
                />
              </div>
              <div className="sc-field">
                <label className="sc-field-label" htmlFor={ids.description}>
                  {settings.boardDescription}
                </label>
                <input
                  id={ids.description}
                  className="sc-input"
                  value={boardDescription}
                  onChange={(event) => setBoardDescription(event.target.value)}
                />
              </div>
            </div>
          )}
          {boardMode === "choose" && (
            <div className="sc-plugin-fields">
              <div className="sc-field">
                <label className="sc-field-label" htmlFor={ids.choose}>
                  {settings.boardChoose}
                </label>
                <Picker
                  id={ids.choose}
                  value={props.projects.find((project) => project.key === chosen)}
                  search={projectsSearch(props.projects)}
                  keyOf={(project) => project.key}
                  render={(project) => `${project.name} (${project.key})`}
                  label={settings.boardChoose}
                  placeholder={settings.boardChoose}
                  onChange={(project) => setChosen(project?.key ?? "")}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <div className="sc-plugin-group">
        <h3 className="sc-plugin-group-title">{settings.projects}</h3>
        <div className="sc-radio-row">
          <label className="sc-check">
            <input
              type="radio"
              name="projects"
              checked={allProjects}
              onChange={() => setAllProjects(true)}
            />
            {settings.projectsAll}
          </label>
          <label className="sc-check">
            <input
              type="radio"
              name="projects"
              checked={!allProjects}
              onChange={() => setAllProjects(false)}
            />
            {settings.projectsSome}
          </label>
        </div>
        {!allProjects && (
          <ul className="sc-plugin-ticks">
            {props.projects.map((project) => (
              <TickRow
                key={project.key}
                checked={onProjects.has(project.key)}
                onChange={(on) => setOnProjects((current) => toggled(current, project.key, on))}
                name={project.name}
                under={project.key}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="sc-plugin-group">
        {asks.length > 0 && (
          <div className="sc-plugin-group">
            <h3 className="sc-plugin-group-title">{settings.asks}</h3>
            <p className="sc-settings-hint">{settings.asksHint}</p>
            <ul className="sc-plugin-ticks">
              {asks.map((ask) => {
                const id = `${ask.plugin}:${ask.role}`;
                return (
                  <TickRow
                    key={id}
                    checked={ask.state === "ungranted" && askedNow.has(id)}
                    onChange={
                      ask.state === "ungranted"
                        ? (checked) =>
                            setAskedNow((current) => {
                              const next = new Set(current);
                              if (checked) {
                                next.add(id);
                              } else {
                                next.delete(id);
                              }
                              return next;
                            })
                        : undefined
                    }
                    locked={ask.state === "unavailable"}
                    name={`${ask.role} (${ask.plugin})`}
                    under={
                      ask.state === "unavailable"
                        ? settings.askUnavailable(ask.plugin)
                        : pluginWord(ask.why, language)
                    }
                  />
                );
              })}
            </ul>
          </div>
        )}
        <div className="sc-form-actions">
          <Button type="submit" variant="primary" disabled={props.busy || !boardReady}>
            {settings.enable}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Who a grant is to, as the chip says it. */
function holderOf(grant: RestPluginGrant, words: Messages["plugins"]["settings"]): string {
  if (grant.everyone) {
    return words.grantEveryone;
  }
  if (grant.project !== null) {
    return words.grantMembersOf(grant.project.name);
  }
  if (grant.plugin !== null && grant.plugin !== undefined) {
    return words.grantPlugin(grant.plugin);
  }
  if (grant.team !== null && grant.team !== undefined) {
    return words.grantTeam(grant.team.name);
  }
  if (grant.person !== null) {
    return personName(grant.person);
  }
  return grant.role;
}

/** A person as the choice names them: the name, with the login where it is another word. */
function personChoice(person: RestPerson): string {
  const name = personName(person);
  return name === person.login ? name : `${name} (${person.login})`;
}

/**
 * One role: its name and what it is for; who holds it, every member for the default role and
 * each grant as a chip with the way to revoke it; and one choice to grant it to a person, the
 * members of a project or everyone, those who hold it already left out.
 */
function RoleRow(props: {
  readonly role: RestPluginDetail["declaredRoles"][number];
  readonly isDefault: boolean;
  readonly grants: readonly RestPluginGrant[];
  readonly projects: readonly RestProject[];
  readonly people: readonly RestPerson[];
  /** The other plugins that are enabled, to hold the role as themselves (ADR-0072). */
  readonly plugins: readonly RestPlugin[];
  /** The teams, whose members hold the role granted to one (ADR-0073). */
  readonly teams: readonly RestTeam[];
  readonly language: string;
  readonly busy: boolean;
  readonly onGrant: (input: RestPluginGrantInput) => void;
  readonly onRevoke: (id: string) => void;
}) {
  const settings = useWords().plugins.settings;
  const [whom, setWhom] = useState<GrantChoice | undefined>(undefined);
  const id = useId();
  const { role, grants } = props;
  const everyoneHas = grants.some((grant) => grant.everyone);
  const projectsWith = new Set(
    grants.flatMap((grant) => (grant.project === null ? [] : [grant.project.key])),
  );
  const peopleWith = new Set(
    grants.flatMap((grant) => (grant.person === null ? [] : [grant.person.id])),
  );
  const pluginsWith = new Set(
    grants.flatMap((grant) =>
      grant.plugin === null || grant.plugin === undefined ? [] : [grant.plugin],
    ),
  );
  const plugins = props.plugins.filter((plugin) => !pluginsWith.has(plugin.key));
  const teamsWith = new Set(
    grants.flatMap((grant) =>
      grant.team === null || grant.team === undefined ? [] : [grant.team.key],
    ),
  );
  const teams = props.teams.filter((team) => !teamsWith.has(team.key));
  const projects = props.projects.filter((project) => !projectsWith.has(project.key));
  const people = props.people.filter(
    (person) => person.status === "active" && !peopleWith.has(person.id),
  );
  const description = pluginWord(role.description, props.language);
  // Whom the role may go to, searched for as one list (ADR-0037): everyone where it may, then
  // the projects, the people and the plugins without it.
  const choices: readonly GrantChoice[] = [
    ...(!props.isDefault && !everyoneHas ? [{ kind: "everyone" as const }] : []),
    ...projects.map((project) => ({ kind: "project" as const, project })),
    ...people.map((person) => ({ kind: "person" as const, person })),
    ...plugins.map((plugin) => ({ kind: "plugin" as const, plugin })),
    ...teams.map((team) => ({ kind: "team" as const, team })),
  ];
  const choiceWords = (choice: GrantChoice): string => {
    switch (choice.kind) {
      case "everyone":
        return settings.grantEveryone;
      case "project":
        return settings.grantMembersOf(choice.project.name);
      case "person":
        return personChoice(choice.person);
      case "team":
        return settings.grantTeam(choice.team.name);
      case "plugin":
        return `${settings.grantPlugin(choice.plugin.key)} · ${pluginWord(choice.plugin.name, props.language)}`;
    }
  };
  const findWhom = listSearch(choices, (choice, typed) =>
    choiceWords(choice).toLowerCase().includes(typed),
  );
  const keyOfChoice = (choice: GrantChoice): string =>
    choice.kind === "everyone"
      ? "everyone"
      : choice.kind === "project"
        ? `project:${choice.project.key}`
        : choice.kind === "person"
          ? `person:${choice.person.id}`
          : choice.kind === "team"
            ? `team:${choice.team.key}`
            : `plugin:${choice.plugin.key}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (whom === undefined) {
      return;
    }
    if (whom.kind === "everyone") {
      props.onGrant({ role: role.key, everyone: true });
    } else if (whom.kind === "project") {
      props.onGrant({ role: role.key, project: whom.project.key });
    } else if (whom.kind === "person") {
      props.onGrant({ role: role.key, person: whom.person.id });
    } else if (whom.kind === "team") {
      props.onGrant({ role: role.key, team: whom.team.key });
    } else {
      props.onGrant({ role: role.key, plugin: whom.plugin.key });
    }
    setWhom(undefined);
  };
  return (
    <li className="sc-plugin-role">
      <div>
        <p className="sc-plugin-role-name">
          {pluginWord(role.name, props.language)}
          <code className="sc-plugin-role-key">{role.key}</code>
          {props.isDefault && <Badge tone="accent">{settings.roleDefault}</Badge>}
          {role.follows === "reports" && <Badge tone="accent">{settings.roleManagers}</Badge>}
        </p>
        {description !== "" && <p className="sc-settings-hint">{description}</p>}
      </div>
      <div>
        <div className="sc-chips">
          {props.isDefault && <Chip>{settings.everyMember}</Chip>}
          {role.follows === "reports" && <Chip>{settings.whoeverManages}</Chip>}
          {grants.map((grant) => {
            const holder = holderOf(grant, settings);
            return (
              <Chip
                key={grant.id}
                onRemove={() => props.onRevoke(grant.id)}
                removeLabel={`${settings.revoke}: ${holder}`}
                disabled={props.busy}
              >
                {holder}
              </Chip>
            );
          })}
        </div>
        <form className="sc-plugin-grant" onSubmit={submit}>
          <label htmlFor={id} className="sc-visually-hidden">
            {settings.grantWhom}
          </label>
          <Picker
            id={id}
            value={whom}
            search={findWhom}
            keyOf={keyOfChoice}
            render={choiceWords}
            label={settings.grantWhom}
            placeholder={settings.grantWhom}
            disabled={props.busy}
            onChange={setWhom}
          />
          <Button type="submit" disabled={props.busy || whom === undefined}>
            {settings.grant}
          </Button>
        </form>
      </div>
    </li>
  );
}

/** Another plugin by the name it gives itself in the person's language, or its key where the page does not know it. */
function pluginNameOf(plugins: readonly RestPlugin[], key: string, language: string): string {
  const found = plugins.find((plugin) => plugin.key === key);
  return found === undefined ? key : pluginWord(found.name, language);
}

/** The roles the plugin declares, each with who holds it; a plugin without roles is every member's. */
function RolesSection(props: {
  readonly detail: RestPluginDetail;
  readonly projects: readonly RestProject[];
  readonly people: readonly RestPerson[];
  readonly plugins: readonly RestPlugin[];
  readonly teams: readonly RestTeam[];
  readonly language: string;
  readonly busy: boolean;
  readonly onGrant: (input: RestPluginGrantInput) => void;
  readonly onRevoke: (id: string) => void;
  /** Grants a role this plugin asks of another plugin (ADR-0072): the other plugin's key, and the role. */
  readonly onGrantAsked: (plugin: string, role: string) => void;
}) {
  const settings = useWords().plugins.settings;
  const { detail } = props;
  const grants = detail.grants ?? [];
  const others = props.plugins.filter(
    (plugin) => plugin.state === "enabled" && plugin.key !== detail.key,
  );
  const asks = detail.asks ?? [];
  return (
    <section className="sc-panel" aria-label={settings.roles}>
      <h2 className="sc-section-title">{settings.roles}</h2>
      {detail.declaredRoles.length === 0 ? (
        <p className="sc-settings-hint">{settings.rolesNone}</p>
      ) : (
        <ul className="sc-plugin-roles">
          {detail.declaredRoles.map((role) => (
            <RoleRow
              key={role.key}
              role={role}
              isDefault={detail.defaultRole === role.key}
              grants={grants.filter((grant) => grant.role === role.key)}
              projects={props.projects}
              people={props.people}
              plugins={others}
              teams={props.teams}
              language={props.language}
              busy={props.busy}
              onGrant={props.onGrant}
              onRevoke={props.onRevoke}
            />
          ))}
        </ul>
      )}
      {asks.length > 0 && (
        <div className="sc-plugin-group">
          <h3 className="sc-plugin-group-title">{settings.asks}</h3>
          <p className="sc-settings-hint">{settings.asksHint}</p>
          <ul className="sc-plugin-roles">
            {asks.map((ask) => (
              <li key={`${ask.plugin}:${ask.role}`} className="sc-plugin-role">
                <div>
                  <p className="sc-plugin-role-name">
                    {pluginNameOf(props.plugins, ask.plugin, props.language)}
                    <code className="sc-plugin-role-key">{ask.role}</code>
                    {ask.state === "granted" && <Badge tone="accent">{settings.askGranted}</Badge>}
                  </p>
                  <p className="sc-settings-hint">{pluginWord(ask.why, props.language)}</p>
                </div>
                <div>
                  {ask.state === "unavailable" ? (
                    <span className="sc-settings-hint">{settings.askUnavailable(ask.plugin)}</span>
                  ) : ask.state === "ungranted" ? (
                    <Button
                      size="sm"
                      disabled={props.busy}
                      onClick={() => props.onGrantAsked(ask.plugin, ask.role)}
                    >
                      {settings.askGrantNow}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One plugin, whole, for an administrator. */
export function PluginSettingsView(props: PluginSettingsViewProps) {
  const words = useWords();
  const settings = words.plugins.settings;
  const { detail, language, client } = props;
  const { busy, error, act } = useAction();
  const plugin = useMemo(() => client.plugin(detail.key), [client, detail.key]);
  const [events, setEvents] = useState<readonly RestEvent[] | undefined>(undefined);
  const [confirm, setConfirm] = useState("");
  const [purged, setPurged] = useState(false);
  // The plugin's events, read once the page is shown and again after every change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the detail as read again is the trigger
  useEffect(() => {
    const controller = new AbortController();
    plugin
      .events({ limit: 50 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setEvents([...page.items].reverse());
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [plugin, detail]);
  const change = (work: () => Promise<unknown>) =>
    void act(async () => {
      await work();
      await props.onChanged();
    });
  const enabled = detail.state === "enabled";
  const canEnable =
    detail.state === "installed" || detail.state === "disabled" || detail.state === "needs_consent";
  return (
    <>
      <div className="sc-page-head">
        <div className="sc-page-heading">
          <h1 className="sc-page-title">{pluginWord(detail.name, language)}</h1>
          <Badge tone={STATE_TONES[detail.state]}>
            {words.vocabulary.pluginState[detail.state] ?? detail.state}
          </Badge>
          <span className="sc-muted">
            <code>{detail.key}</code> {detail.version}
          </span>
        </div>
        {enabled && (
          <div className="sc-page-actions">
            <Button size="sm" disabled={busy} onClick={() => change(() => plugin.disable())}>
              {settings.disable}
            </Button>
          </div>
        )}
      </div>
      <p className="sc-lead">{pluginWord(detail.description, language)}</p>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {detail.problems.length > 0 && (
        <Callout tone="danger" title={settings.problems}>
          <ul className="sc-plugin-problems">
            {detail.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Callout>
      )}
      {detail.needsTimeZone === true && (
        <Callout
          tone="warning"
          action={<LinkButton href={settingsHref("workspace")}>{settings.setTimeZone}</LinkButton>}
        >
          {settings.needsTimeZone}
        </Callout>
      )}
      <Overview
        detail={detail}
        projects={props.projects}
        language={language}
        busy={busy}
        onConsent={(consent) => change(() => plugin.updateConsent(consent))}
      />
      {canEnable && (
        <section className="sc-panel sc-panel-form" aria-label={settings.enable}>
          <h2 className="sc-section-title">{settings.enable}</h2>
          <EnableForm
            detail={detail}
            projects={props.projects}
            language={language}
            busy={busy}
            onEnable={(input, grants) =>
              change(async () => {
                await plugin.enable(input);
                for (const grant of grants) {
                  await client.plugin(grant.plugin).grant({ role: grant.role, plugin: detail.key });
                }
              })
            }
          />
        </section>
      )}
      {enabled && detail.settings.length > 0 && (
        <section className="sc-panel sc-panel-form" aria-label={settings.settingsForm}>
          <h2 className="sc-section-title">{settings.settingsForm}</h2>
          <div>
            <SettingsForm
              detail={detail}
              language={language}
              busy={busy}
              people={props.people}
              projects={props.projects}
              onSave={(values) => change(() => plugin.updateSettings({ values }))}
            />
            {detail.settings
              .filter((setting) => setting.type === "secret")
              .map((setting) => (
                <SecretRow
                  key={setting.key}
                  setting={setting}
                  language={language}
                  busy={busy}
                  onSet={(value) => change(() => plugin.setSecret(setting.key, value))}
                  onRemove={() => change(() => plugin.removeSecret(setting.key))}
                />
              ))}
          </div>
        </section>
      )}
      {detail.grants !== null && (
        <RolesSection
          detail={detail}
          plugins={props.plugins ?? []}
          teams={props.teams ?? []}
          onGrantAsked={(other, role) =>
            change(() => client.plugin(other).grant({ role, plugin: detail.key }))
          }
          projects={props.projects}
          people={props.people}
          language={language}
          busy={busy}
          onGrant={(input) => change(() => plugin.grant(input))}
          onRevoke={(id) => change(() => plugin.revoke(id))}
        />
      )}
      <section className="sc-panel" aria-label={settings.events}>
        <h2 className="sc-section-title">{settings.events}</h2>
        {events === undefined ? (
          <Spinner label={words.common.loading} />
        ) : (
          <EventFeed events={events} empty={<p className="sc-muted">{settings.noEvents}</p>} />
        )}
      </section>
      <section className="sc-panel sc-panel-form" aria-label={settings.data}>
        <h2 className="sc-section-title">{settings.data}</h2>
        <div>
          <div className="sc-settings-row">
            <div>
              <p className="sc-settings-label">{settings.export}</p>
              <p className="sc-settings-hint">{settings.exportHint}</p>
            </div>
            <div className="sc-settings-control">
              <LinkButton href={`/api/v1/plugins/${detail.key}/export`}>
                {settings.exportLink}
              </LinkButton>
            </div>
          </div>
          <div className="sc-settings-row">
            <div>
              <p className="sc-settings-label">{settings.purge}</p>
              <p className="sc-settings-hint">{settings.purgeHint}</p>
            </div>
            <div className="sc-settings-control">
              {purged ? (
                <p className="sc-settings-hint">{settings.purged}</p>
              ) : enabled ? (
                <p className="sc-settings-hint">{settings.purgeDisabledFirst}</p>
              ) : (
                <form
                  className="sc-plugin-line"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () => {
                      await plugin.purge(confirm);
                      setPurged(true);
                      props.onPurged();
                    });
                  }}
                >
                  <input
                    className="sc-input sc-plugin-line-input"
                    value={confirm}
                    placeholder={settings.purgeConfirm(detail.key)}
                    aria-label={settings.purgeConfirm(detail.key)}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                  <Button type="submit" variant="danger" disabled={busy || confirm !== detail.key}>
                    {settings.purge}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
