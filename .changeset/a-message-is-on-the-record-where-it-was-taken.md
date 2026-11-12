---
"@skillcdn/console": patch
---

What an agent account was sent is written on its session's record when its product takes it (ADR-0098): at once where the product waited for a message, and after the tool call under way or with the turn after where a turn was under way, so that the record reads in the order the agent read. What a session ends on before the product took it is written with `unread: true`, and the record says where a turn ends, a `status` with `turn: "completed"`. An `interrupt` may carry no words: it then stops the turn under way so that what the agent was sent and has not taken is read now, and sends nothing of its own; `console agent interrupt <handle>` takes none too, and `POST .../signals` asks words of a `tell` alone. For whoever writes a driver: a `DriverEvent` of the type `taken`, said once for every message sent, when the product reads it; a driver that says none has its messages written when the turn completes.
