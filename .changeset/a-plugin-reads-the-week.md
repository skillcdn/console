---
"@skillcdn/console": patch
---

A plugin reads the workspace's week: `frame.context.workspace` says the time zone, the `weekStart` setting and `firstDay`, the day a week begins on with the setting applied, 1 for Monday, 7 for Sunday, and `ctx.console.workspace()` says `weekStart`, so that a calendar in a plugin starts on the day the console's own do.
