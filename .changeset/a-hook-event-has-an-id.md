---
"@skillcdn/console": patch
---

Breaking: a hook's event carries `id`, one id per event across the console's events and the plugins' (`console:<number>`, `plugin:<number>`), and `attempt`, which delivery this is, 1 the first time. Delivery is at least once, and a hook that must not act twice kept a key of the kind, the record and the time, which two events of one second could share; it keeps the ids it acted on now. `PluginHookEvent` gains the two fields, so a test of a plugin's that builds an event by hand adds them.
