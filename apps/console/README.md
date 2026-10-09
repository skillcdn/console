# apps/console

The single deployable of the console: the API people and agents talk to, the worker, the migrations, and the default UI, in one image whose container command selects the role, `api`, `worker` or `migrate` ([ADR-0002](../../docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)). What it does and how its parts fit together is in [docs/architecture.md](../../docs/architecture.md); what to build next is in [docs/roadmap.md](../../docs/roadmap.md).

| Role | Command | Purpose | Status |
|---|---|---|---|
| `api` | `node dist/main.js api` | Serves HTTP: the probes, signing in and who is signed in, the [REST API](../../docs/specs/rest.md) of the board with its live feed, and the default UI from `WEB_ROOT`. Stateless. | implemented |
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
                 (the only way to the data), listener.ts (a connection of its own on the events
                 channel, made again when lost), testing.ts (a database per test file; not compiled)
  jobs/          janitor.ts: the sweep of what time has ended, on a timer
  ports/         the interfaces the domain needs implemented: the clock, the git host's side of
                 signing in
  adapters/      their implementations: the system clock, the GitHub login
  testing/       test support: the git host's side of signing in for three made-up people, and
                 the harness that wires the app for the integration tests (not compiled)
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
- **Every handler runs in this order:** validate input with a schema, check who is asking and what they may do, then do the work. Unknown and forbidden answer the same.
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
- `src/auth.int.test.ts` covers signing in through a fixture git host: the round trip, the sealed cookie, where a browser may be sent back, what did not complete and why, a login the operator did not list, who the operator names an administrator, sessions and their end (sign-out from the console's own pages only, time, removal from the list), and a deployment where nobody signs in.
- `src/adapters/github-login.test.ts` covers the GitHub adapter against a fake `fetch`: what it sends, what it reads, and what it refuses.
- `src/rest.int.test.ts` covers the REST API and parses every answer with the package's schemas: who may ask and change, tasks and decisions through their whole life, what is refused and why, the feed's pages, and tokens: made and removed on the console's own pages only, presented as bearers with no origin needed, refused when they are nothing, removed, expired or no longer a member's, and bounded.
- `src/live.int.test.ts` covers the feed as server-sent events, with a listener on the database's channel as a deployment has: what was there, what happens next, heartbeats, where a reconnecting browser starts, and that closing the feed ends every stream.
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

Primary keys are `uuid DEFAULT uuidv7()` and timestamps are `timestamptz`, with one exception noted below. Every row that belongs to a board carries `workspace_id`, and every query on those tables takes the workspace.

| Table | What a row is | Keys and indexes |
|---|---|---|
| `workspaces` | An organization's board. A deployment holds one, found by its `key` (`default`), made at boot by whichever role comes first and renamed from configuration since (`ensureWorkspace`). `next_task_number` is the number the next task gets. | unique `key` |
| `people` | A person who signed in through the git host and was let in: the `host` and the host's immutable `host_account_id`, which is what a person is known by, so that a renamed account stays the same person; `login`, `name` and `avatar_url` as the host said at the last sign-in; `role`, `admin` or `member`, the console's own record; `last_login_at`. | unique `(workspace_id, host, host_account_id)` |
| `sessions` | A browser a person is signed in on: the SHA-256 of the cookie's token (`token_hash`), never the token; `expires_at`, which moves while the session is used; `last_seen_at`. Rows go with their person (`on delete cascade`). | unique `token_hash`; `person_id`; `expires_at` |
| `tokens` | A token a person made for an agent, a script or a console of their own: `name` (what they call it), the SHA-256 of the secret (`token_hash`), never the secret; `expires_at`, which does not move; `last_used_at`, noted at most hourly. Removing a token is deleting its row. Rows go with their person (`on delete cascade`). | unique `token_hash`; `person_id`; `expires_at` |
| `tasks` | A unit of work: its `number` in the workspace, `title`, `body` in Markdown, `state` and `priority` (checked against the package's vocabulary), the `owner` (a person, whoever wrote it unless handed over), the `assignee` (a person, or nobody; an agent acting for a person arrives later), the `parent` for a breakdown (never itself or one of its own descendants), and `links`, the `https` URLs with a label that the API checked. | unique `(workspace_id, number)`; `(workspace_id, state)`; `parent_id` |
| `decisions` | A question that needs a person: the `question`, a `body` in Markdown, the `options` (each with an `id` an answer names and a `label`), the `task` it is about (or none), who `raised` it, and the answer: the chosen option's id (`answer`), `answer_note`, `answered_by_id` and `answered_at`, all null while the decision waits. | `(workspace_id, answered_at)`; `task_id` |
| `events` | Everything that happened to the board, in order: `kind` (the package's `EVENT_KINDS`), the `actor` (a person, or nobody for the console itself), the `task` and the `decision` it is about, and `data`, what a feed shows without asking for the subject. Append-only. **Numbered** (`bigint generated always as identity`) rather than keyed by uuid: the feed is read from a number on, and a number says where. | `(workspace_id, id)` |

How it behaves:

- **Writing a task** bumps the workspace's counter under the row lock the update takes, so two tasks written at once get two numbers. The assignee must be a person of the workspace and the parent a task of it, with no loop (`checkParent` walks up the chain, at most 50 deep).
- **Changing a task** is one transaction: a move from one state to another is a `task.moved` event with `from` and `to`; the rest is one `task.updated` event naming the `fields`. A patch that changes nothing writes nothing.
- **Raising a decision** numbers its options from `1`. **Answering** one takes the row for update, refuses a decision already answered (`decision.answered`) or an option not its own (`decision.no_such_option`), and tells the board which label was chosen.
- **Events** are written in the transaction of the change they record, and `pg_notify('console_events', '')` goes out with the commit: a process that listens asks for what is after the last number it saw, and the payload says nothing. `listEventsAfter` reads a page from a number on and says whether there is more.
- **A role** is written at sign-in when the operator names the login in `ADMINS`, and otherwise kept; `updatePersonRole` changes it under the lock on the workspace row, refuses to take the last administrator away (`person.last_admin`), and tells the board (`person.role_changed`). Changing roles is a person's own doing, on the console's own pages: an administrator's token works as a member's does.
- **A token is its person.** `Access.person` resolves `Authorization: Bearer` before it looks at a cookie, and a token that is nothing is refused whatever cookie travels with it; membership is checked the same way. A token cannot make, list or remove tokens (`auth.session_required`). A person holds at most `MAX_TOKENS_PER_PERSON` live tokens, counted under the lock on their row (`createToken`).
- **Expired sessions and tokens** are removed by the worker's sweep (`deleteExpiredSessions`, `deleteExpiredTokens`, every fifteen minutes; the `api` role does it too with `WORKER_IN_PROCESS`); every read checks the time itself, so the sweep only keeps the tables small.
- **The workspace** is found when first needed, by any role, and kept; a failure to find it is not kept, so a request that comes before the database is reachable fails on its own and the next asks again.

Not here yet: runs with their reports and artifacts, and the blob store (milestone 2); the job queue's own schema, which arrives with the first job.
