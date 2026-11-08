---
"@skillcdn/console": patch
---

A plugin's server reads the console's public origin and the addresses of its own endpoints, to register a callback with a service elsewhere and to write a link to the console: `ctx.console.workspace().url` is `PUBLIC_URL`, or `null` where the deployment names none, and `ctx.endpoints.url(name)` the full address of an endpoint the plugin defines (`plugin.not_found` for one it does not, `plugin.unavailable` without a public address). `createTestContext` takes `publicUrl` and `endpoints` to answer them in a plugin's tests. Neither needs a capability: nothing in them is secret.
