# ADR-0052: A plugin's board is a project, made or chosen when it is enabled, and what it puts there carries its name

- Status: Accepted; the second point is amended by [ADR-0080](0080-a-plugin-reaches-the-projects-it-is-placed-on-and-whoever-may-use-it-is-a-requester-in-its-board-project.md): the project the matter belongs to is one the plugin is placed on
- Date: 2026-11-01

## Context

A decision and a task belong to a project ([ADR-0008](0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md)): who sees or answers them is decided by membership, a person's decisions are gathered from their projects, and agents take tasks in a project. A plugin that asks a person to approve, or leaves work for an agent, must put that where people already look, without the console growing a second kind of decision. Several plugins may serve one team, and one plugin's work should be readable by another without either undoing the other's.

## Decision

1. **A board project.** A plugin's manifest says whether it needs a board (`required`, `optional`, `none`). When one is enabled, the administrator either makes a project for it, from the key, name and description the manifest proposes in each language, edited as they like and private by default, or chooses a project that exists. Several plugins may bind to one project. A plugin's decisions, tasks and documents go there; its decisions are answered by the people of that project as any decision is, and appear among a person's decisions and in `console work`.
2. **The project the matter belongs to.** Where a record is linked to a project and the person asking may work there, the plugin may raise its decision or task in that project instead: the plugin's board is the project the matter belongs to, and the board project where none does.
3. **What a plugin puts on a board carries its name.** The console records each task, decision and document a plugin makes as the plugin's, the event names the plugin beside the person, and the pages and the feed say through which plugin. A plugin changes, closes, comments or takes the answer of its own items only; it reads every item of its board projects. Its documents are written under `plugins/<key>/` and nowhere else. One plugin refers to another's work by reading, and calls it through the other's API where both declare it.
4. **A plugin never decides.** It raises decisions and waits: a command that waits says so, and the command exits as `ask` does. It answers no decision, in anyone's name.
5. **Project pages are turned on by an administrator**, for every project or for the ones they name. An owner does not enable a plugin in their project, since a project's owner may be outside the organization.

## Consequences

- Nothing changes in what a decision or a task is; the console's quotas, policy and pages apply to a plugin's items as to anyone's.
- A team's board for a kind of work is a project: its rules may say which plugin's skill an agent reads first, and its feed is the record of that work.
- Two plugins in one project do not collide: each edits its own, reads all, writes pages in its own folder.
- Rejected: decisions and tasks at the workspace level (a second kind of decision, with policy, pages and command of its own); one project for every plugin (a mixed board nobody owns); a plugin's own approval records (a person's decisions in two places); plugins enabled per project by owners (an outsider enabling code in the console).
