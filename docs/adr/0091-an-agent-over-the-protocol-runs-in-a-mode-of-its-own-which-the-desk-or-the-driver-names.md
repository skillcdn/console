# ADR-0091: An agent over the protocol runs in a mode of its own, which the desk or the driver names

- Status: Accepted
- Date: 2026-11-12
- Amends the sentence of point 12 of [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md) on a product that asks leave of whoever drives it; the rest of that point stands, and so does the driver's interface. The spec is [specs/runner.md](../specs/runner.md#the-acp-driver).

## Context

Nobody is at an agent account's terminal. The `claude` driver and the `codex` driver each start their product in the mode it has for such a run: one in which the product works without asking, and a review of its own holds back what looks unsafe. ADR-0085 has every driver do so: the product's own default where that default is such a mode, and the mode the driver names where it is not.

The `acp` driver could not. The Agent Client Protocol has an agent ask leave of its client, and has no word for a client that reviews: the driver answered each request with one of its own two words, `allow` or `deny`, and left what the agent does without asking to the agent's configuration. That read as a driver without the mode the other two have.

Run against an agent (2026-11-12), it is not so. The protocol has a session say its modes and set one, as a choice of the category `mode` or by `session/set_mode`, and the modes are the agent's own. The adapter that puts Codex behind the protocol offers four, starts in `agent`, its automatic review, and in that mode asked the driver nothing in the runs seen. The adapter that puts Claude Code behind it, read from its source and not run, calls its own `auto` and starts in it where the model has one. So the mode exists wherever the agent has it; what the protocol lacks is a name for it that is the same for every agent.

What was wrong was the pairing. An agent in such a mode asks leave only for what its review held back, and the driver's `allow` then allowed exactly that.

## Decision

1. **`permissions` in `runner.json` may name one of the agent's own modes.** The session is set to it, and what the agent still asks is refused: the mode is what it may do with nobody there. It is the product's own word, as for the other drivers.
2. **Where the desk names none, an agent the driver was run against is set to the mode it has for a run nobody attends,** and what it still asks is refused. The driver keeps that mode by what the agent calls itself, beside the versions it was tried with, and an agent enters the list only once it was run: `agent` for the adapter that puts Codex behind the protocol.
3. **Any other agent runs in its own mode and is allowed each call once,** as before: the driver cannot tell an agent that asks only for what its review held back from one that asks for everything, and an agent refused everything does no work. Whoever prepares its desk names its mode.
4. **The driver's own two words stay.** `allow` and `deny` say how a request is answered and leave the agent's mode as it is.
5. **A mode named that the agent does not offer is a mistake in the desk's file,** never leave to do more: the transcript says so with the modes the agent offers, the agent runs in its own, and what it asks is refused.

## Consequences

- An agent over the protocol runs as the other two products do, where the driver knows it: in its own reviewing mode, with nothing allowed that the review held back.
- An agent that gains such a mode needs no change here. Its desk names the mode, and the transcript lists the agent's modes to whoever misspells one. The driver's list is where it becomes the default, after a run.
- The protocol may give such a mode a name of its own one day, or have an agent say which of its modes reviews. The driver then reads that in place of its list, and this decision's second point goes.
- A desk cannot name a mode and have the driver allow what the agent still asks. Nobody asked for it, and a mode that asks nothing is the agent's to offer.
- Rejected: a classifier of the runner's own between the agent and its tools, which would be a second review that knows less than the agent's; refusing by default for every agent, which leaves an agent that asks for everything unable to work, with nothing said of why; reading a mode's name or description for the word "auto", which is a guess.
