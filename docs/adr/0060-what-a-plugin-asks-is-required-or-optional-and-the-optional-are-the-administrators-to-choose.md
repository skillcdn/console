# ADR-0060: What a plugin asks is required or optional, and the optional are the administrator's to choose

- Status: Accepted
- Date: 2026-11-07
- Amends point 3 of [ADR-0049](0049-a-plugin-is-an-npm-package-installed-into-the-image-and-enabled-by-an-administrator.md), where consent named every capability a plugin asks. The contract is in [specs/plugins.md](../specs/plugins.md) and [specs/cli.md](../specs/cli.md).

## Context

Enabling a plugin meant ticking every capability it asks, one by one, from a list that started with nothing ticked, for a button that stayed off until all were. The ticks chose nothing: a list with one left out was refused. They read as a choice and were a chore, and they told the administrator nothing about which capabilities the plugin could not do without. A plugin with a part that reaches an outside service, say, had to ask for that host from everyone, or leave the part out for everyone.

## Decision

1. **A plugin says which it requires and which it can go without.** `capabilities` stays as it is and means what the plugin requires; `optionalCapabilities` beside it names what it can go without. A manifest of before reads as it did. A capability is named once across the two, at most 50 together.
2. **`storage:sql` is never optional.** Its schema and its login role are made when the plugin is enabled, and its migrations run then; a plugin whose data lives there does not work without them.
3. **The form shows the two apart.** Those it requires are on and not the administrator's to turn off: enabling the plugin consents to them, so that the button works as soon as the board project is settled. Those it can go without are off until turned on, those consented to before on already. Permissions fail closed, so that an optional capability stays off until someone chooses it.
4. **The optional ones are chosen again at any time.** On the page of a plugin that is enabled, with `PATCH /api/v1/plugins/<key>/consent` and with `console plugin <key> capabilities`: a `plugin.configured` event says what it holds now, and what it no longer holds is refused from its next call on. Those it requires stay; to refuse one is to leave the plugin disabled.
5. **A new version waits for what it requires, and for nothing else.** One that requires a capability its install was not consented to waits as `needs consent`, as before, the new one marked on the form. A new optional capability stops nothing and stays off.
6. **The plugin can tell what it holds.** `ctx.plugin.capabilities` is the list, so that a plugin offers what it can do and does not lead a person to a refusal; a page asks its own server. A call without the capability is `plugin.forbidden`, as before.

## Consequences

- `POST .../enable` takes consent to every capability the plugin requires and any of the optional ones, and `console plugin <key> enable` the same; the refusals are the ones there were.
- A plugin that declares `optionalCapabilities` does not load on a console older than this field, whose manifest is strict; `console` in its manifest says so.
- A plugin decides what is optional. An administrator who wants to refuse something it requires does not enable it: the console offers no way to run a plugin without what it says it needs.
- Nothing is said per capability of what it is for: the sentence an administrator reads is still the catalogue's. A reason in the plugin's own words is a later step, if a plugin turns out to need one.
