# ADR-0013: The default brand comes from a published package of the main repository, through a slot in the console

- Status: Accepted
- Date: 2026-10-10

## Context

The default console shows the workspace's name and nothing else of who makes it. Milestone 5 of the [roadmap](../roadmap.md) asks for SkillCDN's favicon, symbol and wordmark in the default console, from a published package of the main repository and never copied here, with the note that the name and the marks are not licensed under MIT; and for a custom console to replace them in its configuration. This is open question 12 of [architecture.md](../architecture.md). The main repository keeps its brand assets in its web app and publishes no package that carries them; its trademark policy covers the marks, and this repository is under MIT ([ADR-0003](0003-the-console-is-licensed-under-mit.md)).

## Decision

1. **The console carries a slot for a brand, and no brand.** `createConsole({ brand })` takes the addresses of a symbol and a wordmark, which the shell shows beside the workspace's name and the sign-in page shows above it; left out, the pages show the name alone, as they do now. The favicon is the page's, in the HTML the default UI is built from. Nothing of SkillCDN's marks is in this repository: no file, no data URL, no copy.
2. **The assets come from a published package of the main repository**, proposed there as `@skillcdn/brand`: the symbol, the wordmark in its two colors, the favicon, with a README that carries the trademark policy and a license field that says the marks are not open source. The default UI (`apps/console/web`) depends on that package once it exists, imports the files through its build and passes their addresses to the slot; the license check allows the package by name, as it allows the other `@skillcdn/*` packages, and says why.
3. **The note travels with the default console.** Where the default UI is described, the README says that the SkillCDN name and marks are KDX Labs' trademarks, under the main repository's trademark policy and not under MIT, and that a custom console replaces them in its configuration, which is the slot.
4. **A custom console brings its own**: it passes its own addresses to the slot and sets its own favicon in its own page; the components know nothing of whose brand it is.

## Consequences

- Until the package exists, the default console is unbranded, which is honest: the slot is tested with invented assets, and the assets arrive by a dependency bump when the main repository publishes them, with no change to the pages.
- The main repository decides what the package carries and under what terms; this repository only consumes it, as it consumes `@skillcdn/core`, and never copies from it ([AGENTS.md](../../AGENTS.md), rule 7).
- Rejected: copying the assets here, which puts trademarked files in an MIT repository and breaks rule 7; loading them at run time from a SkillCDN deployment, which makes the pages depend on the network for their own frame and is not what the policy allows; a data URL in the package, which is a copy by another name.
