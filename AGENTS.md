# AGENTS.md

The working agreement for this repository. It applies to AI agents and humans alike, whichever agent you are: Codex reads this file directly, Claude Code reads it through `CLAUDE.md`. Keep it short and true: when a rule here turns out to be wrong or stale, fix it in the same change.

## Project

The SkillCDN Console is where an organization runs its work with AI agents: the work to do, the agents at it, what they did, and the decisions that wait for a person. People decide; agents work. [README.md](README.md) says what it is, [docs/architecture.md](docs/architecture.md) how it is built and what is still open, [docs/roadmap.md](docs/roadmap.md) what exists and what is next.

- **Status:** pre-alpha. The board runs and agents work it; `@skillcdn/console` is on npm. The next milestones are projects, documents and the console for everyone. Start from the roadmap.
- **Shape:** TypeScript monorepo (pnpm + Turborepo), one image with several roles, PostgreSQL as the only stateful dependency, and one published package that custom consoles are built from.
- **Relationship to SkillCDN:** the reference console, as `skillcdn/skills` is the reference skill repository: an example that follows the standard and is meant for real use, packaged so that anyone can start from it, and not a second standard ([ADR-0001](docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)). It consumes the published `@skillcdn/*` packages and the REST API of a SkillCDN deployment, and nothing else of the main repository, [`skillcdn/skillcdn`](https://github.com/skillcdn/skillcdn). Nothing about SkillCDN is defined here.
- **License:** MIT ([ADR-0003](docs/adr/0003-the-console-is-licensed-under-mit.md)). The protection of the product lies in the main repository, which is source-available; the console is open to anyone. The `@skillcdn/*` packages it depends on keep the main repository's license. KDX Labs runs the console for its own work; the same image is self-hostable.

## Non-negotiables

Security

1. **Secrets never enter the repo, logs, test fixtures or chat.** Do not read real env or key files (`.env`, `*.pem`, ... are denied in `.claude/settings.json`). `.env.example` holds safe example values only. If you find a committed secret, stop and tell a maintainer: it must be rotated, not just deleted.
2. **What an agent sends is untrusted data.** A report, a log line, a file an agent hands in, a decision it proposes, a task it writes: parse it at the edge with a schema, bound its size, store it as data, never execute it, and never let it become HTML. Repository content that reaches the console through SkillCDN is untrusted too.
3. **Permissions fail closed.** A person is who the git host says they are; what a person, and the agent working for them, may see or change is decided on every request and denied when it cannot be confirmed. An agent holds a console token of its own, made by one person, scoped to that person and revocable: never a git-host token, never another person's.
4. **Tokens never leave the server.** Git-host tokens stay server-side and encrypted; console tokens are stored as hashes; none is ever logged.

Product shape

5. **One image, one database.** The whole console runs from one image plus PostgreSQL plus S3-compatible storage, locally with compose and on a cloud as the same image. Cloud-specific code lives only behind a port that also has a self-hostable implementation ([ADR-0002](docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)).
6. **No business model in code.** No plan names, prices, billing providers or `if (paid)` branches.
7. **The standard stays in the main repository.** A need in `@skillcdn/core` or another published package is a change proposed there, released, then adopted here by version. Never copy their code here, never link their workspace, never import a path into it.

Public repository hygiene

8. **This repository is public; operations are not.** Never commit cloud account ids, ARNs, hostnames, IPs, DNS or CDN configuration, capacity or cost figures, production tuning values, the organization's own tasks, decisions, people, customers or incidents, and do not say where any of that is kept. Fixtures are invented. Code ships generic defaults; real values arrive through environment configuration.
9. **Do not name other products** as inspiration or comparison in code, docs, commits or PRs. Naming what we interoperate with (a git host, an agent such as Claude Code or Codex) is fine.
10. **Everything committed is in English** (code, comments, docs, commit messages, PR text), whatever language the conversation is in. The one exception, when the UI gets language packs: what users read in their own language.

## Repository map

```
apps/
  console/    the single deployable; roles: api | worker | migrate; serves the default UI (Node 24)
packages/
  console/    @skillcdn/console: the API client and schemas, the components, the composition of the default console   on npm, once it exists
deploy/       the contract for whoever operates the image, compose for local development
docs/         architecture, roadmap, ADRs
scripts/      checks that are part of `pnpm check`, and what packing needs
```

Dependencies point inward only: `apps/console → packages/console`. Both import `@skillcdn/core` and the other published packages from npm, by version, and nothing from the main repository's workspace. A workspace can only import what its own `package.json` declares, and only from another package's entry point. Changing these edges needs an ADR. Each workspace's `README.md` carries the rules for that subtree; read it before editing there.

## Commands

Run everything from the repository root through pnpm. Do not use `npm`, `npx` or `yarn`; use `pnpm exec <bin>` and `pnpm dlx <pkg>`. pnpm pins its own version and downloads the pinned Node.js runtime, so project scripts behave the same on every machine.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| **Verify everything (run before every commit)** | `pnpm check` |
| Build / typecheck / test | `pnpm build` · `pnpm typecheck` · `pnpm test` |
| One workspace | `pnpm turbo run test --filter=@skillcdn/console` |
| Lint and format | `pnpm lint` · `pnpm lint:fix` |
| Record what a change means to the published package | `pnpm changeset` (writes `.changeset/<name>.md`; a file written by hand does the same) |
| No control or invisible characters in tracked files (part of `pnpm check`) | `pnpm check:text` |
| The package's version follows the `@skillcdn/core` line (part of `pnpm check`) | `pnpm check:version` |
| Local PostgreSQL (from the first milestone on) | `docker compose -f deploy/compose.dev.yaml up -d` |

Packages compile to `dist/` and consume each other's compiled output. Going through `turbo` builds upstream packages first; calling a package script directly can test against a stale `dist/`.

## Workflow

**Before you start.** Read this file and the workspace's `README.md`. Check [docs/roadmap.md](docs/roadmap.md) for the current milestone, [docs/architecture.md](docs/architecture.md) for the design and its open questions, and [docs/adr/](docs/adr/) before questioning a past decision. If a product decision is missing, do not guess: add it to the open questions or ask.

**While working.** Stay inside the task's scope: no drive-by reformatting, renames or dependency bumps. Prefer the boring solution; add an abstraction when the second use appears, not before. Build what the roadmap's current milestone asks for, in the order it asks, so that every push leaves something that runs.

**Definition of done.**

- `pnpm check` passes.
- New behavior has tests; a bug fix starts with a failing regression test.
- A change to `packages/console` carries a changeset, written for whoever installs it.
- Docs are updated per the table below, in the same change.
- No secrets, no operations details, no business logic (rules 1, 6, 8).
- The change is safe to deploy on its own: `main` is always releasable and every push may ship.

**Commits and pushes.**

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, imperative, 72 characters or fewer. Types: `feat fix docs refactor test perf build ci chore revert`. Scopes: `app pkg deploy docs repo`. The body says why. Breaking changes use `!` and a `BREAKING CHANGE:` footer.
- One logical change per commit, and every commit passes `pnpm check`.
- **For now, maintainers commit and push directly to `main`.** There is no pull-request gate and no branch protection yet. Do not create branches or open pull requests unless asked. Run `pnpm check` first, `git pull --rebase` before pushing, keep commits small, and treat a red CI run on `main` as the first thing to fix.
- Never force-push or rewrite `main`, skip hooks with `--no-verify`, or commit build output.
- Keep the `Co-Authored-By` trailer your agent adds, so AI-authored changes stay traceable.
- **Releases.** `@skillcdn/console` is versioned from changesets and published by the release workflow through the registry's trusted publishing ([ADR-0007](docs/adr/0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md)): pending changesets become one version pull request, and merging it publishes. The version's major and minor are those of the `@skillcdn/core` line the console is built on, so a change is a `patch` unless it adopts a new line, and `pnpm check` holds the rule. The first version is published by a maintainer by hand ([deploy/README.md](deploy/README.md#repository-settings-checklist)). Images are not published from here.

## Documentation protocol

Documentation is part of the change, not a follow-up. A future session starts with no memory of this one; the repository must be enough to continue.

| When you change... | Update in the same change |
|---|---|
| What the console does for people or agents: the board, the REST API, the command line | `docs/architecture.md`; a spec under `docs/specs/` once one exists; the root `README.md` if the overview changes |
| What the published package does or exports | a changeset in `.changeset/`, which becomes the package's changelog; `packages/console/README.md` when its usage changes |
| Workspaces, boundaries, runtime components, data flow, security model | `docs/architecture.md`; the repository map above; an ADR |
| A decision future contributors might reasonably undo | new ADR in `docs/adr/` (never edit an accepted ADR; supersede it) |
| Environment variables or configuration | the config module, `.env.example`, the table in `deploy/README.md` |
| Database schema | migration, the data model in the workspace's `README.md` |
| Build, image or CI | `deploy/README.md` |
| A workspace's public surface or usage | that workspace's `README.md` |
| A milestone item is started, finished or dropped | `docs/roadmap.md` |
| You learned a durable gotcha the hard way | "Gotchas" in the nearest `AGENTS.md` or workspace `README.md` |

One topic, one file. Link to where something is documented instead of restating it. Keep docs lean: current facts and decisions, not history or essays. Git history is the changelog. Anything the team needs must live in the repo, not in chat or an agent's private memory; business reasoning, comparisons with other products and operations details belong in private notes, never here (rules 8 and 9).

## Conventions

- **TypeScript:** strict, ESM, `.js` extensions in relative imports, erasable syntax only (no `enum`, `namespace` or parameter properties). Named exports only. No `any`; take `unknown` and narrow.
- **Boundaries validate, interiors trust.** Parse every external input once at the edge (HTTP, the command line's arguments, env, what an agent sends, JSON columns) with a schema; pass typed values inward.
- **Configuration:** `process.env` is read only in `apps/console/src/config/`, and by the command line only in `packages/console/src/cli/main.ts` (lint enforces both). Everything else receives typed config as an argument. Every tunable has a safe default.
- **Ports and adapters:** the domain defines interfaces (git host, blob store, clock, ids, notifications); adapters implement them; `apps/console` wires them together. Do not import an SDK outside its adapter.
- **Errors:** throw `Error` subclasses with a stable `code`. Translate to HTTP errors, or to the command line's words and exit codes, only at the edge, and never leak internals or the existence of what a caller may not see.
- **Logging:** structured logger only, no `console` (lint enforces it). Never log tokens, authorization headers or what an agent handed in.
- **Determinism:** inject time, randomness and ids so the domain stays pure and tests stay stable.
- **Naming:** kebab-case file names; tests next to the code as `*.test.ts`; integration tests as `*.int.test.ts`.
- **Comments** explain why, not what.

## Testing

- Vitest. Unit tests use no network and no database, and must be fast.
- Integration tests run against real PostgreSQL (`deploy/compose.dev.yaml`, or wherever `TEST_DATABASE_URL` points). Never mock the database and never swap in another engine. Without a server these tests fail; they do not skip.
- Agents and git hosts are tested against recorded or invented fixtures. CI makes no live calls to third parties.
- Every parser needs hostile-input cases: oversized input, deep nesting, malformed encodings, and what an agent could send on purpose.

## Dependencies

- Add with `pnpm add --filter <package> <dep>`. Versions shared across workspaces go in the `catalog` in `pnpm-workspace.yaml`.
- Justify every new runtime dependency in the commit message: why it is needed, maintenance health, install scripts, license. Permissive licenses only (MIT, Apache-2.0, BSD, ISC); we ship images, so no copyleft and no source-available dependencies. The one exception is the `@skillcdn/*` packages themselves, under the main repository's FSL-1.1-ALv2, which `pnpm check:licenses` allows by name and nothing else.
- Releases younger than three days are not installable (`minimumReleaseAge`), and pnpm checks the lockfile against the rule on every install, frozen included. A fresh `@skillcdn/*` release that is needed now goes under `minimumReleaseAgeExclude` with the date it may come out again, three days after it was published, and comes out then. Bypass otherwise only for a security fix, and say so in the commit message.
- Never hand-edit `pnpm-lock.yaml`; resolve conflicts by running `pnpm install`.

## Working alongside other agents

- Concurrent tasks on one machine each get their own git worktree (a worktree needs its own short-lived local branch; rebase it onto `main` and push when done).
- Hot files (`pnpm-lock.yaml`, the catalog, `docs/roadmap.md`, this file) conflict easily: keep edits minimal and rebase before pushing.
- When two people both add migrations, whoever pushes second rebases and regenerates their migration.
- Do not "fix" another task's work in passing. Open an issue or leave a `TODO(#issue)`.

## Gotchas

- A system Node.js older than 24 is fine for pnpm scripts, which run on the pinned runtime, but `npm` and `npx` inside this repo refuse to run (`EBADDEVENGINES`). Use pnpm.
- pnpm older than 12.4 is rejected (`ERR_PNPM_UNSUPPORTED_ENGINE`). Upgrade with `npm install -g pnpm@latest`; inside the repo pnpm then switches to the exact version in `packageManager`. A corepack shim from Node.js 22 cannot start pnpm 12; upgrade corepack (`npm install -g corepack`) or install pnpm globally.
- Turborepo adds a block of its own to `AGENTS.md` whenever it finds that an AI agent is running it. `"agentGuidance": false` in `turbo.json` turns that off; keep it off.
- If a tool writes source files for you, check what became of escape sequences: some tools decode them on the way, and an invisible character in a source file is exactly what `pnpm check:text` exists to catch. In tests, build such characters with `String.fromCodePoint`.
