# apps/console

The single deployable of the console: the API people and agents talk to, the worker, the migrations, and the default UI, in one image whose container command selects the role, `api`, `worker` or `migrate` ([ADR-0002](../../docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)). What it does and how its parts fit together is in [docs/architecture.md](../../docs/architecture.md); what to build next is in [docs/roadmap.md](../../docs/roadmap.md).

| Role | Command | Purpose | Status |
|---|---|---|---|
| `api` | `node dist/main.js api` | Serves HTTP: the probes, signing in and who is signed in, the [REST API](../../docs/specs/rest.md) of the board with its live feed, which people's pages and agents' commands both work through, and the default UI from `WEB_ROOT`. Stateless. | implemented |
| `worker` | `node dist/main.js worker` | The schedules: the sweep of what time has ended. The job queue arrives with the first job. | implemented |
| `migrate` | `node dist/main.js migrate` | Applies pending migrations, then exits. | implemented |

## Running locally

```sh
docker compose -f deploy/compose.dev.yaml up -d      # PostgreSQL 18 on 127.0.0.1:5433
cp .env.example .env                                 # safe local defaults; set WEB_ROOT to serve the UI
pnpm build                                           # the server, and the UI into web/dist
pnpm --filter @skillcdn/console-app run start migrate
pnpm --filter @skillcdn/console-app run dev          # the api, restarting on change: http://127.0.0.1:11199
```

To work on the UI with its own reloading, run `pnpm --filter @skillcdn/console-app run dev:web` next to the api: it serves the pages at `http://127.0.0.1:11198` and sends everything else to the api. Signing in belongs to the api, so the git host sends the browser back to `PUBLIC_URL`, which is the api's port.

