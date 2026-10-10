# Spec: the REST API of the board

- Status: **Draft.** Version 1 serves the default UI, the `console` command ([cli.md](cli.md)), and a custom console built from `@skillcdn/console`. It changes until 1.0; the package's changelog says when.
- The schemas live in `packages/console` (`@skillcdn/console/api`); the handlers in `apps/console/src/http/rest.ts`. The integration tests parse every answer with the package's schemas, which is what the pages and the command parse with.

The API is the board as its members see it: the people, the projects, and in each project the tasks, the runs, the decisions, the documents, and everything that happened. It is the one surface of the console ([ADR-0006](../adr/0006-agents-work-the-board-through-the-rest-api-and-the-command-line-not-an-mcp-server.md)): the pages, the command and a custom console are all its clients. Every route but `GET /api/v1/me` is for whoever is signed in, or for whoever presents a token a person made; nobody is answered with a refusal, never with less. The one workspace of the deployment is implied: there is no workspace in any path until a second one exists. The board is a project's ([ADR-0008](../adr/0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md)): what belongs to one is under `/api/v1/projects/<key>`, and a project the asker may not see is not found, whatever is asked under it.

## Conventions

- Base path `/api/v1`; UTF-8 JSON. Absent values are `null`, never missing keys. Instants are ISO 8601 strings.
- Every answer is `cache-control: no-store`: it is one person's, or it changes.
- A request that changes something (`POST`, `PATCH`, `DELETE`) on a session must carry the session cookie **and** come from the console's own pages: the browser's `origin` header must be `PUBLIC_URL`. The cookie is `SameSite=Lax`, so another site's request does not carry it in the first place; the origin is the second fence.
- A token ([`POST /api/v1/tokens`](#get-apiv1tokens-and-post-apiv1tokens)) is presented as `Authorization: Bearer <secret>` on any route, by an agent, a script or a console of a person's own. It is then the credential: a cookie beside it is not looked at, and no origin is needed, since nothing attaches a token but whoever holds it. A token that is nothing is refused, whatever cookie travels with it. What a token does is attributed to its person, and the event names the agent: the token's name, or what the agent called itself on its run.
- Configuring is a person's own doing, signed in on the console's own pages, never with a token: the tokens themselves, roles, projects and their members.
- An agent connects without anyone copying a token ([ADR-0011](../adr/0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md)): [`POST /api/v1/connect`](#connecting-an-agent) is nobody's, the approval is a person's own doing on the console's own pages, and the claim is the command's, with the secret it was given.
- Request bodies are JSON, at most 256 KiB, and parsed once with the package's input schema. Text is trimmed where it is a line, bounded everywhere (`MAX_TITLE_LENGTH` and the rest of `@skillcdn/console/api`), and refused when it carries control or invisible characters. Links are `https` URLs only.
- Errors have `{ "error": { "code": "...", "message": "..." } }`. The code is stable; the message is for a person, in English.

| Status | `code` | When |
|---|---|---|
| 400 | `request.invalid` | A query parameter or the body does not parse; the message names the first field at fault. |
| 400 | `project.invalid_address` | The skills address is not one, as the standard spells them. |
| 400 | `member.invalid_person` | The person to list is not one of the workspace. |
| 400 | `task.invalid_assignee` | The assignee is not a person who may work in the project. |
| 400 | `task.invalid_parent` | The parent is not a task of the project, is the task itself, or would make a loop. |
| 400 | `decision.invalid_task` | The decision is about a task that is not one of the project's. |
| 400 | `decision.no_such_option` | The answer names an option the decision does not have. |
| 400 | `decision.invalid_run` | A decision raised from a run that is not the asker's, or is over. |
| 400 | `token.expiry_at_most` | A token that would not expire, or would outlast `TOKEN_DAYS_AT_MOST`, where the organization requires an expiry. |
| 400 | `document.invalid_path` | The path a page is written at is not one: segments of lowercase letters, digits and hyphens, separated by slashes. |
| 400 | `run.too_many_reports`, `run.too_many_artifacts` | The run carries as many as one may (`MAX_REPORTS_PER_RUN`, `MAX_ARTIFACTS_PER_RUN`). |
| 401 | `auth.required` | Nobody is signed in, or the session has ended, or the token is nothing. The cookie is taken away when the operator no longer lists the login. |
| 403 | `auth.forbidden_origin` | A request that changes something on a session did not come from the console's own pages. |
| 403 | `auth.forbidden` | A member asked for what only an administrator, or only an owner of the project, may do. |
| 403 | `auth.session_required` | A token asked for what only a person signed in may do: the tokens themselves, and configuring. |
| 403 | `run.not_yours` | The run is another person's. |
| 404 | `project.not_found` | No project has that key, or it is not the asker's to see: the two are one answer. The key is checked before anything is asked. |
| 404 | `task.not_found`, `decision.not_found`, `token.not_found`, `person.not_found`, `run.not_found`, `run.task_not_found`, `member.not_found` | No such id in the project (or in the workspace, for a token, a person); for a token, none of the asker's. An id that is not a UUID is not found either, except a task's number. |
| 404 | `file.not_found` | No file handed in, or attached to the page, has that id in the project; a link handed in is not a file. |
| 404 | `document.not_found`, `document.version_not_found` | No page has that path in the project, or the page has no such version. A path that is not one is not found either. |
| 404 | `connect.not_found` | No agent asks to connect under this code or secret: it was never asked, it expired, the person said no, or the token was handed over already. |
| 404 | `not_found` | Nothing at this path. |
| 409 | `project.key_taken` | A project of the workspace has that key already. |
| 409 | `member.exists` | The person is listed in the project already. |
| 409 | `decision.answered` | The decision has an answer already. |
| 409 | `document.conflict` | The page has moved on since the version the write started from (`baseVersion`), or was written at that path by someone else first. |
| 409 | `document.archived` | The page is archived: restore it before writing to it or attaching to it. |
| 409 | `document.too_many_versions`, `document.too_many_files` | The page carries as many versions, or files, as one may (`MAX_VERSIONS_PER_DOCUMENT`, `MAX_FILES_PER_DOCUMENT`). |
| 409 | `token.too_many` | The person holds as many live tokens as one may (`MAX_TOKENS_PER_PERSON`). |
| 409 | `connect.approved` | The connection was approved already; the command claims its token. |
| 429 | `connect.too_many` | As many agents ask to connect as the console holds at once; try again in a few minutes. |
| 409 | `person.last_admin` | The change would leave the board without an administrator. |
| 409 | `run.over`, `run.task_taken`, `run.task_closed` | The run has ended already; an agent is at work on the task already; the task is done or dropped. |
| 413 | `request.too_large` | The body is over the limit; for a file handed in or attached, the file is over `MAX_FILE_BYTES`. |

## The workspace

### `GET /api/v1/me`

`{ "workspace": { "name", "tokenDaysAtMost" }, "person": ... | null, "signIn": [{ "key", "label" }, ...] }`: what the board is called and the most days a token may be good for here (or `null` where a person chooses), who the session cookie or the token says is asking (`id`, `login`, `name` or `null`, `avatar` or `null`, `role`), and the identity providers people sign in through (`gh`, `google`, each with the label of its button), none where nobody can. Nobody is an answer, not an error; the pages ask this once to decide what to show, and the command once, at `login`, to see that the console knows the token.

### `GET /api/v1/people`

`{ "items": [person, ...] }`: everyone who has signed in and is still listed, by login. What a picker of assignees and of members is made of. A person carries their `role` in the workspace: `admin`, who configures it, or `member`, who works in the projects they are in.

### `PATCH /api/v1/people/<id>`

Takes `role` and answers the person. For an administrator signed in on the console's own pages, never with a token: an agent works as its person does, and configuring is a person's own doing. The board keeps at least one administrator (`person.last_admin`). A change writes a `person.role_changed` event with `login` and `role`; a change to what is already so writes nothing.

### `GET /api/v1/projects`

`{ "items": [project, ...] }`: the projects the asker may see, by name. A project carries its `key` (what paths and the command say; lowercase letters, digits and hyphens; immutable), `name`, `description`, `visibility` (`workspace`: everyone of the workspace is a member; `private`: only those listed), `skillsAddress` (canonical, or `null` for the organization's), `role` (what the asker is in it: `owner`, who configures it, or `member`, who works in it), `openDecisions` and `openRuns` (what waits in it), `createdAt` and `updatedAt`. A workspace administrator sees every project, as its owner; a member sees those open to the workspace, as a member, and those they are listed in, as what they are listed.

### `POST /api/v1/projects`

Takes `key` and `name`, and optionally `description`, `visibility` (default `private`) and `skillsAddress` (checked as the standard spells one, kept canonical; `project.invalid_address`). For whoever is signed in on the console's own pages, never with a token; they become the project's owner. Answers `201` with the project and writes a `project.created` event in it, with `key` and `name`. A key taken is `project.key_taken`.

### `GET /api/v1/events?after=&limit=`

The workspace's own events, the ones about no project: who joined (`person.joined`), who was made what (`person.role_changed`). The same shape and parameters as a project's feed below, without the filters.

### `GET /api/v1/tokens` and `POST /api/v1/tokens`

The tokens of whoever is signed in, for their agents, scripts and consoles of their own: managed by a person signed in on the console's own pages, never with a token, so that a token which leaks cannot outlive its removal through tokens of its own. `GET` answers `{ "items": [token, ...] }`, the live ones newest first: `id`, `name`, `createdAt`, `expiresAt` (or `null` for a token that does not expire), `lastUsedAt` (or `null`; noted at most hourly), and never a secret. `POST` takes `name` (what the person calls it: the agent it is for, where it runs; what the board shows at work unless the agent says otherwise, and what an event names as the agent) and optionally `expiresInDays` (`1` to `MAX_TOKEN_DAYS`; `DEFAULT_TOKEN_DAYS` when left out; `null` for a token that does not expire, where the organization allows one; `token.expiry_at_most` otherwise) and answers `201` with `{ "token": token, "secret": "cns_t_..." }`: the secret this once, which the server keeps only as a hash.

### `DELETE /api/v1/tokens/<id>`

Takes one of the asker's tokens away, whoever holds it, and answers `204`. A token that is not the asker's is `token.not_found`.

### `GET /api/v1/people/<id>/tokens` and `DELETE /api/v1/people/<id>/tokens/<token id>`

An administrator's sight of everyone's agents ([ADR-0011](../adr/0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md)): the live tokens of any person, as `GET /api/v1/tokens` lists one's own, and the way to take one away, from the console's own pages; `auth.forbidden` for a member, `person.not_found` for an id that is nobody's, `token.not_found` for a token that is not that person's.

### Connecting an agent

`POST /api/v1/connect`, `GET /api/v1/connect/<code>`, `POST /api/v1/connect/<code>/approve`, `POST /api/v1/connect/<code>/deny` and `POST /api/v1/connect/claim`: how an agent gets its token without anyone copying one ([ADR-0011](../adr/0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md)).

`POST /api/v1/connect` is nobody's: the command sends `{ "agent" }` (what the agent calls itself and where it runs, a line up to `MAX_TOKEN_NAME_LENGTH`) and is answered `201` with `{ "code", "url", "secret", "expiresAt", "interval" }`: a code of eight characters in two groups (`ABCD-EFGH`, from an alphabet without look-alikes) for a person to approve, the console's own page for it, a secret (`cns_c_...`) the command claims with and shows nowhere, when the request expires (ten minutes after it began), and how many seconds the command waits between claims. A deployment holds a bounded number of requests at once (`connect.too_many`).

`GET /api/v1/connect/<code>`, for a person signed in, answers what asks: `{ "code", "agent", "createdAt", "expiresAt", "approved" }`. A code is read as a person types it: any case, with or without the hyphen. `POST .../approve`, from the console's own pages, takes what `POST /api/v1/tokens` takes (`name`, `expiresInDays`) and answers the request, approved; `POST .../deny` takes the request away and answers `204`.

`POST /api/v1/connect/claim` takes `{ "secret" }` and answers `202` with `{ "status": "pending", "expiresAt" }` while nobody approved, or `200` with `{ "status": "connected", "token", "secret" }` once: the token is made then, for the approver, as any token of theirs is, and the request goes with it, so that a second claim is `connect.not_found`. Nothing secret rests in the database meanwhile: the hash of the command's secret, and never a token.

## A project

Everything below is under `/api/v1/projects/<key>`, for whoever may see the project; what changes it needs a member (with a session from the console's own pages, or a token), what configures it an owner signed in.

### `GET /api/v1/projects/<key>` and `PATCH /api/v1/projects/<key>`

The project, as the asker sees it. A patch, for an owner signed in, takes any of `name`, `description`, `visibility` and `skillsAddress` (`null` for the organization's), and writes a `project.updated` event naming the `fields`; what is already so writes nothing. The key does not change.

### `GET /api/v1/projects/<key>/members` and `POST /api/v1/projects/<key>/members`

`{ "items": [member, ...] }`: those listed in the project, by login, each a `person`, their `role` in it (`owner`, `member`) and `addedAt`. A project open to the workspace has everyone of it as a member besides; an administrator is an owner of every project, listed or not. `POST`, for an owner signed in, takes `personId` (a person of the workspace; `member.invalid_person`) and optionally `role` (default `member`), answers `201` with the member and writes `project.member_added` with `login` and `role`. A person listed already is `member.exists`.

### `PATCH /api/v1/projects/<key>/members/<person id>` and `DELETE .../members/<person id>`

For an owner signed in. The patch takes `role` and writes `project.member_changed`; the removal answers `204` and writes `project.member_removed`. A person not listed is `member.not_found`. A project may be left without an owner listed; the administrators own it then.

### `GET /api/v1/projects/<key>/tasks?state=`

`{ "items": [task, ...] }`: the project's board, newest first, at most `LIST_LIMIT` tasks; `state` keeps one state of it. A task carries its `number` (the one people say out loud, numbered per project), `title`, `body` (Markdown, to be shown as text or rendered to elements, never as HTML), `state`, `priority`, `owner`, `assignee` (a person, or `null`), `parentId`, `links` (`url` and `label`), `openDecisions` (how many decisions about it wait for a person), `openRuns` (how many agents are at work on it, or waiting), `createdAt` and `updatedAt`.

### `POST /api/v1/projects/<key>/tasks`

Takes `title`, and optionally `body`, `state` (default `idea`), `priority` (default `normal`), `assigneeId` (a person who may work in the project: everyone of the workspace for a project open to it, those listed for a private one, an administrator anywhere; `task.invalid_assignee`), `parentId` (a task of the project) and `links`. The owner is whoever writes it. Answers `201` with the task, numbered after the project's last, and writes a `task.created` event.

### `GET /api/v1/projects/<key>/tasks/<id or number>` and `PATCH .../tasks/<id>`

One task, by its id or by its number in the project (`/tasks/7`): the pages hold ids, people and their agents say numbers. A patch takes the id and names only what changes, with the same fields as a creation; a field set to `null` clears it. A change of `state` is a `task.moved` event with `from` and `to`; any other change is one `task.updated` event naming the `fields`. A patch that changes nothing writes nothing and answers the task as it is.

### `GET /api/v1/projects/<key>/decisions?open=&task=`

`{ "items": [decision, ...] }`: the project's, the ones that wait first, newest first within each; `open=true` keeps only those that wait, `task=<id>` only those about one task. A decision carries its `question`, `body` (Markdown: the context it rests on), `options` (each an `id` and a `label`), `taskId` and `taskNumber` (or `null`), `raisedBy`, `run` (the `id` and `agent` of the run that raised it, when an agent asked, or `null`), `answer`: `null` while it waits, else the chosen `option`, a `note` or `null` (the rationale given with it), `by` and `at`; and `outcome`, what followed, in Markdown, or `null` until someone writes it. Context, rationale and outcome make the decision a record ([ADR-0009](../adr/0009-documents-are-pages-of-markdown-in-a-project-addressed-by-path-versioned-and-linked-both-ways.md)); a link in any of them to a document's path is kept both ways, so that the document says the decision refers to it.

### `POST /api/v1/projects/<key>/decisions`

Takes `question`, `options` (two to `MAX_OPTIONS` labels), and optionally `body`, and either `taskId` or `runId`. Options are numbered from `1`. From a run, which must be the asker's and open (`decision.invalid_run`), the decision is about the run's task, `taskId` is not looked at, and the run waits (`status: waiting`) until the answer. Answers `201` with the decision and writes a `decision.raised` event, with the `agent` when a run asked.

### `GET .../decisions/<id>?wait=` and `POST .../decisions/<id>/answer`

One decision. With `wait=<seconds>` (`0` to `600`) the request is held while the decision waits, up to the server's own bound (50 seconds), and answers the decision as it stands then: how an agent learns the answer at once, woken through the database's own channel, without asking again and again. A decision answered already, or a wait of `0`, answers at once.

The answer takes `option` (the id of one of its options) and optionally a `note`. A decision is answered once; the answer records who gave it and when, writes a `decision.answered` event with the label of the option, and lets a run that waited go on (`status: running`), unless another decision of its still waits.

### `PATCH /api/v1/projects/<key>/decisions/<id>`

Grows the record: takes any of `body` (the context) and `outcome` (what followed; empty clears it), for anyone who may work in the project, with a session from the console's own pages or a token, answered or not. Writes a `decision.updated` event naming the `fields`; a patch that changes nothing writes nothing.

### `GET /api/v1/projects/<key>/runs?task=&open=&mine=` and `GET .../runs/<id>`

`{ "items": [run, ...] }`: the project's runs, newest first, at most `LIST_LIMIT`; `task=<id>` keeps those on one task, `open=true` those not over (`running` or `waiting`) and `open=false` those over, `mine=true` the asker's own: with a token, the runs begun with that token, which is one agent's; on a session, the runs for the person. A run is one agent at work on one task for one person: `taskId` and `taskNumber` (the one people say), `person` (whom the agent acts for), `agent` (what it calls itself), `status` (`running`, `waiting` for a decision, `finished`, `failed`, `abandoned`), `startedAt`, `endedAt` or `null`, `summary` (Markdown, what the agent said at the end, or `null`), `reports` (each `id`, `body` in Markdown, `createdAt`; oldest first), `artifacts` (each `id`, `kind`, `url` for a link or `null`, `label` or `null`, `file` for a file or `null`, and `createdAt`; a file is its `name`, `size` in bytes, `contentType` and `sha256`), and `waitingFor`, the id of the decision the run waits for, or `null`.

### `POST /api/v1/projects/<key>/runs`

Takes `taskId` (a task of the project; `run.task_not_found` otherwise), and optionally `agent` (what people see at work, `MAX_AGENT_LENGTH`; left out, the name of the token presented, or the person's login on a session). The run begins: the task becomes the asker's and `in_progress`, and the board is told (`run.started`). One agent at a time per task (`run.task_taken`); a task that is `done` or `dropped` cannot be taken (`run.task_closed`). Answers `201` with the run, whose `id` the rest take.

### `POST .../runs/<id>/reports` and `POST .../runs/<id>/artifacts`

How the work goes, and what was made. A report takes `body` (Markdown, `MAX_BODY_LENGTH`, not blank) and tells the board (`run.reported`, with the first words as `excerpt`); a link takes an https `url` and optionally a `label` (`run.handed_in`, with the label or the link's first words). Both answer `201` with the run. Only the run's person adds to it (`run.not_yours`), only while it is open (`run.over`), and only so many (`run.too_many_reports`, `run.too_many_artifacts`, counting links and files together).

### `POST .../runs/<id>/files` and `GET /api/v1/projects/<key>/files/<id>`

A file handed in, as the parts of a form (`multipart/form-data`): the part `file` carries the bytes, with the file's name and its media type; the part `label` is optional. The name is one line without a path (`MAX_FILE_NAME_LENGTH`), the file is not empty and at most `MAX_FILE_BYTES` (`request.too_large`), and a media type that is not one, or none, is `application/octet-stream`. The bytes are kept under their SHA-256, so the same file handed in twice is kept once; the artifact on the run is `kind: "file"` with `file` filled in and `url` null. Answers `201` with the run and tells the board (`run.handed_in`, with the label or the file's name). The same rules as for a link: the run's person only, while the run is open, and only so many.

The bytes are read back at `/api/v1/projects/<key>/files/<artifact id>` by whoever may see the project, with a session or a token: `content-length` and `content-disposition` name the file, the few kinds a browser may show in place (pictures, plain text, Markdown, CSV, JSON) are answered with their type and `inline`, and every other kind as `application/octet-stream` and `attachment`, never sniffed (`x-content-type-options`) and under a policy that runs nothing (`sandbox`). An id that is a link's, or nothing, or another project's, is `file.not_found`.

### `POST .../runs/<id>/end`

Takes `status` (`finished`, `failed` or `abandoned`) and optionally a `summary` (Markdown, `MAX_SUMMARY_LENGTH`: what was done and what is left), ends the run (`run.ended`), and answers it. A finished run puts a task that was `in_progress` up for review (`in_review`); the rest leave the task as it is. The run's person ends it, as `finished` or `failed` from their agent; `abandoned` is a person giving up on a run that will not come back: their own, or anyone's as an owner of the project signed in on the console's own pages, never with a token (`run.not_yours`). A run that is over is `run.over`.

### `GET /api/v1/projects/<key>/skills`

The project's skills, as the SkillCDN deployment serves them at the project's address, or at the organization's (`SKILLS_ADDRESS`) when the project names none, read through `SKILLCDN_URL`: `{ "address", "source", "page", "status", "items" }`. `address` is canonical, or `null` with `status: "none"` when neither names one; `source` is the deployment's origin and `page` where a person browses the address. `status` is `ready`, or why `items` is empty: `indexing` and `failed` as the deployment says of the repository, `not_found` when it does not serve the address to the console (which asks as nobody, so a private repository is not read), `unavailable` when it could not be reached or read. An item is one skill: `name`, `description`, `directory` and `path` (of its `SKILL.md`, from the repository's root), `page` (the skill at the deployment, for a person), `uri` (what an agent loads it by through its own SkillCDN connection, `skill://gh/<owner>/<repo>/<path>`, or `null`), and `translations` (the title and the description by language tag, as the repository gives them). The console keeps nothing of the skills: one answer per address stands for a minute, then the deployment is asked again.

### The documents

The project's pages of Markdown ([ADR-0009](../adr/0009-documents-are-pages-of-markdown-in-a-project-addressed-by-path-versioned-and-linked-both-ways.md)): each under a path of lowercase segments separated by slashes (`guides/onboarding`), which is its address and does not change; the folders are what the paths say. In every path below, the document's path is **one segment of the URL, its slashes encoded** (`/docs/guides%2Fonboarding`), which is what `projectPath(key, "docs", path)` builds. Whoever may see the project reads them; whoever may work in it writes them, with a session or a token.

#### `GET /api/v1/projects/<key>/docs?folder=&q=&archived=`

`{ "folder", "folders": [path, ...], "items": [document, ...] }`: the pages of a folder (`folder=guides`; the root when left out or empty), by title, and the folders in it, as paths, by name; at most `LIST_LIMIT` of each. With `q=<words>` (`MAX_SEARCH_LENGTH`), the pages found by their words in the title or the body, the best first, through the database's own text search and the title and the path by substring; `folder` is not looked at then, and `folders` is empty. Archived pages are left out unless `archived=true`. A page here is everything but its body: `id`, `path`, `title`, `version` (the number of the latest version, from 1), `updatedBy` and `agent` (who wrote the latest version, and the agent they wrote it through, or `null`), `archivedAt` (or `null`), `createdAt` and `updatedAt`.

#### `GET /api/v1/projects/<key>/docs/<path>`

The page in full: the fields above, `body` (Markdown, rendered to elements, never as HTML), `createdBy`, `links` (the documents it links to, each a `path` and the `title` of the page there, or `null` while none is written yet), `backlinks` (what links to it: each a `kind`, `document`, `task` or `decision`, its `id`, the document's `path` or the task's `number` or `null`, and a `title`: the document's, the task's, or the decision's question), and `files` (each an `id`, a `label` or `null`, the `file` as a run hands one in, `addedBy`, `agent` or `null`, and `createdAt`). A path that is not one, or has no page, or is in a project the asker may not see, is not found.

#### `PUT /api/v1/projects/<key>/docs/<path>`

Writes the page: takes `title`, `body` (Markdown, `MAX_DOCUMENT_LENGTH`) and optionally `baseVersion`, the version the writer started from. The first write at a path answers `201` with the page at version 1; the next ones answer `200` with the next version, each kept with who wrote it, through which agent, and when. A write that changes nothing is no version and no event. The write is refused when the page has moved on since `baseVersion` (`document.conflict`), when the page is archived (`document.archived`), and when it carries as many versions as one may (`document.too_many_versions`). Every link in the body whose destination is a document path (`guides/onboarding`, from the project's root, with or without a `#fragment`) is recorded, and the page it names, written or not yet, says so. Writes a `document.written` event with `path`, `title` and `version`.

#### `POST .../docs/<path>/archive` and `POST .../docs/<path>/restore`

Put the page away, and bring it back: archived, it is kept out of the folders and the search, readable at its path, and not written to; nothing is deleted. Each answers the page and writes `document.archived` or `document.restored`; what is already so writes nothing.

#### `GET .../docs/<path>/versions` and `GET .../docs/<path>/versions/<number>`

`{ "items": [version, ...] }`, newest first: each a `number`, the `title` as it was, the `author`, the `agent` or `null`, and `createdAt`. One version adds its `body` as it was. A page without that version is `document.version_not_found`.

#### `POST .../docs/<path>/files` and `GET .../docs/<path>/files/<id>`

A file attached to the page, sent and read back exactly as a run hands one in ([above](#post-runsidfiles-and-get-apiv1projectskeyfilesid)): the parts `file` and `label` of a form, kept under the SHA-256 of the bytes, at most `MAX_FILE_BYTES`, at most `MAX_FILES_PER_DOCUMENT` on one page (`document.too_many_files`), and none on an archived page. Answers `201` with the page and writes `document.file_attached` with the label or the file's name. The bytes are read back at the file's `id`, with the same headers and the same policy as a run's file.

### `GET /api/v1/projects/<key>/events?after=&limit=&task=&run=&decision=&document=`

`{ "items": [event, ...], "more": boolean }`: what happened in the project after event number `after` (`0` for the beginning), oldest first, at most `limit` (default and maximum `EVENTS_PAGE_LIMIT`); `more` says whether there is more after the last item. `task=<id>`, `run=<id>`, `decision=<id>` or `document=<id>` keeps the events about one of them: how a page shows everything that happened to a task, a run, a decision or a document. An event carries its `id` (the number), `kind` (one of `EVENT_KINDS`), the `actor` (a person, or, for what an agent did, the person it acts for), `agent` (what the person acted through: the run's agent for what a run did, else the name of the token presented; `null` when a person acted themselves), `projectId`, `taskId`, `decisionId`, `runId` and `documentId` (or `null`), `data` (what a feed shows without asking for the subject: `number`, `title`, `fields`, `from`, `to`, `question`, `option`, `login`, `role`, `key`, `name`, `agent`, `status`, `label`, `excerpt`, `path`, `version`, each only when the kind has it), and `createdAt`.

### `GET /api/v1/projects/<key>/events/stream?after=`

The same events as they happen, as server-sent events: one message per event, with `id` the event's number, `event` its kind and `data` the event as JSON; a comment (`: ping`) every 25 seconds of silence. A browser that reconnects sends `Last-Event-ID`, which wins over `after`, so that nothing is missed. The stream ends when the server shuts down; an `EventSource` reconnects on its own.

The feed is written in the same transaction as the change it records, so what a stream carries happened, and what happened is carried; every process of the deployment learns of a change through the database's own channel, so a board with several `api` replicas is one board.

## Signing in

Not part of the REST API, and described in [`deploy/README.md`](../../deploy/README.md#signing-in): `GET /auth/<provider>/login?return_to=` and `GET /auth/<provider>/callback` for each provider the deployment has (`gh`, `google`; any other is nothing), and `POST /auth/logout` from the console's own pages. A page learns why a sign-in did not complete from `?sign_in=denied|expired|failed|refused` on the page it was for.
