# ADR-0081: A workspace has a language, for whoever has none of their own

- Status: Accepted
- Date: 2026-11-09
- Amends [ADR-0065](0065-a-plugin-writes-one-text-and-a-persons-language-is-kept-from-the-first-time-the-pages-see-them.md), which rejected a default language of the workspace and left a person with no language to each plugin, English first. The contract is in [specs/plugins.md](../specs/plugins.md) and [specs/rest.md](../specs/rest.md).

## Context

ADR-0065 keeps a person's language from the first time the pages see them, and leaves a person who has none to the plugin, `ctx.console.workspace().languages` saying what the console speaks, English first. It took that person for the rare case, someone named before they first come in, and rejected a language of the workspace as a setting wrong for anyone who differs.

Since the messenger, the rare case is common: people who work through the organization's chat and never open the console have no language, and whatever a plugin writes to them falls back on English, in an organization that speaks Korean. The first plugins took the first of `languages` for the workspace's language and wrote English, the messenger in the names of its app and its shortcut, the HR plugin in the decisions and tasks its jobs write; each worked around it its own way. The console's own fallbacks were English too: a command of a person with no language, a hook, a job, the pages for a browser that asks for no language the console speaks.

## Decision

1. **A workspace has a language.** An administrator sets it on the Settings page or with `console workspace edit --language <en|ko|none>` (`PATCH /api/v1/workspace`, `language`): one the console speaks, or none. It is a fallback and nothing more: whoever has a language of their own keeps it, and the pages still keep the browser's language the first time they see a person (ADR-0065, point 3).
2. **A plugin reads it.** `ctx.console.workspace()` answers `language`, the workspace's, else `en`, and `languageSet`, whether an administrator set it, as `timeZone` and `timeZoneSet` do; `languages`, what the console speaks, has it first, so that the first of them is still the default the contract names. A plugin writes to a person with no language in `language`. The frame's `init.workspace` carries `language` and the same order.
3. **The console falls back on it.** A call runs in the language of whoever it is for, else the workspace's: a command or an endpoint of a person with none, a call for a person with none, and the console's own calls, the hooks, the jobs, enabling, disabling and the upgrades. The pages speak the person's language, else the browser's, else the workspace's, else English; the command reads the plugins' words in the person's language, else the workspace's.

## Consequences

- An organization that speaks one language says so once, and everyone who has not chosen reads it, on the pages and wherever the plugins write.
- A workspace with none set behaves as before, in English, and `languageSet: false` tells a plugin so, so that it can say so instead of taking English for a choice.
- The setting is wrong for whoever differs only until they open the pages or choose on the menu: ADR-0065's objection holds for them, and the setting never overrides a choice.
- A call for a person with no language follows the workspace's, where it followed the caller's; with none set, it still follows the caller's.
- Rejected: `language` as `null` where none is set beside `languageSet`, two ways to say one thing, leaving every plugin a `null` to handle where it wants a language; the administrator's own language as the default, a guess that changes with whoever administers; reading `Accept-Language`, as ADR-0065 rejected.
