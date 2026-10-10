import type { PersonRole, RestPerson } from "../api.js";
import { useWords } from "../i18n/index.js";
import { PERSON_ROLES } from "../vocabulary.js";
import { PersonChip, RoleBadge } from "./ui.js";

// The people of the board, with what each may do. An administrator changes roles here; a
// member reads. Takes its data as props and nothing from the network.

export interface PeopleListProps {
  readonly people: readonly RestPerson[];
  /** Whoever is looking, so that their own row says so. */
  readonly me?: RestPerson | undefined;
  /** Called with the role an administrator chose. Left out, roles are read here, not changed. */
  readonly onChangeRole?: ((person: RestPerson, role: PersonRole) => void) | undefined;
  /** Where a person's agents are seen; given to an administrator. */
  readonly agentsHref?: ((person: RestPerson) => string) | undefined;
  readonly busy?: boolean | undefined;
}

export function PeopleList(props: PeopleListProps) {
  const words = useWords();
  return (
    <ul className="sc-people" aria-label={words.people.list}>
      {props.people.map((person) => (
        <li key={person.id} className="sc-person-row">
          <PersonChip person={person} size="md" />
          <span className="sc-person-name">
            {person.name ?? ""}
            {props.me?.id === person.id && <span className="sc-muted"> {words.common.you}</span>}
          </span>
          {props.onChangeRole === undefined ? (
            <RoleBadge role={person.role} />
          ) : (
            <label className="sc-field sc-field-inline">
              <span className="sc-visually-hidden">{words.people.roleOf(person.login)}</span>
              <select
                className="sc-input"
                value={person.role}
                disabled={props.busy === true}
                onChange={(event) => props.onChangeRole?.(person, event.target.value as PersonRole)}
              >
                {PERSON_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {words.vocabulary.role[role]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {props.agentsHref !== undefined && (
            <a className="sc-button sc-button-ghost sc-button-sm" href={props.agentsHref(person)}>
              {words.people.agents}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
