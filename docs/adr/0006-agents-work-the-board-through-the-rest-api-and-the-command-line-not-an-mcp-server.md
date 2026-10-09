# ADR-0006: Agents work the board through the REST API and the command line, not through an MCP server

- Status: Accepted
- Date: 2026-10-09

## Context

The second milestone first connected agents to the console as an MCP server: a set of tools over Streamable HTTP, which the agents people run (Claude Code, Codex) speak without anything installed. Building it and trying it showed three costs. A tool's schema sits in the agent's context on every turn, so what the surface costs grows with every feature the console gains, and the console will gain many: files, comments, documents. An MCP server is a second edge beside the REST API, with the same operations described twice and the drift that follows. And it cannot do what the agent's side of the console needs next: hand in a file from the agent's machine, be called from an agent's hooks, and be the thing a person installs once where their agent runs.

## Decision

1. **The REST API is the one surface of the console.** Everything an agent does on the board (take a task, report, hand in, ask, finish) is an endpoint of the REST API, presented with the agent's token, and nothing is reachable any other way. Waiting for a person's decision is a read of the decision that the server holds for a while (`?wait=`), bounded by what proxies allow.
2. **The command line is the agent's side of the console.** `@skillcdn/console` ships a `console` command: a thin client of the REST API with no logic of its own, which an agent learns from its help and from the organization's skills, and which a person signs in once with a token from their Tokens page. It costs an agent nothing until it is used.
3. **The console is not an MCP server.** The endpoint, its tools and the SDK are removed. Should a client without a shell ever need the board, the command can present the same commands over standard input and output; the server does not grow a second edge for it.

## Consequences

- One edge to secure, specify and test; the pages, the command and a custom console are all its clients.
- An agent needs the package installed where it runs, which is where Node.js already is for the agents people use.
- The command repeats a bounded wait for a decision, and exits with a code of its own when the decision still waits, so that an agent can go on with other work.
- Rejected: keeping both surfaces (two descriptions of every operation, and a context cost that grows with the console); generating MCP tools from the command's table (an abstraction with no second use).
