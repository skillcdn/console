# ADR-0089: A workspace names the services its agents work with

- Status: Accepted; that a module says in the guide that a service asks a person to make an account (point 3) is amended by [ADR-0094](0094-the-account-an-agent-signs-in-with-is-named-and-who-makes-it-is-the-organizations-to-say.md): a module says what has to be there, never who makes it
- Date: 2026-11-10
- Follows [ADR-0084](0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md) and [ADR-0088](0088-an-agent-account-has-a-desk-and-is-set-up-from-an-invitation-by-signing-in-as-itself.md). Extends the workspace's settings ([ADR-0035](0035-who-may-see-whom-is-decided-by-one-policy-and-the-workspace-keeps-its-settings.md)) and the rule of where a setting lives in [architecture.md](../architecture.md).

## Context

Setting an agent account up means accounts at the organization's services: the account it signs in with at the identity provider, an account at its git host, a membership in its messenger. Organizations differ in every one of them and change them, and the console must prescribe none: a field for one git host on the workspace would be wrong for the organization on another, and a field for one messenger for the one on another. What the console needs is to know which services this organization uses and what the organization and each agent are called, so that making an account, the guide and the onboarding say the right names, and so that a change of service is a change of a setting.

## Decision

1. **The workspace keeps a handle, a domain and a map of services,** on the Settings page under "Services", for an administrator (`PATCH /api/v1/workspace`, `console workspace edit`), answered on `GET /api/v1/me`: `handle`, the organization's short name (`acme`), `domain`, its mail and web domain, and `services`, a map by role of the service, each `{ kind, ...parameters }`, no secrets:

   ```json
   {
     "handle": "acme",
     "domain": "acme.example",
     "services": {
       "identity":  { "kind": "google-workspace" },
       "git":       { "kind": "github", "organization": "acme" },
       "messenger": { "kind": "slack", "workspace": "acme.slack.com" }
     }
   }
   ```

   `identity` names the provider the workspace's agent accounts sign in through, one of those the deployment signs people in with; `git` and `messenger` name where an agent's other accounts are made. Each entry is validated by its `kind` (a discriminated union of the kinds the package knows); an unknown kind is kept with its parameters as short strings, up to a bound on their number and their length, and shown as they are. How people sign in and where the skills are read from stay where they are, in the deployment's configuration and on the project: the map names what an agent's accounts are made at and nothing the console already knows.
2. **Everyone has a short name of their own, and a name elsewhere is put together from them.** The workspace's `handle` and an agent account's `handle` ([ADR-0084](0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md), point 6) are each chosen once. A name at a service comes from the service's template, whose places are `{workspace}`, `{agent}` and `{domain}`: the login and mailbox `{agent}@{domain}` at an identity service of mailboxes (`mira@acme.example`), the account `{workspace}-{agent}` at a git host (`acme-mira`), unless the entry says another (`"account": "{agent}-{workspace}"`). A name taken elsewhere is not resolved by the console: the person or the agent chooses another, or a numeric suffix if they want one; no suffix that says what kind of account it is, since accounts of one kind should look alike.
3. **A kind is a provider module in the package,** as a product is a driver (ADR-0085): it says the steps of the guide for its service, the onboarding items an agent gets and the words of what is asked of a person, the wake source for a messenger, how the product connects to the service (an MCP server to add, say), what form the agent's account takes there and where the desk is made, and how to check that a name is free where the service offers a way. A service may ask that a person make an account, and may hold an organization to few accounts that a machine runs; the module says so in the guide and names the form of account the service provides for it. `github`, `google-workspace` and `slack` come first; an unknown kind gets generic steps and no wake source.
4. **Setup derives from the map, and a change derives again.** Making an account derives the login it signs in with; `console agent setup` writes what the services say into `runner.json` and the desk's `AGENTS.md`; and `setup --refresh` does it again when the console says the services changed (a wake from the console, ADR-0085), which also gives the agent onboarding items for the changed service. The accounts an agent holds elsewhere are recorded on the account as a list without secrets, so that taking an agent out knows what to close; its mailbox is its `email`, by which a plugin matches it to an account elsewhere as it matches a person.

## Consequences

- The console carries no product's field: an organization on another git host or messenger sets another `kind`, and the agents' setup follows; a service the package does not know is still named, and its steps are written by hand.
- The guide, the onboarding and what is asked of people name the organization's real services, addresses and names, so that a person who is not a developer reads what to create, and nothing is typed twice.
- A new provider module ships with the package and needs nothing of the console's schema.
- Rejected: fields per product on the workspace, which the next organization contradicts; the services in the deployment's environment, where an organization's own choices change while it runs; the skills' address and the ways people sign in copied into the map, a second place for what has one; `{org}` as a place in a template beside a parameter of the same name that meant the git host's organization; the console resolving a taken name itself, which would name an agent something nobody chose.
