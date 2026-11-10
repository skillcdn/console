# AGENTS.md

The working agreement for this repository. It applies to AI agents and humans alike, whichever agent you are: Codex reads this file directly, Claude Code reads it through `CLAUDE.md`. Keep it short and true: when a rule here turns out to be wrong or stale, fix it in the same change.

## Project

The SkillCDN Console is where an organization runs its work with AI agents: the work to do, the agents at it, what they did, and the decisions that wait for a person. People decide; agents work. [README.md](README.md) says what it is, [docs/architecture.md](docs/architecture.md) how it is built and what is still open, [docs/roadmap.md](docs/roadmap.md) what exists and what is next.

- **Status:** pre-alpha. The board runs per project, with its rules for agents, its documents, its roadmap of goals and its calendar, the tasks planned in days and sorted into the workspace's categories; agents work it, connected with a code a person approves; the pages speak English and Korean; `@skillcdn/console` is on npm. A console of one's own is built from the package and served from a member's machine, and the console's skills, in the SkillCDN Format, say how an agent works the board, plans it, builds a console and deploys one; what is left of milestone 7 waits for a machine with other agents. Where the deployment has a bucket, the files go there through the S3 API, and `skills/deploying-a-console` puts the console on AWS behind Cloudflare for an organization ([ADR-0017](docs/adr/0017-the-reference-deployment-is-the-image-on-aws-behind-cloudflare-written-as-a-skill.md)); an organization's own deployment stays outside this repository. Plugins are built (milestone 34, 2026-11-02): a feature of an organization's work as one npm package, installed by building it into the image, enabled by an administrator, run in a host of its own under capabilities and roles, worked through `console plugin <key>` and shown in sandboxed frames ([ADR-0049](docs/adr/0049-a-plugin-is-an-npm-package-installed-into-the-image-and-enabled-by-an-administrator.md) to [ADR-0054](docs/adr/0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md)); the plugins themselves live in repositories of their own, and `skills/building-a-plugin` says how one is written. Agent accounts are being built ([ADR-0084](docs/adr/0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md) to [ADR-0089](docs/adr/0089-a-workspace-names-the-services-its-agents-work-with.md)): an agent that is a member of its own, signed in as itself; the account, its persona, its command's sign-in and its secret store exist (milestone 41), and so do its signals, its transcript and `console runner` with the `claude` driver, written from the product's documentation and not run against the binary yet, and the agent's own page (milestone 42); its invitation, the guide and `console agent setup` with the `launchd` service, not run on a Mac yet, are built (milestone 43), and the board's wakes come next. Start from the roadmap.
- **Shape:** TypeScript monorepo (pnpm + Turborepo), one image with several roles, PostgreSQL as the only stateful dependency, and one published package that custom consoles are built from.
- **Relationship to SkillCDN:** the reference console, as `skillcdn/skills` is the reference pack: an example that follows the standard and is meant for real use, packaged so that anyone can start from it, and not a second standard ([ADR-0001](docs/adr/0001-the-console-is-the-reference-console-built-on-the-published-packages.md)). It consumes the published `@skillcdn/*` packages and the REST API of a SkillCDN deployment, and nothing else of the main repository, [`skillcdn/skillcdn`](https://github.com/skillcdn/skillcdn). Nothing about SkillCDN is defined here.
- **License:** MIT ([ADR-0003](docs/adr/0003-the-console-is-licensed-under-mit.md)). The protection of the product lies in the main repository, which is source-available; the console is open to anyone. The `@skillcdn/*` packages it depends on keep the main repository's license. KDX Labs runs the console for its own work; the same image is self-hostable.

## Non-negotiables

Security

1. **Secrets never enter the repo, logs, test fixtures or chat.** Do not read real env or key files (`.env`, `*.pem`, ... are denied in `.claude/settings.json`). `.env.example` holds safe example values only. If you find a committed secret, stop and tell a maintainer: it must be rotated, not just deleted.
2. **What an agent sends is untrusted data.** A report, a log line, a file an agent hands in, a decision it proposes, a task it writes: parse it at the edge with a schema, bound its size, store it as data, never execute it, and never let it become HTML. Repository content that reaches the console through SkillCDN is untrusted too.
3. **Permissions fail closed.** A member is who the identity provider says they are, a person or an agent account alike; what a member, and the agent working for them, may see or change is decided on every request and denied when it cannot be confirmed. A person's agent holds a console token of its own, made by that person, scoped to them and revocable: never a credential of theirs elsewhere, never another member's. An agent account is a member of its own under the same rules and never an administrator, the one rule that reads its kind ([ADR-0084](docs/adr/0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md)): it signs in as itself, and what it keeps of its own, a git-host token among it, is its own and nobody else's.
4. **Credentials never leave the server in the clear.** What the console holds of a git host stays server-side and encrypted; console tokens and sessions are stored as hashes; an agent account's secrets are sealed and answered to that account alone ([ADR-0087](docs/adr/0087-an-agent-account-keeps-its-secrets-in-a-store-of-its-own-that-only-it-reads.md)); none is ever logged.

Product shape

5. **One image, one database.** The whole console runs from one image plus PostgreSQL plus S3-compatible storage, locally with compose and on a cloud as the same image. Cloud-specific code lives only behind a port that also has a self-hostable implementation ([ADR-0002](docs/adr/0002-one-image-one-database-and-the-main-repositorys-toolchain.md)).
6. **No business model in code.** No plan names, prices, billing providers or `if (paid)` branches.
7. **The standard stays in the main repository.** A need in `@skillcdn/core` or another published package is a change proposed there, released, then adopted here by version. Never copy their code here, never link their workspace, never import a path into it.

Public repository hygiene

8. **This repository is public; operations are not.** Never commit cloud account ids, ARNs, hostnames, IPs, DNS or CDN configuration, capacity or cost figures, production tuning values, the organization's own tasks, decisions, people, customers or incidents, and do not say where any of that is kept. Fixtures are invented. Code ships generic defaults; real values arrive through environment configuration.
9. **Do not name other products** as inspiration or comparison in code, docs, commits or PRs. Naming what we interoperate with (a git host, an agent such as Claude Code or Codex) is fine.
10. **Everything committed is in English** (code, comments, docs, commit messages, PR text), whatever language the conversation is in. The one exception: the language packs in `packages/console/src/i18n/`, what users read in their own language ([ADR-0012](docs/adr/0012-the-pages-speak-the-persons-language-from-packs-that-ship-with-the-package.md)); a word added to the English pack is added to every other pack in the same change.

## Repository map

```
apps/
  console/    the single deployable; roles: api | worker | migrate; serves the default UI (Node 24)
packages/
  console/    @skillcdn/console: the API client and schemas, the components, the composition of the default console   on npm, once it exists
examples/     plugin-hello, the plugin `console-plugin init` writes, built and tested as a workspace, held equal to the package's template; agent-desk, the desk an agent account is set up with, held equal to the package's template too
deploy/       the contract for whoever operates the image, compose for local development
docs/         architecture, roadmap, specs, ADRs; served with the skills
skills/       the console's skills in the SkillCDN Format, for an agent working the board, planning it, building a console or a plugin, or deploying one; SKILLCDN.md at the root is their manifest
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
| No control or invisible characters in tracked files, new files included (part of `pnpm check`) | `pnpm check:text` |
| The skills and the manifest are in the SkillCDN Format as the indexer reads it, and name commands, routes and files that exist (part of `pnpm check`) | `pnpm check:skills` |
| The package's version is on SkillCDN's line, and every `@skillcdn` package is taken at that one version (part of `pnpm check`) | `pnpm check:version` |
| The REST schemas as built break nothing of the snapshot taken at the floors: a field removed, made required or narrowed on what the command sends, widened on what it reads, fails unless the floors moved (part of `pnpm check`, after the build; [ADR-0043](docs/adr/0043-the-rest-contract-is-held-to-a-snapshot-taken-at-the-floors.md)) | `pnpm check:rest`; `pnpm snapshot:rest` takes the snapshot again, in the change that moves a floor |
| Local PostgreSQL, and a bucket with the S3 API for the tests of the blob store | `docker compose -f deploy/compose.dev.yaml up -d` |
| The plugins' frame in a real browser: what only a browser enforces of its policy and its sandbox, seen enforced (apart from `pnpm check`; CI runs it as a job of its own) | `pnpm test:browser`, once `pnpm --filter @skillcdn/console-app exec playwright install chromium` has put a Chromium on the machine |
| The console on this machine for a person to look at the plugins' pages: the default UI, the example plugin enabled, the fixtures `leave` and `gate` installed for the settings pages to have a plugin to enable, the plugins' hooks and jobs running in the process, the fixture's people signing in from the browser, a database of its own that goes with it; a built plugin of another checkout installed beside them, to enable on the settings page | `pnpm dev:plugins`, then the addresses it prints; `pnpm dev:plugins --plugin <dir>` for the plugin; `--public-url <origin>` to be reached through a tunnel and `--keep` to keep the database between runs, as `apps/console/README.md` says |

Packages compile to `dist/` and consume each other's compiled output. Going through `turbo` builds upstream packages first; calling a package script directly can test against a stale `dist/`.

## Workflow

**Bound to a console?** When `.skillcdn-console.json` is in this checkout, or `console whoami` names a project, work the task through that SkillCDN console (`console help` says how).

**Before you start.** Read this file and the workspace's `README.md`. Check [docs/roadmap.md](docs/roadmap.md) for the current milestone, [docs/architecture.md](docs/architecture.md) for the design and its open questions, and [docs/adr/](docs/adr/) before questioning a past decision. If a product decision is missing, do not guess: add it to the open questions or ask.

**While working.** Stay inside the task's scope: no drive-by reformatting, renames or dependency bumps. Prefer the boring solution; add an abstraction when the second use appears, not before. Build what the roadmap's current milestone asks for, in the order it asks, so that every push leaves something that runs.

**Definition of done.**

- `pnpm check` passes.
- New behavior has tests; a bug fix starts with a failing regression test.
- A change to `packages/console` carries a changeset, written for whoever installs it: `patch` within a line of SkillCDN, its entry starting with `Breaking:` where it changes what exists; `minor` only to adopt the next line of SkillCDN; never `major` while the major is 0 ([ADR-0034](docs/adr/0034-the-package-is-versioned-on-skillcdns-line-one-line-at-a-time-with-a-patch-of-its-own.md)).
- Docs are updated per the table below, in the same change.
- No secrets, no operations details, no business logic (rules 1, 6, 8).
- The change is safe to deploy on its own: `main` is always releasable and every push may ship.

**Commits and pushes.**

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, imperative, 72 characters or fewer. Types: `feat fix docs refactor test perf build ci chore revert`. Scopes: `app pkg deploy docs repo`. The body says why. Breaking changes use `!` and a `BREAKING CHANGE:` footer.
- One logical change per commit, and every commit passes `pnpm check`.
- **For now, maintainers commit and push directly to `main`.** There is no pull-request gate and no branch protection yet. Do not create branches or open pull requests unless asked. Run `pnpm check` first, `git pull --rebase` before pushing, keep commits small, and treat a red CI run on `main` as the first thing to fix.
- Never force-push or rewrite `main`, skip hooks with `--no-verify`, or commit build output.
- Keep the `Co-Authored-By` trailer your agent adds, so AI-authored changes stay traceable.
- **Releases.** `@skillcdn/console` is versioned from changesets and published by the release workflow through the registry's trusted publishing ([ADR-0007](docs/adr/0007-the-package-is-published-through-trusted-publishing-and-versioned-on-the-core-line.md)): pending changesets become one version pull request, and merging it publishes. The version's major and minor are SkillCDN's, the one version of the main repository's packages the console is built on, declared in every manifest and resolved by the lockfile, and its patch the console's own; the lines are adopted in order, one `minor` each, and `pnpm check` holds the rule ([ADR-0034](docs/adr/0034-the-package-is-versioned-on-skillcdns-line-one-line-at-a-time-with-a-patch-of-its-own.md)). The first version is published by a maintainer by hand ([deploy/README.md](deploy/README.md#repository-settings-checklist)). Images are not published from here.

## Documentation protocol

Documentation is part of the change, not a follow-up. A future session starts with no memory of this one; the repository must be enough to continue.

| When you change... | Update in the same change |
|---|---|
| What the console does for people or agents: the board, the REST API, the command line | `docs/architecture.md`; the spec under `docs/specs/`; the root `README.md` if the overview changes; and the skills under `skills/` that name what changed, read again by hand: `pnpm check:skills` catches a command, a route or a file that is gone, never a meaning that changed |
| What the published package does or exports | a changeset in `.changeset/`, which becomes the package's changelog; `packages/console/README.md` when its usage changes; `skills/building-a-console/SKILL.md` where it says how a console is built |
| A skill or the manifest (`skills/`, `SKILLCDN.md`) | `pnpm check:skills` passes; a word for people in `skillcdn.translations` in every language the manifest has; the package carries them as they are ([ADR-0015](docs/adr/0015-the-consoles-skills-live-in-this-repository-in-the-skillcdn-format-and-the-package-carries-them.md)) |
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
- **Ports and adapters:** the domain defines interfaces (git host, blob store, clock, ids); adapters implement them; `apps/console` wires them together. Do not import an SDK outside its adapter.
- **Errors:** throw `Error` subclasses with a stable `code`. Translate to HTTP errors, or to the command line's words and exit codes, only at the edge, and never leak internals or the existence of what a caller may not see.
- **Logging:** structured logger only, no `console` (lint enforces it). Never log tokens, authorization headers or what an agent handed in.
- **Attribution:** a record that names the person who did something names the agent they did it through (`agent`: the token's name, or `null` when they did it themselves) and the plugin where one acted, as every event does ([ADR-0056](docs/adr/0056-a-record-that-names-the-person-who-did-a-thing-names-the-agent-they-did-it-through.md)). A record of what an act was about, a member or a worker, names no agent; the feed names who added them.
- **Determinism:** inject time, randomness and ids so the domain stays pure and tests stay stable.
- **Naming:** kebab-case file names; tests next to the code as `*.test.ts`; integration tests as `*.int.test.ts`.
- **Comments** explain why, not what.

## Testing

- Vitest. Unit tests use no network and no database, and must be fast.
- Integration tests run against real PostgreSQL (`deploy/compose.dev.yaml`, or wherever `TEST_DATABASE_URL` points) and, for the blob store, against a real store with the S3 API (the same compose file, or wherever `TEST_S3_URL` points). Never mock the database and never swap in another engine. Without a server these tests fail; they do not skip.
- Browser tests (`*.browser.test.ts`) drive a real Chromium with Playwright against the app listening on this machine, for what only a browser enforces: the policy and the sandbox of a plugin's frame. They are `pnpm test:browser`, apart from `pnpm check` and from `vitest run`, and CI runs them as a job of its own; what they see enforced, an integration test proves of the headers first.
- Agents and git hosts are tested against recorded or invented fixtures. CI makes no live calls to third parties.
- Every parser needs hostile-input cases: oversized input, deep nesting, malformed encodings, and what an agent could send on purpose.

## Dependencies

- Add with `pnpm add --filter <package> <dep>`. Versions shared across workspaces go in the `catalog` in `pnpm-workspace.yaml`.
- Justify every new runtime dependency in the commit message: why it is needed, maintenance health, install scripts, license. Permissive licenses only (MIT, Apache-2.0, BSD, ISC); we ship images, so no copyleft and no source-available dependencies. The one exception is the `@skillcdn/*` packages themselves, under the main repository's FSL-1.1-ALv2, which `pnpm check:licenses` allows by name and nothing else.
- Releases younger than three days are not installable (`minimumReleaseAge`), and pnpm checks the lockfile against the rule on every install, frozen included. The packages this organization publishes itself, `@skillcdn/*`, are excluded as a pattern (`minimumReleaseAgeExclude`): a fresh release of theirs is adopted at once, and the risk the rule guards against is in everything else, which waits. Bypass otherwise only for a security fix, and say so in the commit message.
- Dependabot proposes the updates ([`.github/dependabot.yml`](.github/dependabot.yml)): weekly, in groups (the toolchain; the runtime's minors and patches; the actions; the images), under a cooldown of the same three days. It leaves alone `@skillcdn/*`, since a line of SkillCDN is adopted by decision ([ADR-0034](docs/adr/0034-the-package-is-versioned-on-skillcdns-line-one-line-at-a-time-with-a-patch-of-its-own.md)), `zod`, which follows `@skillcdn/core` (see Gotchas), and the majors of Node.js, `@types/node` and PostgreSQL, which move by hand. A proposal is a change like any other: `pnpm check` runs on it, and it is merged when green.
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
- The secret scan in CI (gitleaks) reads the whole history, and a test fixture shaped like a private key (`-----BEGIN ... PRIVATE KEY-----` with a body) trips it in every commit it is in. Build such a fixture from parts, or generate a key in the test; a finding that slipped into the history is named by its fingerprint in `.gitleaksignore`, since `main` is never rewritten.
- The front-matter of a `SKILL.md` or of `SKILLCDN.md` is YAML: a plain value with `: ` in it, or one that starts with `[`, `{`, `&`, `*`, `!`, `%`, `@` or a backtick, reads as something else, and the skill is skipped or served with half its description. Quote such a value. `skillcdn check` says so before a push.
- `zod` must resolve to one copy across the workspace and `@skillcdn/core`, or the package's build fails with TS2883 on every schema composed from core's (`restSkillsSchema` and its kind): the declarations cannot name the other copy's types. After raising `zod`, or when a `@skillcdn` release moves it, run `pnpm dedupe` and commit the lockfile, then `pnpm clean` before the next build: the incremental build state in `dist/` still names the old copy, and the error outlives the fix.
- An integration test run that is killed (a crash, a Ctrl-C) leaves its `console_test_<hex>` database in the local PostgreSQL, and a role a plugin test made keeps objects there, so that `sql.int.test.ts` then fails to drop the role. Drop every `console_test_%` database (`with (force)`) and the role `plugin_tallytest`; nothing else uses them.
- The browser the tests drive blocks no window a page opens on its own, in the headless shell and in the full build alike, and whatever a test asks of a page (`evaluate`, the checks a click makes) hands a user activation to every frame of it, the sandboxed ones included. A test of what a press allows can hold only what a frame notes on its own, left alone past the five seconds a press lasts, as the `call` fixture's page does; what a browser does with a press elsewhere is not seen there.
- `apps/console` compiles without the DOM lib, so a browser test (`*.browser.test.ts`) that names `document` or `window` in a `page.evaluate` callback fails `pnpm typecheck` while passing under vitest, which does not typecheck. Hand `page.evaluate` the expression as a string, as the existing tests do, and keep `fetch` callbacks, which Node types. The console's own policy refuses a string evaluated in the page itself (`script-src 'self'`, no `unsafe-eval`), so `page.waitForFunction` given a string fails there: wait from the test, with `expect.poll(() => page.evaluate(...))`.
- `pnpm check` runs no browser test and CI's browser job does: a change to the shell, to a plugin's frame or to what the frame is told (`init`) has turned `main` red with `pnpm check` green. Run `pnpm test:browser` before pushing one.
