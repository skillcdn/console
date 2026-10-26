# ADR-0041: A run not heard from for a day is ended by the console

- Status: Accepted
- Date: 2026-10-26
- Supersedes point 3 of [ADR-0020](0020-the-console-does-not-claim-an-agent-is-at-work-a-run-says-when-it-was-last-heard-from-and-a-new-run-takes-over.md)

## Context

ADR-0020 left a run that fell silent open until an agent took the task over or a person gave up on it, and rejected the console ending one itself, since a threshold right for one kind of work is wrong for another and the console would be claiming to know again. After two weeks of use the open runs on the board are mostly of agents that were closed with their terminal or their session: nobody takes those tasks over, since the work was done or moved on, and nobody goes back to mark them, so a project shows runs open for days and a task's page lists a run that will never end. The moment a run was last heard from was there to judge by, and nobody judged.

## Decision

1. **The console ends a run it has not heard from for a day.** A run that is open and not waiting for an answer, and that has not been heard from for `RUN_ENDED_AFTER_HOURS` (default 24; 0 never), is ended as `abandoned` by the worker (the `api` role with `WORKER_IN_PROCESS`), with a summary that says so and `run.ended` on the feed naming no actor and the reason (`unheard`). The task stays as it is, as every abandoned run leaves it. The moment counted from is the run's last change: its start, its latest report, hand-in or question, or the answer to the decision it waited for.
2. **A run waiting for an answer waits on.** A run is `waiting` while a decision it raised has no answer, and the console never ends it then, however long the person takes: the silence is the person's, not the agent's. Once the answer comes the run runs again, and the day is counted from the answer, since an agent that comes back for the answer reports then.
3. **The threshold is the deployment's, not the task's.** One number for the console, set by the operator, a day by default: long enough for any session of an agent, and short enough that a board read in the morning shows what happened yesterday as over. An agent at work longer than that reports at its milestones, which the skill asks of it anyway, and each report is heard.

## Consequences

- The board shows as open only what may still be at work; a run of an agent that was closed is over by the next day, in the feed and on the task, with the console named as the one that ended it and the reason beside it, so that nobody reads it as the agent's own giving up.
- An agent whose run was ended this way is refused on it (`run.over`), as on any run that is over, and takes the task again: a new run, as ADR-0020 has it. The skill working-the-board says so, and says to wait on a decision with `--wait` or to come back, rather than to poll in silence.
- `lastHeardAt` keeps its meaning, what the agent sent; the console's ending is a second moment, `endedAt`, with the reason on the event. Nothing is claimed about whether the agent still runs: a run is ended because the board has not heard from it, which is what the board knows.
- Rejected: a status of its own for a run that fell silent (another word for every page and command to know, where "abandoned, by the console, not heard from" says it); a threshold per project or per task (a setting nobody would tune, where the day fits); ending a run that waits for a person (the person's delay would end the agent's work).
