---
"@skillcdn/console": patch
---

A plugin that holds the whole directory can read the people its caller may see (ADR-0168). With `people:read:all`, which a plugin asks for its hooks and jobs, every read of people answered everyone in a person's call too, so on a console that keeps its people apart (`peopleVisibility: shared_projects`) a plugin's page showed a member people the console hides from them, and the plugin had no way to tell.

- **`seenByCaller: true`** on `ctx.console.people.list`, `get` and `granted`, and on `ctx.console.teams.list` and `get`, answers among the people the caller may see, as the console's own page of people shows that member: `ctx.console.people.list({ seenByCaller: true })`, `get(id, { seenByCaller: true })`. The type is `PeopleReadOptions`. A read that does not name it answers as before.
- The view is a person's: the caller's own, their agent's, an agent account's, or that of the person a plugin acts for, as a member. A hook, a job and a plugin calling as itself have no caller, and the read is refused (`plugin.forbidden`), never answered with everyone. A value that is neither `true` nor `false` is `plugin.invalid_args`.
- **`ctx.console.workspace()` answers `peopleVisibility`**, `everyone` or `shared_projects`, for a plugin to tell an administrator whom its "everyone" reaches.
- A console older than this version reads past the option and answers everyone: a plugin that relies on it names this version as the oldest console it runs on (the manifest's `console`). No capability is added and no consent is asked anew.
