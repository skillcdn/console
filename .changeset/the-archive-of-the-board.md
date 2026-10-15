---
"@skillcdn/console": patch
---

A task done or dropped is put away (ADR-0029): out of the board, the lists and the calendar, counted by its goal as before, open by its number still, and brought back at any time. From the task's page or `console task archive <number>`; every closed task of a goal at once with `console task archive --goal <id>` or from the goal's page, offered when the goal is closed; and by the console itself after `TASK_ARCHIVE_AFTER_DAYS`. The archive is a page of the project (`/archive`), read a page at a time; `console tasks --archived` lists it; `console task restore <number>` brings a task back. A task carries `archivedAt`, the events `task.archived` and `task.restored` are new, and the pages now read a project's current tasks whole, page after page, instead of the first five hundred.
