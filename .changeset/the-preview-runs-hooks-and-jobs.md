---
"@skillcdn/console": patch
---

`skills/building-a-plugin` says that the console started on this machine with `pnpm dev:plugins` runs the plugins' hooks and jobs in its process too, so that a decision answered there reaches the plugin's hook within seconds and a job runs at its time, as on a deployment.
