---
"@skillcdn/console": patch
---

The console bounds what a workspace, a project, a task and a person hold at once, where a runaway script could grow them without end: `MAX_PROJECTS_PER_WORKSPACE` (500), `MAX_TASKS_PER_PROJECT` (20,000), `MAX_GOALS_PER_PROJECT` (1,000), `MAX_DECISIONS_PER_PROJECT` (20,000), `MAX_DOCUMENTS_PER_PROJECT` (5,000) and `MAX_RUNS_PER_TASK` (500), those put away counted, refused as `project.too_many`, `task.too_many`, `goal.too_many`, `decision.too_many`, `document.too_many` and `run.too_many` (`409`); and `MAX_STREAMS_PER_PERSON` (20) streams of the live feed for one person with `MAX_STREAMS` (1,000) for a process, refused as `feed.too_many` (`429`, with `retry-after`). The command's help names the bounds and the refusals, and says what to do when one is met.
