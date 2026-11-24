---
"@skillcdn/console": patch
---

An agent account begins a new conversation for itself (ADR-0154): `console agent reset me "<why>"`, on the account's own command, where its work has a break. It is a `reset` on the account's record, sent by the account, with why. Its runner takes it when the turn it was sent in is over, never in the middle of one: the session ends, and the next begins at once with a new conversation and those words. A supervisor's stop that stands refuses it (`agent.stopped`), and an account begins six within an hour (`MAX_OWN_RESETS_PER_HOUR`). A console before this version has no such route, and the command says so.

The first message of a conversation begun by a reset, a supervisor's or the account's own, says who began it, under which header why is said, and what to read first: the board, the desk from its `AGENTS.md` on, and the memory the product keeps.

For whoever builds on the package: the client has `sendOwnReset` (`POST /api/v1/agents/me/reset`, `restOwnResetInputSchema`); `createRunner` takes `account`, the id of the account the runner is, by which it knows a reset as the account's own, and a runner told none takes every reset as a supervisor's, at once; `introOf` takes `own` and `number` beside `by`. On the agent's page, `waitingOf` holds the words of a reset that waits, and `TalkWaiting` names what waits by its kind where it is more than a tell, and takes `why="anew"` for the account's own reset. The desk's template says in one sentence when an agent begins anew; a desk that is there keeps its `AGENTS.md`, and its agent writes the sentence in itself.
