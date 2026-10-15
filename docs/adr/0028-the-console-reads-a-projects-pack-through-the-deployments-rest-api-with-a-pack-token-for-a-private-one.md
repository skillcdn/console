# ADR-0028: The console reads a project's pack through the deployment's REST API, with a pack token a person made for a private one

- Status: Accepted
- Date: 2026-10-14
- Builds on [ADR-0006](0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md), [ADR-0015](0015-the-consoles-skills-live-in-this-repository-in-the-skillcdn-format-and-the-package-carries-them.md) and [ADR-0021](0021-a-token-configures-as-its-person-does.md). The contract is in [specs/rest.md](../specs/rest.md#get-apiv1projectskeyskills) and [specs/cli.md](../specs/cli.md).

## Context

A project names the pack its agents work with, the repository SkillCDN serves at an address, and the console showed its skills by that address: the list, each with where a person reads it and the URI an agent loads it by through a connection of its own to the deployment. The content reached an agent only through that connection: a person had to connect each agent to the address as well as to the console, and a private pack asked the agent to sign in at the deployment as the person.

The main repository's deployment now takes, over its REST API, the tokens its MCP endpoint takes (its ADR-0052): a repository token a person makes on their account page for one repository, which reads as its maker, and an app's access token for one address. A program with such a token reads a private pack the same way a signed-in person does. The console is such a program.

## Decision

1. **The console reads the pack for the project, through the deployment's REST API.** `console skills` lists the skills, `console skill <path>` reads one whole as `load_skill` lays it out (the rules from the repository's root to the nearest manifest, the body, the included files, page after page until complete), and `console skill <path> --file <path>` reads a file of the pack. Each is one route of the console's API, which asks the deployment and answers what it said, in the console's own shape; the console keeps nothing of what it read.
2. **A private pack is read with a pack token the project holds.** An owner sets it: a token a person made at the deployment for the pack's repository, pasted on the project's Settings page or read from standard input by `console project pack-token <key> --stdin`, never from an argument. The console checks it against the deployment once, keeps it sealed with the deployment's secret (the same sealing as what travels through a browser at sign-in), sends it as the bearer of its reads of that pack, and shows it to nobody: the project says only when it was set. An owner removes it; the deployment's refusal of it is the status `token_invalid`, which the pages and the command say in words. Without one, a public pack is read as before and a private one is not found, as the deployment answers anyone.
3. **What a token reads is the project's, and is held for no one.** A public listing is held for a minute, as before; a listing or a skill read with a token is read again on every request, so that nothing of a private pack outlives the request it was read for and the deployment's own permission check, which asks the git host as the token's maker, decides every time.
4. **A read is logged, never its content.** Who read which skill or file of which pack, through which project, goes to the structured log; it is no event of the board, which would otherwise fill with every page an agent turns.
5. **One pack per project.** The project's address, or the organization's; the token belongs to the project. Several packs in one project are not planned.
6. **An agent's own connection still works.** The page and the command keep naming the URI of each skill, for a host that lists skills, and the address's page for a person to connect an agent there. The console's reading is the way that needs nothing but the console's own token.

## Consequences

- An agent with the console's command and nothing else reads the project's pack, public or private, as the task names it; the person sets one token per private pack, once, instead of connecting each agent.
- The console holds a credential of the deployment, sealed, where it held none: a deployment without `AUTH_SECRET` cannot keep one, and the Settings page says so; the token reads as its maker and stops reading when the git host stops vouching for them, which the status says.
- The deployment's words for a model, its connection instructions and its prompt, are not in its REST API; the command's own words tell the agent what the rules, the body and the included files are, in the layout `load_skill` uses, and that paths from the repository's root are the only identifiers.
- A file the deployment will not carry, too large or not text, is said to be unreadable here, with the page of the pack where it is read at its host.
- Rejected: the console speaking MCP to the deployment (a second client of a protocol made for models, when the REST API now serves the same with a token); handing the agent a credential of the deployment (an agent holds the console's token and nothing else, [ADR-0004](0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md)); a token per person on the console (a person who made one at the deployment can connect their agent there directly, and the project is what the board shares); events for every read (above); several packs per project (above).
