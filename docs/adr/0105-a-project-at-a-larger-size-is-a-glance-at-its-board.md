# ADR-0105: A project at a larger size is a glance at its board

- Status: Accepted; point 5 and the first consequence amended by [ADR-0107](0107-a-glance-is-read-in-one-request.md)
- Date: 2026-11-14
- Amends point 2 of [ADR-0061](0061-the-front-page-is-one-grid-of-tiles-a-person-arranges-by-hand.md), which had a project come as an `icon` or `small` alone. The rest of that decision, and [ADR-0082](0082-the-page-of-someone-who-has-arranged-nothing-is-composed-edge-to-edge.md), stand.

## Context

On the front page a project is its mark and its name, or a card with what it is. A person who opens the console to see how a project stands goes into its board for it, project after project. The widgets beside the projects come in larger sizes and show something worth the room; a project at a larger size had nothing to put in it.

A proposal drew a project at every size a widget has. At `full`, 8×4, it had more room than it had things to say, and most of the tile stood empty; and the parts of the proposal ran into one another, a list's last row against the next list's name, with nothing between them.

## Decision

1. **A project comes as an `icon`, `small`, and at a glance as `medium` 4×2, `large` 4×4 and `wide` 8×2.** Not `full`. Where the projects take one size together, as a width nobody arranged is closed up, they take `icon` or `small` as before.
2. **A glance says what is going on in the project.** At its head, the project's mark, name and key, and three figures: the tasks in progress, those in review, and the decisions waiting, the last in the colour of a count while there are any. Under the head, its tasks in progress, the soonest due first, each with its due day where it is within a week or past, and who is at work on it; its goals ahead, as the roadmap orders them, each with its day, how many of its tasks are done, and its bar; and its tasks waiting for review. On a `wide` tile the head is a column of its own with the project's description, and the lists stand beside it.
3. **A glance keeps the rows its room holds, each whole.** Its parts have heights the page knows (`GLANCE_REM`), and the rows are given out in an order: two tasks in progress, a goal, the rest of the tasks, the rest of the goals, then what waits for review; a list that cannot show a row is left out, and one that shows some of its rows says how many more there are. Nothing is cut, nothing scrolls, and on a phone a `medium` tile is its head alone.
4. **The parts are parted by hairlines.** One across the tile under the head and between two lists, and one between two rows, as the plugins' widgets part theirs; nothing else draws a box.
5. **A project carries how many of its tasks are in each state.** `taskCounts` on a project, in the listing and on its own, counts the tasks of its board by state, those put away ([ADR-0029](0029-a-task-done-or-dropped-is-put-away-out-of-the-board-and-open-by-its-number.md)) left out: the head's figures. The rows are read through the board's own routes, by the composition and only for the projects the page shows at a glance, once for each reading of the projects; the page and the tile take what they read as props.

## Consequences

- The front page reads three requests more for each project shown at a glance, and none for one shown as an icon or a card.
- `HomeGrid` takes `glances`, by the project's id, and `onGlance`, asked for the projects shown at a glance; `ProjectTile` takes `glance`. A custom console that leaves them out shows the head alone.
- The console a person looks at the pages with (`pnpm dev:plugins`) makes a project with a board of invented work once, and arranges a member's front page with it at a glance.
