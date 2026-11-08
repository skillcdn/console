---
"@skillcdn/console": patch
---

`arg.day` and a `day` setting take a day the calendar has. February 30 and April 31 fit the shape `YYYY-MM-DD` and reached the plugin, where a record's schema refused them in the record's words and a query answered as if they were days; both are now `plugin.invalid_args`, named as the argument. `isCalendarDay` is exported from `@skillcdn/console/plugin`.
