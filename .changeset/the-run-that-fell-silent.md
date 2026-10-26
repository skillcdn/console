---
"@skillcdn/console": patch
---

The feed says when the console ended a run that had gone quiet (ADR-0041): a run open, not waiting for an answer and not heard from for a day (what the deployment sets) is ended as abandoned by the console itself, `run.ended` naming no actor and the reason, and the feed reads it as the console's doing, not the agent's. The skill working-the-board (1.23) tells an agent so: report at the milestones, wait on a decision with `--wait` or come back for it, and take the task again when a run was ended that way.
