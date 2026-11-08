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
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { MAX_LOGIN_LENGTH, MAX_TEAM_NAME_LENGTH } from "../limits.js";
import { PERSON_ROLES } from "../vocabulary.js";
import { Picker } from "./picker.js";
import { listSearch, peopleSearch } from "./searches.js";
import { Avatar, Badge, Button, PersonChip, personName, RoleBadge, Time, Workers } from "./ui.js";

// The people of the board, with what each may do and whether they are in (ADR-0022): those in,
// the logins let in that nobody has signed in with yet, and those deactivated. An administrator
// changes roles here, takes people out and back in, and takes a listing away; a member reads.
// Takes its data as props and nothing from the network.

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
  /** Called when an administrator takes a listing away. Left out, listings are read here. */
  readonly onUnlist?: ((listing: RestListing) => void) | undefined;
  /** The teams of the workspace (ADR-0073), each with the members the person may see; left out, none are shown. */
  readonly teams?: readonly RestTeam[] | undefined;
  /** The ways an administrator keeps the teams. Left out, the teams are read here. */
  readonly onCreateTeam?: ((name: string) => void) | undefined;
  readonly onRenameTeam?: ((team: RestTeam, name: string) => void) | undefined;
  readonly onRemoveTeam?: ((team: RestTeam) => void) | undefined;
  readonly onJoinTeam?: ((person: RestPerson, team: RestTeam) => void) | undefined;
  readonly onLeaveTeam?: ((person: RestPerson, team: RestTeam) => void) | undefined;
  /** Where a person's work is seen; given to an administrator, or an owner of a project. */
  readonly workHref?: ((person: RestPerson) => string) | undefined;
  /** Where a person's agents are seen; given to an administrator. */
  readonly agentsHref?: ((person: RestPerson) => string) | undefined;
  readonly busy?: boolean | undefined;
}

/**
 * A person's work email as an administrator writes it: kept while typed, written when the field
 * is left or Enter is pressed, and only where it changed; emptied, it clears the address.
 */
