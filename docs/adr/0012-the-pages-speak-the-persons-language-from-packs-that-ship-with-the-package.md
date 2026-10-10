# ADR-0012: The pages speak the person's language, from packs that ship with the package

- Status: Accepted
- Date: 2026-10-10

## Context

Everything committed to this repository is in English, with one exception allowed from the start ([AGENTS.md](../../AGENTS.md), rule 10): what people read in their own language, once the UI gets language packs. Milestone 5 of the [roadmap](../roadmap.md) asks for English first and Korean next, chosen from the browser's languages, switchable, and kept per person, as the main repository's web UI does; the command stays English, since it speaks to agents. This is open question 7 of [architecture.md](../architecture.md): how the packs ship with the package, and how a custom console adds its own.

## Decision

1. **A language pack is a tag, a label and the messages**: every word the default console shows, as one typed object, so that a pack is complete or does not compile. Sentences with parts are functions of their parts, so that each language orders them its own way. English is the source of the keys; Korean ships beside it, and the two are the one place in the repository where text is not English. The packs live in the package (`@skillcdn/console`), since the components are there: a custom console built from the package speaks the same languages without doing anything.
2. **The components take their words from a context** (`useWords`), with English as the default where no provider is above them, so that a component rendered on its own, in a test or on a custom page, still reads. The vocabulary's labels (the states, the priorities, the roles) are in the pack too; the English constants the package exported stay, as the default words.
3. **The language is the person's choice, kept on the person.** `PATCH /api/v1/me` takes `language`, a tag; `GET /api/v1/me` answers it, so that the choice follows the person to another browser. Before a choice, the browser's languages decide, matched against the packs by their language part (`ko-KR` finds `ko`); with no match, English, the first pack. The person's menu switches it. The server keeps the tag and knows nothing of packs.
4. **A custom console passes its packs**: `createConsole({ languages })` replaces the list, so that a console may add a language the package does not carry, or drop one; a pack it adds is complete by type. The tag a person chose is whatever a pack carries.
5. **Dates and numbers follow the language**, through the platform's own formatting with the pack's tag; the page's `lang` attribute follows too.
6. **The command stays English.** Its words are for agents, which read English, and its output is parsed by people's scripts.

## Consequences

- Every component's words move into the pack; adding a word to the console is adding it to every pack, which the type demands. The Korean pack is maintained by whoever changes the English one, in the same change.
- `RestMe` carries `language`; a column on `people`; one route. A test keeps every pack complete, and the text check keeps invisible characters out of them as out of everything else.
- Rejected: a translation library with message syntax of its own, which adds a dependency and a format to learn for a few hundred words; the language in the address (`/ko/...`), which would double every address and is not what a person who reads one language wants; the language in the browser's storage only, which does not follow the person; translating the command, which agents do not need and scripts would break on.
