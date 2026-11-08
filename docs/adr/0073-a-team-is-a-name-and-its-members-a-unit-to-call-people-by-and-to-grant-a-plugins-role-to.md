# ADR-0073: A team is a name and its members, a unit to call people by and to grant a plugin's role to

- Status: Accepted
- Date: 2026-11-08
- Extends [ADR-0022](0022-who-is-in-is-the-consoles-own-record-and-an-administrator-keeps-it.md), under which who is in is the console's own record kept by an administrator, and [ADR-0072](0072-a-plugin-is-a-principal-it-holds-roles-granted-to-it-calls-as-itself-and-acts-for-a-person-within-what-both-may-do.md), under which a role of a plugin goes to a person, a project's members, everyone or a plugin. The contract is in [specs/rest.md](../specs/rest.md), [specs/cli.md](../specs/cli.md) and [specs/plugins.md](../specs/plugins.md).

## Context

The directory knew one thing about how people hang together: whom each reports to. The first plugin to need more kept teams of its own, with approvers of its own, until the reporting line made that redundant and the next plugins asked for the same grouping; plugins cannot share code, so the grouping has to be the console's. A messenger wants to tell a team; a calendar wants to show one; a role of a plugin wants to go to one and follow it as people join and leave.

What a team is not, matters as much. An organization chart, with teams in teams and a head of each, would say twice what the reporting line says once, and would be wrong by the second reorganization. A team that owns tasks or projects would be a third kind of principal where the board has two.

## Decision

A team is a name and its members, and nothing else.

- **A name, and who is in it.** A team has a name, one per workspace without regard to case, and members, any number of them; a person is in any number of teams. There is no head and no team above a team: the reporting line says who is above whom. An administrator makes, renames and removes a team and puts people in and takes them out, on the People page and with `console team`, and the board records each as the workspace's own event (`team.created`, `team.renamed`, `team.removed`, `team.member_added`, `team.member_removed`).
- **A unit to call people by.** The people listing and `ctx.console.people` name the teams each person is in (`teamIds`); `GET /api/v1/teams` and `ctx.console.teams` list the teams with the members the asker may see, under the same visibility as the people. A plugin reads them with `people:read`, as it reads people, and hears of their changes with `people:read:all`, as it hears of the people's. What the pages said of the people a person manages is "reports" now, so that a team means membership alone.
- **A unit to grant a role to.** A role of a plugin goes to a team as it goes to a project's members: whoever is in the team holds it, and the grant follows the membership from the moment it changes. Removing a team takes its memberships and its grants with it.
- **Not a member of a project, not an owner of work.** A project's membership stays a person's, and a task's workers stay people. Listing a team in a project, so that its members come and go with it, is a later decision if a project asks for it; so is a task given to a team as a whole. Neither is ruled out, and neither is built.
- **Kept by an administrator.** Who keeps the teams is who keeps the directory. A plugin cannot change them, as it cannot change who is in or whom they report to; a plugin that lets someone else keep them is a later decision, once one asks.

## Consequences

- Plugins drop the groupings of their own and read the console's; nothing is moved, since the first plugin kept none in the end.
- The feed and the hooks carry five new kinds of event, which an older command's reader refuses as it refuses any unknown kind; the console's floor already stands at 0.4.5 for this line, and the REST snapshot is taken again at it.
- A grant has five targets. Teams in grants to projects' memberships, and a task's team, wait for the decisions named above.
