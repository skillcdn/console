# ADR-0047: A connection request is bounded per address, and the oldest not yet approved makes way

- Status: Accepted
- Date: 2026-10-30
- Refines [ADR-0011](0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md), which stands otherwise.

## Context

`POST /api/v1/connect` is nobody's: an agent asks before it has a token (ADR-0011), so the route is bounded by a count alone, a hundred live requests per workspace, each living thirty minutes. One address could fill the hundred in a moment and every agent's `console login` was answered `connect.too_many` for half an hour. The public deployment sits behind a rate limit at its edge, which a console of one's own may not have; the console itself should not be that easy to shut.

## Decision

1. **A request is bounded per address too.** The console writes down the address a request came from, as the trusted proxies resolve it (`TRUSTED_PROXIES`), and holds a bounded number of live requests from one address, ten, beside the workspace's hundred.
2. **At the address's bound the oldest request not yet approved makes way** for the new one, and its claim is `connect.not_found`; a request approved stays, since its command is about to claim it, and an address whose requests are all approved is refused as `connect.too_many`. The expiry stays what it was, thirty minutes, approved or not.
3. **A request whose address the console cannot tell** is bounded by the workspace alone.

## Consequences

- One address fills nobody's room: at most ten of the hundred are one machine's, or one office's behind a shared address, where the eleventh login in half an hour ends the first that nobody approved, which that person runs again.
- A flood from many addresses is still the edge's to stop; the console bounds what one address can do and nothing more.
- Rejected: a shorter expiry for requests not yet approved (a person away from their desk is who the half hour is for); refusing the eleventh instead of ending the first (a machine whose first login was abandoned would be refused until it expired); a bound per person (the request is nobody's until it is approved).
