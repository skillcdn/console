---
"@skillcdn/console": patch
---

A record that names the person who did a thing names the agent they did it through (ADR-0056), as the feed always has. A decision's answer carries `agent`: the token's name when an agent wrote the answer in the person's name with `console answer`, `null` when they answered themselves; what followed carries `outcomeBy`, `outcomeAgent` and `outcomeAt`; a goal and a task carry `agent`, the agent they were set or written through. Each is read as optional, so that a console built on this package still reads an older console. The pages say "answered through <agent>" and "wrote what followed through <agent>" on a decision, "through <agent>" beside who set a goal and "Written through" on a task; the command prints `through <agent>` beside the login and `written through:` on a task; `console help answer` says that the record names the agent. The rows of the past take the agent from the feed, where it knew.
