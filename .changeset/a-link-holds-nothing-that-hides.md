---
"@skillcdn/console": patch
---

A link holds nothing that hides. A link of a task and a link handed in by a run are refused where they hold a control or an invisible character, a tab and a line break inside them too: the command prints a link as it was sent, and an escape in one was run by the terminal of whoever read the run. `restTaskInputSchema`, `restTaskPatchSchema` and `restArtifactInputSchema` refuse it as `request.invalid`; a link kept before is read as it is.
