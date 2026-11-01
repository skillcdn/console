---
"@skillcdn/console": patch
---

`plugin.purged` is a kind of event: an administrator purged a plugin, and everything the console kept of it is gone; the feed says so in English and Korean. `RestPluginPurgeInput` (`{ confirm: "<key>" }`) is what `POST /api/v1/plugins/<key>/purge` is sent.
