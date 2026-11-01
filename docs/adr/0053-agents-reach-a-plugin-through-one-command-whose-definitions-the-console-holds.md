# ADR-0053: Agents reach a plugin through one command whose definitions the console holds

- Status: Accepted
- Date: 2026-11-01

## Context

An agent works the board through the REST API and the thin `console` command, which has no logic of its own ([ADR-0006](0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)); the board's rules reach it with the task it takes ([ADR-0023](0023-the-rules-of-a-board-are-pages-the-workspace-and-its-projects-keep-read-first-by-every-agent.md)). A plugin brings commands of its own, which would otherwise mean a release of the command for every plugin, a new word in every agent's context, and help nobody keeps in step. What an agent reads costs it; a plugin an agent never uses should cost it nothing.

## Decision

1. **One generic command.** `console plugins` lists the plugins the console has and what the caller holds in each; `console plugin <key>` describes one, its commands and queries in a line each, its skills, its board project; `console plugin <key> help <command>` is one command whole; `console plugin <key> <command> …` runs one. The command sends the words as they were typed, and the console parses them against the definition the plugin's server module declared, with the same forms, limits and refusals as the console's own commands, in English. Adding or changing a plugin changes no command.
2. **Commands and queries are the plugin's surface, for the pages too.** A command writes, a query reads; both are plugin code under the host ([ADR-0050](0050-plugin-code-runs-in-a-host-process-of-its-own-and-reaches-the-console-only-through-the-capabilities-it-declared.md)), run as the person with their roles. The generic reads of records and files, and the five reads of the plugin's skills, are the console's. A command that raised a decision returns `waiting`, and the command exits with `3`, as `ask` does.
3. **Inbound requests by capability.** A plugin with `endpoints` declares named endpoints under `/api/v1/plugins/<key>/x/`, each a person's (session or token, with roles) or a webhook's (no person; the plugin verifies the signature with a secret the console holds, under a rate limit). No streaming, no other routes.
4. **A plugin reaches an agent with the rules.** The console appends to the rules it prints with a task, and to `console rules`, a section with one line per plugin bound to the project that the caller holds a role in: the plugin's note for agents and `console plugin <key>`. `console help` gains one line, pointing at `console plugins`. A plugin's skills are a pack in its package, read by `console plugin <key> skills` and `skill`; the skill that works the board says to read a plugin's overview and its skill before its first command.
5. **Every command is on the record** as `plugin.command`, linked to the caller's open run in the board project where there is one.

## Consequences

- An agent that never meets a plugin pays one line of help; one that does pays one line per plugin until it asks for more.
- Refusals are the host's (`plugin.not_found`, `plugin.disabled`, `plugin.unavailable`, `plugin.forbidden`, `plugin.invalid_args`, `plugin.timeout`, `plugin.too_many`, and their kin in the specification) or the plugin's own, `plugin.<key>.<code>`.
- The generic routes are in the package's schemas and the REST snapshot ([ADR-0043](0043-the-rest-contract-is-held-to-a-snapshot-taken-at-the-floors.md)); what a plugin's command carries is the plugin's.
- Rejected: a top-level `console <key>` (a collision with the console's own words waiting to happen); plugin-specific code in the command (a release per plugin); arbitrary server routes (what the pages could do that an agent could not); every plugin's commands in `console help` (context spent on what is not used).