function EmailField(props: {
  readonly person: RestPerson;
  readonly label: string;
  readonly busy: boolean;
  readonly onChange: (email: string | null) => void;
}) {
  const current = props.person.email ?? "";
  const [value, setValue] = useState(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field follows what the console answers for the person
  useEffect(() => setValue(current), [current, props.person.id]);
  const commit = () => {
    const next = value.trim().toLowerCase();
    if (next !== current) {
      props.onChange(next === "" ? null : next);
    }
  };
  return (
    <input
      type="email"
      className="sc-input sc-input-quiet"
      aria-label={props.label}
      value={value}
      disabled={props.busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

export function PeopleList(props: PeopleListProps) {
  const words = useWords();
  const people = words.people;
  const active = props.people.filter((person) => person.status === "active");
  const deactivated = props.people.filter((person) => person.status === "deactivated");
  const listed = props.listed ?? [];
  const mayChange = (person: RestPerson): boolean =>
    props.onChangeStatus !== undefined &&
    person.source !== "organization" &&
    props.me?.id !== person.id;
  const organization = props.organization ?? undefined;
  const byId = new Map(props.people.map((person) => [person.id, person]));
  const teamList = props.teams ?? [];
  /** The teams the person is in, and those they could be put in. */
  const teamsOf = (person: RestPerson): readonly RestTeam[] =>
    teamList.filter((team) => team.memberIds.includes(person.id));
  const teamsToJoin = (person: RestPerson): readonly RestTeam[] =>
    teamList.filter((team) => !team.memberIds.includes(person.id));
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
  return (
    <div className="sc-people-page">
      {organization !== undefined && (
        <p className="sc-people-organization sc-muted">
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
      <ul className="sc-people" aria-label={people.list}>
        {active.map((person) => {
          const manager = managerOf(person);
          const team = active.filter((other) => other.managerId === person.id);
          const hasWays =
            props.workHref !== undefined || props.agentsHref !== undefined || mayChange(person);
          return (
            <li key={person.id} className="sc-person-card">
              <div className="sc-person-card-head">
                <Avatar person={person} size="lg" />
                <div className="sc-person-card-who">
                  <span className="sc-person-card-name">
                    {personName(person)}
                    {props.me?.id === person.id && (
                      <span className="sc-person-you">{words.common.you}</span>
                    )}
                  </span>
                  <span className="sc-person-card-note">
                    {person.name !== null && <>{person.login} · </>}
                    {noteOf(person)}
                  </span>
                </div>
              </div>
              <dl className="sc-person-facts">
                <div className="sc-person-fact">
                  <dt>{people.role}</dt>
                  <dd>
                    {props.onChangeRole === undefined ? (
                      <RoleBadge role={person.role} />
                    ) : (
                      <select
                        className="sc-input sc-input-quiet"
                        aria-label={people.roleOf(personName(person))}
                        value={person.role}
                        disabled={props.busy === true}
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
                        value={manager}
                        search={peopleSearch(
                          props.people.filter(
                            (candidate) =>
                              candidate.id !== person.id &&
                              (candidate.status === "active" || candidate.id === person.managerId),
                          ),
                        )}
                        keyOf={(candidate) => candidate.id}
                        render={(candidate) => <PersonChip person={candidate} size="sm" />}
                        label={people.managerOf(personName(person))}
                        placeholder={people.nobody}
                        disabled={props.busy === true}
                        onChange={(candidate) =>
                          props.onChangeManager?.(person, candidate?.id ?? null)
                        }
                      />
                    )}
                  </dd>
                </div>
                {(props.onChangeEmail !== undefined || typeof person.email === "string") && (
                  <div className="sc-person-fact">
                    <dt>{people.email}</dt>
                    <dd>
                      {props.onChangeEmail === undefined ? (
                        person.email
                      ) : (
                        <EmailField
                          person={person}
                          label={people.emailOf(personName(person))}
                          busy={props.busy === true}
                          onChange={(email) => props.onChangeEmail?.(person, email)}
                        />
                      )}
                    </dd>
                  </div>
                )}
                {team.length > 0 && (
                  <div className="sc-person-fact">
                    <dt>{people.team}</dt>
                    <dd>
                      <Workers workers={team} />
                    </dd>
                  </div>
                )}
                {(teamsOf(person).length > 0 ||
                  (props.onJoinTeam !== undefined && teamsToJoin(person).length > 0)) && (
                  <div className="sc-person-fact">
                    <dt>{people.teams}</dt>
                    <dd>
                      <div className="sc-chips">
                        {teamsOf(person).map((joined) => (
                          <span key={joined.id} className="sc-chip">
                            {joined.name}
                            {props.onLeaveTeam !== undefined && (
                              <button
                                type="button"
                                className="sc-chip-remove"
                                aria-label={`${words.common.remove}: ${joined.name}`}
                                disabled={props.busy === true}
                                onClick={() => props.onLeaveTeam?.(person, joined)}
                              >
                                <span aria-hidden="true">&times;</span>
                              </button>
                            )}
                          </span>
                        ))}
                        {props.onJoinTeam !== undefined && teamsToJoin(person).length > 0 && (
                          <Picker<RestTeam>
                            value={undefined}
                            search={listSearch(teamsToJoin(person), (candidate, typed) =>
                              candidate.name.toLowerCase().includes(typed),
                            )}
                            keyOf={(candidate) => candidate.id}
                            render={(candidate) => candidate.name}
                            label={people.joinTeamOf(personName(person))}
                            placeholder={people.joinTeam}
                            disabled={props.busy === true}
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
                    <a
                      className="sc-button sc-button-ghost sc-button-sm"
                      href={props.workHref(person)}
                    >
                      {people.work}
                    </a>
                  )}
                  {props.agentsHref !== undefined && (
                    <a
                      className="sc-button sc-button-ghost sc-button-sm"
                      href={props.agentsHref(person)}
                    >
                      {people.agents}
                    </a>
                  )}
                  {mayChange(person) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={props.busy === true}
                      onClick={() => props.onChangeStatus?.(person, "deactivated")}
                    >
                      {people.deactivate}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
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
                    disabled={props.busy === true}
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
                    disabled={props.busy === true}
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
      {props.teams !== undefined && (
        <TeamSection
          teams={props.teams}
          byId={byId}
          busy={props.busy === true}
          onCreateTeam={props.onCreateTeam}
          onRenameTeam={props.onRenameTeam}
          onRemoveTeam={props.onRemoveTeam}
        />
      )}
    </div>
  );
}

/**
 * A team's name as an administrator writes it anew: kept while typed, written when the field is
 * left or Enter is pressed, and only where it changed; emptied, it goes back to the name.
 */
function TeamNameField(props: {
  readonly team: RestTeam;
  readonly label: string;
  readonly busy: boolean;
  readonly onChange: (name: string) => void;
}) {
  const current = props.team.name;
  const [value, setValue] = useState(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field follows the name as the console answers it
  useEffect(() => setValue(current), [current, props.team.id]);
  const commit = () => {
    const next = value.trim();
    if (next === "") {
      setValue(current);
    } else if (next !== current) {
      props.onChange(next);
    }
  };
  return (
    <input
      className="sc-input sc-input-quiet"
      aria-label={props.label}
      value={value}
      maxLength={MAX_TEAM_NAME_LENGTH}
      disabled={props.busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * The teams of the workspace (ADR-0073): each with who is in it, among the people the page
 * holds; for an administrator, named anew, removed, and a new one made.
 */
function TeamSection(props: {
  readonly teams: readonly RestTeam[];
  readonly byId: ReadonlyMap<string, RestPerson>;
  readonly busy: boolean;
  readonly onCreateTeam?: ((name: string) => void) | undefined;
  readonly onRenameTeam?: ((team: RestTeam, name: string) => void) | undefined;
  readonly onRemoveTeam?: ((team: RestTeam) => void) | undefined;
}) {
  const words = useWords();
  const people = words.people;
  const [draft, setDraft] = useState("");
  return (
    <section className="sc-people-section" aria-label={people.teams}>
      <h2 className="sc-section-title">{people.teams}</h2>
      {props.teams.length === 0 && <p className="sc-muted">{people.teamsNone}</p>}
      {props.teams.length > 0 && (
        <ul className="sc-people">
          {props.teams.map((team) => {
            const members = team.memberIds.flatMap((id) => {
              const member = props.byId.get(id);
              return member === undefined ? [] : [member];
            });
            return (
              <li key={team.id} className="sc-person-row">
                {props.onRenameTeam === undefined ? (
                  <span className="sc-person-login">{team.name}</span>
                ) : (
                  <TeamNameField
                    team={team}
                    label={people.teamNameOf(team.name)}
                    busy={props.busy}
                    onChange={(name) => props.onRenameTeam?.(team, name)}
                  />
                )}
                <span className="sc-person-name sc-muted">
                  {people.teamMembers(team.memberIds.length)}
                </span>
                {members.length > 0 && <Workers workers={members} />}
                {props.onRemoveTeam !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={props.busy}
                    onClick={() => props.onRemoveTeam?.(team)}
                  >
                    {words.common.remove}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {props.onCreateTeam !== undefined && (
        <form
          className="sc-form sc-member-form"
          aria-label={people.newTeam}
          onSubmit={(event) => {
            event.preventDefault();
            const name = draft.trim();
            if (name.length > 0) {
              props.onCreateTeam?.(name);
              setDraft("");
            }
          }}
        >
          <label className="sc-field">
            <span className="sc-field-label">{people.teamName}</span>
            <input
              className="sc-input"
              value={draft}
              maxLength={MAX_TEAM_NAME_LENGTH}
              disabled={props.busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={props.busy || draft.trim().length === 0}>
            {people.newTeam}
          </Button>
        </form>
      )}
    </section>
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