The exit codes, the probes and what a signal does are the process contract in [`deploy/README.md`](../../deploy/README.md#process-contract). Signing in is off until it is configured, and nothing above needs it; to try it locally, register a GitHub OAuth app with `http://127.0.0.1:11199` as its homepage and `http://127.0.0.1:11199/auth/gh/callback` as its callback, and set its values, `AUTH_SECRET`, `PUBLIC_URL=http://127.0.0.1:11199` and `MEMBERS` in `.env` ([`deploy/README.md`](../../deploy/README.md#signing-in)). The tests need none of it: they sign people in through a fixture.

## Layout

```
src/
  main.ts        role dispatch and exit codes; nothing else
  roles.ts       the list of roles
  roles/         api.ts (the composition root: wiring, the server, shutdown), worker.ts (the
                 schedules), migrate.ts; each loaded only when selected
  config/        the only reader of process.env: schema, defaults, validation, NAME_FILE secrets
  logger.ts      pino, JSON to stdout, with the second fence of redaction
  http/          app.ts (the Hono app: probes, not found, errors; everything else registers on it),
                 auth.ts (signing in and out, who is signed in, and `Access`: who a request is for
                 and whether it may change anything), rest.ts (the REST API of the board, and the
                 feed as server-sent events), live-feed.ts (the subscribers of the feed in this
                 process: woken by a nudge, by a timer, and for a heartbeat), rest-shapes.ts
                 (records as they are on the wire), server.ts (listening and the shutdown of the
                 listener), request-context.ts (an id, a client address and an access-log line per
                 request), client-address.ts (trusted proxies and forwarding headers)
  auth/          signing in and what follows from it: secrets.ts (sealing, token making and
                 hashing), login.ts (the round trip to the git host), sessions.ts, tokens.ts (the
                 tokens people make for their agents, scripts and consoles of their own, presented
                 as bearers), membership.ts (the configured list of logins)
  db/            schema.ts (one file: drizzle-kit reads it), client.ts (the pool, opaque to the rest),
                 migrate.ts (applies migrations, reports whether the schema is current), queries/
                 (the only way to the data; projects.ts decides what a person may see and is in
                 each project), listener.ts (a connection of its own on the events channel, made
                 again when lost), testing.ts (a database per test file; not compiled)
  jobs/          janitor.ts: the sweep of what time has ended, on a timer
  skills.ts      a project's skills as the board shows them: read by address through the skill
                 source, the project's own or the organization's, each with its page and its URI,
                 and held per address for a minute
  ports/         the interfaces the domain needs implemented: the clock, the identity provider's
                 side of signing in, the blob store for the files runs hand in, the skill source
                 for the organization's skills
  adapters/      their implementations: the system clock, the GitHub and Google providers and
                 what those share (upstream.ts: a bounded request and its reply), the blob store
                 in PostgreSQL (pg-blob-store.ts), and the SkillCDN deployment's side of the
                 skill source (skillcdn.ts)
  testing/       test support: the providers' side of signing in for a handful of made-up people,
                 and the harness that wires the app for the integration tests (not compiled)
  errors.ts      the base class of errors that cross a boundary, with their stable code
  version.ts     what the process calls itself
web/             the default UI: one page that mounts the package's composition, built by Vite into
                 web/dist, which the api role serves from WEB_ROOT (http/web.ts: the files of the
                 build, and the page for every other path, under a content security policy)
migrations/      generated SQL and its journal, committed, shipped inside the image
```

## Rules

Read the root [`AGENTS.md`](../../AGENTS.md) first. This workspace is the composition root: it wires ports to adapters and exposes the console over HTTP and the job queue.

- **`src/config/` is the only reader of `process.env`** (lint enforces it). A new variable means: schema in the config module, an entry in `.env.example`, and a row in the table in `deploy/README.md`, all in the same change. Every tunable has a safe generic default; production values are never committed.
- **`api` is stateless.** No in-memory state that affects correctness; everything several replicas must agree on is in the database.
- **Every handler runs in this order:** validate input with a schema, check who is asking and what they may do, then do the work. Under a project, the project is found as the asker may see it before anything else (`inProject` in `rest.ts`), and every query that follows is scoped to it. Unknown and forbidden answer the same: a project that is not the asker's to see is not found.
- **What an agent sends is data.** Bounded, stored, shown as text; never executed, never HTML.
- **Tokens stop at the edge.** A session or an agent token becomes a person at the route that received it (`Access.person`); nothing further in sees the credential. The git host's token is used in `auth/login.ts` once, to ask who the person is, and dropped. Nothing is ever logged that could be one.
- **A request that changes something for a person** checks that it comes from the console's own pages (`Access.fromOwnPages`: the browser's `origin` against `PUBLIC_URL`), in addition to the session.
- **Membership is decided on every request.** `Access.person` answers nobody for a session whose login the operator no longer lists, and takes the cookie away with the answer.
- **Jobs are idempotent and interruptible.** A job never assumes it runs exactly once; payloads stay readable by the previous release.
- **Shutdown is part of the feature.** Anything long-running registers with the shutdown path, and tests cover it.
- **The schemas of the API live in `packages/console`**, so that the default UI, a custom console and this server share one contract. This workspace imports them from `@skillcdn/console/api`; it never defines a second copy. The vocabulary there (the states, the priorities, the kinds of event) is what the database's constraints are made of.
- **`src/db/` is the only place that sees the ORM or SQL.** The rest of the app holds an opaque `Database` and calls the functions under `src/db/queries/`. No string-built SQL, ever: the query builder, or a parameterized `sql` template. Time is passed in (`now: Date`), never read in SQL, so that what depends on it is testable.
- **Every change to the board is one transaction with the event that records it** (`recordEvent`), which also nudges every process listening on the `console_events` channel. Nothing is recorded that did not happen, and nothing happens unrecorded.
- **The feed is live without state outside the database.** A subscriber holds a cursor and is woken to ask for what is after it: by the nudge, which the listener connection delivers from any process; by a timer, in case a nudge was missed; and for a heartbeat. Shutdown closes the feed first, so that no stream holds the listener open.

## Tests

