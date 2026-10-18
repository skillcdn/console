---
"@skillcdn/console": patch
---

Breaking: `console tasks --due week` keeps the tasks due by the last day of this week, the week beginning as the workspace says or, left to the language, as the person's language has it, else the machine's, in place of seven days from today (ADR-0039); the command asks `GET /api/v1/me` for it on that flag. Who has what counts what is due this week in place of seven days: `WorkloadRow.dueSoon` is `dueThisWeek`, `workloadOf` takes the day the week begins on, and `Workload` takes `weekStart`; the words `calendar.workload.dueSoon` are `dueThisWeek`. My work's bucket for this week ends with the week the same way. `CliIo` takes `locale`, the machine's language and region, for what follows a language where the person chose none.
