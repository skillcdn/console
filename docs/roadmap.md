# Roadmap

What exists, what is being built, what comes next. Update this file in the same change that starts, finishes or drops an item. Detailed task tracking happens in GitHub issues until the console can track its own; this file stays coarse.

## Done

- **Foundation (2026-10-09).** The repository laid out so that development can start: the working agreement ([AGENTS.md](../AGENTS.md)), what the console is and how it is built ([architecture.md](architecture.md), [ADR-0001](adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md), [ADR-0002](adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md), [ADR-0003](adr/0003-the-console-is-licensed-under-mit.md)), the toolchain and CI, the two workspaces as placeholders that build and test, the deployment contract, compose for the local database.
- **Milestone 1, the board (2026-10-09).** A person opens the console, signs in through the git host (membership from configuration), writes a task, moves it along, raises a decision and answers one; several people see the same board, live. The data model and its migrations, the config module and the three roles with probes and clean shutdown, the [REST API](specs/rest.md) with its contract in `@skillcdn/console/api` and a feed of server-sent events woken through the database's own channel, the default UI from the package's components and composition, and the image with its job in CI. No agents yet.

## Now: milestone 2, agents at work

Goal: a person connects their agent to the console; the agent takes work from the board, reports what it does, hands in what it made, and raises a decision when one is needed; a person answers it from the board.

- [x] Tokens a person makes for their agent (2026-10-09): scoped to that person, expiring, revocable, stored as hashes; a page to make and remove them. The REST API and the feed take a token as well as a session, so that a script or a custom console acts as its person ([ADR-0004](adr/0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md)).
- [x] Roles (2026-10-09): an administrator who configures, a member who works; kept in the database, applied to a person's agents as to the person ([ADR-0005](adr/0005-people-sign-in-through-an-identity-provider-and-membership-and-roles-are-the-consoles-own.md)).
- [x] The sign-in port generalized from the git host to an identity provider (2026-10-09), and Google Workspace as the second adapter, with membership from the Workspace domain as a source the operator may choose.
- [x] The MCP endpoint and its tools (2026-10-09): `list_tasks`, `get_task`, `take_task`, `report`, `hand_in`, `ask`, `await_decision`, `finish`, one server per request, with what an agent sends parsed and bounded at the edge ([specs/mcp.md](specs/mcp.md)).
- [x] Runs with their reports and artifacts (2026-10-09): the data model, and the run on the task's page and in the feed. Artifacts are links; files come next.
- [ ] Files handed in: the blob-store port with its PostgreSQL implementation, and `hand_in` taking a file.
- [x] A decision a run waits for, and the run resuming when it is answered (2026-10-09).
- [ ] Claude Code and Codex connected by hand, with the steps written down.
- [ ] The organization's skills shown by address through `@skillcdn/core` and the REST API of a SkillCDN deployment. `@skillcdn/core` 0.1.1 was published on 2026-10-09; the release-age rule makes it installable from 2026-10-12, or sooner under `minimumReleaseAgeExclude` for that one install.

## After milestone 2

3. **Custom consoles from the package.** `@skillcdn/console` published: the first version by hand, then the release workflow copied from the main repository; the components and the composition documented; a template repository that builds a custom console in CI; the image serving a custom build; and a person's own console, built from the package and run for themselves against the organization's console (open question 9).
4. **On a cloud.** The image deployed next to a managed PostgreSQL and a bucket, the S3 implementation of the blob-store port, and what a platform must provide written into `deploy/README.md`. The definitions of the deployment stay outside this repository.

## Later, undecided

Unattended runs, where the console would start agents itself: not planned, since an agent is a person's own app or CLI under their own subscription, and the console calls no model API. Ideas and intake: from a thought to a task, with the questions a person is asked on the way. Rules for what an agent may decide alone. Notifications beyond the board. Several workspaces in one deployment. Languages of the UI. Hooks that report an agent's events without being asked.
