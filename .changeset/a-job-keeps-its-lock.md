---
"@skillcdn/console": patch
---

A plugin's job keeps its lock for as long as it runs, up to its five minutes, where a job of more than thirty seconds lost it to the server's bound on an idle transaction: another process could run the same job beside it, and the pass logged that the plugins' jobs were not run, leaving the jobs after it to the next pass.
