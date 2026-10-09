<p align="center">
  <a href="https://skillcdn.ai"><img alt="SkillCDN" src="https://raw.githubusercontent.com/skillcdn/skillcdn/main/apps/web/public/brand/symbol.svg" width="72"></a>
</p>
<h1 align="center">@skillcdn/console</h1>
<p align="center">What a custom SkillCDN console is built from: the API client and schemas, the components, and the composition of the default console.</p>
<p align="center">
  <a href="https://github.com/skillcdn/console/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skillcdn/console/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/skillcdn/console/blob/main/LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3a6dd4"></a>
</p>

**Not published yet.** The package exists so that the console's own UI and any custom console share one source; its layers arrive with the milestones of [the roadmap](https://github.com/skillcdn/console/blob/main/docs/roadmap.md), and the first version is published when the third one lands. What it exports today is the vocabulary: the states of a task and of a run.

## What it will export

| Layer | What it is for |
|---|---|
| The schemas and the client of the console's REST API | A custom UI talks to any console with types, and the contract has one source, shared with the server in `apps/console`. |
| The components: the board, a task, a run, a decision, the live feed | Each takes its data as props and nothing from the network. |
| `createConsole(config)` | The default console assembled from the components, with the places a team may replace named. The UI the image serves is this, with the default configuration. |

A custom console is a small repository that depends on this package, holds a configuration and a CI job, and builds to static files served next to any console API, or into an image of its own. Nothing of the server is in the package.

## Rules

Read the root [`AGENTS.md`](../../AGENTS.md) first. This package is what other people install; it is their contract.

- **Pure where it can be.** The schemas and the components do no I/O; the client takes a `fetch` and a base URL. Nothing here reads the environment.
- **The main repository's packages come from npm,** by version: `@skillcdn/core` for addresses and the REST schemas of a SkillCDN deployment. Never a path into the main repository, never a copy of its code ([ADR-0001](../../docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)).
- **Exported types are public contract.** A change to what `src/index.ts` exports carries a changeset written for whoever installs the package, and the README changes with the usage.
- **Runtime dependencies need a reason.** This package ships to browsers; a dependency here needs a stronger case than anywhere else in the repository.
