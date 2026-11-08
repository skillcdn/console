---
"@skillcdn/console": patch
---

The dispatcher delivers to each plugin under an advisory lock of its own, the plugins side by side, where one lock held every plugin in turn: a plugin whose hook waits on a slow service, or waits out its backoff after a failure, holds up no other plugin's delivery, and two processes may dispatch to two plugins at once. A plugin that has had twenty seconds of a pass leaves the rest of its events to the next pass. A hook told to come back later by the service it called says so with `retryAfterMs` in the data of its refusal (`throw new PluginError("rate_limited", message, { retryAfterMs })`), and the next try waits that long, within an hour, in place of the doubling backoff; the try still counts toward the five.
