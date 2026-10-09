<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/console</h1>
<p align="center">What a custom SkillCDN console is built from: the API client and schemas, the components, the composition of the default console, and the <code>console</code> command agents work the board with.</p>
<p align="center">
  <a href="https://github.com/skillcdn/console/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/console/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/console/blob/main/LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3a6dd4"></a>
</p>

**Not published yet.** The package exists so that the console's own UI and any custom console share one source; the first version is published when the third milestone of [the roadmap](https://github.com/skillcdn/console/blob/main/docs/roadmap.md) lands. All three layers are here, and the command: the contract of the REST API, the components, the composition of the default console, and `console`, what an agent works the board with.

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

- **The vocabulary:** `TASK_STATES`, `TASK_PRIORITIES`, `RUN_STATUSES`, `EVENT_KINDS`, with their types. One source for the database's constraints, the schemas and the board.
- **The bounds** every input is held to (`MAX_TITLE_LENGTH`, `MAX_BODY_LENGTH`, `MAX_OPTIONS`, ...), so that a page can say so before a request is made.
- **The routes:** `REST_ROUTES`, `AUTH_ROUTES`, and the helpers that build a path (`restPath`, `loginPath`, `signInPath`). The API itself is described in [docs/specs/rest.md](https://github.com/skillcdn/console/blob/main/docs/specs/rest.md).
- **The schemas,** in the mini build of zod, which runs in a browser: what the server answers (`restTaskSchema`, `restDecisionSchema`, `restEventSchema`, `restMeSchema`, ...) and what it is sent (`restTaskInputSchema`, `restTaskPatchSchema`, `restDecisionInputSchema`, `restAnswerInputSchema`). Absent values are `null` on the wire, never missing keys. The server validates with the input schemas and is tested against the others.
- **The client:** `createClient({ baseUrl, fetch })` answers typed values parsed with those schemas, and throws an `ApiError` with the server's stable `code` (or `network`, `invalid_response`) for anything else. It takes a `fetch` and reads nothing else. With `token`, a token a person made on their Tokens page, every request carries `Authorization: Bearer` and no cookie: how a script or a console of a person's own acts as that person. An `EventSource` cannot carry a header, so a stream read with a token is a `fetch` of `eventStreamUrl(after)`.

### The command line

```sh
npm install -g @skillcdn/console                 # where the agent runs, once the package is published
console login --url https://console.example      # asks for a token made on the Tokens page, and keeps it
console take 7                                   # a run begins on task #7, for the person the token is
console report "Found the cause: the parser trusts its input."
console ask "Keep the old behaviour?" --option "Keep it" --option "Change it"
console finish --summary "Done: the parser refuses empty input."
```

- **`console`** is the agent's side of the console ([docs/specs/cli.md](https://github.com/skillcdn/console/blob/main/docs/specs/cli.md)): a thin client of the REST API with no logic of its own, no dependencies beyond the package's, and no cost to an agent until it is used. `console help` says everything an agent needs; `--json` answers with the console's own JSON; the exit code says whether the console did it (`0`), refused or could not be reached (`1`), did not understand (`2`), or a decision still waits (`3`).
- **A person signs it in once:** `login` checks the token against the console and keeps it, with the console's address, in `$XDG_CONFIG_HOME/skillcdn-console/credentials.json` (`~/.config` when unset). `CONSOLE_URL` and `CONSOLE_TOKEN` in the environment win over the file, for a hook or a job. A token is never taken on the command line.
- **`@skillcdn/console/cli`** exports `runCli(argv, io)`, the command as a function that takes its environment, its streams, its `fetch` and its credential store: what the integration tests run against the app with no socket, and what a console of a person's own could embed.

### The components and the composition

```tsx
import { createConsole } from "@skillcdn/console";
import "@skillcdn/console/console.css";

createConsole({
  title: "Acme", // until the server says what the board is called
  components: { SignIn: MySignIn }, // any of Shell, Board, TaskView, DecisionList, EventFeed, SignIn, TokenList, PeopleList
}).mount(document.getElementById("root"));
```

- **The components** take their data as props and nothing from the network: `Board` (one column per state), `TaskCard`, `TaskView` (one task with its decisions and its parts), `TaskForm`, `DecisionList` and `DecisionCard` (the waiting first, each with the way to answer), `DecisionForm`, `EventFeed` (a sentence per event, newest first; `describeEvent` makes the sentence), `Shell` (the header with the pages and the person), `SignIn` (one button per provider the deployment offers), `TokenList`, `TokenForm` and `NewToken` (the tokens a person holds, the way to make one, and the one just made with its secret shown once), `PeopleList` (everyone, with what each is, and the way for an administrator to change it), `RunList` and `RunCard` (an agent at work on a task: what it reported, what it handed in, what it waits for; `RunStatusBadge` and `RUN_STATUS_LABELS` with them), and `Markdown`, which renders what people and agents wrote as elements, never as HTML, with links to the web only and pictures over https only. The small blocks (`Button`, `Badge`, `Avatar`, `PersonChip`, `Callout`, `EmptyState`, `Spinner`, `Time`) and the words of the vocabulary (`STATE_LABELS`, `PRIORITY_LABELS`, `ROLE_LABELS`, with `RoleBadge`) are exported too.
- **The composition:** `createConsole(config)` returns `{ App, mount }`. `App` is the whole console as one component; `mount(container)` renders it and returns the way to take it down. `config.baseUrl` is the origin of the API (the page's own when left out), `config.components` the pieces to replace (`ConsoleComponents` names them with the props each takes), `config.client` a client of your own, for tests. The pages route in the browser (`matchRoute`, `PATHS`, `taskHref`); the data is loaded whole and kept current by the server's stream (`useConsoleData`, for a composition of your own).
- **The styles** are one file, `@skillcdn/console/console.css`: the tokens (`--sc-*`), a small reset, and one class per block, all prefixed `sc-`. Re-skinning starts and mostly ends with the tokens.
- React 19 is a peer dependency; `react-markdown` and `remark-gfm` are the package's own.

A custom console is a small repository that depends on this package, holds a configuration and a CI job, and builds to static files served next to any console API, or into an image of its own. Nothing of the server is in the package.

## Rules

Read the root [`AGENTS.md`](../../AGENTS.md) first. This package is what other people install; it is their contract.

- **Pure where it can be.** The schemas and the components do no I/O; the client takes a `fetch` and a base URL; the command takes everything it needs through `runCli`. Nothing here reads the environment but the command's entry point, `src/cli/main.ts`, the one place the process is read (lint enforces it).
- **The main repository's packages come from npm,** by version: `@skillcdn/core` for addresses and the REST schemas of a SkillCDN deployment. Never a path into the main repository, never a copy of its code ([ADR-0001](../../docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)).
- **Exported types are public contract.** A change to what `src/index.ts` exports carries a changeset written for whoever installs the package, and the README changes with the usage.
- **Runtime dependencies need a reason.** This package ships to browsers; a dependency here needs a stronger case than anywhere else in the repository.
