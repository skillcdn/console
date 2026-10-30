# ADR-0044: A token of a person who is out is kept, and refused with the reason, until they are back in

- Status: Accepted
- Date: 2026-10-30
- Refines point 1 of [ADR-0022](0022-who-is-in-is-the-consoles-own-record-and-an-administrator-keeps-it.md), which stands otherwise.

## Context

A person deactivated is refused on every request at once, and their agents' tokens with them (ADR-0022); a domain or an organization taken out of the configuration takes its people with it the same way. Such a token was answered as nothing (`auth.required`, 401), the same as one revoked or expired: the agent on the person's machine was told to sign in again, which nobody could do for it, and neither it nor its person learned why. Whether the tokens should go with the person was asked, since a token left on the machine of someone who has gone comes back to life with them.

## Decision

1. **The tokens of a person who is out are kept**: neither revoked nor hidden, an administrator seeing and removing them on the person as before. Every request made with one is refused with the reason, on every route, `GET /api/v1/me` included, where nobody is otherwise an answer: `auth.deactivated` (403) for a person deactivated, by an administrator or by the organization that took them out; `auth.not_admitted` (403) for a person whose domain or organization the deployment no longer names. A token the console does not know, revoked or expired, stays nothing (`auth.required`, 401).
2. **When the person is back in**, reactivated, or let in again by the configuration or by a listing they sign in on, the same tokens are theirs again from the next request, with nothing to connect anew.
3. **The command prints the reason and what to do**: the person is taken back in on the People page, or let in again. `console logout` forgets a refused token on the machine and says that the console keeps it; `console help` lists the two refusals among those any command may meet.
4. **A session of a person who is out is as before**: the cookie goes with the answer, and the sign-in page says the account is not a member.
5. **Open runs are as before**: a run of a person who is out ends by the rule that ends every run not heard from (ADR-0041).

## Consequences

- A person who returns finds their agents as they left them. An agent of a person who has gone holds a token that is good for nothing until then, and says so to whoever runs it; an administrator who wants such a token gone removes it on the People page, as before.
- The REST contract gains two error codes and no field: an older command prints them with the console's words and without a hint.
- Rejected: revoking the tokens at deactivation, which would have every agent of a returning person connected again and takes from a person what is theirs to remove on the Agents page; ending the open runs at once, which the twelve-hour rule does without a second rule.
