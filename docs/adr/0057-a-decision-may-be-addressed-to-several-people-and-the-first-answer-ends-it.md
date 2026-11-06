# ADR-0057: A decision may be addressed to several people, and the first answer ends it

- Status: Accepted
- Date: 2026-11-06
- Amends point 1 of [ADR-0042](0042-a-decision-is-addressed-to-a-person-its-raiser-unless-another-is-named.md), which stands otherwise. The contract is in [specs/rest.md](../specs/rest.md), [specs/cli.md](../specs/cli.md) and [specs/plugins.md](../specs/plugins.md).

## Context

A decision is addressed to one person (ADR-0042), who finds it among their decisions and in `console work`; anyone of the project may still answer, but nobody else is told. The first plugins met the approval that is "any of the team's approvers": a leave request goes to whichever of them is in, and when the one named is away, another must find the decision on the board by chance. The plugin chose one and the rest did not know. ADR-0042 rejected a decision addressed to several people for bringing back the question of whose it is; the question has an answer now: it is each of theirs until one answers, and then it is answered, as any decision is.

## Decision

1. **A decision may be addressed to several people.** `POST .../decisions` takes `deciderIds` beside `deciderId`, `console ask` takes `--to` more than once, the pages take several people in the field that took one, and a plugin's `ctx.console.decisions.ask` takes `deciderIds`: up to `MAX_DECIDERS` people, each once in the order named, each able to work in the project as a worker of a task must (`decision.invalid_decider` otherwise). One person named is the decision of ADR-0042; nobody named is the raiser's, as before.
2. **Each of them finds it as their own.** The decision is among the decisions of every person it is addressed to, in My decisions, in `console work` and in the count the pages say beside My decisions; it is among those the raiser asked of others where the raiser is not among them.
3. **The first answer ends it.** Any of them may answer, and so may anyone of the project, as before; a decision is answered once, and the answer names who gave it. The console knows no "all must answer": an approval that needs everyone is a decision per person, raised one after the other by whoever needs it, a plugin for one.
4. **The record says everyone.** A decision carries `deciders`, the people it is addressed to in the order named, and `decider`, the first of them, for the readers of before; the pages show each, the command prints their logins, and `decision.answered` is the event it was.

## Consequences

- An approval that is any of several people's reaches them all, and the one who is in answers; a plugin names the team's approvers and keeps no line of its own for who is away.
- `decider` and `deciderId` stay what they were, so a command or a console of before reads a decision addressed to several as addressed to the first.
- Rejected: a decision answered only when everyone has (a different thing, a vote, which the raiser builds from decisions as they need); a decision addressed to a role or a project's owners (whose it is would again be nobody's, as ADR-0042 found); and a decider changed after the fact, as before.
