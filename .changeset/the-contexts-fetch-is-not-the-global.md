---
"@skillcdn/console": patch
---

`console-plugin check` no longer reads `ctx.fetch(`, or any member called `fetch`, as a call of the global `fetch` the host removes, which failed every server bundle that used the context's fetch as the spec asks; `globalThis.fetch(` is still found. `defineEndpoint` takes a webhook's `secret` named as settings are named (`slackSigningSecret`), where it took the shape of a plugin key, which no setting has.
