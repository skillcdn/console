# Architecture

> **Status: design baseline.** Nothing described here is implemented yet; [roadmap.md](roadmap.md) tracks what exists. The decisions with lasting consequences are in [adr/](adr/); the rest of this document is the proposed shape, kept current as the implementation lands: when they diverge, update this document in the same change. The open questions are at the end.

## Overview

```
person (browser)  ------------------------>  console, role api  -------->  PostgreSQL
                                             |  REST for the UI,             the board: tasks, runs, decisions, events;
agent (Claude Code, Codex,                   |  MCP for agents,               people, sessions, tokens; the job queue
  any MCP client)  ---- MCP ---------------> |  sign-in through the git host
      |                                      |
      |  MCP: the organization's skills      v
      +---------------------------------->  a SkillCDN deployment (skillcdn.ai or self-hosted)
                                             read through its REST API and @skillcdn/core

console, role worker      schedules, reminders, clean-up; later the runs the console starts itself
blob store (S3 API)       what runs hand in: logs, files; keyed by content hash
```

Five properties shape everything else:

- **People decide, agents work.** Every change of state is attributed: to a person, or to an agent acting for a person. A decision is a record of its own, with the question, the options, who answered and when. The aim is that people make the decisions that matter and nothing else.
- **The board is the record.** What is to be done, what is being done and what was decided live in the database, never in a conversation, an agent's memory or a machine. Several people, each with their own agent, see one board.
- **Built on SkillCDN, not inside it.** The organization's playbooks and skills are git repositories served by SkillCDN. The console refers to them by address and reads them through the published packages and the REST API; it stores nothing of their content.
- **One image, one database.** Local development and a cloud deployment run the same image against PostgreSQL and S3-compatible storage ([ADR-0002](adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)). Nothing in the code names a cloud.
- **What an agent sends is data.** A report, a file, a proposed decision: parsed at the edge, bounded, stored, shown as text; never executed, never rendered as HTML.

## Vocabulary

These are the concepts the schema, the API and the UI are named after. The first milestone turns them into code; until then this list is the contract.

| Concept | What it is |
|---|---|
| **Workspace** | An organization's board. A deployment holds one until a need for more appears. |
| **Person** | Someone who signed in through the git host and is a member of the workspace. |
| **Agent** | An agent connected by a person: its kind (Claude Code, Codex, another MCP client), the token it holds, the person it acts for. An agent is that person for the board's purposes, and is shown as "agent for *person*". |
| **Task** | A unit of work: title, body in Markdown, state, owner (a person), assignee (a person or their agent), priority, links (repositories, pull requests, documents), parent task for a breakdown. States: `idea`, `ready`, `in_progress`, `in_review`, `done`, `dropped`. |
| **Run** | One agent working on one task: who started it, which agent, when; its status (`running`, `waiting` for a decision, `finished`, `failed`, `abandoned`); its reports; what it handed in. |
| **Decision** | A question that needs a person, raised from a run or by a person: the question, the options, who may answer, the answer with who gave it and when. A run that raised one waits for it. |
| **Event** | An append-only record of everything that happened to the board. The live feed of the UI and the audit trail. |
| **Artifact** | What a run hands in: a link (a branch, a pull request, a page) or a file kept in the blob store by its hash. |

## How agents take part

Proposed, to be settled by the second milestone:

- **The console is an MCP server to agents.** An agent connects to the console's MCP endpoint with a token its person made, and gets a small set of tools, names provisional: `list_tasks`, `take_task`, `report` (progress on the run), `hand_in` (an artifact), `ask` (raise a decision; the call returns when it is answered or the run is marked waiting), `finish`. MCP is what Claude Code and Codex both speak, so this needs nothing installed on the agent's side, and it is the same shape the organization's skills arrive in.
- **Attended first.** A person runs their agent on their own machine and connects it; the console sees what the agent reports. Unattended runs, where the worker starts agents itself, come later and need decisions of their own (where they run, with what credentials, within what limits).
- **Hooks later.** Where an agent can run a command on its own events, a small hook can report automatically what the agent would otherwise be asked to report. Optional, additive.

## Sign-in and permissions

- People sign in through the git host the organization uses, GitHub first, as SkillCDN does: the console keeps a session and never a password of its own. The git host's token stays server-side, encrypted, and is used only to ask who the person is.
- Membership: the first version takes a configured list of allowed accounts. Reading the git-host organization's membership instead is an open question.
- An agent's token is made by a person on their own page, scoped to that person, expiring and revocable; it is stored as a hash. An agent can do what its person can do, and nothing on anyone else's behalf.
- Requests that change something for a person come from the console's own pages: the session cookie does not travel with other sites' requests, and the origin is checked as well.
- Permissions fail closed: no confirmed answer, no access.

## Runtime: one image, several roles

`apps/console` builds into a single container image. The container command selects the role:

