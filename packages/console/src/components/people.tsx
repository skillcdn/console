import { type FormEvent, useEffect, useState } from "react";
import {
  hostOfLogin,
  isLoginAt,
  type PersonRole,
  type PersonStatus,
  type ProviderKey,
  type RestListing,
  type RestListingInput,
  type RestOrganization,
  type RestPerson,
  type RestProvider,
  type RestTeam,
  type RestTeamInput,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import {
  MAX_LOGIN_LENGTH,
  MAX_PERSON_TITLE_LENGTH,
  MAX_TEAM_KEY_LENGTH,
  MAX_TEAM_NAME_LENGTH,
} from "../limits.js";
import { PERSON_ROLES } from "../vocabulary.js";
import { Picker } from "./picker.js";
import { keyOf } from "./projects.js";
import { listSearch, peopleSearch } from "./searches.js";
import {
  Avatar,
  Badge,
  Button,
  Chip,
  cx,
  EmptyState,
  PersonChip,
  PersonOption,
  personName,
  RoleBadge,
  Time,
} from "./ui.js";

// The people of the board, with what each may do and whether they are in (ADR-0022): those in,
// the logins let in that nobody has signed in with yet, and those deactivated; and the teams
// (ADR-0073), a view of their own. An administrator changes a person's facts in place, takes
// people out and back in, takes a listing away, and keeps the teams; a member reads. Takes its
// data as props and nothing from the network.

export interface PeopleListProps {
  readonly people: readonly RestPerson[];
  /** The logins let in that nobody has signed in with yet. */
  readonly listed?: readonly RestListing[] | undefined;
  /** The organization at the git host that says who is in, where the deployment names one. */
  readonly organization?: RestOrganization | null | undefined;
  /** Whoever is looking, so that their own row says so. */
  readonly me?: RestPerson | undefined;
  /** Called with the role an administrator chose. Left out, roles are read here, not changed. */
  readonly onChangeRole?: ((person: RestPerson, role: PersonRole) => void) | undefined;
  /**
   * Called when an administrator takes a person out, or back in. Left out, standings are read
   * here, not changed. Never offered for a person the organization let in, who comes and goes
   * with it.
   */
  readonly onChangeStatus?: ((person: RestPerson, status: PersonStatus) => void) | undefined;
  /** Called with the manager an administrator chose for the person, or null for none. Left out, managers are read here, not changed. */
  readonly onChangeManager?: ((person: RestPerson, managerId: string | null) => void) | undefined;
  /** Called with the work email an administrator wrote for the person, or null for none. Left out, an address is read here where the console answers one. */
  readonly onChangeEmail?: ((person: RestPerson, email: string | null) => void) | undefined;
  /**
   * Called with the title written for a member (ADR-0084), or null for none: an administrator's
   * to write of anyone, and of an agent account its supervisors' too. Left out, titles are read
   * here, not changed.
   */
  readonly onChangeTitle?: ((person: RestPerson, title: string | null) => void) | undefined;
  /** Whose title whoever is looking may write, where `onChangeTitle` is given; everyone's when left out. */
  readonly mayChangeTitle?: ((person: RestPerson) => boolean) | undefined;
  /** Called when an administrator takes a listing away. Left out, listings are read here. */
  readonly onUnlist?: ((listing: RestListing) => void) | undefined;
  /** The teams of the workspace (ADR-0073), so that each person's card names theirs; left out, none are named. */
  readonly teams?: readonly RestTeam[] | undefined;
  /** Called with a team an administrator puts the person in, from the person's card. Left out, a person's teams are read here. */
  readonly onJoinTeam?: ((person: RestPerson, team: RestTeam) => void) | undefined;
  /** Called with a team an administrator takes the person out of, from the person's card. */
  readonly onLeaveTeam?: ((person: RestPerson, team: RestTeam) => void) | undefined;
  /** Where a person's work is seen; given to an administrator, or an owner of a project. */
  readonly workHref?: ((person: RestPerson) => string) | undefined;
  /** Where a person's agents are seen; given to an administrator. */
  readonly agentsHref?: ((person: RestPerson) => string) | undefined;
  /** Where an agent account's own page is: its name and a way at the foot of its card lead there. */
  readonly agentHref?: ((person: RestPerson) => string) | undefined;
  readonly busy?: boolean | undefined;
}

/**
 * Whether `above` supervises `person` as the reporting line has it (ADR-0084): the person is an
 * agent account, and `above` is its manager or the manager of one above it, among the `people`
 * the page holds. What an administrator supervises besides is the caller's to say; the console
 * decides either way.
 */
export function supervisedBy(
  above: RestPerson | undefined,
  person: RestPerson,
  people: readonly RestPerson[],
): boolean {
  if (above === undefined || person.kind !== "agent") {
    return false;
  }
  const byId = new Map(people.map((one) => [one.id, one]));
  let next = person.managerId ?? null;
  // The line never loops, and a page's copy of it is not trusted to: the climb is bounded.
  for (let steps = 0; next !== null && steps < people.length + 1; steps += 1) {
    if (next === above.id) {
      return true;
    }
    next = byId.get(next)?.managerId ?? null;
  }
  return false;
}

/** How many of a manager's reports are shown as pictures before the rest are a count. */
const REPORTS_SHOWN = 5;

/**
 * A line an administrator writes in place, quiet until the pointer or the focus is on it: kept
 * while typed, written when the field is left or Enter is pressed, and only where it changed.
 * `normalize` says what is written; what it makes empty is `onEmpty`'s to answer: written as
 * nothing, or the line put back as it was.
 */
function QuietField(props: {
  readonly value: string;
  /** What the field is, for a screen reader. */
  readonly label: string;
  readonly placeholder?: string | undefined;
  readonly title?: string | undefined;
  readonly type?: "text" | "email";
  readonly maxLength?: number | undefined;
  readonly className?: string | undefined;
  readonly busy: boolean;
  readonly normalize: (typed: string) => string;
  /** Empty, the field writes `null` where this is `clear`, and goes back to the value where it is `keep`. */
  readonly onEmpty: "clear" | "keep";
  readonly onChange: (value: string | null) => void;
}) {
  const current = props.value;
  const [value, setValue] = useState(current);
  // The field follows what the console answers.
  useEffect(() => setValue(current), [current]);
  const commit = () => {
    const next = props.normalize(value);
    if (next === "" && props.onEmpty === "keep") {
      setValue(current);
    } else if (next !== current) {
      props.onChange(next === "" ? null : next);
    }
  };
  return (
    <input
      type={props.type ?? "text"}
      className={cx("sc-input", "sc-input-quiet", props.className)}
      aria-label={props.label}
      title={props.title}
      placeholder={props.placeholder}
      value={value}
      maxLength={props.maxLength}
      disabled={props.busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setValue(current);
        }
      }}
    />
  );
}

