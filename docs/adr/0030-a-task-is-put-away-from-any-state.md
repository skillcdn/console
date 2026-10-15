# ADR-0030: A task is put away from any state

- Status: Accepted
- Date: 2026-10-15
- Amends [ADR-0029](0029-a-task-done-or-dropped-is-put-away-out-of-the-board-and-open-by-its-number.md), whose first point let only a task done or dropped be put away; the rest of it stands. The contract is in [specs/rest.md](../specs/rest.md#post-tasksidarchive-post-tasksidrestore-and-post-apiv1projectskeytasksarchive) and [specs/cli.md](../specs/cli.md).

## Context

ADR-0029 let a task be put away once it was done or dropped, so that the archive would hold what was over and the board what was not. The first days with it showed another kind of task: an idea written down and not taken up, a task made ready and overtaken by events, which nobody wants to drop, since dropping says the work was decided against, and nobody wants on the board either. The way around was to drop the task and put it away, which writes a decision that was never made.

## Decision

1. **A task is put away from any state, by a person's hand:** from its page, from its card's menu, with `console task archive`, by whoever may work in the project. Putting away stays a moment and not a state (ADR-0029): the task keeps its state, its runs, decisions, comments and events, and its place in its goal's count; brought back, it is where it was.
2. **What the console does by itself keeps to the done and dropped.** A goal closed takes its done and dropped tasks along, and the console puts away what was done or dropped and not touched for the period; an open task is put away by nothing but a person's hand, since it would otherwise go out of sight of the people it waits for.
3. `task.open` is no refusal any more.

## Consequences

- An idea not taken up, or a task overtaken by events, goes to the archive as it is, and the board says nothing it does not know: no dropped state stands for "not now".
- The archive page shows each task's state, so that what was put away open is told from what was over; brought back, an open task is on the board again where it was.
- An agent working the board sees no difference: the listings leave the tasks put away out, open or not, and `console take` works what the listings show.
- Rejected: a seventh state or a flag for "not now" (the archive is that, and a moment the board keeps); the console putting an open task away on its own schedule (above).
