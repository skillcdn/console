---
"@skillcdn/console": patch
---

The board in hand. A card is dragged to another column from anywhere on it but its title and its menu: with a mouse at once, under a finger once it has rested a moment, so that a finger that moves scrolls the page as before; the cursor is the standard `move`, which every platform draws itself. The state select is gone from the card; the task's page keeps the way for the keyboard. Each card has a menu in its corner, three dots, with the way to the task's form (`Board` and `TaskCard` take `editHref` and `onEdit`) and, once the task is done or dropped, the way to put it away (`onArchive`). `Board` no longer takes `archiveHref` and no column leads to the archive; the default console leads there from the board's page, beside the way to write a task, and the archive page says nothing above its list. `TaskCard` takes `onPress` in place of `onGrip`, and the words `board.grip`, `board.moveTo` and `archive.lead` are gone from the packs, `board.menu` added.
