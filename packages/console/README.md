<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/packages/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/console</h1>
<p align="center">What a custom SkillCDN console is built from: the API client and schemas, the components, the composition of the default console, and the <code>console</code> command agents work the board with.</p>
<p align="center">
  <a href="https://github.com/skillcdn/console/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/console/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/console/blob/main/LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3a6dd4"></a>
</p>

**Pre-1.0.** Published from `main` by the release workflow, from changesets, through the registry's trusted publishing; the version's major and minor are those of the `@skillcdn/core` line the console is built on, its patch the console's own, and the changelog says what each release changed ([ADR-0007](https://github.com/skillcdn/console/blob/main/docs/adr/0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md)). All three layers are here, and the command: the contract of the REST API, the components, the composition of the default console, and `console`, what an agent works the board with.

## What it exports

| Layer | What it is for | Status |
|---|---|---|
| The schemas and the client of the console's REST API | A custom UI talks to any console with types, and the contract has one source, shared with the server in `apps/console`. Also on its own at `@skillcdn/console/api`, which brings no React with it. | exported |
| The `console` command | The agent's side of the console: a thin client of the REST API, shipped as the package's `bin`, which a person signs in once with a token. Also as a function at `@skillcdn/console/cli`. | exported |
| The components: the board, a task, a run, a decision, the live feed | Each takes its data as props and nothing from the network. | exported |
| `createConsole(config)` | The default console assembled from the components, with the places a team may replace named. The UI the image serves is this, with the default configuration. | exported |

### The API layer

```ts
import { createClient, restTaskSchema, TASK_STATES } from "@skillcdn/console/api";

const client = createClient({ baseUrl: "https://console.example" }); // the page's own origin when left out
const { items } = await client.tasks({ state: "ready" });
```