- Unit tests next to the code: the config module, the client address, the listener and its shutdown.
- `src/http/app.int.test.ts` runs the app of the `api` role against real PostgreSQL: the probes in every state, the id and the address every request gets, the access log and what it leaves out.
- `src/auth.int.test.ts` covers signing in through fixture providers, a git host and a Workspace: the round trip, the sealed cookie, where a browser may be sent back, what did not complete and why, a login the operator did not list, who the operator names an administrator, sessions and their end (sign-out from the console's own pages only, time, removal from the list), and a deployment where nobody signs in.
- `src/adapters/github-login.test.ts` and `google-login.test.ts` cover the adapters against a fake `fetch`: what each sends, what it reads, and what it refuses.
- `src/adapters/skillcdn.test.ts` and `src/skills.test.ts` cover the organization's skills: the deployment's overview read as the contracts say, what each state and each failure becomes, and the answer held for a while and asked for again.
- `src/rest.int.test.ts` covers the REST API and parses every answer with the package's schemas: who may ask and change; projects made, listed as each person may see them, configured by an owner signed in and never by a member or a token, their members added, changed and removed, and an administrator as owner of every one; tasks and decisions through their whole life, numbered and found per project; what is refused and why; a project's feed and the workspace's own; tokens: made and removed on the console's own pages only, presented as bearers with no origin needed, naming the agent on what they do, refused when they are nothing, removed, expired or no longer a member's, and bounded; and the skills: none without an address, the organization's with one, a project's own when it names one.
- `src/runs.int.test.ts` covers an agent at work through the REST API with its token, as the command line drives it, in a project: taking a task by its number, reporting and handing in, asking and being answered while a read of the decision waits, finishing, what is listed as one's own, what is not its own, what another project does not find, the task's history naming the agent on everything the run did to it, a person giving up on a run as themselves, and files handed in: kept once by their hash, read back by whoever may see the project with the headers that keep them from running, and refused when empty, a path, over the limit, on another's run, on another project's or on one that is over.
- `src/cli.int.test.ts` runs the package's `console` command against the app with no socket: the whole of an agent's work from taking a task to finishing it, with a person deciding meanwhile; the project named by the environment or the directory, listed, and refused when it is not the person's to see; and what the command refuses.
- `src/live.int.test.ts` covers a project's feed as server-sent events, with a listener on the database's channel as a deployment has: what was there, what happens next, heartbeats, where a reconnecting browser starts, that a project the person may not see has no stream, and that closing the feed ends every stream.
- `src/http/web.test.ts` covers serving a build: the files and their types, bundles as immutable, the page for every path of the app under its policy, the API's paths left alone, and that nothing outside the directory is ever served. It uses a small fake build, not `web/dist`.
- `src/db/db.int.test.ts` covers the data model. Every test file has a database of its own; tests inside a file share it.

## Working on the schema

```sh
docker compose -f deploy/compose.dev.yaml up -d                     # PostgreSQL 18 on 127.0.0.1:5433
# edit src/db/schema.ts, then:
pnpm turbo run build --filter=@skillcdn/console                     # the schema imports the package's vocabulary
pnpm --filter @skillcdn/console-app run generate --name <what-changed>
# review the SQL in migrations/, run the tests, commit schema and migration together
```

Migrations follow expand, then contract, across separate releases: a release never removes what the previous one reads. Integration tests (`*.int.test.ts`) create a database per test file, apply the real migrations and drop it afterwards. They connect to the compose database unless `TEST_DATABASE_URL` points elsewhere, and they fail, not skip, when no server answers.

## Data model

Primary keys are `uuid DEFAULT uuidv7()` and timestamps are `timestamptz`, with one exception noted below. Every row that belongs to a board carries `workspace_id` and `project_id`, and every query on those tables takes the project ([ADR-0008](../../docs/adr/0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md)).

| Table | What a row is | Keys and indexes |
|---|---|---|
| `workspaces` | An organization. A deployment holds one, found by its `key` (`default`), made at boot by whichever role comes first and renamed from configuration since (`ensureWorkspace`). `next_task_number` is what tasks were numbered by before projects; unused, kept until the next release (expand, then contract). | unique `key` |
| `projects` | The unit of work and of permission: `key` (what paths and the command say; immutable), `name`, `description`, `visibility` (`workspace`: everyone of the workspace is a member; `private`: only those listed; checked), `skills_address` (canonical, or null for the organization's), and `next_task_number`, the number the next task of the project gets. The migration that brought projects made one, `general`, open to the workspace, and moved the board into it. | unique `(workspace_id, key)` |
| `project_members` | A person listed in a project with a `role` in it: `owner` configures it, `member` works on it (checked). A workspace administrator is an owner of every project without a row; a project open to the workspace has everyone of it as a member without one. Rows go with their project or their person (`on delete cascade`). | primary key `(project_id, person_id)`; `person_id` |
| `people` | A person who signed in through an identity provider and was let in: the provider (`host`: `gh`, `google`) and its immutable `host_account_id`, which is what a person is known by, so that a renamed account stays the same person; `login` (a login at GitHub, an address at Google), `name` and `avatar_url` as the provider said at the last sign-in; `role`, `admin` or `member`, the console's own record; `last_login_at`. | unique `(workspace_id, host, host_account_id)` |
| `sessions` | A browser a person is signed in on: the SHA-256 of the cookie's token (`token_hash`), never the token; `expires_at`, which moves while the session is used; `last_seen_at`. Rows go with their person (`on delete cascade`). | unique `token_hash`; `person_id`; `expires_at` |
| `tokens` | A token a person made for an agent, a script or a console of their own: `name` (what they call it), the SHA-256 of the secret (`token_hash`), never the secret; `expires_at`, which does not move, or is null for a token that does not expire; `last_used_at`, noted at most hourly. Removing a token is deleting its row. Rows go with their person (`on delete cascade`). | unique `token_hash`; `person_id`; `expires_at` |
| `tasks` | A unit of work in a project: its `number` in the project, `title`, `body` in Markdown, `state` and `priority` (checked against the package's vocabulary), the `owner` (a person, whoever wrote it unless handed over), the `assignee` (a person who may work in the project, or nobody), the `parent` for a breakdown (a task of the project, never itself or one of its own descendants), and `links`, the `https` URLs with a label that the API checked. | unique `(project_id, number)`; `(project_id, state)`; `parent_id` |
| `runs` | One agent at work on one task for one person, in the task's project: the `task`, the `person` the agent acts for, the `token` it presented (while it exists), what the agent calls itself (`agent`), `status` (`running`, `waiting`, `finished`, `failed`, `abandoned`; checked), `summary` in Markdown once it ended, `started_at`, `ended_at`. | `task_id`; `(project_id, status)` |
| `reports` | What a run reported: `body` in Markdown. Rows go with their run. | `run_id` |
| `artifacts` | What a run handed in, with a `label`: a link (`kind` `link`, an https `url`), or a file (`kind` `file`: its `file_name`, `file_size`, `content_type`, and the `sha256` its bytes are kept under in the blob store); a check constraint keeps each kind to its columns. Rows go with their run. | `run_id` |
| `blobs` | The bytes of files handed in, under their `sha256`, with their `size`: the PostgreSQL implementation of the blob-store port, which the artifacts refer to by hash and nothing else; the S3 implementation does without the table. | primary key `sha256` |
| `decisions` | A question that needs a person, in a project: the `question`, a `body` in Markdown (the context), the `options` (each with an `id` an answer names and a `label`), the `task` it is about (or none), the `run` that raised it (or none), who `raised` it, the answer: the chosen option's id (`answer`), `answer_note` (the rationale), `answered_by_id` and `answered_at`, all null while the decision waits; and `outcome`, what followed, in Markdown, null until written ([ADR-0009](../../docs/adr/0009-documents-are-pages-of-markdown-in-a-project-addressed-by-path-versioned-and-linked-both-ways.md)). | `(project_id, answered_at)`; `task_id`; `run_id` |
| `documents` | A page of Markdown in a project ([ADR-0009](../../docs/adr/0009-documents-are-pages-of-markdown-in-a-project-addressed-by-path-versioned-and-linked-both-ways.md)): its `path` (segments of lowercase letters, digits and hyphens, separated by slashes; immutable), `title`, `body` and `version` as of the latest version, who made it (`created_by_id`) and who wrote the latest version (`updated_by_id`) through which `agent`, `archived_at` (null while current), and `search`, the words of the title and the body as the database keeps them for its own text search. The row is the latest version; every version is below. | unique `(project_id, path)`; `(project_id, archived_at)`; gin `search` |
| `document_versions` | Every version of a page, from 1: the `title` and the `body` as they were, the `author`, the `agent` or null, when. Rows go with their page. | unique `(document_id, number)` |
| `document_links` | A link to a page by its path, as a `source` made it in its text: a document, a task or a decision (`source_kind`, checked; `source_id`), to `target_path`. Kept both ways: a page's links are the rows it is the source of, what refers to it the rows it is the target of. The target is a path, not a row, since a link may name a page not written yet; the rows of a source are replaced whenever its text is written. | primary key `(project_id, source_kind, source_id, target_path)`; `(project_id, target_path)` |
| `document_files` | A file attached to a page, as a run hands one in: `label`, `file_name`, `file_size`, `content_type`, the `sha256` its bytes are kept under in the blob store, who added it and through which `agent`. Rows go with their page. | `document_id` |
| `events` | Everything that happened, in order: in a project (`project_id`) or to the workspace itself (null: who joined, who was made what); `kind` (the package's `EVENT_KINDS`), the `actor` (a person, or nobody for the console itself), the `agent` the actor acted through (the run's agent for what a run did, else the name of the token presented; null when a person acted themselves), the `task`, the `decision`, the `run` and the `document` it is about, and `data`, what a feed shows without asking for the subject. Append-only. **Numbered** (`bigint generated always as identity`) rather than keyed by uuid: the feed is read from a number on, and a number says where. | `(workspace_id, id)`; `(project_id, id)`; `task_id`; `run_id`; `decision_id`; `document_id` |

How it behaves:

- **A project** is made by a person signed in, who is listed as its owner; the key is checked unique under the lock on the workspace row (`project.key_taken`). What a person is in a project (`findProjectFor`, `listProjectsFor`): an administrator is an owner of every project; a person listed is what the row says; everyone of the workspace is a member of a project open to it; anyone else does not see it, and a project not seen is not found. Members are listed, changed and removed by an owner (`addMember`, `updateMember`, `removeMember`), each with its event; a project may be left with no owner listed, and the administrators own it then. The assignee of a task must be one who may work in the project (`mayWorkIn`).
- **Writing a task** bumps the project's counter under the row lock the update takes, so two tasks written at once get two numbers. The parent must be a task of the project, with no loop (`checkParent` walks up the chain, at most 50 deep).
- **Changing a task** is one transaction: a move from one state to another is a `task.moved` event with `from` and `to`; the rest is one `task.updated` event naming the `fields`. A patch that changes nothing writes nothing.
- **Raising a decision** numbers its options from `1`. Raised from a run (`console ask`), the decision is about the run's task and the run waits. **Answering** one takes the row for update, refuses a decision already answered (`decision.answered`) or an option not its own (`decision.no_such_option`), tells the board which label was chosen, and lets a run that waited go on, unless another decision of its still waits.
- **A document** is written at its path (`writeDocument`): the first write makes the page at version 1, under the lock on the project's row so that two first writes at one path cannot both succeed; the next takes the page's row for update, refuses an archived page (`document.archived`), a write from a version the page has moved on from (`document.conflict`) and one too many (`document.too_many_versions`), and writes nothing for a page that would not change. Every version is a row of its own; the links the body makes are recorded in place of the last ones (`recordLinks`, which the tasks and the decisions call for their texts too); the event names the path, the title and the version. Archiving and restoring (`setArchived`) change `archived_at` and tell the board. A folder's listing (`listDocuments`) is what the paths say: the pages whose path has no further slash after the folder's prefix, and the first segment after it for the folders. The search (`searchDocuments`) is the database's own, `websearch_to_tsquery('simple')` against the kept vector, with the title and the path by substring beside it, ranked. A file is attached (`attachFile`) as a run hands one in, bounded per page.
- **A decision's record** grows (`updateDecision`): the context or what followed, by anyone who works in the project, with the links of its texts kept both ways and a `decision.updated` event naming the fields.
- **A run** begins when an agent takes a task (`startRun`): the task is locked, must not be done or dropped (`run.task_closed`) or have an open run (`run.task_taken`), and becomes the person's and `in_progress` through `updateTaskIn`, in the same transaction, with the task's own events. Reports and artifacts are bounded per run; only the run's person adds them, and only while the run is open (`run.not_yours`, `run.over`). A file handed in goes to the blob store first, under its hash, and the artifact row is written in the transaction with its event; a failure between the two leaves bytes nothing refers to, which costs space and nothing else. Ending a run (`endRun`) is the agent's `finish` or `fail`, or a person giving up on it; a finished run puts a task that was `in_progress` up for review.
- **Events** are written in the transaction of the change they record, with the project it happened in and the agent the actor acted through (`Actor`: a person's id, and the agent's name when they act with a token; a run's events name the run's agent), and `pg_notify('console_events', '')` goes out with the commit: a process that listens asks for what is after the last number it saw, and the payload says nothing. `listEventsAfter` reads a page of one scope from a number on, a project's or the workspace's own, narrowed to a task, a run or a decision when asked, and says whether there is more.
- **A role** is written at sign-in when the operator names the login in `ADMINS`, and otherwise kept; `updatePersonRole` changes it under the lock on the workspace row, refuses to take the last administrator away (`person.last_admin`), and tells the board (`person.role_changed`). Changing roles is a person's own doing, on the console's own pages: an administrator's token works as a member's does.
- **A token is its person.** `Access.person` resolves `Authorization: Bearer` before it looks at a cookie, and a token that is nothing is refused whatever cookie travels with it; membership is checked the same way. A token cannot make, list or remove tokens (`auth.session_required`). A person holds at most `MAX_TOKENS_PER_PERSON` live tokens, counted under the lock on their row (`createToken`).
- **Expired sessions and tokens** are removed by the worker's sweep (`deleteExpiredSessions`, `deleteExpiredTokens`, every fifteen minutes; the `api` role does it too with `WORKER_IN_PROCESS`); every read checks the time itself, so the sweep only keeps the tables small; a token made without an expiry is never swept.
- **The workspace** is found when first needed, by any role, and kept; a failure to find it is not kept, so a request that comes before the database is reachable fails on its own and the next asks again.

Not here yet: the job queue's own schema, which arrives with the first job; the S3 implementation of the blob store ([roadmap](../../docs/roadmap.md), milestone 7).
