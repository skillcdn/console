---
"@skillcdn/console": patch
---

The board in hand, second pass. The whole card follows the pointer while it is dragged, as wide as where it stands and held where it was taken, a faded one keeping its place; the title is part of the hold, so that the card is dragged from anywhere but its menu, and a click on the title opens the task unless the card was dragged. The cursor is `grab` and `grabbing` again. The card's menu is smaller and closes from its own button. A task is put away from any state (ADR-0030): the task's page offers it for every task not put away, the card's menu for every card given `onArchive`, and `console task archive` refuses no open task any more (`task.open` is gone from the refusals, and from the console's REST API, which a console of this version expects). The board's page shows the project's description beside its name on a wide window (`.sc-page-heading`, `.sc-page-lead`).
