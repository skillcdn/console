import type { RestPerson } from "@skillcdn/console/api";
import type { PersonRecord } from "../db/queries/people.js";

// What the records of the database are on the wire. The shapes are the package's; this is the
// one place they are built, so that the server and its tests agree with the schemas.

export function restPerson(person: PersonRecord): RestPerson {
  return {
    id: person.id,
    login: person.login,
    name: person.name ?? null,
    avatar: person.avatarUrl ?? null,
  };
}
