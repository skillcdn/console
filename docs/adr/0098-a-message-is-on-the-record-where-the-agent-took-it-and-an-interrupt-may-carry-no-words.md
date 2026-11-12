# ADR-0098: A message is on the record where the agent took it, and an interrupt may carry no words

- Status: Accepted
- Date: 2026-11-12
- Amends points 7 and 8 of [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md), whose `interrupt` always carried words, and says when point 1 of [ADR-0086](0086-a-session-leaves-a-transcript-that-is-kept-for-good.md) writes what the agent was sent; both stand otherwise. The contract is in [specs/runner.md](../specs/runner.md).

## Context

A supervisor who says something to an agent in the middle of a turn has said it to a product that reads it later: after the tool call under way where the product takes a message in a turn, after the turn where it takes none. The runner wrote the message on the session's record when it handed it over, so the record showed it between two steps the agent took without having read it, and the page showed it as told. Whoever watched could not tell a message the agent had read from one it would read in ten minutes, and the one way to hurry it was a second message, an `interrupt` with words of its own, which says the thing twice.

A chat with an agent is read otherwise wherever people use one: what is sent while the agent works is shown as waiting, and beside it stands the way to have it read now.

## Decision

1. **What the agent was sent is written on the record when the product takes it.** A driver says `taken` once for every message it was sent, when the product reads it: when the product says the message back, when the turn that carries it starts, when the agent is prompted with it. The runner writes the message's events then. A product that was waiting for a message takes it at once, and the record is written at once, as before. A turn that completes has taken everything the product was sent, whether or not the driver said so.
2. **What was never taken is on the record as that.** A session that ends, or is stopped, with a message the product was handed and did not take writes it with `unread: true`, before the stop that left it unread. A product that did not start or was not signed in took nothing: the message is sent again, and written when it is taken then.
3. **The record says where a turn ends:** a `status` with `turn: "completed"`, written when the driver says the agent is done with what it was sent. Whoever reads a session as it happens knows by it that the agent is at work, and at what, from the events since the last one: a thought, a tool that has not answered, the work between.
4. **An `interrupt` may carry no words.** It then stops the turn under way so that what the agent was sent and has not taken is read now, and sends the product nothing of its own: the runner stops the turn by what the product has for that, hands over at once what it still held, and writes who interrupted on the record, as it writes who stopped a session. With no turn under way it stops nothing and writes nothing. An `interrupt` with words is as it was; a `tell` needs words.
5. **The page shows what waits, and the way to have it read now beside it.** A supervisor's words that the record does not hold yet stand at the conversation's foot as waiting, with when they are read, by why they wait; while a turn is under way the last of them carries the interrupt. The box to speak in has none.

## Consequences

- The record reads in the order the agent read: a message stands where the agent came to it. `delivered`, on the heartbeat, stays what the runner handed over, which is where a runner goes on from.
- A session written by a runner of before holds no `turn: "completed"`: read live, it shows the agent at work after its last turn. The line is unreleased, so no such runner is in use.
- The page reads which signals wait off the last signal the session's events say was taken, since signals are taken in order; where the events it shows hold none, it reads a few steps back for it.
- `console agent interrupt <handle>` takes no words too.
- Rejected: marking a message as read with a second event, which keeps the record in the order of writing and makes every reader put it right; a new kind of signal for "read it now", where an interrupt is already that; the page guessing a turn's end from how long nothing arrived, which claims what the console does not know ([ADR-0020](0020-the-console-does-not-claim-an-agent-is-at-work-a-run-says-when-it-was-last-heard-from-and-a-new-run-takes-over.md)); the text of a message shown as the model writes it, piece by piece, which needs the runner to report parts of a block where it reports whole ones ([ADR-0086](0086-a-session-leaves-a-transcript-that-is-kept-for-good.md), point 1) and is left for when it is asked for.
