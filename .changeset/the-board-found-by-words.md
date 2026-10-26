---
"@skillcdn/console": patch
---

The board is narrowed by words as they are typed: a field at the head of the filters, with no button, keeps the cards whose title, number, owner, workers or category contain every word given, whatever the case, and the count says how many it keeps. The words are in the board's address as the other filters are (`q=`), so that a narrowed board is a link; `BoardFilter` carries them as `words`, `filterTasks` reads them, and `boardHref` writes them.
