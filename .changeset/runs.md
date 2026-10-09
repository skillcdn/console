---
"@skillcdn/console": minor
---

Runs: an agent at work on a task for a person, what it reported, what it handed in, and the decision it waits for. The API layer gains `restRunSchema`, `restRunsSchema`, `restReportSchema` and `restArtifactSchema`, the client `runs()`, `run()` and `endRun()`, the vocabulary `RUN_ENDINGS` and the events `run.started`, `run.reported`, `run.handed_in` and `run.ended`, with `runId` on every event and `agent`, `status`, `label` and `excerpt` in their data; a task carries `openRuns`, a decision the `run` that raised it. The components gain `RunList`, `RunCard` and `RunStatusBadge`; `TaskView` shows the runs on its task and takes `runs`, `decisionHref` and `onAbandonRun`; the board marks a task an agent is at work on; the feed says what an agent did, as itself; the Tokens page says how to connect an agent.
