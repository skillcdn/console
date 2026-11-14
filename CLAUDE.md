# CLAUDE.md

The working agreement for this repository is [`AGENTS.md`](AGENTS.md), for every agent and every person. It is imported here so that Claude Code reads it as its own:

@AGENTS.md

Do not duplicate rules into this file. Change `AGENTS.md` instead.

What is in `.claude/` is Claude Code's own and holds no rule of its own: `.claude/rules/pages.md` is given to it when it opens a file of the console's pages, and points at the rules for them, `packages/console/src/styles/README.md`; the hook in `.claude/settings.json` runs `pnpm check:styles` after a file is written and hands back what it refuses; `.claude/launch.json` is how its preview starts `pnpm dev`.
