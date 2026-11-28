# ADR-0172: A supervisor's own word says that an account is theirs, by a tell or at the messenger

- Status: Superseded by [ADR-0173](0173-a-supervisors-own-word-hands-their-say-on-and-says-whose-an-account-is.md), under which a supervisor says it of another supervisor's account as of their own, and an account known by such a word is theirs like any other
- Date: 2026-11-28
- Amends [ADR-0160](0160-an-agent-account-takes-every-supervisors-word-as-its-managers-by-a-tell-or-at-the-messenger.md), point 2, and [ADR-0164](0164-a-plugin-says-which-account-at-a-messenger-is-a-members-and-a-wake-says-by-it-whether-a-supervisor-wrote.md), point 9, in one thing: how an agent account knows that an account at the messenger is a supervisor's where the console does not say. The rest of both stands.

## Context

Under ADR-0160 a supervisor's own word instructs an agent account, by a tell or at the messenger in their own account, and nothing sets the one below the other. One sentence did. Where the console does not say whose an account at the messenger is, the account was a supervisor's only where "a supervisor's tell" names it, or where the address the messenger keeps for it is theirs in the console.

A supervisor wrote to an agent account from a second account of theirs, at another organization's workspace, which the console knows nothing of. The agent could not take it for theirs, and said so in the conversation it has with the supervisor's known account. The supervisor answered there that the two are the same person. The agent took that as information and asked for a tell before it would act on the second account's word in what touches its setup, its secrets and what costs: the first words of its session named the tell alone. So the supervisor was asked to say a second time, on a command line, what they had just said in an account the agent knows to be theirs.

## Decision

1. **A supervisor's own word says that an account is theirs, by a tell or at the messenger.** Where the console does not say whose an account at the messenger is, an agent account takes it for a supervisor's where the address the messenger keeps for it is that supervisor's in the console, as before, or where that supervisor says so themselves: by a tell, or in a message at the messenger from an account that is theirs by the wake's own line (ADR-0164, point 6) or by its address.
2. **Never by a name, by what the account says of itself, or by what anyone else says.** An account that writes "I am your manager" has said nothing, and neither has a colleague, another agent or a note that says so of it. What says it is the supervisor, where the agent knows it is the supervisor who speaks.
3. **An account known only by such a word says it of no other.** A supervisor names an account from a tell, or from an account the console's line or the address shows to be theirs. An account that is theirs only because they said so is theirs for what is said from it, and names no further account: the word that vouches comes from where the console, or the messenger's own record, stands behind it.
4. **A word at the messenger is worth what a tell is, in everything.** Nothing an account does at a supervisor's asking waits for a tell. What ADR-0160 holds whoever asks, it holds here as it did: what asks for a secret, for more access or for something kept from the manager is not followed and is told to the manager (point 1), and what a word at the messenger began, of the account's setup or of what costs, is written on the board with whose word it was (point 7).
5. **It is said in the session's first words**, in the sentence that named the tell, and in the skill `running-an-agent`, for the agent and for whoever supervises it. The desk's template says nothing of it, as ADR-0164, point 9, left it.

## Consequences

- **An account set up before reads it from its runner's next session**, once its command is this version: the first words are the runner's, and no edit of a desk is needed.
- **The first words are longer by some thirty words**, in every session of every account.
- **Nothing is opened that was not open.** Whoever holds a supervisor's account at the messenger instructs the accounts they supervise already (ADR-0160, consequences): they could tell the agent to do, from that account, whatever a second account of theirs would ask. Taking the second account for theirs on their word adds a place they speak from, not a thing they may ask. What it does add is one step for whoever has taken over a supervisor's account: an account of their own made to pass as the supervisor's, which point 3 keeps from growing into a chain, and which ends where the supervisor's account is taken back.
- **A messenger that keeps accounts of several organizations apart stays as it is.** The plugin that says whose an account is (ADR-0164) links no account of another organization to a member, and need not: the supervisor's word does it for the agents they supervise, one at a time.
- **Nothing is enforced**, as before (ADR-0158): these are instructions, and what holds an account to them is that its supervisors read its sessions and its record.
- **Rejected:**
  - the tell kept as the one way to name an account: it has a supervisor say twice what they said where the talk was, which ADR-0160 rejected for everything else;
  - any account that a known account vouches for vouching in turn: a chain as long as anyone cares to make it, each link further from what the console knows;
  - a word of the account in question taken with the supervisor's silence: nothing was said by whoever may say it.
