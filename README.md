<div align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/symbol.svg" width="72"></a>
  <h1>SkillCDN Console</h1>
  <p><strong>Where an organization runs its work with AI agents.</strong></p>
  <p>
    <a href="https://github.com/skillcdn/console/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/console/actions/workflows/ci.yml/badge.svg?branch=main"></a>
    <a href="LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3a6dd4"></a>
  </p>
  <p>
    <a href="https://skillcdn.ai">skillcdn.ai</a> · <a href="docs/architecture.md">Architecture</a> · <a href="docs/roadmap.md">Roadmap</a> · <a href="AGENTS.md">Working agreement</a> · <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

> **Status: pre-alpha.** The board runs: people sign in, write tasks, move them along, raise decisions and answer them, and see one board, live. No agents yet. [docs/roadmap.md](docs/roadmap.md) says what exists; [docs/architecture.md](docs/architecture.md) says how it fits together and what is still open.

**What it is.** The console is the operations room of an organization that lets AI agents do its work. It holds the work to be done, which agent (Claude Code, Codex, any agent that speaks MCP) is doing what right now, what each has done, and the decisions that wait for a person. People decide; agents work. The organization's playbooks and skills live in git repositories and reach the agents through [SkillCDN](https://skillcdn.ai); the console shows those repositories, skills and addresses through the same published packages.

**How an organization uses it.** Whoever runs it deploys the image once, sets up how people sign in and who is a member, and keeps the organization's skills in git. Each member works with the agent of their choice, in their own app or CLI under their own subscription, connected to the console; the console calls no model API and starts no agent. The board is where the work is written down, moved along, decided on and shared, and each organization builds its own console, and each member their own view of it, from the published package.

**What it is to SkillCDN.** The reference console, as [`skillcdn/skills`](https://github.com/skillcdn/skills) is the reference skill repository: an example that follows the standard and is meant for real use, built on the published packages and the REST API like any other consumer would build theirs. It is packaged and published so that anyone can start from it, and it is not a second standard: nothing about SkillCDN is defined here, a repository in the format and a reader of it owe the console nothing, and nothing in [`skillcdn/skillcdn`](https://github.com/skillcdn/skillcdn) depends on this repository ([its ADR-0047](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)). It is not the web UI of `skillcdn.ai` or of a self-hosted SkillCDN either: that UI lives with the server.

## How it works

The first two steps and the board are there today; agents arrive with the second milestone of the roadmap.

1. **Deploy it once.** One container image, one PostgreSQL, S3-compatible storage for what runs leave behind. Locally with compose; on a cloud, the same image next to a managed database and a bucket.
2. **People sign in** through an identity provider the organization already uses (GitHub today, Google Workspace next), and each connects their own agent to the console's MCP endpoint with a token of their own. Several people, each with their own agent, work on the same board. Nobody, person or agent, touches the database: every request goes through the API and is decided there.
3. **Agents take work from the board**, report what they do, hand in what they made (branches, pull requests, documents), and raise a decision when one is needed. A person answers decisions from the board, or from wherever the console notifies them.
4. **The board shows it all, live:** the tasks and their state, the runs in progress, the history, the decisions.
5. **Teams build their own console** from the published package, [`@skillcdn/console`](packages/console/): the client of the console's API, the components, and the composition of the default console. A small repository with a configuration and a CI job then produces a custom console, as static files or as an image.

## Repository layout

```
apps/
  console/    the single deployable: the API people and agents talk to, the worker, the migrations, and the default UI; roles: api | worker | migrate
packages/
  console/    @skillcdn/console: what a custom console is built from (the API client and schemas, the components, the composition)
deploy/       the contract for whoever operates the image; compose for local development
docs/         architecture, roadmap, ADRs
```

TypeScript monorepo: pnpm workspaces, Turborepo, Node.js 24, PostgreSQL 18, with the toolchain and the conventions of the main repository ([ADR-0002](docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)).

## Development

```sh
pnpm install                                        # needs pnpm 12+; the Node.js runtime is pinned and fetched by pnpm
docker compose -f deploy/compose.dev.yaml up -d     # PostgreSQL 18 on 127.0.0.1:5433
pnpm check                                          # lint, build, typecheck, test (the integration tests need the database)
cp .env.example .env                                # safe local defaults; set WEB_ROOT to serve the UI
pnpm --filter @skillcdn/console-app run start migrate
pnpm --filter @skillcdn/console-app run dev         # http://127.0.0.1:11199
```

Signing in needs a GitHub OAuth app and a list of members ([deploy/README.md](deploy/README.md#signing-in)); without it the console says so and nobody is let in.

The working agreement for people and AI agents alike is [AGENTS.md](AGENTS.md). Setup details and the contribution process are in [CONTRIBUTING.md](CONTRIBUTING.md). Secrets are never committed; `.env.example` holds example values only.

## Relationship to SkillCDN

The console consumes [`@skillcdn/core`](https://www.npmjs.com/package/@skillcdn/core) and the other published packages from npm, and the REST API of a SkillCDN deployment, like any other consumer. It never reaches into the main repository's workspace, its database or its image, and what it needs from a package there is proposed, released and adopted by version ([ADR-0001](docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)).

## License

The console is licensed under the [MIT License](LICENSE.md) ([ADR-0003](docs/adr/0003-the-console-is-licensed-under-mit.md)): use it, change it, ship it, as a whole or in parts. The `@skillcdn/*` packages it is built on are the main repository's and keep its license, FSL-1.1-ALv2, which allows every use but offering SkillCDN itself as a competing service. "SkillCDN" and its logos are trademarks of KDX Labs Corp. and are not licensed with the code; the main repository's [TRADEMARKS.md](https://github.com/skillcdn/skillcdn/blob/main/TRADEMARKS.md) says what is allowed. To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

Built by KDX Labs. Copyright (c) 2026 KDX Labs Corp.
