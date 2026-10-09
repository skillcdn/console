# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues until the console can track its own; this file stays coarse.

## Done

- **Foundation (2026-10-09).** The repository laid out so that development can start: the working agreement ([AGENTS.md](../AGENTS.md)), what the console is and how it is built ([architecture.md](architecture.md), [ADR-0001](adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md), [ADR-0002](adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md), [ADR-0003](adr/0003-the-console-is-licensed-under-mit.md)), the toolchain and CI, the two workspaces as placeholders that build and test, the deployment contract, compose for the local database. Nothing runs yet.

## Now: milestone 1, the board

Goal: a person opens the console, signs in, writes a task, moves it along, raises a decision and answers one; several people see the same board, live. No agents yet.

- [x] The data model in `apps/console`: workspace, people, sessions, tasks, decisions, events; migrations; the schema documented in the workspace's README.
- [x] The config module, the `api`, `worker` and `migrate` roles, health endpoints, graceful shutdown, structured logging.
- [x] The REST API, with its schemas in `packages/console` so that the contract has one source; integration tests against PostgreSQL. The contract is [docs/specs/rest.md](specs/rest.md); the feed is live, as server-sent events woken through the database's own channel.
- [x] Sign-in through the git host; membership from configuration; requests that change something checked against the console's own origin.
- [ ] The default UI from `packages/console`: the board, a task, the decisions, the live feed; served by the image.
- [ ] The Dockerfile and the image job in CI; `deploy/README.md` filled in with the environment contract.

## After milestone 1

2. **Agents at work.** Tokens a person makes for their agent; the MCP endpoint and its tools; runs with reports and artifacts; a decision a run waits for; Claude Code and Codex connected by hand, with the steps written down. The organization's skills shown by address through `@skillcdn/core` and the REST API of a SkillCDN deployment.
3. **Custom consoles from the package.** `@skillcdn/console` published: the first version by hand, then the release workflow copied from the main repository; the components and the composition documented; a template repository that builds a custom console in CI; the image serving a custom build.
4. **On a cloud.** The image deployed next to a managed PostgreSQL and a bucket, the S3 implementation of the blob-store port, and what a platform must provide written into `deploy/README.md`. The definitions of the deployment stay outside this repository.

## Later, undecided

Unattended runs, where the console starts agents itself. Ideas and intake: from a thought to a task, with the questions a person is asked on the way. Rules for what an agent may decide alone. Notifications beyond the board. Several workspaces in one deployment. Languages of the UI. Hooks that report an agent's events without being asked.
