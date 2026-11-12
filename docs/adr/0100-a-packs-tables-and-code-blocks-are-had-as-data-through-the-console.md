# ADR-0100: A pack's tables and code blocks are had as data through the console

- Status: Accepted
- Date: 2026-11-12
- Builds on [ADR-0028](0028-the-console-reads-a-projects-pack-through-the-deployments-rest-api-with-a-pack-token-for-a-private-one.md) and [ADR-0031](0031-the-console-reads-a-pack-as-the-skillcdn-command-does-and-a-local-one-from-a-directory.md), and adopts what the main repository decided of a document's tables and code blocks in its 0.5.0.

## Context

From its 0.5.0 the main repository answers the tables and the fenced code blocks of a pack's documents as data: two reads beside the five, a REST route and a command each and no tool of the MCP endpoint. A table of several hundred rows that a task needs whole must not pass through a model, which copies it out row by row until the session runs out of output or of time; a program takes it, and the agent's own tools run the program. A document's outline says how many tables and code blocks it has and where they are had: an address of the deployment's own API, or a command for a directory.

The console reads a pack for whoever works a project, with the token the project holds, so that an agent needs the console's token and nothing else ([ADR-0028](0028-the-console-reads-a-projects-pack-through-the-deployments-rest-api-with-a-pack-token-for-a-private-one.md)). The outline's address was the one thing that led round that: whoever holds a console token reads nothing of a private pack at the deployment, and of a public one would read past the console. With the adoption of 0.5 the console took the address out and passed the counts on, so an agent that needed a table whole read it in the document's sections, which is the copying the two reads exist to avoid.

## Decision

1. **The two reads are reads of the pack's port**, beside the five: `rows` and `code`, of a document or of every document under a folder, under a heading when one is named, a page at a time by whole files, as the main repository bounds a page. A pack at a deployment answers them through the published client, with the token the other reads go with; a pack in a directory through the published reader, as a deployment would answer from the same commit.
2. **The console answers them at routes of its own**, `GET .../skills/rows` and `GET .../skills/code` beside the pack's other reads, for whoever may see the project: the console's envelope, with `read` the body the pack answered, as JSON, one page a request. A plugin's pack answers the same two at its own routes. The console keeps nothing of what was read, and logs who read which path, as for every read of a pack.
3. **A document's outline names the console's reads.** Where a document has tables or code blocks, its outline says the console's two routes for that document; the deployment's own address is never passed on.
4. **The command takes them whole.** `console skills --rows [<folder|file>]` joins every page into one CSV; `--code` prints the blocks as written, each under a line that says where it stands and what it says it is written in; `--heading <words>` narrows either; `--out <path>` writes a file and says how much it holds; `--json` gives what the console answered, the pages joined. The outline the command prints names these commands. `console plugin <key> skills` takes the same flags for a plugin's pack.
5. **What a program takes is never a refusal.** A read as data that the pack refused, or that did not reach its end within the pages the command follows, prints nothing, says why on standard error and exits with 1. The other reads of a pack print the refusal and exit with 0: their text is read by an agent, and this one is redirected into a file.

## Consequences

- An agent takes a table of a private pack with the console's token alone. The pack's token stays where it was: sealed at the console, sent to the deployment and nowhere else.
- The console's API grows by two routes for a project and two for a plugin, and by two schemas (`restSkillRowsSchema`, `restSkillCodeSchema`); the client by `skillRows` and `skillCode`. An outline carries `data` again, with the console's addresses in it. Nothing that existed changed shape, and the floors do not move.
- The CSV is made by the command from the JSON, with the function the main repository's own route makes it with (`rowsCsv`), so the console's route has one body to hold to its contract.
- A page is as large as the main repository lets one be: up to 5,000 rows or 500 blocks, a million characters, 200 files. The command follows 64 pages and then fails, asking for a folder or a file under the path, since a CSV half written cannot be continued.
- The overview of `console help` stays within its length: the forms of `skills` stand there without their flags, as those of the other many-formed commands do, and in full in `console help skills`.
- Rejected: passing the deployment's address on with a token to read it (a console token would open a pack past the console, and the pack's own token would leave the server); a `format=csv` on the console's route (a second body for one consumer, the command, which holds the function already); a pattern to keep code blocks by (an agent's own tools filter what the command prints); leaving a plugin's pack without the reads (the command reads both kinds of pack through one function, and a difference there is one more thing to explain).
