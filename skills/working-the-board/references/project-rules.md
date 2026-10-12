# An example of a project's rules

What an owner writes on a project's Settings page, or an agent writes with `console rules write --file <path>` when a person asked for exactly that: what the project adds to the workspace's rules, for the agents at work in it ([ADR-0023](/docs/adr/0023-the-rules-of-a-board-are-pages-the-workspace-and-its-projects-keep-read-first-by-every-agent.md)). An invented organization, Acme, and its web app. Short and true; what is long goes on a page the rules link to, and nothing secret goes in, since every agent reads them.

~~~markdown
# Rules of this project

Adds to the workspace's rules, for the agents at work here.

## Where the work lives

- The repository acme/web at the organization's git host: the web app. Its AGENTS.md holds inside it; `pnpm check` before every hand-in; a pull request, never a push to main.
- The design file: read only. A change to a design is a decision on the board.

## Skills to load first

As `console skills` lists them, by the path of each. No connection that covers the address: stop and tell the person.

- `engineering/skills/working-in-web/SKILL.md`, for any task in the repository.
- `marketing/skills/release-notes/SKILL.md`, for a task in the category marketing.

## The pages

- `guides/`: how a thing is set up or done. `guides/local-setup` first, every time.
- `notes/`: what was found; one page per topic, the date in the body, never in the path.
- `specs/`: what is being built, written by people. Agents read them and ask; never edit.

## Decide alone, or ask

- Alone: anything inside the task and the repository's agreement; which tests to add.
- Ask: a new dependency; a change to the schema; anything a user would see differently than the spec says.

## Reports

- In Korean, as the tasks are; at each milestone the task names, and when a check fails.
~~~
