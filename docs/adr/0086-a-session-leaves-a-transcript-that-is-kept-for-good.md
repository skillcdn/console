# ADR-0086: A session leaves a transcript that is kept for good

- Status: Proposed
- Date: 2026-11-10
- Follows [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md). Closes open question 4 of [architecture.md](../architecture.md), what of a run is kept: for a person's agent, its reports, as before; for an agent account, the whole transcript of every session.

## Context

A person's agent is watched by its person, at their own screen; what the board keeps of it is what it reports. An agent account has nobody at its screen. Its supervisors must be able to see what it is doing now, and whoever audits the organization's work later must be able to read what it did, what it was told, by whom, and what it thought while deciding, long after the machine is gone. The products' own logs stay on the machine, in formats of their own, and are not read by the runner.

## Decision

1. **Every session has a transcript, and the transcript is kept for good.** The runner reports every event of the driver (ADR-0085, point 2), in order, numbered per session: what the agent was sent and by whom, what it said, what it thought where the stream carries thinking, every tool it called and what came back, every permission asked and how it was answered, every status and error. Append-only; no route edits or deletes an event; no retention period deletes a session. It is audit data.
2. **Bounded at the edge, with the large parts in the blob store.** An event's text is kept in the row up to a bound; a longer payload and every binary go to the blob store through the console's existing file path, under the same kinds allowed for pictures and the same size bound, up to a bounded number of attachments per event, at a bounded rate per session; the table is partitioned by month. What arrives is parsed by schema and shown as text, never run and never rendered as HTML ([AGENTS.md](../../AGENTS.md), rule 2).
3. **Pictures travel both ways.** What the agent's tools returned as a picture and what a supervisor sends with a `tell` are attachments: a `tell` takes files as a comment takes them, and the runner hands them to the driver as image blocks, so that a screenshot pasted on the Live page reaches the agent as a person's would.
4. **Secrets are redacted before they leave the machine, and sealed on the console after.** The runner removes the exact values of the secrets it materialized (ADR-0087) from every event before upload. An administrator may seal an event whose payload leaked a secret anyway: its payload is replaced by a tombstone that says who sealed it and when, which is itself an event; nothing else of history changes. A per-session hash chain, and an export of a session to the blob store as JSON lines, are later additions the shape allows.
5. **Supervisors read it, and nobody else.** The transcript of an agent account is read by its supervisors (ADR-0084, point 4), live on the agent's page (`/agents/<handle>`, the Live view, then its Sessions, its Work and its Settings) and by the command, through `GET /api/v1/agents/<handle>/sessions` and `.../sessions/<id>/events?after=`, a page at a time and as a stream. Transcript events are not in the project's feed, as a plugin's own events are not; the feed gets the session's beginning and end and every signal (ADR-0085).

## Consequences

- A supervisor watches an agent as it works, from any browser, and an auditor reads any session as it was, with its thinking where the product exposed it.
- Storage grows with the work and never shrinks; the bounds keep a row small and the blob store takes the rest, and a session is read in pages.
- The one way to remove a secret from history is to seal the event, on the record; the one way to lose a transcript is to lose the database.
- How much thinking the product's streaming protocol carries is the product's; the driver records what it is given and the Live page says when a session carries none.
- Rejected: reports only, which is what a person's agent keeps and leaves an agent account's work unaccountable; a retention period, which would delete audit data; editing or deleting an event, which an audit trail cannot allow; reading the product's own log files from disk, which binds the runner to a format and a path of the product's.
