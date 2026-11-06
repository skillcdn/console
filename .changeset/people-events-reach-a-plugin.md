---
"@skillcdn/console": patch
---

A plugin with `people:read:all` hears the workspace's people events (`console:person.joined`, `person.deactivated`, `person.reactivated`, `person.role_changed`, `person.listed`, `person.unlisted`) in its hooks, with their content, as they happen, in place of comparing the directory day by day; `docs/specs/plugins.md` says so under the capability and under "Events, hooks and jobs".
