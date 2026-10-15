---
"@skillcdn/console": patch
---

The way from the pack to the board. The console's own rules (`REFERENCE_RULES`) gain a third item under "Start here, every time": work given in chat with no task on the board yet is written on the board first (`console task new`), its number told to the person, taken and worked as any task, without asking whether to; until then the board is only read. The first item says the skill working-the-board is read before the first command of a run, with the command that prints where it is. `console help` says the same in its preamble, and `console whoami`, in a directory that works in a project, adds a line pointing to `console rules` and to the skill, so that an agent brought to the console by a pack's rules finds the next step there.
