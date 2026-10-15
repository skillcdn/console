# ADR-0029: A task done or dropped is put away, out of the board and open by its number

- Status: Accepted
- Date: 2026-10-15
- Builds on [ADR-0019](0019-a-task-is-planned-in-days-the-board-keeps-its-moments-and-goals-and-categories-give-the-work-its-shape.md) and [ADR-0020](0020-the-console-does-not-claim-an-agent-is-at-work-a-run-says-when-it-was-last-heard-from-and-a-new-run-takes-over.md). The contract is in [specs/rest.md](../specs/rest.md#get-apiv1projectskeytasksstateopenarchivedcategorygoalassigneeduebylimitoffset) and [specs/cli.md](../specs/cli.md).

## Context

A board keeps every task it ever had: the done and the dropped stayed in their columns, on the calendar and in the lists, and the pages read the board whole, one page of five hundred, so that a project with more lost its oldest tasks from the board without a word. A project of a few people closes tasks every day; after a season the columns of what is over outweigh what is open, and the board is slow to read and to look at.

The usual tools of this kind agree on the shape, whatever they call it: the default view shows what is open; what is closed is hidden behind a filter or after a while; a closed item can be put away without being deleted and found and brought back; a container closed at once puts its items away; and the putting away happens by itself after a period the organization sets.

## Decision

1. **A task done or dropped may be put away.** Putting away is a moment the board keeps on the task (`archived_at`), not a state: the task stays done or dropped, keeps every run, decision, comment and event, counts toward its goal as before, and is never deleted. An open task is not put away; a task put away is brought back the same way, by whoever may work in the project.
2. **A task put away is out of the listings, the board and the calendar, and open by its number.** `GET .../tasks` leaves the archived out unless asked for them alone (`archived=true`); a task's own address, by id or by number, answers it still, so that a link to it keeps working; the archive is a page of the project, read from the server a page at a time.
3. **Three ways there.** From the task's page or the command, one at a time; every done or dropped task of a goal at once, by an owner, offered when the goal is closed; and by the console itself, which puts away what was done or dropped and not touched for `TASK_ARCHIVE_AFTER_DAYS` (thirty unless configured; `0` never), on the worker's schedule. The organization's setting is the deployment's configuration for now; a page of the workspace's settings comes when a second setting of the kind does.
4. **The board stays as it is: six columns.** Putting away empties the done and dropped columns by itself, so no collapsed region and no separate tab is added; the two columns link to the archive. The pages read the current tasks whole, page after page while the server says there is more, bounded, so that nothing is left out without a word.
5. **Putting away and bringing back are events** (`task.archived`, `task.restored`), one per task, so that a task's history is complete; what the console does itself has no actor.
6. **The listings keep their pages:** `limit`, `offset` and `more`, as the decisions and the runs have them. A cursor is for when a listing outgrows an offset, which the archive, read as pages of fifty, does not.

## Consequences

- A board of a thousand tasks shows its open ones at once, its recent closed ones in their columns, and the rest in the archive; `console work` and `console take` change nothing, since neither ever dealt with closed tasks.
- A link to a task put away keeps working, and the task page says it is put away and offers to bring it back; the roadmap's counts do not move when a task is put away.
- The organization chooses the period in the deployment's configuration, and the worker does the putting away; a single-container install does it in the `api` role as it does the sweep.
- Rejected: deleting closed tasks (the board is the record); a seventh state `archived` (a put-away task is still done or dropped, and its goal counts it so); a collapsed region or a tab for the closed tasks (the archive makes them few); a workspace settings page for one number (configuration, until a second setting comes); a cursor (above).
