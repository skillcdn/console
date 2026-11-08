# ADR-0072: A plugin is a principal: it holds roles granted to it, calls as itself, and acts for a person within what both may do

- Status: Accepted
- Date: 2026-11-08
- Extends [ADR-0021](0021-a-token-configures-as-its-person-does.md), under which a token acts as its person and nothing is granted to an agent, and [ADR-0050](0050-plugin-code-runs-in-a-host-process-of-its-own-and-reaches-the-console-only-through-the-capabilities-it-declared.md), under which a plugin reaches the console through capabilities an administrator consented to. Follows [ADR-0071](0071-the-console-sends-no-notification-of-its-own-a-plugin-carries-them-out-of-the-board-and-back.md), which left the standing to act as the next decision. The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

A plugin that carries the board to a messenger must do three things no plugin could. A shortcut there opens a form, and the request it makes must be the `hr` plugin's command run *for the person who pressed it*. A button in an approval thread must answer the console's decision *for the approver who pressed it*. And to share a request's detail in a channel it must read another plugin's record *with nobody at the keyboard*, under a role of that plugin.

What stood: a role of a plugin was granted to a person, to a project's members or to everyone, never to a plugin. A plugin calling another from its job, hook or webhook ran the callee with *every* role of the callee, so that `plugins:hr` alone made a plugin hr's administrator, with no scope, nobody it acted for, and no record of it. And a plugin never answered a decision, which was right: nothing a plugin computes should decide for a person.

## Decision

A plugin is a principal of its own: it holds what was granted to it, it calls other plugins as itself, and, with a capability, it acts for a person within what both of them may do.

- **A role may be granted to a plugin.** A grant's target is one of four: a person, a project's members, everyone, or a plugin by key (`plugin_grants.grantee_plugin_key`). An administrator grants and revokes it, on the role's row of the settings page and with `console plugin <key> grant <role> --plugin <key>`; the feed names the plugin it went to. A plugin holds the roles granted to it by key and the callee's `defaultRole`, as a member does; never an administrator's standing, which is a person's, and never a grant to everyone, which is every member's.
- **A plugin asks in its manifest.** `grants: { <key>: { roles, why } }` names the roles of other plugins it asks to hold and why, in a sentence for the administrator. The enable form offers to grant each whose plugin is enabled, the plugin's page lists them with how they stand, `GET /api/v1/plugins/<key>` answers them as `asks`, and the plugin reads what it holds as `ctx.plugin.grants`, so that its own page can say what it lacks and what that costs.
- **A plugin is a caller of its own kind.** When the console's own call of a plugin, a job, a hook or a webhook, reaches another plugin, the callee sees `{ kind: "plugin", plugin, roles, for: null }`: the calling plugin, with the roles granted to it in the callee. The callee's roles decide as for anyone, and a callee may refuse the kind where its rules need a person. This replaces the console caller with every role: a plugin that knows only `person` and `console` refuses the new kind, which fails safe.
- **Acting for a person.** With `people:act`, consented to in its own sentence, a plugin calls another plugin for a person, `ctx.plugins.get(key).for(personId)`, and answers a decision for one, `ctx.console.decisions.answer(id, answer, { for })`. The person is an active person of the workspace, or the call is `plugin.not_found`. The effective roles are the intersection: what the plugin was granted in the callee and what the person holds there, computed without the person's administration, so that neither a matching mistake nor a bug in the plugin reaches past either of them. The call runs in the person's language. A decision is answered by the person's own standing, as on the board (ADR-0068): whom it is for, or a member of its project; a plugin answers no decision itself.
- **Recorded as theirs, through the plugin.** What a plugin does for a person is the person's act: the event names the person as its actor, the plugin whose code acted as `plugin`, and the plugin that acted for them as `via`; the feed says "through <plugin>" beside the name, as it says "as <agent>" for a token. A plugin's own call names nobody but the plugin, as before.
- **A plugin hears of what it may call.** `plugin.enabled`, `plugin.disabled` and `plugin.upgraded` of a plugin reach the hooks of every plugin holding `plugins:<key>` for it, with their content, so that a carrier adds and removes what it offers as its producers come and go.

## Consequences

- The grants a plugin holds are read on every call: a revoke takes effect at once, and a disabled plugin stops at once.
- Breaking for plugins that called another plugin from a job or a hook and relied on every role: they now hold what an administrator granted them, which no published plugin relied on.
- `plugin.command` is recorded for a person's command as before; an api call between plugins is logged by the console with who called, as what, and for whom. A record a plugin writes for a person names the person; naming the plugin it came through on the record itself is left for when a plugin asks.
- Teams, when they come, are a fifth target of a grant in the same place.
