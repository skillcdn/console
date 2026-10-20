---
"@skillcdn/console": patch
---

Breaking: the board folds the columns of finished work, and a task's ways to its forms stand in its head.

- `Board` folds the columns `folded` names to a strip with their count and the way to open them, which still takes a card dragged onto it; `FOLDED_STATES`, done and dropped, by default, so that the work at hand has the room, and `folded={[]}` folds none. The board lays its columns out with flex rather than grid, a folded one narrow (`.sc-column-folded`, `.sc-column-toggle`); the words are `board.fold` and `board.unfold`.
- `TaskView` puts the ways to its forms (edit, raise a decision, put away, bring back), `.sc-task-actions`, in its head beside the title, where they were at the foot of its facts; the title, its parent and its badges are in `.sc-task-heading` within `.sc-task-header`. A stylesheet that placed `.sc-task-aside .sc-task-actions` places `.sc-task-header > .sc-task-actions`.
- `Calendar` shows three of a day's own tasks and the way to the rest (`.sc-calendar-more`, the words `calendar.more` and `calendar.fewer`) where the day has more than four, so that a busy week is as tall as the others until a day is opened.
- On a narrow screen the tabs stay on one line and scroll sideways, the edge fading where more of them are, and `Shell` brings the current tab into view.
