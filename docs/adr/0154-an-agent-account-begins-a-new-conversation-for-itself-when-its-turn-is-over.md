# ADR-0154: An agent account begins a new conversation for itself, when its turn is over

- Status: Accepted
- Date: 2026-11-24
- Amends [ADR-0145](0145-an-agent-account-wakes-itself-now-or-at-a-moment-to-come.md), point 2, by which an account sends itself a wake and nothing else, and [ADR-0085](0085-a-runner-on-the-agents-machine-is-told-by-signals-and-runs-one-session-at-a-time.md), points 4 and 5, by which a new conversation begins at a supervisor's word, with a briefing or under another driver.

## Context

An agent account carries its work on in one conversation (ADR-0085, points 3 and 4), and what grows long its product compacts. That holds for days. There are still moments where a clean beginning serves better than a summary of everything before: a large task handed in, a conversation full of what the next task has no use for, a manager who says so.

The agent could not have that moment. A `reset` is a supervisor's, and it ends the session at once, whatever the agent is at: it is made for an agent that cannot go on. `conversation` in `runner.json` begins anew by the clock, never by the work. So an agent that knew its work had a break asked a person to press a button.

What must outlast a conversation is on the board and in the desk already, and a product keeps a memory of its own. The agent is the one who knows when those hold what the next conversation needs.

## Decision

1. **An account begins a new conversation for itself**, signed in as itself, on its command or in its browser from the console's own pages, and never with a token it made: `POST /api/v1/agents/me/reset`, `console agent reset me "<why>"`. It is a signal of the account's record, of the kind `reset`, sent by the account. No kind and no field is added: the account's own is told from a supervisor's by who sent it, as its own wake is (ADR-0145).
2. **It says why.** The words are needed: they are what its manager reads on the record and on its page, and the first thing the new conversation reads, a note from the conversation that ends to the one that begins.
3. **The runner takes it when the turn it was sent in is over, and never cuts one.** A runner is told which account it is, and holds a reset that account sent until no turn is under way, however the turn ends, and takes it at once where none is. Then the session ends as `reset`, and the next begins at once, with a new conversation and the account's words. A supervisor's `reset` ends the session at once, as before.
4. **It changes nothing of how the agent stands.** While a supervisor's stop stands, the console refuses it (`agent.stopped`), and it takes no stop away; a stop that arrives before the turn is over lets it go. Whoever starts the agent again says with which conversation.
5. **Six within an hour**; one more is `signal.too_many`, with when the hour has room. A new conversation reads its board, its desk and its memory before it does anything, so a loop of them costs more than a loop of wakes.
6. **The first message of a conversation begun by a reset says who began it, under which header why is said, and what to read first**: the board (`console work`), the desk from its `AGENTS.md` on, and the memory the product keeps. A supervisor's reset reads the same, by their name.
7. **The desk's template says so in one sentence**, since no session does this untold ([ADR-0146](0146-the-desks-template-spends-no-sentence-on-what-an-agent-does-by-itself.md), point 3): where a large piece of work is done or the conversation has grown long, the agent puts what must go on where the next conversation finds it, and begins a new one.
8. **The agent's page shows it as it shows what a supervisor sends.** While it waits for the turn, the account's words stand at the foot of the conversation, named a reset beside who sent it, with when the new conversation begins and the way to have it begin now, an interrupt. Once taken they open the new session's record, as a supervisor's reset with words does, which waits at the foot the same way where its runner is not heard from. A supervisor's own reset stays the button under the page's controls.

## Consequences

- **An agent decides when a conversation has served.** Its manager reads each on the record, under the account's name, with why.
- **Nothing of the conversation before crosses but the words.** What the agent did not write down first is gone, as after a supervisor's reset. The command's answer says so, and the template says to keep first.
- **A reset that waits is not delivered.** A runner that ends meanwhile, for an update or with its machine, is sent it again and takes it when it starts, where no turn is under way.
- **A second sent while one waits stands for the first**, which is let go.
- **A supervisor's `restart` or `reset` that arrives while the account's own waits ends the session at once, and the account's own is taken right after**: the conversation is new, the account's words are read in it, and where a supervisor reset it the first message says so.
- **A runner that does not know which account it is takes every reset as a supervisor's**: at once, in the middle of the turn that sent it. The command that sends one and the runner that takes it are one package on the agent's machine, and a runner takes an update of it by itself ([ADR-0101](0101-a-runner-ends-for-an-update-of-its-command-and-its-service-starts-it-again.md)), so the two are apart for a moment at most.
- **Still a supervisor's**: a `tell`, an `interrupt`, a `stop`, a `restart`, a `set`, and a reset that does not wait, for an agent that cannot go on.
- Rejected: a kind of signal of its own, which a command of before refuses whole ([ADR-0043](0043-the-rest-contract-is-held-to-a-snapshot-taken-at-the-floors.md)) for what the sender already says; a reset taken in the middle of the turn that asks for it, which ends the product before the agent read the command's answer and loses what it was about to write down; an own reset with no words, which leaves the record and the new conversation nothing to read; a supervisor's reset made to wait for the turn, which is no way out of a turn that hangs; a choice for a supervisor between the two, which nobody asked for: a supervisor who wants the break at the turn's end tells the agent, and the agent begins anew itself.
