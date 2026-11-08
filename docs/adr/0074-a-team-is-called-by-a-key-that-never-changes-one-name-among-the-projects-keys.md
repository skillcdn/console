# ADR-0074: A team is called by a key that never changes, one name among the projects' keys

- Status: Accepted
- Date: 2026-11-08
- Amends [ADR-0073](0073-a-team-is-a-name-and-its-members-a-unit-to-call-people-by-and-to-grant-a-plugins-role-to.md), whose teams were named by their name and called by their id. A project's key, of the same shape, is [ADR-0008](0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md)'s. The contract is in [specs/rest.md](../specs/rest.md), [specs/cli.md](../specs/cli.md) and [specs/plugins.md](../specs/plugins.md).

## Context

ADR-0073 gave a team a name, which people read and an administrator changes, and an id, which nobody reads. Everything that calls a team had to use one of the two. The command found a team by its name, so a rename broke every script that named it, and a name in Korean is not something a person types into a terminal. A grant, a plugin's code and the people listing named it by its id, which says nothing to a person reading a plugin's settings or a messenger's mapping of a team to a channel. A project has had the answer since ADR-0008: a key, lowercase letters, digits and hyphens, that never changes, beside a name that does.

The teams had not been released when this was decided, so the contract could still change without breaking anyone.

## Decision

- **A team has a key.** It has the shape of a project's key: lowercase letters, digits and hyphens, beginning and ending with a letter or a digit, at most 40 characters, and not `new`, which the pages reserve. An administrator gives it when making the team. The pages offer one taken from the name as it is typed, and the command takes it first: `console team new <key> "<name>"`. It never changes; renaming a team changes its name alone.
- **One name among the projects' keys.** No team and no project of a workspace share a key, so that something that calls a team or a project by its key, such as a mention in a messenger, never has to guess which one is meant. Making a team checks the projects' keys, and making a project checks the teams' keys, both under the workspace's row, so that the two can never be made under one key at once. A person's login is a separate kind of name, given by the git host or the Workspace; a mention that mixes people with teams and projects is for the plugin that defines it.
- **The key is the address.** `PATCH` and `DELETE /api/v1/teams/<key>` and `.../members` take the key. A grant names a team by it (`team: "<key>"`, `--team <key>`), and answers `team: { key, name }`. The people listing and `ctx.console.people` name each person's teams by key (`teams`), and `ctx.console.teams.get(key)` reads one. The events of a team carry its `key` beside its name. The id stays in the record, as a project's does, and nothing is called by it.
- **A team made before keys** is given `team-` and its id, which no other team has, by the migration. Only consoles that ran a build between the two decisions have one, since no release carried teams without keys; an administrator who wants a key that reads better makes the team again under it.

## Consequences

- A script, a plugin's settings and a messenger's mapping keep working when a team is renamed, and read as what they mean.
- The workspace's projects and teams share one set of keys: a project cannot take a key a team has, and the other way round. A workspace that later wants a third kind of thing in the same set, a plugin's own group say, has to be checked against both.
- A key given by mistake stays; the team is removed and made again under the right one, its grants with it.
