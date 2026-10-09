# ADR-0001: The console is the reference console, built on the published packages

- Status: Accepted
- Date: 2026-10-09

## Context

SkillCDN turns a git repository into an MCP server; its specification, server and web UI live in the main repository, `skillcdn/skillcdn`. The maintainers want a console: where an organization runs its work with AI agents, a board of the work, the agents at it, what they did, and the decisions that wait for a person, with the organization's playbooks reaching those agents through SkillCDN. Several people, each with their own agent, must work on one board, so the console keeps state of its own, in a database.

The main repository's ADR-0047 keeps the console out of that repository: the standard stays complete on its own, and nothing there depends on the console. What remains to decide is what the console is to the standard, and how it relates to the packages the main repository publishes.

## Decision

1. **The console is the reference console,** as `skillcdn/skills` is the reference skill repository: an example that follows the standard and is meant for real use. It is built on the published packages and the REST API exactly as anyone else's console would be, and it is packaged and published, as `@skillcdn/console`, so that anyone can start from it. It is not a second standard: nothing about SkillCDN is defined here, and a repository in the format or a reader of it owes the console nothing.
2. **It lives in this repository, `skillcdn/console`,** with its own versions, releases, CI and documentation.
3. **It depends on the main repository only through what is published:** the npm packages, `@skillcdn/core` first, by version, and the REST API of a SkillCDN deployment. Never a workspace link, a path into the main repository, its database package or its image, and never a copy of its code.
4. **What the console needs from a package there is proposed, released and adopted** as any other consumer's need would be: a change in the main repository with its changeset, a release, then a version bump here. The console is the first consumer of those packages outside the main repository, and so the first test of their surface.
5. **It is not the web UI of a SkillCDN deployment.** That UI (landing page, explorer, account pages) lives with the server. The console is an organization's own tool, for its members, over its own data.

## Consequences

- A need that only the console has is not a reason to change the standard; it is solved here, or proposed there as something every consumer would want.
- Two repositories to keep in step: a breaking release of a package there is adopted here deliberately, by its version.
- Being the example means staying exemplary: the console uses the packages as documented, and where the documentation falls short, that is reported upstream rather than worked around.
- Rejected: a workspace of the main monorepo (ties the standard to a product that is not part of it, and its image and CI to that product); a module of the main repository's web UI (that UI shows what a deployment serves, to everyone; the console shows an organization's own work, to its members, from a database of its own); declaring the console part of the standard (an organization's console is its own; the standard is the format and the tools).
