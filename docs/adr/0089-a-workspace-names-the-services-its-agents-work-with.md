# ADR-0089: A workspace names the services its agents work with

- Status: Proposed
- Date: 2026-11-10
- Follows [ADR-0084](0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md) and [ADR-0088](0088-an-agent-account-has-a-desk-and-is-enrolled-with-an-invitation-code.md). Extends the workspace's settings ([ADR-0035](0035-who-may-see-whom-is-decided-by-one-policy-and-the-workspace-keeps-its-settings.md)) and the rule of where a setting lives in [architecture.md](../architecture.md).

## Context

Setting an agent account up means accounts at the organization's services: a mailbox at its identity provider, an account at its git host, a membership in its messenger, the pack its skills come from. Organizations differ in every one of them and change them, and the console must prescribe none: a GitHub field on the workspace would be wrong for the organization on GitLab, and a Slack field for the one on another messenger. What the console needs is to know which services this organization uses, so that setup, the guide and the onboarding say the right names, and so that a change of service is a change of a setting.

## Decision

1. **The workspace keeps a handle, a domain and a map of services,** on the Settings page under "Services", for an administrator (`PATCH /api/v1/workspace`, `console workspace edit`), answered on `GET /api/v1/me`: `handle`, the organization's short name as a login elsewhere (`acme`), `domain`, its mail and web domain, and `services`, a map by role of the service, each `{ kind, ...parameters }`, no secrets:

   ```json
   {
     "handle": "acme",
     "domain": "acme.example",
     "services": {
       "identity":  { "kind": "google-workspace", "domain": "acme.example" },
       "git":       { "kind": "github", "org": "acme", "handleTemplate": "{org}-{handle}" },
       "messenger": { "kind": "slack", "workspace": "acme.slack.com", "wake": "socket-mode" },
       "skills":    { "address": "https://skillcdn.ai/gh/acme/skills" }
     }
   }
   ```

   Each entry is validated by its `kind` (a discriminated union of the kinds the package knows); an unknown kind is kept with the parameters it came with. The organization's skills address and the identity providers people sign in through are the first entries of the map and stay compatible with where they are read today.
2. **A kind is a provider module in the package,** as a product is a driver (ADR-0085): it says the steps of the guide for its service, the onboarding items an agent gets and the words of the decisions to the manager, the wake source for a messenger, how the product connects to the service (an MCP server to add, say), how the desk is created at a git host, and how to check that a handle is free where the host offers a way. `github`, `google-workspace` and `slack` come first; an unknown kind gets generic steps and no wake source.
3. **A public handle is the organization's handle and the agent's,** `{org}-{handle}` unless the template says otherwise: `acme-mira`, and its mailbox `<handle>@<domain>`. A handle taken elsewhere is not resolved by the console: the person or the agent chooses another, or a numeric suffix if they want one; no suffix that says what kind of account it is, since accounts of one kind should look alike.
4. **Setup derives from the map, and a change derives again.** `console agent setup` writes what the services say into `runner.json` and the desk's `AGENTS.md`, and `setup --refresh` does it again when the console says the services changed (a wake from the console, ADR-0085), which also gives the agent onboarding items for the changed service. The accounts an agent holds elsewhere, its public handles and its mailbox, are recorded on the account as a list without secrets, so that offboarding knows what to close.

## Consequences

- The console carries no product's field: an organization on another git host or messenger sets another `kind`, and the agents' setup follows; a service the package does not know is still named, and its steps are written by hand.
- The guide, the onboarding and the decisions to the manager name the organization's real services, addresses and handles, so that a person who is not a developer reads what to create, and nothing is typed twice.
- A new provider module ships with the package and needs nothing of the console's schema.
- Rejected: fields per product on the workspace, which the next organization contradicts; the services in the deployment's environment, where an organization's own choices change while it runs; the console resolving a taken handle itself, which would name an agent something nobody chose.
