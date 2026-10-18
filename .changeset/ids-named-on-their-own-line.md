---
"@skillcdn/console": patch
---

Every command that makes something prints its id on a line of its own, named by kind, so that an agent reads it rather than assumes it: `console task new` prints `task id:`, `console goal new` `goal id:`, `console ask` `decision id:`, and `console take` a line with `run id:` and `task id:` beside the task's number. The skill working-the-board says that a number or an id is read from the output of the command that made it, or from `--json`, and never assumed, since several agents write on one board.
