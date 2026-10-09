---
"@skillcdn/console": minor
---

What the first agent to work a task through the command found awkward: `console help <command>` now says the limits the console holds the command to and the refusals it may meet, by code; the hint for a decision that still waits suggests a wait within what an agent's shell gives one command; `ask --json` prints the decision as soon as it is raised, so that a wait cut short loses no id; "no run to act on" and "several runs open" are both exit code 1; and runs and decisions carry `taskNumber` beside `taskId` (`restRunSchema`, `restDecisionSchema`), which the command shows as `#7`.
