# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues until the console can track its own; this file stays coarse.

## Done

- **Foundation (2026-10-09).** The repository laid out so that development can start: the working agreement ([AGENTS.md](../AGENTS.md)), what the console is and how it is built ([architecture.md](architecture.md), [ADR-0001](adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md), [ADR-0002](adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md), [ADR-0003](adr/0003-the-console-is-licensed-under-mit.md)), the toolchain and CI, the two workspaces as placeholders that build and test, the deployment contract, compose for the local database.
- **Milestone 1, the board (2026-10-09).** A person opens the console, signs in through the git host (membership from configuration), writes a task, moves it along, raises a decision and answers one; several people see the same board, live. The data model and its migrations, the config module and the three roles with probes and clean shutdown, the [REST API](specs/rest.md) with its contract in `@skillcdn/console/api` and a feed of server-sent events woken through the database's own channel, the default UI from the package's components and composition, and the image with its job in CI. No agents yet.

## Now: milestone 2, agents at work

Goal: a person connects their agent to the console; the agent takes work from the board, reports what it does, hands in what it made, and raises a decision when one is needed; a person answers it from the board.

- [ ] Tokens a person makes for their agent: scoped to that person, expiring, revocable, stored as hashes; a page to make and remove them.
- [ ] The MCP endpoint and its tools (`list_tasks`, `take_task`, `report`, `hand_in`, `ask`, `finish`), one server per request, with what an agent sends parsed and bounded at the edge.
- [ ] Runs with their reports and artifacts: the data model, the blob-store port with its PostgreSQL implementation, and the run on the task's page and in the feed.
- [ ] A decision a run waits for, and the run resuming when it is answered.
- [ ] Claude Code and Codex connected by hand, with the steps written down.
- [ ] The organization's skills shown by address through `@skillcdn/core` and the REST API of a SkillCDN deployment.

## After milestone 2

3. **Custom consoles from the package.** `@skillcdn/console` published: the first version by hand, then the release workflow copied from the main repository; the components and the composition documented; a template repository that builds a custom console in CI; the image serving a custom build.
4. **On a cloud.** The image deployed next to a managed PostgreSQL and a bucket, the S3 implementation of the blob-store port, and what a platform must provide written into `deploy/README.md`. The definitions of the deployment stay outside this repository.

## Later, undecided

Unattended runs, where the console starts agents itself. Ideas and intake: from a thought to a task, with the questions a person is asked on the way. Rules for what an agent may decide alone. Notifications beyond the board. Several workspaces in one deployment. Languages of the UI. Hooks that report an agent's events without being asked.
