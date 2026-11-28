# ADR-0168: A plugin that holds the whole directory reads the people its caller may see, where it asks

- Status: Accepted
- Date: 2026-11-28
- Adds to [ADR-0035](0035-who-may-see-whom-is-decided-by-one-policy-and-the-workspace-keeps-its-settings.md), under which one policy decides who sees whom, and to [ADR-0050](0050-plugin-code-runs-in-a-host-process-of-its-own-and-reaches-the-console-only-through-the-capabilities-it-declared.md) and [ADR-0072](0072-a-plugin-is-a-principal-it-holds-roles-granted-to-it-calls-as-itself-and-acts-for-a-person-within-what-both-may-do.md), under which a read of the console in a person's call is the person's.

## Context

A console may keep its people apart (`peopleVisibility: shared_projects`): a member sees those they share a project with, themselves, the administrators and their own reporting line. A plugin with `people:read` alone reads that view in a person's call. A plugin that also needs the directory where nobody calls, a hook that follows the reporting line, a job that sends a notice, holds `people:read:all`, and with it every read of people answers everyone, in a person's call too. So such a plugin had no way to learn whom its caller may see: a calendar of who is away, opened by a customer listed in one project, named every member of the organization, since `everyone` there meant everyone the plugin could read. The plugin could not ask the console's setting either. What kept such a console safe was an administrator remembering to narrow the plugin's own setting.

## Decision

1. **A read of people takes `seenByCaller`.** `ctx.console.people.list({ seenByCaller: true })` answers the people the caller may see, by the policy that decides the console's own listing of people (`personVisibleTo`), whatever capabilities the plugin holds. It is asked through the same listing with the same condition as `GET /api/v1/people`: no second rule is written for plugins.
2. **Every read of people takes it, the same way:** `people.get(id, options)`, `people.granted(role, options)`, `teams.list(options)` and `teams.get(key, options)`, whose members are those among the people read. A plugin that narrows its list and then names a person, a role's holders or a team would show the same people by another read; one option on each keeps a page consistent without the plugin filtering by hand.
3. **The view is a person's.** The caller's own, from a page or by the command; their agent's, with their token; an agent account's, which is a member under the same rule; and that of the person a plugin acts for, as a member whatever they administer (ADR-0072), which is what `people:read` alone already answers for them. A hook, a job and a plugin calling as itself have no caller whose view it could be: the read is refused, `plugin.forbidden`, and never answered with everyone in its place. A caller who is no person of the workspace any more is refused the same way.
4. **What is neither `true` nor `false` is refused** (`plugin.invalid_args`), so that a value meant to narrow a read never leaves it whole. A read that names no options, or the option not at all, answers as it did.
5. **No capability and no consent anew.** The option only narrows what `people:read:all` opens, to what `people:read` opens.
6. **`ctx.console.workspace()` says `peopleVisibility`.** It is what every member reads of the workspace (`GET /api/v1/me`), and by it a plugin tells an administrator, where the people are kept apart, whom its "everyone" reaches: a notice to everyone goes to customers too. It decides nothing by itself: who sees whom is asked with the option, a person at a time, since an administrator sees everyone whatever the setting says.

## Consequences

- A plugin that shows people to its caller asks with the option wherever it holds the whole directory, and its calendar, its lists and its pickers show whom the console shows that member. It keeps the unnarrowed read for what is its own to decide, the approver of a request say, who may be someone the requester does not see.
- A plugin that relies on the option names 0.6.3 as the oldest console it runs on: a console of before reads past the option and answers everyone.
- A call a plugin makes for a person reads their view as a member. An administrator acted for is shown fewer people there than on their own page, as with every read made for them.
- The plugins' test context takes the option through its types; a test's own `people.list` decides what it answers.
- **Rejected:**
  - `peopleVisibility` alone: a plugin could narrow a calendar for everyone or for nobody, not by who looks, and would have to write the policy a second time to do more;
  - the caller's view as the answer of every person's call, whatever the plugin holds: a plugin that names a request's approver, or a manager above the caller, to someone who does not see them stops working, on consoles that enabled it under the sentence "everyone in the workspace";
  - a new method (`people.seen()`): a second read to keep equal to the first in its fields, its search and its bounds;
  - answering a hook or a job with everyone, or with nobody: the first is the leak in another place, the second reads as an empty workspace.
- **Not decided here:** a frame's read of a person's picture (`GET .../people/<id>/picture`) answers anyone's with `people:read:all`, to a member who names an id; it carries no name, and a plugin that narrows its list asks for no such picture.
