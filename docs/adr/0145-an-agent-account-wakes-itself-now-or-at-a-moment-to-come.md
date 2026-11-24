# ADR-0145: An agent account wakes itself, now or at a moment to come

- Status: Accepted; point 2, a wake and nothing else, is amended by [ADR-0154](0154-an-agent-account-begins-a-new-conversation-for-itself-when-its-turn-is-over.md): an account begins a new conversation for itself too, when its turn is over
- Date: 2026-11-20
- Amends [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md), point 6, by which a wake is a supervisor's, the board's, the schedule's or a wake source's.

## Context

Three things had no way to reach an agent account that was resting:

- **Whoever prepared its machine.** The session that set a machine up is signed in as the account. When it had installed what the agent asked its manager for, it could not say so: `console agent wake <handle>` is a supervisor's, and was refused. A person answered a decision on the board to wake the agent.
- **A person at the machine**, who signed something in there for the agent.
- **The agent itself.** An agent that waits for a deploy, a reply or a long job has nothing to come back by but the next day's briefing.

The account's runner already raises wakes in the account's name, from a wake source, under an hour's bound. What was closed was the command.

## Decision

1. **An account raises a wake for itself**, signed in as itself, on its command or in its browser, from the console's own pages there, and never with a token it made: `POST /api/v1/agents/me/wakes`, `console agent wake me ["<words>"]`. It is a signal of the account's record, of the kind `wake`, sent by the account, with its words as it said them. The record says who sent every signal, so one an account sent itself reads as that.
2. **A wake and nothing else.** A `tell`, an `interrupt`, a `stop`, a `restart`, a `reset` and a `set` stay a supervisor's: an account gives itself no instruction in anyone's name and changes nothing of how it stands.
3. **So many an hour.** An account raises thirty wakes for itself within an hour, counted apart from those its runner raises from a wake source; one more is refused (`signal.too_many`), with when the hour has room. The bound is one, however a wake is raised: one kept for later counts when it is raised, and one that is due while the hour is full stays kept and is raised when the hour has room.
4. **Or kept for a moment to come.** With a moment, within thirty-one days, the wake is kept and no signal yet. One stands under a name at a time, `wake` where none is said, and a second under the name takes the first one's place; an account keeps twenty. The account reads what it keeps and takes one away; its supervisors read it beside its record. The worker raises each when its moment has come, once, as the account's own signal.
5. **On the command, a moment is said two ways**: `--in <minutes>`, or `--at <HH:MM>`, the next time the workspace's clock says so.
6. **Nothing on the board wakes its own author.** A task an account writes for itself and a comment it writes wake nobody, as before: the board's work is no way to wake oneself.

## Consequences

- **A setup ends by saying how to tell the agent what changed** ([ADR-0140](0140-a-machine-is-given-its-least-and-the-agent-does-the-rest-itself.md)), and the desk's template says how the agent comes back to something.
- **A wake raised from inside a turn is the next message of that turn's session**: harmless, bounded by the hour, and of use to nobody. The template names the one with a moment.
- **An agent can keep itself awake at a cost**, thirty turns an hour at most, whether it raises them at once or keeps them for a moment from now. Its manager sees each on its record, by its own name.
- **A wake kept by an account that is deactivated stays** until the account is back in, and goes with the account where it is removed.
- **Raised once.** A wake kept is taken in the transaction that writes its signal: a worker that ends in between has done neither, and the next pass raises it. One the account took away, or kept anew for another moment, in the meantime is not raised for the moment it had.
- **An own wake is tried at once where the agent could not go on**, as a supervisor's signal is and a wake of the board's is not: whoever mended a sign-in on the machine says so with it.
- **A new table, `agent_wakes`**, and no change to a signal: an account's own wake is told from a supervisor's by who sent it.
