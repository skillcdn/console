# Contributing to the SkillCDN Console

Thanks for your interest. The console is pre-alpha and moving quickly, so please open an issue before starting anything larger than a small fix: the design may already be changing under you.

The rules for working in this codebase (conventions, testing, commits, documentation) are in [`AGENTS.md`](AGENTS.md). They apply to people and AI agents alike. This file covers setup and the contribution process.

## Setup

You need:

- **pnpm 12 or newer** (`npm install -g pnpm@latest`). pnpm then pins its own exact version and downloads the pinned Node.js 24 runtime for project scripts; both are verified against the lockfile.
- **Docker**, for the local PostgreSQL once the first milestone brings a database, and for building the image once there is one.
- Node.js 24 as your system Node.js is recommended so editors and ad-hoc commands match. It is not required for pnpm scripts.

```sh
pnpm install
pnpm check                                          # lint, build, typecheck, test: must pass before every commit
docker compose -f deploy/compose.dev.yaml up -d     # PostgreSQL 18 on 127.0.0.1:5433
cp .env.example .env
```

## Process

1. Make one logical change. Add tests. Update the docs listed in the "Documentation protocol" table in `AGENTS.md`. A change to the published package (`packages/console`) also adds a changeset: `pnpm changeset`.
2. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.
3. Run `pnpm check`.
4. **Maintainers** currently push directly to `main` (`git pull --rebase` first); a pull-request flow will replace this later. **Everyone else:** fork, open a pull request against `main` and fill in the checklist.

Found a security problem? Do not open an issue. Follow [`SECURITY.md`](SECURITY.md).

## License of contributions

The console is licensed under the [MIT License](LICENSE.md). By contributing you agree that your contribution is licensed under it, like the rest of the repository, and you confirm that you wrote the contribution or otherwise have the right to submit it under these terms. Please do not submit code copied from projects under copyleft or source-available licenses, and do not add dependencies under such licenses: the `@skillcdn/*` packages, under the main repository's license, are the one exception.
