---
"@skillcdn/console": patch
---

`console-plugin check` no longer reads `ctx.fetch(`, or any member called `fetch`, private ones (`this.#fetch(`) included, as a call of the global `fetch` the host removes, which failed every server bundle that used the context's fetch as the spec asks; `globalThis.fetch(` is still found, and `global.fetch(` and `globalThis?.fetch(` now are. `defineEndpoint` takes a webhook's `secret` named as settings are named (`slackSigningSecret`), where it took the shape of a plugin key, which no setting has.
