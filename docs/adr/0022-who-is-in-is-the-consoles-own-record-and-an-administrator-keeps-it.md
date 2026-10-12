# ADR-0022: Who is in is the console's own record, and an administrator keeps it

- Status: Accepted
- Date: 2026-10-12

## Context

Who may sign in was a list in the configuration (`MEMBERS`), beside the Workspace domain: taking someone in or out meant a redeployment, and nobody could do it from the console. A person taken off the list stayed on the pages, since their row stayed, with nothing saying they were out. An organization at a git host already knows who is in it, and the console asked nothing of it ([ADR-0005](0005-people-sign-in-through-an-identity-provider-and-membership-and-roles-are-the-consoles-own.md), decision 4; [architecture.md](../architecture.md), open question 1). And nothing can be deleted: tasks, decisions, documents and events name the people who made them.

## Decision

1. **A person has a status and a source, written on their row.** `active` or `deactivated`; and what let them in at their last sign-in: `organization` (the organization at the git host the deployment names), `domain` (the Workspace domain it names), or `listed` (an administrator's listing). A deactivated person is kept, with everything they did, and refused on every request at once, their agents' tokens with them; they are listed nowhere and offered to no picker.
2. **The configuration names what vouches, never who.** `GITHUB_ORG` names the organization, `GOOGLE_WORKSPACE_DOMAIN` the domain, and `ADMINS` the first administrators, who are let in by that alone and made administrators when they sign in. `MEMBERS` is gone. A domain or an organization taken out of the configuration takes its people with it on the next request.
3. **An administrator lets a login in, and takes a person out, on the People page or with their agent.** A listing is a login at a provider the deployment has; whoever signs in with that account becomes the person, and the listing is bound to that account from then on, so that a renamed account stays in and no other account can take the login. Deactivating a listed person takes their listing away, so that signing in again admits nobody; reactivating lists them again. A listing nobody signed in with is taken away by itself. A login listed, or a person in, cannot be listed again.
4. **The organization decides for its own.** The git host's organization is read through a GitHub App installed on it: at sign-in, and by the worker on a schedule, which deactivates those who left and reactivates those who came back, by the account's id, so that a rename changes nothing. Nothing changes on a failure to read it. A person the organization let in cannot be deactivated or reactivated by an administrator; to keep one who left, an administrator lists their login, and they come in as listed on their next sign-in.
5. **The domain is trusted as before.** A Workspace account is in while its domain is named and the person is active; a Workspace account that was suspended or removed stays until an administrator deactivates it. Reading the Workspace's directory stays open.
6. **The board keeps at least one administrator in**, counting active ones.

## Consequences

- Who is in is answered on every request from the person's row, as it was from the configuration, and is fail closed: deactivated is out, and so is what the configuration no longer vouches for.
- The REST API gains the listings (`POST /api/v1/listings`, `DELETE /api/v1/listings/<id>`), `status` on `PATCH /api/v1/people/<id>`, and `status`, `source` and `deactivatedAt` on every person; the command gains `person add`, `person remove`, `person deactivate` and `person reactivate`; the People page gains the form, the listings and the deactivated. The feed says who was let in, taken off, deactivated and reactivated.
- `MEMBERS` is removed without a bridge: a deployment that listed people there lists them on the People page, or names the organization or the domain. The first administrator is `ADMINS`.
- The GitHub App's private key is a secret of the deployment, kept as the client secrets are; the console signs its own requests to the host with it and holds nothing of the host beyond an installation token that expires.
- Rejected: reading the organization with the person's own OAuth token (the console keeps nothing of it, and a token for an agent can outlive any sign-in); roles from the organization's own (an owner there is not an administrator here, ADR-0005); deleting a person (what they did names them); a status on the listing instead of the person (a person who is out is a fact about the person, whatever let them in).
