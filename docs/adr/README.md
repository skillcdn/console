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
