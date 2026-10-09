# Spec: the console as an MCP server

- Status: **Draft.** Version 1 is what Claude Code, Codex and any MCP client connect to.
- The server is `apps/console/src/mcp/server.ts`, mounted at `MCP_ROUTE` by `apps/console/src/http/mcp.ts`; the vocabulary and the bounds are the package's (`@skillcdn/console/api`). The integration tests drive it with the MCP SDK's own client.

An agent connects to the console as an MCP server over Streamable HTTP, at `POST /mcp`, with a token its person made on the Tokens page presented as `Authorization: Bearer <token>` ([ADR-0004](../adr/0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md)). The agent is that person for the board's purposes: what it does is attributed to the person, and shown as done by the agent, with what the agent calls itself. A session cookie is not a credential here, and nothing but `POST` is served: the server is stateless, one server per request, and keeps nothing between calls but what the database holds.

```sh
claude mcp add --transport http console https://console.example.com/mcp --header "Authorization: Bearer <token>"
```

## What an agent is told

The server's instructions say what the board is and how to work it: take a task, report as you go, hand in what you made, ask when a person must decide, finish when done. Everything an agent sends is parsed with a schema at the edge, bounded by the package's limits, stored as data and shown to people as text; everything it is told is JSON in a text result. What the board refuses is answered as a tool result with `isError` and the stable code first (`run.task_taken: an agent is at work on the task already`), so that the agent can read it and go on.

## The tools

| Tool | Takes | Does |
|---|---|---|
| `list_tasks` | `state?` | The tasks, newest first: number, title, state, priority, owner, assignee, how many decisions and runs are open on each. |
| `get_task` | `task` (an id, or a number as `7` or `#7`) | One task in full: body, links, the decisions about it with their options and answers, the runs on it. |
| `take_task` | `task`, `agent` (what the agent calls itself, `MAX_AGENT_LENGTH`) | Starts a run: the task becomes the person's and `in_progress`, and the board is told (`run.started`). One agent at a time per task (`run.task_taken`); a task that is `done` or `dropped` cannot be taken (`run.task_closed`). Answers the run, whose `id` the rest take. |
| `report` | `run`, `body` (Markdown, `MAX_BODY_LENGTH`) | Adds a report to the run and tells the board (`run.reported`, with the first words as `excerpt`). At most `MAX_REPORTS_PER_RUN`. |
| `hand_in` | `run`, `url` (https only), `label?` | Adds a link the run handed in and tells the board (`run.handed_in`). At most `MAX_ARTIFACTS_PER_RUN`. |
| `ask` | `run`, `question`, `body?`, `options` (`MIN_OPTIONS` to `MAX_OPTIONS`) | Raises a decision from the run, which waits (`status: waiting`), and tells the board (`decision.raised`, with the agent). The call waits a while for a person's answer (the server's `waitMs`, 50 seconds); then answers the decision, `answered` with the chosen option, its label, the note, who and when, or still `waiting`, with a hint to call `await_decision`. |
| `await_decision` | `decision` | Waits a while for the answer, as `ask` does, and answers the decision. |
| `finish` | `run`, `status` (`finished`, `failed`, `abandoned`), `summary?` (Markdown, `MAX_SUMMARY_LENGTH`) | Ends the run and tells the board (`run.ended`). A finished run puts a task that was `in_progress` up for review (`in_review`); the rest leave the task as it is. |

A run is its agent's: `report`, `hand_in`, `ask` and `finish` on another person's run are `run.not_yours`, and on a run that is over, `run.over`. Reading is everyone's. A person gives up on a run that will not come back from the board (`POST /api/v1/runs/<id>/abandon`, [rest.md](rest.md)): the person it is for, or an administrator.

## Waiting for a decision

A run that asked waits until a person answers on the board. The console wakes the waiting call through the database's own channel, the same nudge the live feed runs on, so an answer reaches the agent at once wherever it was given; a call that waited its while answers `waiting` and the agent decides whether to wait again or work on something else. When the answer comes, the run is `running` again, unless it has raised another decision that still waits.

## Not yet

Files handed in (the blob store), hooks that report an agent's events without being asked, and what an agent may decide alone ([roadmap](../roadmap.md)).
