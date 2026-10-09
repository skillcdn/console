---
"@skillcdn/console": minor
---

Roles: a person is an administrator, who configures the board, or a member, who works on it. `RestPerson` carries `role` (`PERSON_ROLES`), the client gains `updatePerson(id, { role })` for an administrator, the feed gains the event `person.role_changed`, the components gain `PeopleList` and `RoleBadge` with `ROLE_LABELS`, and the default console gains the page at `/people`, with `PeopleList` among the components a team may replace.
