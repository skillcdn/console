# apps/console

The single deployable of the console: the API people and agents talk to, the worker, the migrations, and the default UI, in one image whose container command selects the role, `api`, `worker` or `migrate` ([ADR-0002](../../docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)). What it does and how its parts fit together is in [docs/architecture.md](../../docs/architecture.md); what to build next is in [docs/roadmap.md](../../docs/roadmap.md).

**Nothing runs yet.** `src/main.ts` selects the role and says that it is not implemented; the first milestone fills it in, and its data model is here already. Until then:

```sh
pnpm turbo run build --filter=@skillcdn/console-app
node apps/console/dist/main.js api      # says so, exits 70; without a role or with an unknown one, exits 64
```

## Layout

```
src/
  main.ts        the entry point: role selection, then the role module
  roles/         one module per role, loaded only when selected                       (not yet)
  config/        the only reader of process.env: schema, defaults, validation           (not yet)
  http/          the REST API for the UI, the MCP endpoint for agents, sign-in, the UI's files (not yet)
  db/            schema.ts (one file: drizzle-kit reads it), client.ts (the pool, opaque to the rest),
                 migrate.ts (applies migrations, reports whether the schema is current), queries/
                 (the only way to the data), testing.ts (a database per test file; not compiled)
  errors.ts      the base class of errors that cross a boundary, with their stable code
  jobs/          what the worker runs                                                  (not yet)
  adapters/      the git host, the blob store, the clock, notifications                (not yet)
migrations/      generated SQL and its journal, committed, shipped inside the image
```

## Rules

Read the root [`AGENTS.md`](../../AGENTS.md) first. This workspace is the composition root: it wires ports to adapters and exposes the console over HTTP and the job queue.

- **`src/config/` is the only reader of `process.env`** (lint enforces it). A new variable means: schema in the config module, an entry in `.env.example`, and a row in the table in `deploy/README.md`, all in the same change. Every tunable has a safe generic default; production values are never committed.
- **`api` is stateless.** No in-memory state that affects correctness; everything several replicas must agree on is in the database.
- **Every handler runs in this order:** validate input with a schema, check who is asking and what they may do, then do the work. Unknown and forbidden answer the same.
- **What an agent sends is data.** Bounded, stored, shown as text; never executed, never HTML.
- **Tokens stop at the edge.** A session or an agent token becomes a person at the route that received it; nothing further in sees the credential. Nothing is ever logged that could be one.
- **Jobs are idempotent and interruptible.** A job never assumes it runs exactly once; payloads stay readable by the previous release.
- **Shutdown is part of the feature.** Anything long-running registers with the shutdown path, and tests cover it.
- **The schemas of the API live in `packages/console`**, so that the default UI, a custom console and this server share one contract. This workspace imports them from `@skillcdn/console/api`; it never defines a second copy. The vocabulary there (the states, the priorities, the kinds of event) is what the database's constraints are made of.
- **`src/db/` is the only place that sees the ORM or SQL.** The rest of the app holds an opaque `Database` and calls the functions under `src/db/queries/`. No string-built SQL, ever: the query builder, or a parameterized `sql` template. Time is passed in (`now: Date`), never read in SQL, so that what depends on it is testable.
- **Every change to the board is one transaction with the event that records it** (`recordEvent`), which also nudges every process listening on the `console_events` channel. Nothing is recorded that did not happen, and nothing happens unrecorded.

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
| `people` | A person who signed in through the git host and was let in: the `host` and the host's immutable `host_account_id`, which is what a person is known by, so that a renamed account stays the same person; `login`, `name` and `avatar_url` as the host said at the last sign-in; `last_login_at`. | unique `(workspace_id, host, host_account_id)` |
| `sessions` | A browser a person is signed in on: the SHA-256 of the cookie's token (`token_hash`), never the token; `expires_at`, which moves while the session is used; `last_seen_at`. Rows go with their person (`on delete cascade`). | unique `token_hash`; `person_id`; `expires_at` |
| `tasks` | A unit of work: its `number` in the workspace, `title`, `body` in Markdown, `state` and `priority` (checked against the package's vocabulary), the `owner` (a person, whoever wrote it unless handed over), the `assignee` (a person, or nobody; an agent acting for a person arrives later), the `parent` for a breakdown (never itself or one of its own descendants), and `links`, the `https` URLs with a label that the API checked. | unique `(workspace_id, number)`; `(workspace_id, state)`; `parent_id` |
| `decisions` | A question that needs a person: the `question`, a `body` in Markdown, the `options` (each with an `id` an answer names and a `label`), the `task` it is about (or none), who `raised` it, and the answer: the chosen option's id (`answer`), `answer_note`, `answered_by_id` and `answered_at`, all null while the decision waits. | `(workspace_id, answered_at)`; `task_id` |
| `events` | Everything that happened to the board, in order: `kind` (the package's `EVENT_KINDS`), the `actor` (a person, or nobody for the console itself), the `task` and the `decision` it is about, and `data`, what a feed shows without asking for the subject. Append-only. **Numbered** (`bigint generated always as identity`) rather than keyed by uuid: the feed is read from a number on, and a number says where. | `(workspace_id, id)` |

How it behaves:

- **Writing a task** bumps the workspace's counter under the row lock the update takes, so two tasks written at once get two numbers. The assignee must be a person of the workspace and the parent a task of it, with no loop (`checkParent` walks up the chain, at most 50 deep).
- **Changing a task** is one transaction: a move from one state to another is a `task.moved` event with `from` and `to`; the rest is one `task.updated` event naming the `fields`. A patch that changes nothing writes nothing.
- **Raising a decision** numbers its options from `1`. **Answering** one takes the row for update, refuses a decision already answered (`decision.answered`) or an option not its own (`decision.no_such_option`), and tells the board which label was chosen.
- **Events** are written in the transaction of the change they record, and `pg_notify('console_events', '')` goes out with the commit: a process that listens asks for what is after the last number it saw, and the payload says nothing. `listEventsAfter` reads a page from a number on and says whether there is more.
- **Expired sessions** are removed by the worker's sweep (`deleteExpiredSessions`); every read checks the time itself, so the sweep only keeps the table small.

Not here yet: agents and their tokens, runs with their reports and artifacts, and the blob store (milestone 2); the job queue's own schema, which arrives with the first job.
