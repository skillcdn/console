---
"@skillcdn/console": patch
---

`console use` prints, after binding a directory to a project, the sentence for the checkout's agreement (AGENTS.md, or CLAUDE.md where that is the file agents read), to be copied as it is, so that every agent working there is sent to the console: nothing tells an agent to look until the checkout says so, as `skillcdn use` now prints the sentence for a pack. `THE_SENTENCE` is exported from the command's directory module, and the help and the spec say so.
