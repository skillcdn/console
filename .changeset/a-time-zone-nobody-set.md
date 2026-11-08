---
"@skillcdn/console": patch
---

A time zone nobody set is told. `ctx.console.workspace()` says `timeZoneSet`, whether an administrator set one, beside `timeZone`, which is `UTC` either way, so that a plugin that reads a time of day says so instead of taking UTC for a choice. Where a plugin has a job at a time of day or a `time` setting and the workspace has no zone, `GET /api/v1/plugins/<key>` answers `needsTimeZone` (read as optional), the plugin's settings page shows the notice with the way to set one, and `console plugin <key> enable` prints it. A job's next time follows the zone: when it is set or changed, the next run is computed again at the job's time of day in the new zone, where the first run after the change was at the old zone's time; and a time of day across a clock change is read at the zone's offset on the day itself.
