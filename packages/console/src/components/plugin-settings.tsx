import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import type { ConsoleClient } from "../client.js";
import { useWords } from "../i18n/index.js";
import { capabilityWords } from "../plugin/capabilities.js";
import type {
  RestEvent,
  RestPlugin,
  RestPluginDetail,
  RestPluginEnableInput,
  RestPluginSetting,
  RestProject,
} from "../schemas.js";
import { useAction } from "../use-action.js";
import { EventFeed } from "./event-feed.js";
import { Badge, Button, Callout, EmptyState, LinkButton, Spinner, Time } from "./ui.js";

// The plugins' settings (docs/specs/plugins.md, "The settings pages"): what is installed and how
// each stands; and, for one plugin, the capabilities to consent to with what each opens, the
// board project to make or choose, the projects, the settings form from the manifest, the
// secrets set and never shown, the grants, what the plugin did, export and purge. No plugin code
// runs here: everything is the console's own.

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
  readonly language: string;
  readonly client: ConsoleClient;
  /** Called after a change, so that the page reads the plugin again. */
  readonly onChanged: () => Promise<void>;
  /** Where the list is, for after a purge. */
  readonly onPurged: () => void;
}

/** A setting's control, by its type; a secret has a form of its own below. */
function SettingControl(props: {
  readonly setting: RestPluginSetting;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly id: string;
  readonly language: string;
}) {
  const { setting, value, onChange, id } = props;
  switch (setting.type) {
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
    case "list":
      return (
        <input
          id={id}
          className="sc-input"
          value={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(event) =>
            onChange(
              event.target.value.trim() === ""
                ? null
                : event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0)
                    .map((item) => (setting.of === "number" ? Number(item) : item)),
            )
          }
        />
      );
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
  readonly onSave: (values: Record<string, unknown>) => void;
}) {
  const words = useWords().plugins.settings;
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
  return (
    <form className="sc-form sc-settings-form" onSubmit={submit} aria-label={words.settingsForm}>
      {settings.map((setting) => (
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
              onChange={(value) => setValues((current) => ({ ...current, [setting.key]: value }))}
            />
          </div>
        </div>
      ))}
      <div className="sc-form-actions">
        <Button type="submit" variant="primary" disabled={props.busy}>
          {words.save}
        </Button>
      </div>
    </form>
  );
}

