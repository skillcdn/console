---
"@skillcdn/console": patch
---

The directory has a reporting line: a person carries `managerId`, whom they report to, or `null` (read as optional, for an older console). An administrator sets it on the People page, with `PATCH /api/v1/people/<id>` (`managerId`, another active person who does not report to them, or `null`; `person.invalid_manager` otherwise) or with `console person manager <login> <manager login|none>`; `console people` says it beside each person; the change is the event `person.manager_changed` with `login` and `manager`, which reaches the hooks of a plugin that reads the directory. A plugin takes it as its default where it needs someone's manager, in place of a line of its own.
