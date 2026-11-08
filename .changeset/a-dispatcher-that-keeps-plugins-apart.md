---
"@skillcdn/console": patch
---

The dispatcher delivers to each plugin under an advisory lock of its own, where one lock held every plugin in turn: two processes may dispatch to two plugins at once, and a process delivers to a few side by side, as many as its database connections allow. A plugin that has had twenty seconds of a pass leaves the rest of its events to the next pass, so that a plugin whose hook waits on a slow service, or waits out its backoff after a failure, holds up the others for no longer than that. A hook told to come back later by the service it called says so with `retryAfterMs` in the data of its refusal (`throw new PluginError("rate_limited", message, { retryAfterMs })`), and the next try waits that long, within an hour, in place of the doubling backoff; the try still counts toward the five.
