# Architecture

> **Status:** the board (milestone 1) and agents at work (milestone 2) are implemented as described here. [roadmap.md](roadmap.md) tracks what exists. The decisions with lasting consequences are in [adr/](adr/); the rest of this document is kept current as the implementation lands: when they diverge, update this document in the same change. The open questions are at the end.

## Overview

```
person (browser)  ------------------------>  console, role api  -------->  PostgreSQL
                                             |  the REST API, for the UI     the board: tasks, runs, decisions, events;
agent (Claude Code, Codex, any with a shell) |  and for agents' commands,     people, sessions, tokens; the job queue
  ---- the `console` command, over REST ---> |  sign-in through a provider
      |                                      |
      |  its own SkillCDN connection          v  the organization's skills, by address, for the board
      +---------------------------------->  a SkillCDN deployment (skillcdn.ai or self-hosted)
                                             read through its REST API and @skillcdn/core

console, role worker      schedules, reminders, clean-up; later the runs the console starts itself
blob store                the files runs hand in, keyed by content hash: rows of PostgreSQL today, S3 later
```

Five properties shape everything else:

- **People decide, agents work.** Every change of state is attributed: to a person, or to an agent acting for a person. A decision is a record of its own, with the question, the options, who answered and when. The aim is that people make the decisions that matter and nothing else.
- **The board is the record.** What is to be done, what is being done and what was decided live in the database, never in a conversation, an agent's memory or a machine. Several people, each with their own agent, see one board.
- **Built on SkillCDN, not inside it.** The organization's playbooks and skills are git repositories served by SkillCDN. The console refers to them by address and reads them through the published packages and the REST API; it stores nothing of their content.
- **One image, one database.** Local development and a cloud deployment run the same image against PostgreSQL and S3-compatible storage ([ADR-0002](adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)). Nothing in the code names a cloud.
- **What an agent sends is data.** A report, a file, a proposed decision: parsed at the edge, bounded, stored, shown as text; never executed, never rendered as HTML.

## The operating model

Whoever runs the console for an organization deploys the image once, configures how people sign in and who is a member, and keeps the organization's playbooks and skills in git repositories in the SkillCDN format. The people of the organization then work with the agents of their own choice: each runs their agent in their own app or CLI, on their own machine and under their own subscription, and connects it to the console. The board is where their work is written down, moved along, decided on and shared. Every organization has skills and a console of its own; the console in this repository is the reference, and what an organization builds from the package is theirs.

Three consequences shape the design:

- **The console calls no model API and starts no agent.** An agent is a person's own process, working the board through the `console` command with a token that person made ([ADR-0004](adr/0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md), [ADR-0006](adr/0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)). The console sees what the agent reports and hands in. Unattended runs, where the console would start agents itself, stay open ([open questions](#open-questions)).
- **Nobody touches the database.** People hold sessions, agents hold tokens, both reach the board through the REST API, and every request is decided at the edge. The one database credential is the server's.
- **Identity comes from a provider; membership and roles are the console's** ([ADR-0005](adr/0005-people-sign-in-through-an-identity-provider-and-membership-and-roles-are-the-consoles-own.md)): GitHub today, Google Workspace next, more as adapters. What a person may do, and what their agents may do, is kept here.

## Vocabulary

