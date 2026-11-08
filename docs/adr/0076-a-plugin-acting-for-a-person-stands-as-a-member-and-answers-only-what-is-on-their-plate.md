# ADR-0076: A plugin acting for a person stands as a member, and answers only what is on their plate

- Status: Accepted
- Date: 2026-11-08
- Amends [ADR-0072](0072-a-plugin-is-a-principal-it-holds-roles-granted-to-it-calls-as-itself-and-acts-for-a-person-within-what-both-may-do.md), whose point on acting for a person said a decision is answered "by the person's own standing, as on the board: whom it is for, or a member of its project". The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

ADR-0072 lets a plugin with `people:act` act for a person who did something elsewhere: a messenger whose user pressed Approve answers the decision for them. It computed the roles of a call to another plugin without the person's administration, so that "neither a matching mistake nor a bug in the plugin reaches past either of them". The review before the release that carried it found the rest of an act for a person did not hold to that.

- A decision was answered by the person's standing on the board, which for an administrator reaches every decision of every project. A plugin that matched a messenger user to the wrong person, or acted on a webhook it had not verified, and named an administrator, answered any open decision anywhere, private projects and other plugins' approvals included, recorded as the administrator's act.
- A call made for a person read the people and the projects as an administrator reads them where the person was one, and with `projects:read:all` as the administrator who enabled the plugin reads them.
- A plugin could name itself among the plugins it calls (`plugins:<its key>`) and, with `people:act`, make every call of its own for anyone.

## Decision

- **Whom a plugin acts for stands as a member.** In every call a plugin makes for a person, the console reads and decides as it does for that person as a member of the workspace, never with their administration, and never with the view of the administrator who enabled the plugin: the people they may see, the projects they are in, what they may do in them.
- **A decision is answered for a person only where it is on their plate**: addressed to them, or a plugin's decision addressed to someone they manage up the reporting line (ADR-0068). Being a member of the decision's project is not enough, since a person who answers one for their project does it on the board, where they see what they answer. Anything else is `plugin.forbidden`.
- **A plugin calls no api of its own.** The manifest refuses `plugins:<its own key>`, required or optional, and a call to itself is refused whatever an install holds.
- **The feed names a plugin as `via` only when it acted for someone.** A plugin calling as itself is the actor's plugin, not a person's go-between.

## Consequences

- A messenger answers for a person what that person was asked, and nothing more; a mistake in matching people answers someone else's own decisions at worst, never the workspace's.
- An administrator who wants a plugin to act with their reach does it on the pages or through their agent, as themselves.
- A manifest of 0.4.4 that named its own key among `plugins:` capabilities is refused; no released plugin did.
