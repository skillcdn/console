# ADR-0026: A goal is planned in days and sorted into a category, and the roadmap is read as months

- Status: Accepted
- Date: 2026-10-13
- Amends: [ADR-0019](0019-a-task-is-planned-in-days-the-board-keeps-its-moments-and-goals-and-categories-give-the-work-its-shape.md) (what a goal carries, and how the roadmap is seen)

## Context

A goal had a title, what reaching it means, a state and the day it is meant to be reached by ([ADR-0019](0019-a-task-is-planned-in-days-the-board-keeps-its-moments-and-goals-and-categories-give-the-work-its-shape.md)). The roadmap was a list of them. An organization that runs on the board plans its goals as it plans its tasks: a goal has a start as well as a target, it belongs to a kind of work as a task does, and whoever runs a project wants to see the goals laid out in time, months at a glance, since the goals of a board span months, not days. The month grid of the calendar is the wrong instrument for that; a list says nothing of when.

## Decision

1. **A goal is planned in days, as a task is.** `startsOn` and `dueOn` are calendar days, set by an owner, the target not before the start (`goal.invalid_dates`); either may be left out. The board keeps no moments on a goal: a person says when it is reached, as before.
2. **A goal is sorted into a category of the workspace**, the same vocabulary a task is sorted into, one or none (`goal.invalid_category`). A category goals are sorted into cannot be removed until they are moved, as with tasks (`category.in_use`).
3. **The roadmap is read as months.** The Roadmap page shows the months as columns, six from the one the address names (`?from=<month>`) or from this one, and each goal with days as a bar from its start to its target in the colour of its category, filled as far as its tasks are done, with today a line down the months; a goal with one day sits on it as a point; goals with no day are named below the months. The list of goals stays under it, with the category and the days on each.
4. **A goal marks its target day on the project's calendar**, a flag in the colour of its category before its title, so that the month says what it is aimed at as well as what is due in it. A goal let go marks nothing.
5. **The surfaces follow.** The REST API takes and answers `startsOn` and `category` on a goal and narrows the roadmap by `category` and `state`; the command takes `--starts` and `--category` on `goal new` and `goal edit`, and `--category` and `--state` on `goals`; the form offers the start day and the categories; the goal's page states both.

## Consequences

- Whoever runs a project reads the year from one page: what is worked towards when, of what kind, and how far each is, as current as the board.
- A goal and a task are planned alike, so that nothing about days or categories has to be learned twice, and a category means the same on the roadmap as on the board.
- The roadmap across projects stays open: the months read the same for any set of goals, so a workspace page of goals is a listing away.
- Rejected: goals on the month grid as bars (a goal spans months, and the grid holds days); a stored order of goals (the state, the target and the age order them, as before); an assignee on a goal (a goal is a project's outcome, and the people are on its tasks; a goal with an owner of its own is a question for later); moments on a goal (a person says when it is reached; the tasks say how far it is).
