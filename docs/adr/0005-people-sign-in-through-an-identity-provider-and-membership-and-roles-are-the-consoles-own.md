# ADR-0005: People sign in through an identity provider; membership and roles are the console's own

- Status: Accepted
- Date: 2026-10-09

## Context

The console keeps no passwords. People sign in through an account they already have: GitHub first, since that is where the organization's repositories and the agents' pull requests are. The organizations that will run the console have their people in Google Workspace and elsewhere, and will want to sign in through that. What a person may do, and what the agent working for them may do, is the console's concern and not the provider's.

## Decision

1. **Signing in is a port,** `IdentityProvider` (today `GitHostLogin` in `apps/console/src/ports/`): where to send a browser, how to turn what it comes back with into a credential, and who that credential belongs to. The console uses the credential once, to ask who the person is, and keeps nothing of it.
2. **A person is known by the provider and the provider's immutable id of the account,** never by a name or an email that can change hands. The data model already keys people this way (`host`, `host_account_id`).
3. **GitHub is the first provider; Google Workspace is the next,** as an adapter of the same port, configured by the operator. A deployment may offer more than one; an account at a second provider is a second person unless the operator links them, which is an open question.
4. **Membership and roles are decided here, not at the provider.** The first version lists members by login (`MEMBERS`); a provider adapter may offer its own answer (the Workspace domain, the git-host organization) as a source the operator chooses. Roles, at least an administrator who configures and a member who works, are the console's, kept in the database, and apply to a person's agents as they apply to the person.

## Consequences

- A second provider is an adapter and a configuration, not a change to the board; its people, sessions and tokens are the same tables.
- Who may do what is answered on every request from the console's own records, so a deployment can be run for an organization whose people come from more than one provider.
- The UI offers to sign in with whichever providers the deployment has, which the `me` answer names.
- Rejected: taking membership and roles from the provider alone (a provider's groups do not say what an agent may do on this board, and a deployment may span providers); a password of the console's own (one more secret to keep, and nothing the providers do not do better).
