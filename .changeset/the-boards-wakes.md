---
"@skillcdn/console": patch
---

The board wakes agent accounts by its rules (ADR-0085): a ready task an agent is at work on whose day is unset, today or past, an agent made a worker of one, a due day moved to today, a comment on a task it owns or works on, a decision addressed to it and the answer to one it raised, and, from the console, a change of the services the workspace names. The worker role reads the feed for them every few seconds; what an agent did itself wakes it for nothing, and a task planned for a later day wakes nobody. A `task.updated` event that changed the workers says whom the change put to work, `workersAdded`, which the feed's schema reads.
