# ADR-0090: A session's events are held by a chain whose head stays with the session

- Status: Accepted
- Date: 2026-11-11
- Follows [ADR-0086](0086-a-session-leaves-a-transcript-that-is-kept-for-good.md), which laid the transcript out by month for whoever keeps the database and named this as the addition its shape allows. The procedure is in [deploy/README.md](../../deploy/README.md).

## Context

The transcript is audit data, and what becomes of a month that is past is its operator's to do: detached, dumped, moved to other storage, and attached again when someone has to read it. While a month is away it is a file among files, outside the database and outside the console, and nothing said, when it came back, whether it was the month that left. A row changed there, an event taken out, one put in, read as any other.

The sessions do not go away with their month. A session's row stays in the database it was written in, and says what the session held: that is where something small can be kept by which the rest is checked.

## Decision

1. **Every event has a digest, and a session keeps the head of the chain its digests fold to.** The digest is a SHA-256 of what the event's row holds: the session and the event's number in it, its kind, when it happened, its text, its facts in the order of their names, and its pictures by their ids, names, sizes, kinds and hashes. A long text is in it by the beginning the row keeps and by the hash and the size of the whole; the bytes of a long text and of a picture are not read, since they are named by their hashes and the names are hashed. When the console received the event is not in it. The chain begins at the session's own id, and each event folds it on: the SHA-256 of the chain before it and the event's digest. The head after its last event is in the session's row, written in the transaction that appends the events.
2. **A sealed event keeps its digest.** Sealing replaces what an event held ([ADR-0086](0086-a-session-leaves-a-transcript-that-is-kept-for-good.md), point 5), and the digest of what it held stays: the chain holds over it, and the check takes the digest of a sealed event as it is kept, since nothing is left to take another of.
3. **The check is a role of the image, `verify`.** `console verify [<month>...]` reads the sessions of the months named, or of every month whose events are there: each event that is not sealed against its digest, and the digests, in order from the first and without a gap, against the head the session keeps. It writes one line for every session that does not hold, with the event where it stops and why, and a last line, `transcript verified`, with what was checked; it ends with 1 where a session does not hold or a month asked for is away, and changes nothing. It is run by hand, by whoever brought a month back or wants to know that the transcript is what it was, as `migrate` is run before a rollout.
4. **What is hashed has a version.** The form of a digest is numbered and in every digest; a change to what is hashed is a new form, and an event is checked by the form it was written in.
5. **A session begun before the chain has none.** Its row's head is empty, it gets none halfway, and the check counts it apart.

## Consequences

- A month that was put away is checked when it is back, against something that never left: an event changed, taken out, put in or moved shows as the session it is in and the event it shows at.
- The chain says that the transcript is what the console received. It does not say that what the runner reported was true ([ADR-0086](0086-a-session-leaves-a-transcript-that-is-kept-for-good.md), point 7), and it is no proof against whoever can write the sessions' rows and the month both: the head is kept beside the board's data, under the same care.
- Sealing changes no digest, so the record that an event was sealed, and by whom, stays the only trace of what was removed, as before.
- The bytes of a long text and of a picture are held by their names alone. A check that reads every object of a month against its hash is a later addition; the bucket's own tools do it today.
- An append costs a hash an event. The session's row is written with every batch as it was before, with one more column.
- The image has a fourth role. It needs the database and nothing else of the configuration, and a deployment that never puts a month away never runs it.
- Rejected: the chain kept in the events alone, each naming the one before, which a month rewritten whole would still satisfy; a function of the database for the check, which would have what is hashed written twice, in two languages, and held equal; a signature by a key of the console's, which says no more than the head does to whoever holds the database, and adds a key to keep; the check as a route for a supervisor, before anybody asked to see it on a page.
