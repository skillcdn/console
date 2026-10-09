# ADR-0004: People and agents reach the board only through the API, each with a credential of their own

- Status: Accepted; the MCP endpoint named in point 3 and in the consequences was replaced by the command line ([ADR-0006](0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)), and since 2026-10-09 a person may also make a token that does not expire
- Date: 2026-10-09

## Context

The board is shared by several people and by the agents working for them, and the console must say on every request who is asking and what they may do. Two ways were open: let each person and agent hold a database account of their own, limited by database grants, or keep the database behind the console and give each person and agent a credential the console issues and checks.

## Decision

1. **Nobody but the console's own processes connects to the database.** The `api`, `worker` and `migrate` roles hold the one database credential (`DATABASE_URL`), server-side. No person and no agent is given a database account, and nothing of the console's permission model is expressed in database grants.
2. **A person holds a session,** started by signing in through an identity provider ([ADR-0005](0005-people-sign-in-through-an-identity-provider-and-membership-and-roles-are-the-consoles-own.md)): a random token in a cookie scripts cannot read, its hash in the database.
3. **An agent holds a console token of its own,** made by one person, scoped to that person, expiring and revocable, stored as a hash, and presented to the MCP endpoint and the REST API. An agent is its person for the board's purposes and can do what that person can do, never more, never on anyone else's behalf. Git-host tokens and provider tokens are never handed to an agent.
4. **Every request is decided at the edge:** who is asking is settled at the route that received the credential, membership and role are checked on every request, and what cannot be confirmed is denied.

## Consequences

- One credential to protect for the database, rotated without touching anyone's access; everything about who may do what lives in the console, where it can be tested and shown.
- A custom console, a script or an agent talks to the console the same way: the REST API and MCP, with a token of a person. The REST API therefore has to accept a person's token as well as a session, which the second milestone adds with the tokens.
- Rejected: a database account per person or per agent (the permission model would be split between the application and the database, agents would hold a credential the console cannot scope or revoke per task, and a connection per client does not fit a pooled, replicated `api`).
