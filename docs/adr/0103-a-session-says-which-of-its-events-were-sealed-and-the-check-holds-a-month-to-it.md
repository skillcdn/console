# ADR-0103: A session says which of its events were sealed, and the check holds a month to it

- Status: Accepted
- Date: 2026-11-14
- Amends points 2 and 3 of [ADR-0090](0090-a-sessions-events-are-held-by-a-chain-whose-head-stays-with-the-session.md), by which the check took the digest of a sealed event as it was kept and read a session's events up to the number its row names. The chain, the digests, the role and the rest of that decision stand.

## Context

A sealed event holds nothing its digest could be taken of again, so the check let it pass on the digest its row kept. That left one change to a month that the chain did not show: an event emptied and marked as sealed while the month was away. Its digest still linked, the chain still came to the head, and the check ended with nothing to say. The record that an event was sealed was in the month, which is exactly what may have been written while it was away.

The check also read no further than the number of the session's last event. Rows put in after it, in a session that was over, were not looked at, and a page of that session showed them as its own.

Both are changes the consequences of ADR-0090 say the check shows: an event changed, an event put in.

## Decision

1. **A session's row keeps the numbers of its events that were sealed**, in the order they were sealed, written in the transaction that seals the event. The row stays in the database when the month is put away, beside the head of the chain.
2. **The check holds a sealed event to that record.** An event that is sealed and that its session does not name does not hold, and neither does an event the session sealed that holds something again. The digest of a sealed event is still taken as it is kept, as before.
3. **A session that is over has no event past its last.** The check reads once past the number the session's row names, for a session that ended, and a row there does not hold. A session that is open is checked up to that number, as before: its runner may be appending.
4. **The bytes of a sealed event go with the seal.** The long text and the pictures are taken off the month's shelf inside the transaction that seals: where the store refuses, the event stays as it was, unsealed, and the seal is asked again. A seal that stood while its bytes stayed would be a record that says what is not so.

## Consequences

- The check says three things more: `an event is sealed that the session did not seal`, `an event the session sealed holds something`, `an event is numbered past the session's last`, each with the session and the event, as its other lines do.
- The sessions' table has one more column. The migration fills it for the events sealed before, of the months that are with the database when it runs; no version was released between the chain and this, so no month had been put away with a sealed event in it.
- As before, the check is no proof against whoever can write the sessions' rows and the month both.
- A store that cannot remove, a bucket whose keys or role may not delete under the transcript's prefix, refuses every seal of an event with bytes of its own, in words, until they may: removing an object there is what a deployment with agent accounts gives the console beside reading and writing ([The bucket](../../deploy/README.md#the-bucket)).
- Rejected: a count of the sealed events in place of their numbers, which an event restored from a copy and another emptied in its place would satisfy; a second chain over the seals, which would have the check depend on the order two seals of the same moment were written in; keeping the seal and removing the bytes afterwards, with a note of what is still to remove, which is a table more for what a transaction does.