These are the concepts the schema, the API and the UI are named after. The vocabulary in code is `@skillcdn/console/api`; the schema is in [`apps/console/README.md`](../apps/console/README.md#data-model).

| Concept | What it is |
|---|---|
| **Workspace** | An organization's board. A deployment holds one until a need for more appears (`WORKSPACE_NAME`). |
| **Person** | Someone who signed in through an identity provider (GitHub, Google) and is a member of the workspace. |
| **Agent** | An agent connected by a person: its kind (Claude Code, Codex, any agent with a shell), the token it holds, the person it acts for. An agent is that person for the board's purposes, and is shown as "agent for *person*". |
| **Task** | A unit of work: title, body in Markdown, state, owner (a person), assignee (a person or their agent), priority, links (repositories, pull requests, documents), parent task for a breakdown. States: `idea`, `ready`, `in_progress`, `in_review`, `done`, `dropped`. |
| **Run** | One agent working on one task: who started it, which agent, when; its status (`running`, `waiting` for a decision, `finished`, `failed`, `abandoned`); its reports; what it handed in. |
| **Decision** | A question that needs a person, raised from a run or by a person: the question, the options, who may answer, the answer with who gave it and when. A run that raised one waits for it. |
| **Event** | An append-only record of everything that happened to the board. The live feed of the UI and the audit trail. |
| **Artifact** | What a run hands in: a link (a branch, a pull request, a page) or a file kept in the blob store by its hash. |

## How agents take part

- **The console is a command to agents** ([specs/cli.md](specs/cli.md), [ADR-0006](adr/0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)). The package ships `console`, a thin client of the REST API with no logic of its own, which a person signs in once with a token they made. An agent takes a task (`console take`: a run begins; the task is the person's and in progress), reports (`console report`), hands in a link or a file (`console hand-in`), asks for a decision (`console ask`: the run waits, and the command waits a while for the answer) and ends the run (`console finish`, `fail` or `abandon`). Each is one or two requests of the REST API ([specs/rest.md](specs/rest.md)), the one surface of the console; the command costs an agent nothing until it is used, and an agent learns it from its help. The console is not an MCP server.
- **The organization's skills are shown by address** (`SKILLS_ADDRESS`): the Skills page and `console skills` list what the SkillCDN deployment serves there, each with where a person reads it and the URI an agent loads it by through its own SkillCDN connection. The console reads the deployment's REST API with the contracts of `@skillcdn/core`, holds an answer for a minute, and keeps nothing of the skills ([specs/rest.md](specs/rest.md#get-apiv1skills)). The address moves to the project with milestone 3.
- **Attended, by design.** A person runs their agent in their own app or CLI, on their own machine, under their own subscription, and connects it; the console calls no model API and sees what the agent reports. Unattended runs, where the worker would start agents itself, are not planned for the board and need decisions of their own if they ever come (where they run, with what credentials, within what limits).
- **An agent is its person, and no more.** Its token is made by one person, scoped to that person, revocable, and expiring unless the person chose otherwise; what the person may do on the board is what the agent may do. Finer rules, what an agent may decide alone and what must wait for a person, come after the first agents are connected.
- **A run is the record of the agent's work:** who started it, as which agent, on which task; its reports and what it handed in; the decision it waits for; how it ended. A run that asked waits until a person answers on the board, and is woken through the database's own channel, the same nudge the live feed runs on. A person may give up on a run that will not come back.
- **Hooks later.** Where an agent can run a command on its own events, a small hook can report automatically what the agent would otherwise be asked to report. Optional, additive.

## Sign-in and permissions

- People sign in through an identity provider the organization already uses, GitHub or Google (Workspace), one or both ([ADR-0005](adr/0005-people-sign-in-through-an-identity-provider-and-membership-and-roles-are-the-consoles-own.md)): the console keeps a session and never a password of its own. The provider's token is used once, server-side, to ask who the person is, and then dropped: nothing of it is kept, since membership is decided here and not at the provider. A provider is an adapter of one port, `IdentityProvider`; a person is known by the provider and its immutable id of the account, and called by their login there (an address, at Google).
- Membership: a configured list of accounts (`MEMBERS`: logins at GitHub, addresses at Google), and the accounts of a Google Workspace domain the operator names (`GOOGLE_WORKSPACE_DOMAIN`), which Google vouches for at sign-in; both checked at sign-in and on every request after, so that a login taken off the list, or a domain, is out at once. Reading the git-host organization's membership is still open (open question 1).
- A token is made by a person on their Tokens page, for an agent, a script or a console of their own: scoped to that person, revocable, expiring unless the person chose otherwise, stored as a hash, and presented as `Authorization: Bearer` to the REST API and the feed, where it is the credential and needs no origin ([ADR-0004](adr/0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md)). A token can do what its person can do and nothing on anyone else's behalf; it cannot make, list or remove tokens, which only a person signed in does, on the console's own pages.
- Roles: an administrator, who configures the board, and a member, who works on it; the console's own record on the person ([ADR-0005](adr/0005-people-sign-in-through-an-identity-provider-and-membership-and-roles-are-the-consoles-own.md)). `ADMINS` makes those logins administrators when they sign in; an administrator makes or unmakes others on the People page, and the board keeps at least one. A person's agents have their person's role on the board; configuring, which today is roles and later membership and skills, is done by a person signed in on the console's own pages, never with a token, as tokens themselves are.
- Requests that change something for a person come from the console's own pages: the session cookie does not travel with other sites' requests, and the origin is checked as well.
- Permissions fail closed: no confirmed answer, no access.

## Runtime: one image, several roles

`apps/console` builds into a single container image. The container command selects the role:

| Role | What it does | Scaling |
|---|---|---|
| `api` | Serves HTTP: the REST API for the UI and for agents' commands ([specs/rest.md](specs/rest.md)) with its live feed, sign-in, the default UI's files. Holds no state another replica needs: a change any replica makes reaches every replica's feed subscribers through the database's own notification channel. | Any number of replicas. |
| `worker` | Runs schedules, and consumes the job queue once there are jobs: today the clean-up of expired sessions; later reminders for decisions that wait, and the runs the console starts itself. | Any number; interruptible. |
| `migrate` | Applies pending migrations, then exits. | Once, before a new version rolls out. |

A flag (`WORKER_IN_PROCESS`) lets `api` run the worker loop in-process for a single-container install. `GET /healthz` reports liveness and `GET /readyz` readiness (database reachable, schema at the expected version, workspace found). On `SIGTERM` the process stops accepting work, drains what is in flight and exits within the grace period. The exit codes and the probes are the process contract in [`deploy/README.md`](../deploy/README.md#process-contract).

## The package and custom consoles

`@skillcdn/console` (`packages/console`) is what a custom console is built from, planned in three layers:

1. **The schemas and the client** of the console's REST API, so that a custom UI talks to any console with types, and so that the API's contract has one source.
2. **The components:** the board, a task, a run, a decision, the live feed, each taking its data as props and nothing from the network.
3. **The composition:** `createConsole(config)`, the default console assembled from the components, with the places a team may replace named.

The default UI the image serves is exactly that composition with the default configuration: `apps/console/web` is one page that calls `createConsole().mount(...)`, built with Vite into static files the `api` role serves from `WEB_ROOT`. A custom console is a small repository that depends on the package, holds a configuration and a CI job, and builds to static files served next to any console API, or into an image of its own. Nothing of the server is in the package.

The package is meant for two kinds of custom console: the organization's, which replaces the default UI the image serves, and a person's own, which a member builds from the package and runs for themselves, against the organization's console, with pages and components of their choosing. The second talks to the REST API and the feed with a token of the person's (`createClient({ token })`); how it is served (by the console, from a build the person uploads, or from their own machine over an allowed origin) is an open question for the third.

The pages route in the browser (`/`, `/tasks/<id>`, `/decisions`, `/feed`); every path that is not a file of the build is answered with the page, under a content security policy that runs nothing inline and loads nothing from elsewhere but pictures over https. The board is loaded whole, the feed from the beginning, and from then on the server's stream says when something changed: on every event the lists are loaded again.

## Data and storage

PostgreSQL holds the workspace, the people, their sessions and the agents' tokens (hashed), the tasks, the runs with their reports, the decisions, the events, and the job queue. Identifiers are UUIDv7, except that events are numbered, since the feed is read from a point on; timestamps are `timestamptz`; events are append-only, written in the transaction of the change they record, and the commit notifies every process that listens (`pg_notify`), which is how the feed is live without any state outside the database. Files a run hands in go to the blob store under their content hash; the first implementation of that port keeps the bytes in PostgreSQL, so that the smallest install has one dependency, and the S3 implementation takes over where the bytes do not belong in rows. The schema is documented in [`apps/console/README.md`](../apps/console/README.md#data-model).

## Deployment

- **Locally:** `deploy/compose.dev.yaml` runs PostgreSQL; the console runs from the built output (`apps/console/README.md`). The image is built from `deploy/Dockerfile`, and CI builds and exercises it on every change.
- **On a cloud:** the same image as containers, a managed PostgreSQL and a bucket. [`deploy/README.md`](../deploy/README.md) is the contract: the roles, the environment variables, what a platform must provide (secrets at runtime, health probes, a stop timeout above the grace period, logs from stdout). The definitions of a particular deployment live outside this repository ([AGENTS.md](../AGENTS.md), rule 8).

## Stack

Inherited from the main repository, unchanged ([ADR-0002](adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)); this table records the decision, not what is installed:

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript 7, ESM only; pnpm pins itself and the runtime. |
| Monorepo | pnpm workspaces with a catalog, Turborepo, project references; packages compile to `dist/`. |
| HTTP | Hono on the Node.js adapter. |
| Command line | Node.js and the package's own code, no dependencies; shipped as the package's `bin`, a thin client of the REST API. |
| Validation | Zod at every boundary. |
| Skills | `@skillcdn/core` for the address scheme and the REST contracts of a SkillCDN deployment, read on the server; the browser never calls the deployment. |
| Database | PostgreSQL 18; Drizzle ORM on the `pg` driver; migrations are generated, reviewed SQL files that never leave the deployable. |
| Jobs | pg-boss, adopted with the first job; until then the worker runs schedules on a timer. |
| Blob storage | S3 API; PostgreSQL rows for the smallest install. |
| Logging | pino, JSON to stdout. |
| Quality | Biome, Vitest, gitleaks. |
| Web | Vite + React, plain CSS with design tokens. The default UI is the package's composition. |
| Delivery | One multi-stage Dockerfile, non-root; CI builds and exercises the image on every change; images are published and rolled out outside this repository. The package is published by the release workflow through the registry's trusted publishing, versioned on the `@skillcdn/core` line ([ADR-0007](adr/0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md)). |

## Security model

- **Untrusted input:** everything an agent sends, every request, and what SkillCDN serves of a repository. Parsed with schemas, bounded in size and depth, stored as data, shown as text or as Markdown rendered to elements, never as HTML, never executed. A file handed in is kept as bytes and handed back as bytes: shown in place only for the few kinds a browser cannot run, never sniffed, under a policy that runs nothing.
- **Fail closed** on membership and on every token. Unknown and forbidden answer the same.
- **Tokens:** git-host tokens used once to ask who a person is and never kept; sessions and agent tokens stored as hashes; nothing logged. The command keeps a token in the person's own configuration directory, never takes one on the command line, and never prints one.
- **Nobody acts for someone else:** an agent is its person, and its person only.
- **Outbound requests** go only to configured base URLs: the git host and the SkillCDN deployment. Never to a URL an agent sent.
- **Supply chain:** lockfile with integrity hashes, a minimum release age, an allow-list for install scripts, actions pinned by commit, secret scanning.

## Open questions

Decided when the milestone that needs them starts; a decision with lasting consequences gets an ADR.

1. Membership from the git-host organization, as it comes from the Workspace domain now; and whether an account at a second provider is a second person or the same one, linked.
2. How a decision reaches a person away from the board: notifications are a port; which adapters come first.
3. Unattended runs: where the agents the console starts would run, with what credentials, within what limits.
4. What of a run is kept: reports only, or the agent's full transcript, with its size and what it may contain.
5. Decided: projects within a workspace ([ADR-0008](adr/0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md)); what stays open is whether a second workspace is ever needed once projects exist.
6. Whether the REST API is versioned from the first release, given that custom consoles are built against it.
7. Languages of the UI ([roadmap](roadmap.md), milestone 5): how the packs ship with the package and how a custom console adds its own; English first, Korean next, as the main repository's web UI.
8. Whether this repository stays public. It is written as if it does; if it does not, infrastructure definitions could live under `deploy/`.
9. How a person's own console reaches the organization's: served by the console from a build the person uploads, or run on their machine and allowed as an origin with their token.
10. How a token reaches an agent's machine without being copied ([roadmap](roadmap.md), milestone 5): the command's login approved in the browser with a short code, and what an organization may require of tokens: an expiry at most, a renewal, an administrator's sight of everyone's connected agents.
11. Documents ([roadmap](roadmap.md), milestone 4): a tree of folders per project with a document's path as its address; Markdown with versions; links by path kept both ways; how a file from the blob store attaches; what of a decision becomes a document, and whether a document may be a decision's record.
12. The default brand ([roadmap](roadmap.md), milestone 5): where SkillCDN's assets come from, a published package of the main repository, and under what notice they ship in a repository under MIT.
