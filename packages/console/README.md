<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/console</h1>
<p align="center">What a custom SkillCDN console is built from: the API client and schemas, the components, and the composition of the default console.</p>
<p align="center">
  <a href="https://github.com/skillcdn/console/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/console/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/console/blob/main/LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3a6dd4"></a>
</p>

**Not published yet.** The package exists so that the console's own UI and any custom console share one source; its layers arrive with the milestones of [the roadmap](https://github.com/skillcdn/console/blob/main/docs/roadmap.md), and the first version is published when the third one lands. What it exports today is the first layer: the contract of the console's REST API.

## What it exports

| Layer | What it is for | Status |
|---|---|---|
| The schemas and the client of the console's REST API | A custom UI talks to any console with types, and the contract has one source, shared with the server in `apps/console`. Also on its own at `@skillcdn/console/api`, which brings no React with it. | exported |
| The components: the board, a task, a run, a decision, the live feed | Each takes its data as props and nothing from the network. | not yet |
| `createConsole(config)` | The default console assembled from the components, with the places a team may replace named. The UI the image serves is this, with the default configuration. | not yet |

### The API layer

```ts
import { createClient, restTaskSchema, TASK_STATES } from "@skillcdn/console/api";

const client = createClient({ baseUrl: "https://console.example" }); // the page's own origin when left out
const { items } = await client.tasks({ state: "ready" });
```

- **The vocabulary:** `TASK_STATES`, `TASK_PRIORITIES`, `RUN_STATUSES`, `EVENT_KINDS`, with their types. One source for the database's constraints, the schemas and the board.
- **The bounds** every input is held to (`MAX_TITLE_LENGTH`, `MAX_BODY_LENGTH`, `MAX_OPTIONS`, ...), so that a page can say so before a request is made.
- **The routes:** `REST_ROUTES`, `AUTH_ROUTES`, and the helpers that build a path (`restPath`, `loginPath`, `signInPath`).
- **The schemas,** in the mini build of zod, which runs in a browser: what the server answers (`restTaskSchema`, `restDecisionSchema`, `restEventSchema`, `restMeSchema`, ...) and what it is sent (`restTaskInputSchema`, `restTaskPatchSchema`, `restDecisionInputSchema`, `restAnswerInputSchema`). Absent values are `null` on the wire, never missing keys. The server validates with the input schemas and is tested against the others.
- **The client:** `createClient({ baseUrl, fetch })` answers typed values parsed with those schemas, and throws an `ApiError` with the server's stable `code` (or `network`, `invalid_response`) for anything else. It takes a `fetch` and reads nothing else.

A custom console is a small repository that depends on this package, holds a configuration and a CI job, and builds to static files served next to any console API, or into an image of its own. Nothing of the server is in the package.

## Rules

Read the root [`AGENTS.md`](../../AGENTS.md) first. This package is what other people install; it is their contract.

- **Pure where it can be.** The schemas and the components do no I/O; the client takes a `fetch` and a base URL. Nothing here reads the environment.
- **The main repository's packages come from npm,** by version: `@skillcdn/core` for addresses and the REST schemas of a SkillCDN deployment. Never a path into the main repository, never a copy of its code ([ADR-0001](../../docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)).
- **Exported types are public contract.** A change to what `src/index.ts` exports carries a changeset written for whoever installs the package, and the README changes with the usage.
- **Runtime dependencies need a reason.** This package ships to browsers; a dependency here needs a stronger case than anywhere else in the repository.
