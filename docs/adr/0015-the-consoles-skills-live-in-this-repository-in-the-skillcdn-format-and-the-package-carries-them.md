# ADR-0015: The console's skills live in this repository in the SkillCDN Format, and the package carries them with its sources

- Status: Accepted
- Date: 2026-10-10

## Context

Two kinds of agent meet the console: one working a task on the board through the command, and one building a console of a person's own, or an organization's, from the package ([ADR-0014](0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md)). Both need to understand it: what the board is, how the work goes, what the package's layers are, where the REST API's contract is, and what must never happen (a token in a page, untrusted text as HTML). `npm install` brings the package's built output, its types and its README, which say what each export is but not how a console is made or how the board is worked; the specifications and the architecture are in this repository, which an agent on another machine does not have. Milestone 7 of the [roadmap](../roadmap.md) asked for the components and the composition to be documented, and for a template repository; the organization has a standard for exactly this, the SkillCDN Format, and a reference skill repository, `skillcdn/skills`, written in it.

## Decision

1. **The console's skills live in this repository, in the SkillCDN Format,** next to the code they describe: `skills/working-the-board/SKILL.md` for an agent working a task, `skills/building-a-console/SKILL.md` for one building a console or a script, and `SKILLCDN.md` at the root as their manifest, with the rules every skill shares, the document directory (`docs`) and what is excluded. SkillCDN serves them at `skillcdn.ai/gh/skillcdn/console`, with the architecture, the decisions and the specifications as its documents, and a commit or a tag pins them to the version of the package they describe. A project of a console may name that address as its skills address; an organization's own skill for its console adds its rules and links these.
2. **The skills are maps, not copies.** They say how the work goes and where to read, and link the specifications, the package's README and the deployment contract; they do not restate limits, routes, flags or exports, which the command's own help, the types and the specifications carry and keep current. Where a skill and those differ, the skill says the latter are right.
3. **The package carries them, with its sources.** `@skillcdn/console` ships `skills/`, `SKILLCDN.md` and `docs/specs/` (copied at pack time from their one source), and `src/` without the tests, so that an agent that installed the package reads how to work the board and how to build a console from `node_modules`, at the version installed, and reads the composition it starts from as source. The declaration maps already point there.
4. **The format is checked on every commit.** `skillcdn check` reads the repository as the indexer would and fails on a diagnostic; `scripts/check-skills.mjs` checks what only this repository knows: every command, route and file a skill names exists. A changed meaning is not caught: a change to the command or the API updates its specification and re-reads the skills that name it, as the documentation protocol says.
5. **No template repository, and no example beside the default console.** The default console (`apps/console/web`) is the example, the package's README has the three files a console of one's own starts from, and the skill says how to go on from there.

## Consequences

- An agent gets the console's knowledge the way it gets the organization's other skills, by address, and the way it gets the package, by version; the two are the same commit.
- This repository is a skill repository as well as a code repository: the root README introduces both, and what is under `docs/` is served to whoever holds the address, which it was written for.
- The package grows by its sources and the two specifications; what is copied at pack time is listed in `.gitignore` and never committed twice.
- A skill's digest changes when the manifest or a page it includes changes, so a host that verified it asks again; the skills include nothing and link instead, so that only an edit to a skill changes its digest.
- Rejected: the skills in the reference skill repository (apart from the code and its versions, and not carried by the package); a template repository (a second repository to keep in step with the package, for three files the README shows); an example directory beside the default console (a copy of it, or a member of the workspace that cannot be copied as it is); documentation written for agents in a format of this repository's own (the organization has one, and agents already read it).
