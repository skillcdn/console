# Spec: the REST API of the board

- Status: **Draft.** Version 1 serves the default UI, and a custom console built from `@skillcdn/console`.
- The schemas live in `packages/console` (`@skillcdn/console/api`); the handlers in `apps/console/src/http/rest.ts`. The integration tests parse every answer with the package's schemas, which is what the pages parse with.

The API is the board as its members see it: the people, the tasks, the decisions, and everything that happened. Every route but `GET /api/v1/me` is for whoever is signed in, or for whoever presents a token a person made; nobody is answered with a refusal, never with less. The one workspace of the deployment is implied: there is no workspace in any path until a second one exists.

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
| 401 | `auth.required` | Nobody is signed in, or the session has ended. The cookie is taken away when the operator no longer lists the login. |
| 403 | `auth.forbidden_origin` | A request that changes something on a session did not come from the console's own pages. |
| 403 | `auth.session_required` | A token asked for what only a person signed in may do: the tokens themselves. |
| 404 | `task.not_found`, `decision.not_found`, `token.not_found` | No such id in the workspace; for a token, none of the asker's. An id that is not a UUID is not found either. |
| 404 | `not_found` | Nothing at this path. |
| 409 | `decision.answered` | The decision has an answer already. |
| 409 | `token.too_many` | The person holds as many live tokens as one may (`MAX_TOKENS_PER_PERSON`). |
| 413 | `request.too_large` | The body is over the limit. |

## Endpoints

### `GET /api/v1/me`

`{ "workspace": { "name" }, "person": ... | null, "signIn": "gh" | null }`: what the board is called, who the session cookie says is signed in (`id`, `login`, `name` or `null`, `avatar` or `null`), and the git host people sign in through, or `null` where nobody can. Nobody is an answer, not an error; the pages ask this once to decide what to show.

### `GET /api/v1/people`

`{ "items": [person, ...] }`: everyone who has signed in and is still listed, by login. What a picker of assignees is made of.

### `GET /api/v1/tasks?state=`

`{ "items": [task, ...] }`: the board, newest first, at most `LIST_LIMIT` tasks; `state` keeps one state of it. A task carries its `number` (the one people say out loud), `title`, `body` (Markdown, to be shown as text or rendered to elements, never as HTML), `state`, `priority`, `owner`, `assignee` (a person, or `null`), `parentId`, `links` (`url` and `label`), `openDecisions` (how many decisions about it wait for a person), `createdAt` and `updatedAt`.

### `POST /api/v1/tasks`

Takes `title`, and optionally `body`, `state` (default `idea`), `priority` (default `normal`), `assigneeId`, `parentId` and `links`. The owner is whoever writes it. Answers `201` with the task, numbered after the last, and writes a `task.created` event.

### `GET /api/v1/tasks/<id>` and `PATCH /api/v1/tasks/<id>`

One task. A patch names only what changes, with the same fields as a creation; a field set to `null` clears it. A change of `state` is a `task.moved` event with `from` and `to`; any other change is one `task.updated` event naming the `fields`. A patch that changes nothing writes nothing and answers the task as it is.

### `GET /api/v1/decisions?open=&task=`

`{ "items": [decision, ...] }`: the ones that wait first, newest first within each; `open=true` keeps only those that wait, `task=<id>` only those about one task. A decision carries its `question`, `body` (Markdown), `options` (each an `id` and a `label`), `taskId` or `null`, `raisedBy`, and `answer`: `null` while it waits, else the chosen `option`, a `note` or `null`, `by` and `at`.

### `POST /api/v1/decisions`

Takes `question`, `options` (two to `MAX_OPTIONS` labels), and optionally `body` and `taskId`. Options are numbered from `1`. Answers `201` with the decision and writes a `decision.raised` event.

### `GET /api/v1/decisions/<id>` and `POST /api/v1/decisions/<id>/answer`

One decision, and its answer: `option` (the id of one of its options) and optionally a `note`. A decision is answered once; the answer records who gave it and when, and writes a `decision.answered` event with the label of the option.

### `GET /api/v1/events?after=&limit=`

`{ "items": [event, ...], "more": boolean }`: what happened after event number `after` (`0` for the beginning), oldest first, at most `limit` (default and maximum `EVENTS_PAGE_LIMIT`); `more` says whether there is more after the last item. An event carries its `id` (the number), `kind` (one of `EVENT_KINDS`), the `actor` (a person, or `null` for the console itself), `taskId` and `decisionId` (or `null`), `data` (what a feed shows without asking for the subject: `number`, `title`, `fields`, `from`, `to`, `question`, `option`, each only when the kind has it), and `createdAt`.

### `GET /api/v1/events/stream?after=`

The same events as they happen, as server-sent events: one message per event, with `id` the event's number, `event` its kind and `data` the event as JSON; a comment (`: ping`) every 25 seconds of silence. A browser that reconnects sends `Last-Event-ID`, which wins over `after`, so that nothing is missed. The stream ends when the server shuts down; an `EventSource` reconnects on its own.

The feed is written in the same transaction as the change it records, so what a stream carries happened, and what happened is carried; every process of the deployment learns of a change through the database's own channel, so a board with several `api` replicas is one board.

### `GET /api/v1/tokens` and `POST /api/v1/tokens`

The tokens of whoever is signed in, for their agents, scripts and consoles of their own: managed by a person signed in on the console's own pages, never with a token, so that a token which leaks cannot outlive its removal through tokens of its own. `GET` answers `{ "items": [token, ...] }`, the live ones newest first: `id`, `name`, `createdAt`, `expiresAt`, `lastUsedAt` (or `null`; noted at most hourly), and never a secret. `POST` takes `name` and optionally `expiresInDays` (`1` to `MAX_TOKEN_DAYS`; `DEFAULT_TOKEN_DAYS` when left out) and answers `201` with `{ "token": token, "secret": "cns_t_..." }`: the secret this once, which the server keeps only as a hash.

### `DELETE /api/v1/tokens/<id>`

Takes one of the asker's tokens away, whoever holds it, and answers `204`. A token that is not the asker's is `token.not_found`.

## Signing in

Not part of the REST API, and described in [`deploy/README.md`](../../deploy/README.md#signing-in): `GET /auth/gh/login?return_to=`, `GET /auth/gh/callback`, and `POST /auth/logout` from the console's own pages. A page learns why a sign-in did not complete from `?sign_in=denied|expired|failed|refused` on the page it was for.
