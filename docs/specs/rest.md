# Spec: the REST API of the board

- Status: **Draft.** Version 1 serves the default UI, the `console` command ([cli.md](cli.md)), and a custom console built from `@skillcdn/console`.
- The schemas live in `packages/console` (`@skillcdn/console/api`); the handlers in `apps/console/src/http/rest.ts`. The integration tests parse every answer with the package's schemas, which is what the pages and the command parse with.

The API is the board as its members see it: the people, the tasks, the runs, the decisions, and everything that happened. It is the one surface of the console ([ADR-0006](../adr/0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)): the pages, the command and a custom console are all its clients. Every route but `GET /api/v1/me` is for whoever is signed in, or for whoever presents a token a person made; nobody is answered with a refusal, never with less. The one workspace of the deployment is implied: there is no workspace in any path until a second one exists.

## Conventions

- Base path `/api/v1`; UTF-8 JSON. Absent values are `null`, never missing keys. Instants are ISO 8601 strings.
- Every answer is `cache-control: no-store`: it is one person's, or it changes.
- A request that changes something (`POST`, `PATCH`, `DELETE`) on a session must carry the session cookie **and** come from the console's own pages: the browser's `origin` header must be `PUBLIC_URL`. The cookie is `SameSite=Lax`, so another site's request does not carry it in the first place; the origin is the second fence.
- A token ([`POST /api/v1/tokens`](#get-apiv1tokens-and-post-apiv1tokens)) is presented as `Authorization: Bearer <secret>` on any route, by an agent, a script or a console of a person's own. It is then the credential: a cookie beside it is not looked at, and no origin is needed, since nothing attaches a token but whoever holds it. A token that is nothing is refused, whatever cookie travels with it.
- Request bodies are JSON, at most 256 KiB, and parsed once with the package's input schema. Text is trimmed where it is a line, bounded everywhere (`MAX_TITLE_LENGTH` and the rest of `@skillcdn/console/api`), and refused when it carries control or invisible characters. Links are `https` URLs only.
- Errors have `{ "error": { "code": "...", "message": "..." } }`. The code is stable; the message is for a person, in English.

| Status | `code` | When |
|---|---|---|
| 400 | `request.invalid` | A query parameter or the body does not parse; the message names the first field at fault. |
| 400 | `task.invalid_assignee` | The assignee is not a person of the workspace. |
| 400 | `task.invalid_parent` | The parent is not a task of the workspace, is the task itself, or would make a loop. |
| 400 | `decision.invalid_task` | The decision is about a task that is not one of the workspace's. |
| 400 | `decision.no_such_option` | The answer names an option the decision does not have. |
| 400 | `decision.invalid_run` | A decision raised from a run that is not the asker's, or is over. |
| 400 | `run.too_many_reports`, `run.too_many_artifacts` | The run carries as many as one may (`MAX_REPORTS_PER_RUN`, `MAX_ARTIFACTS_PER_RUN`). |
| 401 | `auth.required` | Nobody is signed in, or the session has ended, or the token is nothing. The cookie is taken away when the operator no longer lists the login. |
| 403 | `auth.forbidden_origin` | A request that changes something on a session did not come from the console's own pages. |
| 403 | `auth.forbidden` | A member asked for what only an administrator may do. |
| 403 | `auth.session_required` | A token asked for what only a person signed in may do: the tokens themselves, and configuring. |
| 403 | `run.not_yours` | The run is another person's. |
| 404 | `task.not_found`, `decision.not_found`, `token.not_found`, `person.not_found`, `run.not_found`, `run.task_not_found` | No such id in the workspace; for a token, none of the asker's. An id that is not a UUID is not found either, except a task's number. |
| 404 | `not_found` | Nothing at this path. |
| 409 | `decision.answered` | The decision has an answer already. |
| 409 | `token.too_many` | The person holds as many live tokens as one may (`MAX_TOKENS_PER_PERSON`). |
| 409 | `person.last_admin` | The change would leave the board without an administrator. |
| 409 | `run.over`, `run.task_taken`, `run.task_closed` | The run has ended already; an agent is at work on the task already; the task is done or dropped. |
| 413 | `request.too_large` | The body is over the limit. |

## Endpoints

### `GET /api/v1/me`

`{ "workspace": { "name" }, "person": ... | null, "signIn": [{ "key", "label" }, ...] }`: what the board is called, who the session cookie or the token says is asking (`id`, `login`, `name` or `null`, `avatar` or `null`, `role`), and the identity providers people sign in through (`gh`, `google`, each with the label of its button), none where nobody can. Nobody is an answer, not an error; the pages ask this once to decide what to show, and the command once, at `login`, to see that the console knows the token.

### `GET /api/v1/people`

`{ "items": [person, ...] }`: everyone who has signed in and is still listed, by login. What a picker of assignees is made of. A person carries their `role`: `admin`, who configures the board, or `member`, who works on it.

### `PATCH /api/v1/people/<id>`

Takes `role` and answers the person. For an administrator signed in on the console's own pages, never with a token: an agent works as its person does, and configuring is a person's own doing. The board keeps at least one administrator (`person.last_admin`). A change writes a `person.role_changed` event with `login` and `role`; a change to what is already so writes nothing.

### `GET /api/v1/tasks?state=`

`{ "items": [task, ...] }`: the board, newest first, at most `LIST_LIMIT` tasks; `state` keeps one state of it. A task carries its `number` (the one people say out loud), `title`, `body` (Markdown, to be shown as text or rendered to elements, never as HTML), `state`, `priority`, `owner`, `assignee` (a person, or `null`), `parentId`, `links` (`url` and `label`), `openDecisions` (how many decisions about it wait for a person), `openRuns` (how many agents are at work on it, or waiting), `createdAt` and `updatedAt`.

### `POST /api/v1/tasks`

Takes `title`, and optionally `body`, `state` (default `idea`), `priority` (default `normal`), `assigneeId`, `parentId` and `links`. The owner is whoever writes it. Answers `201` with the task, numbered after the last, and writes a `task.created` event.

### `GET /api/v1/tasks/<id or number>` and `PATCH /api/v1/tasks/<id>`

One task, by its id or by its number (`/api/v1/tasks/7`): the pages hold ids, people and their agents say numbers. A patch takes the id and names only what changes, with the same fields as a creation; a field set to `null` clears it. A change of `state` is a `task.moved` event with `from` and `to`; any other change is one `task.updated` event naming the `fields`. A patch that changes nothing writes nothing and answers the task as it is.

### `GET /api/v1/decisions?open=&task=`

`{ "items": [decision, ...] }`: the ones that wait first, newest first within each; `open=true` keeps only those that wait, `task=<id>` only those about one task. A decision carries its `question`, `body` (Markdown), `options` (each an `id` and a `label`), `taskId` or `null`, `raisedBy`, `run` (the `id` and `agent` of the run that raised it, when an agent asked, or `null`), and `answer`: `null` while it waits, else the chosen `option`, a `note` or `null`, `by` and `at`.

### `POST /api/v1/decisions`

Takes `question`, `options` (two to `MAX_OPTIONS` labels), and optionally `body`, and either `taskId` or `runId`. Options are numbered from `1`. From a run, which must be the asker's and open (`decision.invalid_run`), the decision is about the run's task, `taskId` is not looked at, and the run waits (`status: waiting`) until the answer. Answers `201` with the decision and writes a `decision.raised` event, with the `agent` when a run asked.

### `GET /api/v1/decisions/<id>?wait=` and `POST /api/v1/decisions/<id>/answer`

One decision. With `wait=<seconds>` (`0` to `600`) the request is held while the decision waits, up to the server's own bound (50 seconds), and answers the decision as it stands then: how an agent learns the answer at once, woken through the database's own channel, without asking again and again. A decision answered already, or a wait of `0`, answers at once.

The answer takes `option` (the id of one of its options) and optionally a `note`. A decision is answered once; the answer records who gave it and when, writes a `decision.answered` event with the label of the option, and lets a run that waited go on (`status: running`), unless another decision of its still waits.

### `GET /api/v1/runs?task=&open=&mine=` and `GET /api/v1/runs/<id>`

`{ "items": [run, ...] }`: the runs, newest first, at most `LIST_LIMIT`; `task=<id>` keeps those on one task, `open=true` those not over (`running` or `waiting`) and `open=false` those over, `mine=true` the asker's own: with a token, the runs begun with that token, which is one agent's; on a session, the runs for the person. A run is one agent at work on one task for one person: `taskId`, `person` (whom the agent acts for), `agent` (what it calls itself), `status` (`running`, `waiting` for a decision, `finished`, `failed`, `abandoned`), `startedAt`, `endedAt` or `null`, `summary` (Markdown, what the agent said at the end, or `null`), `reports` (each `id`, `body` in Markdown, `createdAt`; oldest first), `artifacts` (each `id`, an https `url`, `label` or `null`, `createdAt`), and `waitingFor`, the id of the decision the run waits for, or `null`.

### `POST /api/v1/runs`

Takes `taskId`, and optionally `agent` (what people see at work, `MAX_AGENT_LENGTH`; left out, the name of the token presented, or the person's login on a session). The run begins: the task becomes the asker's and `in_progress`, and the board is told (`run.started`). One agent at a time per task (`run.task_taken`); a task that is `done` or `dropped` cannot be taken (`run.task_closed`); a task that is nothing is `run.task_not_found`. Answers `201` with the run, whose `id` the rest take.

### `POST /api/v1/runs/<id>/reports` and `POST /api/v1/runs/<id>/artifacts`

How the work goes, and what was made. A report takes `body` (Markdown, `MAX_BODY_LENGTH`, not blank) and tells the board (`run.reported`, with the first words as `excerpt`); an artifact takes an https `url` and optionally a `label` (`run.handed_in`). Both answer `201` with the run. Only the run's person adds to it (`run.not_yours`), only while it is open (`run.over`), and only so many (`run.too_many_reports`, `run.too_many_artifacts`).

### `POST /api/v1/runs/<id>/end`

Takes `status` (`finished`, `failed` or `abandoned`) and optionally a `summary` (Markdown, `MAX_SUMMARY_LENGTH`: what was done and what is left), ends the run (`run.ended`), and answers it. A finished run puts a task that was `in_progress` up for review (`in_review`); the rest leave the task as it is. The run's person ends it, as `finished` or `failed` from their agent; `abandoned` is a person giving up on a run that will not come back: their own, or anyone's as an administrator signed in on the console's own pages, never with a token (`run.not_yours`). A run that is over is `run.over`.

### `GET /api/v1/events?after=&limit=`

`{ "items": [event, ...], "more": boolean }`: what happened after event number `after` (`0` for the beginning), oldest first, at most `limit` (default and maximum `EVENTS_PAGE_LIMIT`); `more` says whether there is more after the last item. An event carries its `id` (the number), `kind` (one of `EVENT_KINDS`), the `actor` (a person, or, for what an agent did, the person it acts for), `taskId`, `decisionId` and `runId` (or `null`), `data` (what a feed shows without asking for the subject: `number`, `title`, `fields`, `from`, `to`, `question`, `option`, `login`, `role`, `agent`, `status`, `label`, `excerpt`, each only when the kind has it), and `createdAt`.

### `GET /api/v1/events/stream?after=`

The same events as they happen, as server-sent events: one message per event, with `id` the event's number, `event` its kind and `data` the event as JSON; a comment (`: ping`) every 25 seconds of silence. A browser that reconnects sends `Last-Event-ID`, which wins over `after`, so that nothing is missed. The stream ends when the server shuts down; an `EventSource` reconnects on its own.

The feed is written in the same transaction as the change it records, so what a stream carries happened, and what happened is carried; every process of the deployment learns of a change through the database's own channel, so a board with several `api` replicas is one board.

### `GET /api/v1/tokens` and `POST /api/v1/tokens`

The tokens of whoever is signed in, for their agents, scripts and consoles of their own: managed by a person signed in on the console's own pages, never with a token, so that a token which leaks cannot outlive its removal through tokens of its own. `GET` answers `{ "items": [token, ...] }`, the live ones newest first: `id`, `name`, `createdAt`, `expiresAt` (or `null` for a token that does not expire), `lastUsedAt` (or `null`; noted at most hourly), and never a secret. `POST` takes `name` (what the person calls it: the agent it is for, where it runs; what the board shows at work unless the agent says otherwise) and optionally `expiresInDays` (`1` to `MAX_TOKEN_DAYS`; `DEFAULT_TOKEN_DAYS` when left out; `null` for a token that does not expire) and answers `201` with `{ "token": token, "secret": "cns_t_..." }`: the secret this once, which the server keeps only as a hash.

### `DELETE /api/v1/tokens/<id>`

Takes one of the asker's tokens away, whoever holds it, and answers `204`. A token that is not the asker's is `token.not_found`.

## Signing in

Not part of the REST API, and described in [`deploy/README.md`](../../deploy/README.md#signing-in): `GET /auth/<provider>/login?return_to=` and `GET /auth/<provider>/callback` for each provider the deployment has (`gh`, `google`; any other is nothing), and `POST /auth/logout` from the console's own pages. A page learns why a sign-in did not complete from `?sign_in=denied|expired|failed|refused` on the page it was for.