- **The vocabulary:** `TASK_STATES`, `TASK_PRIORITIES`, `RUN_STATUSES`, `EVENT_KINDS`, `LINK_SOURCES`, with their types. One source for the database's constraints, the schemas and the board. With them, the rule of a document's path and of the links a text makes: `isDocumentPath`, `documentPathsIn`, `folderOf`, `nameOf`, `foldersAbove`, which the server records links by and the pages render them by.
- **The bounds** every input is held to (`MAX_TITLE_LENGTH`, `MAX_BODY_LENGTH`, `MAX_OPTIONS`, ...), so that a page can say so before a request is made.
- **The routes:** `REST_ROUTES` (the workspace's resources), `AUTH_ROUTES`, and the helpers that build a path (`projectPath(key, collection, id)` for everything under a project, `restPath`, `loginPath`, `signInPath`). The API itself is described in [docs/specs/rest.md](https://github.com/skillcdn/console/blob/main/docs/specs/rest.md).
- **The schemas,** in the mini build of zod, which runs in a browser: what the server answers (`restProjectSchema`, `restMemberSchema`, `restTaskSchema`, `restDecisionSchema`, `restEventSchema`, `restMeSchema`, ...) and what it is sent (`restProjectInputSchema`, `restTaskInputSchema`, `restTaskPatchSchema`, `restDecisionInputSchema`, `restAnswerInputSchema`, ...). Absent values are `null` on the wire, never missing keys. The server validates with the input schemas and is tested against the others.
- **The client:** `createClient({ baseUrl, fetch })` answers typed values parsed with those schemas, and throws an `ApiError` with the server's stable `code` (or `network`, `invalid_response`) for anything else. It takes a `fetch` and reads nothing else. With `token`, a token a person made on their Agents page, every request carries `Authorization: Bearer` and no cookie: how a script or a console of a person's own acts as that person. The board is a project's: `client.projects()` lists those the person may see, and `client.project(key)` is the client of one, with its tasks, decisions, runs, files, events, skills, documents, settings and members. The documents go by path: `documents({ folder })` lists a folder, `documents({ q })` finds pages by their words, `document(path)` reads one with its links both ways and its files, `writeDocument(path, { title, body, baseVersion })` writes a version, `archiveDocument`, `restoreDocument`, `documentVersions`, `documentVersion(path, n)`, `attachFile(path, upload)` and `documentFileUrl(path, id)` do the rest; `updateDecision(id, { outcome })` grows a decision's record. `connect`, `connectRequest`, `approveConnection`, `denyConnection` and `claimConnection` are the two sides of an agent connecting with a code a person approves (ADR-0011), and `personTokens` and `revokePersonToken` an administrator's sight of everyone's agents. An `EventSource` cannot carry a header, so a stream read with a token is a `fetch` of `eventStreamUrl(after)`. `handInFile` sends a file as a form, and `fileUrl` says where its bytes are read back. `events(after, { task })` is everything that happened to one task.

### The command line

```sh
npm install -g @skillcdn/console                 # where the agent runs
console login --url https://console.example      # shows an address and a code; a person approves, and the token arrives here
console use web                                  # the project this directory works in; .skillcdn-console.json, committed
console take 7                                   # a run begins on task #7 of the project, for the person the token is
console report "Found the cause: the parser trusts its input."
console hand-in ./report.md --label "the report"  # a file the console keeps, or an https link
console skills                                   # the project's skills, with the URI to load each by
console ask "Keep the old behaviour?" --option "Keep it" --option "Change it"
console write notes/parser --title "The parser" --file notes.md   # a page of the project's documents, by path
console doc guides/onboarding                     # a page in full, with what refers to it
console finish --summary "Done: the parser refuses empty input."
```

- **`console`** is the agent's side of the console ([docs/specs/cli.md](https://github.com/skillcdn/console/blob/main/docs/specs/cli.md)): a thin client of the REST API with no logic of its own, no dependencies beyond the package's, and no cost to an agent until it is used. `console help` says everything an agent needs and `console --version` which version this is; `--json` answers with the console's own JSON; the exit code says whether the console did it (`0`), refused or could not be reached (`1`), did not understand (`2`), or a decision still waits (`3`).
- **A person signs it in once:** `login` checks the token against the console and keeps it, with the console's address, in `$XDG_CONFIG_HOME/skillcdn-console/credentials.json` (`~/.config` when unset). `CONSOLE_URL` and `CONSOLE_TOKEN` in the environment win over the file, for a hook or a job. A token is never taken on the command line.
- **The project's documents** are the agent's to read and write: `docs`, `doc`, `write`, `attach`, `archive` and `restore`, by path; a link in a body to a page's path refers to the page.
- **Every command on the board works in one project:** `--project <key>`, else `CONSOLE_PROJECT`, else what `console use <key>` wrote to `.skillcdn-console.json` in the working directory or one above it, a file meant to be committed. `console projects` lists the projects the person may work in.
- **`@skillcdn/console/cli`** exports `runCli(argv, io)`, the command as a function that takes its environment, its streams, its `fetch` and its credential store: what the integration tests run against the app with no socket, and what a console of a person's own could embed.

### The components and the composition

```tsx
import { createConsole } from "@skillcdn/console";
import "@skillcdn/console/console.css";

createConsole({
  title: "Acme", // until the server says what the board is called
  components: { SignIn: MySignIn }, // any of Shell, Board, TaskView, DecisionList, EventFeed, SignIn, TokenList, PeopleList, SkillList, ProjectList, MemberList
}).mount(document.getElementById("root"));
```

- **The components** take their data as props and nothing from the network: `Board` (one column per state), `TaskCard`, `TaskView` (one task with its decisions and its parts), `TaskForm`, `DecisionList` and `DecisionCard` (the waiting first, each with the way to answer), `DecisionForm`, `EventFeed` (a sentence per event, newest first; `describeEvent` makes the sentence), `Shell` (the header with the workspace, the project, the tabs of the pages and the person's menu), `SignIn` (one button per provider the deployment offers), `TokenList`, `TokenForm` and `NewToken` (the agents a person connected, as the tokens they hold, the way to make one by hand, and the one just made with its secret shown once), `ConnectCodeForm`, `ConnectApproval` and `ConnectWords` (an agent connecting with a code: where the code is typed, what asks under it with the way to approve or refuse it, and what to tell the agent; `ConnectPage` composes the first two for a code), `PeopleList` (everyone, with what each is, and the way for an administrator to change it), `ProjectList`, `ProjectForm` and `MemberList` (the projects a person may see with what they are in each, the way to make or change one, and those listed in a project with the way for an owner to add, change and remove them; `ProjectRoleBadge`, `PROJECT_ROLE_LABELS`, `VISIBILITY_LABELS` and `keyOf` with them), `SkillList` (a project's skills as SkillCDN serves them at its address, each with where a person reads it and what an agent loads it by), `FolderView`, `DocumentList`, `DocumentSearch`, `DocumentView`, `DocumentForm`, `DocumentFiles` and `DocumentCrumbs` (a project's documents: a folder's folders and pages, the way to find pages by their words, one page with its versions, what it links to, what refers to it and its files, and the forms to write and attach; `DocsPage` composes them for a path), `RunList` and `RunCard` (an agent at work on a task: what it reported, what it handed in, links and files alike, what it waits for; `RunStatusBadge` and `RUN_STATUS_LABELS` with them, and `fileHref` for where a file is read), and `Markdown`, which renders what people and agents wrote as elements, never as HTML, with links to the web only and pictures over https only, and, given `docHref`, a link to a page's path as a link to the page. `DecisionCard` reads as a record, with the context, the rationale and what followed, which `onUpdate` lets a person write. The small blocks (`Button`, `Badge`, `Avatar`, `PersonChip`, `Callout`, `EmptyState`, `Spinner`, `Time`) and the words of the vocabulary (`STATE_LABELS`, `PRIORITY_LABELS`, `ROLE_LABELS`, with `RoleBadge`) are exported too.
- **The composition:** `createConsole(config)` returns `{ App, mount }`. `App` is the whole console as one component; `mount(container)` renders it and returns the way to take it down. `config.baseUrl` is the origin of the API (the page's own when left out), `config.components` the pieces to replace (`ConsoleComponents` names them with the props each takes), `config.languages` the packs the pages speak, `config.brand` the addresses of a symbol and a wordmark to show beside the name (ADR-0013; the default console passes those of `@skillcdn/brand`, the main repository's package of its marks), `config.client` a client of your own, for tests. The SkillCDN name and marks are trademarks of KDX Labs under the main repository's trademark policy, not under this package's MIT license; a custom console brings its own marks through the same slot. The pages route in the browser and every form has an address (ADR-0010): the projects at `/`, a project's pages under `/projects/<key>`, a task by its number, a decision by its id, a document by its path, and the query for how a page is shown (`matchRoute(pathname, search)`, `PATHS`, `projectHref`, `taskHref`, `decisionHref`, `docHref`, `newTaskHref`, `newDecisionHref`, and `movedFrom` for the addresses of before); every link to one of them is followed in place, with one history entry per step; the workspace is loaded once and the project the page is on whole, kept current by the project's stream (`useConsoleData(client, projectKey)`, for a composition of your own).
- **The languages:** every word the pages show is in a pack (`Messages`, keyed as `en` is), English and Korean ship (`ENGLISH`, `KOREAN`, `DEFAULT_LANGUAGES`), and a component takes its words from the language above it (`useWords`, `useLanguage`, `LanguageContext`), English where there is none. The person's choice is kept on them (`client.updateMe({ language })`) and the browser's languages decide before one (`chooseLanguage`, `packFor`). `createConsole({ languages })` replaces the packs the default console speaks, so that a custom console adds a language of its own; a pack is complete by type.
- **The styles** are one file, `@skillcdn/console/console.css`: the tokens (`--sc-*`), a small reset, and one class per block, all prefixed `sc-`. The look is SkillCDN's own: dark only, one accent, the page a dark field with a light in it (the shell, `sc-shell`, paints it) and the surfaces panes of glass over it (`--sc-glass-*`). Re-skinning starts and mostly ends with the tokens; a custom console that wants a flat page sets the field's colours to one and the glass to none. The faces are the page's to provide: the stylesheet names Pretendard first for the Korean and falls through to the system's faces, and the default console loads it; a custom console loads what it likes.
- React 19 is a peer dependency; `react-markdown` and `remark-gfm` are the package's own.

A custom console is a small repository that depends on this package, holds a configuration and a CI job, and builds to static files served next to any console API, or into an image of its own. Nothing of the server is in the package.

## Rules

Read the root [`AGENTS.md`](../../AGENTS.md) first. This package is what other people install; it is their contract.

- **Pure where it can be.** The schemas and the components do no I/O; the client takes a `fetch` and a base URL; the command takes everything it needs through `runCli`. Nothing here reads the environment but the command's entry point, `src/cli/main.ts`, the one place the process is read (lint enforces it).
- **The main repository's packages come from npm,** by version: `@skillcdn/core` for addresses and the REST schemas of a SkillCDN deployment. Never a path into the main repository, never a copy of its code ([ADR-0001](../../docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)).
- **Exported types are public contract.** A change to what `src/index.ts` exports carries a changeset written for whoever installs the package, and the README changes with the usage.
- **Runtime dependencies need a reason.** This package ships to browsers; a dependency here needs a stronger case than anywhere else in the repository.
