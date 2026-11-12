---
"@skillcdn/console": patch
---

A runner takes an update of the command by itself (ADR-0101). At every heartbeat it reads the version of the package it runs from; another version than its own, seen twice, is an update: nothing more is handed to the product, the turn under way ends in its own time, the open session ends as `restarted` with a line on its record that says why, and the runner ends with exit code 0, for the service that keeps it to start it again on the new command. The next session goes on with the conversation, and what was sent meanwhile is sent again from the console's record. A runner the console refuses as too old tells its agent, once, the command that installs the console's version the way this command was installed, where it only asked the agent to tell whom it reports to. `createRunner` takes `installed` and `updateCommand`, both optional, and `run()` answers how the runner ended: `stopped` or `updated`.
