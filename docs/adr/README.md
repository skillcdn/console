# Architecture Decision Records

One short file per decision that has lasting consequences and that a future contributor might reasonably want to undo: a dependency the system is built around, a boundary between workspaces, a data-model choice, a security rule, a break in a public contract.

## Rules

- Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` using the next free number.
- Keep it under a page: context, decision, consequences. No essays.
- An accepted ADR is never edited, apart from its status line. To change course, write a new ADR and mark the old one `Superseded by ADR-NNNN`.
- If two changes take the same number, the one that lands second renumbers.
- This repository is public: no business reasoning, no operations details, no comparisons with other products.
- Decisions about SkillCDN itself are made in the main repository's ADRs, never here.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-the-console-is-the-reference-console-built-on-the-published-packages.md) | The console is the reference console: an example that follows the standard and is meant for real use, built on the published packages and the REST API, in a repository of its own; not a second standard | Accepted |
| [0002](0002-one-image-one-database-and-the-main-repositorys-toolchain.md) | One image with `api`, `worker` and `migrate` roles, PostgreSQL as the only stateful dependency, S3-compatible storage behind a port, and the main repository's toolchain and conventions | Accepted |
| [0003](0003-the-console-is-licensed-under-mit.md) | The console is licensed under MIT; the `@skillcdn/*` packages it depends on keep the main repository's license | Accepted |
| [0004](0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md) | Nobody but the console's own processes touches the database; a person holds a session, an agent a token made by its person, and every request is decided at the edge | Accepted |
| [0005](0005-people-sign-in-through-an-identity-provider-and-membership-and-roles-are-the-consoles-own.md) | Signing in is a port with GitHub first and Google Workspace next; a person is known by the provider's id; membership and roles are decided in the console | Accepted |
| [0006](0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md) | Everything an agent does on the board is an endpoint of the REST API; the package ships the `console` command as the agent's side of the console; the console is not an MCP server | Accepted |
| [0007](0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md) | `@skillcdn/console` is published by the release workflow through the registry's trusted publishing, from changesets; its major and minor are those of the `@skillcdn/core` line it is built on, its patch its own; the first version is published by hand | Accepted |
| [0008](0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md) | A workspace holds projects; every task, run and decision belongs to one, and who may see or change it is decided per project on every request; the REST API nests the board under the project, the skills address is the project's, and every event names the agent beside the person | Accepted |
| [0009](0009-documents-are-pages-of-markdown-in-a-project-addressed-by-path-versioned-and-linked-both-ways.md) | A document is a page of Markdown in a project, addressed by an immutable path in a tree of folders, versioned on every write, linked both ways by path from documents, tasks and decisions, archived rather than deleted, with files attached from the blob store; a decision grows into a record of its context, its rationale and what followed | Accepted |
| [0010](0010-the-default-uis-addresses-name-what-they-show-and-every-page-and-form-has-one.md) | The default UI's addresses name what they show, and every page and form has one | Accepted | 2026-10-10 |
| [0011](0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md) | An agent connects with a short code a person approves, and the token is never shown | Accepted | 2026-10-10 |
