# ADR-0065: A plugin writes one text, and a person's language is kept from the first time the pages see them

- Status: Accepted
- Date: 2026-11-07
- Supersedes [ADR-0058](0058-what-a-plugin-writes-on-the-board-is-in-every-language-of-the-workspace-and-read-in-the-readers.md), which was never released; amends [ADR-0012](0012-the-pages-speak-the-persons-language-from-packs-that-ship-with-the-package.md), where a person who had not chosen followed the browser on every visit. The contract is in [specs/plugins.md](../specs/plugins.md) and [specs/rest.md](../specs/rest.md).

## Context

ADR-0058 let a plugin write a text in every language of the workspace, and kept the map beside the text. The first plugin to come to it showed what that costs. It would have to build every text in every language for one approver who reads one. Whatever reads the field, the search, the feed, an agent, reads the text kept and not the one a person saw, so that a Korean title was not found by its Korean words. Every page that shows a title reads the map again. An edit needs rules of its own: which language was written over, and whether a form that sends a text back changed it at all. What a person writes on the board, nearly all of it, is one text in one language, and nothing is missing there.

ADR-0058 rejected telling a plugin a person's language: wrong for the next reader, and stale after a change. It is wrong for the next reader as a person's own words are, which the board has always lived with, and a language is not a sensitive thing to know of a person. What did stand in the way is that the console did not know it. A person who had not chosen followed their browser, which only the pages see, and a plugin read `en` for them.

## Decision

1. **A plugin writes one text.** `ctx.console.decisions.ask`, `ctx.console.tasks.create` and `ctx.console.tasks.comment` take strings, and the board keeps one text, as it does of a person. `translations` leaves the API, the events and the tables.
2. **A plugin chooses the language, for whoever the text is for.** A person carries `language`, in `ctx.console.people` and in `GET /api/v1/people`, so that a plugin or an agent writes for the person it writes to. Where several may answer, it chooses one of them. A person with none yet is the plugin's to decide: `ctx.console.workspace().languages` says what the console speaks, English first.
3. **The pages keep a person's language the first time they see them.** A person with no language is spoken to as the browser says, and the pages keep that language on them with `PATCH /api/v1/me`, as if they had chosen it. What the person reads and what a plugin reads are the same from then on. The menu changes it; a browser in another language no longer does.
4. **The pages decide it, and nothing else does.** The server reads no `Accept-Language`: there is one way a language is first decided, the one a person sees the result of.

## Consequences

- A plugin's words go through one call with one language, and an approver reads their own. The search, the feed, the command and an agent read what the person read.
- Whoever reads a text in another language reads it as it was written, as with what a person writes, and a decision for several people of different languages is in one language.
- A person who has never opened the pages has no language, and a plugin writes for them in what it chooses. It is the rare case, a person named before they first come in.
- Everyone who may see a person may see their language.
- A person whose browser language changes keeps the language kept on them until they change it on the menu.
- Rejected: a default language of the workspace, a setting an administrator keeps that is wrong for anyone who differs; reading `Accept-Language` at sign-in, a second way to decide that misses everyone signed in already; keeping the maps, for the reasons above.
