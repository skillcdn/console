import { type FormEvent, useState } from "react";
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
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { MAX_LOGIN_LENGTH } from "../limits.js";
import { PERSON_ROLES } from "../vocabulary.js";
import { Badge, Button, PersonChip, personName, RoleBadge, Time } from "./ui.js";

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
  /** Called when an administrator takes a listing away. Left out, listings are read here. */
  readonly onUnlist?: ((listing: RestListing) => void) | undefined;
  /** Where a person's work is seen; given to an administrator, or an owner of a project. */
  readonly workHref?: ((person: RestPerson) => string) | undefined;
  /** Where a person's agents are seen; given to an administrator. */
  readonly agentsHref?: ((person: RestPerson) => string) | undefined;
  readonly busy?: boolean | undefined;
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
        {active.map((person) => (
          <li key={person.id} className="sc-person-row">
            <PersonChip person={person} size="md" />
            <span className="sc-person-name sc-muted">
              {person.name === null ? "" : person.login}
              {props.me?.id === person.id && <span> {words.common.you}</span>}
              <span className="sc-person-note"> {people.source[person.source]}</span>
            </span>
            {props.onChangeRole === undefined ? (
              <RoleBadge role={person.role} />
            ) : (
              <label className="sc-field sc-field-inline">
                <span className="sc-visually-hidden">{people.roleOf(personName(person))}</span>
                <select
                  className="sc-input"
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
              </label>
            )}
            {props.workHref !== undefined && (
              <a className="sc-button sc-button-ghost sc-button-sm" href={props.workHref(person)}>
                {people.work}
              </a>
            )}
            {props.agentsHref !== undefined && (
              <a className="sc-button sc-button-ghost sc-button-sm" href={props.agentsHref(person)}>
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
          </li>
        ))}
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
                  {person.name === null ? "" : person.login}
                  <span className="sc-person-note">
                    {" "}
                    {person.source === "organization"
                      ? people.leftOrganization
                      : people.source[person.source]}
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
    </div>
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
