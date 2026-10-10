---
"@skillcdn/console": patch
---

The package carries the console's skills in the SkillCDN Format (`skills/working-the-board`, `skills/building-a-console`, with their manifest `SKILLCDN.md`), the specifications they point to (`docs/specs/rest.md`, `docs/specs/cli.md`) and its sources under `src/` without the tests, so that an agent that installed it reads from `node_modules` how the board is worked and how a console is built, at the version installed ([ADR-0015](https://github.com/skillcdn/console/blob/main/docs/adr/0015-the-consoles-skills-live-in-this-repository-in-the-skillcdn-format-and-the-package-carries-them.md)). The same skills are served by SkillCDN at `skillcdn.ai/gh/skillcdn/console`.
