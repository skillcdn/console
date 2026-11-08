# ADR-0069: The directory keeps a work email, read by an administrator, the person and a plugin allowed to

- Status: Accepted
- Date: 2026-11-08
- Extends [ADR-0022](0022-who-is-in-is-the-consoles-own-record-and-an-administrator-keeps-it.md), under which who is in is the console's own record, kept by an administrator, and [ADR-0050](0050-plugin-code-runs-in-a-host-process-of-its-own-and-reaches-the-console-only-through-the-capabilities-it-declared.md), under which a plugin reaches the console through capabilities alone. The contract is in [specs/rest.md](../specs/rest.md) and [specs/plugins.md](../specs/plugins.md).

## Context

A plugin that carries the console's messages to a messenger must know which account there is whose. Its design matches people by email and never guesses by name, and the directory had no email: a person is known by their provider's account id, called by their login, which is an address at Google and a handle at a git host, where the account has several addresses and the sign-in asks for none. A plugin could read a login and nothing else.

Three things weighed. An address is personal: a feed everyone reads, a task's owner, a comment's author must not carry it. Only an address somebody vouched for is good for matching: Google verifies the one it signs a person in with; anything a person types for themselves is theirs to mistype or to point elsewhere. And a plugin should ask for it in a sentence an administrator consents to, as it asks for everything.

## Decision

1. **The directory keeps one work email per person,** lowercase, unique in the workspace, or none until known.
2. **Google's at sign-in, an administrator's word otherwise.** A person who signs in at Google has the verified address from the sign-in, written again at each. For everyone else an administrator writes it, on the People page or with `console person email`. A person does not write their own.
3. **Who reads it:** an administrator, the person themselves, and a plugin with the capability `people:read:email`, which an administrator consents to in the words "the work email of the people it may read, to match them to accounts elsewhere". Everyone and everything else reads a person without it: a task's owner, a comment's author, a decision's decider, a member, a run's person carry none.
4. **The feed says that it changed, never what it is:** `person.email_changed` carries the login and whether an address is set now, so that a plugin reading the directory matches the person again, and nobody learns the address from the feed.

## Consequences

- A plugin that carries messages matches people to accounts by an address somebody vouched for, and lists those it could not match for an administrator to write theirs.
- An administrator writing an address is the one step a git-host workspace takes; a Workspace at Google takes none.
- What a plugin learns of a person stays what its capabilities say: a plugin with `people:read` alone reads no address.
- Rejected: a person writing their own address (nothing vouches for it); reading a git host's addresses at sign-in (several per account, none clearly the work one, and a scope the sign-in does not ask); the address in the event (the feed is everyone's).
