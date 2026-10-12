---
"@skillcdn/console": patch
---

A person's work, seen by whoever oversees them.

- **The REST API.** `GET /api/v1/people/<id>/work` answers another person's plate, for an administrator or for an owner of a project the person is in (everyone of the workspace is in a project open to it; a private one holds those listed), signed in or through their agent: the person's open tasks within the projects the asker may see and no other, each with its project, the sooner due first; no decisions, which wait for anyone. `auth.forbidden` for anyone else, `person.not_found` for an id that is nobody's.
- **The command.** `console work --person <login>` shows it, as `console work` shows one's own.
- **The client.** `client.personWork(personId)`, `restPersonWorkSchema` and `RestPersonWork`, `personWorkPath(personId)`.
- **The default UI.** `/people/<id>/work` (`personWorkHref(id, week?)`, the route `person-work`, with `?week=` as My work has it): the week and the lists of My work under the person's name, without the decisions; a "Work" link beside each person on the People page for an administrator or an owner, and beside each member on a project's Members page for its owners; a plate that is not the asker's to see says so. `WorkList` takes `work.decisions` as optional and leaves the section out when it is left out; `PeopleList` and `MemberList` take `workHref`. Words under `people`: `work`, `workOf`, `loadingWork`, `couldNotLoadWork`, `noWork`, `notOverseen`.
