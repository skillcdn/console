# ADR-0046: The claim of a pack token is a request of its own, and reading how the connection stands changes nothing

- Status: Accepted
- Date: 2026-10-30
- Refines point 1 of [ADR-0036](0036-a-private-pack-is-connected-with-a-code-a-person-approves-from-the-projects-settings.md), which stands otherwise; moves the floors as [ADR-0038](0038-the-command-and-the-console-go-together-within-a-line-and-a-release-that-changes-what-passes-between-them-raises-the-floors.md) has it.

## Context

A pack connected with a code (ADR-0036) was claimed at the deployment by the read of how the connection stood: `GET .../pack-token/connect` asked the deployment, kept the token when the person had approved, and ended the request. The session cookie is `SameSite=Lax`, which a browser sends on a top-level navigation from anywhere; a link to that address, followed by an owner from a chat or a page elsewhere, claimed the token outside the console's own pages, with nobody's origin checked. What such a link could do was little, the completion of a connection the owner had begun, but a read that changes something is a door left ajar, and the same route was the command's.

## Decision

1. **The claim is a request of its own**: `POST .../pack-token/connect/claim`, for a project's token and for the workspace's, from the console's own pages, with the origin checked as every change is, or with a token. It asks the deployment, keeps the token once the person approved, and answers how the connection stands.
2. **Reading how the connection stands changes nothing**: `GET .../pack-token/connect` answers that nothing is asked, that the request stands, with what the person was shown, or that its time ran out, and asks the deployment nothing. A request whose time ran out stays until the claim, a new request or the owner's giving up takes it away; there is one per project.
3. **The pages read once and claim at the interval**: the settings page reads how a request stands when it opens, and asks the claim at the interval the deployment named while it waits. The command does the same with `console project pack-token --connect` and `console workspace pack-token --connect`.
4. **The floors move to 0.4.1 on both sides.** The command asks a route an older console has not got, and an older command's `--connect` would wait on a read that claims nothing; each side refuses the other below 0.4.1, as ADR-0038 has it.

## Consequences

- A link to the connection's address does nothing but show how it stands; the claim happens where the page or the command asks for it.
- Every agent's command updates with the console that carries this: one update, named by the console's refusal, as the floors cost.
- Rejected: claiming on a `GET` made with a token and reading on one made with a cookie (one route with two meanings, and a `GET` that still changes something); keeping the claim on the read and checking the origin there (a read with an origin requirement is a change by another name); leaving the floors where they were (an older command would wait until the code expired, and say the person had not approved).