| Role | What it does | Scaling |
|---|---|---|
| `api` | Serves HTTP: the REST API for the UI, the MCP endpoint for agents, sign-in, the default UI's files. Holds no state another replica needs. | Any number of replicas. |
| `worker` | Runs schedules, and consumes the job queue once there are jobs: today the clean-up of expired sessions; later reminders for decisions that wait, and the runs the console starts itself. | Any number; interruptible. |
| `migrate` | Applies pending migrations, then exits. | Once, before a new version rolls out. |

A flag (`WORKER_IN_PROCESS`) lets `api` run the worker loop in-process for a single-container install. `GET /healthz` reports liveness and `GET /readyz` readiness (database reachable, schema at the expected version, workspace found). On `SIGTERM` the process stops accepting work, drains what is in flight and exits within the grace period. The exit codes and the probes are the process contract in [`deploy/README.md`](../deploy/README.md#process-contract).

## The package and custom consoles

`@skillcdn/console` (`packages/console`) is what a custom console is built from, planned in three layers:

1. **The schemas and the client** of the console's REST API, so that a custom UI talks to any console with types, and so that the API's contract has one source.
2. **The components:** the board, a task, a run, a decision, the live feed, each taking its data as props and nothing from the network.
3. **The composition:** `createConsole(config)`, the default console assembled from the components, with the places a team may replace named.

The default UI the image serves is exactly that composition with the default configuration. A custom console is a small repository that depends on the package, holds a configuration and a CI job, and builds to static files served next to any console API, or into an image of its own. Nothing of the server is in the package.

## Data and storage

PostgreSQL holds the workspace, the people, their sessions and the agents' tokens (hashed), the tasks, the runs with their reports, the decisions, the events, and the job queue. Identifiers are UUIDv7; timestamps are `timestamptz`; events are append-only. Files a run hands in go to the blob store under their content hash; the first implementation of that port keeps the bytes in PostgreSQL, so that the smallest install has one dependency, and the S3 implementation takes over where the bytes do not belong in rows. The schema is documented in `apps/console/README.md` once it exists.

## Deployment

- **Locally:** `deploy/compose.dev.yaml` runs PostgreSQL; the console runs from `pnpm dev`. The image is built from `deploy/Dockerfile` once there is one.
- **On a cloud:** the same image as containers, a managed PostgreSQL and a bucket. [`deploy/README.md`](../deploy/README.md) is the contract: the roles, the environment variables, what a platform must provide (secrets at runtime, health probes, a stop timeout above the grace period, logs from stdout). The definitions of a particular deployment live outside this repository ([AGENTS.md](../AGENTS.md), rule 8).

## Stack

Inherited from the main repository, unchanged ([ADR-0002](adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)); this table records the decision, not what is installed:

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript 7, ESM only; pnpm pins itself and the runtime. |
| Monorepo | pnpm workspaces with a catalog, Turborepo, project references; packages compile to `dist/`. |
| HTTP | Hono on the Node.js adapter. |
| MCP | The official MCP TypeScript SDK, over Streamable HTTP; one server instance per request. |
| Validation | Zod at every boundary. |
| Database | PostgreSQL 18; Drizzle ORM on the `pg` driver; migrations are generated, reviewed SQL files that never leave the deployable. |
| Jobs | pg-boss, adopted with the first job; until then the worker runs schedules on a timer. |
| Blob storage | S3 API; PostgreSQL rows for the smallest install. |
| Logging | pino, JSON to stdout. |
| Quality | Biome, Vitest, gitleaks. |
| Web | Vite + React, plain CSS with design tokens. The default UI is the package's composition. |
| Delivery | One multi-stage Dockerfile, non-root; CI builds and exercises the image on every change. Publishing and rollout happen outside this repository. |

## Security model

- **Untrusted input:** everything an agent sends, every request, and what SkillCDN serves of a repository. Parsed with schemas, bounded in size and depth, stored as data, shown as text or as Markdown rendered to elements, never as HTML, never executed.
- **Fail closed** on membership and on every token. Unknown and forbidden answer the same.
- **Tokens:** git-host tokens encrypted at rest and used only to ask; sessions and agent tokens stored as hashes; nothing logged.
- **Nobody acts for someone else:** an agent is its person, and its person only.
- **Outbound requests** go only to configured base URLs: the git host and the SkillCDN deployment. Never to a URL an agent sent.
- **Supply chain:** lockfile with integrity hashes, a minimum release age, an allow-list for install scripts, actions pinned by commit, secret scanning.

## Open questions

Decided when the milestone that needs them starts; a decision with lasting consequences gets an ADR.

1. Membership: a configured list of accounts, or the git-host organization's members, or both.
2. How a decision reaches a person away from the board: notifications are a port; which adapters come first.
3. Unattended runs: where the agents the console starts would run, with what credentials, within what limits.
4. What of a run is kept: reports only, or the agent's full transcript, with its size and what it may contain.
5. One workspace per deployment or several, and what a second one would share.
6. Whether the REST API is versioned from the first release, given that custom consoles are built against it.
7. Languages of the UI: English only at first; the main repository's web UI has English and Korean.
8. Whether this repository stays public. It is written as if it does; if it does not, infrastructure definitions could live under `deploy/`.
