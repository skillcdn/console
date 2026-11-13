---
"@skillcdn/console": patch
---

A runner that takes an update of its command (ADR-0101) no longer ends inside the turn the update was made in. The message by which a runner the console refuses as too old tells its agent to install the console's version is a turn as any other, so the runner ends when the agent is done with it and never while the install still runs under it; the second sighting of the new version counts a heartbeat's interval after the first, where two looks a moment apart, at a change of the agent's state, were taken as two. A supervisor's `interrupt` stops the turn under way once an update was seen, where it stopped nothing until the turn ended by itself; its words reach the runner started after. The install line the agent is told names the console's version only where that is a version, and `latest` otherwise.
