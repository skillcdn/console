# Changesets

A changeset says what a change means to whoever installs the published package: the bump, and a line or two written for them. `pnpm changeset` writes one into this directory; a file by hand does the same:

```md
---
"@skillcdn/console": minor
---

The board component takes a `columns` option.
```

Bumps: `patch` for a fix, `minor` for something new. Before `1.0.0`, a change that removes or renames something is `minor` as well: `major` would make the version `1.0.0`. A change to `@skillcdn/console` without a changeset is not released until one is added.

The release workflow, added with the package's first publish, turns the pending changesets into one pull request that bumps the version and the changelog; merging it publishes through the registry's trusted publishing ([the main repository's ADR-0046](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0046-packages-are-published-to-npm-through-trusted-publishing.md)).
