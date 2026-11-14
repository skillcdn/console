---
"@skillcdn/console": patch
---

A project on the front page comes at a glance of its board too, as `medium` 4×2, `large` 4×4 and `wide` 8×2 (ADR-0105): its mark, its name and three figures, the tasks in progress, those in review and the decisions waiting; under them, or beside them on a wide tile with what the project is, its tasks in progress, the soonest due first, its goals ahead with their bars, and what waits for review, as many rows as the room holds, each whole, with how many more there are, the parts parted by hairlines. A project carries `taskCounts`, the tasks of its board by state, those put away left out. `HomeGrid` takes `glances`, by the project's id, and `onGlance`, asked for the projects it shows at a glance; `ProjectTile` takes `glance`; `glanceFit` gives out the rows a room holds; `ProgressBar` takes `words={false}` for the bar alone. A custom console that gives no glance shows the head alone.
