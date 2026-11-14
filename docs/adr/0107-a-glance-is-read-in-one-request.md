# ADR-0107: A glance is read in one request

- Status: Accepted
- Date: 2026-11-14
- Amends point 5 of [ADR-0105](0105-a-project-at-a-larger-size-is-a-glance-at-its-board.md), which put the counts on the project and read the rows through the board's listings, and the first of its consequences. The rest of that decision stands: the sizes, what a glance says, the rows its room holds, the hairlines.

## Context

A project at a glance was read in four pieces. Its figures came with the project, `taskCounts`, read once when the console opened. Its rows came from three listings of the board, the tasks in progress, the tasks in review and the goals ahead, read each time the front page was shown. A review before the release found what that shape costs.

- The figures and the rows told of different moments. A person who moved two tasks and came back to the front page saw a head that said six beside a list of eight, and a decision answered an hour ago still counted as waiting.
- The counts were six subqueries on every read of a project, and a project is read on every request under `/api/v1/projects/<key>`, writes included, and by three listings that have no use for them.
- A listing is newest first and was cut at twenty before the page sorted it by due day, so past twenty the first rows were not the soonest due; and a list said how many more there were from the rows it had, not from how many there are.
- A listing carries each task and each goal whole, the body included, to show a title.
- One of the three requests failing left the tile without rows until the person left the page and came back.
- A plugin that may read the projects received the counts with them, which the words it was consented to under do not say.

## Decision

1. **A glance is one read.** `GET /api/v1/projects/<key>/glance` answers what a tile at a glance shows: the tasks of the board counted by state, those put away left out; the decisions waiting; the tasks in progress, the tasks in review and the goals ahead. The figures and the rows are of one moment, since they are one answer.
2. **The console orders and cuts the lists.** The tasks the sooner due first, those due on no day after them, the newer first within a day, as a person's plate orders its own; the goals as the roadmap lists them. Each list carries `GLANCE_ROWS` rows at most, more than a tile of any size holds, and how many there are in all, so that the first rows are the first of all of them and what a tile says is left over is true.
3. **A row is what a tile draws.** A task as its id, number, title, state, due day and workers; a goal as its id, title, state, target day and its tasks counted. No body.
4. **`taskCounts` leaves the project.** A project carries what waits in it, as before ([ADR-0020](0020-the-console-does-not-claim-an-agent-is-at-work-a-run-says-when-it-was-last-heard-from-and-a-new-run-takes-over.md)), and nothing of its board's states. No release carried the field.
5. **It is read by whoever may see the project**, under the same rule as its tasks: a project a person may not see is the same answer as one that is not there, and an agent reads what its person may.
6. **The front page reads it again when it is shown.** Each time the page is shown, and when the person comes back to its window, the projects are read again and each glance with them. A read that fails is tried again, a little later each time, while its tile is shown; an answer is kept only if it is still the reading it was asked for.

## Consequences

- The front page reads one request for each project shown at a glance, where it read three, and none for one shown as an icon or a card. A read of a project costs what it did before the glance.
- The counts are one pass over the project's current tasks, by the index on a project's tasks and whether they are put away (`tasks_project_archived_idx`); the rows are read along the index on a project's due days (`tasks_project_due_idx`). On a board of 8,000 tasks, a quarter of them put away, the counts took under four milliseconds and a list under one. No index was added.
- `ProjectTile`'s `glance` and `HomeGrid`'s `glances` take the answer as it is (`RestProjectGlance`, `ProjectGlance` on the page); `client.project(key).glance()` reads it. A custom console that passes none shows the head with the decisions the project knows of and a dash for the two figures it has not read.
- `HomeGrid` tells `onGlance` the projects it shows at a glance whenever the set changes, an empty set included, and never because the function it was given is another one. What reads the glances is `createGlanceReader`, given the way to read one.
- A plugin's read of the projects learns nothing of their boards' states.
