# ADR-0096: A decision that waits may be addressed anew, by whoever may answer it

- Status: Accepted
- Date: 2026-11-12
- Amends point 1 of [ADR-0042](0042-a-decision-is-addressed-to-a-person-its-raiser-unless-another-is-named.md), whose decider did not change, and takes back what it and [ADR-0057](0057-a-decision-may-be-addressed-to-several-people-and-the-first-answer-ends-it.md) rejected, a decider changed after the fact; both stand otherwise. The contract is in [specs/rest.md](../specs/rest.md) and [specs/cli.md](../specs/cli.md).

## Context

Whom a decision is for was settled when it was raised and never after (ADR-0042). An agent asks the person it works for, since that is whom it knows; the person then finds on their plate a question that is a colleague's to answer, the look of a page say, which the organization's designer decides. They could answer it themselves, tell the colleague beside the console and hope, or have it raised again, which leaves the first one waiting for good: a decision cannot be taken back. ADR-0042 and ADR-0057 rejected a decider changed after the fact as a need nobody had had, and one that would want a reason recorded. The need has come, and the record it wants is the one every change on the board has: an event that says who did it, through which agent, and when.

## Decision

1. **A decision that waits may be addressed anew.** The people named take the place of those it was for: one to `MAX_DECIDERS`, each once in the order named, each able to work in the project as at its raising (`decision.invalid_decider`, `decision.too_many_deciders`). `PUT /api/v1/projects/<key>/decisions/<id>/deciders` takes `deciderIds`; `console decision <id> --to <login|me>`, given once for each, does the same; on the pages a decision that waits has Change who decides, wherever it is answered. To add someone, the ones it is for are named again with them.
2. **By whoever may answer it.** Anyone who may work in the project answers a decision (ADR-0042), and the same people say whom it is for. Handing one on gives nobody anything they did not have: whoever is named could answer it already, and whoever names them could have answered it themselves. No reason is asked for; where one is wanted, it is said in the discussion on the task, as any reason is.
3. **Only while it waits, and nothing else of it changes.** An answered decision is a record and stays as it was addressed (`decision.answered`). Who raised it, what it asks, its options, its files and the run that waits for it are as before; a decision addressed to the same people in the same order writes nothing.
4. **A plugin's decision stays as the plugin addressed it** (`decision.plugin_addressed`). A plugin names who decides by a rule of its own, from the directory and not from the project (ADR-0068), and whoever manages them reaches the decision already; a person who changed that would be changing the plugin's rule.
5. **The board is told.** `decision.addressed` is an event as any: who did it and through which agent, the question, the logins of everyone it is for now (`deciders`) and the ids of those named anew (`decidersAdded`). Those named anew find the decision among their own from then on, as ADR-0057 has it, and those left out no longer do; an agent account named anew is woken as it is when a decision is raised for it.

## Consequences

- A question that reached the wrong person is passed to the right one in one act, by the person, by their agent with the command, or by a colleague who sees it waiting; the first decision is the one that is answered, with its context and its files, and nothing is raised twice.
- The decider is no longer a fact of the raising: `decider` and `deciders` on a decision say whom it is for now, and the feed says who it was passed by and when.
- The policy gains no clause: the condition is the one that answers a decision in its project, and the people named are held to the one that named them at the raising.
- A console and a command of before read a decision addressed anew as any decision; an older command has no `--to` on `decision`, and an older console answers the route as not found.
- Rejected: a reason required with it (a field more on every hand-over, for what the discussion already holds); only the decider, the raiser or an owner allowed to (three clauses where answering has one, and a colleague trusted to answer is trusted to say who should); adding to those it is for as an act of its own (naming them again with the new one says the same); a decision addressed anew once answered (it would rewrite a record); people addressing a plugin's decision anew, and a call for a plugin to do it (no plugin has needed one).
