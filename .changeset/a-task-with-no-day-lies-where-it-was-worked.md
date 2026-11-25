---
"@skillcdn/console": patch
---

A task with no day of its plan is on the calendars on the days it was worked (ADR-0159). A calendar laid a task on its start and its due day alone, so a task written and taken at once, as an agent begins work that had no task, was on no day: the week of an agent account stood nearly empty while it worked, and a project's month showed nothing of what was done unplanned. Such a task now lies from the day the board kept as its start through today while it is in progress, and else through the day its last run ended, however long it waits for its review; with no run that ended, through the day it was done, or on the day it was started alone. A project's month, the month of a goal's tasks and the week of a plate, a person's own, another's and an agent account's, read it the same way. A task with a start or a due day lies on its plan as before.

Nothing is written for it: the plan stays as people left it, and the task is still listed as having no day set. A task as the API answers it says when the last of its runs ended, `lastRunEndedAt`, read as optional; the command is unchanged. The day a moment fell on is the reader's, by the browser's clock, as today is.

`daysOf(task, today)` answers where a task lies, `{ from, to }` or nothing, for a calendar of your own. `weekSegments` takes the day to count from as a third argument, the browser's today when left out, and lays such a task among the bars where it was worked on more than one day.
