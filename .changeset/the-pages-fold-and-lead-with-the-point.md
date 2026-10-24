---
"@skillcdn/console": patch
---

Breaking: the board folds the columns of finished work, and a task's ways to its forms stand in its head.

- `Board` folds the columns `folded` names, `FOLDED_STATES`, done and dropped, by default, so that the work at hand has the room, and `folded={[]}` folds none. A folded column is its header alone, a small box at the top of the board with its name, its count and the way to open it (`.sc-column-folded`, `.sc-column-toggle`; the words `board.fold` and `board.unfold`), and still takes a card dragged onto it. The board lays its columns out with flex rather than grid. Where a column holds more cards than it shows, the last card in view fades at the foot of the column rather than being cut by its edge, and the column's scrollbar shows only while the pointer is over the column or something in it has the focus.
- `TaskView` puts the ways to its forms (edit, raise a decision, put away, bring back), `.sc-task-actions`, in its head beside the title, where they were at the foot of its facts; the title, its parent and its badges are in `.sc-task-heading` within `.sc-task-header`. A stylesheet that placed `.sc-task-aside .sc-task-actions` places `.sc-task-header > .sc-task-actions`.
- On a narrow screen the tabs stay on one line and scroll sideways, the edge fading where more of them are, and `Shell` brings the current tab into view.