/** One secret: whether and when it is set, a field to set it anew, and the way to remove it. */
function SecretRow(props: {
  readonly setting: RestPluginSetting;
  readonly language: string;
  readonly busy: boolean;
  readonly onSet: (value: string) => void;
  readonly onRemove: () => void;
}) {
  const words = useWords().plugins.settings;
  const [value, setValue] = useState("");
  const id = useId();
  const { setting } = props;
  return (
    <div className="sc-settings-row">
      <div className="sc-settings-words">
        <label className="sc-settings-label" htmlFor={id}>
          {pluginWord(setting.name, props.language)} <Badge tone="neutral">{words.secret}</Badge>
        </label>
        <p className="sc-settings-hint">
          {setting.set && setting.setAt !== null ? (
            <>
              {words.secretSet("")}
              <Time iso={setting.setAt} />
            </>
          ) : (
            words.secretUnset
          )}
          {" · "}
          {words.secretHint}
        </p>
      </div>
      <div className="sc-settings-control">
        <input
          id={id}
          className="sc-input"
          type="password"
          autoComplete="off"
          placeholder={words.secretNew}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="sc-form-actions">
          <Button
            size="sm"
            disabled={props.busy || value.length === 0}
            onClick={() => {
              props.onSet(value);
              setValue("");
            }}
          >
            {words.secretSave}
          </Button>
          {setting.set && (
            <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onRemove}>
              {words.secretRemove}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Enabling: consent to every capability, the board project, the projects. */
function EnableForm(props: {
  readonly detail: RestPluginDetail;
  readonly projects: readonly RestProject[];
  readonly language: string;
  readonly busy: boolean;
  readonly onEnable: (input: RestPluginEnableInput) => void;
}) {
  const words = useWords().plugins.settings;
  const { detail, language } = props;
  const [consented, setConsented] = useState<ReadonlySet<string>>(new Set());
  const needsBoard = detail.boardNeeds !== "none";
  const [boardMode, setBoardMode] = useState<"none" | "create" | "choose">(
    detail.boardNeeds === "none" ? "none" : detail.boardDefaults === null ? "choose" : "create",
  );
  const [boardKey, setBoardKey] = useState(detail.boardDefaults?.key ?? "");
  const [boardName, setBoardName] = useState(pluginWord(detail.boardDefaults?.name, language));
  const [boardDescription, setBoardDescription] = useState(
    pluginWord(detail.boardDefaults?.description, language),
  );
  const [chosen, setChosen] = useState(props.projects[0]?.key ?? "");
  const [allProjects, setAllProjects] = useState(true);
  const [onProjects, setOnProjects] = useState<ReadonlySet<string>>(new Set());
  const ids = { key: useId(), name: useId(), description: useId(), choose: useId() };
  const everyCapability = detail.capabilities.every((capability) => consented.has(capability));
  const boardReady =
    boardMode === "none"
      ? detail.boardNeeds !== "required"
      : boardMode === "create"
        ? boardKey.length > 0 && boardName.length > 0
        : chosen.length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onEnable({
      consent: [...consented],
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
    <form className="sc-form" onSubmit={submit} aria-label={words.enable}>
      <h3 className="sc-section-title">{words.capabilities}</h3>
      <p className="sc-settings-hint">{words.capabilitiesIntro}</p>
      {detail.capabilities.length === 0 && <p className="sc-muted">—</p>}
      <ul className="sc-list">
        {detail.capabilities.map((capability) => {
          const said = capabilityWords(capability);
          return (
            <li key={capability}>
              <label className="sc-check">
                <input
                  type="checkbox"
                  checked={consented.has(capability)}
                  onChange={(event) =>
                    setConsented((current) => {
                      const next = new Set(current);
                      if (event.target.checked) {
                        next.add(capability);
                      } else {
                        next.delete(capability);
                      }
                      return next;
                    })
                  }
                />{" "}
                <code>{capability}</code>
                {said !== undefined && (
                  <>
                    {" "}
                    <span className="sc-muted">
                      {words.opens}: {said.opens}
                    </span>
                    <br />
                    <span className="sc-capability-reach">
                      {words.reach}: {said.reach}
                    </span>
                  </>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {needsBoard && (
        <>
          <h3 className="sc-section-title">{words.board}</h3>
          <p className="sc-settings-hint">{words.boardIntro}</p>
          <div className="sc-radio-row">
            {detail.boardNeeds === "optional" && (
              <label className="sc-check">
                <input
                  type="radio"
                  name="board"
                  checked={boardMode === "none"}
                  onChange={() => setBoardMode("none")}
                />{" "}
                {words.boardNone}
              </label>
            )}
            <label className="sc-check">
              <input
                type="radio"
                name="board"
                checked={boardMode === "create"}
                onChange={() => setBoardMode("create")}
              />{" "}
              {words.boardCreate}
            </label>
            <label className="sc-check">
              <input
                type="radio"
                name="board"
                checked={boardMode === "choose"}
                onChange={() => setBoardMode("choose")}
              />{" "}
              {words.boardChoose}
            </label>
          </div>
          {boardMode === "create" && (
            <div className="sc-settings-form">
              <div className="sc-settings-row">
                <label className="sc-settings-label" htmlFor={ids.key}>
                  {words.boardKey}
                </label>
                <input
                  id={ids.key}
                  className="sc-input"
                  value={boardKey}
                  onChange={(event) => setBoardKey(event.target.value)}
                />
              </div>
              <div className="sc-settings-row">
                <label className="sc-settings-label" htmlFor={ids.name}>
                  {words.boardName}
                </label>
                <input
                  id={ids.name}
                  className="sc-input"
                  value={boardName}
                  onChange={(event) => setBoardName(event.target.value)}
                />
              </div>
              <div className="sc-settings-row">
                <label className="sc-settings-label" htmlFor={ids.description}>
                  {words.boardDescription}
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
            <div className="sc-settings-row">
              <label className="sc-settings-label" htmlFor={ids.choose}>
                {words.boardChoose}
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
          )}
        </>
      )}
      <h3 className="sc-section-title">{words.projects}</h3>
      <div className="sc-radio-row">
        <label className="sc-check">
          <input
            type="radio"
            name="projects"
            checked={allProjects}
            onChange={() => setAllProjects(true)}
          />{" "}
          {words.projectsAll}
        </label>
        <label className="sc-check">
          <input
            type="radio"
            name="projects"
            checked={!allProjects}
            onChange={() => setAllProjects(false)}
          />{" "}
          {words.projectsSome}
        </label>
      </div>
      {!allProjects && (
        <ul className="sc-list">
          {props.projects.map((project) => (
            <li key={project.key}>
              <label className="sc-check">
                <input
                  type="checkbox"
                  checked={onProjects.has(project.key)}
                  onChange={(event) =>
                    setOnProjects((current) => {
                      const next = new Set(current);
                      if (event.target.checked) {
                        next.add(project.key);
                      } else {
                        next.delete(project.key);
                      }
                      return next;
                    })
                  }
                />{" "}
                {project.name} <span className="sc-muted">{project.key}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy || !everyCapability || !boardReady}
        >
          {words.enable}
        </Button>
        {!everyCapability && <span className="sc-muted">{words.enableHint}</span>}
      </div>
    </form>
  );
}

/** The grants: who holds which role, and the form to grant one more. */
function GrantsSection(props: {
  readonly detail: RestPluginDetail;
  readonly projects: readonly RestProject[];
  readonly busy: boolean;
  readonly onGrant: (input: {
    readonly role: string;
    readonly person?: string;
    readonly project?: string;
    readonly everyone?: true;
  }) => void;
  readonly onRevoke: (id: string) => void;
}) {
  const words = useWords().plugins.settings;
  const { detail } = props;
  const [role, setRole] = useState(detail.declaredRoles[0]?.key ?? "");
  const [to, setTo] = useState<"person" | "project" | "everyone">("person");
  const [login, setLogin] = useState("");
  const [projectKey, setProjectKey] = useState(props.projects[0]?.key ?? "");
  const ids = { role: useId(), to: useId(), who: useId() };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (to === "everyone") {
      props.onGrant({ role, everyone: true });
    } else if (to === "project") {
      props.onGrant({ role, project: projectKey });
    } else {
      props.onGrant({ role, person: login.trim() });
    }
  };
  return (
    <section className="sc-panel" aria-label={words.grants}>
      <h2 className="sc-section-title">{words.grants}</h2>
      <p className="sc-settings-hint">{words.grantsIntro}</p>
      {detail.grants === null || detail.grants.length === 0 ? (
        <p className="sc-muted">{words.noGrants}</p>
      ) : (
        <ul className="sc-task-rows">
          {detail.grants.map((grant) => (
            <li key={grant.id} className="sc-task-row">
              <span className="sc-task-row-title">
                <Badge tone="neutral">{grant.role}</Badge>{" "}
                {grant.person !== null
                  ? grant.person.login
                  : grant.project !== null
                    ? `${grant.project.name} (${grant.project.key})`
                    : words.grantEveryone}
              </span>
              <span className="sc-task-row-meta">
                <Time iso={grant.createdAt} />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.busy}
                  onClick={() => props.onRevoke(grant.id)}
                >
                  {words.revoke}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {detail.declaredRoles.length > 0 && (
        <form className="sc-form sc-inline-form" onSubmit={submit}>
          <label htmlFor={ids.role} className="sc-visually-hidden">
            {words.grantRole}
          </label>
          <select
            id={ids.role}
            className="sc-input"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {detail.declaredRoles.map((declared) => (
              <option key={declared.key} value={declared.key}>
                {declared.key}
              </option>
            ))}
          </select>
          <label htmlFor={ids.to} className="sc-visually-hidden">
            {words.grantTo}
          </label>
          <select
            id={ids.to}
            className="sc-input"
            value={to}
            onChange={(event) => setTo(event.target.value as "person" | "project" | "everyone")}
          >
            <option value="person">{words.grantPerson}</option>
            <option value="project">{words.grantProject}</option>
            <option value="everyone">{words.grantEveryone}</option>
          </select>
          {to === "person" && (
            <input
              id={ids.who}
              className="sc-input"
              value={login}
              placeholder={words.grantPerson}
              onChange={(event) => setLogin(event.target.value)}
            />
          )}
          {to === "project" && (
            <select
              id={ids.who}
              className="sc-input"
              value={projectKey}
              onChange={(event) => setProjectKey(event.target.value)}
            >
              {props.projects.map((project) => (
                <option key={project.key} value={project.key}>
                  {project.name} ({project.key})
                </option>
              ))}
            </select>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={props.busy || role === "" || (to === "person" && login.trim() === "")}
          >
            {words.grant}
          </Button>
        </form>
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
  return (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">{pluginWord(detail.name, language)}</h1>
        <Badge tone={STATE_TONES[detail.state]}>
          {words.vocabulary.pluginState[detail.state] ?? detail.state}
        </Badge>
      </div>
      <p className="sc-lead">{pluginWord(detail.description, language)}</p>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      <section className="sc-panel" aria-label={settings.state}>
        <dl className="sc-facts">
          <dt>{settings.byKey("")}</dt>
          <dd>
            <code>{detail.key}</code>
          </dd>
          <dt>{settings.version}</dt>
          <dd>{detail.version}</dd>
          {detail.agentNote !== null && (
            <>
              <dt>{settings.agentNote}</dt>
              <dd>{pluginWord(detail.agentNote, language)}</dd>
            </>
          )}
          {detail.board !== null && (
            <>
              <dt>{settings.board}</dt>
              <dd>
                {detail.board.name} <span className="sc-muted">{detail.board.key}</span>
              </dd>
            </>
          )}
          {detail.projects !== null && (
            <>
              <dt>{settings.projects}</dt>
              <dd>
                {detail.projects === "all" ? settings.projectsAll : detail.projects.join(", ")}
              </dd>
            </>
          )}
          <dt>{settings.yourRoles}</dt>
          <dd>{detail.roles.length === 0 ? "—" : detail.roles.join(", ")}</dd>
          <dt>{settings.operations}</dt>
          <dd>
            {detail.operations.length === 0
              ? "—"
              : detail.operations.map((operation) => operation.name).join(", ")}
          </dd>
        </dl>
        {detail.problems.length > 0 && (
          <Callout tone="danger" title={settings.problems}>
            <ul className="sc-list">
              {detail.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Callout>
        )}
      </section>
      {(detail.state === "installed" ||
        detail.state === "disabled" ||
        detail.state === "needs_consent") && (
        <section className="sc-panel sc-panel-form" aria-label={settings.enable}>
          <EnableForm
            detail={detail}
            projects={props.projects}
            language={language}
            busy={busy}
            onEnable={(input) => change(() => plugin.enable(input))}
          />
        </section>
      )}
      {enabled && (
        <section className="sc-panel" aria-label={settings.capabilities}>
          <h2 className="sc-section-title">{settings.capabilities}</h2>
          {detail.consent !== null && detail.consent.length > 0 ? (
            <ul className="sc-list">
              {detail.consent.map((capability) => (
                <li key={capability}>
                  <code>{capability}</code>
                  <span className="sc-muted"> {capabilityWords(capability)?.opens ?? ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sc-muted">—</p>
          )}
          <div className="sc-form-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => change(() => plugin.disable())}
            >
              {settings.disable}
            </Button>
          </div>
        </section>
      )}
      {enabled && detail.settings.length > 0 && (
        <section className="sc-panel sc-panel-form" aria-label={settings.settingsForm}>
          <h2 className="sc-section-title">{settings.settingsForm}</h2>
          <SettingsForm
            detail={detail}
            language={language}
            busy={busy}
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
        </section>
      )}
      {detail.grants !== null && (
        <GrantsSection
          detail={detail}
          projects={props.projects}
          busy={busy}
          onGrant={(input) =>
            change(async () => {
              if (input.person !== undefined) {
                const found = await client.findPerson(input.person);
                if (found === undefined) {
                  throw new Error(`No person has the login ${input.person}.`);
                }
                await plugin.grant({ role: input.role, person: found.id });
              } else if (input.project !== undefined) {
                await plugin.grant({ role: input.role, project: input.project });
              } else {
                await plugin.grant({ role: input.role, everyone: true });
              }
            })
          }
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
      <section className="sc-panel" aria-label={settings.purge}>
        <h2 className="sc-section-title">{settings.purge}</h2>
        <p className="sc-settings-hint">{settings.purgeIntro}</p>
        <div className="sc-form-actions">
          <LinkButton href={`/api/v1/plugins/${detail.key}/export`} variant="secondary">
            {settings.exportLink}
          </LinkButton>
        </div>
        {!enabled && !purged && (
          <form
            className="sc-form sc-inline-form"
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
              className="sc-input"
              value={confirm}
              placeholder={settings.purgeConfirm(detail.key)}
              onChange={(event) => setConfirm(event.target.value)}
            />
            <Button type="submit" variant="danger" disabled={busy || confirm !== detail.key}>
              {settings.purge}
            </Button>
          </form>
        )}
        {purged && <p className="sc-muted">{settings.purged}</p>}
      </section>
    </>
  );
}
