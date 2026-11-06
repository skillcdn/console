---
"@skillcdn/console": patch
---

The plugins' settings form draws a control per kind of setting: a `list` of an `enum` is a pill per choice (a column of boxes past eight), a list of `person` or `project` the chips of those chosen with one choice to add another, a list of anything else the items as chips with a field that adds one, `min` and `max` bounding how many; a new type `time` (`HH:MM`, read in the workspace's time zone, which the form says beside it) joins the manifest's settings; and the form is divided into the `settingGroups` a manifest declares (up to 10, each `{ key, name, description? }`), a titled block each, the settings without a `group` above them. `console plugin <key> settings --set` takes a list with commas between, as before. `GET /api/v1/plugins/<key>` answers `settingGroups` and `group` on each setting, read as optional.
