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
} from "../schemas.js";
import { useAction } from "../use-action.js";
import { EventFeed } from "./event-feed.js";
import {
  Badge,
  Button,
  Callout,
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

/**
 * A list of people or of projects: each chosen one a chip with the way to take it out, and one
 * choice to add another among those not chosen yet; the value is their ids.
 */
function RefListControl(props: {
  readonly setting: RestPluginSetting;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly id: string;
  readonly people: readonly RestPerson[];
  readonly projects: readonly RestProject[];
}) {
  const words = useWords();
  const chosen = itemsOf(props.value).map(String);
  const candidates: readonly { readonly id: string; readonly label: string }[] =
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
        <span key={id} className="sc-chip">
          {labelOf(id)}
          <button
            type="button"
            className="sc-chip-remove"
            aria-label={`${words.common.remove}: ${labelOf(id)}`}
            onClick={() => set(chosen.filter((kept) => kept !== id))}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </span>
      ))}
      {!full && (
        <select
          id={props.id}
          className="sc-input sc-chip-add"
          value=""
          onChange={(event) => {
            if (event.target.value !== "") {
              set([...chosen, event.target.value]);
            }
          }}
        >
          <option value="">{words.plugins.settings.choose}</option>
          {candidates
            .filter((candidate) => !chosen.includes(candidate.id))
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
        </select>
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
        // biome-ignore lint/suspicious/noArrayIndexKey: an item may be typed twice
        <span key={`${index}-${String(item)}`} className="sc-chip">
          {String(item)}
          <button
            type="button"
            className="sc-chip-remove"
            aria-label={`${words.common.remove}: ${String(item)}`}
            onClick={() => set(items.filter((_, at) => at !== index))}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </span>
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
  const choose = (event: { readonly target: { readonly value: string } }) =>
    onChange(event.target.value === "" ? null : event.target.value);
  switch (setting.type) {
    case "person": {
      // The people in; the one chosen stays listed when they have left, so that the value shows.
      const people = props.people.filter(
        (person) => person.status === "active" || person.id === chosen,
      );
      return (
        <select id={id} className="sc-input" value={chosen} onChange={choose}>
          <option value="">—</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {personChoice(person)}
            </option>
          ))}
          {chosen !== "" && !people.some((person) => person.id === chosen) && (
            <option value={chosen}>{chosen}</option>
          )}
        </select>
      );
    }
    case "project":
      return (
        <select id={id} className="sc-input" value={chosen} onChange={choose}>
          <option value="">—</option>
          {props.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} ({project.key})
            </option>
          ))}
          {chosen !== "" && !props.projects.some((project) => project.id === chosen) && (
            <option value={chosen}>{chosen}</option>
          )}
        </select>
      );
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
        <div className="sc-settings-words">
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
      <div className="sc-settings-words">
        <label className="sc-settings-label" htmlFor={id}>
          {pluginWord(setting.name, props.language)}
          {setting.required && " *"}
        </label>
        <p className="sc-settings-hint">
          {setting.set && setting.setAt !== null
            ? settings.secretSet(formatInstant(setting.setAt, props.language))
            : settings.secretUnset}
        </p>
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
  readonly onEnable: (input: RestPluginEnableInput) => void;
}) {
  const words = useWords();
  const settings = words.plugins.settings;
  const { detail, language } = props;
  const optional = detail.optionalCapabilities ?? [];
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
    props.onEnable({
      consent: [...detail.capabilities, ...consented],
      board:
        boardMode === "none"
          ? null
          : boardMode === "create"
            ? { create: { key: boardKey, name: boardName, description: boardDescription } }
            : { project: chosen },
      projects: allProjects ? "all" : [...onProjects],
    });
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
                <select
                  id={ids.choose}
                  className="sc-input"
                  value={chosen}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {props.projects.map((project) => (
                    <option key={project.key} value={project.key}>
                      {project.name} ({project.key})
                    </option>
                  ))}
                </select>
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
  readonly language: string;
  readonly busy: boolean;
  readonly onGrant: (input: RestPluginGrantInput) => void;
  readonly onRevoke: (id: string) => void;
}) {
  const settings = useWords().plugins.settings;
  const [whom, setWhom] = useState("");
  const id = useId();
  const { role, grants } = props;
  const everyoneHas = grants.some((grant) => grant.everyone);
  const projectsWith = new Set(
    grants.flatMap((grant) => (grant.project === null ? [] : [grant.project.key])),
  );
  const peopleWith = new Set(
    grants.flatMap((grant) => (grant.person === null ? [] : [grant.person.id])),
  );
  const projects = props.projects.filter((project) => !projectsWith.has(project.key));
  const people = props.people.filter(
    (person) => person.status === "active" && !peopleWith.has(person.id),
  );
  const description = pluginWord(role.description, props.language);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (whom === "everyone") {
      props.onGrant({ role: role.key, everyone: true });
    } else if (whom.startsWith("project:")) {
      props.onGrant({ role: role.key, project: whom.slice("project:".length) });
    } else if (whom.startsWith("person:")) {
      props.onGrant({ role: role.key, person: whom.slice("person:".length) });
    }
    setWhom("");
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
        <div className="sc-plugin-holders">
          {props.isDefault && (
            <span className="sc-plugin-holder sc-plugin-holder-fixed">{settings.everyMember}</span>
          )}
          {role.follows === "reports" && (
            <span className="sc-plugin-holder sc-plugin-holder-fixed">
              {settings.whoeverManages}
            </span>
          )}
          {grants.map((grant) => {
            const holder = holderOf(grant, settings);
            return (
              <span key={grant.id} className="sc-plugin-holder">
                {holder}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.busy}
                  onClick={() => props.onRevoke(grant.id)}
                  aria-label={`${settings.revoke}: ${holder}`}
                  title={settings.revoke}
                >
                  ×
                </Button>
              </span>
            );
          })}
        </div>
        <form className="sc-plugin-grant" onSubmit={submit}>
          <label htmlFor={id} className="sc-visually-hidden">
            {settings.grantWhom}
          </label>
          <select
            id={id}
            className="sc-input sc-plugin-grant-input"
            value={whom}
            onChange={(event) => setWhom(event.target.value)}
          >
            <option value="">{settings.grantWhom}</option>
            {!props.isDefault && !everyoneHas && (
              <option value="everyone">{settings.grantEveryone}</option>
            )}
            {projects.length > 0 && (
              <optgroup label={settings.grantProjects}>
                {projects.map((project) => (
                  <option key={project.key} value={`project:${project.key}`}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
            )}
            {people.length > 0 && (
              <optgroup label={settings.grantPeople}>
                {people.map((person) => (
                  <option key={person.id} value={`person:${person.id}`}>
                    {personChoice(person)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <Button type="submit" disabled={props.busy || whom === ""}>
            {settings.grant}
          </Button>
        </form>
      </div>
    </li>
  );
}

/** The roles the plugin declares, each with who holds it; a plugin without roles is every member's. */
function RolesSection(props: {
  readonly detail: RestPluginDetail;
  readonly projects: readonly RestProject[];
  readonly people: readonly RestPerson[];
  readonly language: string;
  readonly busy: boolean;
  readonly onGrant: (input: RestPluginGrantInput) => void;
  readonly onRevoke: (id: string) => void;
}) {
  const settings = useWords().plugins.settings;
  const { detail } = props;
  const grants = detail.grants ?? [];
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
              language={props.language}
              busy={props.busy}
              onGrant={props.onGrant}
              onRevoke={props.onRevoke}
            />
          ))}
        </ul>
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
            onEnable={(input) => change(() => plugin.enable(input))}
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
            <div className="sc-settings-words">
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
            <div className="sc-settings-words">
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