export function PeopleList(props: PeopleListProps) {
  const words = useWords();
  const people = words.people;
  const active = props.people.filter((person) => person.status === "active");
  // People first, then the agent accounts, each under its own heading where there are both.
  const persons = active.filter((person) => person.kind !== "agent");
  const accounts = active.filter((person) => person.kind === "agent");
  const deactivated = props.people.filter((person) => person.status === "deactivated");
  const listed = props.listed ?? [];
  const busy = props.busy === true;
  const mayChange = (person: RestPerson): boolean =>
    props.onChangeStatus !== undefined &&
    person.source !== "organization" &&
    props.me?.id !== person.id;
  const organization = props.organization ?? undefined;
  const byId = new Map(props.people.map((person) => [person.id, person]));
  const teamList = props.teams ?? [];
  /** The person's manager, where they have one that can be named here. */
  const managerOf = (person: RestPerson): RestPerson | undefined =>
    person.managerId === null || person.managerId === undefined
      ? undefined
      : byId.get(person.managerId);
  /** What let the person in, by its name: the organization, the domain of their login, or an administrator. */
  const noteOf = (person: RestPerson): string => {
    if (person.source === "organization") {
      return organization === undefined
        ? people.source.organization
        : people.ofOrganization(organization.name);
    }
    if (person.source === "domain") {
      const at = person.login.lastIndexOf("@");
      return at === -1 ? people.source.domain : people.ofDomain(person.login.slice(at + 1));
    }
    return people.source.listed;
  };
  /** A member's card: who they are at the head, what they are as rows, the ways to their work at the foot. */
  const card = (person: RestPerson) => {
    const manager = managerOf(person);
    const reports = active.filter((other) => other.managerId === person.id);
    const joined = teamList.filter((team) => team.memberIds.includes(person.id));
    const toJoin = teamList.filter((team) => !team.memberIds.includes(person.id));
    const name = personName(person);
    const agent = person.kind === "agent";
    const pageHref = agent ? props.agentHref?.(person) : undefined;
    const hasWays =
      props.workHref !== undefined ||
      props.agentsHref !== undefined ||
      pageHref !== undefined ||
      mayChange(person);
    const title = person.title ?? "";
    const writesTitle =
      props.onChangeTitle !== undefined && (props.mayChangeTitle?.(person) ?? true);
    return (
      <li key={person.id} className="sc-person-card">
        <div className="sc-person-card-head">
          <Avatar person={person} size="lg" />
          <div className="sc-person-card-who">
            <span className="sc-person-card-name">
              {pageHref === undefined ? (
                name
              ) : (
                <a className="sc-person-card-link" href={pageHref}>
                  {name}
                </a>
              )}
              {agent && <Badge title={people.agentHint}>{people.agent}</Badge>}
              {props.me?.id === person.id && (
                <span className="sc-person-you">{words.common.you}</span>
              )}
            </span>
            {title !== "" && <span className="sc-person-card-title">{title}</span>}
            <span className="sc-person-card-note">
              {typeof person.handle === "string" && <>@{person.handle} · </>}
              {person.name !== null && <>{person.login} · </>}
              {person.invited === true ? people.invited : noteOf(person)}
            </span>
          </div>
        </div>
        <dl className="sc-person-facts">
          {writesTitle && (
            <div className="sc-person-fact">
              <dt>{people.jobTitle}</dt>
              <dd>
                <QuietField
                  value={title}
                  label={people.titleOf(name)}
                  title={people.titleHint}
                  placeholder={people.nobody}
                  maxLength={MAX_PERSON_TITLE_LENGTH}
                  busy={busy}
                  normalize={(typed) => typed.trim()}
                  onEmpty="clear"
                  onChange={(next) => props.onChangeTitle?.(person, next)}
                />
              </dd>
            </div>
          )}
          <div className="sc-person-fact">
            <dt>{people.role}</dt>
            <dd>
              {/* An agent account is never an administrator (ADR-0084): its role is read. */}
              {props.onChangeRole === undefined || agent ? (
                <RoleBadge role={person.role} />
              ) : (
                <select
                  className="sc-input sc-input-quiet"
                  aria-label={people.roleOf(name)}
                  value={person.role}
                  disabled={busy}
                  onChange={(event) =>
                    props.onChangeRole?.(person, event.target.value as PersonRole)
                  }
                >
                  {PERSON_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {words.vocabulary.role[role]}
                    </option>
                  ))}
                </select>
              )}
            </dd>
          </div>
          <div className="sc-person-fact">
            <dt>{people.manager}</dt>
            <dd>
              {props.onChangeManager === undefined ? (
                manager === undefined ? (
                  <span className="sc-muted">{people.nobody}</span>
                ) : (
                  <PersonChip person={manager} />
                )
              ) : (
                <Picker
                  className="sc-picker-quiet"
                  value={manager}
                  search={peopleSearch(
                    props.people.filter(
                      (candidate) =>
                        candidate.id !== person.id &&
                        (candidate.status === "active" || candidate.id === person.managerId),
                    ),
                  )}
                  keyOf={(candidate) => candidate.id}
                  render={(candidate) => <PersonChip person={candidate} />}
                  renderOption={(candidate) => <PersonOption person={candidate} />}
                  label={people.managerOf(name)}
                  placeholder={people.nobody}
                  disabled={busy}
                  onChange={(candidate) => props.onChangeManager?.(person, candidate?.id ?? null)}
                />
              )}
            </dd>
          </div>
          {(props.onChangeEmail !== undefined || typeof person.email === "string") && (
            <div className="sc-person-fact">
              <dt>{people.email}</dt>
              <dd>
                {props.onChangeEmail === undefined ? (
                  <span className="sc-person-email">{person.email}</span>
                ) : (
                  <QuietField
                    type="email"
                    value={person.email ?? ""}
                    label={people.emailOf(name)}
                    title={people.emailHint}
                    placeholder={people.nobody}
                    busy={busy}
                    normalize={(typed) => typed.trim().toLowerCase()}
                    onEmpty="clear"
                    onChange={(email) => props.onChangeEmail?.(person, email)}
                  />
                )}
              </dd>
            </div>
          )}
          {reports.length > 0 && (
            <div className="sc-person-fact">
              <dt>{people.team}</dt>
              <dd>
                <span className="sc-person-reports" title={reports.map(personName).join(", ")}>
                  <span className="sc-workers">
                    {reports.slice(0, REPORTS_SHOWN).map((report) => (
                      <Avatar key={report.id} person={report} size="sm" />
                    ))}
                  </span>
                  <span className="sc-muted">{people.howMany(reports.length)}</span>
                </span>
              </dd>
            </div>
          )}
          {(joined.length > 0 || (props.onJoinTeam !== undefined && toJoin.length > 0)) && (
            <div className="sc-person-fact">
              <dt>{people.teams}</dt>
              <dd>
                <div className="sc-chips">
                  {joined.map((team) => (
                    <Chip
                      key={team.id}
                      onRemove={
                        props.onLeaveTeam === undefined
                          ? undefined
                          : () => props.onLeaveTeam?.(person, team)
                      }
                      removeLabel={people.leaveTeam(name, team.name)}
                      disabled={busy}
                    >
                      {team.name}
                    </Chip>
                  ))}
                  {props.onJoinTeam !== undefined && toJoin.length > 0 && (
                    <Picker<RestTeam>
                      className="sc-picker-add"
                      value={undefined}
                      search={listSearch(toJoin, (candidate, typed) =>
                        candidate.name.toLowerCase().includes(typed),
                      )}
                      keyOf={(candidate) => candidate.id}
                      render={(candidate) => candidate.name}
                      label={people.joinTeamOf(name)}
                      placeholder={people.joinTeam}
                      disabled={busy}
                      onChange={(candidate) => {
                        if (candidate !== undefined) {
                          props.onJoinTeam?.(person, candidate);
                        }
                      }}
                    />
                  )}
                </div>
              </dd>
            </div>
          )}
        </dl>
        {hasWays && (
          <div className="sc-person-card-ways">
            {props.workHref !== undefined && (
              <a className="sc-button sc-button-ghost sc-button-sm" href={props.workHref(person)}>
                {people.work}
              </a>
            )}
            {props.agentsHref !== undefined && !agent && (
              <a className="sc-button sc-button-ghost sc-button-sm" href={props.agentsHref(person)}>
                {people.agents}
              </a>
            )}
            {pageHref !== undefined && (
              <a className="sc-button sc-button-ghost sc-button-sm" href={pageHref}>
                {people.agentPage}
              </a>
            )}
            {mayChange(person) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => props.onChangeStatus?.(person, "deactivated")}
              >
                {people.deactivate}
              </Button>
            )}
          </div>
        )}
      </li>
    );
  };
  return (
    <div>
      {organization !== undefined && (
        <p className="sc-muted">
          {people.organization(organization.name)}{" "}
          {organization.syncedAt === null ? (
            people.organizationNotRead
          ) : (
            <>
              {people.organizationRead} <Time iso={organization.syncedAt} />
            </>
          )}
        </p>
      )}
      {[
        { key: "people", title: people.sections.people, members: persons },
        { key: "agents", title: people.sections.agents, members: accounts },
      ].map((section) =>
        section.members.length === 0 ? null : (
          <section
            key={section.key}
            className="sc-people-group"
            aria-label={accounts.length === 0 ? people.list : section.title}
          >
            {/* People alone need no heading: the page's title says who they are. */}
            {accounts.length > 0 && (
              <h2 className="sc-section-title">
                {section.title}
                <Badge kind="count">{section.members.length}</Badge>
              </h2>
            )}
            <ul className="sc-people">{section.members.map(card)}</ul>
          </section>
        ),
      )}
      {listed.length > 0 && (
        <section className="sc-people-section" aria-label={people.notSignedIn}>
          <h2 className="sc-section-title">{people.notSignedIn}</h2>
          <ul className="sc-people">
            {listed.map((listing) => (
              <li key={listing.id} className="sc-person-row">
                <span className="sc-person-login">{listing.login}</span>
                <span className="sc-person-name sc-muted">
                  {people.at[listing.host]}
                  <span className="sc-person-note">
                    {" "}
                    <Time iso={listing.createdAt} />
                  </span>
                </span>
                {props.onUnlist !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => props.onUnlist?.(listing)}
                  >
                    {words.common.remove}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {deactivated.length > 0 && (
        <section className="sc-people-section" aria-label={people.deactivated}>
          <h2 className="sc-section-title">{people.deactivated}</h2>
          <ul className="sc-people">
            {deactivated.map((person) => (
              <li key={person.id} className="sc-person-row sc-person-row-out">
                <PersonChip person={person} size="md" />
                <span className="sc-person-name sc-muted">
                  {person.name !== null && <>{person.login} · </>}
                  <span className="sc-person-note">
                    {person.source === "organization" ? people.leftOrganization : noteOf(person)}
                    {person.deactivatedAt !== null && (
                      <>
                        {" "}
                        <Time iso={person.deactivatedAt} />
                      </>
                    )}
                  </span>
                </span>
                <Badge tone="neutral">{words.vocabulary.status.deactivated}</Badge>
                {mayChange(person) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => props.onChangeStatus?.(person, "active")}
                  >
                    {people.reactivate}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export interface TeamListProps {
  /** The teams of the workspace (ADR-0073), by name, each with the members the person may see. */
  readonly teams: readonly RestTeam[];
  /** The people the page holds: whom a team's members are named from, and whom an administrator adds from, the active among them. */
  readonly people: readonly RestPerson[];
  /** Called with the name an administrator wrote for a team. Left out, names are read here. */
  readonly onRename?: ((team: RestTeam, name: string) => void) | undefined;
  /** Called when an administrator deletes a team, after asking where it is the page's to ask. Left out, teams are read here. */
  readonly onRemove?: ((team: RestTeam) => void) | undefined;
  /** Called with a person an administrator puts in a team. Left out, the members are read here. */
  readonly onAddMember?: ((team: RestTeam, person: RestPerson) => void) | undefined;
  /** Called with a member an administrator takes out of a team. */
  readonly onRemoveMember?: ((team: RestTeam, person: RestPerson) => void) | undefined;
  readonly busy?: boolean | undefined;
}

/**
 * The teams of the workspace (ADR-0073), a card each: the name, how many are in it, and who, a
 * chip each. For an administrator the name is written anew in its place, a member is taken out
 * from their chip and a person is added from the end of the row, searched among those in; a team
 * is deleted from its card. Its people stay; the roles granted to it go with it.
 */
export function TeamList(props: TeamListProps) {
  const words = useWords();
  const teams = words.teams;
  const busy = props.busy === true;
  const byId = new Map(props.people.map((person) => [person.id, person]));
  const active = props.people.filter((person) => person.status === "active");
  if (props.teams.length === 0) {
    return <EmptyState title={teams.none.title} body={teams.none.body} />;
  }
  return (
    <ul className="sc-teams" aria-label={teams.list}>
      {props.teams.map((team) => {
        const members = team.memberIds.flatMap((id) => {
          const member = byId.get(id);
          return member === undefined ? [] : [member];
        });
        const candidates = active.filter((person) => !team.memberIds.includes(person.id));
        return (
          <li key={team.id} className="sc-team-card">
            <div className="sc-team-head">
              <div className="sc-team-title">
                {props.onRename === undefined ? (
                  <h2 className="sc-team-name">{team.name}</h2>
                ) : (
                  <QuietField
                    className="sc-team-name"
                    value={team.name}
                    label={teams.nameOf(team.name)}
                    maxLength={MAX_TEAM_NAME_LENGTH}
                    busy={busy}
                    normalize={(typed) => typed.trim()}
                    onEmpty="keep"
                    onChange={(name) => {
                      if (name !== null) {
                        props.onRename?.(team, name);
                      }
                    }}
                  />
                )}
                <span className="sc-team-key" title={teams.keyTitle}>
                  {team.key}
                </span>
              </div>
              <Badge kind="count">{teams.members(team.memberIds.length)}</Badge>
            </div>
            <div className="sc-chips sc-team-members">
              {members.map((member) => (
                <Chip
                  key={member.id}
                  onRemove={
                    props.onRemoveMember === undefined
                      ? undefined
                      : () => props.onRemoveMember?.(team, member)
                  }
                  removeLabel={teams.removeMember(personName(member), team.name)}
                  disabled={busy}
                >
                  <PersonChip person={member} />
                </Chip>
              ))}
              {members.length === 0 && props.onAddMember === undefined && (
                <span className="sc-muted">{teams.nobody}</span>
              )}
              {props.onAddMember !== undefined && candidates.length > 0 && (
                <Picker
                  className="sc-picker-add"
                  value={undefined}
                  search={peopleSearch(candidates)}
                  keyOf={(candidate) => candidate.id}
                  render={(candidate) => <PersonChip person={candidate} />}
                  renderOption={(candidate) => <PersonOption person={candidate} />}
                  label={teams.addMemberTo(team.name)}
                  placeholder={teams.addMember}
                  disabled={busy}
                  onChange={(candidate) => {
                    if (candidate !== undefined) {
                      props.onAddMember?.(team, candidate);
                    }
                  }}
                />
              )}
            </div>
            {props.onRemove !== undefined && (
              <div className="sc-team-ways">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => props.onRemove?.(team)}
                >
                  {teams.remove}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface TeamFormProps {
  readonly busy?: boolean | undefined;
  /** Called with the key and the name written, trimmed. */
  readonly onSubmit: (input: RestTeamInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** A key as the pages accept one: a project key's shape (ADR-0074). */
const TEAM_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Where an administrator makes a team: its name, one in the workspace, and its key, taken from
 * the name as it is typed until the key is typed itself, and never changed after; its people are
 * added on its card.
 */
export function TeamForm(props: TeamFormProps) {
  const words = useWords();
  const form = words.teams.form;
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const valid = name.trim().length > 0 && TEAM_KEY.test(key.trim()) && key.trim() !== "new";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) {
      props.onSubmit({ key: key.trim(), name: name.trim() });
    }
  };
  return (
    <form className="sc-form sc-team-form" aria-label={words.teams.newAria} onSubmit={submit}>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">{form.name}</span>
          <input
            className="sc-input"
            value={name}
            maxLength={MAX_TEAM_NAME_LENGTH}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (!keyTouched) {
                setKey(keyOf(event.target.value).slice(0, MAX_TEAM_KEY_LENGTH));
              }
            }}
          />
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{form.key}</span>
          <input
            className="sc-input"
            value={key}
            maxLength={MAX_TEAM_KEY_LENGTH}
            pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
            autoComplete="off"
            title={form.keyHint}
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value);
            }}
          />
        </label>
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
      </div>
      <p className="sc-field-hint">{form.hint}</p>
    </form>
  );
}

export interface ListingFormProps {
  /** The providers people sign in through here: what a listing may name. */
  readonly providers: readonly RestProvider[];
  readonly busy?: boolean | undefined;
  readonly onSubmit: (input: RestListingInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** Where an administrator lets someone in by login: whoever signs in with that account is in. */
export function ListingForm(props: ListingFormProps) {
  const words = useWords();
  const form = words.people.form;
  const [login, setLogin] = useState("");
  const [chosen, setChosen] = useState<ProviderKey | "">("");
  const only = props.providers.length === 1 ? props.providers[0]?.key : undefined;
  /** The provider named, else the one the login's shape says, else the only one. */
  const host: ProviderKey | undefined =
    chosen !== "" ? chosen : only !== undefined ? only : hostOfLogin(login.trim());
  const offered = props.providers.some((provider) => provider.key === host);
  const valid = host !== undefined && offered && isLoginAt(host, login.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && host !== undefined) {
      props.onSubmit({ host, login: login.trim() });
    }
  };
  return (
    <form className="sc-form sc-listing-form" aria-label={words.people.letInAria} onSubmit={submit}>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">{form.login}</span>
          <input
            className="sc-input"
            value={login}
            maxLength={MAX_LOGIN_LENGTH}
            autoComplete="off"
            onChange={(event) => setLogin(event.target.value)}
          />
        </label>
        {props.providers.length > 1 && (
          <label className="sc-field">
            <span className="sc-field-label">{form.provider}</span>
            <select
              className="sc-input"
              value={chosen}
              onChange={(event) => setChosen(event.target.value as ProviderKey | "")}
            >
              <option value="">{form.byShape}</option>
              {props.providers.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
      </div>
      <p className="sc-field-hint">{form.hint}</p>
    </form>
  );
}
