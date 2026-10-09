# ADR-0007: The package is published through trusted publishing, and its version follows the `@skillcdn/core` line it is built on

- Status: Accepted
- Date: 2026-10-10
- Amends: [ADR-0002](0002-one-image-one-database-and-the-main-repositorys-toolchain.md) (the one workflow that publishes anything)

## Context

The console has one versioned artifact: `@skillcdn/console`, which a machine installs to get the `console` command and a team builds a custom console from. The image has no version of its own; a deployment pins a commit, as the main repository's server does (ADR-0002). The package is built on `@skillcdn/core`, the contracts of the standard, through which the console reads a SkillCDN deployment; before `1.0.0` the surface of `core` may change between minor versions, and a console built on one line may not read a deployment that speaks another. Whoever installs the console needs to see at a glance which line of SkillCDN it goes with.

The npm registry accepts a publish from a GitHub Actions workflow on the strength of a short-lived identity the job proves (trusted publishing), with no stored token, and attaches a provenance attestation that names the commit and the workflow. It does not accept the first version of a package that way. The main repository publishes its packages so ([its ADR-0046](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)), and AGENTS.md asked for the same workflow here.

## Decision

1. **Published:** `@skillcdn/console`, from this repository, by the release workflow (`.github/workflows/release.yml`, the main repository's). A change to the package carries a changeset that says what it means to whoever installs it; on `main`, pending changesets become one pull request that bumps the version and the changelog, and merging it publishes the new version through trusted publishing, with provenance, tags it and makes a GitHub release. The workflow holds no secret. Not published: `apps/console`, which exists for the image.
2. **The version follows the core line.** The major and the minor of `@skillcdn/console` are those of the `@skillcdn/core` the console is built on, as the workspaces declare it; the patch is the console's own, bumped by every release on the line. Adopting a new line of `core` is a `minor` changeset (a `major` for a new major) in the same change as the dependency bump; every other change is a `patch`, feature or fix. Before `1.0.0` the console therefore does not mark a breaking change of its own with a minor bump: the changelog says so in words, and the console's `1.0.0` waits for `core`'s.
3. **The rule is checked.** `pnpm check` fails when the package's line differs from the line of the `@skillcdn/core` any workspace declares (`scripts/check-version-line.mjs`), except for `0.0.0`, the version before the first release. A line that `core` skips is reached by setting the version by hand in the same change as the dependency bump.
4. **The first version is published by a maintainer by hand**, from a checkout of the commit on `main` that the version pull request made, and the trusted publisher is registered right after. From then on, only the workflow publishes.
5. **What the package carries:** its compiled `dist/`, its `README.md`, and the repository's `LICENSE.md`, copied in at pack time so that the text has one source.

## Consequences

- `pnpm check` gains the version-line check; the definition of done is otherwise unchanged. A change to the package without a changeset is not released until someone adds one.
- Whoever installs `@skillcdn/console` `0.1.x` has a console for SkillCDN `0.1`; the changelog says what changed in the console itself.
- The workflow needs the repository setting that lets Actions open pull requests, and the package needs its trusted publisher registered on the registry; both are in the settings checklist of `deploy/README.md`, since neither can be expressed in files here.
- Rejected: a version of the console's own (what it says of the SkillCDN line would live in the changelog alone, and a custom console would learn too late that its console and its deployment disagree); versions derived from commit messages (the commit log says what changed in the repository, not what a package's users need to know); a version for the image (a deployment pins a commit); a token stored as a repository secret (long-lived, and what ADR-0002 keeps out of a public repository).
