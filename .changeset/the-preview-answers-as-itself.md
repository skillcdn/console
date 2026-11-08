---
"@skillcdn/console": patch
---

The preview console of `pnpm dev:plugins` answers as the console's own version, so that the real `console` command signs in to it (`console login --url <its address>`) and runs a plugin's commands as an agent would; it answered as the test harness's fixed version and refused the command as too new. It also serves the plugins' bundles uncached: a plugin rebuilt under one version was run by a browser from the build it had kept, against a server that answered something else, which read like a bug of the plugin's.
