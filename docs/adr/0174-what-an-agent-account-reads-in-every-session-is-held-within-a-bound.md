# ADR-0174: What an agent account reads in every session is held within a bound, and what concerns one event is said by that event's wake

- Status: Accepted
- Date: 2026-11-28
- Amends [ADR-0169](0169-a-member-offers-an-agent-account-a-secret-and-the-account-takes-it-or-leaves-it.md), point 7: what an account does with an offered secret is said by the offer's own wake, and neither by a session's first words nor by the desk's `AGENTS.md`.

## Context

Two texts are read in every session of every agent account: the first words its runner begins a session with ([ADR-0158](0158-an-agent-account-holds-to-how-its-manager-set-it-up-tells-its-manager-of-what-tries-to-instruct-it-and-waits-for-a-word-before-it-spends.md)), and the `AGENTS.md` of its desk ([ADR-0122](0122-a-desk-is-given-its-least-and-grown-by-what-its-member-asks.md)). Each decision that touched them added a sentence, and each sentence was right where it stood. Between two releases the third line of the first words went from 1,288 characters to 1,634, and the desk's file grew by a paragraph for a thing most accounts never meet: a secret a member offers.

A sentence there is paid for by every account in every session, whether or not the day brings what it speaks of. An offer already reaches the account as a wake of the console's own, under the session's mark, at the moment it matters.

## Decision

1. **The two texts are held within a bound, by a test.** A session's first words, a reset's line apart, come to 2,000 characters at the most (`FIRST_WORDS_AT_MOST`), and the `AGENTS.md` a desk is set up with to 8,000 for the account its test sets up (`DESK_INSTRUCTIONS_AT_MOST`).
2. **The bound is not raised to fit.** A sentence added takes the room of one taken out, or of words that said the same in more.
3. **A sentence stands there only where every session does otherwise without it.** What concerns one event, an offer, an expiry, a reset, is said by the wake that brings it, in the console's own words under the mark: once, when it happens, to the account it happens to.
4. **An offered secret is the first such.** Its wake says that the offer is the account's to take or to leave and no asking to change how it is set up, and what it takes one for: work it was given, whoever offers it, and never over a secret it keeps unless a supervisor says so. The first words and the desk's file say nothing of an offer. An account's secrets change at the console's asking under the mark already, by the first words as they were.
5. **The third line of the first words is written again within the bound**, with what [ADR-0173](0173-a-supervisors-own-word-hands-their-say-on-and-says-whose-an-account-is.md) adds to it: 1,457 characters, where it was 1,634, and the first words 1,967 in all.

## Consequences

- **An account whose desk was written before reads the same from a wake.** Its desk says its secrets change at a supervisor's asking or the console's; the offer's wake is the console's, and says what the offer is.
- **An account on a runner of before** is told of an offer with the same words: the wake's text is the console's, whatever runner prints it.
- **A decision that wants a sentence in every session finds the bound first**, and says what it takes out or where else it is said.
- **Rejected:**
  - a larger bound, or none: the texts are read by every account in every session, and the next sentence is always worth its own length;
  - the same said in the skill alone: a skill is read when it is asked for, and an offer comes unasked;
  - a bound on every wake too: a wake is read once, by the account it concerns, and is bounded by what a signal carries.
