---
"@skillcdn/console": patch
---

A plugin's thread has no way to the network but `ctx`, as it was meant to: `process.getBuiltinModule` answered the built-ins the module hook refuses, and `node:_http_client`, `node:_tls_wrap` and their kin, the names Node keeps for compatibility, were not refused at all. Both now fail as `node:net` does, and `console-plugin check` says so of a bundle that uses them.
